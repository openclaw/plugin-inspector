import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectFixtureSet, loadInspectorConfig, renderMarkdownReport, writeReport } from "../src/index.js";

test("markdown report includes summary and inventory", async () => {
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);
  const markdown = renderMarkdownReport(report);

  assert.match(markdown, /# OpenClaw Plugin Inspector Report/);
  assert.match(markdown, /\| sample-plugin \| high \| native-tool \| before_tool_call \| definePluginEntry, registerTool \| tools \|/);
});

test("writeReport writes JSON and Markdown artifacts", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-report-"));
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);

  const paths = await writeReport(report, { outDir, basename: "report" });
  const json = JSON.parse(await readFile(paths.jsonPath, "utf8"));
  const markdown = await readFile(paths.markdownPath, "utf8");

  assert.equal(json.status, "pass");
  assert.match(markdown, /Status: PASS/);
});
