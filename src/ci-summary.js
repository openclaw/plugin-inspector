import { existsSync } from "node:fs";
import path from "node:path";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { readOptionalJsonFile } from "./json-file.js";

export const defaultCiReportPaths = {
  compatibility: "reports/plugin-inspector-report.json",
  capture: "reports/plugin-inspector-runtime-capture.json",
  synthetic: "reports/plugin-inspector-synthetic-probes.json",
  coldImport: "reports/plugin-inspector-cold-import.json",
  workspace: "reports/plugin-inspector-workspace-plan.json",
  platform: "reports/plugin-inspector-platform-probes.json",
  importLoop: "reports/plugin-inspector-import-loop-profile.json",
  execution: "reports/plugin-inspector-execution-results.json",
  runtimeProfile: "reports/plugin-inspector-runtime-profile.json",
  refDiff: "reports/plugin-inspector-ref-diff.json",
  profileDiff: "reports/plugin-inspector-profile-diff.json",
  ciPolicy: "reports/plugin-inspector-ci-policy.json",
};

export async function buildCiSummary(options = {}) {
  const reportPaths = options.reportPaths ?? defaultCiReportPaths;
  const reports = options.reports ?? (await readCiReports(options.reportsDir ?? "reports", reportPaths));
  const artifactBaseDir = options.artifactBaseDir ?? process.cwd();

  return {
    generatedAt: options.generatedAt ?? "deterministic",
    title: options.title ?? "Plugin Inspector CI Summary",
    mode: options.mode ?? "local",
    openclawLabel: options.openclawLabel ?? "",
    status: deriveCiStatus(reports),
    summary: {
      breakages: reports.compatibility?.summary?.breakageCount ?? 0,
      warnings: reports.compatibility?.summary?.warningCount ?? 0,
      suggestions: reports.compatibility?.summary?.suggestionCount ?? 0,
      issues: reports.compatibility?.summary?.issueCount ?? 0,
      p0Issues: reports.compatibility?.summary?.p0IssueCount ?? 0,
      p1Issues: reports.compatibility?.summary?.p1IssueCount ?? 0,
      liveIssues: reports.compatibility?.summary?.liveIssueCount ?? 0,
      liveP0Issues: reports.compatibility?.summary?.liveP0IssueCount ?? 0,
      compatGaps: reports.compatibility?.summary?.compatGapCount ?? 0,
      deprecationWarnings: reports.compatibility?.summary?.deprecationWarningCount ?? 0,
      inspectorGaps: reports.compatibility?.summary?.inspectorGapCount ?? 0,
      upstreamIssues: reports.compatibility?.summary?.upstreamIssueCount ?? 0,
      refDiffFailures: reports.refDiff?.summary?.hardRegressionCount ?? 0,
      refDiffWarnings: reports.refDiff?.summary?.warningRegressionCount ?? 0,
      policyFailures: reports.ciPolicy?.summary?.failCount ?? 0,
      policyWarnings: reports.ciPolicy?.summary?.warnCount ?? 0,
      profileFailures: reports.profileDiff?.summary?.failCount ?? 0,
      profileWarnings: reports.profileDiff?.summary?.warnCount ?? 0,
      executionPass: reports.execution?.summary?.passCount ?? 0,
      executionFail: reports.execution?.summary?.failCount ?? 0,
      executionBlocked: reports.execution?.summary?.blockedCount ?? 0,
      platformWindowsRisks: reports.platform?.summary?.windowsRiskStepCount ?? 0,
      platformContainerRisks: reports.platform?.summary?.containerRiskStepCount ?? 0,
      loaderJitiCandidates: reports.platform?.summary?.jitiAlternativeCount ?? 0,
      importLoopP50Ms: reports.importLoop?.summary?.p50WallMs ?? 0,
      importLoopP95Ms: reports.importLoop?.summary?.p95WallMs ?? 0,
      importLoopMetricBasis: reports.importLoop?.summary?.maxPluginPeakRssDeltaMb === undefined ? "raw" : "baseline-adjusted",
      importLoopMaxRssMb: reports.importLoop?.summary?.maxPluginPeakRssDeltaMb ?? reports.importLoop?.summary?.maxPeakRssMb ?? 0,
      importLoopMaxCpuMs: reports.importLoop?.summary?.maxPluginCpuDeltaMsEstimate ?? reports.importLoop?.summary?.maxCpuMsEstimate ?? 0,
      importLoopRssSampleCount: metricSampleCount(reports.importLoop, "rss", "maxPeakRssMb"),
      importLoopCpuSampleCount: metricSampleCount(reports.importLoop, "cpu", "maxCpuMsEstimate"),
    },
    topIssues: topIssues(reports.compatibility),
    refRegressions: (reports.refDiff?.regressions ?? []).slice(0, 20),
    policyFindings: (reports.ciPolicy?.checks ?? []).filter((check) => check.action !== "pass").slice(0, 20),
    profileFindings: (reports.profileDiff?.checks ?? []).filter((check) => check.action !== "pass").slice(0, 20),
    artifacts: Object.fromEntries(
      Object.entries(reportPaths).map(([key, value]) => [key, existsSync(path.join(artifactBaseDir, value)) ? value : null]),
    ),
  };
}

