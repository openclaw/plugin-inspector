import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { collectRuntimeModuleImports } from "../src/runtime-imports.js";
import { createMockSdkPackage } from "../src/sdk-mock.js";

test("Node createRequire handles retain literal SDK calls and original source positions", () => {
  for (const [declaration, factory] of [
    ['import { createRequire as make } from "node:module";', "make"],
    ['import { createRequire as make } from "module";', "make"],
  ]) {
    const source = [declaration,
      `const load = ${factory}(import.meta.url);`,
      'const regex = /load("fake")/; const text = `load("openclaw/plugin-sdk/template-only")`; const quoted = \'load("openclaw/plugin-sdk/string-only")\';',
      '// load("openclaw/plugin-sdk/comment-only");',
      'const sdk = load("openclaw/plugin-sdk/alias-only");',
      'const read = () => sdk.readStringField({}, "value");',
      'const { isRecord: record } = load(`openclaw/plugin-sdk/destructured`);',
      'const direct = load("openclaw/plugin-sdk/direct").asOptionalRecord;',
      'function shadow(load) { return load("openclaw/plugin-sdk/ignored"); }',
      '{ const load = () => ({}); load("openclaw/plugin-sdk/block"); }',
      'try {} catch (load) { load("openclaw/plugin-sdk/catch"); }',
      'function factoryShadow(make, moduleApi) { const other = make(import.meta.url); other("openclaw/plugin-sdk/factory-shadow"); const next = moduleApi.createRequire(import.meta.url); next("openclaw/plugin-sdk/module-shadow"); }',
    ].join("\n");
    const imports = collectRuntimeModuleImports(source);
    assert.deepEqual(imports.map(({ specifier, kind, names }) => [specifier, kind, [...names]]), [
      ["openclaw/plugin-sdk/alias-only", "require", ["readStringField"]],
      ["openclaw/plugin-sdk/destructured", "require", ["isRecord"]],
      ["openclaw/plugin-sdk/direct", "require", ["asOptionalRecord"]],
    ], declaration);
    for (const entry of imports) assert.equal(source.slice(entry.specifierStart, entry.specifierStart + entry.specifier.length), entry.specifier);
  }
  const typed = 'import { createRequire as make } from "node:module"; const load: NodeRequire = make(import.meta.url); type Only = ReturnType<typeof load>; const sdk: object = load("openclaw/plugin-sdk/typed-alias"); sdk.isRecord({});';
  assert.deepEqual(collectRuntimeModuleImports(typed).map(({ specifier, names }) => [specifier, [...names]]),
    [["openclaw/plugin-sdk/typed-alias", ["isRecord"]]]);
  const nested = 'import { createRequire as make } from "node:module"; function initialize() { const require = make(import.meta.url); const { isRecord } = require("openclaw/plugin-sdk/nested"); return () => require("openclaw/plugin-sdk/retained").readStringField({}, "value"); }';
  assert.deepEqual(collectRuntimeModuleImports(nested).map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/nested", ["isRecord"]], ["openclaw/plugin-sdk/retained", ["readStringField"]],
  ]);
});

test("destructuring defaults retain nested SDK calls and their actual source offsets", () => {
  const source = [
    'import { createRequire as make } from "node:module";',
    'const load = make(import.meta.url);',
    'const { nativeSdk =',
    '  require("openclaw/plugin-sdk/native-default").isRecord } = getOptions("plugin");',
    'const { dynamicSdk = await import("openclaw/plugin-sdk/dynamic-default") } = getOptions("plugin");',
    'const { aliasSdk = load("openclaw/plugin-sdk/alias-default").readStringField } = getOptions("plugin");',
  ].join("\n");
  const imports = collectRuntimeModuleImports(source);
  assert.deepEqual(imports.map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/native-default", ["isRecord"]],
    ["openclaw/plugin-sdk/dynamic-default", []],
    ["openclaw/plugin-sdk/alias-default", ["readStringField"]],
  ]);
  for (const [index, callee] of ["require", "import", "load"].entries()) {
    const entry = imports[index];
    assert.equal(entry.index, source.indexOf(`${callee}("${entry.specifier}"`));
    assert.equal(source.slice(entry.specifierStart, entry.specifierStart + entry.specifier.length), entry.specifier);
  }
});

