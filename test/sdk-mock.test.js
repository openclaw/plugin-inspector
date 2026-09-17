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

test("dynamic mock generation agrees with runtime source imports and excludes promise methods", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-dynamic-imports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = [
    'type Shape = import("openclaw/plugin-sdk/dynamic-shared").Shape;',
    'type Only = import("openclaw/plugin-sdk/type-only").Only;',
    'const { sharedHelper: aliased } = await import("openclaw/plugin-sdk/dynamic-shared");',
    'const sdk = await import(`openclaw/plugin-sdk/dynamic-namespace`); sdk.namespaceHelper;',
    'type NamespaceType = typeof sdk.then;',
    'function shadowed(sdk) { sdk.then(); }',
    'const quoted = "sdk.then";',
    '// sdk.then();',
    '/* sdk.commentOnly(); */',
    'const unrelated = { sdk: { then() {} } }; unrelated.sdk.then();',
    'const spaced = unrelated . sdk . then;',
    'const templateText = `sdk.templateOnly`;',
    'const direct = (await import("openclaw/plugin-sdk/dynamic-direct")).directHelper;',
    'const promise = import("openclaw/plugin-sdk/dynamic-promise").then(() => {});',
    '// import("openclaw/plugin-sdk/comment-only");',
    'const text = \'import("openclaw/plugin-sdk/string-only")\';',
    'const template = `https://fixture.invalid import("openclaw/plugin-sdk/template-only") ${',
    '  `nested ${typeof (await import("openclaw/plugin-sdk/dynamic-template")).templateHelper}`',
    '}`;',
    'const computed = (name) => import(`openclaw/plugin-sdk/${name}`);',
    'const joined = (name) => import("openclaw/plugin-sdk/" + name);',
    'const property = receiver.import("openclaw/plugin-sdk/property-only");',
  ].join("\n");
  await writeFile(path.join(root, "index.ts"), source);
  const { pluginSdkDir } = await createMockSdkPackage(root, { pluginRoot: root });
  const expected = new Map([
    ["dynamic-shared", ["sharedHelper"]],
    ["dynamic-namespace", ["namespaceHelper"]],
    ["dynamic-direct", ["directHelper"]],
    ["dynamic-promise", []],
    ["dynamic-template", ["templateHelper"]],
  ]);
  assert.deepEqual(inspectSourceText(source).sdkImports.map(({ specifier }) => specifier),
    [...expected.keys()].map((subpath) => `openclaw/plugin-sdk/${subpath}`));
  for (const [subpath, names] of expected) {
    const module = await import(pathToFileURL(path.join(pluginSdkDir, `${subpath}.js`)).href);
    assert.deepEqual(Object.keys(module).sort(), ["default", ...names].sort(), subpath);
    for (const name of names) assert.equal(typeof module[name], "function");
  }
  for (const subpath of ["type-only", "comment-only", "string-only", "template-only", "property-only"]) {
    await assert.rejects(stat(path.join(pluginSdkDir, `${subpath}.js`)), { code: "ENOENT" });
  }
});

for (const extension of ["mjs", "ts", "cjs"]) {
  for (const rejected of [false, true]) {
    test(`mock ${extension} dynamic imports load in retained handlers and ${rejected ? "preserve rejection" : "respond successfully"}`, {
      skip: extension === "cjs" && !supportsCommonJsMocks,
    }, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-dynamic-handler-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(path.join(root, `index.${extension}`), [
        extension === "cjs"
          ? 'const { formatErrorMessage } = require("openclaw/plugin-sdk/error-runtime");'
          : 'import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";',
        "let registered = false;",
        `${extension === "cjs" ? "module.exports =" : "export default"} { register(api) {`,
        "  api.registerGatewayMethod('fixture.dynamic', async ({ respond }) => {",
        "    if (!registered) throw new Error('handler ran during registration');",
        '    const { readStringField: readField } = await import("openclaw/plugin-sdk/dynamic-destructure", {});',
        '    const sdk = await import(`openclaw/plugin-sdk/dynamic-namespace`,);',
        extension === "ts" ? '    type NamespaceType = typeof sdk.then;' : '',
        '    const quoted = "sdk.then";',
        '    // sdk.then();',
        '    const unrelated = { sdk: { then() {} } }; unrelated.sdk.then();',
        '    const direct = (await import("openclaw/plugin-sdk/dynamic-direct" /* trailing comment */))?.asOptionalRecord;',
        '    const callbackValue = await import("openclaw/plugin-sdk/dynamic-then").then(({ readStringField }) => readStringField({ value: "callback loaded" }, "value"));',
        '    const callbackRecord = await import("openclaw/plugin-sdk/dynamic-then-namespace")?.then(sdk => sdk.isRecord({}));',
        '    const template = `https://fixture.invalid ${`nested ${(await import("openclaw/plugin-sdk/dynamic-template")).readStringField({ value: "loaded" }, "value")}`}`;',
        "    const value = readField({ message: 'dynamic exports loaded' }, 'message');",
        "    if (value !== 'dynamic exports loaded' || !sdk.isRecord({}) || sdk.isRecord([]) || direct([]) !== undefined || !template.endsWith('nested loaded') || callbackValue !== 'callback loaded' || !callbackRecord) {",
        "      throw new Error('dynamic SDK exports missing');",
        "    }",
        rejected
          ? "    respond(false, undefined, { code: 'UNAVAILABLE', message: formatErrorMessage(new Error('fixture prerequisite missing')) });"
          : "    respond(true, { value });",
        "  });",
        "  registered = true;",
        "} };",
        'function shadowed(sdk) { sdk.then(); }',
      ].join("\n"));
      const result = await runEntrypointSyntheticProbes(`index.${extension}`, {
        cwd: root, pluginRoot: root, mockSdk: true,
      });
      assert.deepEqual(result.summary, {
        probeCount: 1, passCount: rejected ? 0 : 1, failCount: rejected ? 1 : 0, blockedCount: 0,
      });
      if (rejected) {
        assert.equal(result.results[0].error, "Gateway response error: fixture prerequisite missing");
      } else {
        assert.deepEqual(result.results[0].output, { type: "object", keys: ["id", "ok", "payload", "type"] });
      }
    });
  }
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

