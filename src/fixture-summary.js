import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./json-file.js";

export async function buildCompatibilityFixtureReport({ fixture, inspection, checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const pluginManifests = await readPluginManifests({ checkoutPath, sourceRoot, rootDir });
  const packageSummaries = await readPackageSummaries({ checkoutPath, sourceRoot, rootDir });
  const packageJson = selectPrimaryPackage(packageSummaries);
  const sdkImports = unique((inspection.sdkImports ?? []).map((sdkImport) => sdkImport.specifier));

  return {
    id: fixture.id,
    name: fixture.name,
    priority: fixture.priority,
    seams: fixture.seams,
    why: fixture.why,
    status: inspection.status,
    hooks: inspection.hooks,
    hookDetails: inspection.hookDetails ?? [],
    registrations: inspection.registrations,
    registrationDetails: inspection.registrationDetails ?? [],
    manifestContracts: inspection.manifestContracts,
    manifestFiles: inspection.manifestFiles ?? [],
    sourceFiles: inspection.sourceFiles ?? [],
    pluginManifests,
    package: packageJson,
    packages: packageSummaries,
    sdkImports,
    sdkImportDetails: inspection.sdkImports ?? [],
  };
}

export async function readPluginManifests({ checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const candidates = unique(
    [path.join(sourceRoot, "openclaw.plugin.json"), path.join(checkoutPath, "openclaw.plugin.json")].filter(
      existsSync,
    ),
  );
  const manifests = [];

  for (const manifestPath of candidates) {
    const manifest = await readJsonFile(manifestPath);
    manifests.push({
      path: path.relative(rootDir, manifestPath),
      id: manifest.id ?? null,
      name: manifest.name ?? null,
      version: manifest.version ?? null,
      keys: Object.keys(manifest).sort(),
      contracts: Object.keys(manifest.contracts ?? {}).sort(),
      providerAuthEnvVars: manifest.providerAuthEnvVars ?? {},
      channelEnvVars: manifest.channelEnvVars ?? {},
      activation: manifest.activation ?? null,
    });
  }

  return manifests;
}

export async function readPackageSummaries({ checkoutPath, sourceRoot, rootDir = process.cwd(), maxDepth = 3 }) {
  const candidates = unique([
    path.join(sourceRoot, "package.json"),
    path.join(checkoutPath, "package.json"),
    ...(await findPackageFiles(checkoutPath, { maxDepth })),
  ].filter(existsSync));
  const summaries = [];

  for (const packagePath of candidates) {
    const packageJson = await readJsonFile(packagePath);
    summaries.push(summarizePackage(packagePath, packageJson, { rootDir }));
  }

  return summaries.sort((left, right) => packageRank(left) - packageRank(right) || left.path.localeCompare(right.path));
}

export function summarizePackage(packagePath, packageJson, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const packageDir = path.dirname(packagePath);
  const openclaw = packageJson.openclaw
    ? {
        extensions: arrayValues(packageJson.openclaw.extensions),
        runtimeExtensions: arrayValues(packageJson.openclaw.runtimeExtensions),
        setupEntry: typeof packageJson.openclaw.setupEntry === "string" ? packageJson.openclaw.setupEntry : null,
        compatPluginApi:
          typeof packageJson.openclaw.compat?.pluginApi === "string" ? packageJson.openclaw.compat.pluginApi : null,
        buildOpenClawVersion:
          typeof packageJson.openclaw.build?.openclawVersion === "string"
            ? packageJson.openclaw.build.openclawVersion
            : null,
        buildPluginSdkVersion:
          typeof packageJson.openclaw.build?.pluginSdkVersion === "string"
            ? packageJson.openclaw.build.pluginSdkVersion
            : null,
      }
    : null;

  if (openclaw) {
    openclaw.entrypoints = collectOpenClawEntrypoints(packageDir, openclaw, { rootDir });
  }

  return {
    path: path.relative(rootDir, packagePath),
    name: packageJson.name ?? null,
    version: packageJson.version ?? null,
    type: packageJson.type ?? null,
    main: typeof packageJson.main === "string" ? packageJson.main : null,
    dependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
    peerDependencies: Object.keys(packageJson.peerDependencies ?? {}).sort(),
    optionalDependencies: Object.keys(packageJson.optionalDependencies ?? {}).sort(),
    openclaw,
  };
}

export function classifyPackageContracts({ fixture, inspection, fixtureReport }) {
  const warnings = [];
  const suggestions = [];
  const logs = [];
  const decisions = [];
  const packageSummary = fixtureReport.package;
  if (!packageSummary) {
    warnings.push({
      fixture: fixture.id,
      code: "package-json-missing",
      level: "warning",
      message: "fixture has no package.json to describe install and plugin entrypoint metadata",
      evidence: [fixture.path],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to publish package metadata before treating install/cold-import checks as covered.",
      evidence: fixture.path,
    });
    return { warnings, suggestions, logs, decisions };
  }

  logs.push({
    fixture: fixture.id,
    code: "package-metadata",
    level: "log",
    message: "selected package metadata for plugin contract checks",
    evidence: [
      packageSummary.path,
      packageSummary.name ?? "unnamed",
      packageSummary.version ? `version:${packageSummary.version}` : "version:missing",
    ],
  });

  const manifestVersions = fixtureReport.pluginManifests
    .map((manifest) => manifest.version)
    .filter((version) => typeof version === "string" && version.length > 0);
  const mismatchedManifestVersions = manifestVersions.filter((version) => version !== packageSummary.version);
  if (packageSummary.version && mismatchedManifestVersions.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "package-manifest-version-drift",
      level: "warning",
      message: "package.json and openclaw.plugin.json publish different versions",
      evidence: [`package:${packageSummary.version}`, ...mismatchedManifestVersions.map((version) => `manifest:${version}`)],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to keep package and manifest versions aligned before relying on release compatibility signals.",
      evidence: `${packageSummary.version} != ${mismatchedManifestVersions.join(", ")}`,
    });
  }

  if (packageSummary.openclaw && !packageSummary.openclaw.compatPluginApi) {
    warnings.push({
      fixture: fixture.id,
      code: "package-plugin-api-compat-missing",
      level: "warning",
      message: "package openclaw metadata does not declare compat.pluginApi",
      evidence: [packageSummary.path],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to declare the plugin API range it was built against.",
      evidence: packageSummary.path,
    });
  }

  if (packageSummary.openclaw && packageSummary.openclaw.entrypoints.length === 0) {
    warnings.push({
      fixture: fixture.id,
      code: "package-openclaw-entry-missing",
      level: "warning",
      message: "package openclaw metadata does not declare plugin entrypoints",
      evidence: [packageSummary.path],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-entrypoint",
      action: "Ask the plugin to declare openclaw.extensions or runtimeExtensions so cold import can target the correct entrypoint.",
      evidence: packageSummary.path,
    });
  }

  const missingEntrypoints = packageSummary.openclaw?.entrypoints.filter((entrypoint) => !entrypoint.exists) ?? [];
  const buildEntrypoints = missingEntrypoints.filter((entrypoint) => entrypoint.requiresBuild);
  const plainMissingEntrypoints = missingEntrypoints.filter((entrypoint) => !entrypoint.requiresBuild);

  if (buildEntrypoints.length > 0) {
    suggestions.push({
      fixture: fixture.id,
      code: "package-build-artifact-entrypoint",
      level: "suggestion",
      message: "package OpenClaw entrypoint points at build output that is not present in the source fixture checkout",
      evidence: buildEntrypoints.map((entrypoint) => `${entrypoint.kind}:${entrypoint.specifier} -> ${entrypoint.relativePath}`),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "cold-import",
      action: "Run the plugin build or resolve source entrypoint aliases before cold-importing this fixture.",
      evidence: buildEntrypoints.map((entrypoint) => entrypoint.specifier).join(", "),
    });
  }

  if (plainMissingEntrypoints.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "package-entrypoint-missing",
      level: "warning",
      message: "package OpenClaw entrypoint does not exist in the fixture checkout",
      evidence: plainMissingEntrypoints.map((entrypoint) => `${entrypoint.kind}:${entrypoint.specifier} -> ${entrypoint.relativePath}`),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-entrypoint",
      action: "Ask the plugin to publish a valid OpenClaw entrypoint or update package metadata.",
      evidence: plainMissingEntrypoints.map((entrypoint) => entrypoint.specifier).join(", "),
    });
  }

  const sourceEntrypoints =
    packageSummary.openclaw?.entrypoints.filter((entrypoint) => entrypoint.exists && entrypoint.relativePath.endsWith(".ts")) ?? [];
  if (sourceEntrypoints.length > 0) {
    suggestions.push({
      fixture: fixture.id,
      code: "package-typescript-source-entrypoint",
      level: "suggestion",
      message: "package OpenClaw entrypoint resolves to TypeScript source in this fixture checkout",
      evidence: sourceEntrypoints.map((entrypoint) => `${entrypoint.kind}:${entrypoint.relativePath}`),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "cold-import",
      action: "Compile TypeScript source or run a loader before cold-importing this fixture entrypoint.",
      evidence: sourceEntrypoints.map((entrypoint) => entrypoint.relativePath).join(", "),
    });
  }

  const runtimeDependencies = unique([
    ...packageSummary.dependencies,
    ...packageSummary.peerDependencies,
    ...packageSummary.optionalDependencies,
  ]);
  if (packageSummary.openclaw?.entrypoints.length > 0 && runtimeDependencies.length > 0) {
    suggestions.push({
      fixture: fixture.id,
      code: "package-dependency-install-required",
      level: "suggestion",
      message: "package declares runtime dependencies that must be installed before cold import",
      evidence: runtimeDependencies.map((dependency) => `${dependency} @ ${packageSummary.path}`),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "cold-import",
      action: "Install runtime dependencies in an isolated workspace before executing this fixture entrypoint.",
      evidence: runtimeDependencies.join(", "),
    });
  }

  if (inspection.registrations.length > 0 && !packageSummary.openclaw) {
    warnings.push({
      fixture: fixture.id,
      code: "package-openclaw-metadata-missing",
      level: "warning",
      message: "fixture registers plugin APIs but the selected package.json has no openclaw metadata",
      evidence: [packageSummary.path, ...inspection.registrations],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to declare OpenClaw install and entrypoint metadata in package.json.",
      evidence: packageSummary.path,
    });
  }

  return { warnings, suggestions, logs, decisions };
}