test("createRequire discovery excludes unproven factories, writes and nonliteral calls", () => {
  for (const source of [
    'import { createRequire as make } from "other-module"; const load = make(import.meta.url); load("openclaw/plugin-sdk/no");',
    'function make(base) { return () => ({}); } const load = make(import.meta.url); load("openclaw/plugin-sdk/no");',
    'import { createRequire as make } from "node:module"; let load = make(import.meta.url); load = other; load("openclaw/plugin-sdk/no");',
    'import { createRequire as make } from "node:module"; var load = make(import.meta.url); var load = other; load("openclaw/plugin-sdk/no");',
    'import { createRequire as make } from "node:module"; let require = make(import.meta.url); require = other; require("openclaw/plugin-sdk/no");',
    'import { createRequire as make } from "node:module"; const require = make(import.meta.url); function shadow(require) { require("openclaw/plugin-sdk/no"); }',
    'function shadow(require) { require("openclaw/plugin-sdk/no"); }',
    'import { createRequire as make } from "node:module"; const alias = make; const load = alias(import.meta.url); load("openclaw/plugin-sdk/no");',
    'import { createRequire as make } from "node:module"; const load = make(import.meta.url); load("openclaw/plugin-sdk/" + name); load(`openclaw/plugin-sdk/${name}`); receiver.load("openclaw/plugin-sdk/no");',
    'import type { createRequire as make } from "node:module"; const load = make(import.meta.url); load("openclaw/plugin-sdk/no");',
    // Mutable module-object factories remain outside the supported static contract.
    'import * as moduleApi from "node:module"; const load = moduleApi.createRequire(import.meta.url); load("openclaw/plugin-sdk/no");',
    'import moduleApi from "module"; const load = moduleApi.createRequire(import.meta.url); load("openclaw/plugin-sdk/no");',
  ]) assert.deepEqual(collectRuntimeModuleImports(source), [], source);
  const incomplete = 'import { createRequire as make } from "node:module"; const load = make(import.meta.url); load("openclaw/plugin-sdk/alias"); require("openclaw/plugin-sdk/retained"); const invalid =';
  assert.deepEqual(collectRuntimeModuleImports(incomplete).map(({ specifier, names }) => [specifier, [...names]]),
    [["openclaw/plugin-sdk/retained", []]]);
});

test("runtime import names follow declarations through closures and exclude shadowed receivers", () => {
  const source = [
    'async function handler() { const sdk = await import("openclaw/plugin-sdk/outer");',
    '  const read = () => sdk.readStringField({ value: "x" }, "value");',
    '  { const sdk = { then() {} }; sdk.then(); }',
    '  try {} catch (sdk) { sdk.then(); }',
    '  return read();',
    '}',
    'function unrelated(sdk) { return sdk.then(); }',
    'const arrow = sdk => sdk.then();',
    'function required() { var sdk = require("openclaw/plugin-sdk/required"); return () => sdk.isRecord({}); }',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source).map(({ specifier, kind, names }) => [specifier, kind, [...names]]), [
    ["openclaw/plugin-sdk/outer", "import", ["readStringField"]],
    ["openclaw/plugin-sdk/required", "require", ["isRecord"]],
  ]);
});

test("runtime import names use erased TypeScript and distinguish optional promise and module members", () => {
  const source = [
    'const sdk: typeof import("openclaw/plugin-sdk/typed") = await import("openclaw/plugin-sdk/typed");',
    'type T = typeof sdk.then; sdk.readStringField({ value: "x" }, "value");',
    'const result = await import("openclaw/plugin-sdk/promise")?.then(() => ({ then: "resolved" })); result.then;',
    'const direct = (await import("openclaw/plugin-sdk/direct"))?.asOptionalRecord;',
    'const required: object = require("openclaw/plugin-sdk/required"); type R = typeof required.then; required.isRecord({});',
  ].join("\n");
  const imports = collectRuntimeModuleImports(source);
  assert.deepEqual(imports.map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/typed", ["readStringField"]],
    ["openclaw/plugin-sdk/promise", []],
    ["openclaw/plugin-sdk/direct", ["asOptionalRecord"]],
    ["openclaw/plugin-sdk/required", ["isRecord"]],
  ]);
  assert.equal(imports[0].index, source.indexOf('import("openclaw/plugin-sdk/typed")', source.indexOf("await")));
});

test("runtime import analysis retains imports without guessing names when parsing fails", () => {
  const source = [
    'const sdk = await import("openclaw/plugin-sdk/retained");',
    'const sdk = 0; sdk.then;',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source).map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/retained", []],
  ]);
  const incomplete = 'type Only = import("openclaw/plugin-sdk/uncertain").Only; const value =';
  assert.deepEqual(collectRuntimeModuleImports(incomplete).map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/uncertain", []],
  ]);
});

