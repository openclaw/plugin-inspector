import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function inspectPublishedJson(t, source, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "plugin");
  await mkdir(input);
  await writeFile(path.join(input, "package.json"), JSON.stringify({
    name: "@example/inventory", version: "1.0.0", type: "module", openclaw: { extensions: ["./index.ts"] },
  }));
  await writeFile(path.join(input, "openclaw.plugin.json"), JSON.stringify({
    id: "inventory", name: "Inventory", contracts: { tools: ["inventory_tool"] }, configSchema: { type: "object" },
  }));
  await writeFile(path.join(input, "index.ts"), source);
  for (const [name, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(input, name)), { recursive: true });
    await writeFile(path.join(input, name), text);
  }
  if (options.targetFiles) {
    options.sdkUsageTargetPath = path.join(directory, "target");
    for (const [name, text] of Object.entries(options.targetFiles)) {
      await mkdir(path.dirname(path.join(options.sdkUsageTargetPath, name)), { recursive: true });
      await writeFile(path.join(options.sdkUsageTargetPath, name), text);
    }
  }
  const run = await pluginRoot.runCheck({
    pluginRoot: input, outDir: path.join(directory, "reports"), openclawPath: false,
    sdkUsageInputKind: "source", capture: false, allowExecution: false, ...options,
  });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
}

test("serialized reports inventory supported SDK references without executing plugin code", async (t) => {
  const report = await inspectPublishedJson(t, `
import { freshApi as supported } from "openclaw/plugin-sdk/new-surface";
import type { Options } from "openclaw/plugin-sdk/new-surface";
export { freshApi as renamed } from "openclaw/plugin-sdk/new-surface";
const options: Options = {};
supported(options);
throw new Error("Inspection must not execute this plugin");
`);
  assert.ok(report.sdkUsage, "actual JSON must contain the full inventory");
  assert.equal(report.sdkUsage.schemaVersion, 1);
  assert.equal(report.sdkUsage.analysisVersion, "1");
  assert.equal(report.sdkUsage.inputKind, "source");
  assert.equal(report.sdkUsage.status, "complete");
  assert.deepEqual(report.sdkUsage.coverage, { filesDiscovered: 3, filesAnalyzed: 3, filesExcluded: 0 });
  assert.deepEqual(report.sdkUsage.unknowns, []);
  assert.deepEqual(report.sdkUsage.entries.map(({ key, classification, referenceKinds, deprecationCodes }) => ({
    key, classification, referenceKinds, deprecationCodes,
  })), [
    { key: "manifest-contract:manifest.contracts.tools:inventory_tool", classification: "declarative", referenceKinds: ["manifest-declaration"], deprecationCodes: [] },
    { key: "sdk-export:openclaw/plugin-sdk/new-surface#Options", classification: "type", referenceKinds: ["type-import", "type-reference"], deprecationCodes: [] },
    { key: "sdk-export:openclaw/plugin-sdk/new-surface#freshApi", classification: "runtime", referenceKinds: ["call", "import", "reexport"], deprecationCodes: [] },
    { key: "sdk-module:openclaw/plugin-sdk/new-surface", classification: "mixed", referenceKinds: ["import", "reexport", "type-import"], deprecationCodes: [] },
  ]);
  for (const entry of report.sdkUsage.entries) {
    assert.ok(entry.evidence.length > 0);
    assert.ok(entry.evidence.every((site) => site.path && site.line > 0 && site.snippet.trim()));
  }
  assert.deepEqual(report.fixtures[0].sdkUsage, report.sdkUsage);
});