for (const extension of ["mjs", "cjs"]) {
  test(`mock ${extension} Gateway rejections preserve error-runtime messages`, {
    skip: extension === "cjs" && !supportsCommonJsMocks,
  }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-error-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, `index.${extension}`), [
      extension === "mjs"
        ? 'import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";'
        : "",
      `${extension === "cjs" ? "module.exports =" : "export default"} { register(api) {`,
      "  api.registerGatewayMethod('fixture.rejection', ({ respond }) => {",
      extension === "cjs"
        ? '    const { formatErrorMessage } = require("openclaw/plugin-sdk/error-runtime");'
        : "",
      "    const message = formatErrorMessage(new Error('fixture prerequisite missing'));",
      "    if (typeof message !== 'string') throw new Error('error formatter returned a non-string');",
      "    respond(false, undefined, { code: 'UNAVAILABLE', message });",
      "  });",
      "} };",
    ].join("\n"));

    const result = await runEntrypointSyntheticProbes(`index.${extension}`, {
      cwd: root, pluginRoot: root, mockSdk: true,
    });
    assert.deepEqual(result.summary, { probeCount: 1, passCount: 0, failCount: 1, blockedCount: 0 });
    assert.equal(result.results[0].error, "Gateway response error: fixture prerequisite missing");
  });
}

async function loadLazyRuntimeMock(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-lazy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { pluginSdkDir } = await createMockSdkPackage(root);
  return import(pathToFileURL(path.join(pluginSdkDir, "lazy-runtime.js")).href);
}

test("mock lazy runtime modules defer imports and reuse their promise until cleared", async (t) => {
  const { createLazyRuntimeModule } = await loadLazyRuntimeMock(t);
  const module = { value: "loaded" };
  let calls = 0;
  const load = createLazyRuntimeModule(async () => { calls += 1; return module; });
  assert.equal(calls, 0);
  assert.equal(load.peek(), undefined);
  const first = load();
  assert.equal(calls, 0);
  assert.equal(load(), first);
  assert.equal(load.peek(), first);
  assert.equal(await first, module);
  assert.equal(load(), first);
  assert.equal(calls, 1);
  load.clear();
  assert.equal(load.peek(), undefined);
  const next = load();
  assert.notEqual(next, first);
  assert.equal(await next, module);
  assert.equal(calls, 2);
});

for (const phase of ["import", "selection"]) {
  test(`mock lazy runtime caches ${phase} failures until cleared`, async (t) => {
    const { createLazyRuntimeSurface } = await loadLazyRuntimeMock(t);
    const failure = new Error("fixture runtime unavailable");
    let calls = 0;
    const load = createLazyRuntimeSurface(() => {
      calls += 1;
      if (phase === "import") throw failure;
      return Promise.resolve({});
    }, () => { throw failure; });
    const first = load();
    assert.equal(calls, 0);
    await assert.rejects(first, (error) => error === failure);
    assert.equal(load(), first);
    assert.equal(load.peek(), first);
    assert.equal(calls, 1);
    load.clear();
    const next = load();
    assert.notEqual(next, first);
    await assert.rejects(next, (error) => error === failure);
    assert.equal(calls, 2);
  });
}

