import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readOpenClawTargetSurface } from "../src/openclaw-target.js";
import { inspectCompatibilityFixtureSet, inspectSourceText } from "../src/inspector.js";
import sdkRetirements from "../src/sdk-retirements.json" with { type: "json" };

const api = "openclaw/plugin-sdk/session-store-runtime.getSessionEntry";
const replacement = "Await getSessionEntryAsync, then use the prepared session entry.";

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "inspector-retirement-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const registryDir = path.join(rootDir, "openclaw/src/plugins/compat");
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, "registry.ts"), 'import { PLUGIN_COMPAT_RECORDS } from "./registry-records.js";');
  await writeFile(path.join(registryDir, "registry-records.ts"), `
    import { PREPARATION_RECORDS as prepared } from "./async-sqlite-preparation-records.js";
    export const PLUGIN_COMPAT_RECORDS = [
      ...prepared,
      { code: "supported", status: "active", surfaces: ["openclaw/plugin-sdk/session-store-runtime.getSessionEntryAsync"] },
    ];
  `);
  await writeFile(path.join(registryDir, "async-sqlite-preparation-records.ts"), `
    import type { PluginCompatRecord } from "./types.js";
    const PREPARATION = { status: "deprecated", removeAfter: "2026-12-31" } as const;
    export const PREPARATION_RECORDS = [{
      ...PREPARATION,
      code: "session-store-sync-readers",
      replacement: ${JSON.stringify(replacement)},
      docsPath: "/plugins/sdk-migration/sqlite-async",
      surfaces: [${JSON.stringify(api)}],
      tests: ["src/plugins/compat/registry.test.ts"],
    }] as const satisfies readonly PluginCompatRecord[];
    throw new Error("Target modules must never execute");
  `);
  await writeFile(path.join(rootDir, "openclaw/package.json"), JSON.stringify({ exports: {
    "./plugin-sdk/session-store-runtime": "./dist/sessions.js",
  } }));
  return { rootDir, registryDir };
}

test("reads delegated shared retirement metadata and emits a nonblocking author-facing member finding", async (t) => {
  const { rootDir } = await fixture(t);
  await mkdir(path.join(rootDir, "plugin"));
  await writeFile(path.join(rootDir, "plugin/index.ts"), `import { getSessionEntry as read } from "openclaw/plugin-sdk/session-store-runtime";\nread("session");`);
  const config = { rootDir, fixtures: [{ id: "synthetic", path: "plugin", seams: [], expect: {} }] };
  const report = await inspectCompatibilityFixtureSet(config, { openclawPath: "./openclaw", authorFacing: true });
  const record = report.targetOpenClaw.compatDeprecations[0];
  assert.equal(record.removeAfter, "2026-12-31");
  assert.equal(record.replacement, replacement);
  assert.deepEqual(record.surfaces, [api]);
  assert.deepEqual(report.targetOpenClaw.compatRecordTests[record.code], ["src/plugins/compat/registry.test.ts"]);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.fixtures[0].sdkUsage.entries.find(entry => entry.identity === "openclaw/plugin-sdk/session-store-runtime#getSessionEntry").deprecationCodes, ["sdk-deprecated-api"]);
  const issue = report.issues.find((item) => item.code === "sdk-deprecated-api");
  assert.ok(issue);
  assert.equal(issue.issueClass, "deprecation-warning");
  assert.equal(issue.deprecated, true);
  assert.equal(issue.owner, "plugin");
  assert.equal(issue.severity, "P2");
  assert.match(issue.authorRemediation.summary, /retires on Dec 31, 2026/);
  assert.equal(issue.authorRemediation.docsUrl, "https://docs.openclaw.ai/plugins/sdk-migration/sqlite-async");
  for (const finding of [issue, report.warnings.find((item) => item.code === "sdk-deprecated-api"), report.fixtures[0].sdkDeprecations[0]]) {
    assert.equal(finding.deprecatedApi, api);
    assert.equal(finding.replacement, replacement);
    assert.equal(finding.removeAfter, "2026-12-31");
  }
});

test("matches SDK members across import forms without warning for supported siblings, shadowing, types, or prose", async (t) => {
  const { rootDir } = await fixture(t);
  const targetOpenClaw = await readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });
  const inspect = (source) => inspectSourceText(source, "plugin.ts", { targetOpenClaw }).sdkDeprecations;
  for (const source of [
    'import { getSessionEntry as read } from "openclaw/plugin-sdk/session-store-runtime";',
    'export { getSessionEntry as read } from "openclaw/plugin-sdk/session-store-runtime";',
    'import * as sdk from "openclaw/plugin-sdk/session-store-runtime"; sdk.getSessionEntry("session");',
    'const { getSessionEntry: read } = require("openclaw/plugin-sdk/session-store-runtime");',
    'const sdk = await import("openclaw/plugin-sdk/session-store-runtime"); sdk.getSessionEntry("session");',
    'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const { getSessionEntry } = load("openclaw/plugin-sdk/session-store-runtime");',
  ]) assert.equal(inspect(source).length, 1, source);
  for (const source of [
    'import { getSessionEntryAsync } from "openclaw/plugin-sdk/session-store-runtime";',
    'import { getSessionEntry } from "./local.js";',
    'import type { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";',
    'import { type getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";',
    'import * as sdk from "openclaw/plugin-sdk/session-store-runtime"; function f(sdk) { sdk.getSessionEntry(); }',
    '// import { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";',
    'const example = \'import { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime"\';',
  ]) assert.deepEqual(inspect(source), [], source);
});

