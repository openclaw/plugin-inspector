import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  captureEntrypoint,
  createMockSdkPackage,
  inspectSourceText,
  runEntrypointSyntheticProbes,
} from "@openclaw/plugin-inspector/advanced";

const execFileAsync = promisify(execFile);
const supportsCommonJsMocks = typeof nodeModule.registerHooks === "function";
const commonJsCapabilityMessage = /CommonJS SDK mocking requires Node\.js 22\.15.*registerHooks.*upgrade/i;
const cjsEntries = {
  destructured: [
    'const { definePluginEntry: define } = require("openclaw/plugin-sdk");',
    'module.exports = define({ id: "cjs-fixture", register });',
  ],
  namespace: [
    'const sdk = require("openclaw/plugin-sdk");',
    'module.exports = sdk.definePluginEntry({ id: "cjs-fixture", register });',
  ],
  compiled: [
    'module.exports = (0, require("openclaw/plugin-sdk/channel-entry").defineBundledChannelEntry)({',
    '  id: "cjs-fixture", registerFull: register,',
    "});",
  ],
};

for (const [form, entryLines] of Object.entries(cjsEntries)) {
  for (const boundary of ["API", "CLI", "synthetic"]) {
    test(`CommonJS ${form} SDK calls execute through ${boundary}`, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cjs-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(path.join(root, "index.cjs"), [
        "#!/usr/bin/env node",
        '"use strict";',
        'const { basename } = require("path");',
        'const relative = require("./relative.cjs");',
        ...entryLines,
        "function register(api) {",
        "  if ((function () { return this; })() !== undefined) throw new Error('CommonJS strict mode changed');",
        "  api.on('before_tool_call', () => ({ seen: basename('/fixture/cjs-handler') }));",
        "  api.registerTool({ name: 'cjs_tool', run() {",
        '    const { jsonResult } = require("openclaw/plugin-sdk");',
        '    const { isRecord: record } = require("openclaw/plugin-sdk/string-coerce-runtime");',
        '    const $future = require("openclaw/plugin-sdk/future-fixture");',
        "    if (!record({}) || record([]) || typeof $future.futureHelper !== 'function') throw new Error('SDK mock mismatch');",
        "    if (basename('/fixture/cjs-handler') !== 'cjs-handler') throw new Error('builtin was mocked');",
        "    if (relative !== 'real-relative') throw new Error('relative module was mocked');",
        "    return jsonResult({ marker: 'cjs-handler' }).content[0].text;",
        "  } });",
        "}",
        "",
      ].join("\n"));
      await writeFile(path.join(root, "relative.cjs"), 'module.exports = "real-relative";\n');
      await assert.rejects(stat(path.join(root, "node_modules", "openclaw")), { code: "ENOENT" });
      if (boundary === "synthetic") {
        if (!supportsCommonJsMocks) {
          await assert.rejects(
            runEntrypointSyntheticProbes("index.cjs", { cwd: root, pluginRoot: root, mockSdk: true }),
            (error) => error.failureClass === "entrypoint-import-error" && commonJsCapabilityMessage.test(error.message),
          );
          return;
        }
        const result = await runEntrypointSyntheticProbes("index.cjs", {
          cwd: root, pluginRoot: root, mockSdk: true,
        });
        assert.equal(result.summary.failCount, 0, JSON.stringify(result));
        const tool = result.results.find((item) => item.label === "registerTool.run");
        assert.equal(tool?.status, "pass", JSON.stringify(result));
        assert.match(JSON.stringify(tool.output), /cjs-handler/);
        assert.equal(result.results.find((item) => item.label === "before_tool_call")?.status, "pass");
        return;
      }
      const capture = () => boundary === "API"
        ? captureEntrypoint("index.cjs", { cwd: root, pluginRoot: root, mockSdk: true })
        : execFileAsync(process.execPath, [
          fileURLToPath(new URL("./cli.js", import.meta.resolve("@openclaw/plugin-inspector"))),
          "capture", "index.cjs", "--allow-execute",
        ], {
          cwd: root,
          env: { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" },
        }).then(({ stdout }) => JSON.parse(stdout));
      if (!supportsCommonJsMocks) {
        await assert.rejects(capture(), (error) => boundary === "API"
          ? error.failureClass === "entrypoint-import-error" && commonJsCapabilityMessage.test(error.message)
          : commonJsCapabilityMessage.test(error.stderr));
        return;
      }
      const result = await capture();
      assert.equal(result.status, "captured");
      assert.equal(result.mockSdk, true);
      assert.ok(result.captured.some((item) => item.name === "registerTool"));
      assert.ok(result.captured.some((item) => item.name === "before_tool_call"));
    });
  }
}

