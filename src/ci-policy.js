import path from "node:path";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

export const defaultCiPolicyReportOptions = {
  generatedAt: "deterministic",
  jsonPath: "reports/plugin-inspector-ci-policy.json",
  markdownPath: "reports/plugin-inspector-ci-policy.md",
  reportTitle: "Plugin Inspector CI Policy",
};

export function buildCiPolicyReport(options = {}) {
  const policy = options.policy;
  validateCiPolicy(policy);

  const checks = [
    ...compatibilityChecks(options.compatibilityReport, { strict: options.strict }),
    ...refDiffChecks(options.refDiff, { strict: options.strict }),
    ...executionChecks(options.executionResults, policy, { strict: options.strict }),
  ].sort((left, right) => actionRank(left.action) - actionRank(right.action) || left.id.localeCompare(right.id));

  return {
    generatedAt: options.generatedAt ?? defaultCiPolicyReportOptions.generatedAt,
    status: checks.some((check) => check.action === "fail") ? "fail" : "pass",
    strict: Boolean(options.strict),
    policy: {
      allowedBlocked: policy.allowedBlocked.length,
      expectedWarnings: policy.expectedWarnings.length,
      fixtureSets: Object.keys(policy.fixtureSets).sort(),
      thresholds: policy.thresholds,
    },
    summary: {
      checkCount: checks.length,
      failCount: checks.filter((check) => check.action === "fail").length,
      warnCount: checks.filter((check) => check.action === "warn").length,
      passCount: checks.filter((check) => check.action === "pass").length,
    },
    checks,
  };
}

export function validateCiPolicy(policy) {
  const errors = [];
  if (policy?.version !== 1) {
    errors.push("ci policy version must be 1");
  }
  for (const key of ["allowedBlocked", "expectedWarnings"]) {
    if (!Array.isArray(policy?.[key])) {
      errors.push(`ci policy ${key} must be an array`);
    }
  }
  if (!policy?.thresholds || typeof policy.thresholds !== "object") {
    errors.push("ci policy thresholds are required");
  }
  if (!policy?.fixtureSets || typeof policy.fixtureSets !== "object") {
    errors.push("ci policy fixtureSets are required");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

export function validateCiPolicyReport(report) {
  return report.checks
    .filter((check) => check.action === "fail")
    .map((check) => `${check.id}: ${check.message}: ${check.evidence.join(", ")}`);
}

export async function writeCiPolicyReport(report, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jsonPath = resolveFromRoot(rootDir, options.jsonPath ?? defaultCiPolicyReportOptions.jsonPath);
  const markdownPath = resolveFromRoot(rootDir, options.markdownPath ?? defaultCiPolicyReportOptions.markdownPath);
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: report,
    markdown: renderCiPolicyMarkdown(report, options),
    check: options.check,
  });
}

export function renderCiPolicyMarkdown(report, options = {}) {
  const title = options.title ?? options.reportTitle ?? defaultCiPolicyReportOptions.reportTitle;
  return [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status.toUpperCase()}`,
    `Strict: ${report.strict}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Checks", report.summary.checkCount],
        ["Fail", report.summary.failCount],
        ["Warn", report.summary.warnCount],
        ["Pass", report.summary.passCount],
        ["Allowed blocked rules", report.policy.allowedBlocked],
        ["Expected warning rules", report.policy.expectedWarnings],
        ["Fixture sets", report.policy.fixtureSets.join(", ")],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Checks",
    "",
    markdownTable(
      report.checks.map((check) => [
        check.action,
        check.id,
        check.message,
        check.evidence.join(", ") || "-",
      ]),
      ["Action", "ID", "Message", "Evidence"],
    ),
  ].join("\n");
}

