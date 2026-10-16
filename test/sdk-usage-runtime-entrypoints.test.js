import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

async function reportFor(t, openclaw, files, inputKind = "artifact") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-runtime-entry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "runtime-entry", version: "1.0.0", type: "module", openclaw }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false,
    sdkUsageInputKind: inputKind, capture: false, allowExecution: false,
  });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8")).sdkUsage;
}

test("published runtime entrypoints establish API ownership when source entries are absent", async (t) => {
  const usage = await reportFor(t, { extensions: ["./src/index.ts"], runtimeExtensions: ["./dist/index.js"] }, {
    "dist/index.js": "export default function register(api) { api.registerTool({}); }",
  });
  assert.equal(usage.status, "complete");
  assert.deepEqual(usage.unknowns, []);
  const entry = usage.entries.find(({ key }) => key === "api-member:api.registerTool");
  assert.ok(entry);
  assert.equal(entry.classification, "runtime");
  assert.equal(entry.evidence[0].path, "dist/index.js");
});

test("source inspection uses source entrypoints even when built peers are declared", async (t) => {
  const usage = await reportFor(t, { extensions: ["./src/index.ts"], runtimeExtensions: ["./dist/index.js"] }, {
    "src/index.ts": "export default function register(api) { api.registerService({}); }",
    "dist/index.js": "export default function register(api) { api.registerTool({}); }",
  }, "source");
  assert.equal(usage.status, "complete");
  assert.ok(usage.entries.some(({ key }) => key === "api-member:api.registerService"));
  assert.ok(!usage.entries.some(({ key }) => key === "api-member:api.registerTool"));
});

test("missing declared runtime entrypoints remain unresolved instead of falling back to source", async (t) => {
  const usage = await reportFor(t, { extensions: ["./src/index.ts"], runtimeExtensions: ["./dist/missing.js"] }, {
    "src/index.ts": "export default function register(api) { api.registerTool({}); }",
  });
  assert.equal(usage.status, "partial");
  assert.ok(usage.unknowns.some(({ reason }) => reason.includes("./dist/missing.js")));
  assert.ok(!usage.entries.some(({ key }) => key === "api-member:api.registerTool"));
});

test("runtime-only published package metadata retains named register exports", async (t) => {
  const usage = await reportFor(t, { runtimeExtensions: ["./dist/index.js"] }, {
    "dist/index.js": "export function register(api) { api.runtime.agent.session.updateSessionStore('store', () => {}); }",
  });
  assert.ok(usage.entries.some(({ key }) => key === "runtime-member:runtime.agent.session.updateSessionStore"));
});

for (const runtimeExtensions of ["./dist/index.js", []]) {
  test(`invalid runtime entrypoint metadata does not claim complete zero usage: ${JSON.stringify(runtimeExtensions)}`, async (t) => {
    const usage = await reportFor(t, { extensions: ["./src/index.ts"], runtimeExtensions }, {
      "src/index.ts": "export default function register(api) { api.registerTool({}); }",
    });
    assert.equal(usage.status, "partial");
    assert.ok(usage.unknowns.some(({ path }) => path === "package.json"));
    assert.ok(!usage.entries.some(({ key }) => key === "api-member:api.registerTool"));
  });
}
