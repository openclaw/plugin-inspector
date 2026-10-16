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
    options.sdkUsageTargetPath = options.nestedUnderTarget ? directory : path.join(directory, "target");
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

test("minified bundles retain every SDK identity without repeating an unbounded source line", async (t) => {
  const source = `/*${"😀".repeat(400)}*/ ` + 'import * as sdk from "openclaw/plugin-sdk/example";' + Array.from({ length: 1000 }, (_, index) => `sdk.method${index}();`).join("");
  const report = await inspectPublishedJson(t, source, { sdkUsageInputKind: "artifact" });
  const exports = report.sdkUsage.entries.filter((entry) => entry.kind === "sdk-export" && entry.identity.endsWith("#*") === false);
  assert.equal(exports.length, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(report.sdkUsage)) < 2 * 1024 * 1024, "bounded evidence must keep this 1,003-entry inventory below 2 MiB");
  for (const entry of exports) for (const evidence of entry.evidence) {
    assert.equal(evidence.line, 1);
    assert.ok(evidence.snippet.length <= 500);
    assert.ok(source.includes(evidence.snippet));
    assert.ok(evidence.snippet.includes(entry.identity.split("#")[1]), entry.key);
    assert.ok([...evidence.snippet].every((character) => character.codePointAt(0) < 0xd800 || character.codePointAt(0) > 0xdfff), "excerpt must not split a surrogate pair");
  }
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

test("dynamic SDK namespace selection remains an explicit unresolved dependency", async (t) => {
  const report = await inspectPublishedJson(t, `
import * as sdk from "openclaw/plugin-sdk/core";
sdk[process.env.METHOD]();
`);
  assert.equal(report.sdkUsage.status, "partial");
  assert.equal(report.sdkUsage.unknowns.length, 1);
  assert.equal(report.sdkUsage.unknowns[0].expression, "sdk[process.env.METHOD]");
  assert.ok(report.sdkUsage.entries.some((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/core#*"));
});

test("dynamic intermediate SDK receivers cannot report complete coverage", async (t) => {
  const report = await inspectPublishedJson(t, `
export default { register(api) {
  const name = process.env.CHANNEL;
  api.runtime.channel[name].send();
} };
`);
  assert.equal(report.sdkUsage.status, "partial");
  assert.equal(report.sdkUsage.unknowns.length, 1);
  assert.equal(report.sdkUsage.unknowns[0].expression, "api.runtime.channel[name]");
  assert.ok(!report.sdkUsage.entries.some((entry) => entry.key.endsWith(".send")));
});

test("relative imports cannot attribute SDK usage from outside the inspected package", async (t) => {
  for (const nestedUnderTarget of [false, true]) {
    const report = await inspectPublishedJson(t, `
import { helper } from "../outside.js";
helper();
`, {
      files: { "../outside.ts": 'export { helper } from "openclaw/plugin-sdk/outside";' },
      sdkUsageInputKind: "artifact", nestedUnderTarget,
      ...(nestedUnderTarget ? { targetFiles: { "package.json": '{"name":"openclaw"}' } } : {}),
    });
    assert.deepEqual(report.sdkUsage.entries.filter((entry) => entry.kind === "sdk-export"), []);
  }
});

test("extensionless production requires include JavaScript helpers in excluded directories", async (t) => {
  const report = await inspectPublishedJson(t, "", {
    sdkUsageInputKind: "artifact",
    files: {
      "package.json": JSON.stringify({ name: "@example/inventory", version: "1.0.0", type: "commonjs", openclaw: { extensions: ["./index.cjs"] } }),
      "index.cjs": 'require("./test-utils/helper");',
      "test-utils/helper.js": 'const { run } = require("openclaw/plugin-sdk/example"); run();',
    },
  });
  const entry = report.sdkUsage.entries.find((item) => item.key === "sdk-export:openclaw/plugin-sdk/example#run");
  assert.ok(entry, "production dependency must contribute its SDK usage");
  assert.equal(entry.classification, "runtime");
  assert.ok(entry.referenceKinds.includes("call"));
  assert.ok(entry.evidence.every((site) => site.path === "test-utils/helper.js"));
  assert.equal(report.sdkUsage.coverage.filesExcluded, 0);
  assert.equal(report.sdkUsage.status, "complete");
});

test("ambient SDK declarations must be part of the inspected files", async (t) => {
  const declaration = 'import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core"; declare global { const externalHost: OpenClawPluginApi; }';
  for (const file of ["../outside.d.ts", "node_modules/@types/ambient/index.d.ts", "./included.d.ts"]) {
    const report = await inspectPublishedJson(t, `/// <reference path="${file}" />\nexternalHost.registerTool({});`, {
      files: { [file]: declaration }, sdkUsageInputKind: "source",
    });
    assert.equal(report.sdkUsage.entries.some((entry) => entry.key === "api-member:api.registerTool"), file === "./included.d.ts", file);
  }
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

test("packed shared declarations retain API ownership through public reexports", async (t) => {
  const report = await inspectPublishedJson(t, `
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
export default definePluginEntry({ register(api) { api.registerTool({}); } });
`, { sdkUsageInputKind: "artifact", targetFiles: {
    "package.json": JSON.stringify({name: "openclaw", exports: { "./plugin-sdk/plugin-entry": {types: "./dist/plugin-sdk/plugin-entry.d.ts"} }}),
    "dist/plugin-sdk/plugin-entry.d.ts": 'export { definePluginEntry } from "../shared-types.js";',
    "dist/shared-types.d.ts": `
export type OpenClawPluginApi = { registerTool(tool: unknown): void };
export declare function definePluginEntry(options: { register(api: OpenClawPluginApi): void }): unknown;
`,
  } });
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool")?.referenceKinds, ["call"]);
});

test("local functions, lazy local modules and cyclic spread aliases preserve direct provenance", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import { helper } from "openclaw/plugin-sdk/example";
let deps = { helper };
deps = { ...deps };
deps.helper();
function install(api: OpenClawPluginApi): void { api.registerTool({}); }
export function register(api: OpenClawPluginApi) { install(api); }
const load = createLazyRuntimeModule(() => import("./barrel.js"));
const { local } = await load();
local();
`, { files: { "barrel.ts": 'export { original as local } from "openclaw/plugin-sdk/example";' } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.equal(report.sdkUsage.status, "complete");
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#helper")?.referenceKinds, ["call", "import"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#original")?.referenceKinds, ["call", "dynamic-import", "member-access", "reexport"]);
  assert.deepEqual(entries.get("api-member:api.registerTool")?.referenceKinds, ["call"]);
});

test("documented host capability helpers retain export identity", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { PluginCapabilityCatalogContext } from "openclaw/plugin-sdk/plugin-entry";
export function catalog({ formatErrorMessage }: Pick<PluginCapabilityCatalogContext, "formatErrorMessage">) {
  return formatErrorMessage(new Error("example"));
}
`, { targetFiles: {
    "package.json": JSON.stringify({name:"openclaw",exports:{"./plugin-sdk/plugin-entry":{types:"./dist/plugin-sdk/plugin-entry.d.ts"}}}),
    "dist/plugin-sdk/plugin-entry.d.ts": 'export type PluginCapabilityCatalogContext = { formatErrorMessage(error: unknown): string };',
  } });
  const entry = report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/error-runtime#formatErrorMessage");
  assert.equal(entry?.classification, "mixed");
  assert.deepEqual(entry?.referenceKinds, ["call", "member-access", "type-reference"]);
});

test("published plain-function entrypoints establish API ownership without SDK imports", async (t) => {
  const report = await inspectPublishedJson(t, `
export default function plugin(api) {
  api.logger.info("installed");
  api.on("llm_input", () => {});
}
function unrelated(api) { api.lookalike(); }
`, { sdkUsageInputKind: "artifact" });
  assert.deepEqual(report.sdkUsage.entries.map((entry) => entry.key), [
    "api-member:api.logger.info", "api-member:api.on", "hook:hook.llm_input",
    "manifest-contract:manifest.contracts.tools:inventory_tool",
  ]);
  assert.equal(report.sdkUsage.status, "complete");
});

test("standard string operations stop at the SDK value rather than becoming SDK calls", async (t) => {
  const report = await inspectPublishedJson(t, `
import { MESSAGE } from "openclaw/plugin-sdk/example";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
function format(value: string) { return value.replace("x", "y").trim(); }
format(MESSAGE);
export function register(api: OpenClawPluginApi) {
  function size(value: string) { return value.length; }
  size(api.runtime.version);
}
`, { targetFiles: {
    "package.json": JSON.stringify({ name: "openclaw", exports: { "./plugin-sdk/example": { types: "./dist/example.d.ts" } } }),
    "dist/example.d.ts": 'export declare const MESSAGE: string;',
  } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#MESSAGE")?.referenceKinds, ["import"]);
  assert.deepEqual(entries.get("runtime-member:runtime.version")?.referenceKinds, ["member-access"]);
  assert.equal(entries.has("runtime-member:runtime.version.length"), false);
});

test("class constructor properties retain declared API runtime ownership", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
type Deps = { runtime: NonNullable<OpenClawPluginApi["runtime"]> };
export class Worker {
  constructor(private readonly deps: Pick<Deps, "runtime">) {}
  run() { this.deps.runtime.nodes.list({}); }
}
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "runtime-member:runtime.nodes.list")?.referenceKinds, ["call"]);
});

test("indexed imported types name their real export rather than inventing field exports", async (t) => {
  const report = await inspectPublishedJson(t, `
type Text = import("openclaw/plugin-sdk/example").Payload["text"];
type Register = import("openclaw/plugin-sdk/core").OpenClawPluginApi["registerTool"];
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.equal(entries.has("sdk-export:openclaw/plugin-sdk/example#text"), false);
  assert.equal(entries.has("sdk-export:openclaw/plugin-sdk/core#registerTool"), false);
  assert.deepEqual(entries.get("api-member:api.registerTool")?.referenceKinds, ["type-reference"]);
  assert.equal(entries.get("sdk-export:openclaw/plugin-sdk/example#Payload")?.classification, "type");
});

test("runtime interfaces preserve inherited public members and exclude local augmentations", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
interface LocalRuntime extends PluginRuntime {
  channel: PluginRuntime["channel"] & { local: { send(): void } };
}
const { getRuntime } = createPluginRuntimeStore<LocalRuntime>();
getRuntime().channel.reply.dispatch();
getRuntime().channel.local.send();
getRuntime().state.open();
`, { targetFiles: {
    "package.json": JSON.stringify({ name: "openclaw", exports: { "./plugin-sdk/core": { types: "./dist/core.d.ts" } } }),
    "dist/core.d.ts": 'export type PluginRuntime = { channel: { reply: { dispatch(): void } }; state: { open(): void } };',
  } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("runtime-member:runtime.channel.reply.dispatch")?.referenceKinds, ["call"]);
  assert.deepEqual(entries.get("runtime-member:runtime.state.open")?.referenceKinds, ["call"]);
  assert.equal(entries.has("runtime-member:runtime.channel.local.send"), false);
});

test("separate calls to a local helper do not exchange SDK return aliases", async (t) => {
  const report = await inspectPublishedJson(t, `
import { first, second } from "openclaw/plugin-sdk/example";
function fallback(value, otherwise) { return value ?? otherwise; }
const selected = { call: fallback(undefined, first) };
const unused = fallback(undefined, second);
selected.call();
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#first")?.referenceKinds, ["call", "import"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#second")?.referenceKinds, ["import"]);
});

test("declared local lazy loaders resolve their API destinations", async (t) => {
  const report = await inspectPublishedJson(t, `
import { createLazyRuntimeSurface } from "openclaw/plugin-sdk/lazy-runtime";
import { loadBundledEntryExportSync } from "openclaw/plugin-sdk/channel-entry-contract";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export function register(api: OpenClawPluginApi) {
  const load = createLazyRuntimeSurface(() => import("./local.js"), mod => mod.setup(api));
  loadBundledEntryExportSync(import.meta.url, { specifier: "./local.js", exportName: "setup" })(api);
}
`, { files: { "local.ts": 'import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core"; export function setup(api: OpenClawPluginApi) { api.registerTool({}); }' } });
  assert.equal(report.sdkUsage.status, "complete");
  assert.deepEqual(report.sdkUsage.unknowns, []);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool")?.referenceKinds, ["call"]);
});

test("typeof a concrete runtime member retains its type dependency", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export function register(api: OpenClawPluginApi) {
  type Reader = ReturnType<typeof api.runtime.agent.session.createSessionEntryListReader>;
  api.runtime.agent.session.createSessionEntryListReader({});
}
`);
  const entry = report.sdkUsage.entries.find((entry) => entry.key === "runtime-member:runtime.agent.session.createSessionEntryListReader");
  assert.equal(entry?.classification, "mixed");
  assert.deepEqual(entry?.referenceKinds, ["call", "type-reference"]);
});

test("computed keys stay paired with their object through local helper calls", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
function read(record: Record<string, unknown>, key: string) { return record[key]; }
function optional(record: Record<string, unknown>, key: string) { return read(record, key); }
export function register(api: OpenClawPluginApi) {
  optional(api.pluginConfig, "rootSetting");
  optional({ itemSetting: true }, "itemSetting");
}
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.equal(entries.has("api-member:api.pluginConfig.rootSetting"), true);
  assert.equal(entries.has("api-member:api.pluginConfig.itemSetting"), false);
  assert.equal(report.sdkUsage.status, "complete");
});

test("a narrowed import type selects its export without adding namespace type use", async (t) => {
  const report = await inspectPublishedJson(t, `
import { createLazyRuntimeModule, createLazyRuntimeSurface } from "openclaw/plugin-sdk/lazy-runtime";
const load = createLazyRuntimeModule(() => import("openclaw/plugin-sdk/example"));
type Run = (typeof import("openclaw/plugin-sdk/example"))["run"];
const result = createLazyRuntimeSurface(load, runtime => runtime.run());
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.equal(entries.get("sdk-export:openclaw/plugin-sdk/example#*")?.classification, "runtime");
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#run")?.referenceKinds, ["call", "dynamic-import", "type-reference"]);
});

test("Promise.all distinguishes direct imports from destructuring a local lazy namespace", async (t) => {
  const report = await inspectPublishedJson(t, `
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
const load = createLazyRuntimeModule(() => import("./barrel.js"));
const [{ local }, { direct }] = await Promise.all([load(), import("openclaw/plugin-sdk/example")]);
local(); direct();
`, { files: { "barrel.ts": 'export { original as local } from "openclaw/plugin-sdk/example";' } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#original")?.referenceKinds, ["call", "dynamic-import", "member-access", "reexport"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#direct")?.referenceKinds, ["call", "dynamic-import"]);
});

test("tuple iteration retains SDK-valued callable aliases", async (t) => {
  const report = await inspectPublishedJson(t, `
import { exists } from "openclaw/plugin-sdk/example";
const checks = [["one", exists], ["two", exists]] as const;
for (const [label, check] of checks) { check(label); }
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#exists")?.referenceKinds, ["call", "import", "member-access"]);
});

test("published CommonJS entrypoints receive API ownership through default wrappers", async (t) => {
  const report = await inspectPublishedJson(t, 'function unrelated(api) { api.lookalike(); }', {
    sdkUsageInputKind: "artifact",
    files: {
      "package.json": JSON.stringify({ name: "inventory", version: "1.0.0", openclaw: { extensions: ["./entry.cjs"] } }),
      "entry.cjs": 'module.exports = { default: { register(api) { api.registerTool({}); } } };',
    },
  });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("api-member:api.registerTool")?.referenceKinds, ["call"]);
  assert.equal(entries.has("api-member:api.lookalike"), false);
});

test("an immediately invoked callable fallback is a call rather than a separate member read", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export function register(api: OpenClawPluginApi) {
  (api.logger.warn ?? console.warn)("example");
}
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "api-member:api.logger.warn")?.referenceKinds, ["call"]);
});