export async function readCiReports(reportsDir, reportPaths = defaultCiReportPaths) {
  const reports = {};
  for (const [key, defaultPath] of Object.entries(reportPaths)) {
    const reportPath = path.join(reportsDir, path.basename(defaultPath));
    reports[key] = await readOptionalJsonFile(reportPath);
  }
  return reports;
}

export function deriveCiStatus(reports) {
  if ((reports.compatibility?.summary?.breakageCount ?? 0) > 0) {
    return "fail";
  }
  if ((reports.refDiff?.summary?.hardRegressionCount ?? 0) > 0) {
    return "fail";
  }
  if ((reports.ciPolicy?.summary?.failCount ?? 0) > 0) {
    return "fail";
  }
  if ((reports.profileDiff?.summary?.failCount ?? 0) > 0) {
    return "fail";
  }
  if ((reports.execution?.summary?.failCount ?? 0) > 0) {
    return "fail";
  }
  return "pass";
}

export async function writeCiSummary(summary, options = {}) {
  const jsonPath = options.jsonPath ?? path.join(process.cwd(), "reports/plugin-inspector-ci-summary.json");
  const markdownPath = options.markdownPath ?? path.join(process.cwd(), "reports/plugin-inspector-ci-summary.md");
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: summary,
    markdown: renderCiSummaryMarkdown(summary),
    check: options.check,
  });
}

