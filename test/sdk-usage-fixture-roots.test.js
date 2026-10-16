import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fixtureSuites, pluginRoot } from "../src/index.js";

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-fixture-roots-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugins/example");
  async function write(name, content) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  async function inspect(fixture = {}, options = {}) {
    const report = await fixtureSuites.inspect({
      config: { version: 1, submoduleRoot: "plugins", rootDir: directory, fixtures: [{ id: "example", name: "example", seams: [], path: "plugins/example", ...fixture }] },
      generatedAt: "test", openclawPath: false, ...options,
    });
    const jsonPath = path.join(directory, "report.json");
    await fixtureSuites.writeReports(report, { cwd: directory, jsonPath, markdownPath: path.join(directory, "report.md"), issuesPath: path.join(directory, "issues.md") });
    return JSON.parse(await readFile(jsonPath, "utf8"));
  }
  return { directory, root, write, inspect };
}

const registration = "export default { register(api) { api.registerTool({}); } };";
const manifest = { id: "example", contracts: { tools: ["example_tool"] }, configSchema: { type: "object" } };
const hasKey = (usage, key) => usage.entries.some((entry) => entry.key === key);

test("fixture inventories honor standalone nested plugin roots and exclude their repository parent", async (t) => {
  const { write, inspect } = await workspace(t);
  await write("package.json", { name: "repository" });
  await write("outer.ts", 'import { unrelated } from "openclaw/plugin-sdk/outside"; unrelated();');
  await write("nested/package.json", { name: "example", version: "1.0.0", openclaw: { extensions: ["./index.ts"] } });
  await write("nested/index.ts", registration);
  await write("nested/openclaw.plugin.json", manifest);
  const { sdkUsage } = (await inspect({ subdir: "nested" })).fixtures[0];
  assert.ok(hasKey(sdkUsage, "api-member:api.registerTool"));
  assert.ok(hasKey(sdkUsage, "manifest-contract:manifest.contracts.tools:example_tool"));
  assert.ok(sdkUsage.entries.every((entry) => !entry.key.includes("outside")));
  assert.deepEqual(sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool").evidence.map((site) => site.path), ["index.ts"]);
});

test("npm fixture inventories inspect compiled payloads, exclude shims, and preserve explicit input mode", async (t) => {
  const { write, inspect } = await workspace(t);
  await write("package.json", { name: "fixture-shim" });
  await write("shim.ts", 'import "openclaw/plugin-sdk/shim-only";');
  await write(".crabpot-package/package.json", { name: "example", version: "1.0.0", openclaw: { extensions: ["./dist/index.js"] } });
  await write(".crabpot-package/dist/index.js", registration);
  await write(".crabpot-package/openclaw.plugin.json", manifest);
  const fixture = { package: { name: "example", version: "1.0.0" } };
  const { sdkUsage } = (await inspect(fixture)).fixtures[0];
  assert.equal(sdkUsage.inputKind, "artifact");
  assert.ok(hasKey(sdkUsage, "api-member:api.registerTool"));
  assert.ok(sdkUsage.entries.every((entry) => !entry.key.includes("shim-only")));
  assert.deepEqual(sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool").evidence.map((site) => site.path), ["dist/index.js"]);
  const explicit = (await inspect(fixture, { sdkUsageInputKind: "source" })).fixtures[0].sdkUsage;
  assert.equal(explicit.inputKind, "source");
  assert.equal(hasKey(explicit, "api-member:api.registerTool"), false);
  assert.equal(explicit.status, "partial", "an explicitly excluded compiled entrypoint must remain unresolved");
});

test("suite source subdirectories retain root entrypoint and manifest metadata", async (t) => {
  const { write, inspect } = await workspace(t);
  await write("package.json", { name: "example", version: "1.0.0", openclaw: { extensions: ["./src/index.ts"] } });
  await write("openclaw.plugin.json", manifest);
  await write("src/index.ts", registration);
  const { sdkUsage } = (await inspect({ subdir: "src" })).fixtures[0];
  assert.ok(hasKey(sdkUsage, "api-member:api.registerTool"));
  assert.ok(hasKey(sdkUsage, "manifest-contract:manifest.contracts.tools:example_tool"));
  assert.deepEqual(sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool").evidence.map((site) => site.path), ["src/index.ts"]);
});

test("plugin-root sourceRoot configuration retains the author package root", async (t) => {
  const { directory, root, write } = await workspace(t);
  await write("package.json", { name: "example", version: "1.0.0", openclaw: { extensions: ["./src/index.ts"] }, pluginInspector: { version: 1, sourceRoot: "src" } });
  await write("openclaw.plugin.json", manifest);
  await write("src/package.json", { name: "internal-source" });
  await write("src/index.ts", registration);
  const run = await pluginRoot.runCheck({ pluginRoot: root, outDir: path.join(directory, "author-report"), openclawPath: false, capture: false, allowExecution: false });
  const { sdkUsage } = JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
  assert.ok(hasKey(sdkUsage, "api-member:api.registerTool"));
  assert.ok(hasKey(sdkUsage, "manifest-contract:manifest.contracts.tools:example_tool"));
  assert.deepEqual(sdkUsage.entries.find((entry) => entry.key === "api-member:api.registerTool").evidence.map((site) => site.path), ["src/index.ts"]);
});

test("missing npm payloads remain missing instead of an empty successful inventory", async (t) => {
  const { write, inspect } = await workspace(t);
  await write("package.json", { name: "fixture-shim" });
  const report = await inspect({ package: { name: "example", version: "1.0.0" } });
  assert.equal(report.fixtures[0].status, "missing");
  assert.equal(report.fixtures[0].sdkUsage, undefined);
});
