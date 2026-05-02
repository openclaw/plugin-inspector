import { renderPaddedMarkdownTable } from "./artifacts.js";
import { sanitizeReportArtifact } from "./report-sanitizer.js";

const defaultSeverityLabels = {
  P0: "P0",
  P1: "P1",
  P2: "P2",
  P3: "P3",
};

export function renderCompatibilityMarkdownReport(report, options = {}) {
  report = sanitizeReportArtifact(report, options);
  return [
    `# ${options.title ?? "OpenClaw Plugin Compatibility Report"}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status.toUpperCase()}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Fixtures", report.summary.fixtureCount],
        ["High-priority fixtures", report.summary.highPriorityFixtures],
        ["Hard breakages", report.summary.breakageCount],
        ["Warnings", report.summary.warningCount],
        ["Compatibility suggestions", report.summary.suggestionCount],
        ["Issue findings", report.summary.issueCount],
        ["Open issue findings", report.summary.openIssueCount ?? report.summary.issueCount],
        ["Runtime-covered findings", report.summary.runtimeCoveredIssueCount ?? 0],
        ["Runtime-partial findings", report.summary.runtimePartiallyCoveredIssueCount ?? 0],
        ["P0 issues", report.summary.p0IssueCount],
        ["P1 issues", report.summary.p1IssueCount],
        ["Open P0 issues", report.summary.openP0IssueCount ?? report.summary.p0IssueCount],
        ["Open P1 issues", report.summary.openP1IssueCount ?? report.summary.p1IssueCount],
        ["Live issues", report.summary.liveIssueCount],
        ["Live P0 issues", report.summary.liveP0IssueCount],
        ["Compat gaps", report.summary.compatGapCount],
        ["Deprecation warnings", report.summary.deprecationWarningCount],
        ["Inspector gaps", report.summary.inspectorGapCount],
        ["Open inspector gaps", report.summary.openInspectorGapCount ?? report.summary.inspectorGapCount],
        ["Runtime coverage artifacts", report.summary.runtimeCoverageArtifactCount ?? 0],
        ["Upstream metadata", report.summary.upstreamIssueCount],
        ["Contract probes", report.summary.contractProbeCount],
        ["Decision rows", report.summary.decisionCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Triage Overview",
    "",
    triageOverview(report),
    "",
    "## P0 Live Issues",
    "",
    issuesTable(
      report.issues.filter((issue) => issue.issueClass === "live-issue" && issue.severity === "P0"),
      options,
    ),
    "",
    "## Live Issues",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "live-issue"), options),
    "",
    "## Compat Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "compat-gap"), options),
    "",
    "## Deprecation Warnings",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "deprecation-warning"), options),
    "",
    "## Inspector Proof Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "inspector-gap" && issue.status !== "runtime-covered"), options),
    "",
    "## Runtime-Covered Inspector Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "inspector-gap" && issue.status === "runtime-covered"), options),
    "",
    "## Upstream Metadata Issues",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "upstream-metadata"), options),
    "",
    "## Hard Breakages",
    "",
    findingsTable(report.breakages),
    "",
    "## Target OpenClaw Compat Records",
    "",
    targetOpenClawTable(report.targetOpenClaw),
    "",
    "## Warnings",
    "",
    findingsTable(report.warnings),
    "",
    "## Suggestions To OpenClaw Compat Layer",
    "",
    findingsTable(report.suggestions),
    "",
    "## Issue Findings",
    "",
    issuesTable(report.issues, options),
    "",
    "## Contract Probe Backlog",
    "",
    contractProbesTable(report.contractProbes, options),
    "",
    "## Fixture Seam Inventory",
    "",
    markdownTable(
      report.fixtures.map((fixture) => [
        fixture.id,
        fixture.priority,
        fixture.seams.join(", "),
        fixture.hooks.join(", ") || "-",
        fixture.registrations.join(", ") || "-",
        fixture.manifestContracts.join(", ") || "-",
      ]),
      ["Fixture", "Priority", "Seams", "Hooks", "Registrations", "Manifest contracts"],
    ),
    "",
    "## Decision Matrix",
    "",
    markdownTable(
      report.decisions.map((decision) => [
        decision.fixture,
        decision.decision,
        decision.seam,
        decision.action,
        decision.evidence,
      ]),
      ["Fixture", "Decision", "Seam", "Action", "Evidence"],
    ),
    "",
    "## Raw Logs",
    "",
    findingsTable(report.logs),
  ].join("\n");
}

export function renderCompatibilityIssuesReport(report, options = {}) {
  report = sanitizeReportArtifact(report, options);
  return [
    `# ${options.title ?? "OpenClaw Plugin Issue Findings"}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status.toUpperCase()}`,
    "",
    "## Triage Summary",
    "",
    markdownTable(
      [
        ["Issue findings", report.summary.issueCount],
        ["Open issue findings", report.summary.openIssueCount ?? report.summary.issueCount],
        ["Runtime-covered findings", report.summary.runtimeCoveredIssueCount ?? 0],
        ["Runtime-partial findings", report.summary.runtimePartiallyCoveredIssueCount ?? 0],
        [severityLabel("P0", options), report.summary.p0IssueCount],
        [severityLabel("P1", options), report.summary.p1IssueCount],
        [`Open ${severityLabel("P0", options)}`, report.summary.openP0IssueCount ?? report.summary.p0IssueCount],
        [`Open ${severityLabel("P1", options)}`, report.summary.openP1IssueCount ?? report.summary.p1IssueCount],
        ["Live issues", report.summary.liveIssueCount],
        ["Live P0 issues", report.summary.liveP0IssueCount],
        ["Compat gaps", report.summary.compatGapCount],
        ["Deprecation warnings", report.summary.deprecationWarningCount],
        ["Inspector gaps", report.summary.inspectorGapCount],
        ["Open inspector gaps", report.summary.openInspectorGapCount ?? report.summary.inspectorGapCount],
        ["Runtime coverage artifacts", report.summary.runtimeCoverageArtifactCount ?? 0],
        ["Upstream metadata", report.summary.upstreamIssueCount],
        ["Contract probes", report.summary.contractProbeCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Triage Overview",
    "",
    triageOverview(report),
    "",
    "## P0 Live Issues",
    "",
    issuesTable(
      report.issues.filter((issue) => issue.issueClass === "live-issue" && issue.severity === "P0"),
      options,
    ),
    "",
    "## Live Issues",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "live-issue"), options),
    "",
    "## Compat Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "compat-gap"), options),
    "",
    "## Deprecation Warnings",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "deprecation-warning"), options),
    "",
    "## Inspector Proof Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "inspector-gap" && issue.status !== "runtime-covered"), options),
    "",
    "## Runtime-Covered Inspector Gaps",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "inspector-gap" && issue.status === "runtime-covered"), options),
    "",
    "## Upstream Metadata Issues",
    "",
    issuesTable(report.issues.filter((issue) => issue.issueClass === "upstream-metadata"), options),
    "",
    "## Issues",
    "",
    issuesTable(report.issues, options),
    "",
    "## Contract Probe Backlog",
    "",
    contractProbesTable(report.contractProbes, options),
  ].join("\n");
}

