import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createMockSdkPackage } from "@openclaw/plugin-inspector/advanced";

test("SDK singleton factories share capture-local slots across barrels without changing globals", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-sdk-singleton-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pluginRoot = path.join(root, "plugin");
  await mkdir(pluginRoot);
  await writeFile(path.join(pluginRoot, "index.mjs"), `
import { resolveGlobalSingleton, resolveGlobalMap, drainGlobalSingletonLifecycleState, createPluginRuntimeStore } from "openclaw/plugin-sdk";
import { resolveGlobalSingleton as singleton } from "openclaw/plugin-sdk/global-singleton";
import { resolveGlobalSingleton as shared } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { createPluginRuntimeStore as runtime } from "openclaw/plugin-sdk/runtime-store";
`);
  const packages = await Promise.all(["first", "second"].map((name) =>
    createMockSdkPackage(path.join(root, name), { pluginRoot })));
  const load = (pkg, file) => import(pathToFileURL(path.join(pkg.pluginSdkDir, file)));
  const [sdk, subpath, sibling, isolated] = await Promise.all([
    load(packages[0], "index.js"), load(packages[0], "global-singleton.js"),
    load(packages[0], "memory-core-host-engine-foundation.js"), load(packages[1], "index.js"),
  ]);
  assert.equal(sdk.resolveGlobalSingleton, subpath.resolveGlobalSingleton);
  assert.equal(sdk.resolveGlobalSingleton, sibling.resolveGlobalSingleton);
  assert.equal(sdk.default.resolveGlobalSingleton, sdk.resolveGlobalSingleton);
  const key = Symbol("capture-owned");
  let calls = 0;
  const factory = () => { calls += 1; return { tail: Promise.resolve(), values: new Map() }; };
  const value = sdk.resolveGlobalSingleton(key, factory);
  assert.equal(subpath.resolveGlobalSingleton(key, factory), value);
  assert.equal(calls, 1);
  assert.equal(typeof value.tail.then, "function");
  assert.ok(value.values instanceof Map);
  assert.equal(Object.hasOwn(globalThis, key), false);
  assert.notEqual(isolated.resolveGlobalSingleton(key, factory), value);
  assert.equal(calls, 2);

  const undefinedKey = Symbol("undefined-slot");
  let undefinedCalls = 0;
  assert.equal(sdk.resolveGlobalSingleton(undefinedKey, () => { undefinedCalls += 1; }), undefined);
  assert.equal(sdk.resolveGlobalSingleton(undefinedKey, () => { undefinedCalls += 1; }), undefined);
  assert.equal(undefinedCalls, 1);
  const prepopulatedKey = Symbol("foreign-slot");
  globalThis[prepopulatedKey] = undefined;
  t.after(() => { delete globalThis[prepopulatedKey]; delete globalThis[key]; });
  assert.equal(sdk.resolveGlobalSingleton(prepopulatedKey, () => assert.fail("factory called for own undefined")), undefined);
  assert.equal(Object.hasOwn(globalThis, prepopulatedKey), true);
  globalThis[key] = { foreign: true };
  assert.equal(sdk.resolveGlobalSingleton(key, factory), value);
  assert.deepEqual(globalThis[key], { foreign: true });
  const prepopulatedValueKey = Symbol("foreign-value");
  globalThis[prepopulatedValueKey] = value;
  t.after(() => { delete globalThis[prepopulatedValueKey]; });
  assert.equal(sdk.resolveGlobalSingleton(prepopulatedValueKey, () => assert.fail("factory called for existing value")), value);

  const throwingKey = Symbol("factory-error");
  assert.throws(() => sdk.resolveGlobalSingleton(throwingKey, () => { throw new Error("factory failed"); }), /factory failed/);
  assert.equal(sdk.resolveGlobalSingleton(throwingKey, () => 7), 7);
  const mapKey = Symbol("map");
  const map = sdk.resolveGlobalMap(mapKey);
  map.set("entry", 3);
  assert.equal(subpath.resolveGlobalSingleton(mapKey, () => assert.fail("duplicate factory")), map);
  assert.equal(sdk.resolveGlobalMap(mapKey).get("entry"), 3);
  let resets = 0;
  const withReset = sdk.resolveGlobalSingleton(Symbol(), () => ({ value: 1 }), () => { resets += 1; });
  assert.equal(withReset.value, 1);
  assert.ok(sdk.resolveGlobalMap(Symbol(), "close-only") instanceof Map);
  await assert.rejects(sdk.drainGlobalSingletonLifecycleState(), /does not execute global singleton lifecycle resets/);
  assert.equal(resets, 0);

  const runtime = await load(packages[0], "runtime-store.js");
  const named = sdk.createPluginRuntimeStore({ pluginId: " fixture ", errorMessage: "runtime not initialized" });
  const alias = runtime.createPluginRuntimeStore({ key: "plugin-runtime:fixture", errorMessage: "alias not initialized" });
  assert.equal(named.tryGetRuntime(), null);
  assert.throws(() => named.getRuntime(), { message: "runtime not initialized" });
  assert.throws(() => alias.getRuntime(), { message: "alias not initialized" });
  const supplied = { value: 1 };
  named.setRuntime(supplied);
  assert.equal(alias.getRuntime(), supplied);
  for (const value of [false, 0, ""]) {
    alias.setRuntime(value);
    assert.equal(named.getRuntime(), value);
  }
  named.clearRuntime();
  assert.equal(alias.tryGetRuntime(), null);
  assert.throws(() => alias.getRuntime(), { message: "alias not initialized" });
  const firstLocal = sdk.createPluginRuntimeStore("same message");
  const secondLocal = sdk.createPluginRuntimeStore("same message");
  firstLocal.setRuntime(supplied);
  assert.equal(secondLocal.tryGetRuntime(), null);
  assert.equal(isolated.createPluginRuntimeStore({ pluginId: "fixture", errorMessage: "isolated" }).tryGetRuntime(), null);
  named.setRuntime(undefined);
  assert.throws(() => named.getRuntime(), /runtime not initialized/);
  assert.throws(() => sdk.createPluginRuntimeStore({ pluginId: "  ", errorMessage: "unused" }), /pluginId must not be empty/);
});
