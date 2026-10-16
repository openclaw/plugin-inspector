import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function inspectCall(t, helper, invoke, argument) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-call-target-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "call-target", version: "1.0.0", type: "module", openclaw: { extensions: ["./index.ts"] },
  }));
  await writeFile(path.join(root, "index.ts"), `${helper}\nexport default { register(api) { ${invoke(argument)} } };`);
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false,
    capture: false, allowExecution: false,
  });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8")).sdkUsage;
}

const cases = [
  ["local function alias", "function use(value) { value.registerTool({}); } const alias = use;", (argument) => `alias(${argument});`],
  ["chained function aliases", "function use(value) { value.registerTool({}); } const first = use; const second = first;", (argument) => `second(${argument});`],
  ["nullish callable alias", "function use(value) { value.registerTool({}); } const alias = use ?? (() => {});", (argument) => `alias(${argument});`],
  ["logical callable alias", "function use(value) { value.registerTool({}); } const alias = use || (() => {});", (argument) => `alias(${argument});`],
  ["parenthesized function", "function use(value) { value.registerTool({}); }", (argument) => `(use)(${argument});`],
  ["immediately invoked arrow", "", (argument) => `((value) => { value.registerTool({}); })(${argument});`],
  ["immediately invoked function", "", (argument) => `(function (value) { value.registerTool({}); })(${argument});`],
  ["object property arrow", "const helpers = { use: (value) => { value.registerTool({}); } };", (argument) => `helpers.use(${argument});`],
  ["numeric array element", "const helpers = [(value) => { value.registerTool({}); }];", (argument) => `helpers[0](${argument});`],
  ["numeric object property", "const helpers = { 0: (value) => { value.registerTool({}); } };", (argument) => `helpers[0](${argument});`],
  ["quoted numeric array element", "const helpers = [(value) => { value.registerTool({}); }];", (argument) => `helpers["0"](${argument});`],
  ["empty array spread", "const helpers = [...[], value => value.registerTool({})];", (argument) => `helpers[0](${argument});`, true],
  ["nonempty array spread", "const helpers = [...[() => {}], value => value.registerTool({})];", (argument) => `helpers[1](${argument});`],
  ["helper within array spread", "const helpers = [...[value => value.registerTool({})], () => {}];", (argument) => `helpers[0](${argument});`, true],
  ["nested aliased array spread", "const inner = [() => {}, value => value.registerTool({})]; const outer = [...inner]; const helpers = [...[], ...outer];", (argument) => `helpers[1](${argument});`, true],
  ["object getter returning a function", "const helpers = { get use() { return (value) => { value.registerTool({}); }; } };", (argument) => `helpers.use(${argument});`, true],
  ["class getter returning a function", "class Helpers { get use() { return (value) => { value.registerTool({}); }; } } const helpers = new Helpers();", (argument) => `helpers.use(${argument});`, true],
  ["static class getter returning a function", "class Helpers { static get use() { return (value) => { value.registerTool({}); }; } }", (argument) => `Helpers.use(${argument});`, true],
  ["getter returning a function alias", "function use(value) { value.registerTool({}); } const helpers = { get use() { return use; } }; const { use: alias } = helpers;", (argument) => `alias(${argument});`, true],
  ["getter paired with a setter", "const helpers = { get use() { return (value) => { value.registerTool({}); }; }, set use(value) { value.registerService({}); } };", (argument) => `helpers.use(${argument});`, true],
  ["class getter paired with a setter", "class Helpers { get use() { return (value) => { value.registerTool({}); }; } set use(value) { value.registerService({}); } } const helpers = new Helpers();", (argument) => `helpers.use(${argument});`, true],
  ["shorthand method alias", "function use(value) { value.registerTool({}); } const helpers = { use };", (argument) => `helpers.use(${argument});`],
  ["destructured method", "const helpers = { use(value) { value.registerTool({}); } }; const { use } = helpers;", (argument) => `use(${argument});`],
  ["nested destructured method", "const helpers = { nested: { use(value) { value.registerTool({}); } } }; const { nested: { use } } = helpers;", (argument) => `use(${argument});`],
  ["function returned by a factory", "function factory() { return (value) => { value.registerTool({}); }; }", (argument) => `factory()(${argument});`],
  ["defaulted factory parameter", "function use(value) { value.registerTool({}); } function factory(fn = use) { return fn; }", (argument) => `factory()(${argument});`],
  ["assigned function variable", "let use; use = (value) => { value.registerTool({}); };", (argument) => `use(${argument});`],
  ["inherited constructor", "class Base { constructor(value) { value.registerTool({}); } } class Child extends Base {}", (argument) => `new Child(${argument});`],
];

