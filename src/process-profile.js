import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const defaultTimeoutMs = 30_000;
const defaultKillGraceMs = 1_000;
const maxTimerMs = 2 ** 31 - 1;
const killWaitMs = 1_000;

// Shared by capture and profiling, not a package entrypoint. Each spawn owns
// its POSIX process group; never signal the inspector's inherited group.
export function startOwnedProcess(options, kind = "PROFILE") {
  const env = options.env ?? process.env;
  const { timeoutMs, killGraceMs, maxOutputBytes } = resolveProcessLimits(options, kind);
  const stdout = createCappedCollector(maxOutputBytes);
  const stderr = createCappedCollector(maxOutputBytes);
  let timedOut = false;
  let cancelled = options.signal?.aborted === true;
  let error;
  let closed = false;
  let stopping = false;
  let escalated = false;
  let settled = false;
  let code;
  let exitSignal;
  let timeoutId;
  let forceKillId;
  let closeDeadlineId;
  let child;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    clearTimeout(forceKillId);
    clearTimeout(closeDeadlineId);
    options.signal?.removeEventListener("abort", cancel);
    resolveResult({
      exitCode: timedOut || cancelled || error ? 1 : (code ?? 1),
      timedOut,
      cancelled,
      timeoutMs,
      signal: exitSignal,
      pid: child?.pid,
      error,
      stdout: stdout.text(),
      stderr: stderr.text(),
      outputTruncated: stdout.truncated || stderr.truncated,
    });
  };
  const groupExists = () => {
    if (!child?.pid) return false;
    if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (cause) {
      if (cause.code === "ESRCH") return false;
      error ??= cause;
      return true;
    }
  };
  const signalGroup = (signal) => {
    if (!child?.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (cause) {
      if (cause.code !== "ESRCH") error ??= cause;
    }
  };
  const stop = () => {
    if (stopping || settled) return;
    stopping = true;
    signalGroup("SIGTERM");
    forceKillId = setTimeout(() => {
      // The leader may already be reaped while its descendants hold the pipes.
      signalGroup("SIGKILL");
      escalated = true;
      if (closed) {
        finish();
        return;
      }
      closeDeadlineId = setTimeout(() => {
        error ??= new Error("Owned child stdio did not close after SIGKILL");
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.stdin?.destroy();
        child?.unref();
        finish();
      }, killWaitMs);
    }, killGraceMs);
  };
  const cancel = () => {
    cancelled = true;
    stop();
  };

  if (cancelled) {
    finish();
    return { child, result };
  }
  try {
    child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env,
      detached: process.platform !== "win32",
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    error = cause;
    finish();
    return { child, result };
  }
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));
  const fail = (cause) => {
    error ??= cause;
    stop();
  };
  child.stdout?.on("error", fail);
  child.stderr?.on("error", fail);
  child.once("error", fail);
  child.once("exit", () => {
    // Clean descendants even after a successful leader exit or closed pipes.
    if (groupExists()) stop();
  });
  child.once("close", (exitCode, signal) => {
    closed = true;
    code = exitCode;
    exitSignal = signal;
    if (!escalated && groupExists()) stop();
    else finish();
  });
  timeoutId = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  return { child, result };
}

