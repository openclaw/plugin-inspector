import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("a reusable host cache does not retain a completed plugin program", () => {
  const script = `
    import { createUsageProgram } from ${JSON.stringify(new URL("../src/sdk-usage/program.js", import.meta.url).href)};
    const cache = { sources: new Map() };
    let reference;
    function inspect() {
      const context = createUsageProgram([{ path: '/plugin/index.ts', text: 'export const value = 1;', metadata: false }], undefined, cache);
      reference = new WeakRef(context.program);
    }
    inspect();
    // Advance jobs so WeakRef's same-job protection does not retain the target.
    for (let pass = 0; pass < 8; pass++) { await new Promise(setImmediate); global.gc(); }
    console.log(JSON.stringify({ retained: Boolean(reference.deref()), inputs: cache.sources.size }));
  `;
  const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.ok(state.inputs > 0, "the host inputs remain reusable");
  assert.equal(state.retained, false, "the completed plugin's program and checker must be collectible");
});
