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

test("source inspection strips long comments before matching registrations", () => {
  const inspection = inspectSourceText(
    [`/* ${"a/*".repeat(512)} */`, "api.registerTool({ name: 'weather' });"].join("\n"),
    "plugins/example/index.ts",
  );

  assert.deepEqual(
    inspection.registrations.map((registration) => `${registration.name}@${registration.ref}`),
    ["registerTool@plugins/example/index.ts:2"],
  );
});

test("source inspection records deprecated whole-store session helper usage", () => {
  const inspection = inspectSourceText(
    [
      'import { loadSessionStore } from "openclaw/plugin-sdk/session-store-runtime";',
      'import { loadSessionStore as loadStore } from "openclaw/plugin-sdk/config-runtime";',
      'import * as sessionStoreRuntime from "openclaw/plugin-sdk/session-store-runtime";',
      "",
      'export { loadSessionStore as legacyLoadSessionStore } from "openclaw/plugin-sdk/session-store-runtime";',
      "sessionStoreRuntime.loadSessionStore('/tmp/sessions.json');",
      "api.runtime.agent.session.loadSessionStore('/tmp/sessions.json');",
    ].join("\n"),
    "plugins/example/index.ts",
  );

  assert.deepEqual(
    inspection.sdkDeprecations.map((finding) => `${finding.surface}@${finding.ref}`),
    [
      "openclaw/plugin-sdk/session-store-runtime import@plugins/example/index.ts:1",
      "openclaw/plugin-sdk/config-runtime import@plugins/example/index.ts:2",
      "openclaw/plugin-sdk/session-store-runtime re-export@plugins/example/index.ts:5",
      "openclaw/plugin-sdk/session-store-runtime namespace access@plugins/example/index.ts:6",
      "api.runtime.agent.session@plugins/example/index.ts:7",
    ],
  );
});

test("source inspection ignores unrelated loadSessionStore helpers", () => {
  const inspection = inspectSourceText(
    [
      'import { loadSessionStore } from "./local-session-store.js";',
      "const helpers = {",
      "  loadSessionStore() {",
      "    return new Map();",
      "  },",
      "};",
      "helpers.loadSessionStore();",
    ].join("\n"),
    "plugins/example/index.ts",
  );

  assert.deepEqual(inspection.sdkDeprecations, []);
});

test("source inspection records CommonJS whole-store session helper usage", () => {
  const inspection = inspectSourceText(
    [
      'const { loadSessionStore: readSessionStore } = require("openclaw/plugin-sdk/session-store-runtime");',
      'const sessionStoreRuntime = require("openclaw/plugin-sdk/config-runtime");',
      "sessionStoreRuntime.loadSessionStore('/tmp/sessions.json');",
    ].join("\n"),
    "plugins/example/index.cjs",
  );

  assert.deepEqual(
    inspection.sdkDeprecations.map((finding) => `${finding.surface}@${finding.ref}`),
    [
      "openclaw/plugin-sdk/session-store-runtime require@plugins/example/index.cjs:1",
      "openclaw/plugin-sdk/config-runtime require namespace access@plugins/example/index.cjs:3",
    ],
  );
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

test("fixture set inspection treats channel factories as channel registration coverage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-channel-factory-"));
  await mkdir(path.join(dir, "fixture"), { recursive: true });
  await writeFile(
    path.join(dir, "fixture", "index.js"),
    [
      'import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";',
      'import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";',
      "",
      "export const channel = createChatChannelPlugin({ id: 'fixture-channel' });",
      "export default defineBundledChannelEntry({ id: 'bundled-channel' });",
    ].join("\n"),
    "utf8",
  );

  const report = await inspectFixtureSet({
    version: 1,
    submoduleRoot: ".",
    rootDir: dir,
    fixtures: [
      {
        id: "fixture",
        path: "fixture",
        repo: "https://github.com/openclaw/fixture.git",
        priority: "high",
        seams: ["channel"],
        expect: {
          registrations: ["registerChannel"],
        },
      },
    ],
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(report.breakages, []);
  assert.deepEqual(report.fixtures[0].registrations, ["createChatChannelPlugin", "defineBundledChannelEntry"]);
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
      'import { pluginSdkMock } from "openclaw/plugin-sdk";',
      'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
      'import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";',
      'import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";',
      'import { GPT5_BEHAVIOR_CONTRACT } from "openclaw/plugin-sdk/provider-model-shared";',
      'import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";',
      'import { registerPluginHttpRoute, resolveWebhookPath } from "openclaw/plugin-sdk/webhook-ingress";',
      "",
      "const provider = defineSingleProviderPluginEntry({",
      "  id: 'fixture-provider',",
      "  name: 'Fixture provider',",
      "  description: 'Fixture provider',",
      "  provider: {",
      "    label: 'Fixture',",
      "    docsPath: '/docs/fixture',",
      "    catalog: { run: async () => ({ provider: { id: 'fixture-provider' } }) },",
      "  },",
      "});",
      "",
      "createChatChannelPlugin({ register() {} });",
      "buildSecretInputSchema();",
      "registerPluginHttpRoute({ path: resolveWebhookPath('hook') });",
      "",
      "export default definePluginEntry((api) => {",
      "  if (!pluginSdkMock) throw new Error('expected mock SDK');",
      "  if (!GPT5_BEHAVIOR_CONTRACT) throw new Error('expected dynamic subpath mock export');",
      "  provider.register(api);",
      "  api.registerHttpRoute({ path: resolveWebhookPath('hook'), handler() {} });",
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
    ["registration:registerProvider", "registration:registerHttpRoute", "registration:registerTool"],
  );
});

