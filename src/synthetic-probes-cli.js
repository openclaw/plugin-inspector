#!/usr/bin/env node
import { readFlag, readMockSdkFlag } from "./cli-options.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBoundedJsonArtifact, writeArtifacts } from "./artifacts.js";
import { resolveProcessLimits, startOwnedProcess } from "./process-profile.js";

const args = process.argv.slice(2);

try {
  await run(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function run(commandArgs) {
  const entrypoint = readFlag(commandArgs, "--entrypoint") ?? commandArgs.find((arg) => !arg.startsWith("-"));
  const outputPath = readFlag(commandArgs, "--output");
  const pluginRoot = readFlag(commandArgs, "--plugin-root");
  const includeLifecycle = commandArgs.includes("--include-lifecycle");
  const includeChannelRuntime = commandArgs.includes("--include-channel-runtime");
  const includeProviderCapabilities = commandArgs.includes("--include-provider-capabilities");
  const mockSdk = readMockSdkFlag(commandArgs) ?? true;

  if (!entrypoint) {
    throw new Error("synthetic probes require --entrypoint <path>");
  }
  if (process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED !== "1") {
    throw new Error("synthetic probes import plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 in an isolated workspace");
  }

  const results = await runInChild(entrypoint, {
    mockSdk,
    pluginRoot,
    apiOptions: { retainHandlers: true },
    includeLifecycle,
    includeChannelRuntime,
    includeProviderCapabilities,
  });
  const json = `${JSON.stringify(results, null, 2)}\n`;

  if (outputPath) {
    await writeArtifacts([{ path: outputPath, content: json }]);
  } else {
    process.stdout.write(json);
  }
}

async function runInChild(entrypoint, options) {
  const limits = resolveProcessLimits({}, "PROBE");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-cli-"));
  const outputPath = path.join(workspace, "result.json");
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Synthetic probes cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const runnerPath = fileURLToPath(new URL("./mock-sdk-capture-runner.js", import.meta.url));
    const { result } = startOwnedProcess({
      command: process.execPath,
      args: [
        "--no-warnings",
        ...(options.mockSdk ? ["--preserve-symlinks"] : []),
        runnerPath,
        JSON.stringify({
          ...options, ...limits, entrypoint, outputPath,
          cwd: process.cwd(), syntheticProbes: true,
        }),
      ],
      ...limits,
      signal: controller.signal,
    }, "PROBE");
    const outcome = await result;
    if (outcome.exitCode !== 0 || outcome.outputTruncated) {
      const message = outcome.cancelled ? "Synthetic probes cancelled"
        : outcome.timedOut ? `Synthetic probes timed out after ${limits.timeoutMs}ms`
        : outcome.outputTruncated ? "Synthetic probe child output exceeded its byte limit"
        : outcome.stderr.trim() || outcome.error?.message || "Synthetic probe child failed";
      throw new Error(message);
    }
    controller.signal.throwIfAborted();
    // The report is separate from plugin stdout, including direct fd writes.
    // Only accept a fresh complete artifact after successful child cleanup.
    const results = await readBoundedJsonArtifact(outputPath, limits.maxOutputBytes);
    validateSyntheticReport(results);
    controller.signal.throwIfAborted();
    return results;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await rm(workspace, { recursive: true, force: true });
  }
}

function validateSyntheticReport(report) {
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(report) || typeof report.entrypoint !== "string" ||
      !["captured", "no-register-export"].includes(report.status) ||
      !isObject(report.summary) || !Array.isArray(report.results)) {
    throw new Error("Invalid synthetic probe report: expected entrypoint, status, summary, and results");
  }
  const counts = { probeCount: report.results.length, passCount: 0, failCount: 0, blockedCount: 0 };
  for (const row of report.results) {
    if (!isObject(row) || !Number.isSafeInteger(row.captureIndex) || row.captureIndex < 0 ||
        !["kind", "seam", "label"].every((key) => typeof row[key] === "string") ||
        !["pass", "fail", "blocked"].includes(row.status) ||
        (row.status === "fail" && typeof row.error !== "string") ||
        (row.status === "blocked" && typeof row.reason !== "string")) {
      throw new Error("Invalid synthetic probe report: malformed result row");
    }
    counts[`${row.status}Count`] += 1;
  }
  for (const [key, expected] of Object.entries(counts)) {
    if (!Number.isSafeInteger(report.summary[key]) || report.summary[key] < 0 ||
        report.summary[key] !== expected) {
      throw new Error(`Invalid synthetic probe report: invalid or inconsistent ${key}`);
    }
  }
}
