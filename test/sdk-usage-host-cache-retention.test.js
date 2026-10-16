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


test("shared host syntax isolates plugin augmentations and releases checker state", () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
    import path from 'node:path';
    import os from 'node:os';
    import { createUsageProgram } from ${JSON.stringify(new URL("../src/sdk-usage/program.js", import.meta.url).href)};
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sdk-host-isolation-'));
    try {
      const target = path.join(directory, 'host');
      await mkdir(path.join(target, 'src/plugin-sdk'), { recursive: true });
      await writeFile(path.join(target, 'package.json'), '{}');
      await writeFile(path.join(target, 'src/plugin-sdk/example.ts'),
        'export interface OpenClawPluginApi { registerTool(): void }\n' +
        'export function install(options: { bootstrap(api: OpenClawPluginApi): void }): void {}');
      const cache = { sources: new Map() };
      const references = [];
      function inspect(name, augment, inputs) {
        const text = 'import { install } from "openclaw/plugin-sdk/example";\n' +
          (augment ? 'declare module "openclaw/plugin-sdk/example" { interface OpenClawPluginApi { firstOnly(): void } }\n' : '') +
          'install({ bootstrap(api) { api.registerTool(); } });';
        const context = createUsageProgram([{ path: path.join(directory, name + '.ts'), text }], target, inputs);
        const parameter = context.sources[0].statements.at(-1).expression.arguments[0].properties[0].parameters[0];
        const type = context.checker.getTypeAtLocation(parameter);
        if (augment) references.push(new WeakRef(context.program), new WeakRef(context.checker), new WeakRef(context.sources[0]), new WeakRef(type), new WeakRef(context.program.getSourceFile(path.join(target, 'src/plugin-sdk/example.ts'))));
        return context.checker.getPropertiesOfType(type).map(symbol => symbol.name).sort();
      }
      assert.deepEqual(inspect('first', true, cache), ['firstOnly', 'registerTool']);
      const shared = inspect('second', false, cache);
      assert.deepEqual(shared, inspect('second', false, { sources: new Map() }));
      assert.deepEqual(shared, ['registerTool']);
      for (let pass = 0; pass < 10; pass++) { await new Promise(setImmediate); global.gc(); }
      assert.deepEqual(references.map(reference => Boolean(reference.deref())), [false, false, false, false, false]);
      assert.ok(cache.sources.size > 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  `;
  const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
