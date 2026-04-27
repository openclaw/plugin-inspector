import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

export const defaultExecutionResultsOptions = {
  generatedAt: "deterministic",
  markdownPath: "reports/plugin-execution-results.md",
  reportTitle: "Plugin Execution Results",
  resultsDir: ".plugin-inspector/results",
  jsonPath: "reports/plugin-execution-results.json",
};

export async function buildExecutionResultsReport(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const resultsDir = resolveFromRoot(rootDir, options.resultsDir ?? defaultExecutionResultsOptions.resultsDir);
  const artifacts = existsSync(resultsDir) ? await readArtifacts(resultsDir, { rootDir }) : [];
  const syntheticArtifacts = artifacts.filter((artifact) => artifact.kind === "synthetic");
  const captureArtifacts = artifacts.filter((artifact) => artifact.kind === "capture");
  const auditArtifacts = artifacts.filter((artifact) => artifact.kind === "audit");
  const profileArtifacts = artifacts.filter((artifact) => artifact.kind === "profile");

  return {
    generatedAt: options.generatedAt ?? defaultExecutionResultsOptions.generatedAt,
    resultsDir: repoRelative(resultsDir, { rootDir }),
    summary: {
      artifactCount: artifacts.length,
      captureArtifactCount: captureArtifacts.length,
      syntheticArtifactCount: syntheticArtifacts.length,
      auditArtifactCount: auditArtifacts.length,
      profileArtifactCount: profileArtifacts.length,
      capturedRegistrationCount: captureArtifacts.reduce(
        (sum, artifact) => sum + (artifact.capturedCount ?? 0),
        0,
      ),
      auditFindingCount: auditArtifacts.reduce((sum, artifact) => sum + artifact.findingCount, 0),
      executionWallMs: profileArtifacts.reduce((sum, artifact) => sum + (artifact.summary?.totalWallMs ?? 0), 0),
      maxPeakRssMb: Math.max(0, ...profileArtifacts.map((artifact) => artifact.summary?.maxPeakRssMb ?? 0)),
      maxCpuMsEstimate: Math.max(0, ...profileArtifacts.map((artifact) => artifact.summary?.maxCpuMsEstimate ?? 0)),
      passCount: syntheticArtifacts.reduce((sum, artifact) => sum + (artifact.summary?.passCount ?? 0), 0),
      failCount: syntheticArtifacts.reduce((sum, artifact) => sum + (artifact.summary?.failCount ?? 0), 0),
      blockedCount: syntheticArtifacts.reduce((sum, artifact) => sum + (artifact.summary?.blockedCount ?? 0), 0),
    },
    artifacts,
  };
}

export async function writeExecutionResultsReport(report, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jsonPath = resolveFromRoot(rootDir, options.jsonPath ?? defaultExecutionResultsOptions.jsonPath);
  const markdownPath = resolveFromRoot(rootDir, options.markdownPath ?? defaultExecutionResultsOptions.markdownPath);
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: report,
    markdown: renderExecutionResultsMarkdown(report, options),
    check: options.check,
  });
}