export function classifyTargetOpenClawCoverage({ fixture, inspection, fixtureReport, targetOpenClaw }) {
  const warnings = [];
  const logs = [];
  const decisions = [];

  classifyHookNameCoverage({ fixture, inspection, targetOpenClaw, warnings, logs });
  classifyRegistrationNameCoverage({ fixture, inspection, targetOpenClaw, warnings, logs });
  classifySdkImportCoverage({ fixture, fixtureReport, targetOpenClaw, warnings, logs, decisions });
  classifyManifestFieldCoverage({ fixture, fixtureReport, targetOpenClaw, warnings, logs, decisions });

  return { warnings, logs, decisions };
}

function classifyHookNameCoverage({ fixture, inspection, targetOpenClaw, warnings, logs }) {
  if (targetOpenClaw.status !== "ok" || targetOpenClaw.hookNames.length === 0) {
    return;
  }

  const knownHookNames = new Set(targetOpenClaw.hookNames);
  const unknownHooks = inspection.hookDetails.filter((hook) => !knownHookNames.has(hook.name));
  if (unknownHooks.length === 0) {
    logs.push({
      fixture: fixture.id,
      code: "hook-names-present",
      level: "log",
      message: "all observed hooks exist in the target OpenClaw hook registry",
      evidence: inspection.hooks,
    });
    return;
  }

  warnings.push({
    fixture: fixture.id,
    code: "unknown-hook-name",
    level: "warning",
    message: "fixture registers hooks that are not present in the target OpenClaw hook registry",
    evidence: detailEvidence(unknownHooks),
  });
}