test("indexed local typeof containers retain selected SDK type dependencies", async (t) => {
  const report = await inspectPublishedJson(t, `
import { warn, unrelated } from "openclaw/plugin-sdk/example";
const host = { warn, unrelated };
type Host = typeof host;
type Warn = Host["warn"];
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#warn")?.referenceKinds, ["import", "type-reference"]);
  assert.equal(entries.get("sdk-export:openclaw/plugin-sdk/example#unrelated")?.classification, "runtime");
});

test("Pick narrows an imported module type without implying namespace type use", async (t) => {
  const report = await inspectPublishedJson(t, `
const load = () => import("openclaw/plugin-sdk/example");
type Chosen = Pick<typeof import("openclaw/plugin-sdk/example"), "run">;
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#*")?.referenceKinds, ["dynamic-import"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#run")?.referenceKinds, ["type-reference"]);
});

test("local projected-type annotations do not add transitive SDK evidence", async (t) => {
  const report = await inspectPublishedJson(t, `
import { warn } from "openclaw/plugin-sdk/example";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
const helpers = { warn };
type Chosen = Pick<typeof helpers, "warn">;
type RuntimeChosen = Pick<PluginRuntime["state"], "openKeyedStore">;
type Renamed = Chosen;
export function consume(helpers: Chosen, runtime: RuntimeChosen) {}
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  for (const key of ["sdk-export:openclaw/plugin-sdk/example#warn", "runtime-member:runtime.state.openKeyedStore"]) {
    const entry = entries.get(key);
    assert.ok(entry.referenceKinds.includes("type-reference"), key);
    assert.ok(entry.evidence.some((site) => site.snippet.includes("Pick<")), key);
    assert.ok(entry.evidence.every((site) => !site.snippet.includes("function consume") && !site.snippet.includes("type Renamed")), key);
  }
});

test("a lazy import selector preserves its callable result and explicit type query", async (t) => {
  const report = await inspectPublishedJson(t, `
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
const load = createLazyRuntimeModule(() => import("openclaw/plugin-sdk/example").then(({ run }) => run));
const run = await load();
type Run = typeof run;
run();
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#run")?.referenceKinds, ["call", "dynamic-import", "type-reference"]);
});

test("an explicit public runtime cast establishes member ownership", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
export function configure(value: unknown) {
  const channel = value as PluginRuntime["channel"] | undefined;
  return { dispatch: channel?.reply.dispatchReplyFromConfig };
}
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "runtime-member:runtime.channel.reply.dispatchReplyFromConfig")?.referenceKinds, ["member-access"]);
});