function compatibilityChecks(report, options) {
  const checks = [];
  if (!report) {
    checks.push({
      id: "compatibility-report.missing",
      action: "fail",
      message: "compatibility report is missing",
      evidence: [],
    });
    return checks;
  }
  checks.push({
    id: "compatibility-report.breakages",
    action: report.summary.breakageCount > 0 ? "fail" : "pass",
    message: `${report.summary.breakageCount} hard breakages`,
    evidence: (report.breakages ?? []).map((finding) => `${finding.fixture}:${finding.code}`),
  });
  checks.push({
    id: "compatibility-report.p1-issues",
    action: "pass",
    message: `${report.summary.p1IssueCount} P1 issues tracked`,
    evidence: (report.issues ?? [])
      .filter((issue) => issue.severity === "P1")
      .map((issue) => `${issue.fixture}:${issue.code}`),
  });
  const issues = report.issues ?? [];
  const liveP0Issues = issues.filter((issue) => issue.issueClass === "live-issue" && issue.severity === "P0");
  const deprecationWarnings = issues.filter((issue) => issue.issueClass === "deprecation-warning");
  const inspectorGaps = issues.filter((issue) => issue.issueClass === "inspector-gap");
  checks.push({
    id: "compatibility-report.live-p0-issues",
    action: liveP0Issues.length > 0 ? (options.strict ? "fail" : "warn") : "pass",
    message: `${liveP0Issues.length} live P0 issues tracked`,
    evidence: liveP0Issues.map((issue) => `${issue.fixture}:${issue.code}:${issue.compatStatus ?? "none"}`),
  });
  checks.push({
    id: "compatibility-report.deprecation-warnings",
    action: "pass",
    message: `${deprecationWarnings.length} deprecated compat seams tracked`,
    evidence: deprecationWarnings.map((issue) => `${issue.fixture}:${issue.code}`),
  });
  checks.push({
    id: "compatibility-report.inspector-gaps",
    action: "pass",
    message: `${inspectorGaps.length} inspector proof gaps tracked`,
    evidence: inspectorGaps.map((issue) => `${issue.fixture}:${issue.code}`),
  });
  return checks;
}

function refDiffChecks(refDiff, options) {
  if (!refDiff) {
    return [
      {
        id: "ref-diff.not-run",
        action: "pass",
        message: "ref diff artifact was not present for this CI mode",
        evidence: [],
      },
    ];
  }

  return (refDiff.regressions ?? []).map((regression) => ({
    id: `ref-diff.${regression.code}`,
    action: regression.action === "fail" || (options.strict && regression.action === "warn") ? "fail" : "warn",
    message: regression.message,
    evidence: regression.evidence ?? [],
  }));
}

function executionChecks(executionResults, policy, options) {
  if (!executionResults) {
    return [
      {
        id: "execution-results.not-run",
        action: "pass",
        message: "isolated execution artifact was not present for this CI mode",
        evidence: [],
      },
    ];
  }

  const checks = [
    {
      id: "execution-results.failures",
      action: executionResults.summary.failCount > 0 ? "fail" : "pass",
      message: `${executionResults.summary.failCount} failed synthetic probes`,
      evidence: failedExecutionEvidence(executionResults),
    },
    {
      id: "execution-results.audit-findings",
      action: executionResults.summary.auditFindingCount > 0 ? "warn" : "pass",
      message: `${executionResults.summary.auditFindingCount ?? 0} package audit findings`,
      evidence: executionResults.artifacts
        .filter((artifact) => artifact.kind === "audit" && artifact.findingCount > 0)
        .map((artifact) => `${artifact.fixture}:${artifact.findingCount}`),
    },
  ];

  const blocked = executionResults.artifacts.flatMap((artifact) =>
    (artifact.blocked ?? []).map((item) => ({ artifact, item })),
  );
  for (const blockedItem of blocked) {
    const expectedWarning = findPolicyMatch(policy.expectedWarnings, blockedItem.item);
    const allowedBlocked = findPolicyMatch(policy.allowedBlocked, blockedItem.item);
    const match = expectedWarning ?? allowedBlocked;
    checks.push({
      id: `execution-results.blocked.${blockedItem.artifact.fixture}.${blockedItem.item.seam}.${blockedItem.item.captureIndex}`,
      action: match ? (options.strict ? "fail" : "warn") : "fail",
      message: match
        ? `${match.decision}: ${blockedItem.item.reason}`
        : `unknown blocked synthetic probe: ${blockedItem.item.reason}`,
      evidence: [
        blockedItem.artifact.artifactPath,
        blockedItem.item.seam,
        blockedItem.item.reason,
        match?.id ?? "unclassified",
      ],
    });
  }
  return checks;
}

function findPolicyMatch(rules, item) {
  return rules.find((rule) => item.seam === rule.seam && item.reason?.includes(rule.reasonIncludes));
}

function failedExecutionEvidence(executionResults) {
  return executionResults.artifacts.flatMap((artifact) =>
    (artifact.failures ?? []).map((failure) => `${artifact.fixture}:${failure.seam}:${failure.error}`),
  );
}

function actionRank(value) {
  return { fail: 0, warn: 1, pass: 2 }[value] ?? 3;
}

function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
