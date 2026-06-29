import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { compatRecordForIssueCode } from "./contract-probes.js";
import { readJsonFile } from "./json-file.js";

const conversationAccessHooks = new Set(["agent_end", "llm_input", "llm_output"]);
const captureGapRegistrations = new Set([
  "registerChannel",
  "registerCommand",
  "registerGatewayMethod",
  "registerHttpRoute",
  "registerInteractiveHandler",
  "registerService",
]);
const channelRegistrations = new Set([
  "createChatChannelPlugin",
  "defineChannelPluginEntry",
  "registerChannel",
]);
const hostLinkedRuntimeDependencies = new Set(["openclaw"]);
const unsupportedSecurityManifestName = "openclaw.security.json";
const unavailableSecurityManifestSchema = "https://openclaw.ai/schemas/plugin-security.json";

export async function buildCompatibilityFixtureReport({ fixture, inspection, checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const pluginManifests = await readPluginManifests({ checkoutPath, sourceRoot, rootDir });
  const securityManifests = await readSecurityManifests({ checkoutPath, sourceRoot, rootDir });
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
    securityManifests,
    package: packageJson,
    packages: packageSummaries,
    sdkImports,
    sdkImportDetails: inspection.sdkImports ?? [],
    sdkDeprecations: inspection.sdkDeprecations ?? [],
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

export async function readSecurityManifests({ checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const candidates = unique(
    [
      path.join(sourceRoot, unsupportedSecurityManifestName),
      path.join(checkoutPath, unsupportedSecurityManifestName),
    ].filter(existsSync),
  );
  const manifests = [];

  for (const manifestPath of candidates) {
    const relativePath = path.relative(rootDir, manifestPath);
    try {
      const manifest = await readJsonFile(manifestPath);
      manifests.push({
        path: relativePath,
        schema: typeof manifest.$schema === "string" ? manifest.$schema : null,
        version: typeof manifest.version === "string" ? manifest.version : null,
        plugin: typeof manifest.plugin === "string" ? manifest.plugin : null,
        expectedBehaviorCount: Array.isArray(manifest.expectedBehaviors)
          ? manifest.expectedBehaviors.length
          : 0,
        securityNoteCount: Array.isArray(manifest.securityNotes) ? manifest.securityNotes.length : 0,
        validJson: true,
      });
    } catch {
      manifests.push({
        path: relativePath,
        schema: null,
        version: null,
        plugin: null,
        expectedBehaviorCount: 0,
        securityNoteCount: 0,
        validJson: false,
      });
    }
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
        install: summarizeOpenClawInstall(packageJson.openclaw.install),
        release: summarizeOpenClawRelease(packageJson.openclaw.release),
        unsupportedMetadata: unsupportedOpenClawPackageMetadata(packageJson.openclaw),
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
    npmPack: summarizeNpmPack(packageJson, openclaw),
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

  const missingManifestNames = fixtureReport.pluginManifests.filter(
    (manifest) => typeof manifest.name !== "string" || manifest.name.trim().length === 0,
  );
  if (missingManifestNames.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "manifest-name-missing",
      level: "warning",
      message: "openclaw.plugin.json does not declare a display name",
      evidence: missingManifestNames.map((manifest) => manifest.path ?? "openclaw.plugin.json"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "manifest-metadata",
      action: "Ask the plugin to declare openclaw.plugin.json name so registries and tools can derive a human-readable title.",
      evidence: missingManifestNames.map((manifest) => manifest.path ?? "openclaw.plugin.json").join(", "),
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

  if ((packageSummary.openclaw?.unsupportedMetadata ?? []).length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "package-openclaw-unsupported-metadata",
      level: "warning",
      message: "package declares unsupported OpenClaw metadata",
      evidence: packageSummary.openclaw.unsupportedMetadata,
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Remove unsupported OpenClaw metadata; native plugins use openclaw.plugin.json plus supported package openclaw fields.",
      evidence: packageSummary.openclaw.unsupportedMetadata.join(", "),
    });
  }

  const installMetadataIssues = packageInstallMetadataIssues(packageSummary);
  if (installMetadataIssues.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "package-install-metadata-incomplete",
      level: "warning",
      message: "package OpenClaw install metadata does not match advertised release targets",
      evidence: installMetadataIssues,
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to align openclaw.install metadata with openclaw.release publishing targets.",
      evidence: installMetadataIssues.join(", "),
    });
  }

  if (packageMinHostVersionDrift(packageSummary)) {
    warnings.push({
      fixture: fixture.id,
      code: "package-min-host-version-drift",
      level: "warning",
      message: "package openclaw.install.minHostVersion is not a semver floor for the target OpenClaw build version",
      evidence: [
        `minHostVersion:${packageSummary.openclaw.install.minHostVersion}`,
        `buildOpenClawVersion:${packageSummary.openclaw.buildOpenClawVersion}`,
      ],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-metadata",
      action: "Ask the plugin to publish install.minHostVersion as a semver floor for the OpenClaw package surface it targets.",
      evidence: packageSummary.path,
    });
  }

  const npmPackIssues = packageNpmPackIssues(packageSummary, fixtureReport);
  for (const finding of npmPackIssues) {
    warnings.push({
      fixture: fixture.id,
      code: finding.code,
      level: "warning",
      message: finding.message,
      evidence: finding.evidence,
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "package-artifact",
      action: "Ask the plugin to make its advertised npm install artifact match the published OpenClaw metadata.",
      evidence: finding.evidence.join(", "),
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

  const entrypoints = packageSummary.openclaw?.entrypoints ?? [];
  const missingEntrypoints = entrypoints.filter((entrypoint) => !entrypoint.exists);
  const buildEntrypoints = missingEntrypoints.filter((entrypoint) => entrypoint.requiresBuild);
  const plainMissingEntrypoints = missingEntrypoints.filter(
    (entrypoint) => !entrypoint.requiresBuild && !hasUsablePackageRuntimeEntrypoint(entrypoint, packageSummary, entrypoints),
  );

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
  ]).filter((dependency) => !hostLinkedRuntimeDependencies.has(dependency));
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

export function classifyCompatibilityFixture({ fixture, inspection, fixtureReport, targetOpenClaw }) {
  const warnings = [];
  const suggestions = [];
  const logs = [];
  const decisions = [];

  if (inspection.status !== "ok") {
    return { warnings, suggestions, logs, decisions };
  }

  const targetCoverage = classifyTargetOpenClawCoverage({ fixture, inspection, fixtureReport, targetOpenClaw });
  warnings.push(...targetCoverage.warnings);
  logs.push(...targetCoverage.logs);
  decisions.push(...targetCoverage.decisions);

  const packageContracts = classifyPackageContracts({ fixture, inspection, fixtureReport });
  warnings.push(...packageContracts.warnings);
  suggestions.push(...packageContracts.suggestions);
  logs.push(...packageContracts.logs);
  decisions.push(...packageContracts.decisions);
  classifySecurityManifestCoverage({ fixture, fixtureReport, warnings, decisions });
  classifySdkDeprecations({ fixture, inspection, fixtureReport, warnings, decisions });

  for (const pluginManifest of fixtureReport.pluginManifests) {
    const providerAuthKeys = Object.keys(pluginManifest.providerAuthEnvVars ?? {});
    if (providerAuthKeys.length > 0) {
      warnings.push({
        fixture: fixture.id,
        code: "provider-auth-env-vars",
        level: "warning",
        message: "manifest uses providerAuthEnvVars legacy compatibility metadata",
        evidence: providerAuthKeys,
        compatRecord: "provider-auth-env-vars",
      });
      decisions.push({
        fixture: fixture.id,
        decision: "core-compat-adapter",
        seam: "env-auth",
        action: "Keep providerAuthEnvVars compatibility active while the inspector recommends manifest-schema migration upstream.",
        evidence: providerAuthKeys.join(", "),
      });
    }

    const channelEnvKeys = Object.keys(pluginManifest.channelEnvVars ?? {});
    if (channelEnvKeys.length > 0) {
      warnings.push({
        fixture: fixture.id,
        code: "channel-env-vars",
        level: "warning",
        message: "manifest uses channelEnvVars legacy compatibility metadata",
        evidence: channelEnvKeys,
        compatRecord: "channel-env-vars",
      });
      decisions.push({
        fixture: fixture.id,
        decision: "core-compat-adapter",
        seam: "channel-env",
        action: "Keep channelEnvVars compatibility active until channel setup metadata has a stable replacement path.",
        evidence: channelEnvKeys.join(", "),
      });
    }
  }

  const conversationHooks = inspection.hooks.filter((hook) => conversationAccessHooks.has(hook));
  const conversationHookDetails = inspection.hookDetails.filter((hook) => conversationAccessHooks.has(hook.name));
  if (conversationHooks.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "conversation-access-hook",
      level: "warning",
      message: "fixture observes raw model or conversation content and needs privacy-boundary contract probes",
      evidence: detailEvidence(conversationHookDetails),
      compatRecord: compatRecordForIssueCode("conversation-access-hook"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "conversation-access",
      action: "Add synthetic llm_input/llm_output/agent_end probes before tightening hook payloads or redaction behavior.",
      evidence: conversationHooks.join(", "),
    });
  }

  const rootSdkImports = fixtureReport.sdkImports.filter((specifier) => specifier === "openclaw/plugin-sdk");
  const rootSdkImportDetails = fixtureReport.sdkImportDetails.filter(
    (sdkImport) => sdkImport.specifier === "openclaw/plugin-sdk",
  );
  if (rootSdkImports.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "legacy-root-sdk-import",
      level: "warning",
      message: "fixture imports the root plugin SDK barrel",
      evidence: detailEvidence(rootSdkImportDetails, "specifier"),
      compatRecord: "legacy-root-sdk-import",
    });
    decisions.push({
      fixture: fixture.id,
      decision: "core-compat-adapter",
      seam: "sdk-import",
      action: "Keep the root SDK barrel stable or expose a machine-readable migration map before removing aliases.",
      evidence: unique(rootSdkImports).join(", "),
    });
  }

  const legacyBeforeAgentStartDetails = inspection.hookDetails.filter((hook) => hook.name === "before_agent_start");
  if (legacyBeforeAgentStartDetails.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "legacy-before-agent-start",
      level: "warning",
      message: "fixture uses deprecated before_agent_start hook compatibility",
      evidence: detailEvidence(legacyBeforeAgentStartDetails),
      compatRecord: "legacy-before-agent-start",
    });
    decisions.push({
      fixture: fixture.id,
      decision: "core-compat-adapter",
      seam: "hook-compat",
      action: "Keep before_agent_start wired while plugin authors migrate to before_model_resolve and before_prompt_build.",
      evidence: detailEvidence(legacyBeforeAgentStartDetails).join(", "),
    });
  }

  const captureGapRegistrationDetails = registrationCaptureGapDetails(inspection, targetOpenClaw);
  const captureGapRegistrationNames = unique(captureGapRegistrationDetails.map((registration) => registration.name));
  if (captureGapRegistrationNames.length > 0) {
    suggestions.push({
      fixture: fixture.id,
      code: "registration-capture-gap",
      level: "suggestion",
      message: "future inspector capture API should record lifecycle, route, gateway, command, and interactive registrations",
      evidence: detailEvidence(captureGapRegistrationDetails),
      compatRecord: compatRecordForIssueCode("registration-capture-gap"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "registration-capture",
      action: "Expose or mirror a full public API capture shim before treating these runtime-only seams as covered.",
      evidence: captureGapRegistrationNames.join(", "),
    });
  }

  if (inspection.hooks.includes("before_tool_call")) {
    const hookDetails = inspection.hookDetails.filter((hook) => hook.name === "before_tool_call");
    suggestions.push({
      fixture: fixture.id,
      code: "before-tool-call-probe",
      level: "suggestion",
      message: "add contract probes for before_tool_call terminal, block, and approval semantics",
      evidence: detailEvidence(hookDetails),
      compatRecord: compatRecordForIssueCode("before-tool-call-probe"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "tool-policy",
      action: "Probe before_tool_call return shapes before changing tool-call approval or block behavior.",
      evidence: "before_tool_call",
    });
  }

  const observedChannelRegistrations = inspection.registrations.filter((registration) =>
    channelRegistrations.has(registration),
  );
  const channelRegistrationDetails = inspection.registrationDetails.filter((registration) =>
    channelRegistrations.has(registration.name),
  );
  if (observedChannelRegistrations.length > 0) {
    suggestions.push({
      fixture: fixture.id,
      code: "channel-contract-probe",
      level: "suggestion",
      message: "add channel envelope, config-schema, and runtime metadata probes",
      evidence: detailEvidence(channelRegistrationDetails),
      compatRecord: compatRecordForIssueCode("channel-contract-probe"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "channel-runtime",
      action: "Probe channel setup and message envelope contracts before changing channel runtime payloads.",
      evidence: observedChannelRegistrations.join(", "),
    });
  }

  const runtimeToolOnly = inspection.registrations.includes("registerTool") && !inspection.manifestContracts.includes("tools");
  if (runtimeToolOnly) {
    const toolRegistrationDetails = inspection.registrationDetails.filter(
      (registration) => registration.name === "registerTool",
    );
    suggestions.push({
      fixture: fixture.id,
      code: "runtime-tool-capture",
      level: "suggestion",
      message: "tool shape is only visible after runtime registration capture",
      evidence: detailEvidence(toolRegistrationDetails),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "inspector-follow-up",
      seam: "tool-schema",
      action: "Capture registered tool schemas from plugin register() before judging tool compatibility.",
      evidence: "registerTool without manifest contracts.tools",
    });
  }

  if (inspection.manifestContracts.length > 0) {
    logs.push({
      fixture: fixture.id,
      code: "declarative-contracts",
      level: "log",
      message: "fixture declares manifest contracts that can be checked without executing plugin code",
      evidence: inspection.manifestContracts,
    });
    decisions.push({
      fixture: fixture.id,
      decision: "no-action",
      seam: "manifest-contract",
      action: "Keep checking this declarative contract in default offline CI.",
      evidence: inspection.manifestContracts.join(", "),
    });
  }

  return { warnings, suggestions, logs, decisions };
}

function classifySdkDeprecations({ fixture, inspection, fixtureReport, warnings, decisions }) {
  const grouped = new Map();
  for (const finding of fixtureReport.sdkDeprecations ?? inspection.sdkDeprecations ?? []) {
    const existing = grouped.get(finding.code) ?? [];
    existing.push(finding);
    grouped.set(finding.code, existing);
  }

  for (const [code, findings] of grouped) {
    const first = findings[0];
    warnings.push({
      fixture: fixture.id,
      code,
      level: "warning",
      message: first.message,
      evidence: findings.map((finding) => `${finding.surface} @ ${finding.ref}`),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "core-compat-adapter",
      seam: sdkDeprecationSeamForCode(code),
      action: sdkDeprecationActionForCode(code),
      evidence: findings.map((finding) => finding.ref).join(", "),
    });
  }
}

function sdkDeprecationSeamForCode(code) {
  if (code === "sdk-session-file-helper") {
    return "session-file";
  }
  if (code === "sdk-session-transcript-file-target" || code === "sdk-session-transcript-low-level") {
    return "session-transcript";
  }
  return "session-store";
}

function sdkDeprecationActionForCode(code) {
  if (code === "sdk-session-store-write") {
    return "Keep whole-store session write compatibility active while plugin authors migrate to row-scoped session write helpers.";
  }
  if (code === "sdk-session-file-helper") {
    return "Keep session file-path compatibility active while plugin authors migrate to session entry and transcript identity helpers.";
  }
  if (code === "sdk-session-transcript-file-target") {
    return "Keep legacy transcript file target compatibility active while plugin authors migrate to structured transcript targets.";
  }
  if (code === "sdk-session-transcript-low-level") {
    return "Keep low-level transcript write compatibility active while plugin authors migrate to structured transcript runtime helpers.";
  }
  return "Keep loadSessionStore compatibility active while plugin authors migrate to row-scoped session helpers.";
}

function classifySecurityManifestCoverage({ fixture, fixtureReport, warnings, decisions }) {
  for (const securityManifest of fixtureReport.securityManifests ?? []) {
    warnings.push({
      fixture: fixture.id,
      code: "unrecognized-security-manifest",
      level: "warning",
      message:
        "openclaw.security.json is not a supported OpenClaw or ClawHub security contract and is ignored by install safety checks",
      evidence: [securityManifest.path],
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "security-metadata",
      action:
        "Remove the advisory security manifest or replace it with a supported, versioned OpenClaw/ClawHub security contract once one exists.",
      evidence: securityManifest.path,
    });

    if (securityManifest.schema === unavailableSecurityManifestSchema) {
      warnings.push({
        fixture: fixture.id,
        code: "security-manifest-schema-unavailable",
        level: "warning",
        message: "openclaw.security.json references an OpenClaw schema URL that is not currently published",
        evidence: [`${securityManifest.path}:$schema=${securityManifest.schema}`],
      });
      decisions.push({
        fixture: fixture.id,
        decision: "plugin-upstream-fix",
        seam: "security-metadata",
        action:
          "Do not rely on the schema URL until OpenClaw publishes and documents a real plugin security metadata schema.",
        evidence: securityManifest.schema,
      });
    }
  }
}

function registrationCaptureGapDetails(inspection, targetOpenClaw) {
  const apiRegistrationDetails = inspection.registrationDetails.filter((registration) =>
    registration.name.startsWith("register"),
  );
  if (targetOpenClaw.status === "ok" && targetOpenClaw.capturedRegistrars.length > 0) {
    const captured = new Set(targetOpenClaw.capturedRegistrars);
    return apiRegistrationDetails.filter((registration) => !captured.has(registration.name));
  }
  return apiRegistrationDetails.filter((registration) => captureGapRegistrations.has(registration.name));
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
  const reservedSdkExports = new Set(targetOpenClaw.reservedSdkExports ?? []);
  const reservedImports = fixtureReport.sdkImportDetails.filter((sdkImport) =>
    reservedSdkExports.has(sdkImport.specifier),
  );

  if (reservedImports.length === 0 && unknownImports.length === 0) {
    logs.push({
      fixture: fixture.id,
      code: "sdk-exports-present",
      level: "log",
      message: "all observed plugin SDK imports exist in target OpenClaw package exports",
      evidence: fixtureReport.sdkImports,
    });
    return;
  }

  if (unknownImports.length > 0) {
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

  if (reservedImports.length > 0) {
    warnings.push({
      fixture: fixture.id,
      code: "reserved-sdk-import",
      level: "warning",
      message: "fixture imports reserved bundled-plugin SDK compatibility subpaths",
      evidence: detailEvidence(reservedImports, "specifier"),
    });
    decisions.push({
      fixture: fixture.id,
      decision: "plugin-upstream-fix",
      seam: "sdk-import",
      action: "Move the plugin to documented public SDK subpaths or plugin-local helpers before relying on this compatibility shim.",
      evidence: unique(reservedImports.map((sdkImport) => sdkImport.specifier)).join(", "),
    });
  }
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

function hasUsablePackageRuntimeEntrypoint(entrypoint, packageSummary, entrypoints) {
  if (!isSourceEntrypoint(entrypoint.specifier)) {
    return false;
  }

  const runtimeBuildSpecifier = runtimeBuildSpecifierFor(entrypoint.specifier);
  if (
    entrypoints.some(
      (candidate) =>
        candidate.exists &&
        candidate.requiresBuild &&
        normalizeEntrypointSpecifier(candidate.specifier) === normalizeEntrypointSpecifier(runtimeBuildSpecifier),
    )
  ) {
    return true;
  }

  if (entrypoint.kind === "extension" && entrypoints.some((candidate) => candidate.kind === "runtimeExtension" && candidate.exists)) {
    return true;
  }

  const packageDir = path.dirname(packageSummary.path);
  return existsSync(path.resolve(packageDir, runtimeBuildSpecifier));
}

function isSourceEntrypoint(specifier) {
  return /\.(?:ts|tsx)$/.test(specifier);
}

function runtimeBuildSpecifierFor(specifier) {
  const normalized = normalizeEntrypointSpecifier(specifier);
  const basename = path.posix.basename(normalized).replace(/\.(?:ts|tsx)$/, ".js");
  return `./dist/${basename}`;
}

function normalizeEntrypointSpecifier(specifier) {
  const normalized = specifier.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized : `./${normalized}`;
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

function summarizeOpenClawInstall(install) {
  if (!install || typeof install !== "object") {
    return null;
  }
  return {
    clawhubSpec: stringOrNull(install.clawhubSpec),
    npmSpec: stringOrNull(install.npmSpec),
    defaultChoice: stringOrNull(install.defaultChoice),
    minHostVersion: stringOrNull(install.minHostVersion),
  };
}

function summarizeOpenClawRelease(release) {
  if (!release || typeof release !== "object") {
    return null;
  }
  return {
    publishToClawHub: booleanOrNull(release.publishToClawHub),
    publishToNpm: booleanOrNull(release.publishToNpm),
  };
}

function unsupportedOpenClawPackageMetadata(openclaw) {
  if (!openclaw || typeof openclaw !== "object") {
    return [];
  }
  return Object.keys(openclaw)
    .filter((key) => key === "bundle")
    .map((key) => `openclaw.${key}`);
}

function summarizeNpmPack(packageJson, openclaw) {
  const files = arrayValues(packageJson.files).map(normalizePackagePath).filter((item) => item.length > 0);
  return {
    advertised: openclaw?.release?.publishToNpm === true || nonEmptyString(openclaw?.install?.npmSpec),
    private: packageJson.private === true,
    filesMode: files.length > 0 ? "allowlist" : "implicit",
    files,
    invalidFileSpecs: files.filter((item) => invalidPackageFileSpec(item)),
  };
}

function packageInstallMetadataIssues(packageSummary) {
  const openclaw = packageSummary.openclaw;
  if (!openclaw) {
    return [];
  }

  const issues = [];
  const install = openclaw.install;
  const release = openclaw.release;
  const publishToClawHub = release?.publishToClawHub === true;
  const publishToNpm = release?.publishToNpm === true;

  if (publishToClawHub && !nonEmptyString(install?.clawhubSpec)) {
    issues.push("openclaw.release.publishToClawHub requires openclaw.install.clawhubSpec");
  }
  if (publishToNpm && !nonEmptyString(install?.npmSpec)) {
    issues.push("openclaw.release.publishToNpm requires openclaw.install.npmSpec");
  }
  if (publishToNpm && nonEmptyString(install?.npmSpec) && nonEmptyString(packageSummary.name) && install.npmSpec !== packageSummary.name) {
    issues.push(`openclaw.install.npmSpec:${install.npmSpec} does not match package name:${packageSummary.name}`);
  }
  if (nonEmptyString(install?.defaultChoice) && !["clawhub", "npm"].includes(install.defaultChoice)) {
    issues.push(`openclaw.install.defaultChoice:${install.defaultChoice} must be clawhub or npm`);
  }
  if (install?.defaultChoice === "clawhub" && !nonEmptyString(install.clawhubSpec)) {
    issues.push("openclaw.install.defaultChoice clawhub requires openclaw.install.clawhubSpec");
  }
  if (install?.defaultChoice === "npm" && !nonEmptyString(install.npmSpec)) {
    issues.push("openclaw.install.defaultChoice npm requires openclaw.install.npmSpec");
  }

  return issues;
}

function packageNpmPackIssues(packageSummary, fixtureReport) {
  if (!packageSummary.npmPack?.advertised) {
    return [];
  }

  const findings = [];
  const unavailable = [];
  if (packageSummary.npmPack.private) {
    unavailable.push("package.json private:true");
  }
  if (!nonEmptyString(packageSummary.name)) {
    unavailable.push("package.json name missing");
  }
  if (!nonEmptyString(packageSummary.version)) {
    unavailable.push("package.json version missing");
  }
  unavailable.push(...packageSummary.npmPack.invalidFileSpecs.map((item) => `invalid files entry:${item}`));

  if (unavailable.length > 0) {
    findings.push({
      code: "package-npm-pack-unavailable",
      message: "package advertises npm install or publish metadata but cannot produce a usable npm pack artifact",
      evidence: unavailable,
    });
  }

  const missingMetadata = packageNpmPackMissingMetadata(packageSummary, fixtureReport);
  if (missingMetadata.length > 0) {
    findings.push({
      code: "package-npm-pack-metadata-missing",
      message: "advertised npm artifact would not include required OpenClaw package metadata",
      evidence: missingMetadata,
    });
  }

  const entrypoints = packageSummary.openclaw?.entrypoints ?? [];
  const missingEntrypoints = entrypoints
    .filter(
      (entrypoint) =>
        !repoPathIncludedInNpmPack(packageSummary, entrypoint.relativePath) &&
        !hasPackagedRuntimeEntrypoint(entrypoint, packageSummary, entrypoints),
    )
    .map((entrypoint) => `${entrypoint.kind}:${entrypoint.specifier} -> ${entrypoint.relativePath}`) ?? [];
  if (missingEntrypoints.length > 0) {
    findings.push({
      code: "package-npm-pack-entrypoint-missing",
      message: "advertised npm artifact would not include declared OpenClaw entrypoints",
      evidence: missingEntrypoints,
    });
  }

  return findings;
}

function packageNpmPackMissingMetadata(packageSummary, fixtureReport) {
  const missing = [];
  if (!repoPathIncludedInNpmPack(packageSummary, packageSummary.path)) {
    missing.push(packageSummary.path);
  }

  for (const manifest of fixtureReport.pluginManifests ?? []) {
    if (repoPathWithinPackage(packageSummary, manifest.path) && !repoPathIncludedInNpmPack(packageSummary, manifest.path)) {
      missing.push(manifest.path);
    }
  }

  return missing;
}

function hasPackagedRuntimeEntrypoint(entrypoint, packageSummary, entrypoints) {
  if (!isSourceEntrypoint(entrypoint.specifier)) {
    return false;
  }

  const runtimeBuildSpecifier = runtimeBuildSpecifierFor(entrypoint.specifier);
  const matchingRuntimeEntrypoint = entrypoints.find(
    (candidate) =>
      candidate.requiresBuild &&
      normalizeEntrypointSpecifier(candidate.specifier) === normalizeEntrypointSpecifier(runtimeBuildSpecifier),
  );
  if (matchingRuntimeEntrypoint && repoPathIncludedInNpmPack(packageSummary, matchingRuntimeEntrypoint.relativePath)) {
    return true;
  }

  if (
    entrypoint.kind === "extension" &&
    entrypoints.some(
      (candidate) => candidate.kind === "runtimeExtension" && repoPathIncludedInNpmPack(packageSummary, candidate.relativePath),
    )
  ) {
    return true;
  }

  const packageDir = path.posix.dirname(normalizeRepoPath(packageSummary.path));
  const runtimeBuildPath = path.posix.join(packageDir === "." ? "" : packageDir, normalizeEntrypointSpecifier(runtimeBuildSpecifier));
  return repoPathIncludedInNpmPack(packageSummary, runtimeBuildPath);
}

function packageMinHostVersionDrift(packageSummary) {
  const openclaw = packageSummary.openclaw;
  if (!nonEmptyString(openclaw?.install?.minHostVersion) || !nonEmptyString(openclaw?.buildOpenClawVersion)) {
    return false;
  }
  return parseMinHostVersionFloor(openclaw.install.minHostVersion) !== openclaw.buildOpenClawVersion;
}

function parseMinHostVersionFloor(value) {
  const match = /^>=([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(value);
  return match?.[1] ?? null;
}

function repoPathIncludedInNpmPack(packageSummary, repoPath) {
  const packageRelativePath = packageRelativeRepoPath(packageSummary, repoPath);
  if (!packageRelativePath) {
    return false;
  }
  if (npmAlwaysPacksPath(packageRelativePath)) {
    return true;
  }
  if (packageSummary.npmPack?.filesMode !== "allowlist") {
    return true;
  }
  return packageSummary.npmPack.files.some((spec) => packageFileSpecIncludesPath(spec, packageRelativePath));
}

function repoPathWithinPackage(packageSummary, repoPath) {
  return packageRelativeRepoPath(packageSummary, repoPath) !== null;
}

function packageRelativeRepoPath(packageSummary, repoPath) {
  const packageDir = path.posix.dirname(normalizeRepoPath(packageSummary.path));
  const normalized = normalizeRepoPath(repoPath);
  if (packageDir === ".") {
    return normalized;
  }
  if (normalized === packageDir) {
    return "";
  }
  return normalized.startsWith(`${packageDir}/`) ? normalized.slice(packageDir.length + 1) : null;
}

function npmAlwaysPacksPath(packageRelativePath) {
  const base = path.posix.basename(packageRelativePath).toLowerCase();
  return packageRelativePath === "package.json" || /^readme(?:\..*)?$/u.test(base) || /^licen[cs]e(?:\..*)?$/u.test(base);
}

function packageFileSpecIncludesPath(spec, packageRelativePath) {
  if (spec === "." || spec === packageRelativePath) {
    return true;
  }
  if (spec.includes("*")) {
    return globLikeSpecIncludesPath(spec, packageRelativePath);
  }
  return packageRelativePath.startsWith(`${spec.replace(/\/$/u, "")}/`);
}

function globLikeSpecIncludesPath(spec, packageRelativePath) {
  return globSegmentsIncludePath(spec.split("/"), packageRelativePath.split("/"));
}

function globSegmentsIncludePath(specSegments, packageSegments) {
  if (specSegments.length === 0) {
    return packageSegments.length === 0;
  }
  const [head, ...tail] = specSegments;
  if (head === "**") {
    return globSegmentsIncludePath(tail, packageSegments) || (packageSegments.length > 0 && globSegmentsIncludePath(specSegments, packageSegments.slice(1)));
  }
  if (packageSegments.length === 0) {
    return false;
  }
  return globSegmentIncludesPath(head, packageSegments[0]) && globSegmentsIncludePath(tail, packageSegments.slice(1));
}

function globSegmentIncludesPath(specSegment, packageSegment) {
  const escaped = specSegment.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "u").test(packageSegment);
}

function invalidPackageFileSpec(spec) {
  return spec.startsWith("/") || spec === ".." || spec.startsWith("../") || spec.includes("/../");
}

function normalizePackagePath(value) {
  return normalizeRepoPath(value).replace(/^\.\/+/u, "").replace(/\/$/u, "");
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

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRepoPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function detailEvidence(details, key = "name") {
  return unique(details.map((detail) => `${detail[key]} @ ${detail.ref}`));
}

function unique(values) {
  return [...new Set(values)];
}
