import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { renderMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

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
  assertRuns(runs);

  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    samples.push(await runCaptureSample({ ...options, entrypoint, index, rootDir }));
  }

  const wallMs = samples.map((sample) => sample.wallMs).sort((left, right) => left - right);
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
    markdownTable(Object.entries(report.summary).map(([key, value]) => [key, value]), ["Metric", "Value"]),
    "",
    "## Samples",
    "",
    markdownTable(
      report.samples.map((sample) => [
        sample.index,
        sample.status,
        sample.capturedCount,
        `${sample.wallMs} ms`,
        `${sample.peakRssMb} MB`,
        `${sample.cpuMsEstimate} ms`,
        sample.exitCode,
      ]),
      ["Run", "Status", "Captured", "Wall", "Peak RSS", "CPU Estimate", "Exit"],
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
  const start = performance.now();
  let peakRssKb = 0;
  let peakCpuPercent = 0;
  const cpuSamples = [];
  let pollInFlight = false;
  const child = spawn(command.command, command.args, {
    cwd: command.cwd ?? options.rootDir,
    env: { ...process.env, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const recordStats = (stats) => {
    peakRssKb = Math.max(peakRssKb, stats.rssKb);
    peakCpuPercent = Math.max(peakCpuPercent, stats.cpuPercent);
    if (stats.cpuPercent > 0) {
      cpuSamples.push(stats.cpuPercent);
    }
  };
  const poll = setInterval(() => {
    if (pollInFlight) {
      return;
    }
    pollInFlight = true;
    readProcessStats(child.pid)
      .then(recordStats)
      .finally(() => {
        pollInFlight = false;
      });
  }, 100);

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearInterval(poll);
      reject(error);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  clearInterval(poll);
  const finalStats = await readProcessStats(child.pid);
  peakRssKb = Math.max(peakRssKb, finalStats.rssKb);
  peakCpuPercent = Math.max(peakCpuPercent, finalStats.cpuPercent);
  if (finalStats.cpuPercent > 0) {
    cpuSamples.push(finalStats.cpuPercent);
  }

  const wallMs = Math.round(performance.now() - start);
  const averageCpuPercent =
    cpuSamples.length > 0
      ? cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length
      : 0;
  const output = exitCode === 0 ? await readCaptureOutput(outputPath) : null;

  return {
    index: options.index,
    exitCode,
    status: output?.status ?? "failed",
    capturedCount: output?.captured?.length ?? 0,
    wallMs,
    peakRssMb: Math.round((peakRssKb / 1024) * 10) / 10,
    peakCpuPercent: Math.round(peakCpuPercent * 10) / 10,
    cpuMsEstimate: Math.round((wallMs * averageCpuPercent) / 100),
    stderrPreview: Buffer.concat(stderr).toString("utf8").trim().split("\n").slice(-2).join("\n"),
  };
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

async function readProcessStats(pid) {
  if (!pid || process.platform === "win32") {
    return { rssKb: 0, cpuPercent: 0 };
  }
  return new Promise((resolve) => {
    const ps = spawn("ps", ["-o", "rss=", "-o", "%cpu=", "-p", String(pid)], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks = [];
    ps.stdout.on("data", (chunk) => chunks.push(chunk));
    ps.on("error", () => resolve({ rssKb: 0, cpuPercent: 0 }));
    ps.on("exit", () => {
      const [rssRaw, cpuRaw] = Buffer.concat(chunks).toString("utf8").trim().split(/\s+/);
      const rssKb = Number.parseInt(rssRaw, 10);
      const cpuPercent = Number.parseFloat(cpuRaw);
      resolve({
        rssKb: Number.isFinite(rssKb) ? rssKb : 0,
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      });
    });
  });
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}

function assertRuns(runs) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    throw new Error("runs must be an integer between 1 and 20");
  }
}

function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function markdownTable(rows, headers) {
  return renderMarkdownTable(rows, headers, { empty: "_none_", escape: false, padding: true });
}
