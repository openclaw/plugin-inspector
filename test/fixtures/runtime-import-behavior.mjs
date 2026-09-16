import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const childMode = process.argv[2] === "--child";
const target = childMode ? process.argv[3] : (process.argv[2] || process.env.PLUGIN_INSPECTOR_SDK_MODULE);
const deadlineMs = 60_000;

function safeMessage(error, workspace) {
  let value = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  for (const [sensitive, label] of [[target, "<target>"], [workspace, "<fixture>"]]) {
    if (sensitive) value = value.split(sensitive).join(label);
  }
  return value.replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s'"\n)]+/g, "<private-path>");
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: exceeded 10 seconds`)), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function generatedPaths(root) {
  const paths = [];
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      paths.push(relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
    }
  }
  await walk(root);
  return paths;
}

async function runChild(workspace) {
  const pluginRoot = path.join(workspace, "fixture-plugin");
  await mkdir(pluginRoot, { recursive: true });
  const fixtures = {
    "package.json": JSON.stringify({ name: "independent-behavior-fixture", private: true, type: "module" }),
    "alias.mjs": `export default { register(api) {
      api.registerTool({ name: "harbor_alias", async execute(payload) {
        const { readStringField: fetchHarbor, isRecord: looksLikeParcel, asOptionalRecord: maybeParcel } = await import("openclaw/plugin-sdk/probe-harbor-alias");
        return { value: looksLikeParcel(payload) ? fetchHarbor(payload, "harbor") : undefined, record: looksLikeParcel(payload), optional: maybeParcel(payload) };
      } });
    } };`,
    "namespace.mjs": `export default { register(api) {
      api.registerTool({ name: "copper_namespace", async execute(payload) {
        const copperTools = await import("openclaw/plugin-sdk/probe-copper-namespace");
        return { value: copperTools.isRecord(payload) ? copperTools.readStringField(payload, "copper") : undefined, record: copperTools.isRecord(payload), optional: copperTools.asOptionalRecord(payload) };
      } });
    } };`,
    "members.mjs": `export default { register(api) {
      api.registerTool({ name: "violet_members", async execute(payload) {
        return [
          (await import("openclaw/plugin-sdk/probe-violet-parenthesized")).readStringField(payload, "violet"),
          (await import("openclaw/plugin-sdk/probe-violet-optional"))?.readStringField(payload, "violet"),
        ];
      } });
    } };`,
    "templates.mjs": 'export default { register(api) {\n' +
      '  api.registerTool({ name: "fern_template", async execute(payload) {\n' +
      '    return `outer[${`inner[${(await import("openclaw/plugin-sdk/probe-fern-template")).readStringField(payload, "fern")}]`}]`;\n' +
      '  } });\n' +
      '} };',
    "typed.ts": `type Parcel = { quartz?: unknown };
      export default { register(api: { registerTool(tool: unknown): void }) {
        api.registerTool({ name: "quartz_annotation", async execute(payload: Parcel) {
          const quartzTools: typeof import("openclaw/plugin-sdk/probe-quartz-annotation") = await import("openclaw/plugin-sdk/probe-quartz-annotation");
          return { value: quartzTools.readStringField(payload, "quartz"), record: quartzTools.isRecord(payload), optional: quartzTools.asOptionalRecord(payload) };
        } });
      } };`,
    "common.cjs": `module.exports = { register(api) {
      const delayedSibling = require("./sibling.cjs");
      api.registerTool({ name: "birch_commonjs", execute: delayedSibling });
    } };`,
    "sibling.cjs": `module.exports = async function delayedSibling(payload) {
      const { readStringField: getBirch, isRecord: parcelCheck } = require("openclaw/plugin-sdk/probe-birch-require");
      const spruceTools = await import("openclaw/plugin-sdk/probe-spruce-cjs-import");
      return { required: getBirch(payload, "birch"), imported: spruceTools.readStringField(payload, "spruce"), record: parcelCheck(payload), optional: spruceTools.asOptionalRecord(payload) };
    };`,
    "discovery.ts": 'import type { InkOnly } from "openclaw/plugin-sdk/probe-ink-type-only";\n' +
      'type MarbleOnly = typeof import("openclaw/plugin-sdk/probe-marble-type-query");\n' +
      'type JadeOnly = import("openclaw/plugin-sdk/probe-jade-import-type").JadeOnly;\n' +
      '// await import("openclaw/plugin-sdk/probe-sand-comment-only")\n' +
      'const quotedImport = "await import(\\\"openclaw/plugin-sdk/probe-rain-string-only\\\")";\n' +
      'const lichenTools = { unrelatedPrairieExport: "outer" };\n' +
      'const unrelatedValue = lichenTools.unrelatedPrairieExport;\n' +
      'export default { register(api: { registerTool(tool: unknown): void }) {\n' +
      '  api.registerTool({ name: "lichen_discovery", async execute(payload: Record<string, unknown>) {\n' +
      '    const lichenTools = await import("openclaw/plugin-sdk/probe-lichen-scope");\n' +
      '    const lagoonTools = await import("openclaw/plugin-sdk/probe-lagoon-scope");\n' +
      '    function shadow(lichenTools: { parameterCanyonExport: string }) { return lichenTools.parameterCanyonExport; }\n' +
      '    function secondShadow(lagoonTools: { parameterMeadowExport: string }) { return lagoonTools.parameterMeadowExport; }\n' +
      '    { const lichenTools = { blockSummitExport: "inside" }; void lichenTools.blockSummitExport; }\n' +
      '    const ignoredQuote = "lichenTools.quotedWillowExport";\n' +
      '    const ignoredRegex = /lagoonTools.regexDuneExport/;\n' +
      '    const ignoredTemplate = `lichenTools.templateMistExport ${payload.lichen}`;\n' +
      '    /* lagoonTools.commentOrchidExport */\n' +
      '    return { value: lichenTools.readStringField(payload, "lichen"), alternate: lagoonTools.readStringField(payload, "lagoon"), keys: Object.keys(lichenTools), alternateKeys: Object.keys(lagoonTools), shadow: shadow({parameterCanyonExport: "canyon"}), secondShadow: secondShadow({parameterMeadowExport: "meadow"}), outer: unrelatedValue };\n' +
      '  } });\n' +
      '} };',
    "outcomes.mjs": `export default { register(api) {
      api.registerTool({ name: "ember_outcomes", async execute(payload) {
        const { readStringField: readEmber } = await import("openclaw/plugin-sdk/probe-ember-outcomes");
        const message = readEmber(payload, "ember");
        if (payload.mode === "false") return false;
        if (payload.mode === "throw") throw new Error(message);
        if (payload.mode === "reject") return Promise.reject(new Error(message));
        if (payload.mode === "raw-reject") return Promise.reject(message);
        return { ok: true, message };
      } });
    } };`,
  };
  for (const [format, extension, bindings] of [
    ["esm", "mjs", ["irisOptions", "poppyComma", "asterComment"]],
    ["cjs", "cjs", ["mapleOptions", "juniperComma", "balsaComment"]],
  ]) {
    const branches = ["options", "comma", "comment"].map((tail, index) => {
      const binding = bindings[index];
      const specifier = `openclaw/plugin-sdk/probe-${format}-${tail}-tail`;
      const suffix = tail === "options" ? ", {}" : tail === "comma" ? "," : ` /* ${binding}.commentTailPhantomExport */`;
      return `if (tail === "${tail}") {
        const ${binding} = await import("${specifier}"${suffix});
        const ignoredQuote = "${binding}.quotedTailPhantomExport";
        /* ${binding}.commentTailPhantomExport */
        const record = ${binding}.isRecord(payload);
        return { value: record ? ${binding}.readStringField(payload, "${format}_${tail}") : undefined, record, optional: ${binding}.asOptionalRecord(payload), keys: Object.keys(${binding}) };
      }`;
    });
    fixtures[`tails.${extension}`] = `${format === "esm" ? "export default" : "module.exports ="} { register(api) {
      api.registerTool({ name: "${format}_literal_tails", async execute({tail, payload}) {
        ${branches.join("\n")}
        throw new Error("unrecognized fixture tail");
      } });
    } };`;
  }
  for (const [name, contents] of Object.entries(fixtures)) {
    await writeFile(path.join(pluginRoot, name), contents, { flag: "wx" });
  }

  let stopLoader;
  const statuses = [];
  async function contract(name, action) {
    try {
      const observations = await bounded(action(), name);
      statuses.push({ contract: name, status: "pass", ...observations });
    } catch (error) {
      statuses.push({ contract: name, status: "fail", evidence: safeMessage(error, workspace) });
    }
    emit(statuses.at(-1));
  }
  try {
    const { createMockSdkPackage, installMockSdkLoader } = await import(pathToFileURL(path.resolve(target)).href);
    assert.equal(typeof createMockSdkPackage, "function");
    assert.equal(typeof installMockSdkLoader, "function");
    const mock = await bounded(createMockSdkPackage(workspace, { pluginRoot }), "mock generation");
    const artifacts = await generatedPaths(mock.pluginSdkDir);
    stopLoader = await bounded(installMockSdkLoader(mock), "loader installation");
    assert.equal(typeof stopLoader, "function");
    async function retainedCallback(file) {
      const fixture = await import(pathToFileURL(path.join(pluginRoot, file)).href);
      const callbacks = [];
      let registering = true;
      fixture.default.register({ registerTool(tool) {
        assert.equal(typeof tool.execute, "function");
        callbacks.push((payload) => { assert.equal(registering, false); return tool.execute(payload); });
      } });
      registering = false;
      assert.equal(callbacks.length, 1);
      return callbacks[0];
    }
    await contract("R1.alias-and-awaited-namespace", async () => {
      let calls = 0;
      for (const [file, field] of [["alias.mjs", "harbor"], ["namespace.mjs", "copper"]]) {
        const callback = await retainedCallback(file);
        for (const payload of [{ [field]: "tide-47", other: "ignored" }, { [field]: "amber-902" }, { [field]: 27 }, {}, null, ["array-is-not-a-record"]]) {
          const actual = await callback(payload);
          const record = payload !== null && typeof payload === "object" && !Array.isArray(payload);
          assert.equal(actual.record, record);
          assert.equal(actual.value, record && typeof payload[field] === "string" ? payload[field] : undefined);
          assert.strictEqual(actual.optional, record ? payload : undefined);
          calls++;
        }
      }
      return { calls, observed: "distinct strings, absent/nonstring fields, null, array, record identity" };
    });
    await contract("R1.members-templates-typescript", async () => {
      const members = await retainedCallback("members.mjs");
      const templates = await retainedCallback("templates.mjs");
      const typed = await retainedCallback("typed.ts");
      for (const value of ["violet-31", "fern-688", "quartz-2049"]) {
        assert.deepEqual(await members({ violet: value }), [value, value]);
        assert.equal(await templates({ fern: value }), `outer[inner[${value}]]`);
        const payload = { quartz: value };
        const actual = await typed(payload);
        assert.equal(actual.value, value);
        assert.equal(actual.record, true);
        assert.strictEqual(actual.optional, payload);
      }
      assert.deepEqual(await members({ violet: 24 }), [undefined, undefined]);
      const missingTyped = await typed({});
      assert.equal(missingTyped.value, undefined);
      return { calls: 11, observed: "parenthesized and optional imports, nested templates, erasable namespace annotation" };
    });
    await contract("R2.commonjs-require-and-dynamic-import", async () => {
      const callback = await retainedCallback("common.cjs");
      for (const payload of [{ birch: "branch-86", spruce: "needle-43" }, { birch: "branch-217", spruce: "needle-509" }, { birch: false, spruce: 18 }]) {
        const actual = await callback(payload);
        assert.equal(actual.required, typeof payload.birch === "string" ? payload.birch : undefined);
        assert.equal(actual.imported, typeof payload.spruce === "string" ? payload.spruce : undefined);
        assert.equal(actual.record, true);
        assert.strictEqual(actual.optional, payload);
      }
      return { calls: 3, observed: "sibling require plus delayed require/import after registration" };
    });
    await contract("R3.non-runtime-and-shadowed-bindings", async () => {
      const callback = await retainedCallback("discovery.ts");
      const forbiddenExports = ["unrelatedPrairieExport", "parameterCanyonExport", "parameterMeadowExport", "blockSummitExport", "quotedWillowExport", "regexDuneExport", "templateMistExport", "commentOrchidExport"];
      for (const payload of [{ lichen: "green-733", lagoon: "blue-419" }, { lichen: "green-108", lagoon: "blue-652" }]) {
        const actual = await callback(payload);
        assert.equal(actual.value, payload.lichen);
        assert.equal(actual.alternate, payload.lagoon);
        assert.equal(actual.shadow, "canyon");
        assert.equal(actual.secondShadow, "meadow");
        assert.equal(actual.outer, "outer");
        for (const name of forbiddenExports) {
          assert.equal(actual.keys.includes(name), false, `invented export ${name} in lichen namespace`);
          assert.equal(actual.alternateKeys.includes(name), false, `invented export ${name} in lagoon namespace`);
        }
      }
      for (const name of ["probe-sand-comment-only", "probe-rain-string-only"]) {
        assert.equal(artifacts.some(relative => relative.includes(name)), false, `generated module from non-runtime text: ${name}`);
      }
      return { calls: 2, excludedExports: forbiddenExports.length, observed: "two binding names, outer/parameter/block shadows, quote/regex/template/comment text" };
    });
    await contract("R4.false-rejection-and-errors", async () => {
      const callback = await retainedCallback("outcomes.mjs");
      for (const message of ["ember refused the violet parcel 173", "cedar lookup rejected at checkpoint 928"]) {
        assert.equal(await callback({ mode: "false", ember: message }), false);
        for (const mode of ["throw", "reject"]) {
          let rejected = false;
          try { await callback({ mode, ember: message }); }
          catch (error) { rejected = true; assert.ok(error instanceof Error); assert.equal(error.message, message); }
          assert.equal(rejected, true, `${mode} was converted to success`);
        }
        let rawRejected = false;
        try { await callback({ mode: "raw-reject", ember: message }); }
        catch (error) { rawRejected = true; assert.strictEqual(error, message); }
        assert.equal(rawRejected, true, "raw rejection was converted to success");
        assert.deepEqual(await callback({ mode: "success", ember: message }), { ok: true, message });
      }
      return { calls: 10, observed: "false retained; thrown/rejected Errors and raw rejections retain two exact messages; success remains success" };
    });
    for (const [format, file] of [["esm", "tails.mjs"], ["cjs", "tails.cjs"]]) {
      for (const tail of ["options", "comma", "comment"]) {
        await contract(`R6.${format}-${tail}`, async () => {
          const callback = await retainedCallback(file);
          const field = `${format}_${tail}`;
          const payloads = [{ [field]: "petal-563", other: "unused" }, { [field]: "canopy-812" }, { [field]: 41 }, {}, null, ["not-a-parcel"]];
          for (const payload of payloads) {
            const actual = await callback({ tail, payload });
            const record = payload !== null && typeof payload === "object" && !Array.isArray(payload);
            assert.equal(actual.value, record && typeof payload[field] === "string" ? payload[field] : undefined);
            assert.equal(actual.record, record);
            assert.strictEqual(actual.optional, record ? payload : undefined);
            for (const unknown of ["quotedTailPhantomExport", "commentTailPhantomExport"]) {
              assert.equal(actual.keys.includes(unknown), false, `invented export ${unknown} for ${format} ${tail}`);
            }
          }
          return { calls: payloads.length, excludedExports: 2, observed: `${format} literal dynamic import with ${tail} tail; varied strings, absent/nonstring fields, null, array, record identity` };
        });
      }
    }
    await contract("R5.type-only-produces-no-runtime-module", async () => {
      for (const name of ["probe-ink-type-only", "probe-marble-type-query", "probe-jade-import-type"]) {
        assert.equal(artifacts.some(relative => relative.includes(name)), false, `generated module from erased type declaration: ${name}`);
      }
      return { declarations: 3, observed: "import type, typeof import, and import type query erased without generated modules" };
    });
  } catch (error) {
    statuses.push({ contract: "setup", status: "blocked", evidence: safeMessage(error, workspace) });
    emit(statuses.at(-1));
  } finally {
    if (stopLoader) {
      try { stopLoader(); }
      catch (error) { statuses.push({ contract: "teardown", status: "fail", evidence: safeMessage(error, workspace) }); emit(statuses.at(-1)); }
    }
    await rm(pluginRoot, { recursive: true, force: true });
  }
  const passed = statuses.filter(entry => entry.status === "pass").length;
  const failed = statuses.filter(entry => entry.status === "fail").length;
  const blocked = statuses.filter(entry => entry.status === "blocked").length;
  emit({ summary: { passed, failed, blocked, outOfScope: ["malformed or unsupported TypeScript", "public CLI and counters", "npm/release packaging"] } });
  process.exitCode = failed || blocked || passed !== 12 ? 1 : 0;
}

if (!target) {
  process.stderr.write("usage: node plugin-inspector-behavior-probe.mjs <sdk-mock-module-path>\n");
  process.exitCode = 2;
} else if (childMode) {
  await runChild(process.argv[4]);
} else {
  const workspace = await mkdtemp(path.join(tmpdir(), "plugin-inspector-behavior-"));
  const probeHash = createHash("sha256").update(await readFile(self)).digest("hex");
  emit({ probe: "independent-plugin-inspector-module-behavior", sha256: probeHash, node: process.version, timeoutMs: deadlineMs });
  try {
    const child = spawnSync(process.execPath, [self, "--child", path.resolve(target), workspace], { encoding: "utf8", timeout: deadlineMs, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    if (child.stdout) process.stdout.write(safeMessage(child.stdout, workspace));
    if (child.stderr) process.stderr.write(safeMessage(child.stderr, workspace));
    if (child.error || child.signal) {
      emit({ contract: "bounded-execution", status: "fail", evidence: child.error?.code === "ETIMEDOUT" ? `owned probe child exceeded ${deadlineMs}ms` : safeMessage(child.error || child.signal, workspace) });
    }
    process.exitCode = child.status === 0 && !child.error && !child.signal ? 0 : 1;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
