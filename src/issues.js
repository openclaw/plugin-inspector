import { createHash } from "node:crypto";

export const deprecatedCompatRecords = new Set([
  "channel-env-vars",
  "legacy-before-agent-start",
  "legacy-root-sdk-import",
  "provider-auth-env-vars",
]);

export const knownIssueCodes = new Set([
  "before-tool-call-probe",
  "channel-contract-probe",
  "channel-env-vars",
  "conversation-access-hook",
  "legacy-before-agent-start",
  "legacy-root-sdk-import",
  "manifest-name-missing",
  "manifest-unknown-contracts",
  "manifest-unknown-fields",
  "missing-expected-seam",
  "missing-compat-record",
  "unknown-hook-name",
  "unknown-registration-name",
  "package-build-artifact-entrypoint",
  "package-dependency-install-required",
  "package-entrypoint-missing",
  "package-install-metadata-incomplete",
  "package-json-missing",
  "package-manifest-version-drift",
  "package-min-host-version-drift",
  "package-npm-pack-entrypoint-missing",
  "package-npm-pack-metadata-missing",
  "package-npm-pack-unavailable",
  "package-openclaw-entry-missing",
  "package-openclaw-metadata-missing",
  "package-openclaw-unsupported-metadata",
  "package-plugin-api-compat-missing",
  "package-typescript-source-entrypoint",
  "provider-auth-env-vars",
  "registration-capture-gap",
  "runtime-tool-capture",
  "reserved-sdk-import",
  "security-manifest-schema-unavailable",
  "sdk-load-session-store",
  "sdk-export-missing",
  "unrecognized-security-manifest",
]);

const authorRemediationDocsUrl = (code) => `https://docs.openclaw.ai/clawhub/plugin-validation-fixes#${code}`;

const authorRemediation = (summary) => ({ summary });

const migrationRemediation = authorRemediation;

