import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureEntrypoint, runEntrypointSyntheticProbes } from "@openclaw/plugin-inspector/advanced";

test("child capture and retained callbacks read the explicit config without masking rejections", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-config-registration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.mjs"), `
export default { register(api) {
  if (api.runtime.config.current() !== api.config) throw new Error("split config snapshots");
  if (api.config.channels?.fixture?.label !== "fixture-config") throw new Error("missing explicit config");
  api.registerGatewayMethod("fixture.status", ({ respond }) => {
    const channel = api.runtime.config.current().channels?.fixture;
    if (channel?.label !== "fixture-config") throw new Error("lost retained config");
    const configured = channel.enabled === true;
    respond(true, { configured });
  });
  api.registerGatewayMethod("fixture.send", ({ respond }) => {
    if (!api.runtime.config.current().channels?.fixture?.enabled) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "fixture channel not configured" });
      return;
    }
    throw new Error("fixture must not execute configured sends");
  });
} };
`);
  const config = { channels: { fixture: { enabled: false, label: "fixture-config" } } };
  const options = { cwd: root, pluginRoot: root, mockSdk: true, apiOptions: { config } };
  const capture = await captureEntrypoint("index.mjs", options);
  assert.equal(capture.status, "captured");
  assert.equal(capture.captured.length, 2);
  const probes = await runEntrypointSyntheticProbes("index.mjs", options);
  assert.equal(probes.summary.passCount, 1);
  assert.equal(probes.summary.failCount, 1);
  assert.equal(probes.results[0].status, "pass");
  assert.equal(probes.results[1].status, "fail");
  assert.match(probes.results[1].error, /fixture channel not configured/);
});

test("registration descriptors do not turn unsupported state or lifecycle execution into success", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-context-registration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.mjs"), `
import { definePluginEntry } from "openclaw/plugin-sdk";
export default definePluginEntry({ register(api) {
  const open = api.runtime.state.openKeyedStore.bind(api.runtime.state);
  const store = open({ namespace: "registration", maxEntries: 8 });
  if (!store.observe || !store.compareAndApply) throw new Error("missing public comparison methods");
  if (api.lifecycle.signal || api.lifecycle.onDispose) throw new Error("invented host instance lifetime");
  api.lifecycle.registerRuntimeLifecycle({ stop() { throw new Error("metadata callback executed"); } });
  api.registerTool({ name: "state-read", run() { return store.lookup("key"); } });
} });
`);
  const options = { cwd: root, pluginRoot: root, mockSdk: true };
  const capture = await captureEntrypoint("index.mjs", options);
  assert.equal(capture.status, "captured");
  assert.deepEqual(capture.captured.map((entry) => entry.name), ["registerRuntimeLifecycle", "registerTool"]);
  const probes = await runEntrypointSyntheticProbes("index.mjs", options);
  const tool = probes.results.find((entry) => entry.label === "registerTool.run");
  assert.equal(tool.status, "fail");
  assert.match(tool.error, /Plugin state lookup is unavailable in capture mocks/);
  assert.equal(probes.summary.failCount, 1);
});

test("singleton factory state remains real through retained callbacks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-singleton-registration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.mjs"), `
import { resolveGlobalSingleton } from "openclaw/plugin-sdk/global-singleton";
import { resolveGlobalSingleton as shared } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const key = Symbol.for("plugin-inspector.test.factory-state");
const state = resolveGlobalSingleton(key, () => ({ tail: Promise.resolve(), values: new Map() }), () => { throw new Error("reset executed"); });
if (shared(key, () => { throw new Error("duplicate factory"); }) !== state) throw new Error("split state");
const runtime = createPluginRuntimeStore({ pluginId: "fixture", errorMessage: "runtime not initialized" });
export default { register(api) {
  api.registerTool({ name: "singleton-state", async run() {
    await state.tail.then(() => state.values.set("retained", 1));
    try { runtime.getRuntime(); throw new Error("missing runtime did not throw"); }
    catch (error) { if (error.message !== "runtime not initialized") throw error; }
    return state.values.get("retained");
  } });
} };
`);
  const probes = await runEntrypointSyntheticProbes("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
  assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
  const tool = probes.results.find((entry) => entry.label === "registerTool.run");
  assert.equal(tool.status, "pass");
  assert.deepEqual(tool.output, { type: "number", value: 1 });
});
