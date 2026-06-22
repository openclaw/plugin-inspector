import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildImportLoopProfile,
  renderImportLoopProfileMarkdown,
  validateImportLoopProfile,
  writeImportLoopProfile,
} from "../src/import-loop-profile.js";

test("import loop profile measures repeated cold capture subprocesses", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-import-loop-"));
  const entrypoint = path.join(rootDir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      "export default {",
      "  register(api) {",
      "    api.on('before_tool_call', () => undefined);",
      "    api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "  }",
      "};",
    ].join("\n"),
    "utf8",
  );

  const profile = await buildImportLoopProfile({ entrypoint, rootDir, runs: 2 });

  assert.deepEqual(validateImportLoopProfile(profile), []);
  assert.equal(profile.summary.runs, 2);
  assert.equal(profile.summary.baselineRuns, 2);
  assert.equal(profile.summary.baselineFailCount, 0);
  assert.equal(profile.summary.failCount, 0);
  assert.ok(profile.summary.capturedCount >= 2);
  assert.ok(profile.summary.p50WallMs > 0);
  assert.ok(profile.summary.p50PluginWallDeltaMs >= 0);
  assert.ok(profile.summary.maxPluginPeakRssDeltaMb >= 0);
  assert.ok(profile.baseline.reference.wallMs > 0);
  assert.ok(profile.samples.every((sample) => Number.isFinite(sample.pluginCpuDeltaMsEstimate)));
  assert.ok(profile.samples.every((sample) => sample.exitCode === 0));
  assert.match(renderImportLoopProfileMarkdown(profile), /Import Loop Profile/);
  assert.match(renderImportLoopProfileMarkdown(profile), /Harness Baseline/);
  assert.match(renderImportLoopProfileMarkdown(profile), /Plugin CPU Delta/);
});

test("import loop profile can use a custom capture script and opt-in env", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-import-loop-"));
  const captureScript = path.join(rootDir, "capture.mjs");
  const entrypoint = "fixture.js";
  await writeFile(
    captureScript,
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const [entrypoint,, outputPath] = process.argv.slice(2);",
      "if (process.env.CUSTOM_IMPORT_LOOP !== '1') throw new Error('missing opt-in');",
      "await mkdir(path.dirname(outputPath), { recursive: true });",
      "await writeFile(outputPath, JSON.stringify({ status: 'captured', entrypoint, captured: [{ kind: 'hook', name: 'before_tool_call' }], openClawLifecycle: { importMs: 12, activationMs: 3, importPhase: 'full', activationPhase: 'full:register' } }));",
    ].join("\n"),
    "utf8",
  );

  const profile = await buildImportLoopProfile({
    captureScript,
    entrypoint,
    optInEnv: "CUSTOM_IMPORT_LOOP",
    rootDir,
    runs: 1,
  });

  assert.equal(profile.summary.failCount, 0);
  assert.equal(profile.summary.baselineRuns, 1);
  assert.equal(profile.summary.capturedCount, 1);
  assert.equal(profile.summary.openClawLifecycleCount, 1);
  assert.equal(profile.summary.p50OpenClawImportMs, 12);
  assert.equal(profile.summary.p50OpenClawActivationMs, 3);
  assert.match(renderImportLoopProfileMarkdown(profile), /OpenClaw Import/);
});

test("import loop profile validation rejects failed or empty captures", () => {
  const errors = validateImportLoopProfile({
    summary: {
      runs: 2,
      failCount: 1,
      capturedCount: 0,
      p50WallMs: 0,
    },
  });

  assert.ok(errors.some((error) => error.includes("failed sample")));
  assert.ok(errors.some((error) => error.includes("at least one contract")));
  assert.ok(errors.some((error) => error.includes("wall-time")));
});

test("import loop profile writer emits JSON and Markdown artifacts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-import-loop-report-"));
  const jsonPath = path.join(outputDir, "profile.json");
  const markdownPath = path.join(outputDir, "profile.md");
  const report = {
    generatedAt: "deterministic",
    mode: "subprocess-cold-import-loop",
    entrypoint: "fixture.mjs",
    summary: {
      runs: 1,
      p50WallMs: 10,
      p95WallMs: 10,
      maxPeakRssMb: 0,
      maxCpuMsEstimate: 0,
      capturedCount: 1,
      failCount: 0,
    },
    samples: [
      {
        index: 0,
        status: "captured",
        capturedCount: 1,
        wallMs: 10,
        peakRssMb: 0,
        cpuMsEstimate: 0,
        exitCode: 0,
      },
    ],
  };

  assert.deepEqual(await writeImportLoopProfile(report, { jsonPath, markdownPath }), { jsonPath, markdownPath });
  assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).summary.capturedCount, 1);
  assert.match(await readFile(markdownPath, "utf8"), /fixture\.mjs/);
});