export const issueMetadataByCode = {
  "before-tool-call-probe": {
    severity: "P1",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "before_tool_call needs terminal/block/approval probes",
  },
  "channel-contract-probe": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "channel runtime needs envelope/config probes",
  },
  "channel-env-vars": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "channelEnvVars legacy manifest metadata must stay covered",
    authorRemediation: migrationRemediation(
      "Move legacy channel environment variable metadata into the current setup/config metadata while keeping the old field until your supported OpenClaw range no longer needs it.",
      [
        "Mirror each channel environment variable into the current setup or provider configuration metadata.",
        "Keep channelEnvVars only as backwards compatibility for older OpenClaw versions you still support.",
      ],
    ),
  },
  "conversation-access-hook": {
    severity: "P1",
    owner: "core",
    decision: "inspector-follow-up",
    title: "conversation-access hooks need privacy-boundary probes",
  },
  "legacy-before-agent-start": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "legacy before_agent_start hook compatibility is still used",
    authorRemediation: migrationRemediation(
      "Replace the legacy before_agent_start hook with the current prompt/model hooks.",
      [
        "Move model-selection work to before_model_resolve when possible.",
        "Move prompt mutation work to before_prompt_build.",
        "Keep before_agent_start only if your declared compatibility range still includes OpenClaw versions that require it.",
      ],
    ),
  },
  "legacy-root-sdk-import": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "root plugin SDK barrel is still used by fixtures",
    authorRemediation: migrationRemediation(
      "Prefer focused public plugin SDK subpath imports instead of the legacy root barrel.",
      [
        "Replace imports from openclaw/plugin-sdk with the documented subpath for the API you use.",
        "Keep the root import only while supporting older OpenClaw versions that do not expose the subpath.",
      ],
    ),
  },
  "sdk-load-session-store": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "deprecated whole-store session helper is still used",
    authorRemediation: migrationRemediation(
      "Replace deprecated loadSessionStore whole-store access with row-scoped session helpers.",
      [
        "Use getSessionEntry(...) or listSessionEntries(...) for reads instead of cloning the whole session store.",
        "Use patchSessionEntry(...) or upsertSessionEntry(...) for writes instead of mutating and saving a whole-store object.",
      ],
    ),
  },
  "sdk-export-missing": {
    severity: "P1",
    owner: "core",
    decision: "core-compat-adapter",
    title: "plugin SDK import aliases are missing from target package exports",
  },
  "reserved-sdk-import": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin imports reserved bundled-plugin SDK compatibility subpaths",
    authorRemediation: authorRemediation(
      "Stop importing reserved bundled-plugin SDK compatibility paths.",
      [
        "Replace reserved OpenClaw internal SDK imports with documented public openclaw/plugin-sdk subpaths.",
        "If no public API exists for the behavior, vendor a plugin-local helper or request a public OpenClaw API.",
      ],
    ),
  },
  "security-manifest-schema-unavailable": {
    severity: "P3",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin security manifest references an unavailable schema",
    authorRemediation: authorRemediation(
      "Remove or update the unsupported security manifest schema reference.",
      [
        "Delete the schema URL from openclaw.security.json if it is advisory-only.",
        "Use a documented versioned schema once OpenClaw publishes one.",
      ],
    ),
  },
  "missing-compat-record": {
    severity: "P1",
    owner: "core",
    decision: "core-compat-adapter",
    title: "compat-dependent behavior lacks registry coverage",
  },
  "missing-expected-seam": {
    severity: "P0",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "fixture no longer exposes an expected seam",
  },
  "manifest-name-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "manifest display name is missing",
    authorRemediation: authorRemediation(
      "Add a display name to the plugin manifest.",
      ["Set a non-empty name field in openclaw.plugin.json."],
      '{\n  "name": "My Plugin"\n}',
    ),
  },
  "manifest-unknown-contracts": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "manifest declares unsupported contract keys",
    authorRemediation: authorRemediation(
      "Remove unsupported manifest contract keys or move them to a documented OpenClaw contract field.",
      [
        "Compare the contracts object to the OpenClaw manifest fields supported by your target version.",
        "Delete custom contract keys unless OpenClaw has a versioned schema for them.",
      ],
    ),
  },
  "manifest-unknown-fields": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "manifest uses unsupported top-level fields",
    authorRemediation: authorRemediation(
      "Move unsupported top-level manifest fields into supported package metadata or remove them.",
      [
        "Keep openclaw.plugin.json limited to fields supported by the target OpenClaw manifest schema.",
        "Move package-level metadata into package.json openclaw metadata when that field is supported.",
      ],
    ),
  },
  "package-build-artifact-entrypoint": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "cold import requires package build output",
  },
  "package-dependency-install-required": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "cold import requires dependency installation in an isolated workspace",
  },
  "package-entrypoint-missing": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package entrypoint is missing",
    authorRemediation: authorRemediation(
      "Publish the entrypoint declared in OpenClaw package metadata or update the metadata to point at an existing file.",
      [
        "Check package.json openclaw.extensions and openclaw.runtimeExtensions.",
        "Ensure the referenced file exists in the published artifact, usually under dist/ after build.",
      ],
    ),
  },
  "package-install-metadata-incomplete": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package install metadata is incomplete",
    authorRemediation: authorRemediation(
      "Complete the OpenClaw install metadata so ClawHub can identify the install target.",
      [
        "Fill package.json openclaw.install with the supported release target.",
        "Align clawhubSpec, npmSpec, and defaultChoice with the package you publish.",
      ],
    ),
  },
  "package-json-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package metadata is missing",
    authorRemediation: authorRemediation(
      "Add a package.json to the plugin package.",
      [
        "Include the package name and version.",
        "Add an openclaw metadata block describing extensions, compatibility, and install details.",
      ],
    ),
  },
  "package-manifest-version-drift": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package and manifest versions drift",
    authorRemediation: authorRemediation(
      "Align the plugin version declared in package.json and openclaw.plugin.json.",
      [
        "Use the same version in both files, or remove stale manifest version metadata if package.json is authoritative.",
        "Republish with a new package version after changing published metadata.",
      ],
    ),
  },
  "package-min-host-version-drift": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package minimum host version drifts from build target",
    authorRemediation: authorRemediation(
      "Set the package minimum host version to the OpenClaw version range the plugin was built and tested against.",
      [
        "Update package.json openclaw.install.minHostVersion or compatibility metadata.",
        "Keep it semver-compatible with the target OpenClaw build version.",
      ],
    ),
  },
  "package-npm-pack-entrypoint-missing": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact is missing OpenClaw entrypoints",
    authorRemediation: authorRemediation(
      "Include the declared OpenClaw entrypoints in the npm-packed artifact.",
      [
        "Run npm pack locally and inspect the tarball contents.",
        "Update package.json files so dist files and manifests are included.",
        "Build before packing if the entrypoint is generated.",
      ],
    ),
  },
  "package-npm-pack-metadata-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact is missing OpenClaw metadata",
    authorRemediation: authorRemediation(
      "Include OpenClaw metadata files in the npm-packed artifact.",
      [
        "Run npm pack locally and inspect package.json and OpenClaw manifest files.",
        "Update package.json files so required metadata is not excluded.",
      ],
    ),
  },
  "package-npm-pack-unavailable": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact cannot be packed",
    authorRemediation: authorRemediation(
      "Make the package packable before publishing it through ClawHub.",
      [
        "Remove private:true if this package is intended to publish.",
        "Ensure package.json has a valid name and version.",
        "Fix package scripts or files entries that make npm pack fail.",
      ],
    ),
  },
  "package-openclaw-entry-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package entrypoint metadata is missing",
    authorRemediation: authorRemediation(
      "Declare the plugin runtime entrypoint in package.json OpenClaw metadata.",
      [
        "Add openclaw.extensions for extension entrypoints.",
        "Add openclaw.runtimeExtensions when the plugin has runtime-side code.",
      ],
    ),
  },
  "package-openclaw-metadata-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package metadata is missing",
    authorRemediation: authorRemediation(
      "Add the package.json openclaw metadata block.",
      [
        "Describe extension entrypoints, plugin API compatibility, and install metadata.",
        "Keep package metadata in sync with openclaw.plugin.json when both files are present.",
      ],
    ),
  },
  "package-openclaw-unsupported-metadata": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package declares unsupported OpenClaw metadata",
    authorRemediation: authorRemediation(
      "Remove unsupported OpenClaw package metadata fields.",
      [
        "Delete openclaw.bundle and other fields not accepted by the current package schema.",
        "Move bundle-specific data to documented manifest fields when available.",
      ],
    ),
  },
  "package-plugin-api-compat-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin API compatibility range is missing",
    authorRemediation: authorRemediation(
      "Declare the OpenClaw plugin API range this package supports.",
      [
        "Add package.json `openclaw.compat.pluginApi` with the OpenClaw plugin API range you tested.",
        "If known, include the OpenClaw build/version used to produce the package metadata.",
      ],
      '"openclaw": {\n  "compat": {\n    "pluginApi": ">=0.1.0"\n  }\n}',
    ),
  },
  "package-typescript-source-entrypoint": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "cold import needs TypeScript source entrypoint support",
  },
  "provider-auth-env-vars": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "providerAuthEnvVars legacy manifest metadata must stay covered",
    authorRemediation: migrationRemediation(
      "Move legacy provider authentication environment variables into current provider setup metadata.",
      [
        "Mirror providerAuthEnvVars into setup.providers[].envVars or the current provider-choice metadata.",
        "Keep the legacy field only while supporting older OpenClaw versions that still read it.",
      ],
    ),
  },
  "registration-capture-gap": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "runtime registrations need capture evidence before final contract judgment",
  },
  "runtime-tool-capture": {
    severity: "P2",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: "runtime tool schema needs registration capture",
  },
  "unknown-hook-name": {
    severity: "P0",
    owner: "core",
    decision: "core-compat-adapter",
    title: "fixture uses a hook missing from target OpenClaw",
  },
  "unknown-registration-name": {
    severity: "P0",
    owner: "core",
    decision: "core-compat-adapter",
    title: "fixture calls a registrar missing from target OpenClaw",
  },
  "unrecognized-security-manifest": {
    severity: "P3",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin ships an unsupported security manifest",
    authorRemediation: authorRemediation(
      "Remove unsupported security manifest files until OpenClaw documents a versioned security manifest schema.",
      [
        "Delete openclaw.security.json if it is advisory-only and not consumed by OpenClaw.",
        "Reintroduce it only when the schema and ClawHub behavior are documented.",
      ],
    ),
  },
};