test("mock capture preserves CommonJS hashbang and strict-mode semantics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cjs-directives-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.cjs"), [
    "#!/usr/bin/env node",
    '"use strict";',
    '// require("openclaw/plugin-sdk/comment-only")',
    '/* require("openclaw/plugin-sdk/block-comment") */',
    'const example = \'require("openclaw/plugin-sdk/string-only")\';',
    'const template = `require("openclaw/plugin-sdk/template-only")`;',
    'const quoted = "require(\'openclaw/plugin-sdk/double-quoted\')";',
    "const strict = (function () { return this; })() === undefined;",
    "if (!strict) throw new Error('CommonJS strict mode changed');",
    "module.exports = { register(api) {",
    "  api.registerTool({ name: 'strict_tool', run() { return strict; } });",
    "} };",
    "",
  ].join("\n"));
  const options = { cwd: root, pluginRoot: root, mockSdk: true };
  const capture = await captureEntrypoint("index.cjs", options);
  assert.equal(capture.status, "captured");
  assert.ok(capture.captured.some((item) => item.name === "registerTool"));
  const probes = await runEntrypointSyntheticProbes("index.cjs", options);
  assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
  const tool = probes.results.find((item) => item.label === "registerTool.run");
  assert.equal(tool?.status, "pass", JSON.stringify(probes));
  assert.deepEqual(tool.output, { type: "boolean", value: true });
});

test("source inspection discovers CommonJS SDK requirements with source references", () => {
  const result = inspectSourceText([
    '// require("openclaw/plugin-sdk/comment-only");',
    'const { definePluginEntry } = require("openclaw/plugin-sdk");',
    'const sdk = require("openclaw/plugin-sdk/core");',
    'module.exports = (0, require("openclaw/plugin-sdk/channel-entry").defineBundledChannelEntry)({});',
    'require("node:fs");',
    'const example = \'require("openclaw/plugin-sdk/string-only")\';',
    'const template = `require("openclaw/plugin-sdk/template-only")`;',
  ].join("\n"), "dist/index.cjs");
  assert.deepEqual(result.sdkImports.map(({ specifier, line, ref }) => ({ specifier, line, ref })), [
    { specifier: "openclaw/plugin-sdk", line: 2, ref: "dist/index.cjs:2" },
    { specifier: "openclaw/plugin-sdk/core", line: 3, ref: "dist/index.cjs:3" },
    { specifier: "openclaw/plugin-sdk/channel-entry", line: 4, ref: "dist/index.cjs:4" },
  ]);
});

