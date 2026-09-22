import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMockSdkPackage, runEntrypointSyntheticProbes } from "@openclaw/plugin-inspector/advanced";

for (const extension of ["mjs", "cjs"]) {
  test(`packaged .setup ${extension} modules retain SDK imports through execution`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inspector-setup-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, ".setup"), { recursive: true });
    const commonJs = extension === "cjs";
    await writeFile(path.join(dist, `index.${extension}`), commonJs
      ? 'module.exports = require("./.setup/runtime.cjs");\n'
      : 'export { default } from "./.setup/runtime.mjs";\n');
    await writeFile(path.join(dist, ".setup", `runtime.${extension}`), [
      commonJs
        ? 'const { setupHelper } = require("openclaw/plugin-sdk/setup-fixture");'
        : 'import { setupHelper } from "openclaw/plugin-sdk/setup-fixture";',
      `${commonJs ? "module.exports =" : "export default"} { register(api) {`,
      '  if (typeof setupHelper !== "function") throw new Error("setup SDK export missing");',
      '  api.registerTool({ name: "setup_tool", async run() {',
      '    const { retainedHelper } = await import("openclaw/plugin-sdk/setup-retained-fixture");',
      '    if (typeof retainedHelper !== "function") throw new Error("retained SDK export missing");',
      '    return "setup-handler-executed";',
      '  } });',
      '} };',
    ].join("\n"));
    const invoke = () => runEntrypointSyntheticProbes(`index.${extension}`, {
      cwd: dist, pluginRoot: dist, mockSdk: true,
    });
    if (commonJs && typeof nodeModule.registerHooks !== "function") {
      await assert.rejects(invoke(), /CommonJS SDK mocking requires Node\.js 22\.15/);
      return;
    }
    const result = await invoke();
    assert.equal(result.summary.failCount, 0, JSON.stringify(result));
    const tool = result.results.find((item) => item.label === "registerTool.run");
    assert.equal(tool?.status, "pass", JSON.stringify(result));
    assert.match(JSON.stringify(tool.output), /setup-handler-executed/);
  });
}

test("SDK discovery keeps unrelated hidden directories excluded", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-hidden-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "plugin", ".private"), { recursive: true });
  await writeFile(path.join(root, "plugin", ".private", "ignored.mjs"),
    'import { privateHelper } from "openclaw/plugin-sdk/private-fixture";\n');
  const mock = await createMockSdkPackage(path.join(root, "mock"), { pluginRoot: path.join(root, "plugin") });
  await assert.rejects(stat(path.join(mock.pluginSdkDir, "private-fixture.js")), { code: "ENOENT" });
});