test("runtime AST excludes regex calls without losing imports after quoted regexes", () => {
  const source = [
    `const quote = /["']/;`,
    'const fake = /require("demo")/;',
    'const sdk = await import("openclaw/plugin-sdk/after-regex"); sdk.readStringField({}, "value");',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source).map(({ specifier, names, index }) => [specifier, [...names], index]), [
    ["openclaw/plugin-sdk/after-regex", ["readStringField"], source.indexOf("import(")],
  ]);
});

test("runtime imports retain literal arguments with options, trailing commas, and comments", () => {
  const source = [
    'const options = await import("openclaw/plugin-sdk/options", {}); options.readStringField({}, "value");',
    'const { isRecord } = await import("openclaw/plugin-sdk/comma",);',
    'const direct = (await import("openclaw/plugin-sdk/comment" /* trailing comment */)).asOptionalRecord;',
    'const computed = name => import("openclaw/plugin-sdk/" + name);',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source).map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/options", ["readStringField"]],
    ["openclaw/plugin-sdk/comma", ["isRecord"]],
    ["openclaw/plugin-sdk/comment", ["asOptionalRecord"]],
  ]);
});

test("inline fulfillment callbacks expose their own SDK bindings without promise or rejection members", () => {
  const source = [
    'import("openclaw/plugin-sdk/destructured").then(({ readStringField: read }) => read({}, "value"));',
    'import("openclaw/plugin-sdk/namespace")?.then(function (sdk, other) {',
    '  const read = () => sdk.isRecord({});',
    '  { const sdk = { then() {} }; sdk.then(); }',
    '  other.then(); return read;',
    '}, error => error.then());',
    'import("openclaw/plugin-sdk/catch").catch(sdk => sdk.then());',
    'import("openclaw/plugin-sdk/finally").finally(sdk => sdk.then());',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source).map(({ specifier, names }) => [specifier, [...names]]), [
    ["openclaw/plugin-sdk/destructured", ["readStringField"]],
    ["openclaw/plugin-sdk/namespace", ["isRecord"]],
    ["openclaw/plugin-sdk/catch", []],
    ["openclaw/plugin-sdk/finally", []],
  ]);
});

test("generated runtime modules settle and retained callbacks compute values and preserve rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-imports-"));
  try {
    const entrypoint = path.join(root, "index.mjs");
    await writeFile(entrypoint, [
      `const quote = /["']/;`,
      'const fake = /require("demo")/;',
      'export function register(save) {',
      '  let registered = false;',
      '  save(async (value, reject = false) => {',
      '    if (!registered) throw new Error("callback ran during registration");',
      '    const sdk = await import("openclaw/plugin-sdk/namespace-proof", {});',
      '    const { isRecord: record } = await import("openclaw/plugin-sdk/destructure-proof",);',
      '    const direct = (await import("openclaw/plugin-sdk/direct-proof" /* trailing comment */))?.asOptionalRecord;',
      '    const result = await import("openclaw/plugin-sdk/promise-proof")?.then(() => ({ then: "resolved" }));',
      '    const callbackValue = await import("openclaw/plugin-sdk/then-destructure").then(({ readStringField: read }) => read({ value }, "value"));',
      '    const callbackRecord = await import("openclaw/plugin-sdk/then-namespace")?.then(sdk => sdk.isRecord({}));',
      '    const read = () => sdk.readStringField({ value }, "value");',
      '    if (!record({}) || record([]) || direct([]) !== undefined || result.then !== "resolved" || callbackValue !== read() || !callbackRecord) throw new Error("helper mismatch");',
      '    if (reject) await import("openclaw/plugin-sdk/then-rejection").then(({ readStringField }) => Promise.reject(new Error(`fixture prerequisite: ${readStringField({ value }, "value")}`)));',
      '    return `${callbackValue}:checked`;',
      '  });',
      '  registered = true;',
      '}',
      'function unrelated(sdk) { return sdk.then(); }',
      'const arrow = sdk => sdk.then();',
      'const text = "sdk.then";',
    ].join("\n"));
    const { pluginSdkDir } = await createMockSdkPackage(root, { pluginRoot: root });
    for (const subpath of ["namespace-proof", "promise-proof", "then-destructure", "then-namespace", "then-rejection"]) {
      assert.doesNotMatch(await readFile(path.join(pluginSdkDir, `${subpath}.js`), "utf8"), /export const then\b/);
    }
    const { register } = await import(pathToFileURL(entrypoint).href);
    let callback;
    register((retained) => { callback = retained; });
    assert.equal(await callback("alpha"), "alpha:checked");
    assert.equal(await callback("beta"), "beta:checked");
    await assert.rejects(callback("missing", true), { message: "fixture prerequisite: missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
