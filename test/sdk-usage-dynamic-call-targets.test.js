import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRoot } from "../src/index.js";

const advertiser = `export function advertise(deps) {
  deps.logger.info("ready");
  deps.logger.warn("retry");
  deps.logger.debug("details");
}`;

async function inspectDynamicCall(t, setup, argument = "api.logger", implementation = advertiser) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sdk-dynamic-call-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "dynamic-call", version: "1.0.0", type: "module", openclaw: { extensions: ["./index.ts"] },
  }));
  await writeFile(path.join(root, "index.ts"), `export default { async register(api) {
    ${setup}
    advertise({ logger: ${argument} });
  } };`);
  await writeFile(path.join(root, "src/advertiser.ts"), implementation);
  await writeFile(path.join(root, "src/barrel.ts"), 'export { advertise } from "./advertiser.js";');
  await writeFile(path.join(directory, "outside.ts"), implementation);
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false,
    capture: false, allowExecution: false,
  });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8")).sdkUsage;
}

const loggerMethods = (sdk) => sdk.entries.filter(({ key }) => key.startsWith("api-member:api.logger."));

for (const [name, setup] of [
  ["awaited local import", 'const { advertise } = await import("./src/advertiser.js");'],
  ["nested Promise.all import destructuring", 'const [{ advertise }, sdk] = await Promise.all([import("./src/advertiser.js"), import("openclaw/plugin-sdk")]);'],
  ["dynamic module re-export", 'const [{ advertise }] = await Promise.all([import("./src/barrel.js")]);'],
]) {
  test(`serialized inventory follows ${name}`, async (t) => {
    const sdk = await inspectDynamicCall(t, setup);
    assert.equal(sdk.status, "complete");
    assert.deepEqual(sdk.unknowns, []);
    assert.deepEqual(loggerMethods(sdk).map(({ key }) => key), [
      "api-member:api.logger.debug", "api-member:api.logger.info", "api-member:api.logger.warn",
    ]);
    assert.ok(loggerMethods(sdk).every(({ evidence }) => evidence.every(({ path }) => path === "src/advertiser.ts")));

    const unrelated = await inspectDynamicCall(t, setup, "{ info() {}, warn() {}, debug() {} }");
    assert.deepEqual(loggerMethods(unrelated), []);
  });
}

test("a local Promise.all replacement does not select the imported implementation", async (t) => {
  const sdk = await inspectDynamicCall(t, `const Promise = { all(_values) { return [{ advertise() {} }]; } };
    const [{ advertise }] = await Promise.all([import("./src/advertiser.js")]);`);
  assert.deepEqual(loggerMethods(sdk), []);
});

test("dynamic call targets cannot import code outside the inspected plugin", async (t) => {
  const sdk = await inspectDynamicCall(t, 'const { advertise } = await import("../outside.js");');
  assert.deepEqual(loggerMethods(sdk), []);
  assert.ok(sdk.entries.every(({ evidence }) => evidence.every(({ path }) => !path.includes("outside"))));
});

test("a dynamically imported helper's SDK function annotation does not replace its actual argument", async (t) => {
  const implementation = `import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
    export function advertise(deps: { logger: OpenClawPluginApi["runtime"]["nodes"]["invoke"] }) {
      deps.logger({});
    }`;
  const setup = 'const service = { invokeNode() {} }; const { advertise } = await import("./src/advertiser.js");';
  const unrelated = await inspectDynamicCall(t, setup, "service.invokeNode", implementation);
  const entry = unrelated.entries.find(({ key }) => key === "runtime-member:runtime.nodes.invoke");
  assert.equal(entry?.classification, "type");
  assert.deepEqual(entry?.referenceKinds, ["type-reference"]);

  const sdk = await inspectDynamicCall(t, setup, "api.runtime.nodes.invoke", implementation);
  const used = sdk.entries.find(({ key }) => key === "runtime-member:runtime.nodes.invoke");
  assert.equal(used?.classification, "mixed");
  assert.ok(used?.referenceKinds.includes("call"));
});