export function renderExecutionResultsMarkdown(report, options = {}) {
  const title = options.title ?? options.reportTitle ?? defaultExecutionResultsOptions.reportTitle;
  return [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Results dir: ${report.resultsDir}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Artifacts", report.summary.artifactCount],
        ["Capture artifacts", report.summary.captureArtifactCount],
        ["Synthetic artifacts", report.summary.syntheticArtifactCount],
        ["Audit artifacts", report.summary.auditArtifactCount],
        ["Profile artifacts", report.summary.profileArtifactCount],
        ["Captured registrations/hooks", report.summary.capturedRegistrationCount],
        ["Audit findings", report.summary.auditFindingCount],
        ["Execution wall", `${report.summary.executionWallMs} ms`],
        ["Max peak RSS", `${report.summary.maxPeakRssMb} MB`],
        ["Max CPU estimate", `${report.summary.maxCpuMsEstimate} ms`],
        ["Pass", report.summary.passCount],
        ["Fail", report.summary.failCount],
        ["Blocked", report.summary.blockedCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Artifacts",
    "",
    markdownTable(
      report.artifacts.map((artifact) => [
        artifact.fixture,
        artifact.kind,
        artifact.status,
        artifact.entrypoint,
        summarizeArtifactResult(artifact),
        artifact.artifactPath,
      ]),
      ["Fixture", "Kind", "Status", "Entrypoint", "Result", "Artifact"],
    ),
    "",
    "## Blocked Synthetic Probes",
    "",
    markdownTable(
      report.artifacts.flatMap((artifact) =>
        (artifact.blocked ?? []).map((item) => [
          artifact.fixture,
          item.kind,
          item.seam,
          item.label,
          item.reason,
          artifact.artifactPath,
        ]),
      ),
      ["Fixture", "Kind", "Seam", "Label", "Reason", "Artifact"],
    ),
    "",
    "## Failed Synthetic Probes",
    "",
    markdownTable(
      report.artifacts.flatMap((artifact) =>
        (artifact.failures ?? []).map((item) => [
          artifact.fixture,
          item.kind,
          item.seam,
          item.label,
          item.error,
          artifact.artifactPath,
        ]),
      ),
      ["Fixture", "Kind", "Seam", "Label", "Error", "Artifact"],
    ),
    "",
    "## Dependency Audit Artifacts",
    "",
    markdownTable(
      report.artifacts
        .filter((artifact) => artifact.kind === "audit")
        .map((artifact) => [
          artifact.fixture,
          artifact.findingCount,
          artifact.vulnerabilities ? JSON.stringify(artifact.vulnerabilities) : "-",
          artifact.artifactPath,
        ]),
      ["Fixture", "Findings", "Vulnerabilities", "Artifact"],
    ),
    "",
    "## Execution Profiles",
    "",
    markdownTable(
      report.artifacts.flatMap((artifact) =>
        (artifact.slowestSteps ?? []).map((step) => [
          artifact.fixture,
          step.kind,
          `${step.wallMs} ms`,
          `${step.peakRssMb} MB`,
          `${step.cpuMsEstimate} ms`,
          step.command,
        ]),
      ),
      ["Fixture", "Step", "Wall", "Peak RSS", "CPU Estimate", "Command"],
    ),
  ].join("\n");
}

async function readArtifacts(resultsDir, options) {
  const paths = await listJsonFiles(resultsDir);
  const artifacts = [];
  for (const artifactPath of paths) {
    const parsed = JSON.parse(await readFile(artifactPath, "utf8"));
    const relativePath = repoRelative(artifactPath, options);
    artifacts.push(summarizeArtifact({ artifactPath: relativePath, parsed, rootDir: options.rootDir }));
  }
  return artifacts.sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

async function listJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

function summarizeArtifact({ artifactPath, parsed, rootDir }) {
  const normalizedArtifactPath = toRepoPath(artifactPath);
  const kind = normalizedArtifactPath.endsWith(".synthetic.json")
    ? "synthetic"
    : normalizedArtifactPath.endsWith("package-audit.json")
      ? "audit"
      : normalizedArtifactPath.endsWith("execution-profile.json")
        ? "profile"
        : "capture";
  const fixture = normalizedArtifactPath.split("/").at(-2) ?? "unknown";
  if (kind === "synthetic") {
    return {
      artifactPath: normalizedArtifactPath,
      fixture,
      kind,
      entrypoint: scrubPath(parsed.entrypoint, { rootDir }),
      status: parsed.status,
      summary: parsed.summary,
      failures: (parsed.results ?? []).filter((result) => result.status === "fail"),
      blocked: (parsed.results ?? []).filter((result) => result.status === "blocked"),
    };
  }
  if (kind === "audit") {
    return {
      artifactPath: normalizedArtifactPath,
      fixture,
      kind,
      entrypoint: "-",
      status: "warning",
      findingCount: auditFindingCount(parsed),
      vulnerabilities: parsed.metadata?.vulnerabilities ?? null,
    };
  }
  if (kind === "profile") {
    return {
      artifactPath: normalizedArtifactPath,
      fixture,
      kind,
      entrypoint: "-",
      status: parsed.summary?.failCount > 0 ? "fail" : "pass",
      summary: parsed.summary,
      slowestSteps: [...(parsed.steps ?? [])].sort((left, right) => right.wallMs - left.wallMs).slice(0, 5),
    };
  }
  return {
    artifactPath: normalizedArtifactPath,
    fixture,
    kind,
    entrypoint: scrubPath(parsed.entrypoint, { rootDir }),
    status: parsed.status,
    capturedCount: parsed.captured?.length ?? 0,
    captured: (parsed.captured ?? []).map((item) => `${item.kind}:${item.name}`),
  };
}

function summarizeArtifactResult(artifact) {
  if (artifact.kind === "audit") {
    return `${artifact.findingCount} audit findings`;
  }
  if (artifact.kind === "profile") {
    return `${artifact.summary?.stepCount ?? 0} steps / ${artifact.summary?.totalWallMs ?? 0} ms / ${artifact.summary?.maxPeakRssMb ?? 0} MB`;
  }
  if (artifact.summary) {
    return `${artifact.summary.passCount} pass / ${artifact.summary.failCount} fail / ${artifact.summary.blockedCount} blocked`;
  }
  return `${artifact.capturedCount} captured`;
}

function auditFindingCount(parsed) {
  const vulnerabilities = parsed.metadata?.vulnerabilities;
  if (vulnerabilities && typeof vulnerabilities === "object") {
    const severityTotal = Object.entries(vulnerabilities)
      .filter(([key]) => key !== "total")
      .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
    return severityTotal || Number(vulnerabilities.total) || 0;
  }
  if (Array.isArray(parsed.vulnerabilities)) {
    return parsed.vulnerabilities.length;
  }
  if (parsed.vulnerabilities && typeof parsed.vulnerabilities === "object") {
    return Object.keys(parsed.vulnerabilities).length;
  }
  return 0;
}

function scrubPath(value, options) {
  return typeof value === "string" ? repoRelative(value, options) : value;
}

function repoRelative(value, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const absolute = path.resolve(value);
  const relative = path.relative(rootDir, absolute);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return toRepoPath(relative || ".");
  }
  return toRepoPath(value);
}

function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function toRepoPath(value) {
  return String(value).replaceAll("\\", "/").replaceAll(path.sep, "/");
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