export async function runProfiledProcess(options) {
  const start = performance.now();
  const heapStartMb = heapUsedMb();
  let firstRssKb = 0;
  let peakRssKb = 0;
  let peakCpuPercent = 0;
  let statSampleCount = 0;
  let rssSampleCount = 0;
  let cpuSampleCount = 0;
  let cpuTotal = 0;
  let pendingStats;
  let stopped = false;
  const statsController = new AbortController();
  const running = startOwnedProcess(options);
  const sampleStats = () => {
    if (pendingStats || stopped || !running.child?.pid) return;
    pendingStats = readProcessStats(running.child.pid, options.env, statsController.signal)
      .then((stats) => {
        if (stopped) return;
        if (stats.rssAvailable || stats.cpuAvailable) statSampleCount += 1;
        if (stats.rssAvailable) {
          rssSampleCount += 1;
          if (stats.rssKb > 0 && firstRssKb === 0) firstRssKb = stats.rssKb;
          peakRssKb = Math.max(peakRssKb, stats.rssKb);
        }
        if (stats.cpuAvailable) {
          cpuSampleCount += 1;
          peakCpuPercent = Math.max(peakCpuPercent, stats.cpuPercent);
          cpuTotal += stats.cpuPercent;
        }
      })
      .finally(() => { pendingStats = undefined; });
  };
  const poll = setInterval(sampleStats, positiveLimit(options.pollMs, undefined, 25));
  const stopSampling = () => {
    stopped = true;
    clearInterval(poll);
    statsController.abort();
  };
  running.child?.once("exit", stopSampling);
  running.child?.once("error", stopSampling);
  sampleStats();

  try {
    const outcome = await running.result;
    stopSampling();
    await pendingStats;
    if (outcome.error) throw outcome.error;
    const wallMs = Math.round(performance.now() - start);
    const averageCpuPercent = cpuSampleCount > 0 ? cpuTotal / cpuSampleCount : 0;
    const cpuPercentForEstimate = options.roundAverageCpuPercent === true
      ? Math.round(averageCpuPercent * 10) / 10
      : averageCpuPercent;
    return {
      wallMs,
      peakRssMb: Math.round((peakRssKb / 1024) * 10) / 10,
      rssDeltaMb: Math.round(((peakRssKb - firstRssKb) / 1024) * 10) / 10,
      peakCpuPercent: Math.round(peakCpuPercent * 10) / 10,
      cpuMsEstimate: Math.round((wallMs * cpuPercentForEstimate) / 100),
      harnessHeapDeltaMb: Math.round((heapUsedMb() - heapStartMb) * 10) / 10,
      statSampleCount,
      rssSampleCount,
      cpuSampleCount,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      cancelled: outcome.cancelled,
      pid: outcome.pid,
      stdoutPreview: previewLines(outcome.stdout),
      stderrPreview: previewLines(outcome.stderr),
    };
  } finally {
    stopSampling();
  }
}

export function resolveProcessLimits(options, kind = "PROFILE") {
  const env = options.env ?? process.env;
  const setting = (name) => env[`PLUGIN_INSPECTOR_${kind}_${name}`] ?? process.env[`PLUGIN_INSPECTOR_${kind}_${name}`];
  return {
    timeoutMs: positiveLimit(options.timeoutMs, setting("TIMEOUT_MS"), defaultTimeoutMs),
    killGraceMs: positiveLimit(options.killGraceMs, setting("KILL_GRACE_MS"), defaultKillGraceMs, 30_000),
    maxOutputBytes: positiveLimit(options.maxOutputBytes, setting("MAX_OUTPUT_BYTES"), (kind === "CAPTURE" ? 10 : 1) * 1024 * 1024),
  };
}

function positiveLimit(option, env, fallback, max = maxTimerMs) {
  const valid = (value) => Number.isFinite(value) && value > 0 && value <= max;
  if (valid(option)) return Math.ceil(option);
  const fromEnv = typeof env === "string" ? Number(env) : NaN;
  return valid(fromEnv) ? Math.ceil(fromEnv) : fallback;
}

export function createCappedCollector(maxBytes) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    get truncated() { return truncated; },
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const length = Math.min(buffer.length, maxBytes - size);
      if (length < buffer.length) truncated = true;
      if (length === 0) return;
      chunks.push(Buffer.from(buffer.subarray(0, length)));
      size += length;
    },
    text: () => Buffer.concat(chunks, size).toString("utf8"),
  };
}

async function readProcessStats(pid, env, signal) {
  const unavailable = { rssAvailable: false, rssKb: 0, cpuAvailable: false, cpuPercent: 0 };
  if (!pid || process.platform === "win32") return unavailable;
  const { result } = startOwnedProcess({
    command: "ps",
    args: ["-o", "rss=", "-o", "%cpu=", "-p", String(pid)],
    env,
    signal,
    timeoutMs: 250,
    killGraceMs: 50,
    maxOutputBytes: 4096,
  });
  const outcome = await result;
  if (outcome.exitCode !== 0 || outcome.outputTruncated) return unavailable;
  const [rssRaw, cpuRaw] = outcome.stdout.trim().split(/\s+/);
  const rssKb = Number.parseInt(rssRaw, 10);
  const cpuPercent = Number.parseFloat(cpuRaw);
  return {
    rssAvailable: Number.isFinite(rssKb),
    rssKb: Number.isFinite(rssKb) ? rssKb : 0,
    cpuAvailable: Number.isFinite(cpuPercent),
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
  };
}

function heapUsedMb() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function previewLines(text) {
  return text.trim().split("\n").slice(-2).join("\n");
}