function classifyRegistrationNameCoverage({ fixture, inspection, targetOpenClaw, warnings, logs }) {
  if (targetOpenClaw.status !== "ok" || targetOpenClaw.apiRegistrars.length === 0) {
    return;
  }

  const knownRegistrars = new Set(targetOpenClaw.apiRegistrars);
  const apiRegistrations = inspection.registrationDetails.filter((registration) =>
    registration.name.startsWith("register"),
  );
  const unknownRegistrations = apiRegistrations.filter((registration) => !knownRegistrars.has(registration.name));
  if (unknownRegistrations.length === 0) {
    logs.push({
      fixture: fixture.id,
      code: "api-registrars-present",
      level: "log",
      message: "all observed api.register* calls exist in the target OpenClaw plugin API builder",
      evidence: unique(apiRegistrations.map((registration) => registration.name)).sort(),
    });
    return;
  }

  warnings.push({
    fixture: fixture.id,
    code: "unknown-registration-name",
    level: "warning",
    message: "fixture calls api.register* methods that are not present in the target OpenClaw plugin API builder",
    evidence: detailEvidence(unknownRegistrations),
  });
}

function classifySdkImportCoverage({ fixture, fixtureReport, targetOpenClaw, warnings, logs, decisions }) {
  if (targetOpenClaw.status !== "ok" || targetOpenClaw.sdkExports.length === 0 || fixtureReport.sdkImports.length === 0) {
    return;
  }

  const sdkExports = new Set(targetOpenClaw.sdkExports);
  const unknownImports = fixtureReport.sdkImportDetails.filter((sdkImport) => !sdkExports.has(sdkImport.specifier));
  if (unknownImports.length === 0) {
    logs.push({
      fixture: fixture.id,
      code: "sdk-exports-present",
      level: "log",
      message: "all observed plugin SDK imports exist in target OpenClaw package exports",
      evidence: fixtureReport.sdkImports,
    });
    return;
  }

  warnings.push({
    fixture: fixture.id,
    code: "sdk-export-missing",
    level: "warning",
    message: "fixture imports plugin SDK aliases that are not exported by the target OpenClaw package",
    evidence: detailEvidence(unknownImports, "specifier"),
    compatRecord: "plugin-sdk-export-aliases",
  });
  decisions.push({
    fixture: fixture.id,
    decision: "core-compat-adapter",
    seam: "sdk-alias",
    action: "Restore the package export alias or publish a versioned migration map before cold-importing old plugins.",
    evidence: unique(unknownImports.map((sdkImport) => sdkImport.specifier)).join(", "),
  });
}

