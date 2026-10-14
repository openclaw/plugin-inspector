import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { captureEntrypoint } from "@openclaw/plugin-inspector/advanced";
import { createMockSdkPackage, installMockSdkLoader } from "../src/sdk-mock.js";

const supportsSyncMocks = typeof nodeModule.registerHooks === "function";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-bundled-loader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    await writeFile(path.join(root, name), source);
  }
  return root;
}

function entry(body) {
  return `import { loadBundledEntryExportSync } from "openclaw/plugin-sdk/channel-entry-contract";
export default { async register(api) { ${body} } };`;
}

test("bundled namespace capture guards unsupported runtimes before loading", async (t) => {
  const root = await fixture(t, {
    "index.mjs": entry(`const mod = loadBundledEntryExportSync(import.meta.url, { specifier: "./api.mjs" }); api.registerTool({ name: mod.name });`),
    "api.mjs": `import { writeFileSync } from "node:fs";
writeFileSync(new URL("./loaded", import.meta.url), "loaded"); export const name = "namespace";`,
  });
  const capture = () => captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
  if (!supportsSyncMocks) {
    await assert.rejects(capture(), /Bundled module namespace capture requires Node\.js 22\.15.*registerHooks/);
    await assert.rejects(readFile(path.join(root, "loaded")), { code: "ENOENT" });
    return;
  }
  assert.equal((await capture()).status, "captured");
  assert.equal(await readFile(path.join(root, "loaded"), "utf8"), "loaded");
});

for (const extension of ["mjs", "ts"]) {
  test(`bundled ${extension} namespace preserves named values, callables and SDK mocks`, { skip: !supportsSyncMocks }, async (t) => {
    const root = await fixture(t, {
      "index.mjs": entry(`const mod = loadBundledEntryExportSync(import.meta.url, { specifier: "./api.${extension === "ts" ? "js" : extension}" }); if (mod.answer !== 42) throw new Error("namespace value lost"); mod.register(api);`),
      [`api.${extension}`]: `import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
const schema = buildSecretInputSchema().optional();
export const answer${extension === "ts" ? ": number" : ""} = 42;
export function register(api${extension === "ts" ? ": any" : ""}) { schema.parse(undefined); api.registerTool({ name: "namespace" }); }`,
    });
    const capture = () => captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
    if (extension === "ts" && !process.features.typescript) {
      // Node 22.15 has sync hooks but requires explicit native type stripping.
      await assert.rejects(capture(), /SyntaxError: Missing initializer/);
      return;
    }
    const result = await capture();
    assert.equal(result.status, "captured");
    assert.deepEqual(result.captured.map((item) => item.name), ["registerTool"]);
  });
}

test("bundled namespace unwraps the module default", { skip: !supportsSyncMocks }, async (t) => {
  const root = await fixture(t, {
    "index.mjs": entry(`const mod = loadBundledEntryExportSync(import.meta.url, { specifier: "./api.mjs" }); if (mod.answer !== 42) throw new Error("default not unwrapped"); mod.register(api);`),
    "api.mjs": 'export default { answer: 42, register(api) { api.registerCommand({ name: "default" }); } };',
  });
  const result = await captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
  assert.deepEqual(result.captured.map((item) => item.name), ["registerCommand"]);
});

for (const useDefault of [false, true]) {
  test(`bundled named callable remains available${useDefault ? " through default" : ""}`, async (t) => {
    const register = 'function register(api) { api.registerTool({ name: "named" }); }';
    const root = await fixture(t, {
      "index.mjs": entry('await loadBundledEntryExportSync(import.meta.url, { specifier: "./api.mjs", exportName: "register" })(api);'),
      "api.mjs": useDefault ? `${register}\nexport default { register };` : `export ${register}`,
    });
    const result = await captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
    assert.deepEqual(result.captured.map((item) => item.name), ["registerTool"]);
  });
}

test("bundled missing named exports fail visibly", async (t) => {
  const root = await fixture(t, {
    "index.mjs": entry('await loadBundledEntryExportSync(import.meta.url, { specifier: "./api.mjs", exportName: "missing" })();'),
    "api.mjs": "export const present = 42;",
  });
  await assert.rejects(captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true }),
    (error) => error.failureClass === "registration-execution-error" && /Missing bundled entry export: missing/.test(error.message));
});

test("bundled named TypeScript callable keeps the existing async loader", async (t) => {
  const root = await fixture(t, {
    "index.mjs": entry('await loadBundledEntryExportSync(import.meta.url, { specifier: "./api.js", exportName: "register" })(api);'),
    "api.ts": 'export function register(api: any) { api.registerTool({ name: "named-typescript" }); }',
  });
  const result = await captureEntrypoint("index.mjs", { cwd: root, pluginRoot: root, mockSdk: true });
  assert.deepEqual(result.captured.map((item) => item.name), ["registerTool"]);
});

test("bundled namespace loader hooks clean up after success and import failure", { skip: !supportsSyncMocks }, async (t) => {
  const root = await fixture(t, {});
  for (const fails of [false, true]) {
    const plugin = path.join(root, String(fails));
    await mkdir(plugin);
    await writeFile(path.join(plugin, "index.mjs"), entry('loadBundledEntryExportSync(import.meta.url, { specifier: "./api.mjs" }).register(api);'));
    await writeFile(path.join(plugin, "api.mjs"), fails ? 'throw new Error("bundled import failed");' :
      'import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input"; export function register(api) { buildSecretInputSchema().parse(undefined); api.registerTool({ name: "clean" }); }');
    const mock = await createMockSdkPackage(path.join(root, `mock-${fails}`), { pluginRoot: plugin });
    const stop = await installMockSdkLoader(mock);
    try {
      const mod = await import(pathToFileURL(path.join(plugin, "index.mjs")).href);
      if (fails) await assert.rejects(mod.default.register({}), /bundled import failed/);
      else await mod.default.register({ registerTool() {} });
    } finally {
      stop();
    }
    assert.throws(() => nodeModule.createRequire(path.join(plugin, "outside.cjs"))("openclaw/plugin-sdk/secret-input"),
      { code: "MODULE_NOT_FOUND" });
  }
});