test("mock capture ignores type-only root SDK imports", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-sdk-type-import-"));
  const entrypoint = path.join(dir, "index.ts");
  await writeFile(
    entrypoint,
    [
      'import type { OpenClawPluginApi } from "openclaw/plugin-sdk";',
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry((api: OpenClawPluginApi) => {",
      "  api.on('before_tool_call', () => undefined);",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.ts", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), ["hook:before_tool_call"]);
});

test("mock capture supports unknown runtime root SDK exports", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-sdk-dynamic-root-"));
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(
    entrypoint,
    [
      'import { definePluginEntry, futureRuntimeHelper } from "openclaw/plugin-sdk";',
      "",
      "futureRuntimeHelper.normalizeFixture?.('fixture');",
      "export default definePluginEntry((api) => {",
      "  api.registerTool({ name: 'fixture_tool', run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), ["registration:registerTool"]);
});

test("mock capture accepts valid output when plugin code dirties process exit code", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-exit-code-"));
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(
    entrypoint,
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
      "process.exitCode = 1;",
      "export default definePluginEntry({",
      "  register(api) {",
      "    api.registerProvider({ id: 'fixture-provider' });",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), [
    "registration:registerProvider",
  ]);
});

test("mock capture prefers discovered bare mocks over installed dependency exports", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-bare-capture-"));
  await mkdir(path.join(dir, "node_modules/typebox"), { recursive: true });
  await writeFile(
    path.join(dir, "node_modules/typebox/package.json"),
    JSON.stringify({ name: "typebox", version: "0.0.0", type: "module", exports: "./index.js" }, null, 2),
    "utf8",
  );
  await writeFile(path.join(dir, "node_modules/typebox/index.js"), "export const Type = {};\n", "utf8");
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(
    entrypoint,
    [
      "import path from 'node:path';",
      'import { Static, Type } from "typebox";',
      'import { resolvePreferredOpenClawTmpDir } from "fixture-api";',
      "export function register(api) {",
      "  if (!Static || !Type) throw new Error('expected mocked typebox exports');",
      "  path.join(resolvePreferredOpenClawTmpDir(), 'fixture');",
      "  api.registerTool({ name: 'fixture_tool', inputSchema: Type.Object({}), run() {} });",
      "}",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), ["registration:registerTool"]);
});

test("mock capture expands bundled channel entry registration shells", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-bundled-channel-capture-"));
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(
    entrypoint,
    [
      'import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";',
      "export default defineBundledChannelEntry({",
      "  id: 'fixture-channel',",
      "  name: 'Fixture Channel',",
      "  description: 'Fixture channel',",
      "  plugin: { specifier: './channel.js', exportName: 'fixtureChannel' },",
      "  registerFull(api) {",
      "    api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), [
    "registration:registerChannel",
    "registration:registerTool",
  ]);
});

test("mock capture follows bundled channel linked registerFull exports", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-bundled-channel-linked-capture-"));
  await writeFile(
    path.join(dir, "index.ts"),
    [
      'import { defineBundledChannelEntry, loadBundledEntryExportSync } from "openclaw/plugin-sdk/channel-entry-contract";',
      "",
      "function registerFull(api) {",
      "  const register = loadBundledEntryExportSync(import.meta.url, {",
      "    specifier: './api.js',",
      "    exportName: 'registerFixtureFull',",
      "  });",
      "  register(api);",
      "}",
      "",
      "export default defineBundledChannelEntry({",
      "  id: 'fixture-channel',",
      "  name: 'Fixture Channel',",
      "  description: 'Fixture channel',",
      "  plugin: { specifier: './channel-plugin-api.js', exportName: 'fixtureChannel' },",
      "  registerFull,",
      "});",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "api.ts"),
    [
      'import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";',
      "",
      "const schema = buildSecretInputSchema().optional();",
      "",
      "export function registerFixtureFull(api) {",
      "  schema.parse(undefined);",
      "  api.registerCommand({ name: 'fixture.command', run() {} });",
      "}",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("index.ts", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(result.captured.map((item) => `${item.kind}:${item.name}`), [
    "registration:registerChannel",
    "registration:registerCommand",
  ]);
});