for (const phase of ["entrypoint-import-error", "registration-execution-error"]) {
  test(`CommonJS mock capture preserves ${phase}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cjs-failure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "index.cjs"), [
      'const { definePluginEntry } = require("openclaw/plugin-sdk");',
      phase === "entrypoint-import-error"
        ? 'throw new Error("fixture import failed after openclaw/plugin-sdk");'
        : 'module.exports = definePluginEntry({ register() { throw new Error("fixture registration failed after openclaw/plugin-sdk"); } });',
    ].join("\n"));
    await assert.rejects(
      captureEntrypoint("index.cjs", { cwd: root, pluginRoot: root, mockSdk: true }),
      (error) => supportsCommonJsMocks
        ? error.failureClass === phase && /fixture .* failed after openclaw\/plugin-sdk/.test(error.message)
        : error.failureClass === "entrypoint-import-error" && commonJsCapabilityMessage.test(error.message),
    );
  });
}

test("CommonJS synthetic hooks stay scoped and are removed after success and failure", {
  skip: !supportsCommonJsMocks,
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cjs-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ["first", "second"]) {
    const dir = path.join(root, id);
    await mkdir(dir);
    await writeFile(path.join(dir, "index.cjs"), [
      "module.exports = { register(api) {",
      "  api.registerTool({ name: 'isolation', run() {",
      `    const { ${id}Helper } = require("openclaw/plugin-sdk/capture-local");`,
      `    if (typeof ${id}Helper !== 'function') throw new Error('wrong capture mock');`,
      `    return ${JSON.stringify(id)};`,
      "  } });",
      "} };",
    ].join("\n"));
    const probes = await runEntrypointSyntheticProbes("index.cjs", { cwd: dir, mockSdk: true });
    assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
    assert.deepEqual(probes.results.find((item) => item.label === "registerTool.run")?.output,
      { type: "string", value: id });
    const require = nodeModule.createRequire(path.join(dir, "outside.cjs"));
    assert.throws(() => require("openclaw/plugin-sdk/not-generated"), { code: "MODULE_NOT_FOUND" });
  }
  await writeFile(path.join(root, "bad.cjs"), 'throw new Error("fixture import failed");\n');
  await assert.rejects(runEntrypointSyntheticProbes("bad.cjs", { cwd: root, mockSdk: true }));
  assert.throws(() => nodeModule.createRequire(path.join(root, "outside.cjs"))("openclaw/plugin-sdk"),
    { code: "MODULE_NOT_FOUND" });
});

test("CommonJS SDK traversal is rejected at runtime", { skip: !supportsCommonJsMocks }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cjs-traversal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.cjs"), 'require("openclaw/plugin-sdk/../../escape");\n');
  await assert.rejects(
    runEntrypointSyntheticProbes("index.cjs", { cwd: root, mockSdk: true }),
    (error) => error.failureClass === "entrypoint-import-error" && /invalid OpenClaw plugin SDK subpath/.test(error.message),
  );
});

for (const extension of ["mjs", "ts"]) {
  test(`mock ${extension} capture and synthetic invocation remain available with scoped hooks`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-sibling-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, `index.${extension}`), [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      extension === "ts" ? "const marker: string = 'sibling';" : "const marker = 'sibling';",
      "export default definePluginEntry({ register(api) {",
      "  api.registerTool({ name: 'sibling', async run() {",
      '    const { jsonResult } = await import("openclaw/plugin-sdk");',
      "    return jsonResult(marker).content[0].text;",
      "  } });",
      "} });",
    ].join("\n"));
    const options = { cwd: root, mockSdk: true };
    assert.equal((await captureEntrypoint(`index.${extension}`, options)).status, "captured");
    const probes = await runEntrypointSyntheticProbes(`index.${extension}`, options);
    assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
    assert.deepEqual(probes.results.find((item) => item.label === "registerTool.run")?.output,
      { type: "string", value: '"sibling"' });
    await writeFile(path.join(root, "outside.mjs"), 'import "openclaw/plugin-sdk/not-generated";\n');
    await assert.rejects(import(pathToFileURL(path.join(root, "outside.mjs")).href),
      { code: "ERR_MODULE_NOT_FOUND" });
  });
}

for (const extension of ["mjs", "cjs"]) {
  test(`mock ${extension} capture follows a symlinked plugin root`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-symlink-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const real = path.join(root, "real");
    const alias = path.join(root, "alias");
    await mkdir(real);
    await symlink(real, alias, "junction");
    await writeFile(path.join(real, `index.${extension}`), [
      extension === "cjs"
        ? 'const { definePluginEntry } = require("openclaw/plugin-sdk");'
        : 'import { definePluginEntry } from "openclaw/plugin-sdk";',
      `${extension === "cjs" ? "module.exports =" : "export default"} definePluginEntry({ register(api) {`,
      "  api.registerTool({ name: 'symlink_fixture', run() { return 'symlink-handler'; } });",
      "} });",
    ].join("\n"));
    const options = { cwd: alias, pluginRoot: alias, mockSdk: true };
    if (extension === "cjs" && !supportsCommonJsMocks) {
      for (const run of [captureEntrypoint, runEntrypointSyntheticProbes]) {
        await assert.rejects(run(`index.${extension}`, options),
          (error) => error.failureClass === "entrypoint-import-error" && commonJsCapabilityMessage.test(error.message));
      }
      return;
    }
    assert.equal((await captureEntrypoint(`index.${extension}`, options)).status, "captured");
    const probes = await runEntrypointSyntheticProbes(`index.${extension}`, options);
    assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
    assert.deepEqual(probes.results.find((item) => item.label === "registerTool.run")?.output,
      { type: "string", value: "symlink-handler" });
  });
}

test("CommonJS template expressions discover and load SDK requirements without template text", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-template-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = [
    'const marker = `require("openclaw/plugin-sdk/text-before") ${(() => {',
    '  const value = { kind: typeof require("openclaw/plugin-sdk/template-fixture").templateHelper };',
    '  return `${value.kind}`;',
    '})()} require("openclaw/plugin-sdk/text-after")`;',
    "module.exports = { register(api) {",
    "  api.registerTool({ name: 'template_fixture', run() { return marker.includes('function'); } });",
    "} };",
  ].join("\n");
  assert.deepEqual(inspectSourceText(source).sdkImports.map((item) => item.specifier),
    ["openclaw/plugin-sdk/template-fixture"]);
  await writeFile(path.join(root, "index.cjs"), source);
  const options = { cwd: root, mockSdk: true };
  if (!supportsCommonJsMocks) {
    await assert.rejects(runEntrypointSyntheticProbes("index.cjs", options),
      (error) => error.failureClass === "entrypoint-import-error" && commonJsCapabilityMessage.test(error.message));
    return;
  }
  assert.equal((await captureEntrypoint("index.cjs", options)).status, "captured");
  const probes = await runEntrypointSyntheticProbes("index.cjs", options);
  assert.equal(probes.summary.failCount, 0, JSON.stringify(probes));
  assert.deepEqual(probes.results.find((item) => item.label === "registerTool.run")?.output,
    { type: "boolean", value: true });
});

test("mock SDK ignores subpaths that would escape the plugin-sdk package", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-mock-"));
  const pluginRoot = path.join(rootDir, "plugin");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "index.js"),
    'import { nope } from "openclaw/plugin-sdk/../../escape";\nexport { nope };\n',
    "utf8",
  );

  await createMockSdkPackage(rootDir, { pluginRoot });

  await assert.rejects(stat(path.join(rootDir, "node_modules", "openclaw", "escape.js")), { code: "ENOENT" });
});

test("mock SDK preserves the isRecord predicate contract", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-mock-"));
  const pluginRoot = path.join(rootDir, "plugin");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "index.js"),
    [
      'import { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField } from "openclaw/plugin-sdk/string-coerce-runtime";',
      "export { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField };",
      "",
    ].join("\n"),
    "utf8",
  );

  await createMockSdkPackage(rootDir, { pluginRoot });

  const mockModule = await import(
    pathToFileURL(path.join(rootDir, "node_modules", "openclaw", "plugin-sdk", "string-coerce-runtime.js")).href
  );
  const record = { count: 42, value: "ok" };
  const array = ["value"];
  assert.equal(mockModule.isRecord(record), true);
  assert.equal(mockModule.isRecord([]), false);
  assert.equal(mockModule.isRecord("value"), false);
  assert.equal(mockModule.isRecord(42), false);
  assert.equal(mockModule.isRecord(null), false);
  assert.equal(mockModule.isRecord(undefined), false);
  assert.equal(mockModule.asRecord(record), record);
  assert.equal(mockModule.asRecord(array), array);
  assert.deepEqual(mockModule.asRecord(null), {});
  assert.equal(mockModule.asOptionalRecord(record), record);
  assert.equal(mockModule.asOptionalRecord(array), undefined);
  assert.equal(mockModule.asNullableRecord(record), record);
  assert.equal(mockModule.asNullableRecord(array), null);
  assert.equal(mockModule.readStringField(record, "value"), "ok");
  assert.equal(mockModule.readStringField(record, "count"), undefined);
  assert.equal(mockModule.readStringField(undefined, "value"), undefined);
});