test("an SDK result type does not turn arbitrary local values into exported implementations", async (t) => {
  const report = await inspectPublishedJson(t, `
type Result = import("openclaw/plugin-sdk/example").Result;
export function consume(value: Result) { return value.text; }
`);
  const entry = report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#Result");
  assert.equal(entry?.classification, "type");
  assert.deepEqual(entry?.referenceKinds, ["type-reference"]);
});

test("rest parameters preserve argument positions rather than spreading one SDK value", async (t) => {
  const report = await inspectPublishedJson(t, `
import { text } from "openclaw/plugin-sdk/example";
function show(...args) { const [message, actions] = args; actions.run(); return message; }
show(text, { run() {} });
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#text")?.referenceKinds, ["import", "member-access"]);
});

test("a local class retains unchanged SDK values assigned to its own properties", async (t) => {
  const report = await inspectPublishedJson(t, `
import { format } from "openclaw/plugin-sdk/example";
class Session {
  audio;
  constructor() { this.audio = format; }
  encode() { return this.audio.encoding; }
}
`);
  assert.deepEqual(report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#format")?.referenceKinds, ["import", "member-access"]);
});

test("published bundled packages and vendor code contribute SDK usage without installed dependency crawling", async (t) => {
  const options = { files: {
    "node_modules/bundled-helper/package.json": JSON.stringify({ name: "bundled-helper", main: "index.js" }),
    "node_modules/bundled-helper/index.js": 'export { bundled } from "openclaw/plugin-sdk/example";',
    "vendor/embedded.js": 'import { embedded } from "openclaw/plugin-sdk/example"; embedded();',
  } };
  const source = 'import { bundled } from "bundled-helper"; bundled();';
  const artifact = await inspectPublishedJson(t, source, { ...options, sdkUsageInputKind: "artifact" });
  const entries = new Map(artifact.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#bundled")?.referenceKinds, ["call", "import", "reexport"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#embedded")?.referenceKinds, ["call", "import"]);
  const checkout = await inspectPublishedJson(t, source, options);
  assert.equal(checkout.sdkUsage.entries.some((entry) => entry.kind === "sdk-export"), false);
});

test("a missing declared artifact entrypoint is partial rather than an audited empty inventory", async (t) => {
  const report = await inspectPublishedJson(t, "", {
    sdkUsageInputKind: "artifact",
    files: { "package.json": JSON.stringify({ name: "inventory", version: "1.0.0", openclaw: { extensions: ["./missing.js"] } }) },
  });
  assert.equal(report.sdkUsage.status, "partial");
  assert.ok(report.sdkUsage.unknowns.some((unknown) => unknown.path === "package.json" && /entrypoint/.test(unknown.reason)));
});

test("direct SDK-exported objects retain member operations while primitive builtins stop", async (t) => {
  const report = await inspectPublishedJson(t, `
import { tables, message } from "openclaw/plugin-sdk/example";
tables.filter(Boolean);
message.trim();
`, { targetFiles: {
    "src/plugin-sdk/example.ts": 'export declare const tables: readonly string[]; export declare const message: string;',
  } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#tables")?.referenceKinds, ["call", "import"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/example#message")?.referenceKinds, ["import"]);
});

test("SDK-declared methods keep their identities even when named like JavaScript builtins", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export function register(api: OpenClawPluginApi) { api.runtime.registry.map(); }
`, { targetFiles: {
    "src/plugin-sdk/core.ts": 'export type OpenClawPluginApi = { runtime: { registry: { map(): void } } };',
  } });
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("runtime-member:runtime.registry.map")?.referenceKinds, ["call"]);
  assert.equal(entries.has("runtime-member:runtime.registry"), false);
});

