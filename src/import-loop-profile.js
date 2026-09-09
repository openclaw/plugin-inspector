import { constants } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { resolveFromRoot } from "./path-utils.js";
import { resolveProcessLimits, runProfiledProcess } from "./process-profile.js";
import { assertRunCount, percentile } from "./stats.js";

const defaultRunnerPath = fileURLToPath(new URL("./mock-sdk-capture-runner.js", import.meta.url));

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
  const openClawImportMs = openClawLifecycleMetric(samples, "importMs");
  const openClawActivationMs = openClawLifecycleMetric(samples, "activationMs");
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
      openClawLifecycleCount: openClawImportMs.length,
      p50OpenClawImportMs: percentile(openClawImportMs, 0.5),
      p95OpenClawImportMs: percentile(openClawImportMs, 0.95),
      p50OpenClawActivationMs: percentile(openClawActivationMs, 0.5),
      p95OpenClawActivationMs: percentile(openClawActivationMs, 0.95),
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
        formatOpenClawLifecycleMetric(sample.openClawLifecycle?.importMs),
        formatOpenClawLifecycleMetric(sample.openClawLifecycle?.activationMs),
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
        "OpenClaw Import",
        "OpenClaw Activate",
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

  const defaultCapture = typeof options.captureCommand !== "function" && !options.captureScript;
  const maxOutputBytes = resolveProcessLimits({
    ...options,
    env: { ...process.env, ...options.env, ...options.captureEnv },
  }, "CAPTURE").maxOutputBytes;
  // Only the built-in route owns these sample files. An early process.exit(0)
  // must not turn a previous capture into this run's successful result.
  if (defaultCapture) await rm(outputPath, { force: true });
  const command = buildCaptureCommand({ ...options, outputPath, maxOutputBytes });
  const profile = await runProfiledProcess({
    command: command.command,
    args: command.args,
    cwd: command.cwd ?? options.rootDir,
    env: { ...process.env, ...options.env, ...command.env },
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    killGraceMs: options.killGraceMs,
    signal: options.signal,
  });
  let output = null;
  if (profile.exitCode === 0 && !profile.timedOut && !profile.cancelled) {
    if (defaultCapture) {
      try {
        output = await readCaptureOutput(outputPath, maxOutputBytes);
      } catch (error) {
        profile.exitCode = 1;
        profile.stderrPreview = `Invalid capture artifact: ${error.message}`;
      }
    } else {
      output = await readCaptureOutput(outputPath);
    }
  }
  if (options.signal?.aborted) {
    profile.exitCode = 1;
    profile.cancelled = true;
    output = null;
  }

  return {
    index: options.index,
    exitCode: profile.exitCode,
    timedOut: profile.timedOut === true,
    cancelled: profile.cancelled === true,
    status: output?.status ?? "failed",
    capturedCount: output?.captured?.length ?? 0,
    openClawLifecycle: output?.openClawLifecycle ?? null,
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
    ...((report.summary.openClawLifecycleCount ?? 0) > 0
      ? [
          ["openClawLifecycleCount", report.summary.openClawLifecycleCount],
          ["p50OpenClawImportMs", `${report.summary.p50OpenClawImportMs} ms`],
          ["p95OpenClawImportMs", `${report.summary.p95OpenClawImportMs} ms`],
          ["p50OpenClawActivationMs", `${report.summary.p50OpenClawActivationMs} ms`],
          ["p95OpenClawActivationMs", `${report.summary.p95OpenClawActivationMs} ms`],
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

function formatOpenClawLifecycleMetric(value) {
  return Number.isFinite(value) ? `${value} ms` : "n/a";
}

function openClawLifecycleMetric(samples, field) {
  return samples
    .map((sample) => sample.openClawLifecycle?.[field])
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
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
    args: [
      "--no-warnings",
      "--preserve-symlinks",
      defaultRunnerPath,
      JSON.stringify({
        entrypoint: options.entrypoint,
        cwd: options.rootDir,
        outputPath: options.outputPath,
        maxOutputBytes: options.maxOutputBytes,
      }),
    ],
    cwd: options.rootDir,
    env: { PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1", ...options.captureEnv },
  };
}

async function readCaptureOutput(outputPath, maxOutputBytes) {
  if (maxOutputBytes === undefined) return JSON.parse(await readFile(outputPath, "utf8"));
  const file = await open(outputPath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("expected a regular capture file");
    if (stat.size > maxOutputBytes) throw new Error("capture result exceeded its byte limit");
    const chunks = [];
    let bytes = 0;
    // end is inclusive: read at most limit + 1 even if the file grew after stat.
    for await (const chunk of file.createReadStream({ end: maxOutputBytes, autoClose: false })) {
      chunks.push(chunk);
      bytes += chunk.length;
    }
    if (bytes > maxOutputBytes) throw new Error("capture result exceeded its byte limit");
    const result = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    if (!result || typeof result.status !== "string" || !Array.isArray(result.captured)) {
      throw new Error("expected a capture status and captured contracts");
    }
    return result;
  } finally {
    await file.close();
  }
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