export function buildIssues({ breakages = [], warnings = [], suggestions = [], targetOpenClaw, idPrefix = "CRABPOT" }) {
  const findings = [
    ...breakages.map((finding) => issueMetadata({ ...finding, severity: "P0" }, targetOpenClaw)),
    ...warnings.map((finding) => issueMetadata(finding, targetOpenClaw)),
    ...suggestions.map((finding) => issueMetadata(finding, targetOpenClaw)),
  ];

  return findings
    .filter((finding) => finding.severity)
    .sort(issueSort)
    .map((finding) => ({
      id: issueId(finding, { prefix: idPrefix }),
      fixture: finding.fixture,
      severity: finding.severity,
      owner: finding.owner,
      code: finding.code,
      decision: finding.decision,
      status: finding.status ?? (finding.severity === "P0" || finding.level === "breakage" ? "blocking" : "open"),
      issueClass: finding.issueClass,
      live: finding.live,
      deprecated: finding.deprecated,
      compatStatus: finding.compatStatus,
      title: issueTitle(finding),
      evidence: finding.evidence ?? [],
      compatRecord: finding.compatRecord ?? null,
      runtimeCoverage: finding.runtimeCoverage ?? null,
      ...(finding.authorRemediation
        ? {
            authorRemediation: {
              summary: finding.authorRemediation.summary,
              docsUrl: authorRemediationDocsUrl(finding.code),
            },
          }
        : {}),
    }));
}

