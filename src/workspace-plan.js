import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { buildColdImportReadiness } from "./cold-import-readiness.js";
import { normalizeRepoPath, posixJoin, slugForArtifact } from "./path-utils.js";

export const defaultWorkspacePlanOptions = {
  captureScript: null,
  optInEnv: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1",
  resultsRoot: ".plugin-inspector/results",
  syntheticProbeScript: null,
  workspaceRoot: ".plugin-inspector/workspaces",
};

export async function buildWorkspacePlan(options = {}) {
  const report = options.report;
  if (!report) {
    throw new TypeError("buildWorkspacePlan requires a compatibility report");
  }

  const settings = workspaceSettings(options);
  const readiness = options.readiness ?? buildColdImportReadiness({ report, rootDir: settings.rootDir });
  const packageByPath = new Map(
    report.fixtures.flatMap((fixture) => (fixture.packages ?? []).map((packageSummary) => [packageSummary.path, packageSummary])),
  );

  const fixtures = [];
  for (const fixtureReadiness of readiness.fixtures) {
    const entries = [];
    for (const entrypoint of fixtureReadiness.entrypoints) {
      const packageSummary = packageByPath.get(entrypoint.packagePath);
      if (!packageSummary) {
        continue;
      }
      const packageJson = await readPackageJson(settings.rootDir, packageSummary.path);
      entries.push(
        await buildEntrypointPlan({
          entrypoint,
          fixtureId: fixtureReadiness.id,
          packageJson,
          packageSummary,
          settings,
          targetOpenClawPath: report.targetOpenClaw.configuredPath,
        }),
      );
    }
    fixtures.push({
      id: fixtureReadiness.id,
      entrypoints: entries,
    });
  }

  const allEntries = fixtures.flatMap((fixture) => fixture.entrypoints);
  const allSteps = allEntries.flatMap((entrypoint) => entrypoint.steps);
  return {
    generatedAt: report.generatedAt,
    mode: "plan-only",
    optIn: {
      env: settings.optInEnv,
      reason: "Dependency install, build scripts, and plugin import execution are intentionally outside default CI.",
    },
    targetOpenClaw: {
      status: report.targetOpenClaw.status,
      configuredPath: report.targetOpenClaw.configuredPath,
    },
    summary: {
      fixtureCount: fixtures.length,
      entrypointCount: allEntries.length,
      installStepCount: allSteps.filter((step) => step.kind === "install").length,
      auditStepCount: allSteps.filter((step) => step.kind === "audit").length,
      buildStepCount: allSteps.filter((step) => step.kind === "build").length,
      pruneDevWorkspaceDependencyStepCount: allSteps.filter((step) => step.kind === "prune-dev-workspace-deps").length,
      artifactStepCount: allSteps.filter((step) => step.kind === "prepare-artifacts").length,
      captureStepCount: allSteps.filter((step) => step.kind === "capture").length,
      syntheticProbeStepCount: allSteps.filter((step) => step.kind === "synthetic-probe").length,
      targetOpenClawLinkStepCount: allSteps.filter((step) => step.kind === "link-openclaw").length,
      tsLoaderEntrypointCount: allEntries.filter((entrypoint) =>
        entrypoint.requiredCapabilities.includes("ts-loader"),
      ).length,
      jitiAlternativeCount: allEntries.filter((entrypoint) =>
        entrypoint.loaderStrategy.alternatives.includes("jiti"),
      ).length,
      missingBuildScriptCount: allEntries.filter((entrypoint) =>
        entrypoint.blockers.some((blocker) => blocker.code === "missing-build-script"),
      ).length,
      sdkAliasRequiredCount: allEntries.filter((entrypoint) =>
        entrypoint.requiredCapabilities.includes("sdk-alias-compat"),
      ).length,
    },
    fixtures,
  };
}