test("rejects missing, cyclic, and escaping literal record modules", async (t) => {
  const { rootDir, registryDir } = await fixture(t);
  const read = () => readOpenClawTargetSurface({ rootDir, configuredPath: "./openclaw" });
  const delegated = path.join(registryDir, "async-sqlite-preparation-records.ts");
  await rm(delegated);
  await assert.rejects(read(), { code: "ENOENT" });
  await writeFile(delegated, 'const a = b; const b = a; export const PREPARATION_RECORDS = a;');
  await assert.rejects(read(), /Cyclic compatibility record data/);
  await rm(delegated);
  const outside = path.join(rootDir, "outside.ts");
  await writeFile(outside, "export const PREPARATION_RECORDS = [];");
  await symlink(outside, delegated);
  await assert.rejects(read(), /escapes registry directory/);
});

test("keeps member locations and each record's own metadata; direct runtime members also warn", () => {
  const targetOpenClaw = { compatDeprecations: [
    { code: "sqlite", status: "deprecated", removeAfter: "2026-12-31", replacement: "Use openOpenClawAgentSqliteWorkerStoreV2.", surfaces: [
      "openclaw/plugin-sdk/sqlite-runtime.executeSqliteQuerySync",
      "openclaw/plugin-sdk/sqlite-runtime.openNodeSqliteDatabase writable handles",
      "openclaw/plugin-sdk/sqlite-runtime openNodeSqliteDatabase writable handles",
    ] },
    { code: "state", status: "deprecated", replacement: "Use openKeyedStoreV2.", surfaces: ["api.runtime.state.openSyncKeyedStore"] },
  ] };
  const source = [
    'type Options = { key: string };',
    'const lazy = import("./local.js");',
    '',
    'import { executeSqliteQuerySync, openNodeSqliteDatabase } from "openclaw/plugin-sdk/sqlite-runtime";',
    'export function register(api: unknown) { api.runtime.state.openSyncKeyedStore({}); }',
  ].join("\n");
  const findings = inspectSourceText(source, "plugin.ts", { targetOpenClaw }).sdkDeprecations;
  assert.deepEqual(findings.map(({ ref, removeAfter }) => [ref, removeAfter]), [
    ["plugin.ts:4", "2026-12-31"], ["plugin.ts:5", undefined],
  ]);
  assert.match(findings[0].replacement, /openOpenClawAgentSqliteWorkerStoreV2/);
  assert.equal(findings[1].deprecatedApi, "api.runtime.state.openSyncKeyedStore");
  assert.deepEqual(inspectSourceText("cache.runtime.state.openSyncKeyedStore({});", "local.js", { targetOpenClaw }).sdkDeprecations, []);
});

test("ClawHub-style packed targets use the pinned retirement inventory without registry source", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "inspector-packed-retirement-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const target = path.join(rootDir, "openclaw");
  const plugin = path.join(rootDir, "plugin");
  await mkdir(path.join(target, "dist"), { recursive: true });
  await mkdir(plugin);
  await writeFile(path.join(target, "package.json"), JSON.stringify({ name: "openclaw", version: "2026.10.1", exports: { "./plugin-sdk/sqlite-runtime": "./dist/sqlite.js" } }));
  await writeFile(path.join(target, "dist/index.d.ts"), "export type PluginManifest = { id: string };\n");
  await writeFile(path.join(plugin, "index.js"), 'import { executeSqliteQuerySync } from "openclaw/plugin-sdk/sqlite-runtime";');
  const report = await inspectCompatibilityFixtureSet({ rootDir, fixtures: [{ id: "packed", path: "plugin", seams: [], expect: {} }] }, { openclawPath: target, authorFacing: true });
  assert.equal(report.targetOpenClaw.compatRegistryPath, null);
  assert.match(report.targetOpenClaw.compatDeprecationsSource.commit, /^[a-f0-9]{40}$/);
  const issue = report.issues.find((item) => item.code === "sdk-deprecated-api");
  assert.equal(issue?.deprecated, true);
  assert.equal(issue?.deprecatedApi, "openclaw/plugin-sdk/sqlite-runtime.executeSqliteQuerySync");
  assert.equal(issue?.removeAfter, "2026-12-31");
  assert.match(issue?.replacement, /openOpenClawAgentSqliteWorkerStoreV2/);
  assert.equal(report.status, "pass");
});

test("packed inventory matches space-separated member names", () => {
  const targetOpenClaw = { compatDeprecations: sdkRetirements.records };
  const findings = inspectSourceText('import { resolveCronStorePath } from "openclaw/plugin-sdk/cron-store-runtime";', "cron.ts", { targetOpenClaw }).sdkDeprecations;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].deprecatedApi, "openclaw/plugin-sdk/cron-store-runtime resolveCronStorePath");
  assert.equal(findings[0].removeAfter, "2026-12-31");
  assert.match(findings[0].replacement, /resolveCronStorePathAsync/);
});