export function renderCiSummaryMarkdown(summary) {
  return [
    `# ${summary.title ?? "Plugin Inspector CI Summary"}`,
    "",
    `Generated: ${summary.generatedAt}`,
    `Mode: ${summary.mode}`,
    `OpenClaw: ${summary.openclawLabel || "-"}`,
    `Status: ${summary.status.toUpperCase()}`,
    "",
    "## Counts",
    "",
    markdownTable(
      [
        ["Breakages", summary.summary.breakages],
        ["Warnings", summary.summary.warnings],
        ["Suggestions", summary.summary.suggestions],
        ["Issues", summary.summary.issues],
        ["P0 issues", summary.summary.p0Issues],
        ["P1 issues", summary.summary.p1Issues],
        ["Live issues", summary.summary.liveIssues],
        ["Live P0 issues", summary.summary.liveP0Issues],
        ["Compat gaps", summary.summary.compatGaps],
        ["Deprecation warnings", summary.summary.deprecationWarnings],
        ["Inspector gaps", summary.summary.inspectorGaps],
        ["Upstream metadata", summary.summary.upstreamIssues],
        ["Ref diff failures", summary.summary.refDiffFailures],
        ["Ref diff warnings", summary.summary.refDiffWarnings],
        ["Policy failures", summary.summary.policyFailures],
        ["Policy warnings", summary.summary.policyWarnings],
        ["Profile failures", summary.summary.profileFailures],
        ["Profile warnings", summary.summary.profileWarnings],
        ["Execution pass", summary.summary.executionPass],
        ["Execution fail", summary.summary.executionFail],
        ["Execution blocked", summary.summary.executionBlocked],
        ["Windows portability risks", summary.summary.platformWindowsRisks],
        ["Container portability risks", summary.summary.platformContainerRisks],
        ["Jiti loader candidates", summary.summary.loaderJitiCandidates],
        [
          "Import loop",
          importLoopSummaryLabel(summary.summary),
        ],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Top Issues",
    "",
    markdownTable(
      summary.topIssues.map((issue) => [issue.severity, issue.issueClass ?? "-", issue.fixture, issue.code, issue.decision, issue.title]),
      ["Severity", "Class", "Fixture", "Code", "Decision", "Title"],
    ),
    "",
    "## Ref Regressions",
    "",
    markdownTable(
      summary.refRegressions.map((regression) => [
        regression.action,
        regression.severity,
        regression.dimension,
        regression.code,
        regression.message,
      ]),
      ["Action", "Severity", "Surface", "Code", "Message"],
    ),
    "",
    "## Policy Findings",
    "",
    markdownTable(
      summary.policyFindings.map((finding) => [finding.action, finding.id, finding.message, finding.evidence.join(", ")]),
      ["Action", "ID", "Message", "Evidence"],
    ),
    "",
    "## Profile Findings",
    "",
    markdownTable(
      summary.profileFindings.map((finding) => [
        finding.action,
        finding.id,
        finding.metric,
        finding.baseline ?? "-",
        finding.current ?? "-",
        finding.message,
      ]),
      ["Action", "ID", "Metric", "Baseline", "Current", "Message"],
    ),
    "",
    "## Artifacts",
    "",
    markdownTable(
      Object.entries(summary.artifacts).map(([key, value]) => [key, value ?? "-"]),
      ["Artifact", "Path"],
    ),
  ].join("\n");
}

function topIssues(report) {
  return (report?.issues ?? [])
    .filter((issue) => ["P0", "P1"].includes(issue.severity))
    .slice(0, 20)
    .map((issue) => ({
      severity: issue.severity,
      issueClass: issue.issueClass,
      fixture: issue.fixture,
      code: issue.code,
      title: issue.title,
      decision: issue.decision,
    }));
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers, { nullValue: "-" });
}

function metricSampleCount(report, kind, maxMetric) {
  const summaryKey = kind === "rss" ? "rssSampleCount" : "cpuSampleCount";
  const summaryCount = report?.summary?.[summaryKey];
  if (Number.isFinite(summaryCount)) {
    return summaryCount;
  }
  const sampleCount = inferSampleCount(report?.samples, kind);
  if (sampleCount > 0) {
    return sampleCount;
  }
  return (report?.summary?.[maxMetric] ?? 0) > 0 ? 1 : 0;
}

function inferSampleCount(samples = [], kind) {
  if (!Array.isArray(samples)) {
    return 0;
  }
  return samples.reduce((sum, sample) => {
    if (kind === "rss") {
      return sum + (sample.rssSampleCount ?? (sample.peakRssMb > 0 ? 1 : 0));
    }
    return sum + (sample.cpuSampleCount ?? 0);
  }, 0);
}

function importLoopSummaryLabel(summary) {
  const metricLabel = summary.importLoopMetricBasis === "baseline-adjusted" ? "plugin delta" : "raw";
  return `p50 ${summary.importLoopP50Ms} ms / p95 ${summary.importLoopP95Ms} ms / ${metricLabel} RSS ${formatSampledMetric(summary.importLoopMaxRssMb, summary.importLoopRssSampleCount)} / ${metricLabel} CPU ${formatSampledMetric(summary.importLoopMaxCpuMs, summary.importLoopCpuSampleCount, "ms")}`;
}

function formatSampledMetric(value, count, unit = "MB") {
  if ((count ?? 0) <= 0) {
    return "n/a";
  }
  return `${value} ${unit}`;
}
