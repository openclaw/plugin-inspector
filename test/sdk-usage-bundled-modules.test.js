import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

test("serialized artifact inventories retain each physical copy of a bundled package", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-usage-bundled-modules-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  async function write(name, text) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  await write("package.json", JSON.stringify({
    name: "bundled-plugin", version: "1.0.0", type: "module",
    openclaw: { extensions: ["./index.ts"] },
  }));
  await write("index.ts", 'import "left"; import "right";\n');
  for (const name of ["left", "right"]) {
    const parent = `node_modules/${name}`;
    await write(`${parent}/package.json`, JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" }));
    await write(`${parent}/index.d.ts`, 'export { Config } from "shared";\n');
    const bundled = `${parent}/node_modules/shared`;
    await write(`${bundled}/package.json`, JSON.stringify({ name: "shared", version: "1.0.0", types: "index.d.ts" }));
    await write(`${bundled}/index.d.ts`, `
import type { SharedOptions, ${name}Options } from "openclaw/plugin-sdk/example";
export interface Config {
  headers: Record<string, string>;
  shared: SharedOptions;
  selected: ${name}Options;
}
`);
  }
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "reports"), openclawPath: false,
    sdkUsageInputKind: "artifact", capture: false, allowExecution: false,
  });
  const report = JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
  assert.equal(report.sdkUsage.status, "complete");
  assert.equal(report.sdkUsage.inputKind, "artifact");
  assert.deepEqual(report.sdkUsage.unknowns, []);
  const shared = report.sdkUsage.entries.find((entry) => entry.key === "sdk-export:openclaw/plugin-sdk/example#SharedOptions");
  assert.deepEqual([...new Set(shared.evidence.map((site) => site.path))].sort(), [
    "node_modules/left/node_modules/shared/index.d.ts",
    "node_modules/right/node_modules/shared/index.d.ts",
  ]);
  for (const name of ["left", "right"]) {
    const entry = report.sdkUsage.entries.find((item) => item.key === `sdk-export:openclaw/plugin-sdk/example#${name}Options`);
    assert.equal(entry.classification, "type");
    assert.ok(entry.evidence.every((site) => site.path === `node_modules/${name}/node_modules/shared/index.d.ts`));
  }
});
