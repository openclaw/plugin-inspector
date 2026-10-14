import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { captureEntrypoint } from "@openclaw/plugin-inspector/advanced";
import { collectRuntimeModuleImports } from "../src/runtime-imports.js";
import { createMockSdkPackage } from "../src/sdk-mock.js";

test("static namespace members follow their binding, closures and erased types", () => {
  const source = [
    'import * as sdk from "openclaw/plugin-sdk/namespace-proof";',
    'import type * as typeOnly from "openclaw/plugin-sdk/type-only";',
    'type T = typeof sdk.typeOnlyMember;',
    'const read = () => sdk.readStringField({}, "value");',
    '{ const sdk = { shadowed() {} }; sdk.shadowed(); }',
    'function unrelated(sdk) { return sdk.unrelated(); }',
    'sdk.isRecord({});',
  ].join("\n");
  assert.deepEqual(collectRuntimeModuleImports(source, { includeStaticNamespaces: true })
    .map(({ specifier, kind, names }) => [specifier, kind, [...names]]), [
    ["openclaw/plugin-sdk/namespace-proof", "namespace", ["readStringField", "isRecord"]],
  ]);
  assert.deepEqual(collectRuntimeModuleImports(source), []);
});

test("namespace-only SDK consumers execute with generated member exports", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-namespace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entrypoint = path.join(root, "index.mjs");
  await writeFile(entrypoint, [
    'import * as sdk from "openclaw/plugin-sdk/namespace-proof";',
    'export const read = value => sdk.readStringField({ value }, "value");',
    'if (!sdk.isRecord({}) || sdk.isRecord([])) throw new Error("record contract");',
    'function unrelated(sdk) { return sdk.shadowed(); }',
  ].join("\n"));
  const { pluginSdkDir } = await createMockSdkPackage(root, { pluginRoot: root });
  assert.doesNotMatch(await readFile(path.join(pluginSdkDir, "namespace-proof.js"), "utf8"), /export const shadowed\b/);
  const { read } = await import(pathToFileURL(entrypoint).href);
  assert.equal(read("namespace"), "namespace");
});

test("compiled doctor namespace descriptors capture without claiming migration execution", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-doctor-namespace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.mjs"), [
    'import * as imported from "openclaw/plugin-sdk/runtime-doctor-migrations";',
    'const doctor = {};',
    'for (const key of Object.getOwnPropertyNames(imported)) {',
    '  if (key !== "default") Object.defineProperty(doctor, key, { get: () => imported[key], enumerable: true });',
    '}',
    'const aliases = doctor.defineChannelAliasMigration({ channelId: "fixture", streaming: { defaultMode: "partial" } });',
    'const moves = doctor.defineKeyMoveMigration({ from: ["old"], to: ["new"] });',
    'const stray = doctor.defineStrayPluginEntryConfigMigration({ pluginId: "fixture", channelId: "fixture" });',
    'const webhook = doctor.createLegacyWebhookListenerDoctorContract({ channelKey: "fixture" });',
    'const rules = [...aliases.legacyConfigRules, ...webhook.legacyConfigRules, stray.legacyConfigRule];',
    'if (!rules.every(rule => typeof rule.match === "function") || typeof moves.normalize !== "function") throw new Error("descriptor shape");',
    'export default { register(api) { api.registerService({ id: "doctor-descriptors", start() {} }); } };',
  ].join("\n"));
  const captured = await captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
  assert.equal(captured.status, "captured");
  assert.ok(captured.captured.some((item) => item.name === "registerService"));

  const { pluginSdkDir } = await createMockSdkPackage(root, { pluginRoot: root });
  const doctor = await import(pathToFileURL(path.join(pluginSdkDir, "runtime-doctor-migrations.js")).href);
  assert.equal(doctor.asObjectRecord(null), null);
  assert.equal(doctor.asObjectRecord([]), null);
  const value = {};
  assert.equal(doctor.asObjectRecord(value), value);
  const aliases = doctor.defineChannelAliasMigration({ channelId: "fixture" });
  const moves = doctor.defineKeyMoveMigration({ from: ["old"], to: ["new"] });
  assert.ok(Array.isArray(aliases.legacyConfigRules));
  for (const call of [
    () => aliases.normalizeChannelConfig({ cfg: {} }),
    () => aliases.hasLegacyAliases({}),
    () => moves.normalize({ entry: {} }),
    () => moves.hasLegacy({}),
    () => doctor.normalizeChannelConfigEntries({ cfg: {} }),
    () => doctor.hasLegacyAccountStreamingAliases({}),
  ]) assert.throws(call, /SDK mock does not execute doctor migrations/);
});
