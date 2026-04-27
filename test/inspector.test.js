import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureEntrypoint, inspectFixtureSet, inspectSourceText, loadInspectorConfig } from "../src/advanced.js";

test("source inspection records hook, registrar, and SDK import evidence", () => {
  const inspection = inspectSourceText(
    [
      'import type { OpenClawPluginApi } from "openclaw/plugin-sdk";',
      "",
      "export function register(api) {",
      '  // api.on("llm_output", () => {});',
      '  api.on("before_tool_call", () => {});',
      "  /* api.registerHttpRoute({ path: '/ignored' }); */",
      "  api.registerService({ name: 'svc', start() {} });",
      "  return definePluginEntry({ register() {} });",
      "}",
    ].join("\n"),
    "plugins/example/index.ts",
  );

  assert.deepEqual(inspection.hooks, [
    {
      name: "before_tool_call",
      file: "plugins/example/index.ts",
      line: 5,
      ref: "plugins/example/index.ts:5",
    },
  ]);
  assert.deepEqual(
    inspection.registrations.map((registration) => `${registration.name}@${registration.ref}`),
    ["registerService@plugins/example/index.ts:7", "definePluginEntry@plugins/example/index.ts:8"],
  );
  assert.deepEqual(inspection.sdkImports, [
    {
      specifier: "openclaw/plugin-sdk",
      file: "plugins/example/index.ts",
      line: 1,
      ref: "plugins/example/index.ts:1",
    },
  ]);
});

test("fixture set inspection produces a passing report", async () => {
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);

  assert.equal(report.status, "pass");
  assert.equal(report.summary.fixtureCount, 1);
  assert.deepEqual(report.fixtures[0].hooks, ["before_tool_call"]);
  assert.deepEqual(report.fixtures[0].registrations, ["definePluginEntry", "registerTool"]);
  assert.deepEqual(report.fixtures[0].manifestContracts, ["tools"]);
});

test("fixture set inspection reports missing expected seams", async () => {
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  config.fixtures[0].expect.hooks.push("llm_output");

  const report = await inspectFixtureSet(config);

  assert.equal(report.status, "fail");
  assert.equal(report.breakages[0].code, "missing-expected-seam");
  assert.match(report.breakages[0].message, /llm_output/);
});

test("capture entrypoint imports a local fixture and records registrations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-capture-"));
  const entrypoint = path.join(dir, "fixture.mjs");
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

  const result = await captureEntrypoint(entrypoint, {
    apiOptions: { knownRegistrars: ["registerTool"] },
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(
    result.captured.map((item) => `${item.kind}:${item.name}`),
    ["hook:before_tool_call", "registration:registerTool"],
  );
});

test("capture entrypoint can mock OpenClaw plugin SDK imports", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-sdk-capture-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  const entrypoint = path.join(dir, "src", "index.mjs");
  await writeFile(
    entrypoint,
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry((api) => {",
      "  api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("src/index.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.equal(result.mockSdk, true);
  assert.deepEqual(
    result.captured.map((item) => `${item.kind}:${item.name}`),
    ["registration:registerTool"],
  );
});
