import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  inspectFixtureSet,
  loadInspectorConfig,
  renderMarkdownReport,
  renderMarkdownTable,
  writeArtifacts,
  writeReport,
} from "../src/index.js";

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

test("artifact helpers write stable CI files", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-artifacts-"));
  const jsonPath = path.join(outDir, "summary.json");
  const markdownPath = path.join(outDir, "summary.md");

  const paths = await writeArtifacts(
    [
      { name: "jsonPath", path: jsonPath, json: { status: "pass" } },
      { name: "markdownPath", path: markdownPath, markdown: "# Summary" },
    ],
    { check: true },
  );

  assert.deepEqual(paths, { jsonPath, markdownPath });
  assert.equal(await readFile(jsonPath, "utf8"), '{\n  "status": "pass"\n}\n');
  assert.equal(await readFile(markdownPath, "utf8"), "# Summary\n");
});

test("markdown table helper supports padded empty-table reports", () => {
  assert.equal(
    renderMarkdownTable(
      [
        ["fixture", "P1"],
        ["none", null],
      ],
      ["Name", "Priority"],
      { padding: true, nullValue: "-", escape: false },
    ),
    ["| Name    | Priority |", "| ------- | -------- |", "| fixture | P1       |", "| none    | -        |"].join("\n"),
  );
  assert.equal(renderMarkdownTable([], ["Name"], { empty: "_none_" }), "_none_");
});
