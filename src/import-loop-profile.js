import { mkdir, writeFile } from "node:fs/promises";
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

  const baseline = await buildBaselineProfile({ ...options, rootDir, runs });
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const sample = await runCaptureSample({ ...options, entrypoint, index, rootDir });
    samples.push(applyBaselineAdjustment(sample, baseline));
  }

  const wallMs = samples.map((sample) => sample.wallMs).sort((left, right) => left - right);
  const pluginWallDeltaMs = samples.map((sample) => sample.pluginWallDeltaMs).sort((left, right) => left - right);
  const rssSampleCount = samples.reduce((sum, sample) => sum + (sample.rssSampleCount ?? (sample.peakRssMb > 0 ? 1 : 0)), 0);
  const cpuSampleCount = samples.reduce((sum, sample) => sum + (sample.cpuSampleCount ?? 0), 0);
  const statSampleCount = samples.reduce((sum, sample) => sum + (sample.statSampleCount ?? 0), 0);
  return {
    generatedAt: options.generatedAt ?? defaultImportLoopProfileOptions.generatedAt,
    mode: options.mode ?? "baseline-adjusted-cold-capture-loop",
    entrypoint,
    baseline,
    summary: {
      runs,
      baselineRuns: baseline.runs,
      baselineFailCount: baseline.failCount,
      p50WallMs: percentile(wallMs, 0.5),
      p95WallMs: percentile(wallMs, 0.95),
      p50PluginWallDeltaMs: percentile(pluginWallDeltaMs, 0.5),
      p95PluginWallDeltaMs: percentile(pluginWallDeltaMs, 0.95),
      maxPeakRssMb: Math.max(0, ...samples.map((sample) => sample.peakRssMb)),
      maxCpuMsEstimate: Math.max(0, ...samples.map((sample) => sample.cpuMsEstimate)),
      maxPluginPeakRssDeltaMb: Math.max(0, ...samples.map((sample) => sample.pluginPeakRssDeltaMb)),
      maxPluginCpuDeltaMsEstimate: Math.max(0, ...samples.map((sample) => sample.pluginCpuDeltaMsEstimate)),
      baselineReferenceWallMs: baseline.reference.wallMs,
      baselineReferencePeakRssMb: baseline.reference.peakRssMb,
      baselineReferenceCpuMsEstimate: baseline.reference.cpuMsEstimate,
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
  if ((report.summary.baselineFailCount ?? report.baseline?.failCount ?? 0) > 0) {
    errors.push("import loop baseline capture failed");
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
    "## Harness Baseline",
    "",
    markdownTable(baselineRows(report), ["Metric", "Value"]),
    "",
    "## Samples",
    "",
    markdownTable(
      report.samples.map((sample) => [
        sample.index,
        sample.status,
        sample.capturedCount,
        formatOptionalMetric(sample.pluginWallDeltaMs, "ms"),
        formatSampledMetric(sample.pluginPeakRssDeltaMb, sample.rssSampleCount),
        formatSampledMetric(sample.pluginCpuDeltaMsEstimate, sample.cpuSampleCount, "ms"),
        `${sample.wallMs} ms`,
        formatSampledMetric(sample.peakRssMb, sample.rssSampleCount),
        formatSampledMetric(sample.cpuMsEstimate, sample.cpuSampleCount, "ms"),
        `${sample.rssSampleCount ?? 0}/${sample.cpuSampleCount ?? 0}`,
        sample.exitCode,
      ]),
      [
        "Run",
        "Status",
        "Captured",
        "Plugin Wall Delta",
        "Plugin RSS Delta",
        "Plugin CPU Delta",
        "Raw Wall",
        "Raw Peak RSS",
        "Raw CPU Estimate",
        "RSS/CPU samples",
        "Exit",
      ],
    ),
  ].join("\n");
}

async function buildBaselineProfile(options) {
  const baselineRuns = options.baseline === false ? 0 : options.baselineRuns ?? Math.min(options.runs, 3);
  if (baselineRuns <= 0) {
    return emptyBaseline();
  }

  const entrypoint = await writeBaselineEntrypoint(options);
  const samples = [];
  for (let index = 0; index < baselineRuns; index += 1) {
    samples.push(
      await runCaptureSample({
        ...options,
        entrypoint,
        index,
        sampleName: "baseline",
        rootDir: options.rootDir,
      }),
    );
  }

  const wallMs = sortedMetric(samples, "wallMs");
  const peakRssMb = sortedMetric(samples, "peakRssMb");
  const cpuMsEstimate = sortedMetric(samples, "cpuMsEstimate");
  return {
    mode: "minimal-plugin-capture",
    runs: baselineRuns,
    entrypoint: path.relative(options.rootDir, entrypoint),
    reference: {
      wallMs: percentile(wallMs, 0.5),
      peakRssMb: percentile(peakRssMb, 0.5),
      cpuMsEstimate: percentile(cpuMsEstimate, 0.5),
    },
    max: {
      wallMs: wallMs.at(-1) ?? 0,
      peakRssMb: peakRssMb.at(-1) ?? 0,
      cpuMsEstimate: cpuMsEstimate.at(-1) ?? 0,
    },
    statSampleCount: samples.reduce((sum, sample) => sum + (sample.statSampleCount ?? 0), 0),
    rssSampleCount: samples.reduce((sum, sample) => sum + (sample.rssSampleCount ?? 0), 0),
    cpuSampleCount: samples.reduce((sum, sample) => sum + (sample.cpuSampleCount ?? 0), 0),
    failCount: samples.filter((sample) => sample.exitCode !== 0 || sample.status !== "captured").length,
    samples,
  };
}

function emptyBaseline() {
  return {
    mode: "disabled",
    runs: 0,
    entrypoint: null,
    reference: {
      wallMs: 0,
      peakRssMb: 0,
      cpuMsEstimate: 0,
    },
    max: {
      wallMs: 0,
      peakRssMb: 0,
      cpuMsEstimate: 0,
    },
    statSampleCount: 0,
    rssSampleCount: 0,
    cpuSampleCount: 0,
    failCount: 0,
    samples: [],
  };
}

async function writeBaselineEntrypoint(options) {
  const outputDir = resolveFromRoot(
    options.rootDir,
    options.outputDir ?? defaultImportLoopProfileOptions.outputDir,
  );
  const baselinePath = path.join(outputDir, "baseline-plugin.mjs");
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(
    baselinePath,
    [
      "export default {",
      "  register(api) {",
      "    api.registerTool({ name: 'baseline_tool', inputSchema: { type: 'object' }, run() {} });",
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  return baselinePath;
}

async function runCaptureSample(options) {
  const outputDir = resolveFromRoot(
    options.rootDir,
    options.outputDir ?? defaultImportLoopProfileOptions.outputDir,
  );
  const outputPath = path.join(outputDir, `${options.sampleName ?? "capture"}-${options.index}.json`);
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
    ["baselineRuns", report.summary.baselineRuns ?? report.baseline?.runs ?? 0],
    ["baselineFailCount", report.summary.baselineFailCount ?? report.baseline?.failCount ?? 0],
    ["p50WallMs", report.summary.p50WallMs],
    ["p95WallMs", report.summary.p95WallMs],
    ...(Number.isFinite(report.summary.p50PluginWallDeltaMs)
      ? [
          ["p50PluginWallDeltaMs", report.summary.p50PluginWallDeltaMs],
          ["p95PluginWallDeltaMs", report.summary.p95PluginWallDeltaMs],
          ["maxPluginPeakRssDeltaMb", formatSampledMetric(report.summary.maxPluginPeakRssDeltaMb, report.summary.rssSampleCount)],
          [
            "maxPluginCpuDeltaMsEstimate",
            formatSampledMetric(report.summary.maxPluginCpuDeltaMsEstimate, report.summary.cpuSampleCount, "ms"),
          ],
        ]
      : []),
    ["maxPeakRssMb", formatSampledMetric(report.summary.maxPeakRssMb, report.summary.rssSampleCount)],
    ["maxCpuMsEstimate", formatSampledMetric(report.summary.maxCpuMsEstimate, report.summary.cpuSampleCount, "ms")],
    ...(Number.isFinite(report.summary.baselineReferenceWallMs)
      ? [
          ["baselineReferenceWallMs", `${report.summary.baselineReferenceWallMs} ms`],
          ["baselineReferencePeakRssMb", formatSampledMetric(report.summary.baselineReferencePeakRssMb, report.baseline?.rssSampleCount ?? 0)],
          [
            "baselineReferenceCpuMsEstimate",
            formatSampledMetric(report.summary.baselineReferenceCpuMsEstimate, report.baseline?.cpuSampleCount ?? 0, "ms"),
          ],
        ]
      : []),
    ["statSampleCount", report.summary.statSampleCount ?? 0],
    ["rssSampleCount", report.summary.rssSampleCount ?? 0],
    ["cpuSampleCount", report.summary.cpuSampleCount ?? 0],
    ["capturedCount", report.summary.capturedCount],
    ["failCount", report.summary.failCount],
  ];
}

function baselineRows(report) {
  const baseline = report.baseline ?? emptyBaseline();
  return [
    ["mode", baseline.mode],
    ["runs", baseline.runs],
    ["entrypoint", baseline.entrypoint ?? "-"],
    ["referenceWallMs", `${baseline.reference?.wallMs ?? 0} ms`],
    ["referencePeakRssMb", formatSampledMetric(baseline.reference?.peakRssMb ?? 0, baseline.rssSampleCount)],
    ["referenceCpuMsEstimate", formatSampledMetric(baseline.reference?.cpuMsEstimate ?? 0, baseline.cpuSampleCount, "ms")],
    ["maxWallMs", `${baseline.max?.wallMs ?? 0} ms`],
    ["maxPeakRssMb", formatSampledMetric(baseline.max?.peakRssMb ?? 0, baseline.rssSampleCount)],
    ["maxCpuMsEstimate", formatSampledMetric(baseline.max?.cpuMsEstimate ?? 0, baseline.cpuSampleCount, "ms")],
    ["statSampleCount", baseline.statSampleCount ?? 0],
    ["failCount", baseline.failCount ?? 0],
  ];
}

function formatSampledMetric(value, count, unit = "MB") {
  if ((count ?? 0) <= 0) {
    return "n/a";
  }
  return `${value} ${unit}`;
}

function formatOptionalMetric(value, unit) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value} ${unit}`;
}

function applyBaselineAdjustment(sample, baseline) {
  return {
    ...sample,
    pluginWallDeltaMs: roundNonNegative(sample.wallMs - baseline.reference.wallMs, 0),
    pluginPeakRssDeltaMb: roundNonNegative(sample.peakRssMb - baseline.reference.peakRssMb, 1),
    pluginCpuDeltaMsEstimate: roundNonNegative(sample.cpuMsEstimate - baseline.reference.cpuMsEstimate, 0),
  };
}

function sortedMetric(samples, field) {
  return samples.map((sample) => sample[field]).sort((left, right) => left - right);
}

function roundNonNegative(value, digits) {
  const scale = 10 ** digits;
  return Math.max(0, Math.round(value * scale) / scale);
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