test("array fallback lengths stay at the SDK data field boundary", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export function register(api: OpenClawPluginApi) {
  const config = { paths: api.pluginConfig.paths ?? [] };
  return config.paths.length;
}
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.equal(entries.has("api-member:api.pluginConfig.paths"), true);
  assert.equal(entries.has("api-member:api.pluginConfig.paths.length"), false);
});

test("computed builtin results do not carry SDK field evidence into later container reads", async (t) => {
  const report = await inspectPublishedJson(t, `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
function statusFor(config) {
  const label = config.paths.length.toString();
  return { pathCount: config.paths.length, label };
}
function render(status) { return status.pathCount; }
export function register(api: OpenClawPluginApi) {
  const config = { paths: api.pluginConfig.paths ?? [] };
  const status = statusFor(config);
  const copied = { count: status.pathCount };
  copied.count.toString();
  render(status);
}
`);
  const entries = report.sdkUsage.entries.filter((entry) => entry.kind === "api-member");
  assert.deepEqual(entries.map((entry) => entry.identity), ["api.pluginConfig.paths"]);
  assert.deepEqual(entries[0].referenceKinds, ["member-access"]);
  assert.ok(entries[0].evidence.some((site) => site.snippet.includes("config.paths.length")));
  assert.ok(entries[0].evidence.every((site) => /api\.pluginConfig\.paths|config\.paths\.length/.test(site.snippet)), "computed numbers must not be evidence of an unchanged SDK field alias");
  assert.equal(report.sdkUsage.status, "complete");
});

