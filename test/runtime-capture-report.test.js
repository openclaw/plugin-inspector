import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildRuntimeCaptureReport,
  captureEntrypoint,
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

test("runtime capture records conversation binding resolved callbacks", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-binding-resolved-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-binding-resolved",
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
      "  api.onConversationBindingResolved(() => undefined);",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.summary.capturedCount, 1);
  assert.equal(captureReport.summary.hookCount, 1);
  assert.deepEqual(
    captureReport.results[0].captured.map((entry) => `${entry.kind}:${entry.name}`),
    ["hook:onConversationBindingResolved"],
  );
});

test("runtime capture report synthesizes newly imported mocked SDK exports", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-dynamic-export-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-dynamic-sdk-export",
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
      "export function register(api) {",
      "  if (!definitelyMissing) throw new Error('expected dynamic mock export');",
      "  api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "}",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.results[0].status, "captured");
  assert.deepEqual(captureReport.results[0].captured.map((entry) => `${entry.kind}:${entry.name}`), [
    "registration:registerTool",
  ]);

  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-capture-dynamic-export-out-"));
  await writeRuntimeCaptureReport(captureReport, {
    jsonPath: path.join(outDir, "capture.json"),
    markdownPath: path.join(outDir, "capture.md"),
  });
  assert.match(await readFile(path.join(outDir, "capture.md"), "utf8"), /registerTool/);
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

test("runtime capture supports TypeScript entrypoints, SDK subpaths, external mocks, and noisy output", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-ts-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-typescript-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.ts"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "helper.ts"),
    ["export type WeatherConfig = { city: string };", "export const toolName: string = 'weather_ts';"].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "sdk-barrel.ts"),
    'export { ReexportedConfigSchema, reexportedSdkHelper } from "openclaw/plugin-sdk/reexported";\n',
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.ts"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
      'import { buildChannelConfigSchema } from "openclaw/plugin-sdk/core";',
      'import { z } from "openclaw/plugin-sdk/zod";',
      'import defaultZod, { type ZodType } from "zod";',
      'import { externalHelper } from "missing-runtime-dependency";',
      'import { MemoryStore } from "missing-class-dependency";',
      'import { toolName } from "./helper";',
      'import { ReexportedConfigSchema, reexportedSdkHelper } from "./sdk-barrel.js";',
      "",
      "class FileStore extends MemoryStore {}",
      "new FileStore();",
      "const typedSchema: ZodType | undefined = undefined;",
      "const defaultConfig = z",
      "  .object({ enabled: z.boolean().default(false), reexported: ReexportedConfigSchema })",
      "  .parse({});",
      "defaultZod.object({ city: defaultZod.string().default('sf') }).parse({});",
      "structuredClone(defaultConfig);",
      "buildChannelConfigSchema(z.object({})).parse?.({});",
      "console.log('plugin startup noise', Boolean(typedSchema));",
      "setTimeout(() => console.log('late plugin noise'), 0);",
      "externalHelper?.();",
      "reexportedSdkHelper?.();",
      "export default definePluginEntry((api) => {",
      "  api.runtime.state.resolveStateDir();",
      "  const stateStore = api.runtime.state.openSyncKeyedStore({ namespace: 'weather', maxEntries: 10 });",
      "  stateStore.register('forecast', { value: 'sunny' });",
      "  stateStore.lookup('forecast');",
      "  api.on('before_tool_call', () => undefined);",
      "  api.registerTool({ name: toolName, inputSchema: z.object({}), run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.summary.capturedCount, 1);
  assert.equal(captureReport.summary.registrationCount, 1);
  assert.equal(captureReport.summary.hookCount, 1);
  assert.match(captureReport.results[0].processOutput.stdout, /plugin startup noise/);
  assert.match(captureReport.results[0].processOutput.stdout, /late plugin noise/);
});

