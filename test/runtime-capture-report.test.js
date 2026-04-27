import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildRuntimeCaptureReport,
  inspectCompatibilityFixtureSet,
  loadPluginRootConfig,
  writeRuntimeCaptureReport,
} from "../src/advanced.js";

test("runtime capture report imports plugin entrypoints with mocked SDK", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.mjs"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.mjs"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry((api) => {",
      "  api.on('before_tool_call', () => undefined);",
      "  api.registerTool({ name: 'weather', inputSchema: { type: 'object' }, run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.targetCount, 1);
  assert.equal(captureReport.summary.capturedCount, 1);
  assert.equal(captureReport.summary.registrationCount, 1);
  assert.equal(captureReport.summary.hookCount, 1);

  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-out-"));
  await writeRuntimeCaptureReport(captureReport, {
    jsonPath: path.join(outDir, "capture.json"),
    markdownPath: path.join(outDir, "capture.md"),
  });
  assert.equal(JSON.parse(await readFile(path.join(outDir, "capture.json"), "utf8")).summary.capturedCount, 1);
  assert.match(await readFile(path.join(outDir, "capture.md"), "utf8"), /registerTool/);
});

test("runtime capture report classifies missing mocked SDK exports", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-missing-export-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-missing-sdk-export",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.mjs"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.mjs"),
    [
      'import { definitelyMissing } from "openclaw/plugin-sdk/plugin-entry";',
      "",
      "export default definitelyMissing({",
      "  register() {},",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 1);
  assert.equal(captureReport.results[0].status, "error");
  assert.equal(captureReport.results[0].failureClass, "missing-sdk-export");
  assert.equal(captureReport.results[0].missingExport, "definitelyMissing");

  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-missing-export-out-"));
  await writeRuntimeCaptureReport(captureReport, {
    jsonPath: path.join(outDir, "capture.json"),
    markdownPath: path.join(outDir, "capture.md"),
  });
  assert.match(await readFile(path.join(outDir, "capture.md"), "utf8"), /missing-sdk-export/);
});

test("runtime capture report classifies registration execution failures", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-registration-error-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-registration-error",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.mjs"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.mjs"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry(() => {",
      "  throw new Error('register exploded');",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 1);
  assert.equal(captureReport.results[0].failureClass, "registration-execution-error");
  assert.match(captureReport.results[0].error, /register exploded/);
});