function findingsTable(findings) {
  if (findings.length === 0) {
    return "_none_";
  }

  return markdownTable(
    findings.map((finding) => [
      finding.fixture,
      finding.code,
      finding.level,
      finding.message,
      (finding.evidence ?? []).join(", ") || "-",
      finding.compatRecord ?? "-",
    ]),
    ["Fixture", "Code", "Level", "Message", "Evidence", "Compat record"],
  );
}

function issuesTable(issues, options) {
  if (issues.length === 0) {
    return "_none_";
  }

  return issues.map((issue) => issueBlock(issue, options)).join("\n\n");
}

function issueBlock(issue, options) {
  return [
    `- ${severityLabel(issue.severity, options)} **${issue.fixture}** \`${issue.issueClass}\` \`${issue.decision}\``,
    `  - **${issue.code}**: ${issue.title}`,
    `  - state: ${issueState(issue)}`,
    "  - evidence:",
    ...evidenceList(issue.evidence, options).map((item) => `    - ${item}`),
    ...runtimeCoverageList(issue, options),
  ].join("\n");
}

function issueState(issue) {
  const flags = [
    issue.status,
    `compat:${issue.compatStatus ?? "none"}`,
    issue.runtimeCoverage?.status ? `runtime:${issue.runtimeCoverage.status}` : null,
    issue.live ? "live" : null,
    issue.deprecated ? "deprecated" : null,
  ].filter(Boolean);
  return flags.join(" · ");
}

