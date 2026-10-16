import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function inspect(t, helper, invoke, argument) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-call-expression-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "call-expression", version: "1.0.0", type: "module", openclaw: { extensions: ["./index.ts"] } }));
  await writeFile(path.join(root, "index.ts"), `${helper}\nexport default { async register(api) { ${invoke(argument)} } };`);
  const run = await pluginRoot.runCheck({ pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false, capture: false, allowExecution: false });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8")).sdkUsage;
}
const helper = "function use(value) { value.registerTool({}); }";
const arrow = "value => value.registerTool({})";
for (const [name, source, invoke] of [
  ["assignment result", "let use;", (arg) => `(use = ${arrow})(${arg});`],
  ["logical assignment result", "let use = () => {};", (arg) => `(use &&= ${arrow})(${arg});`],
  ["initialized or assignment", `let use = ${arrow};`, (arg) => `(use ||= (() => {}))(${arg});`],
  ["initialized nullish assignment", `let use = ${arrow};`, (arg) => `(use ??= (() => {}))(${arg});`],
  ["comma result", helper, (arg) => `(0, use)(${arg});`],
  ["nested assignment comma", `let alias; ${helper}`, (arg) => `(0, alias = use)(${arg});`],
  ["logical and result", helper, (arg) => `(true && use)(${arg});`],
  ["array assignment result", "let use;", (arg) => `([use] = [${arrow}])[0](${arg});`],
  ["constant array index", `const handlers = [${arrow}]; const index = 0;`, (arg) => `handlers[index](${arg});`],
  ["constant object key", `const handlers = {use: ${arrow}}; const key = 'use';`, (arg) => `handlers[key](${arg});`],
  ["parenthesized index", `const handlers = [${arrow}];`, (arg) => `handlers[(0)](${arg});`],
  ["negative zero index", `const handlers = [${arrow}];`, (arg) => `handlers[-0](${arg});`],
  ["tagged template factory", `function factory() { return ${arrow}; }`, (arg) => `factory\`tag\`(${arg});`],
  ["native Promise.resolve", helper, (arg) => `(await Promise.resolve(use))(${arg});`],
  ["native bind without bound arguments", helper, (arg) => `use.bind(null)(${arg});`],
  ["defaulted callable parameter", `function invoke(value, fn = use) { fn(value); } ${helper}`, (arg) => `invoke(${arg});`],
  ["defaulted callable with explicit undefined", `function invoke(value, fn = use) { fn(value); } ${helper}`, (arg) => `invoke(${arg}, undefined);`],
  ["defaulted callable with void", `function invoke(value, fn = use) { fn(value); } ${helper}`, (arg) => `invoke(${arg}, void 0);`],
  ["defaulted callable through invocation alias", `function invoke(value, fn = use) { fn(value); } const alias = invoke; ${helper}`, (arg) => `alias(${arg});`],
  ["nested defaults before their callers", `function inner(value, fn = use) { fn(value); } function outer(value, fn = inner) { fn(value); } ${helper}`, (arg) => `outer(${arg});`],
  ["nested defaults after their callers", `function outer(value, fn = inner) { fn(value); } function inner(value, fn = use) { fn(value); } ${helper}`, (arg) => `outer(${arg});`],
]) {
  test(`serialized inventory follows ${name}`, async (t) => {
    const sdk = await inspect(t, source, invoke, "api");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);
    const unrelated = await inspect(t, source, invoke, "{}");
    assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}
for (const [name, source, invoke] of [
  ["shadowed Promise.resolve", `const Promise = { resolve(value) { return () => {}; } }; ${helper}`, (arg) => `(await Promise.resolve(use))(${arg});`],
  ["overridden bind", `const use = { bind() { return () => {}; }, other: ${arrow} };`, (arg) => `use.bind(null)(${arg});`],
  ["bound unrelated argument", helper, (arg) => `use.bind(null, {})(${arg});`],
  ["defaulted callable overridden", `function invoke(value, fn = use) { fn(value); } ${helper}`, (arg) => `invoke(${arg}, () => {});`],
  ["defaulted callable alias overridden", `function invoke(value, fn = use) { fn(value); } const alias = invoke; ${helper}`, (arg) => `alias(${arg}, () => {});`],
  ["shadowed undefined argument", `function invoke(value, fn = use) { fn(value); } function caller(value, undefined) { invoke(value, undefined); } ${helper}`, (arg) => `caller(${arg}, () => {});`],
  ["short-circuited or", helper, (arg) => `(true || use)(${arg});`],
  ["short-circuited nullish", helper, (arg) => `({} ?? use)(${arg});`],
  ["short-circuited or assignment", `let fn = () => {}; ${helper}`, (arg) => `(fn ||= use)(${arg});`],
  ["short-circuited nullish assignment", `let fn = () => {}; ${helper}`, (arg) => `(fn ??= use)(${arg});`],
  ["short-circuited and", helper, (arg) => `(false && use)(${arg});`],
  ["undefined and", helper, (arg) => `(undefined && use)(${arg});`],
  ["void and", helper, (arg) => `(void 0 && use)(${arg});`],
  ["overwritten Promise.resolve", `${helper} Promise.resolve = function() { return Promise.reject(); };`, (arg) => `(await Promise.resolve(use))(${arg});`],
  ["overwritten native bind", `${helper} use.bind = () => () => {};`, (arg) => `use.bind(null)(${arg});`],
  ["later call after short-circuited or assignment", `let fn = () => {}; ${helper} fn ||= use;`, (arg) => `fn(${arg});`],
  ["later call after short-circuited nullish assignment", `let fn = () => {}; ${helper} fn ??= use;`, (arg) => `fn(${arg});`],
  ["discarded comma left side", helper, (arg) => `(use, () => {})(${arg});`],
  ["arithmetic coercion", helper, (arg) => `(+use)(${arg});`],
]) {
  test(`serialized inventory excludes ${name}`, async (t) => {
    const sdk = await inspect(t, source, invoke, "api");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}

test("an unresolved default-parameter override remains explicitly partial", async (t) => {
  const source = `import unknown from 'external-helper'; function invoke(value, fn = use) { fn(value); } ${helper}`;
  const sdk = await inspect(t, source, (arg) => `invoke(${arg}, unknown);`, "api");
  assert.equal(sdk.status, "partial");
  assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
  assert.ok(sdk.unknowns.some(({ expression, reason }) => expression === "fn(value)" && reason === "SDK handle escapes into an unresolved external call"));
});

test("a mixed known and unresolved default override preserves uncertainty", async (t) => {
  const source = `import unknown from 'external-helper'; function invoke(value, fn = use) { fn(value); } ${helper}`;
  const sdk = await inspect(t, source, (arg) => `invoke(${arg}, condition ? use : unknown);`, "api");
  assert.equal(sdk.status, "partial");
  assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);
  assert.ok(sdk.unknowns.some(({ expression, reason }) => expression === "fn(value)" && reason === "SDK handle escapes into an unresolved external call"));
});

for (const [name, calls] of [
  ["override before default", "invoke(api, () => {}); invoke({});"],
  ["override after default", "invoke({}); invoke(api, () => {});"],
  ["real SDK default beside an unrelated override", "invoke({}, () => {}); invoke(api);"],
]) {
  test(`mixed default caller choices stay unresolved: ${name}`, async (t) => {
    const source = `function invoke(value, fn = use) { fn(value); } ${helper}`;
    const sdk = await inspect(t, source, () => calls, "api");
    assert.equal(sdk.status, "partial");
    // Target/argument correlation across different callers is not inferred.
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
    assert.ok(sdk.unknowns.some(({ expression, reason }) => expression === "fn(value)" && reason === "SDK handle escapes into an unresolved external call"));
  });
}

for (const source of [
  `function inner(value, fn = use) { fn(value); } function forward(value, fn = inner) { fn(value, () => {}); } ${helper}`,
  `function forward(value, fn = inner) { fn(value, () => {}); } function inner(value, fn = use) { fn(value); } ${helper}`,
]) {
  test("later mixed callers remove stale default target argument edges", async (t) => {
    const sdk = await inspect(t, source, () => "inner({}); forward(api);", "api");
    assert.equal(sdk.status, "partial");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
    assert.ok(sdk.unknowns.some(({ expression }) => expression === "fn(value)"));
  });
}
