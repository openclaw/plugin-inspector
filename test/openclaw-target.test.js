import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  openClawTargetPathCandidates,
  parseCompatRecordEntries,
  parsePluginSdkExports,
  parseTypeFields,
  readOpenClawTargetSurface,
} from "../src/advanced.js";

test("OpenClaw target parser reads public target surface facts", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-openclaw-target-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const targetRoot = path.join(rootDir, "openclaw");
  await mkdir(path.join(targetRoot, "src/plugins/compat"), { recursive: true });
  await writeFile(
    path.join(targetRoot, "src/plugins/compat/registry.ts"),
    `export const records = [
      { code: "sdk.import.root-barrel-cold-import", status: "deprecated" },
      { code: "hook.before_tool_call.terminal-block-approval", status: "supported" },
    ];\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/hook-types.ts"),
    `export const PLUGIN_HOOK_NAMES = ["before_tool_call", "llm_input"] as const;\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/api-builder.ts"),
    `api.registerTool(tool); api.registerService(service); api.registerTool(other);\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/captured-registration.ts"),
    `export function createApi() {
      return {
        registerTool(tool) {},
        registerService(service) {},
      };
    }\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/manifest.ts"),
    `export type PluginManifest = {
  id: string;
  PluginManifestCompat?: never;
  contracts?: PluginManifestContracts;
};
export type PluginManifestContracts = {
  tools?: unknown;
  channels?: unknown;
};\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "package.json"),
    JSON.stringify({
      exports: {
        "./plugin-sdk": "./dist/plugin-sdk.js",
        "./plugin-sdk/channels": "./dist/channels.js",
        ".": "./dist/index.js",
      },
    }),
    "utf8",
  );

  const target = await readOpenClawTargetSurface({
    rootDir,
    manifest: { openclaw: { defaultCheckoutPath: "./openclaw" } },
  });

  assert.equal(target.status, "ok");
  assert.equal(target.configuredPath, "./openclaw");
  assert.deepEqual(target.compatRecords, [
    "hook.before_tool_call.terminal-block-approval",
    "sdk.import.root-barrel-cold-import",
  ]);
  assert.deepEqual(target.compatRecordStatuses, {
    "hook.before_tool_call.terminal-block-approval": "supported",
    "sdk.import.root-barrel-cold-import": "deprecated",
  });
  assert.deepEqual(target.hookNames, ["before_tool_call", "llm_input"]);
  assert.deepEqual(target.apiRegistrars, ["registerService", "registerTool"]);
  assert.deepEqual(target.capturedRegistrars, ["registerService", "registerTool"]);
  assert.deepEqual(target.sdkExports, ["openclaw/plugin-sdk", "openclaw/plugin-sdk/channels"]);
  assert.deepEqual(target.manifestFields, ["contracts", "id"]);
  assert.deepEqual(target.manifestContractFields, ["channels", "tools"]);
  assert.equal(target.compatRegistryPath, "openclaw/src/plugins/compat/registry.ts");
});

test("OpenClaw target parser reports disabled and missing targets", async () => {
  assert.equal((await readOpenClawTargetSurface({ configuredPath: false })).status, "disabled");

  const missing = await readOpenClawTargetSurface({
    rootDir: "/tmp",
    configuredPath: "./missing-openclaw",
  });
  assert.equal(missing.status, "missing");
  assert.deepEqual(missing.searchedPaths, ["./missing-openclaw"]);
});

test("OpenClaw target parsing helpers stay deterministic", () => {
  assert.deepEqual(openClawTargetPathCandidates({ openclaw: { defaultCheckoutPath: "../target" } }), [
    "../target",
    "./openclaw",
    "../openclaw",
  ]);
  assert.deepEqual(parsePluginSdkExports({ exports: { "./plugin-sdk": "", "./plugin-sdk/tools": "", ".": "" } }), [
    "openclaw/plugin-sdk",
    "openclaw/plugin-sdk/tools",
  ]);
  assert.deepEqual(
    parseCompatRecordEntries(`
      { code: "b", status: "supported" }
      { code: "a", status: "deprecated" }
      { code: "b", status: "supported" }
    `).map((entry) => entry.code),
    ["a", "b"],
  );
  assert.deepEqual(parseTypeFields("export type PluginManifest = {\n  id?: string;\n};", "PluginManifest"), ["id"]);
});
