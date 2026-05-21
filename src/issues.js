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
  "sdk-export-missing",
  "unrecognized-security-manifest",
]);

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
  },
  "legacy-root-sdk-import": {
    severity: "P2",
    owner: "core",
    decision: "core-compat-adapter",
    title: "root plugin SDK barrel is still used by fixtures",
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
  },
  "security-manifest-schema-unavailable": {
    severity: "P3",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin security manifest references an unavailable schema",
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
  },
  "manifest-unknown-contracts": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "manifest declares unsupported contract keys",
  },
  "manifest-unknown-fields": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "manifest uses unsupported top-level fields",
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
  },
  "package-install-metadata-incomplete": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package install metadata is incomplete",
  },
  "package-json-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package metadata is missing",
  },
  "package-manifest-version-drift": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package and manifest versions drift",
  },
  "package-min-host-version-drift": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package minimum host version drifts from build target",
  },
  "package-npm-pack-entrypoint-missing": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact is missing OpenClaw entrypoints",
  },
  "package-npm-pack-metadata-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact is missing OpenClaw metadata",
  },
  "package-npm-pack-unavailable": {
    severity: "P1",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "advertised npm artifact cannot be packed",
  },
  "package-openclaw-entry-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package entrypoint metadata is missing",
  },
  "package-openclaw-metadata-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "OpenClaw package metadata is missing",
  },
  "package-openclaw-unsupported-metadata": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "package declares unsupported OpenClaw metadata",
  },
  "package-plugin-api-compat-missing": {
    severity: "P2",
    owner: "plugin",
    decision: "plugin-upstream-fix",
    title: "plugin API compatibility range is missing",
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
  return {
    ...finding,
    ...metadata,
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
  if (options.deprecated || ["channel-env-vars", "legacy-before-agent-start", "legacy-root-sdk-import", "provider-auth-env-vars"].includes(code)) {
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