for (const rejected of [false, true]) {
  test(`mock lazy runtime clear protects replacement from stale ${rejected ? "rejection" : "fulfillment"}`, async (t) => {
    const { createLazyRuntimeModule } = await loadLazyRuntimeMock(t);
    let settleOld;
    let resolveNew;
    const pending = [
      new Promise((resolve, reject) => { settleOld = rejected ? reject : resolve; }),
      new Promise((resolve) => { resolveNew = resolve; }),
    ];
    const load = createLazyRuntimeModule(() => pending.shift());
    const first = load();
    await Promise.resolve();
    const oldOutcome = rejected
      ? assert.rejects(first, /stale runtime/)
      : first.then((value) => assert.equal(value, "stale runtime"));
    load.clear();
    const next = load();
    assert.notEqual(next, first);
    settleOld(rejected ? new Error("stale runtime") : "stale runtime");
    await oldOutcome;
    assert.equal(load.peek(), next);
    assert.equal(load(), next);
    resolveNew("current runtime");
    assert.equal(await next, "current runtime");
    assert.equal(load(), next);
  });
}

test("mock lazy runtime named exports and method binders use the selected surface", async (t) => {
  const sdk = await loadLazyRuntimeMock(t);
  const module = { service: { offset: 7, add(a, b) { return this.offset + a + b; } } };
  let imports = 0;
  let selections = 0;
  const load = sdk.createLazyRuntimeSurface(async () => { imports += 1; return module; }, (value) => {
    selections += 1;
    return value.service;
  });
  const add = sdk.createLazyRuntimeMethod(load, (service) => service.add.bind(service));
  const bound = sdk.createLazyRuntimeMethodBinder(load)((service) => service.add.bind(service));
  assert.equal(imports, 0);
  assert.equal(await add(1, 2), 10);
  assert.equal(await bound(3, 4), 14);
  assert.equal(imports, 1);
  assert.equal(selections, 1);
  const named = sdk.createLazyRuntimeNamedExport(async () => module, "service");
  const first = named();
  assert.equal(named(), first);
  assert.equal(await first, module.service);
});

for (const extension of ["mjs", "cjs"]) {
  for (const rejected of [false, true]) {
    test(`mock ${extension} Gateway lazy runtime ${rejected ? "rejection remains failed" : "loads after registration"}`, {
      skip: extension === "cjs" && !supportsCommonJsMocks,
    }, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-lazy-gateway-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(path.join(root, "runtime.mjs"), [
        'import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";',
        'export const value = formatErrorMessage(new Error("fixture runtime value"));',
      ].join("\n"));
      await writeFile(path.join(root, `index.${extension}`), [
        extension === "mjs" ? 'import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";' : "",
        extension === "mjs" ? 'import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";' : "",
        "let registered = false;",
        "async function importRuntime() {",
        "  if (!registered) throw new Error('runtime loaded during registration');",
        rejected ? "  throw new Error('fixture runtime unavailable');" : "  return import('./runtime.mjs');",
        "}",
        extension === "mjs" ? "const load = createLazyRuntimeModule(importRuntime);" : "let load;",
        `${extension === "cjs" ? "module.exports =" : "export default"} { register(api) {`,
        "  if (load?.peek() !== undefined) throw new Error('runtime load started before handler');",
        "  api.registerGatewayMethod('fixture.lazy', async ({ respond }) => {",
        extension === "cjs" ? '    const { createLazyRuntimeModule } = require("openclaw/plugin-sdk/lazy-runtime");' : "",
        extension === "cjs" ? '    const { formatErrorMessage } = require("openclaw/plugin-sdk/error-runtime");' : "",
        extension === "cjs" ? "    load ??= createLazyRuntimeModule(importRuntime);" : "",
        "    try {",
        "      const first = load();",
        "      if (load() !== first || load.peek() !== first) throw new Error('runtime promise was not reused');",
        "      const runtime = await first;",
        "      if (runtime.value !== 'fixture runtime value') throw new Error('runtime SDK import was not preserved');",
        "      respond(true, { value: runtime.value });",
        "    } catch (error) {",
        "      respond(false, undefined, { code: 'UNAVAILABLE', message: formatErrorMessage(error) });",
        "    }",
        "  });",
        "  registered = true;",
        "} };",
      ].join("\n"));
      const result = await runEntrypointSyntheticProbes(`index.${extension}`, {
        cwd: root, pluginRoot: root, mockSdk: true,
      });
      assert.deepEqual(result.summary, {
        probeCount: 1, passCount: rejected ? 0 : 1, failCount: rejected ? 1 : 0, blockedCount: 0,
      });
      if (rejected) {
        assert.equal(result.results[0].error, "Gateway response error: fixture runtime unavailable");
      }
    });
  }
}

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

test("mock SDK preserves string and record coercion contracts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-mock-"));
  const pluginRoot = path.join(rootDir, "plugin");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "index.js"),
    [
      'import { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";',
      "export { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField, normalizeOptionalString };",
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
  for (const value of [undefined, null, false, 0, {}, [], "", "  \t\n"]) {
    assert.equal(mockModule.normalizeOptionalString(value), undefined);
  }
  assert.equal(mockModule.normalizeOptionalString("  fixture-value  "), "fixture-value");
});
