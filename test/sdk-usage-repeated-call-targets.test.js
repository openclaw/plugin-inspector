import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

test("repeated calls through unchanged aliases do not exhaust SDK analysis", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-repeated-call-targets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "repeated-calls", version: "1.0.0", openclaw: { extensions: ["./index.ts"] } }));
  let source = "function leaf() {}\nconst alias0 = leaf;\n";
  for (let index = 1; index < 300; index++) source += `const alias${index} = alias${index - 1};\n`;
  source += "alias299();\n".repeat(4000);
  source += "export default { register(api) { api.registerTool({}); } };";
  await writeFile(path.join(root, "index.ts"), source);
  const run = await pluginRoot.runCheck({ pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false, capture: false, allowExecution: false });
  const { sdkUsage } = JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
  assert.equal(sdkUsage.status, "complete");
  assert.deepEqual(sdkUsage.unknowns, []);
  assert.ok(sdkUsage.entries.some(({ key }) => key === "api-member:api.registerTool"));
});