test("later object properties and spreads replace earlier SDK aliases", async (t) => {
  const report = await inspectPublishedJson(t, `
export default { register(api) {
  const local = () => {};
  const direct = { run: api.registerTool, run: local };
  direct.run();
  const replaced = { run: api.registerCommand, ...{ run: local } };
  replaced.run();
  const selected = { run: local, ...{ run: api.registerService } };
  selected.run();
  const primitive = { run: api.registerProvider, ...{ run: null } };
  const read = primitive.run;
} };
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.identity, entry]));
  for (const identity of ["api.registerTool", "api.registerCommand", "api.registerProvider"]) {
    assert.deepEqual(entries.get(identity)?.referenceKinds, ["member-access"], identity);
    assert.equal(entries.get(identity)?.evidence.length, 1, identity);
  }
  assert.deepEqual(entries.get("api.registerService")?.referenceKinds, ["call", "member-access"]);
  assert.equal(report.sdkUsage.status, "complete");
});

test("TypeScript import-equals records SDK namespaces and their members", async (t) => {
  const report = await inspectPublishedJson(t, `
import sdk = require("openclaw/plugin-sdk/core");
sdk.createLogger();
import type types = require("openclaw/plugin-sdk/types");
type Options = types.Options;
`);
  const entries = new Map(report.sdkUsage.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(entries.get("sdk-module:openclaw/plugin-sdk/core")?.referenceKinds, ["require"]);
  assert.deepEqual(entries.get("sdk-export:openclaw/plugin-sdk/core#createLogger")?.referenceKinds, ["call", "require"]);
  assert.equal(entries.get("sdk-export:openclaw/plugin-sdk/core#*")?.classification, "runtime");
  assert.equal(entries.get("sdk-module:openclaw/plugin-sdk/types")?.classification, "type");
  assert.equal(entries.get("sdk-export:openclaw/plugin-sdk/types#Options")?.classification, "type");
  assert.equal(report.sdkUsage.status, "complete");
});

test("unresolved SDK import paths remain explicit unknowns", async (t) => {
  const report = await inspectPublishedJson(t, [
    'const name = process.env.SDK_MODULE;',
    'await import(`openclaw/plugin-sdk/${name}`);',
    'require("openclaw/plugin-sdk/" + name);',
    'const specifier = `openclaw/plugin-sdk/${name}`;',
    'await import(specifier);',
    'await import(`other-package/${name}`);',
    'function local(require) { require(`openclaw/plugin-sdk/${name}`); }',
    'const prefix = "openclaw/plugin-sdk";',
    'await import(`${prefix}/${name}`);',
    'await import("openclaw/" + "plugin-sdk/" + name);',
  ].join("\n"));
  assert.equal(report.sdkUsage.status, "partial");
  assert.equal(report.sdkUsage.unknowns.length, 5);
  assert.deepEqual(report.sdkUsage.unknowns.map((unknown) => unknown.line), [2, 3, 5, 9, 10]);
  assert.ok(report.sdkUsage.unknowns.every((unknown) => /SDK.*import|SDK.*module/.test(unknown.reason)));
  assert.equal(report.sdkUsage.entries.some((entry) => entry.kind === "sdk-module"), false);
});

test("fully resolved SDK string fragments produce concrete module inventories", async (t) => {
  const report = await inspectPublishedJson(t, [
    'const prefix = "openclaw/plugin-sdk";',
    'const sdk = await import(`${prefix}/core`);',
    'sdk.createLogger();',
    'const other = require("openclaw/" + "plugin-sdk/example");',
    'other.helper();',
  ].join("\n"));
  assert.equal(report.sdkUsage.status, "complete");
  assert.deepEqual(report.sdkUsage.unknowns, []);
  const keys = report.sdkUsage.entries.map((entry) => entry.key);
  assert.ok(keys.includes("sdk-export:openclaw/plugin-sdk/core#createLogger"));
  assert.ok(keys.includes("sdk-export:openclaw/plugin-sdk/example#helper"));
});

test("serialized inventory associates target retirement records without changing author findings", async (t) => {
  const report = await inspectPublishedJson(t, `
import { retired as alias, supported } from "openclaw/plugin-sdk/example";
import type { RetiredOptions } from "openclaw/plugin-sdk/example";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
export default { register(api: OpenClawPluginApi) {
  alias(); supported(); api.runtime.state.retired();
} };
`, {
    authorFacing: true,
    targetOpenClaw: { available: false, compatDeprecations: [
      { code: "retired-export", status: "deprecated", surfaces: ["openclaw/plugin-sdk/example.retired"], replacement: "Use supported", removeAfter: "2026-12-31" },
      { code: "retired-type", status: "deprecated", surfaces: ["RetiredOptions"], replacement: "Use current options" },
      { code: "retired-runtime", status: "deprecated", surfaces: ["api.runtime.state.retired"], replacement: "Use current state" },
      { code: "active-export", status: "active", surfaces: ["openclaw/plugin-sdk/example.supported"] },
      { code: "conditional", status: "deprecated", surfaces: ["openclaw/plugin-sdk/example.supported (writable handles)"] },
    ] },
  });
  assert.deepEqual(report.sdkUsage.entries.filter(entry => entry.deprecationCodes.includes("sdk-deprecated-api")).map(entry => entry.key), [
    "runtime-member:runtime.state.retired",
    "sdk-export:openclaw/plugin-sdk/example#RetiredOptions",
    "sdk-export:openclaw/plugin-sdk/example#retired",
  ]);
  const warnings = report.warnings.filter(item => item.code === "sdk-deprecated-api");
  assert.equal(warnings.length, 2, "type-only references annotate inventory without adding author warnings");
  assert.ok(warnings.some(item => item.deprecatedApi === "openclaw/plugin-sdk/example.retired" && item.removeAfter === "2026-12-31"));
});