export function issueId(finding, options = {}) {
  const stableKey = [
    finding.fixture,
    finding.code,
    finding.severity,
    finding.compatRecord ?? "",
    ...(finding.evidence ?? []),
  ].join("\n");
  return `${options.prefix ?? "CRABPOT"}-${createHash("sha256").update(stableKey).digest("hex").slice(0, 8).toUpperCase()}`;
}

export function issueMetadata(finding, targetOpenClaw) {
  const metadata = issueMetadataByCode[finding.code] ?? {
    severity: "P3",
    owner: "inspector",
    decision: "inspector-follow-up",
    title: finding.message,
  };
  const authorMetadata = metadata.authorRemediation
    ? {
        authorRemediation: {
          summary: metadata.authorRemediation.summary,
          docsUrl: authorRemediationDocsUrl(finding.code),
        },
      }
    : {};
  return {
    ...finding,
    ...metadata,
    ...authorMetadata,
    ...classifyIssueFinding(finding, targetOpenClaw, metadata),
  };
}

export function classifyIssueFinding(finding, targetOpenClaw, metadata = {}) {
  const compatStatus = compatStatusFor(finding, targetOpenClaw);
  const deprecated = compatStatus === "deprecated";
  const code = finding.code;
  const issueClass = issueClassFor(code, { deprecated, compatRecord: finding.compatRecord });
  const live = issueClass === "live-issue" || finding.level === "breakage";
  const severity = severityForClass(code, metadata?.severity, {
    issueClass,
    compatRecord: finding.compatRecord,
    compatStatus,
  });

  return {
    compatStatus,
    deprecated,
    issueClass,
    live,
    severity,
  };
}

