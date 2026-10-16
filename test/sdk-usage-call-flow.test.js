import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function apiMembers(t, code, extension = "js") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-call-flow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  const entry = `index.${extension}`;
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "call-flow", version: "1.0.0", type: "module", openclaw: { extensions: [`./${entry}`] },
  }));
  await writeFile(path.join(root, entry), code);
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false,
    capture: false, allowExecution: false,
  });
  const report = JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
  assert.equal(report.sdkUsage.status, "complete");
  return report.sdkUsage.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key);
}

const invoke = "export default { register(api) { use(api); } };";
for (const [name, helper, extension = "js"] of [
  ["explicit TypeScript callable annotation", "const use: (x: unknown) => void = x => { x.registerTool({}); };", "ts"],
  ["JSDoc variable callable annotation", "/** @type {(x: unknown) => void} */\nconst use = x => { x.registerTool({}); };"],
  ["JSDoc function callable annotation", "/** @type {(x: unknown) => void} */\nfunction use(x) { x.registerTool({}); }"],
  ["JSDoc function overloads", `/** @overload\n * @param {string} x\n * @returns {void}\n */
/** @overload\n * @param {object} x\n * @returns {void}\n */
/** @param {unknown} x */
function use(x) { x.registerTool({}); }`],
]) {
  test(`call-flow indexing follows implementation behind ${name}`, async (t) => {
    assert.deepEqual(await apiMembers(t, `${helper}\n${invoke}`, extension), ["api-member:api.registerTool"]);
    assert.deepEqual(await apiMembers(t, `${helper}\nexport default { register(api) { use({}); } };`, extension), []);
  });
}

test("call-flow indexing follows the JSDoc-overloaded constructor implementation", async (t) => {
  assert.deepEqual(await apiMembers(t, `class Use {
/** @overload\n * @param {string} x\n */
/** @overload\n * @param {object} x\n */
/** @param {unknown} x */
constructor(x) { x.registerTool({}); }
}
export default { register(api) { new Use(api); } };`), ["api-member:api.registerTool"]);
});

test("implementation-owned untyped helpers retain API argument flow", async (t) => {
  assert.deepEqual(await apiMembers(t, `const use = x => { x.registerTool({}); }; ${invoke}`), ["api-member:api.registerTool"]);
});

for (const helper of ["function id(x) { return x; }", "const id = x => x;"]) {
  test(`nested invocations of the same helper retain SDK identity: ${helper}`, async (t) => {
    assert.deepEqual(await apiMembers(t, `${helper} export default { register(api) { id(id(api)).registerTool({}); } };`), ["api-member:api.registerTool"]);
  });
}

test("correlated computed methods preserve every caller and exclude unrelated pairs", async (t) => {
  assert.deepEqual(await apiMembers(t, `function use(value, key) { value[key]({}); }
function call(value, key) { use(value, key); }
export default { register(api) { call(api, "registerTool"); call({}, "fake"); call(api, "registerService"); } };`), ["api-member:api.registerService", "api-member:api.registerTool"]);
});


test("shared alternative graphs preserve inventory within a bounded subprocess", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-shared-alternatives-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({
    name: "shared-alternatives", version: "1.0.0", openclaw: { extensions: ["./index.js"] },
  }));
  let code = "export default { register(api) { const left0 = { description: 'left' }; const right0 = { description: 'right' };\n";
  for (let index = 1; index <= 35; index++) {
    code += `const left${index} = left${index - 1} ?? right${index - 1}; const right${index} = left${index - 1} ?? right${index - 1};\n`;
  }
  code += "const mixed = api ?? left35; mixed.registerTool({}); left35.innerType; } };";
  await writeFile(path.join(directory, "index.js"), code);
  const script = `import {pluginRoot} from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};
    import {readFile} from 'node:fs/promises';
    const result = await pluginRoot.runCheck({pluginRoot:process.argv[1], outDir:process.argv[2], openclawPath:false, capture:false, allowExecution:false});
    console.log(await readFile(result.paths.jsonPath, 'utf8'));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, directory, path.join(directory, "report")], { encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sdkUsage.status, "complete");
  assert.deepEqual(report.sdkUsage.entries.filter(({ kind }) => kind === "api-member").map(({ key }) => key), ["api-member:api.registerTool"]);
});


test("nested array alternatives retain SDK bases without inventing builtin length members", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-nested-array-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "nested-array", version: "1.0.0", openclaw: { extensions: ["./index.js"] } }));
  await writeFile(path.join(directory, "index.js"), "export default { register(api) { const inner = flag ? api.runtime.channel : api.runtime.media; const mixed = other ? [] : inner; mixed.length; } };");
  const result = await pluginRoot.runCheck({ pluginRoot: directory, outDir: path.join(directory, "report"), openclawPath: false, capture: false, allowExecution: false });
  const report = JSON.parse(await readFile(result.paths.jsonPath, "utf8"));
  const members = report.sdkUsage.entries.filter(({ kind }) => kind === "runtime-member").map(({ key }) => key);
  assert.deepEqual(members, ["runtime-member:runtime.channel", "runtime-member:runtime.media"]);
});
