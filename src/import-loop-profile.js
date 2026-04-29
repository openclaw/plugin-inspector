import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { resolveFromRoot } from "./path-utils.js";
import { runProfiledProcess } from "./process-profile.js";
import { assertRunCount, percentile } from "./stats.js";

const defaultCliPath = fileURLToPath(new URL("./cli.js", import.meta.url));

export const defaultImportLoopProfileOptions = {
  entrypoint: "test/fixtures/lazy-import-plugin.mjs",
  generatedAt: "deterministic",
  jsonPath: "reports/plugin-import-loop-profile.json",
  markdownPath: "reports/plugin-import-loop-profile.md",
  outputDir: ".plugin-inspector/import-loop",
  reportTitle: "Plugin Import Loop Profile",
  runs: 3,
};

export async function buildImportLoopProfile(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runs = options.runs ?? defaultImportLoopProfileOptions.runs;
  const entrypoint = options.entrypoint ?? defaultImportLoopProfileOptions.entrypoint;
  assertRunCount(runs, 20);

  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    samples.push(await runCaptureSample({ ...options, entrypoint, index, rootDir }));
  }

  const wallMs = samples.map((sample) => sample.wallMs).sort((left, right) => left - right);
  const rssSampleCount = samples.reduce((sum, sample) => sum + (sample.rssSampleCount ?? (sample.peakRssMb > 0 ? 1 : 0)), 0);
  const cpuSampleCount = samples.reduce((sum, sample) => sum + (sample.cpuSampleCount ?? 0), 0);
  const statSampleCount = samples.reduce((sum, sample) => sum + (sample.statSampleCount ?? 0), 0);
  return {
    generatedAt: options.generatedAt ?? defaultImportLoopProfileOptions.generatedAt,
    mode: options.mode ?? "subprocess-cold-import-loop",
    entrypoint,
    summary: {
      runs,
      p50WallMs: percentile(wallMs, 0.5),
      p95WallMs: percentile(wallMs, 0.95),
      maxPeakRssMb: Math.max(0, ...samples.map((sample) => sample.peakRssMb)),
      maxCpuMsEstimate: Math.max(0, ...samples.map((sample) => sample.cpuMsEstimate)),
      statSampleCount,
      rssSampleCount,
      cpuSampleCount,
      capturedCount: samples.reduce((sum, sample) => sum + sample.capturedCount, 0),
      failCount: samples.filter((sample) => sample.exitCode !== 0 || sample.status !== "captured").length,
    },
    samples,
  };
}

export function validateImportLoopProfile(report) {
  const errors = [];
  if (report.summary.failCount > 0) {
    errors.push(`import loop has ${report.summary.failCount} failed sample(s)`);
  }
  if (report.summary.capturedCount < report.summary.runs) {
    errors.push("import loop did not capture at least one contract per run");
  }
  if (report.summary.p50WallMs <= 0) {
    errors.push("import loop is missing wall-time samples");
  }
  return errors;
}

export async function writeImportLoopProfile(report, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jsonPath = resolveFromRoot(rootDir, options.jsonPath ?? defaultImportLoopProfileOptions.jsonPath);
  const markdownPath = resolveFromRoot(rootDir, options.markdownPath ?? defaultImportLoopProfileOptions.markdownPath);
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: report,
    markdown: renderImportLoopProfileMarkdown(report, options),
    check: options.check,
  });
}

export function renderImportLoopProfileMarkdown(report, options = {}) {
  const title = options.title ?? options.reportTitle ?? defaultImportLoopProfileOptions.reportTitle;
  return [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Entrypoint: ${report.entrypoint}`,
    "",
    "## Summary",
    "",
    markdownTable(summaryRows(report), ["Metric", "Value"]),
    "",
    "## Samples",
    "",
    markdownTable(
      report.samples.map((sample) => [
        sample.index,
        sample.status,
        sample.capturedCount,
        `${sample.wallMs} ms`,
        formatSampledMetric(sample.peakRssMb, sample.rssSampleCount),
        formatSampledMetric(sample.cpuMsEstimate, sample.cpuSampleCount, "ms"),
        `${sample.rssSampleCount ?? 0}/${sample.cpuSampleCount ?? 0}`,
        sample.exitCode,
      ]),
      ["Run", "Status", "Captured", "Wall", "Peak RSS", "CPU Estimate", "RSS/CPU samples", "Exit"],
    ),
  ].join("\n");
}

async function runCaptureSample(options) {
  const outputDir = resolveFromRoot(
    options.rootDir,
    options.outputDir ?? defaultImportLoopProfileOptions.outputDir,
  );
  const outputPath = path.join(outputDir, `capture-${options.index}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const command = buildCaptureCommand({ ...options, outputPath });
  const profile = await runProfiledProcess({
    command: command.command,
    args: command.args,
    cwd: command.cwd ?? options.rootDir,
    env: { ...process.env, ...command.env },
  });
  const output = profile.exitCode === 0 ? await readCaptureOutput(outputPath) : null;

  return {
    index: options.index,
    exitCode: profile.exitCode,
    status: output?.status ?? "failed",
    capturedCount: output?.captured?.length ?? 0,
    wallMs: profile.wallMs,
    peakRssMb: profile.peakRssMb,
    peakCpuPercent: profile.peakCpuPercent,
    cpuMsEstimate: profile.cpuMsEstimate,
    statSampleCount: profile.statSampleCount,
    rssSampleCount: profile.rssSampleCount,
    cpuSampleCount: profile.cpuSampleCount,
    stderrPreview: profile.stderrPreview,
  };
}

function summaryRows(report) {
  return [
    ["runs", report.summary.runs],
    ["p50WallMs", report.summary.p50WallMs],
    ["p95WallMs", report.summary.p95WallMs],
    ["maxPeakRssMb", formatSampledMetric(report.summary.maxPeakRssMb, report.summary.rssSampleCount)],
    ["maxCpuMsEstimate", formatSampledMetric(report.summary.maxCpuMsEstimate, report.summary.cpuSampleCount, "ms")],
    ["statSampleCount", report.summary.statSampleCount ?? 0],
    ["rssSampleCount", report.summary.rssSampleCount ?? 0],
    ["cpuSampleCount", report.summary.cpuSampleCount ?? 0],
    ["capturedCount", report.summary.capturedCount],
    ["failCount", report.summary.failCount],
  ];
}

function formatSampledMetric(value, count, unit = "MB") {
  if ((count ?? 0) <= 0) {
    return "n/a";
  }
  return `${value} ${unit}`;
}

function buildCaptureCommand(options) {
  if (typeof options.captureCommand === "function") {
    return options.captureCommand({
      entrypoint: options.entrypoint,
      index: options.index,
      outputPath: options.outputPath,
      rootDir: options.rootDir,
    });
  }
  if (options.captureScript) {
    return {
      command: process.execPath,
      args: [options.captureScript, options.entrypoint, "--output", options.outputPath],
      cwd: options.rootDir,
      env: { [options.optInEnv ?? "PLUGIN_INSPECTOR_EXECUTE_ISOLATED"]: "1", ...options.captureEnv },
    };
  }
  return {
    command: process.execPath,
    args: [defaultCliPath, "capture", options.entrypoint, "--output", options.outputPath],
    cwd: options.rootDir,
    env: { PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1", ...options.captureEnv },
  };
}

async function readCaptureOutput(outputPath) {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(outputPath, "utf8"));
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