export function validateWorkspacePlan(plan, options = {}) {
  const settings = workspaceSettings(options);
  const errors = [];
  if (plan.mode !== "plan-only") {
    errors.push("workspace plan must stay plan-only for default checks");
  }
  if (plan.optIn.env !== settings.optInEnv) {
    errors.push(`workspace execution must require ${settings.optInEnv}`);
  }
  for (const fixture of plan.fixtures) {
    for (const entrypoint of fixture.entrypoints) {
      if (!entrypoint.packagePath || !entrypoint.entrypoint) {
        errors.push(`${entrypoint.id}: missing package path or entrypoint`);
      }
      if (entrypoint.steps.length === 0) {
        errors.push(`${entrypoint.id}: missing workspace steps`);
      }
      if (!entrypoint.loaderStrategy?.primary || !entrypoint.loaderStrategy.reason) {
        errors.push(`${entrypoint.id}: missing loader strategy`);
      }
      if (
        entrypoint.requiredCapabilities.includes("ts-loader") &&
        !entrypoint.loaderStrategy?.alternatives?.includes("jiti")
      ) {
        errors.push(`${entrypoint.id}: ts-loader capability must track a jiti fallback`);
      }
      if (!entrypoint.steps.some((step) => step.kind === "prepare")) {
        errors.push(`${entrypoint.id}: missing prepare step`);
      }
      if (!entrypoint.steps.some((step) => step.kind === "prepare-artifacts")) {
        errors.push(`${entrypoint.id}: missing prepare-artifacts step`);
      }
      if (!entrypoint.steps.some((step) => step.kind === "capture")) {
        errors.push(`${entrypoint.id}: missing capture step`);
      }
      if (!entrypoint.steps.some((step) => step.kind === "synthetic-probe")) {
        errors.push(`${entrypoint.id}: missing synthetic-probe step`);
      }
      if (entrypoint.requiredCapabilities.includes("dependency-install") && !entrypoint.steps.some((step) => step.kind === "install")) {
        errors.push(`${entrypoint.id}: dependency install capability has no install step`);
      }
      if (entrypoint.requiredCapabilities.includes("dependency-install") && !entrypoint.steps.some((step) => step.kind === "audit")) {
        errors.push(`${entrypoint.id}: dependency install capability has no audit step`);
      }
      if (entrypoint.requiredCapabilities.includes("target-openclaw-link") && !entrypoint.steps.some((step) => step.kind === "link-openclaw")) {
        errors.push(`${entrypoint.id}: target-openclaw-link capability has no link-openclaw step`);
      }
      if (entrypoint.requiredCapabilities.includes("build") && !entrypoint.steps.some((step) => step.kind === "build") && !entrypoint.blockers.some((blocker) => blocker.code === "missing-build-script")) {
        errors.push(`${entrypoint.id}: build capability has no build step or missing-build-script blocker`);
      }
      for (const step of entrypoint.steps) {
        if (!step.command || !step.cwd || !step.reason) {
          errors.push(`${entrypoint.id}: ${step.kind} step missing command, cwd, or reason`);
        }
      }
    }
  }
  return errors;
}

export async function writeWorkspacePlan(plan, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    json: plan,
    markdown: renderWorkspacePlanMarkdown(plan, options),
    check: options.check,
  });
}

