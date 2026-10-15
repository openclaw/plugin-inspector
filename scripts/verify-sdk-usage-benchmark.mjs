#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { compareSdkUsage } from "./lib/sdk-usage-benchmark.mjs";
import { loadFrozenBenchmark, sha256 } from "./lib/sdk-usage-benchmark-freeze.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const benchmarkDir = path.join(repositoryRoot, "test/fixtures/sdk-usage-benchmark");
async function implementationDigest() {
  const files = ["package.json", "package-lock.json"];
  async function visit(directory) {
    for (const entry of await readdir(path.join(repositoryRoot, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await visit("src");
  const hashes = [];
  for (const file of files.sort()) hashes.push([file, sha256(await readFile(path.join(repositoryRoot, file)))]);
  return sha256(JSON.stringify(hashes));
}
const { values } = parseArgs({ options: {
  "source-root": { type: "string" },
  "out-dir": { type: "string" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("Usage: node scripts/verify-sdk-usage-benchmark.mjs --source-root <pinned-openclaw-checkout> --out-dir <external-report-directory>");
} else {
  try {
    if (!values["source-root"] || !values["out-dir"]) throw new Error("Provide --source-root and --out-dir; no partial-plugin mode is supported");
    const sourceRoot = path.resolve(values["source-root"]);
    const outputRoot = path.resolve(values["out-dir"]);
    if (!path.relative(sourceRoot, outputRoot).startsWith(`..${path.sep}`)) {
      throw new Error("Reports must be written outside the frozen OpenClaw source checkout");
    }
    // Validate the independent answer key BEFORE importing or invoking the candidate.
    const benchmark = await loadFrozenBenchmark({ benchmarkDir, sourceRoot });
    await mkdir(path.dirname(outputRoot), { recursive: true });
    // Each iteration has its own proof; never leave stale reports from an earlier run.
    await mkdir(outputRoot);
    const implementationSha256 = await implementationDigest();
    const { pluginRoot } = await import("../src/index.js");
    const inspectorPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    const gitHead = (await execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
    const startedAt = new Date().toISOString();
    const results = [];
    const reports = [];
    for (const fixture of benchmark.fixtures) {
      try {
        const run = await pluginRoot.runCheck({
          pluginRoot: path.join(sourceRoot, fixture.plugin.path),
          openclawPath: sourceRoot,
          outDir: path.join(outputRoot, fixture.plugin.id),
          sdkUsageInputKind: "source",
          capture: false,
          allowExecution: false,
          authorFacing: false,
        });
        // Read the actual serialized report produced by Inspector's public API.
        const bytes = await readFile(run.paths.jsonPath);
        const report = JSON.parse(bytes);
        reports.push({ pluginId: fixture.plugin.id, path: run.paths.jsonPath, sha256: sha256(bytes) });
        const comparison = await compareSdkUsage(fixture, report.sdkUsage, sourceRoot);
        results.push(comparison);
        console.log(`${comparison.passed ? "PASS" : "FAIL"} ${fixture.plugin.id}: ${comparison.truePositives}/${comparison.expectedIdentities} identities, ${comparison.falsePositives.length} extra`);
      } catch (error) {
        results.push({ pluginId: fixture.plugin.id, passed: false, error: String(error?.stack ?? error) });
        console.error(`FAIL ${fixture.plugin.id}: ${error?.message ?? error}`);
      }
    }
    // Concurrent edits to source or the answer key invalidate the whole run.
    const after = await loadFrozenBenchmark({ benchmarkDir, sourceRoot });
    if (after.freezeSha256 !== benchmark.freezeSha256) throw new Error("Benchmark changed during report generation");
    if (await implementationDigest() !== implementationSha256) throw new Error("Inspector implementation changed during report generation");
    const summary = {
      schemaVersion: 1, phase: "source", startedAt, finishedAt: new Date().toISOString(),
      source: benchmark.freeze.source, benchmarkFreezeSha256: benchmark.freezeSha256,
      inspector: { version: inspectorPackage.version, gitHead, implementationSha256 },
      plugins: results.length, passedPlugins: results.filter((result) => result.passed).length,
      passed: results.length === 69 && results.every((result) => result.passed),
      reports, results,
    };
    await writeFile(path.join(outputRoot, "benchmark-result.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`${summary.passedPlugins}/69 plugins match the independent source benchmark`);
    if (!summary.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
