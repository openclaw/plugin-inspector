import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  classifyCompatRecordCoverage,
  openClawTargetPathCandidates,
  parseCompatRecordEntries,
  parsePluginSdkEntrypointSpecifiers,
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
    `const PLUGIN_HOOK_NAMES = ["before_tool_call", "llm_input"] as const satisfies readonly PluginHookName[];\n`,
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
  await mkdir(path.join(targetRoot, "src/plugin-sdk"), { recursive: true });
  await writeFile(
    path.join(targetRoot, "src/plugin-sdk/entrypoints.ts"),
    `export const reservedBundledPluginSdkEntrypoints = ["browser-security-runtime"] as const;
export const supportedBundledFacadeSdkEntrypoints = ["lmstudio"] as const;
export const publicPluginOwnedSdkEntrypoints = ["speech-core"] as const;\n`,
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
  assert.deepEqual(target.reservedSdkExports, ["openclaw/plugin-sdk/browser-security-runtime"]);
  assert.deepEqual(target.supportedFacadeSdkExports, ["openclaw/plugin-sdk/lmstudio"]);
  assert.deepEqual(target.publicPluginOwnedSdkExports, ["openclaw/plugin-sdk/speech-core"]);
  assert.deepEqual(target.manifestFields, ["contracts", "id"]);
  assert.deepEqual(target.manifestContractFields, ["channels", "tools"]);
  assert.equal(target.manifestTypesPath, "openclaw/src/plugins/manifest.ts");
  assert.equal(target.compatRegistryPath, "openclaw/src/plugins/compat/registry.ts");
});

test("split compat registry records retain their statuses and report coverage", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-split-registry-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const registryDir = path.join(rootDir, "openclaw/src/plugins/compat");
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, "registry.ts"), `
import { PLUGIN_COMPAT_RECORDS } from "./registry-records.js";
import type { PluginCompatRecord } from "./types.js";
export type PluginCompatCode = (typeof PLUGIN_COMPAT_RECORDS)[number]["code"];
export function listPluginCompatRecords(): readonly PluginCompatRecord[] {
  return PLUGIN_COMPAT_RECORDS;
}
`);
  const codes = [
    "api.capture.runtime-registrars",
    "channel.runtime.envelope-config-metadata",
    "hook.before_tool_call.terminal-block-approval",
    "hook.llm-observer.privacy-payload",
  ];
  await writeFile(path.join(registryDir, "registry-records.ts"), `
export const PLUGIN_COMPAT_RECORDS = [
${codes.map((code) => `  { code: "${code}", status: "active" },`).join("\n")}
  { code: "legacy-contract", status: "deprecated" },
] as const;
`);
  const target = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });
  assert.equal(target.compatRegistryPath, "openclaw/src/plugins/compat/registry-records.ts");
  assert.deepEqual(target.compatRecords, [...codes, "legacy-contract"]);
  assert.deepEqual(target.compatRecordStatuses, {
    ...Object.fromEntries(codes.map((code) => [code, "active"])),
    "legacy-contract": "deprecated",
  });
  assert.equal(target.compatRecordCount, 5);

  const suggestions = [];
  const logs = [];
  const decisions = [];
  classifyCompatRecordCoverage({
    targetOpenClaw: target,
    findings: [...codes, "genuinely-absent"].map((compatRecord) => ({ fixture: "sample", compatRecord })),
    suggestions,
    logs,
    decisions,
  });
  assert.deepEqual(suggestions.map((finding) => [finding.code, finding.compatRecord]), [
    ["missing-compat-record", "genuinely-absent"],
  ]);
  assert.deepEqual(decisions.map((decision) => decision.evidence), ["genuinely-absent"]);
  assert.deepEqual(logs.map((entry) => entry.compatRecord), codes);
});

test("compat registry delegation requires an explicit value import", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-registry-selection-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const registryDir = path.join(rootDir, "openclaw/src/plugins/compat");
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, "registry-records.ts"),
    'export const PLUGIN_COMPAT_RECORDS = [{ code: "delegated", status: "active" }];\n');
  const valueImport = 'import { PLUGIN_COMPAT_RECORDS } from "./registry-records.js";';
  const cases = [
    ["inline with unrelated sibling", "", false],
    ["empty inline with unrelated sibling", "", false, true],
    ["line comment", `// ${valueImport}`, false],
    ["block comment", `/* ${valueImport} */`, false],
    ["quoted import", `const example = ${JSON.stringify(valueImport)};`, false],
    ["template import", `const example = \`${valueImport}\`;`, false],
    ["type-only declaration", 'import type { PLUGIN_COMPAT_RECORDS } from "./registry-records.js";', false],
    ["type-only binding", 'import { type PLUGIN_COMPAT_RECORDS } from "./registry-records.js";', false],
    ["commented binding", 'import { /* PLUGIN_COMPAT_RECORDS, */ OTHER_RECORDS } from "./registry-records.js";', false],
    ["other imported value", 'import { OTHER_RECORDS } from "./registry-records.js";', false],
    ["other module", 'import { PLUGIN_COMPAT_RECORDS } from "./other-records.js";', false],
    ["named value among types", 'import {\n type PluginCompatRecord,\n PLUGIN_COMPAT_RECORDS,\n} from "./registry-records.js";', true],
    ["aliased value", "import { PLUGIN_COMPAT_RECORDS as records } from './registry-records.js';", true],
    ["comments between tokens", 'import /* values */ { PLUGIN_COMPAT_RECORDS /* records */ } from /* sibling */ "./registry-records.js";', true],
  ];
  for (const [name, prefix, delegated, empty = false] of cases) {
    await t.test(name, async () => {
      await writeFile(path.join(registryDir, "registry.ts"),
        `${prefix}\nexport const inlineRecords = ${empty ? "[]" : '[{ code: "inline", status: "deprecated" }]'};\n`);
      const target = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });
      assert.equal(target.compatRegistryPath,
        `openclaw/src/plugins/compat/${delegated ? "registry-records.ts" : "registry.ts"}`);
      assert.deepEqual(target.compatRecords, delegated ? ["delegated"] : empty ? [] : ["inline"]);
    });
  }
});

