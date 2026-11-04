import { createTempDir } from "./helpers/temp-dir.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { inspectSdkUsage } from "../src/sdk-usage.js";
import { createUsageProgram } from "../src/sdk-usage/program.js";

test("SDK programs discard typed documentation while retaining JavaScript-only API types", async (t) => {
  const directory = await createTempDir(t, "sdk-jsdoc-");
  const target = path.join(directory, "host");
  const sdk = path.join(target, "src/plugin-sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(path.join(target, "package.json"), "{}");
  await writeFile(path.join(sdk, "example.ts"), `
/** Host documentation must not enlarge each inventory's type graph. */
export interface OpenClawPluginApi { registerTool(tool: unknown): void }
/** A typed facade exercises declaration emit. */
export function install(api: OpenClawPluginApi): void {}
`);
  const plugin = path.join(directory, "plugin");
  await mkdir(plugin);
  const text = `
/** @param {import("openclaw/plugin-sdk/example").OpenClawPluginApi} value */
export function activate(value) { value.registerTool({}); }
`;
  const files = [{ path: path.join(plugin, "index.js"), text }];
  await writeFile(files[0].path, text);
  const cache = { sources: new Map() };
  function inspectProgram() {
    const context = createUsageProgram(files, target, cache);
    const parameter = context.sources[0].statements[0].parameters[0];
    assert.ok(context.checker.getTypeAtLocation(parameter).getProperty("registerTool"),
      "JavaScript JSDoc is the only source of this parameter's SDK type");
    let typedDocs = 0;
    for (const source of context.program.getSourceFiles()) {
      if (!/\.[cm]?tsx?$/.test(source.fileName)) continue;
      function visit(node) { typedDocs += node.jsDoc?.length ?? 0; ts.forEachChild(node, visit); }
      visit(source);
    }
    assert.equal(typedDocs, 0, "host and standard-library documentation must not remain in the program");
  }
  inspectProgram();
  // Recreate cached trees as after collection, without depending on GC timing.
  for (const cached of cache.sources.values()) cached.source = undefined;
  inspectProgram();
  const usage = await inspectSdkUsage({ root: plugin, targetRoot: target });
  assert.ok(usage.entries.some((entry) => entry.key === "api-member:api.registerTool"));
});

test("TypeScript and declaration documentation do not change complete SDK inventory evidence", async (t) => {
  const root = await createTempDir(t, "sdk-typed-docs-");
  const files = {
    "index.ts": `
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
/** @deprecated Documentation is not a runtime call. */
export function activate(api: OpenClawPluginApi) { api.registerTool({}); }
`,
    "types.d.ts": `
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
/** Public documentation with {@link PluginRuntime}. */
export declare function runtime(): PluginRuntime;
`,
  };
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text);
  const documented = await inspectSdkUsage({ root });
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(root, name), text.replace(/\/\*\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " ")));
  }
  const uncommented = await inspectSdkUsage({ root });
  assert.deepEqual(documented, uncommented, "provenance, classifications, evidence positions and coverage remain identical");
  assert.equal(documented.status, "complete");
  assert.equal(documented.coverage.filesAnalyzed, 2);
  assert.ok(documented.entries.some((entry) => entry.key === "api-member:api.registerTool"));
  assert.ok(documented.entries.some((entry) => entry.identity.endsWith("#PluginRuntime") && entry.classification === "type"));
});