function triageOverview(report) {
  return markdownTable(
    [
      [
        "live-issue",
        report.summary.liveIssueCount,
        report.summary.liveP0IssueCount,
        "Potential runtime breakage in the target OpenClaw/plugin pair. P0 only when it is not a deprecated compat seam.",
      ],
      [
        "compat-gap",
        report.summary.compatGapCount,
        "-",
        "Compatibility behavior is needed but missing from the target OpenClaw compat registry.",
      ],
      [
        "deprecation-warning",
        report.summary.deprecationWarningCount,
        "-",
        "Plugin uses a supported but deprecated compatibility seam; keep it wired while migration exists.",
      ],
      [
        "inspector-gap",
        report.summary.inspectorGapCount,
        "-",
        "Plugin Inspector needs stronger capture/probe evidence before making contract judgments. Runtime-covered rows are proof-backed and not open report work.",
      ],
      [
        "upstream-metadata",
        report.summary.upstreamIssueCount,
        "-",
        "Plugin package or manifest metadata should improve upstream; not a target OpenClaw live break by itself.",
      ],
      [
        "fixture-regression",
        report.summary.fixtureRegressionCount,
        "-",
        "Fixture no longer exposes an expected seam; investigate fixture pin or scanner drift.",
      ],
    ],
    ["Class", "Count", "P0", "Meaning"],
  );
}

function contractProbesTable(probes, options) {
  if (probes.length === 0) {
    return "_none_";
  }

  return probes.map((probe) => contractProbeBlock(probe, options)).join("\n\n");
}

function contractProbeBlock(probe, options) {
  return [
    `- ${severityLabel(probe.priority, options)} **${probe.fixture}** \`${probe.target}\``,
    `  - contract: ${probe.contract}`,
    `  - id: \`${probe.id}\``,
    "  - evidence:",
    ...evidenceList(probe.evidence, options).map((item) => `    - ${item}`),
  ].join("\n");
}

function targetOpenClawTable(targetOpenClaw = {}) {
  const compatRecords = targetOpenClaw.compatRecords ?? [];
  const recordPreview = compatRecords.length > 0 ? compatRecords.join(", ") : "-";
  const statusCounts = Object.values(targetOpenClaw.compatRecordStatuses ?? {}).reduce((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  return markdownTable(
    [
      ["Configured path", targetOpenClaw.configuredPath ?? "-"],
      ["Status", targetOpenClaw.status],
      ["Compat registry", targetOpenClaw.compatRegistryPath ?? "-"],
      ["Compat records", targetOpenClaw.compatRecordCount ?? 0],
      ["Compat status counts", Object.entries(statusCounts).map(([status, count]) => `${status}:${count}`).join(", ") || "-"],
      ["Record ids", recordPreview],
      ["Hook registry", targetOpenClaw.hookTypesPath ?? "-"],
      ["Hook names", targetOpenClaw.hookNameCount ?? 0],
      ["API builder", targetOpenClaw.apiBuilderPath ?? "-"],
      ["API registrars", targetOpenClaw.apiRegistrarCount ?? 0],
      ["Captured registration", targetOpenClaw.capturedRegistrationPath ?? "-"],
      ["Captured registrars", targetOpenClaw.capturedRegistrarCount ?? 0],
      ["Package metadata", targetOpenClaw.packagePath ?? "-"],
      ["Plugin SDK exports", targetOpenClaw.sdkExportCount ?? 0],
      ["Manifest types", targetOpenClaw.manifestTypesPath ?? "-"],
      ["Manifest fields", targetOpenClaw.manifestFieldCount ?? 0],
      ["Manifest contract fields", targetOpenClaw.manifestContractFieldCount ?? 0],
    ],
    ["Metric", "Value"],
  );
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(
    rows.map((row) => row.map((cell) => escapeCell(String(cell)))),
    headers.map((header) => escapeCell(String(header))),
  );
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function severityLabel(severity, options) {
  return { ...defaultSeverityLabels, ...options.severityLabels }[severity] ?? severity ?? "-";
}

function evidenceList(evidence, options) {
  const items = (evidence ?? []).filter(Boolean);
  if (items.length === 0) {
    return ["-"];
  }
  const formatEvidence = options.formatEvidence ?? ((item) => item);
  return items.map((item) => formatEvidence(item));
}

function runtimeCoverageList(issue, options) {
  const runtimeCoverage = issue.runtimeCoverage;
  if (!runtimeCoverage) {
    return [];
  }
  return [
    "  - runtime coverage:",
    ...evidenceList(runtimeCoverage.captured, options).map((item) => `    - captured ${item}`),
    ...evidenceList(runtimeCoverage.artifacts, options).map((item) => `    - ${item}`),
  ];
}
