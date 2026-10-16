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
  ["parenthesized function", "function use(value) { value.registerTool({}); }", (argument) => `(use)(${argument});`],
  ["immediately invoked arrow", "", (argument) => `((value) => { value.registerTool({}); })(${argument});`],
  ["immediately invoked function", "", (argument) => `(function (value) { value.registerTool({}); })(${argument});`],
  ["object property arrow", "const helpers = { use: (value) => { value.registerTool({}); } };", (argument) => `helpers.use(${argument});`],
  ["shorthand method alias", "function use(value) { value.registerTool({}); } const helpers = { use };", (argument) => `helpers.use(${argument});`],
  ["destructured method", "const helpers = { use(value) { value.registerTool({}); } }; const { use } = helpers;", (argument) => `use(${argument});`],
  ["function returned by a factory", "function factory() { return (value) => { value.registerTool({}); }; }", (argument) => `factory()(${argument});`],
  ["inherited constructor", "class Base { constructor(value) { value.registerTool({}); } } class Child extends Base {}", (argument) => `new Child(${argument});`],
];

for (const [name, helper, invoke] of cases) {
  test(`serialized inventory follows the executed ${name}`, async (t) => {
    const sdk = await inspectCall(t, helper, invoke, "api");
    assert.equal(sdk.status, "complete");
    assert.deepEqual(sdk.unknowns, []);
    assert.deepEqual(sdk.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);
    assert.ok(sdk.entries.find(({ key }) => key === "api-member:api.registerTool").evidence.every(({ path }) => path === "index.ts"));

    const unrelated = await inspectCall(t, helper, invoke, "{}");
    assert.equal(unrelated.status, "complete");
    assert.deepEqual(unrelated.unknowns, []);
    assert.deepEqual(unrelated.entries.filter(({ kind }) => kind === "api-member"), []);
  });
}
