import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function inspect(t, files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-work-bound-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "work-bound", version: "1.0.0", openclaw: { extensions: ["./z-index.ts"] } }));
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text);
  const run = await pluginRoot.runCheck({ pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false, capture: false, allowExecution: false });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
}

function expensiveCallGraph() {
  let code = "function read(value, key) { return value[key]; }\nfunction level0(value, key) { return read(value, key); }\n";
  for (let level = 1; level <= 20; level++) code += `function level${level}(value, key) { return level${level - 1}(value, key) ?? level${level - 1}(value, key); }\n`;
  return `${code}level20({}, 'left'); level20({}, 'right'); export {};`;
}

test("a hostile argument graph becomes partial while later direct SDK usage survives", async (t) => {
  const report = await inspect(t, {
    "a-hostile.js": expensiveCallGraph(),
    "z-index.ts": `import { definePlugin } from 'openclaw/plugin-sdk/static';
import equals = require('openclaw/plugin-sdk/equals');
const required = require('openclaw/plugin-sdk/required');
const dynamic = await import('openclaw/plugin-sdk/dynamic');
function shadow(require) { require('openclaw/plugin-sdk/shadowed'); }
export default { register(api) {
  api.registerTool({}); api.runtime.media.load(); definePlugin({});
  equals.member(); required.member(); dynamic.member();
} };`,
  });
  const usage = report.sdkUsage;
  assert.equal(usage.status, "partial");
  const limits = usage.unknowns.filter(({ reason }) => reason.includes("per-plugin limit"));
  assert.equal(limits.length, 1);
  assert.equal(limits[0].path, "a-hostile.js");
  assert.ok(limits[0].expression.length < 200);
  const keys = new Set(usage.entries.map(({ key }) => key));
  for (const name of ["static", "equals", "required", "dynamic"]) assert.ok(keys.has(`sdk-module:openclaw/plugin-sdk/${name}`), name);
  assert.ok(keys.has("api-member:api.registerTool"));
  assert.ok(keys.has("runtime-member:runtime.media.load"));
  assert.ok(!keys.has("sdk-module:openclaw/plugin-sdk/shadowed"));
  assert.ok(!usage.unknowns.some(({ reason }) => reason === "SDK module import is not statically resolvable"));
  assert.equal(usage.coverage.filesAnalyzed, 3);

  const next = await inspect(t, { "z-index.ts": "export default { register(api) { api.registerService({}); } };" });
  assert.equal(next.sdkUsage.status, "complete");
  assert.deepEqual(next.sdkUsage.unknowns, []);
  assert.ok(next.sdkUsage.entries.some(({ key }) => key === "api-member:api.registerService"));
});
