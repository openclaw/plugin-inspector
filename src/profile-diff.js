import path from "node:path";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { readJsonFile, readOptionalJsonFile } from "./json-file.js";
import { resolveRequiredFromRoot } from "./path-utils.js";

export const defaultProfileDiffOptions = {
  baselinePath: "baselines/runtime/main.json",
  generatedAt: "deterministic",
  jsonPath: "reports/plugin-runtime-profile-diff.json",
  markdownPath: "reports/plugin-runtime-profile-diff.md",
  policyPath: "plugin-inspector.policy.json",
  reportTitle: "Plugin Runtime Profile Diff",
};

export async function buildProfileDiff(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const policy =
    options.policy ?? (await readJsonFile(profileDiffPath(rootDir, options.policyPath ?? defaultProfileDiffOptions.policyPath)));
  const current = options.current ?? (await readJsonFile(profileDiffPath(rootDir, options.currentPath)));
  const baseline =
    options.baseline ??
    (await readOptionalJsonFile(profileDiffPath(rootDir, options.baselinePath ?? defaultProfileDiffOptions.baselinePath)));
  const checks = baseline ? compareProfiles({ baseline, current, policy, strict: options.strict }) : [];

  if (!baseline) {
    checks.push({
      id: "profile.baseline.missing",
      action: "warn",
      metric: "baseline",
      message: "runtime profile baseline is missing",
      baseline: null,
      current: null,
      delta: null,
    });
  }

  return {
    generatedAt: options.generatedAt ?? defaultProfileDiffOptions.generatedAt,
    status: checks.some((check) => check.action === "fail") ? "fail" : "pass",
    strict: Boolean(options.strict),
    baseline: baseline ? profileSummary(baseline) : null,
    current: profileSummary(current),
    thresholds: policy.thresholds,
    summary: {
      checkCount: checks.length,
      failCount: checks.filter((check) => check.action === "fail").length,
      warnCount: checks.filter((check) => check.action === "warn").length,
      passCount: checks.filter((check) => check.action === "pass").length,
    },
    checks,
  };
}

export function validateProfileDiff(diff) {
  return diff.checks
    .filter((check) => check.action === "fail")
    .map((check) => `${check.id}: ${check.message}: baseline=${check.baseline}, current=${check.current}`);
}

export async function writeProfileDiff(diff, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jsonPath = profileDiffPath(rootDir, options.jsonPath ?? defaultProfileDiffOptions.jsonPath);
  const markdownPath = profileDiffPath(rootDir, options.markdownPath ?? defaultProfileDiffOptions.markdownPath);
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: diff,
    markdown: renderProfileDiffMarkdown(diff, options),
    check: options.check,
  });
}

export function renderProfileDiffMarkdown(diff, options = {}) {
  const title = options.title ?? options.reportTitle ?? defaultProfileDiffOptions.reportTitle;
  return [
    `# ${title}`,
    "",
    `Generated: ${diff.generatedAt}`,
    `Status: ${diff.status.toUpperCase()}`,
    `Strict: ${diff.strict}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Checks", diff.summary.checkCount],
        ["Fail", diff.summary.failCount],
        ["Warn", diff.summary.warnCount],
        ["Pass", diff.summary.passCount],
        ["Current runs", diff.current.runs],
        ["Baseline runs", diff.baseline?.runs ?? "-"],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Checks",
    "",
    markdownTable(
      diff.checks.map((check) => [
        check.action,
        check.id,
        check.metric,
        check.baseline ?? "-",
        check.current ?? "-",
        check.delta ?? "-",
        check.percent === undefined ? "-" : `${check.percent}%`,
        check.message,
      ]),
      ["Action", "ID", "Metric", "Baseline", "Current", "Delta", "Percent", "Message"],
    ),
  ].join("\n");
}

function compareProfiles({ baseline, current, policy, strict }) {
  const thresholds = policy.thresholds;
  const strictEligible = current.runs >= thresholds.strictMinimumSamples;
  return [
    percentCheck({
      id: "profile.wall-p95",
      metric: "p95WallMs",
      baseline: baseline.summary.p95WallMs,
      current: current.summary.p95WallMs,
      threshold: thresholds.wallP95RegressionPercent,
      strict,
      strictEligible,
    }),
    absoluteCheck({
      id: "profile.peak-rss",
      metric: "maxPeakRssMb",
      baseline: baseline.summary.maxPeakRssMb,
      current: current.summary.maxPeakRssMb,
      threshold: thresholds.peakRssRegressionMb,
      strict,
      strictEligible,
    }),
    absoluteCheck({
      id: "profile.node-boot",
      metric: "nodeBootWallMs",
      baseline: commandWall(baseline, "node-boot"),
      current: commandWall(current, "node-boot"),
      threshold: thresholds.bootRegressionMs,
      strict,
      strictEligible,
    }),
    ...registrySurfaceChecks(baseline, current),
  ];
}

function percentCheck({ id, metric, baseline, current, threshold, strict, strictEligible }) {
  const delta = current - baseline;
  const percent = baseline > 0 ? Math.round((delta / baseline) * 1000) / 10 : 0;
  const exceeded = delta > 0 && percent > threshold;
  return {
    id,
    action: exceeded ? (strict && strictEligible ? "fail" : "warn") : "pass",
    metric,
    message: exceeded
      ? `${metric} regressed ${percent}% over baseline`
      : `${metric} stayed within ${threshold}% regression threshold`,
    baseline,
    current,
    delta,
    percent,
  };
}

function absoluteCheck({ id, metric, baseline, current, threshold, strict, strictEligible }) {
  const delta = current - baseline;
  const exceeded = delta > threshold;
  return {
    id,
    action: exceeded ? (strict && strictEligible ? "fail" : "warn") : "pass",
    metric,
    message: exceeded
      ? `${metric} regressed ${delta} over baseline`
      : `${metric} stayed within ${threshold} absolute regression threshold`,
    baseline,
    current,
    delta,
  };
}

function registrySurfaceChecks(baseline, current) {
  return [
    "compatRecords",
    "hookNames",
    "apiRegistrars",
    "capturedRegistrars",
    "sdkExports",
    "manifestFields",
    "manifestContractFields",
  ].map((metric) => ({
    id: `registry.${metric}`,
    action: "pass",
    metric,
    message: "registry surface delta is tracked as context",
    baseline: registrySurfaceCount(baseline.targetOpenClaw[metric]),
    current: registrySurfaceCount(current.targetOpenClaw[metric]),
    delta: registrySurfaceCount(current.targetOpenClaw[metric]) - registrySurfaceCount(baseline.targetOpenClaw[metric]),
  }));
}

function registrySurfaceCount(value) {
  return Array.isArray(value) ? value.length : Number(value ?? 0);
}

function commandWall(profile, commandId) {
  return profile.commands.find((command) => command.id === commandId)?.wallMs?.median ?? 0;
}

function profileSummary(profile) {
  return {
    runs: profile.runs,
    summary: profile.summary,
    targetOpenClaw: profile.targetOpenClaw,
    fixtureInventory: profile.fixtureInventory,
  };
}

function profileDiffPath(rootDir, candidatePath) {
  return resolveRequiredFromRoot(rootDir, candidatePath, "profile diff");
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
