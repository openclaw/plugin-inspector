import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { fixtureSuites } from "../src/index.js";

test("fixture reports reuse host declarations without sharing plugin bindings or stale host state", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = path.join(directory, "host");
  const hostFile = path.join(targetRoot, "src/plugin-sdk/example.ts");
  const implementationFile = path.join(targetRoot, "src/implementation.ts");
  async function write(name, text) {
    await mkdir(path.dirname(name), { recursive: true });
    await writeFile(name, text);
  }
  const hostSource = `
import { implementation } from "../implementation.js";
export type OpenClawPluginApi = { registerTool(tool: unknown): void; registerService(service: unknown): void };
export function installWithHost(options: { bootstrap(api: OpenClawPluginApi): void }): unknown {
  return implementation(options);
}
`;
  await write(hostFile, hostSource);
  await write(implementationFile, "export function implementation(value: unknown): unknown { return value; }");
  await write(path.join(targetRoot, "package.json"), JSON.stringify({ name: "openclaw" }));
  const fixtures = [];
  for (const [id, method] of [["one", "registerTool"], ["two", "registerService"]]) {
    const pluginPath = `plugins/${id}`;
    fixtures.push({ id, name: id, path: pluginPath, seams: [] });
    await write(path.join(directory, pluginPath, "package.json"), JSON.stringify({ name: id, version: "1.0.0", type: "module" }));
    await write(path.join(directory, pluginPath, "index.ts"), `
import { installWithHost } from "openclaw/plugin-sdk/example";
installWithHost({ bootstrap(api) { api.${method}({}); } });
`);
  }
  const inspect = async (selected, label) => {
    const report = await fixtureSuites.inspect({
      config: { version: 1, submoduleRoot: "plugins", rootDir: directory, fixtures: selected },
      openclawPath: false, sdkUsageTargetPath: targetRoot, generatedAt: "test",
    });
    const jsonPath = path.join(directory, `${label}.json`);
    await fixtureSuites.writeReports(report, {
      cwd: directory, jsonPath,
      markdownPath: path.join(directory, `${label}.md`),
      issuesPath: path.join(directory, `${label}-issues.md`),
    });
    return JSON.parse(await readFile(jsonPath, "utf8"));
  };
  const originalRead = ts.sys.readFile;
  const reads = new Map();
  ts.sys.readFile = (file, ...args) => {
    const resolved = path.resolve(file);
    if (resolved.startsWith(targetRoot)) reads.set(resolved, (reads.get(resolved) ?? 0) + 1);
    return originalRead(file, ...args);
  };
  t.after(() => { ts.sys.readFile = originalRead; });
  const batch = await inspect(fixtures, "batch");
  assert.equal(reads.get(implementationFile) ?? 0, 0, "host implementation-only imports must not inflate the analysis graph");
  assert.equal(reads.get(hostFile), 1, "the immutable host is read once within a fixture batch");
  for (const [index, fixture] of fixtures.entries()) {
    const single = await inspect([fixture], fixture.id);
    assert.deepEqual(batch.fixtures[index].sdkUsage, single.fixtures[0].sdkUsage);
    const members = batch.fixtures[index].sdkUsage.entries.filter((entry) => entry.kind === "api-member");
    assert.deepEqual(members.map((entry) => entry.key), [index ? "api-member:api.registerService" : "api-member:api.registerTool"]);
  }
  await write(hostFile, hostSource.replaceAll("OpenClawPluginApi", "UnrelatedApi"));
  const changed = await inspect(fixtures, "changed-host");
  assert.ok(changed.fixtures.every((fixture) => fixture.sdkUsage.entries.every((entry) => entry.kind !== "api-member")), "a later batch must see the changed host contract");
});

test("host declarations that require inferred exported types retain their original source", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-inferred-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = path.join(directory, "host");
  const plugin = path.join(directory, "plugins/example");
  await mkdir(path.join(targetRoot, "src/plugin-sdk"), { recursive: true });
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(targetRoot, "src/plugin-sdk/example.ts"), `
export type OpenClawPluginApi = { registerTool(tool: unknown): void };
const install = (options: { bootstrap(api: OpenClawPluginApi): void }): unknown => options;
export const installWithHost = install;
`);
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ name: "example", version: "1.0.0" }));
  await writeFile(path.join(plugin, "index.ts"), `
import { installWithHost } from "openclaw/plugin-sdk/example";
installWithHost({ bootstrap(api) { api.registerTool({}); } });
`);
  const report = await fixtureSuites.inspect({
    config: { version: 1, submoduleRoot: "plugins", rootDir: directory, fixtures: [{ id: "example", path: "plugins/example" }] },
    openclawPath: false, sdkUsageTargetPath: targetRoot,
  });
  assert.ok(report.fixtures[0].sdkUsage.entries.some((entry) => entry.key === "api-member:api.registerTool"));
});

for (const prefix of ["", "/* license */ ", "/* license\n */ "]) {
test(`host reference directives retain SDK types after ${JSON.stringify(prefix)}`, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-reference-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const targetRoot = path.join(directory, "host");
  const sdkRoot = path.join(targetRoot, "src/plugin-sdk");
  const plugin = path.join(directory, "plugins/example");
  await mkdir(sdkRoot, { recursive: true });
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(sdkRoot, "example.ts"), `
${prefix}/// <reference path="./types.d.ts" />
export function installWithHost(options: { bootstrap(api: OpenClawPluginApi): void }): void {}
`);
  await writeFile(path.join(sdkRoot, "types.d.ts"), "interface OpenClawPluginApi { registerTool(tool: unknown): void; }");
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ name: "example", version: "1.0.0" }));
  await writeFile(path.join(plugin, "index.ts"), `
import { installWithHost } from "openclaw/plugin-sdk/example";
installWithHost({ bootstrap(api) { api.registerTool({}); } });
`);
  const report = await fixtureSuites.inspect({
    config: { version: 1, submoduleRoot: "plugins", rootDir: directory, fixtures: [{ id: "example", path: "plugins/example" }] },
    openclawPath: false, sdkUsageTargetPath: targetRoot,
  });
  assert.ok(report.fixtures[0].sdkUsage.entries.some((entry) => entry.key === "api-member:api.registerTool"));
});
}