function classifyManifestFieldCoverage({ fixture, fixtureReport, targetOpenClaw, warnings, logs, decisions }) {
  if (targetOpenClaw.status !== "ok" || targetOpenClaw.manifestFields.length === 0) {
    return;
  }

  const manifestFields = new Set(targetOpenClaw.manifestFields);
  const contractFields = new Set(targetOpenClaw.manifestContractFields);
  for (const pluginManifest of fixtureReport.pluginManifests) {
    const unknownFields = pluginManifest.keys.filter((key) => !manifestFields.has(key));
    if (unknownFields.length > 0) {
      warnings.push({
        fixture: fixture.id,
        code: "manifest-unknown-fields",
        level: "warning",
        message: "manifest uses top-level fields that are not present in the target OpenClaw PluginManifest type",
        evidence: unknownFields.map((field) => `${field} @ ${pluginManifest.path}`),
      });
      decisions.push({
        fixture: fixture.id,
        decision: "plugin-upstream-fix",
        seam: "manifest-schema",
        action: "Move unknown manifest metadata into supported package openclaw metadata or add a versioned OpenClaw manifest field.",
        evidence: unknownFields.join(", "),
      });
    }

    const unknownContractFields = pluginManifest.contracts.filter((field) => !contractFields.has(field));
    if (unknownContractFields.length > 0) {
      warnings.push({
        fixture: fixture.id,
        code: "manifest-unknown-contracts",
        level: "warning",
        message: "manifest declares contract keys that are not present in the target OpenClaw PluginManifestContracts type",
        evidence: unknownContractFields.map((field) => `${field} @ ${pluginManifest.path}`),
      });
      decisions.push({
        fixture: fixture.id,
        decision: "plugin-upstream-fix",
        seam: "manifest-contract",
        action: "Use a supported manifest contract key or add a versioned OpenClaw contract field.",
        evidence: unknownContractFields.join(", "),
      });
    }
  }

  if (fixtureReport.pluginManifests.length > 0) {
    logs.push({
      fixture: fixture.id,
      code: "manifest-fields-checked",
      level: "log",
      message: "plugin manifest fields were compared with target OpenClaw manifest types",
      evidence: fixtureReport.pluginManifests.map((manifest) => manifest.path),
    });
  }
}

function collectOpenClawEntrypoints(packageDir, openclaw, options) {
  const entrypoints = [
    ...openclaw.extensions.map((specifier) => ({ kind: "extension", specifier })),
    ...openclaw.runtimeExtensions.map((specifier) => ({ kind: "runtimeExtension", specifier })),
    ...(openclaw.setupEntry ? [{ kind: "setupEntry", specifier: openclaw.setupEntry }] : []),
  ];

  return entrypoints.map((entrypoint) => {
    const resolvedPath = path.resolve(packageDir, entrypoint.specifier);
    const relativePath = path.relative(options.rootDir, resolvedPath);
    return {
      ...entrypoint,
      relativePath,
      exists: existsSync(resolvedPath),
      requiresBuild: /(^|\/)dist\//.test(entrypoint.specifier) || /(^|\/)build\//.test(entrypoint.specifier),
    };
  });
}

async function findPackageFiles(root, options, depth = 0) {
  if (!existsSync(root) || depth > options.maxDepth) {
    return [];
  }

  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === "package.json") {
      files.push(entryPath);
      continue;
    }
    if (!entry.isDirectory() || shouldSkipPackageDir(entry.name)) {
      continue;
    }
    files.push(...(await findPackageFiles(entryPath, options, depth + 1)));
  }
  return files;
}

function shouldSkipPackageDir(name) {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "build" || name === "coverage";
}

function selectPrimaryPackage(packages) {
  return packages[0] ?? null;
}

function packageRank(packageSummary) {
  if (packageSummary.openclaw?.entrypoints.length > 0) {
    return 0;
  }
  if (packageSummary.openclaw) {
    return 1;
  }
  return 2;
}

function arrayValues(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function detailEvidence(details, key = "name") {
  return unique(details.map((detail) => `${detail[key]} @ ${detail.ref}`));
}

function unique(values) {
  return [...new Set(values)];
}
