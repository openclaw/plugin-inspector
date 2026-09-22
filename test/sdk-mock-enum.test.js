import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureEntrypoint, runEntrypointSyntheticProbes } from "@openclaw/plugin-inspector/advanced";

for (const specifier of ["zod", "openclaw/plugin-sdk/zod"]) {
  test(`mock ${specifier} enums retain options used by composed plugin schemas`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-enum-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "index.mjs"), `
      import { z } from ${JSON.stringify(specifier)};
      import assert from "node:assert/strict";
      const reasons = z.enum(["ended", "failed"]);
      const combined = z.enum([...reasons.options, "cancelled"]);
      const objectEnum = z.enum({ Ready: "ready", Stopped: "stopped" });
      export default { register(api) {
        api.registerTool({ name: "enum_options", run() {
          assert.deepEqual(reasons.options, ["ended", "failed"]);
          assert.deepEqual(combined.options, ["ended", "failed", "cancelled"]);
          assert.deepEqual(objectEnum.options, ["ready", "stopped"]);
          return "enum-options-pass";
        } });
      } };
    `);
    const captured = await captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
    assert.equal(captured.status, "captured");
    assert.ok(captured.captured.some((row) => row.name === "registerTool"));
    const probes = await runEntrypointSyntheticProbes("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
    assert.equal(probes.summary.failCount, 0);
    const tool = probes.results.find((row) => row.label === "registerTool.run");
    assert.equal(tool?.status, "pass");
    assert.match(JSON.stringify(tool.output), /enum-options-pass/);
  });
}
