import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export async function runProfiledProcess(options) {
  const start = performance.now();
  const heapStartMb = heapUsedMb();
  let firstRssKb = 0;
  let peakRssKb = 0;
  let peakCpuPercent = 0;
  const cpuSamples = [];
  let pollInFlight = false;

  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));

  const recordStats = (stats) => {
    if (stats.rssKb > 0 && firstRssKb === 0) {
      firstRssKb = stats.rssKb;
    }
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
  }, options.pollMs ?? 100);

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearInterval(poll);
      reject(error);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  clearInterval(poll);

  const finalStats = await readProcessStats(child.pid);
  if (finalStats.rssKb > 0 && firstRssKb === 0) {
    firstRssKb = finalStats.rssKb;
  }
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
  const cpuPercentForEstimate =
    options.roundAverageCpuPercent === true
      ? Math.round(averageCpuPercent * 10) / 10
      : averageCpuPercent;

  return {
    wallMs,
    peakRssMb: Math.round((peakRssKb / 1024) * 10) / 10,
    rssDeltaMb: Math.round(((peakRssKb - firstRssKb) / 1024) * 10) / 10,
    peakCpuPercent: Math.round(peakCpuPercent * 10) / 10,
    cpuMsEstimate: Math.round((wallMs * cpuPercentForEstimate) / 100),
    harnessHeapDeltaMb: Math.round((heapUsedMb() - heapStartMb) * 10) / 10,
    exitCode,
    stdoutPreview: previewLines(stdout),
    stderrPreview: previewLines(stderr),
  };
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

function heapUsedMb() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function previewLines(chunks) {
  return Buffer.concat(chunks).toString("utf8").trim().split("\n").slice(-2).join("\n");
}