export function renderWorkspacePlanMarkdown(plan, options = {}) {
  return [
    `# ${options.title ?? "Plugin Inspector Isolated Workspace Plan"}`,
    "",
    `Generated: ${plan.generatedAt}`,
    `Mode: ${plan.mode}`,
    `Opt-in: ${plan.optIn.env}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Fixtures", plan.summary.fixtureCount],
        ["Entrypoints", plan.summary.entrypointCount],
        ["Artifact dirs", plan.summary.artifactStepCount],
        ["Install steps", plan.summary.installStepCount],
        ["Audit steps", plan.summary.auditStepCount],
        ["Prune dev workspace dependency steps", plan.summary.pruneDevWorkspaceDependencyStepCount],
        ["Build steps", plan.summary.buildStepCount],
        ["Capture steps", plan.summary.captureStepCount],
        ["Synthetic probe steps", plan.summary.syntheticProbeStepCount],
        ["Target OpenClaw link steps", plan.summary.targetOpenClawLinkStepCount],
        ["TypeScript loader entrypoints", plan.summary.tsLoaderEntrypointCount],
        ["Jiti fallback candidates", plan.summary.jitiAlternativeCount],
        ["Missing build scripts", plan.summary.missingBuildScriptCount],
        ["SDK alias required", plan.summary.sdkAliasRequiredCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Entrypoint Workspaces",
    "",
    markdownTable(
      plan.fixtures.flatMap((fixture) =>
        fixture.entrypoints.map((entrypoint) => [
          fixture.id,
          entrypoint.packageManager,
          entrypoint.status,
          `${entrypoint.loaderStrategy.primary}${entrypoint.loaderStrategy.alternatives.length > 0 ? ` (+${entrypoint.loaderStrategy.alternatives.join(", ")})` : ""}`,
          entrypoint.entrypoint,
          entrypoint.requiredCapabilities.join(", "),
          entrypoint.steps
            .map((step) => `${step.kind}: ${step.command}${step.artifactPath ? ` -> ${step.artifactPath}` : ""}`)
            .join("; "),
        ]),
      ),
      ["Fixture", "PM", "Status", "Loader", "Entrypoint", "Capabilities", "Steps"],
    ),
  ].join("\n");
}

async function buildEntrypointPlan({ fixtureId, entrypoint, packageSummary, packageJson, settings, targetOpenClawPath }) {
  const packagePath = normalizeRepoPath(packageSummary.path);
  const packageDir = path.posix.dirname(packagePath);
  const packageManager = detectPackageManager(settings.rootDir, packageDir, packageJson);
  const lockfile = findNearestLockfile(settings.rootDir, packageDir);
  const buildScript = packageJson.scripts?.build;
  const requiredCapabilities = requiredCapabilitiesFor(entrypoint, packageSummary);
  const loaderStrategy = loaderStrategyFor(entrypoint);
  const blockers = [...entrypoint.blockers];
  const workspacePath = posixJoin(settings.workspaceRoot, fixtureId);
  const resultPath = posixJoin(settings.resultsRoot, fixtureId);
  const steps = [];

  steps.push({
    kind: "prepare",
    command: `mkdir -p ${workspacePath} && rsync -a --delete ${packageDir}/ ${workspacePath}/`,
    cwd: repoRelative("."),
    reason: "copy fixture package into an isolated mutable workspace",
  });
  steps.push({
    kind: "prepare-artifacts",
    command: `mkdir -p ${resultPath}`,
    cwd: repoRelative("."),
    reason: "create a stable result directory for capture and synthetic probe artifacts",
  });

  if (requiredCapabilities.includes("target-openclaw-link")) {
    steps.push({
      kind: "link-openclaw",
      command: `${packageManager} pkg set dependencies.openclaw="file:${targetOpenClawWorkspacePath(settings, fixtureId, targetOpenClawPath)}"`,
      cwd: workspacePath,
      reason: "link the plugin's openclaw peer dependency to the target checkout under test",
    });
  }

  if (requiredCapabilities.includes("dependency-install")) {
    if (hasWorkspaceProtocolDevDependencies(packageJson)) {
      steps.push({
        kind: "prune-dev-workspace-deps",
        command: `node ${helperScript(settings, workspacePath, settings.pruneWorkspaceDevDepsScript, "prune-workspace-dev-deps-cli.js")}`,
        cwd: workspacePath,
        reason: "remove workspace: devDependencies from the isolated runtime install; the mock SDK supplies OpenClaw host imports",
      });
    }
    steps.push({
      kind: "install",
      command: installCommand(packageManager),
      cwd: workspacePath,
      reason: "install runtime dependencies without mutating the pinned submodule",
    });
    steps.push({
      kind: "audit",
      command: auditCommand(settings, packageManager, fixtureId, workspacePath),
      cwd: workspacePath,
      artifactPath: auditArtifactPath(settings, fixtureId),
      reason: "capture package-manager dependency audit metadata as warning-only plugin upstream risk",
    });
  }

  if (requiredCapabilities.includes("build")) {
    if (buildScript) {
      steps.push({
        kind: "build",
        command: runCommand(packageManager, "build"),
        cwd: workspacePath,
        reason: "produce missing OpenClaw build entrypoint",
      });
    } else {
      blockers.push({
        code: "missing-build-script",
        message: "entrypoint points at build output but package.json has no build script",
        evidence: packagePath,
      });
    }
  }

  steps.push({
    kind: "capture",
    command: captureCommand(settings, fixtureId, entrypoint, workspacePath),
    cwd: workspacePath,
    artifactPath: artifactPath(settings, fixtureId, entrypoint, "capture"),
    reason: "cold import the entrypoint against the capture shim",
  });
  steps.push({
    kind: "synthetic-probe",
    command: syntheticProbeCommand(settings, fixtureId, entrypoint, workspacePath),
    cwd: workspacePath,
    artifactPath: artifactPath(settings, fixtureId, entrypoint, "synthetic"),
    reason: "invoke retained hook and registration handlers with synthetic payloads",
  });

  return {
    id: entrypoint.id,
    fixture: fixtureId,
    packagePath,
    packageName: packageSummary.name,
    entrypoint: entrypoint.path,
    status: entrypoint.status,
    packageManager,
    lockfile,
    loaderStrategy,
    requiredCapabilities,
    blockers,
    steps,
  };
}

function workspaceSettings(options) {
  return {
    captureScript: options.captureScript ?? defaultWorkspacePlanOptions.captureScript,
    defaultTargetOpenClawWorkspacePath: options.defaultTargetOpenClawWorkspacePath ?? "../../../openclaw",
    optInEnv: options.optInEnv ?? defaultWorkspacePlanOptions.optInEnv,
    resultsRoot: repoRelative(options.resultsRoot ?? defaultWorkspacePlanOptions.resultsRoot),
    rootDir: path.resolve(options.rootDir ?? process.cwd()),
    syntheticProbeScript: options.syntheticProbeScript ?? defaultWorkspacePlanOptions.syntheticProbeScript,
    pruneWorkspaceDevDepsScript: options.pruneWorkspaceDevDepsScript,
    workspaceRoot: repoRelative(options.workspaceRoot ?? defaultWorkspacePlanOptions.workspaceRoot),
  };
}

function loaderStrategyFor(entrypoint) {
  const needsTypeScriptLoader = entrypoint.blockers.some((blocker) => blocker.code === "ts-loader-required");
  if (!needsTypeScriptLoader) {
    return {
      source: "native-node",
      primary: "node",
      alternatives: [],
      reason: "entrypoint extension can be loaded by Node without a TypeScript source loader",
    };
  }

  return {
    source: "typescript-source",
    primary: "tsx",
    alternatives: ["jiti"],
    reason: "TypeScript entrypoints are currently planned with tsx and tracked with a Jiti-compatible fallback for OpenClaw loader parity.",
  };
}

function requiredCapabilitiesFor(entrypoint, packageSummary = {}) {
  const capabilities = new Set();
  for (const blocker of entrypoint.blockers) {
    if (blocker.code === "dependency-install-required") {
      capabilities.add("dependency-install");
    }
    if (blocker.code === "build-required") {
      capabilities.add("build");
    }
    if (blocker.code === "ts-loader-required") {
      capabilities.add("ts-loader");
    }
    if (blocker.code === "sdk-alias-required") {
      capabilities.add("sdk-alias-compat");
    }
    if (blocker.code === "top-level-side-effect-review") {
      capabilities.add("side-effect-sandbox");
    }
  }
  if (hasHostLinkedOpenClawDependency(packageSummary)) {
    capabilities.add("target-openclaw-link");
  }
  capabilities.add("capture-shim");
  capabilities.add("synthetic-probes");
  return [...capabilities].sort();
}

function hasHostLinkedOpenClawDependency(packageSummary) {
  return [
    ...(packageSummary.dependencies ?? []),
    ...(packageSummary.peerDependencies ?? []),
    ...(packageSummary.optionalDependencies ?? []),
  ].includes("openclaw");
}

function hasWorkspaceProtocolDevDependencies(packageJson) {
  return Object.values(packageJson.devDependencies ?? {}).some(
    (value) => typeof value === "string" && value.startsWith("workspace:"),
  );
}

function detectPackageManager(rootDir, packageDir, packageJson) {
  const declared = typeof packageJson.packageManager === "string" ? packageJson.packageManager.split("@")[0] : null;
  if (declared) {
    return declared;
  }
  const lockfile = findNearestLockfile(rootDir, packageDir);
  if (lockfile?.endsWith("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (lockfile?.endsWith("yarn.lock")) {
    return "yarn";
  }
  if (lockfile?.endsWith("bun.lock") || lockfile?.endsWith("bun.lockb")) {
    return "bun";
  }
  return "npm";
}

function findNearestLockfile(rootDir, packageDir) {
  const candidates = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"];
  let current = path.resolve(rootDir, packageDir);
  while (isWithinPath(rootDir, current)) {
    for (const candidate of candidates) {
      const lockfile = path.join(current, candidate);
      if (existsSync(lockfile)) {
        return repoRelative(path.relative(rootDir, lockfile));
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function isWithinPath(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readPackageJson(rootDir, packagePath) {
  return JSON.parse(await readFile(path.join(rootDir, ...normalizeRepoPath(packagePath).split("/")), "utf8"));
}

function installCommand(packageManager) {
  const commands = {
    bun: "bun install --ignore-scripts",
    npm: "npm install --ignore-scripts",
    pnpm: "pnpm install --ignore-scripts",
    yarn: "yarn install --ignore-scripts",
  };
  return commands[packageManager] ?? `${packageManager} install --ignore-scripts`;
}

function auditCommand(settings, packageManager, fixtureId, workspacePath) {
  const output = workspaceRelativeArtifactPath(settings, fixtureId, workspacePath, "package-audit.json");
  if (packageManager === "npm") {
    return `npm audit --json > ${output} || true`;
  }
  if (packageManager === "pnpm") {
    return `pnpm audit --json > ${output} || true`;
  }
  if (packageManager === "yarn") {
    return `yarn npm audit --json > ${output} || true`;
  }
  if (packageManager === "bun") {
    return `bun audit --json > ${output} || true`;
  }
  return `${packageManager} audit --json > ${output} || true`;
}

function runCommand(packageManager, script) {
  if (packageManager === "npm") {
    return `npm run ${script}`;
  }
  return `${packageManager} run ${script}`;
}

function captureCommand(settings, fixtureId, entrypoint, workspacePath) {
  const script = helperScript(settings, workspacePath, settings.captureScript, "capture-cli.js");
  return `${settings.optInEnv} node ${script} ${entrypoint.specifier} --mock-sdk --output ${workspaceArtifactPath(settings, fixtureId, entrypoint, workspacePath, "capture")}`;
}

function syntheticProbeCommand(settings, fixtureId, entrypoint, workspacePath) {
  const script = helperScript(settings, workspacePath, settings.syntheticProbeScript, "synthetic-probes-cli.js");
  return `${settings.optInEnv} node ${script} --entrypoint ${entrypoint.specifier} --mock-sdk --output ${workspaceArtifactPath(settings, fixtureId, entrypoint, workspacePath, "synthetic")}`;
}

function helperScript(settings, workspacePath, configuredScript, helperFileName) {
  if (configuredScript) {
    return configuredScript;
  }
  const helperPath = fileURLToPath(new URL(`./${helperFileName}`, import.meta.url));
  const workspaceFsPath = path.join(settings.rootDir, workspacePath);
  return repoRelative(path.relative(workspaceFsPath, helperPath));
}

function targetOpenClawWorkspacePath(settings, fixtureId, targetOpenClawPath) {
  if (!targetOpenClawPath) {
    return settings.defaultTargetOpenClawWorkspacePath;
  }
  const workspacePath = path.join(settings.rootDir, settings.workspaceRoot, fixtureId);
  return repoRelative(path.relative(workspacePath, path.resolve(settings.rootDir, targetOpenClawPath)));
}

function repoRelative(value) {
  return String(value).replaceAll(path.sep, "/");
}

function artifactPath(settings, fixtureId, entrypoint, kind) {
  return posixJoin(settings.resultsRoot, fixtureId, `${slugForArtifact(entrypoint.id)}.${kind}.json`);
}

function workspaceArtifactPath(settings, fixtureId, entrypoint, workspacePath, kind) {
  return workspaceRelativeArtifactPath(
    settings,
    fixtureId,
    workspacePath,
    `${slugForArtifact(entrypoint.id)}.${kind}.json`,
  );
}

function workspaceRelativeArtifactPath(settings, fixtureId, workspacePath, fileName) {
  return repoRelative(path.posix.relative(workspacePath, posixJoin(settings.resultsRoot, fixtureId, fileName)));
}

function auditArtifactPath(settings, fixtureId) {
  return posixJoin(settings.resultsRoot, fixtureId, "package-audit.json");
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