test("inventory follows local barrels, direct aliases, namespaces and dynamic imports", async (t) => {
  const report = await inspectPublishedJson(t, `
import { renamed } from "./barrel.js";
import * as sdk from "openclaw/plugin-sdk/example";
const callable = renamed;
callable();
sdk.other();
const { dynamic } = await import("openclaw/plugin-sdk/example");
dynamic();
export { renamed as publicAlias };
`, { files: { "barrel.ts": 'export { original as renamed } from "openclaw/plugin-sdk/example";' } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  for (const [name, kinds] of [
    ["original", ["call", "import", "reexport"]],
    ["*", ["import"]],
    ["other", ["call"]],
    ["dynamic", ["call", "dynamic-import"]],
  ]) assert.deepEqual(entries.get(`sdk-export:openclaw/plugin-sdk/example#${name}`)?.referenceKinds, kinds, name);
});

test("inventory follows typed API/runtime aliases and hook names without inventing wrapper calls", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";
const EVENT = "before_agent_start";
export function register(api: OpenClawPluginApi) {
  const host = api;
  const runtime = host.runtime;
  const { registerTool } = host;
  registerTool({});
  host.on(EVENT, () => {});
  runtime.channel.reply.dispatchReplyFromConfig({});
  const wrapper = () => runtime.state.openKeyedStore({});
  wrapper();
  host.config.gateway.controlUi.basePath.trim();
}
type Reply = PluginRuntime["channel"]["reply"];
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  for (const [key, classification, kinds] of [
    ["api-member:api.registerTool", "runtime", ["call", "member-access"]],
    ["api-member:api.on", "runtime", ["call"]],
    ["hook:hook.before_agent_start", "runtime", ["hook-registration"]],
    ["runtime-member:runtime.channel.reply.dispatchReplyFromConfig", "runtime", ["call"]],
    ["runtime-member:runtime.state.openKeyedStore", "runtime", ["call"]],
    ["runtime-member:runtime.channel.reply", "type", ["type-reference"]],
    ["api-member:api.config.gateway.controlUi.basePath", "runtime", ["member-access"]],
  ]) {
    assert.equal(entries.get(key)?.classification, classification, key);
    assert.deepEqual(entries.get(key)?.referenceKinds, kinds, key);
  }
  assert.ok(!entries.has("api-member:api.runtime"));
  assert.ok(!entries.has("runtime-member:runtime.channel"));
  assert.ok(!entries.has("api-member:api.config.gateway.controlUi.basePath.trim"));
});

test("full inventory preserves author deprecation findings and allows filtering deprecated entries", async (t) => {
  const report = await inspectPublishedJson(t, `
import { loadSessionStore, getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
loadSessionStore("example");
getSessionEntry({});
`, { authorFacing: true });
  const deprecated = report.sdkUsage.entries.filter((entry) => entry.deprecationCodes.length);
  assert.deepEqual(deprecated.map((entry) => [entry.key, entry.deprecationCodes]), [
    ["sdk-export:openclaw/plugin-sdk/config-runtime#loadSessionStore", ["sdk-load-session-store"]],
  ]);
  assert.ok(report.sdkUsage.entries.some((entry) => entry.key.endsWith("#getSessionEntry")));
  const warning = report.warnings.find((finding) => finding.code === "sdk-load-session-store");
  assert.ok(warning);
  const issue = report.issues.find((finding) => finding.code === "sdk-load-session-store");
  assert.ok(issue?.authorRemediation.summary);
  assert.match(issue.authorRemediation.summary, /row-scoped session helpers/);
  assert.match(warning.message, /getSessionEntry/);
});

test("unresolved member access and an opaque runtime escape cannot report complete coverage", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import opaqueConsumer from "external-consumer";
export function register(api: OpenClawPluginApi) {
  opaqueConsumer(api.runtime);
  api.runtime.channel[process.env.DYNAMIC_METHOD]();
}
`);
  assert.equal(report.sdkUsage.status, "partial");
  assert.equal(report.sdkUsage.unknowns.length, 2);
  assert.ok(report.sdkUsage.unknowns.some((unknown) => unknown.expression.includes("opaqueConsumer(api.runtime)")));
  assert.ok(report.sdkUsage.unknowns.some((unknown) => unknown.expression.includes("DYNAMIC_METHOD")));
});

test("published declarations establish an unannotated registration API without host implementation files", async (t) => {
  const report = await inspectPublishedJson(t, `
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
export default definePluginEntry({ register(api) { api.registerTool({}); } });
`, { sdkUsageInputKind: "artifact", targetFiles: {
    "package.json": JSON.stringify({name: "openclaw", exports: { "./plugin-sdk/plugin-entry": {types: "./dist/plugin-sdk/plugin-entry.d.ts", default: "./dist/plugin-sdk/plugin-entry.js"} }}),
    "dist/plugin-sdk/plugin-entry.d.ts": `
export type OpenClawPluginApi = { registerTool(tool: unknown): void };
export declare function definePluginEntry(options: { register(api: OpenClawPluginApi): void }): unknown;
`,
  } });
  assert.equal(report.sdkUsage.inputKind, "artifact");
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool")?.referenceKinds, ["call"]);
  assert.ok(!JSON.stringify(report).includes("sdkUsageTargetPath"));
});