test("runtime capture synthesizes manifest config before plugin registration", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-config-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-configured-memory",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.ts"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: "configured-memory",
        configSchema: {
          type: "object",
          properties: {
            embedding: {
              type: "object",
              minProperties: 1,
              properties: {
                provider: { type: "string" },
                model: { type: "string" },
              },
            },
            autoCapture: { type: "boolean" },
            autoRecall: { type: "boolean" },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.ts"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
      "export default definePluginEntry({",
      "  register(api) {",
      "    if (!api.pluginConfig?.embedding) {",
      "      api.registerService({ id: 'configured-memory-disabled', start() {} });",
      "      return;",
      "    }",
      "    api.on('agent_end', () => undefined);",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await captureEntrypoint("src/index.ts", {
    cwd: rootDir,
    mockSdk: true,
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(
    result.captured.map((item) => `${item.kind}:${item.name}`),
    ["hook:agent_end"],
  );
});

test("runtime capture supports namespace imports from mocked externals", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-zod-namespace-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-zod-namespace",
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
      'import * as z from "zod";',
      "const city = z.string().transform((value) => value).pipe(z.string()).optional().catch('unknown').default('sf');",
      "const schema = z.object({ city });",
      "export default definePluginEntry((api) => {",
      "  api.registerTool({ name: schema.parse({}).city, inputSchema: {}, run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.summary.registrationCount, 1);
});

test("runtime capture mock SDK supports config schemas and provider catalogs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-provider-catalog-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-provider-catalog",
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
      'import { buildPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";',
      'import { buildSingleProviderApiKeyCatalog, createProviderApiKeyAuthMethod, defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";',
      "",
      "const config = buildPluginConfigSchema({ providerId: { parse: (value) => value ?? 'fixture-provider' } }).parse({});",
      "const auth = createProviderApiKeyAuthMethod({ id: 'fixture-key' });",
      "const catalog = buildSingleProviderApiKeyCatalog({",
      "  id: config.providerId,",
      "  auth,",
      "  buildModels: async () => [{ id: 'fixture-model' }],",
      "});",
      "const listed = await catalog.run({ apiKey: 'redacted' });",
      "",
      "export default defineSingleProviderPluginEntry({",
      "  id: config.providerId,",
      "  provider: listed.provider,",
      "  register(api) {",
      "    api.registerProvider({ id: listed.provider.id, auth, catalog, modelCount: listed.models.length });",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.summary.registrationCount, 2);
  assert.deepEqual(
    captureReport.results[0].captured.map((entry) => `${entry.kind}:${entry.name}`),
    ["registration:registerProvider", "registration:registerProvider"],
  );
});

test("runtime capture mock SDK supports channel entries, gateway responders, and action gates", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-channel-entry-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-channel-entry",
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
      'import { createActionGate } from "openclaw/plugin-sdk/channel-actions";',
      'import { buildChannelOutboundSessionRoute, createChannelPluginBase, createChatChannelPlugin, defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";',
      "",
      "const gate = createActionGate({ gateway: true });",
      "const route = buildChannelOutboundSessionRoute({ agentId: 'agent', channel: 'fixture-channel', to: 'sender', chatType: 'direct' });",
      "const plugin = createChatChannelPlugin({",
      "  base: createChannelPluginBase({",
      "    id: 'fixture-channel',",
      "    setup: () => ({ accountId: 'default' }),",
      "  }),",
      "  outbound: {",
      "    base: { resolveOutboundSessionRoute: () => route },",
      "    attachedResults: {",
      "      channel: 'fixture-channel',",
      "      sendText: async ({ text }) => ({ messageId: text }),",
      "    },",
      "  },",
      "});",
      "",
      "export default defineChannelPluginEntry({",
      "  id: 'fixture-channel-entry',",
      "  name: 'Fixture channel',",
      "  description: 'Fixture channel',",
      "  plugin,",
      "  registerFull(api) {",
      "    if (gate('gateway')) {",
      "      api.registerGatewayMethod('fixture.ping', ({ respond }) => respond(true, { ok: true }), { scope: 'operator.read' });",
      "    }",
      "    api.registerService({ id: 'fixture-service', start() {}, stop() {} });",
      "  },",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: rootDir });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.deepEqual(
    captureReport.results[0].captured.map((entry) => `${entry.kind}:${entry.name}`),
    ["registration:registerChannel", "registration:registerGatewayMethod", "registration:registerService"],
  );
  assert.equal(captureReport.results[0].captured[0].arguments[0].keys.includes("plugin"), true);
});

test("runtime capture keeps dist chunk imports rooted at their original package", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-dist-"));
  await mkdir(path.join(rootDir, "dist", "extensions", "weather"), { recursive: true });
  await writeFile(path.join(rootDir, "dist", "package-shared.js"), "export const toolName = 'weather_dist';\n", "utf8");
  const packageRoot = path.join(rootDir, "dist", "extensions", "weather");
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw-dist-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(path.join(packageRoot, "index.js"), 'export { default } from "./src/index.js";\n', "utf8");
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "src", "index.js"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      'import { toolName } from "../../../package-shared.js";',
      "",
      "export default definePluginEntry((api) => {",
      "  api.registerTool({ name: toolName, inputSchema: { type: 'object' }, run() {} });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const config = await loadPluginRootConfig(null, { cwd: packageRoot });
  const compatibilityReport = await inspectCompatibilityFixtureSet(config, { openclawPath: false });
  const captureReport = await buildRuntimeCaptureReport({ report: compatibilityReport, rootDir: packageRoot });

  assert.equal(captureReport.summary.failedCount, 0);
  assert.equal(captureReport.summary.registrationCount, 1);
});