for (const [name, helper, invoke, valueUnknown = false] of cases) {
  test(`serialized inventory follows the executed ${name}`, async (t) => {
    const sdk = await inspectCall(t, helper, invoke, "api");
    // Callable indexing is precise; getter/spread value provenance stays conservative.
    assert.equal(sdk.status, valueUnknown ? "partial" : "complete");
    assert.deepEqual(sdk.unknowns, valueUnknown ? [{
      path: "index.ts", line: 2, expression: invoke("api").replace(/;$/, ""),
      reason: "SDK handle escapes into an unresolved external call",
    }] : []);
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);
    assert.ok(sdk.entries.find(({ key }) => key === "api-member:api.registerTool").evidence.every(({ path }) => path === "index.ts"));

    const unrelated = await inspectCall(t, helper, invoke, "{}");
    assert.equal(unrelated.status, "complete");
    assert.deepEqual(unrelated.unknowns, []);
    assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}

test("noncanonical array property strings do not select numeric elements", async (t) => {
  for (const key of ["01", "1e0", ""]) {
    const sdk = await inspectCall(t,
      "const helpers = [value => value.registerTool({}), value => value.registerTool({})];",
      (argument) => `helpers[${JSON.stringify(key)}](${argument});`, "api");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), [], key);
  }
});

test("array spreads retain both statically possible callable positions", async (t) => {
  const helper = "const prefix = flag ? [] : [value => value.registerService({})]; const helpers = [...prefix, value => value.registerTool({})];";
  const invoke = (argument) => `helpers[0](${argument});`;
  const sdk = await inspectCall(t, helper, invoke, "api");
  assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerService", "api-member:api.registerTool"]);
  const unrelated = await inspectCall(t, helper, invoke, "{}");
  assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
});

for (const [name, helper, key] of [
  ["shifted array element", "const helpers = [...[() => {}, () => {}], value => value.registerTool({})];", 1],
  ["array hole", "const helpers = [...[,], value => value.registerTool({})];", 0],
  ["recursive array spread", "let helpers; helpers = [...helpers, value => value.registerTool({})];", 1],
]) {
  test(`array lookup does not invent a callable for ${name}`, async (t) => {
    const sdk = await inspectCall(t, helper, (argument) => `helpers[${key}](${argument});`, "api");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}

for (const invoke of [(argument) => `helpers[1](${argument});`, (argument) => `alias(${argument});`]) {
  test("an unresolved spread length reports uncertain SDK argument flow through aliases", async (t) => {
    const helper = "import prefix from 'unknown'; const helpers = [...prefix, value => value.registerTool({})]; const alias = helpers[1];";
    const sdk = await inspectCall(t, helper, invoke, "api");
    assert.equal(sdk.status, "partial");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
    assert.deepEqual(sdk.unknowns, [{ path: "index.ts", line: 2, expression: invoke("api").replace(/;$/, ""), reason: "SDK handle escapes into an unresolved external call" }]);
    const unrelated = await inspectCall(t, helper, invoke, "{}");
    assert.equal(unrelated.status, "complete");
    assert.deepEqual(unrelated.unknowns, []);
    assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}

for (const [name, helper] of [
  ["object setter", "const helpers = { set use(value) { value.registerTool({}); } };"],
  ["class setter", "class Helpers { set use(value) { value.registerTool({}); } } const helpers = new Helpers();"],
  ["shadowed getter", "const original = { get use() { return value => value.registerTool({}); } }; const helpers = { ...original, use(value) {} };"],
  ["getter replaced by a setter", "const helpers = { get use() { return value => value.registerTool({}); }, use(value) { value.registerService({}); }, set use(value) { value.registerProvider({}); } };"],
  ["getter replaced through a spread and setter", "const helpers = { get use() { return value => value.registerTool({}); }, ...{ use(value) { value.registerService({}); } }, set use(value) { value.registerProvider({}); } };"],
  ["recursive getter", "const helpers = { get use() { return helpers.use; } };"],
]) {
  test(`serialized inventory does not call a ${name}`, async (t) => {
    const sdk = await inspectCall(t, helper, (argument) => `helpers.use(${argument});`, "api");
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}

test("an overriding external spread does not execute the earlier local method", async (t) => {
  const helper = `import external from "external-helper";
function use(value) { value.registerTool({}); }
const helpers = { use, ...{ use: external } };`;
  const invoke = (argument) => `helpers.use(${argument});`;
  const sdk = await inspectCall(t, helper, invoke, "api");
  assert.equal(sdk.status, "partial");
  assert.ok(sdk.unknowns.some(({ reason }) => reason === "SDK handle escapes into an unresolved external call"));
  assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member"), []);

  const unrelated = await inspectCall(t, helper, invoke, "{}");
  assert.equal(unrelated.status, "complete");
  assert.deepEqual(unrelated.unknowns, []);
  assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
});

test("cyclic callable aliases retain later executable alternatives", async (t) => {
  const helper = `function use(value) { value.registerTool({}); }
let first, second;
first = second || use;
second = first;`;
  const invoke = (argument) => `(first.notCallable ?? second)(${argument});`;
  const sdk = await inspectCall(t, helper, invoke, "api");
  assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);

  const unrelated = await inspectCall(t, helper, invoke, "{}");
  assert.equal(unrelated.status, "complete");
  assert.deepEqual(unrelated.unknowns, []);
  assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
});
