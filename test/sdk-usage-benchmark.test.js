import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareSdkUsage } from "../scripts/lib/sdk-usage-benchmark.mjs";
import { loadFrozenBenchmark } from "../scripts/lib/sdk-usage-benchmark-freeze.mjs";

async function fixture(t) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "sdk-benchmark-test-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, "extensions/demo"), { recursive: true });
  await writeFile(path.join(sourceRoot, "extensions/demo/index.ts"), "api.registerTool(tool);\napi[dynamicName](tool);\n");
  const entry = {
    key: "api-member:api.registerTool", kind: "api-member", identity: "api.registerTool",
    classification: "runtime", referenceKinds: ["call"],
    evidence: [{ path: "index.ts", line: 1, snippet: "api.registerTool(tool);" }],
    deprecationCodes: [],
  };
  const expected = {
    plugin: { id: "demo", path: "extensions/demo" },
    reviewedFiles: [{ path: "extensions/demo/index.ts" }], excludedFiles: [],
    findings: [{ ...structuredClone(entry), evidence: [{ ...entry.evidence[0], path: "extensions/demo/index.ts" }] }],
    unknowns: [],
  };
  const actual = {
    schemaVersion: 1, analysisVersion: "1", inputKind: "source", status: "complete",
    entries: [entry], unknowns: [],
    coverage: { filesDiscovered: 1, filesAnalyzed: 1, filesExcluded: 0 },
  };
  return { sourceRoot, expected, actual };
}

test("compares actual JSON identities without requiring identical evidence samples", async (t) => {
  const { sourceRoot, expected, actual } = await fixture(t);
  actual.entries[0].evidence.push({ ...actual.entries[0].evidence[0] });
  const result = await compareSdkUsage(expected, JSON.parse(JSON.stringify(actual)), sourceRoot);
  assert.equal(result.passed, true);
  assert.equal(result.truePositives, 1);
  assert.deepEqual(result.falsePositives, []);
  assert.deepEqual(result.falseNegatives, []);
});

test("reports false positives and negatives rather than accepting equal totals", async (t) => {
  const { sourceRoot, expected, actual } = await fixture(t);
  actual.entries[0] = { ...actual.entries[0], key: "api-member:api.registerService", identity: "api.registerService" };
  const result = await compareSdkUsage(expected, actual, sourceRoot);
  assert.equal(result.passed, false);
  assert.deepEqual(result.falseNegatives, ["api-member:api.registerTool"]);
  assert.deepEqual(result.falsePositives, ["api-member:api.registerService"]);
});

test("requires exact classification and reference-kind sets", async (t) => {
  const { sourceRoot, expected, actual } = await fixture(t);
  actual.entries[0].classification = "mixed";
  actual.entries[0].referenceKinds.push("member-access");
  const result = await compareSdkUsage(expected, actual, sourceRoot);
  assert.equal(result.passed, false);
  assert.equal(result.classificationMismatches.length, 1);
  assert.equal(result.referenceKindMismatches.length, 1);
});

test("rejects invented evidence, missing coverage, duplicate identities and artifact inputs", async (t) => {
  const { sourceRoot, expected, actual } = await fixture(t);
  actual.inputKind = "artifact";
  actual.coverage.filesAnalyzed = 0;
  actual.entries[0].evidence[0].snippet = "invented evidence";
  actual.entries.push(actual.entries[0]);
  const result = await compareSdkUsage(expected, actual, sourceRoot);
  assert.equal(result.passed, false);
  assert.equal(result.invalidEvidence.length, 2);
  assert.ok(result.reportErrors.some((message) => message.includes("duplicate")));
  assert.ok(result.reportErrors.some((message) => message.includes("inputKind")));
  assert.ok(result.reportErrors.some((message) => message.includes("coverage")));
});

test("preserves genuinely unresolved source accesses and requires partial status", async (t) => {
  const { sourceRoot, expected, actual } = await fixture(t);
  const unknown = { path: "extensions/demo/index.ts", line: 2, expression: "api[dynamicName]", reason: "Key comes from runtime input" };
  expected.unknowns.push(unknown);
  let result = await compareSdkUsage(expected, actual, sourceRoot);
  assert.equal(result.passed, false);
  assert.equal(result.missingUnknowns.length, 1);
  actual.unknowns.push({ ...unknown, path: "index.ts", reason: "Computed key cannot be resolved" });
  actual.status = "partial";
  result = await compareSdkUsage(expected, actual, sourceRoot);
  assert.equal(result.passed, true);
});

test("refuses to run candidates against a partial or absent manual benchmark", async (t) => {
  const { sourceRoot } = await fixture(t);
  const benchmarkDir = path.join(sourceRoot, "benchmark");
  await mkdir(benchmarkDir);
  await assert.rejects(loadFrozenBenchmark({ benchmarkDir, sourceRoot }), /freeze/i);
  await writeFile(path.join(benchmarkDir, "freeze.json"), JSON.stringify({ schemaVersion: 1, status: "auditing", population: { count: 69 } }));
  await assert.rejects(loadFrozenBenchmark({ benchmarkDir, sourceRoot }), /69.*frozen/i);
  await writeFile(path.join(benchmarkDir, "contract.json"), "{}\n");
  await writeFile(path.join(benchmarkDir, "freeze.json"), JSON.stringify({
    schemaVersion: 1, status: "frozen", population: { count: 69, distribution: "core" },
    fixtures: Array.from({ length: 69 }, () => ({})), contractSha256: "edited-after-freeze",
  }));
  await assert.rejects(loadFrozenBenchmark({ benchmarkDir, sourceRoot }), /freeze mismatch: contract.json/i);
});