export function isInspectorGapFinding(finding, targetOpenClaw) {
  return issueMetadata(finding, targetOpenClaw).issueClass === "inspector-gap";
}

export function isAuthorFacingFinding(finding, targetOpenClaw) {
  return Boolean(issueMetadata(finding, targetOpenClaw).authorRemediation);
}

export function summarizeIssueClasses(issues) {
  const summary = {
    "compat-gap": 0,
    "deprecation-warning": 0,
    "fixture-regression": 0,
    "inspector-gap": 0,
    "live-issue": 0,
    "upstream-metadata": 0,
  };
  for (const issue of issues) {
    summary[issue.issueClass] = (summary[issue.issueClass] ?? 0) + 1;
  }
  return summary;
}

function issueClassFor(code, options) {
  if (code === "sdk-export-missing" && options.compatRecord) {
    return "compat-gap";
  }
  if (["unknown-hook-name", "unknown-registration-name", "package-entrypoint-missing"].includes(code)) {
    return "live-issue";
  }
  if (code === "missing-compat-record") {
    return "compat-gap";
  }
  if (
    options.deprecated ||
    [
      "channel-env-vars",
      "legacy-before-agent-start",
      "legacy-root-sdk-import",
      "provider-auth-env-vars",
      "sdk-load-session-store",
    ].includes(code)
  ) {
    return "deprecation-warning";
  }
  if (
    [
      "before-tool-call-probe",
      "channel-contract-probe",
      "conversation-access-hook",
      "package-build-artifact-entrypoint",
      "package-dependency-install-required",
      "package-typescript-source-entrypoint",
      "registration-capture-gap",
      "runtime-tool-capture",
    ].includes(code)
  ) {
    return "inspector-gap";
  }
  if (
    [
      "manifest-unknown-contracts",
      "manifest-unknown-fields",
      "manifest-name-missing",
      "package-json-missing",
      "package-manifest-version-drift",
      "package-min-host-version-drift",
      "package-npm-pack-entrypoint-missing",
      "package-npm-pack-metadata-missing",
      "package-npm-pack-unavailable",
      "package-openclaw-entry-missing",
      "package-openclaw-metadata-missing",
      "package-openclaw-unsupported-metadata",
      "package-plugin-api-compat-missing",
      "package-install-metadata-incomplete",
      "reserved-sdk-import",
      "security-manifest-schema-unavailable",
      "unrecognized-security-manifest",
    ].includes(code)
  ) {
    return "upstream-metadata";
  }
  if (code === "missing-expected-seam") {
    return "fixture-regression";
  }
  return options.compatRecord ? "compat-gap" : "inspector-gap";
}

function severityForClass(code, defaultSeverity, options) {
  if (
    options.issueClass === "live-issue" &&
    ["none", "untracked"].includes(options.compatStatus) &&
    ["unknown-hook-name", "unknown-registration-name", "package-entrypoint-missing"].includes(code)
  ) {
    return "P0";
  }
  return defaultSeverity ?? "P3";
}

function compatStatusFor(finding, targetOpenClaw) {
  if (finding.code === "missing-compat-record") {
    return "missing";
  }
  if (!finding.compatRecord) {
    return "none";
  }
  const targetStatus = targetOpenClaw?.compatRecordStatuses?.[finding.compatRecord];
  if (targetStatus) {
    return targetStatus;
  }
  if (deprecatedCompatRecords.has(finding.compatRecord)) {
    return "deprecated";
  }
  return "untracked";
}

function issueSort(left, right) {
  return (
    priorityRank(left.severity) - priorityRank(right.severity) ||
    left.fixture.localeCompare(right.fixture) ||
    left.code.localeCompare(right.code) ||
    (left.evidence ?? []).join(",").localeCompare((right.evidence ?? []).join(","))
  );
}

function issueTitle(finding) {
  return `${finding.fixture}: ${finding.title ?? finding.message}`;
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 4;
}