test("a missing explicitly delegated compat registry fails instead of falling back", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-missing-registry-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const registryDir = path.join(rootDir, "openclaw/src/plugins/compat");
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, "registry.ts"),
    'import { PLUGIN_COMPAT_RECORDS } from "./registry-records.js";\n');
  await assert.rejects(
    readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" }),
    { code: "ENOENT", path: path.join(registryDir, "registry-records.ts") },
  );
});

test("OpenClaw target parser prefers the refactored manifest types module", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-openclaw-target-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const targetRoot = path.join(rootDir, "openclaw");
  await mkdir(path.join(targetRoot, "src/plugins/compat"), { recursive: true });
  await writeFile(path.join(targetRoot, "src/plugins/compat/registry.ts"), "export const records = [];\n", "utf8");
  await writeFile(
    path.join(targetRoot, "src/plugins/manifest.ts"),
    `export type PluginManifest = {
  legacyOnly?: true;
};\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/manifest-types.ts"),
    `export type PluginManifest = {
  id: string;
  contracts?: PluginManifestContracts;
};
export type PluginManifestContracts = {
  embeddedExtensionFactories?: string[];
  tools?: string[];
};\n`,
    "utf8",
  );

  const target = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });

  assert.equal(target.manifestTypesPath, "openclaw/src/plugins/manifest-types.ts");
  assert.deepEqual(target.manifestFields, ["contracts", "id"]);
  assert.deepEqual(target.manifestContractFields, ["embeddedExtensionFactories", "tools"]);
});

test("OpenClaw target parser ignores transitional manifest types modules without the manifest contract", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-openclaw-target-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const targetRoot = path.join(rootDir, "openclaw");
  await mkdir(path.join(targetRoot, "src/plugins/compat"), { recursive: true });
  await writeFile(path.join(targetRoot, "src/plugins/compat/registry.ts"), "export const records = [];\n", "utf8");
  await writeFile(
    path.join(targetRoot, "src/plugins/manifest-types.ts"),
    `export type PluginConfigUiHint = {
  label?: string;
};\n`,
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "src/plugins/manifest.ts"),
    `export type PluginManifest = {
  id: string;
  contracts?: PluginManifestContracts;
};
export type PluginManifestContracts = {
  channels?: string[];
  tools?: string[];
};\n`,
    "utf8",
  );

  const target = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });

  assert.equal(target.manifestTypesPath, "openclaw/src/plugins/manifest.ts");
  assert.deepEqual(target.manifestFields, ["contracts", "id"]);
  assert.deepEqual(target.manifestContractFields, ["channels", "tools"]);
});

test("packed OpenClaw target parser reads raw manifest fields", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-openclaw-target-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const targetRoot = path.join(rootDir, "openclaw");
  await mkdir(path.join(targetRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(targetRoot, "package.json"),
    JSON.stringify({ name: "openclaw", version: "2026.7.2-beta.7" }),
    "utf8",
  );
  await writeFile(
    path.join(targetRoot, "dist", "manifest.d.ts"),
    `type PluginManifest = {
  id: string;
  configSchema: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
  contracts?: PluginManifestContracts;
};
type PluginManifestContracts = {
  tools?: string[];
};
type PluginManifestRecord = {
  id: string;
  configUiHints?: Record<string, unknown>;
  rootDir: string;
};\n`,
    "utf8",
  );

  const target = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });

  assert.equal(target.version, "2026.7.2-beta.7");
  assert.equal(target.manifestTypesPath, "openclaw/dist/manifest.d.ts");
  assert.deepEqual(target.manifestFields, ["configSchema", "contracts", "id", "uiHints"]);
  assert.deepEqual(target.manifestContractFields, ["tools"]);
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
    parsePluginSdkEntrypointSpecifiers(
      'export const reservedBundledPluginSdkEntrypoints = ["browser-security-runtime", "matrix"] as const;',
      "reservedBundledPluginSdkEntrypoints",
    ),
    ["openclaw/plugin-sdk/browser-security-runtime", "openclaw/plugin-sdk/matrix"],
  );
  assert.deepEqual(
    parseCompatRecordEntries(`
      ${"{{".repeat(256)}
      { code: "b", status: "supported" }
      { code: "a", status: "deprecated" }
      { code: "b", status: "supported" }
    `).map((entry) => entry.code),
    ["a", "b"],
  );
  assert.deepEqual(parseTypeFields("export type PluginManifest = {\n  id?: string;\n};", "PluginManifest"), ["id"]);
});
