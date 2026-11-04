import { createTempDir } from "./helpers/temp-dir.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const syntheticCli = path.resolve("src/synthetic-probes-cli.js");

async function syntheticFixture(t, source) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-cli-"));
  t.after(async () => {
    const pid = Number(await readFile(path.join(dir, "pid"), "utf8").catch(() => ""));
    if (pid > 0 && pid !== process.pid) {
      try { process.kill(pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, "index.mjs"), `
    import { writeFileSync } from "node:fs";
    writeFileSync(new URL("./pid", import.meta.url), String(process.pid));
    ${source}
  `);
  return dir;
}

function invokeSynthetic(dir, flags = [], env = {}) {
  return execFileAsync(process.execPath, [syntheticCli, "--entrypoint", "index.mjs", ...flags], {
    cwd: dir,
    env: {
      ...process.env,
      PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1",
      PLUGIN_INSPECTOR_PROBE_TIMEOUT_MS: "1000",
      PLUGIN_INSPECTOR_PROBE_KILL_GRACE_MS: "75",
      ...env,
    },
    timeout: 5000,
    killSignal: "SIGKILL",
    maxBuffer: 12 * 1024 * 1024,
  });
}

async function assertSyntheticChildGone(dir) {
  const pid = Number(await readFile(path.join(dir, "pid"), "utf8"));
  const exists = () => {
    try { process.kill(pid, 0); return true; } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  for (let i = 0; i < 100 && exists(); i += 1) await delay(10);
  assert.equal(exists(), false, `synthetic child ${pid} survived completion`);
}

for (const sdk of ["--mock-sdk", "--real-sdk"]) {
  for (const [name, body] of [
    ["busy callback", "while (true) {}"],
    ["pending callback with interval", "return new Promise(() => { setInterval(() => {}, 1000); });"],
  ]) {
    test(`synthetic CLI ${sdk} bounds a ${name}`, { timeout: 8000 }, async (t) => {
      const dir = await syntheticFixture(t, `
        export function register(api) {
          api.on("before_tool_call", () => { ${body} });
        }
      `);
      const output = path.join(dir, "result.json");
      await assert.rejects(invokeSynthetic(dir, [sdk, "--output", output]), (error) => {
        assert.equal(error.killed, false, "the inspector must finish before the test watchdog");
        assert.equal(error.code, 1);
        assert.match(error.stderr, /timed out/);
        return true;
      });
      await assert.rejects(readFile(output), { code: "ENOENT" });
      await assertSyntheticChildGone(dir);
    });
  }

  test(`synthetic CLI ${sdk} separates plugin output and flushes healthy JSON`, { timeout: 8000 }, async (t) => {
    const dir = await syntheticFixture(t, `
      export function register(api) {
        console.log("registration-log");
        api.on("before_tool_call", () => {
          console.log("probe-log");
          process.stdout.write("x".repeat(300000));
          process.stderr.write("probe-stderr");
          setInterval(() => {}, 1000);
          return "r".repeat(9 * 1024 * 1024);
        });
      }
    `);
    const { stdout } = await invokeSynthetic(dir, [sdk]);
    const result = JSON.parse(stdout);
    assert.equal(result.summary.passCount, 1);
    assert.equal(result.results[0].output.value, "r".repeat(9 * 1024 * 1024));
    assert.equal(result.processOutput.stdout, `registration-log\nprobe-log\n${"x".repeat(300000)}`);
    assert.equal(result.processOutput.stderr, "probe-stderr");
    await assertSyntheticChildGone(dir);
  });
}

test("synthetic CLI retains completed reports with failed probe rows", { timeout: 8000 }, async (t) => {
  const dir = await syntheticFixture(t, `
    export function register(api) {
      api.on("before_tool_call", () => { throw new Error("fixture-probe-failure"); });
      api.registerCommand({ name: "healthy", handler() { return "healthy"; } });
    }
  `);
  const output = path.join(dir, "result.json");
  await invokeSynthetic(dir, ["--output", output]);
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.summary.failCount, 1);
  assert.equal(result.summary.passCount, 1);
  assert.equal(result.results[0].error, "fixture-probe-failure");
  await assertSyntheticChildGone(dir);
});

for (const [name, source, status, blockedCount] of [
  ["empty registration", "export function register() {}", "captured", 0],
  ["no register export", "export const value = true;", "no-register-export", 0],
  ["blocked lifecycle", "export function register(api) { api.registerService({ name: 'fixture', start() {} }); }", "captured", 1],
]) {
  test(`synthetic CLI preserves a valid ${name} report`, { timeout: 8000 }, async (t) => {
    const dir = await syntheticFixture(t, source);
    const { stdout } = await invokeSynthetic(dir);
    const report = JSON.parse(stdout);
    assert.equal(report.status, status);
    assert.deepEqual(report.summary, {
      probeCount: blockedCount, passCount: 0, failCount: 0, blockedCount,
    });
    assert.equal(report.results.length, blockedCount);
    if (blockedCount) assert.equal(typeof report.results[0].reason, "string");
    await assertSyntheticChildGone(dir);
  });
}

test("synthetic CLI preserves repeated capture indices for lifecycle rows", { timeout: 8000 }, async (t) => {
  const dir = await syntheticFixture(t, `
    export function register(api) {
      api.registerService({ name: "fixture", start() { return "started"; }, stop() { return "stopped"; } });
    }
  `);
  const { stdout } = await invokeSynthetic(dir, ["--include-lifecycle"]);
  const report = JSON.parse(stdout);
  assert.deepEqual(report.results.map((row) => row.captureIndex), [0, 0]);
  assert.deepEqual(report.results.map((row) => row.status), ["pass", "pass"]);
  assert.deepEqual(report.summary, { probeCount: 2, passCount: 2, failCount: 0, blockedCount: 0 });
  await assertSyntheticChildGone(dir);
});

test("synthetic CLI cancellation stops its callback child", { timeout: 8000, skip: process.platform === "win32" }, async (t) => {
  const dir = await syntheticFixture(t, `
    export function register(api) {
      api.on("before_tool_call", () => new Promise(() => { setInterval(() => {}, 1000); }));
    }
  `);
  const pending = invokeSynthetic(dir, [], { PLUGIN_INSPECTOR_PROBE_TIMEOUT_MS: "4000" });
  const rejected = assert.rejects(pending, (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.signal, null);
    assert.match(error.stderr, /cancelled/);
    return true;
  });
  let pid;
  for (let i = 0; i < 200 && !pid; i += 1) {
    pid = Number(await readFile(path.join(dir, "pid"), "utf8").catch(() => ""));
    if (!pid) await delay(10);
  }
  assert.ok(pid > 0, "plugin import must start before cancellation");
  pending.child.kill("SIGTERM");
  await rejected;
  await assertSyntheticChildGone(dir);
});

test("synthetic CLI bounds direct output floods without accepting partial JSON", { timeout: 8000 }, async (t) => {
  const dir = await syntheticFixture(t, `
    import { writeSync } from "node:fs";
    export function register(api) {
      api.on("before_tool_call", () => {
        const chunk = Buffer.alloc(65536, "x");
        while (true) { writeSync(1, chunk); writeSync(2, chunk); }
      });
    }
  `);
  await assert.rejects(invokeSynthetic(dir, [], { PLUGIN_INSPECTOR_PROBE_MAX_OUTPUT_BYTES: "4096" }), (error) => {
    assert.equal(error.killed, false);
    assert.equal(error.code, 1);
    assert.ok(Buffer.byteLength(error.stdout) <= 4096);
    assert.ok(Buffer.byteLength(error.stderr) < 5000);
    return true;
  });
  await assertSyntheticChildGone(dir);
});

test("synthetic CLI rejects oversized reports without writing success artifacts", { timeout: 8000 }, async (t) => {
  const dir = await syntheticFixture(t, `
    export function register(api) { api.on("before_tool_call", () => "x".repeat(100000)); }
  `);
  const output = path.join(dir, "result.json");
  await assert.rejects(invokeSynthetic(dir, ["--output", output], {
    PLUGIN_INSPECTOR_PROBE_MAX_OUTPUT_BYTES: "4096",
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.killed, false);
    assert.match(error.stderr, /byte limit|exceeded/);
    return true;
  });
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

const emptySyntheticReport = {
  entrypoint: "index.mjs",
  status: "captured",
  summary: { probeCount: 0, passCount: 0, failCount: 0, blockedCount: 0 },
  results: [],
};
const passedSyntheticRow = {
  captureIndex: 0, kind: "hook", seam: "before_tool_call", label: "before_tool_call", status: "pass",
};
const malformedReports = [
  ["null", null],
  ["string", "report"],
  ["number", 1],
  ["boolean", true],
  ["array", []],
  ["missing shape", {}],
  ["missing entrypoint", { ...emptySyntheticReport, entrypoint: undefined }],
  ["unknown producer status", { ...emptySyntheticReport, status: "finished" }],
  ["null summary", { ...emptySyntheticReport, summary: null }],
  ["array summary", { ...emptySyntheticReport, summary: [] }],
  ["missing results", { ...emptySyntheticReport, results: undefined }],
  ["object results", { ...emptySyntheticReport, results: {} }],
  ...[
    ["null row", null],
    ["array row", []],
    ["missing row fields", { status: "pass" }],
    ["invalid capture index", { ...passedSyntheticRow, captureIndex: -1 }],
    ...["kind", "seam", "label"].map((key) => [`invalid row ${key}`, { ...passedSyntheticRow, [key]: null }]),
    ["unknown row status", { ...passedSyntheticRow, status: "unknown" }],
    ["missing failure error", { ...passedSyntheticRow, status: "fail" }],
    ["nonstring failure error", { ...passedSyntheticRow, status: "fail", error: {} }],
    ["missing blocked reason", { ...passedSyntheticRow, status: "blocked" }],
    ["nonstring blocked reason", { ...passedSyntheticRow, status: "blocked", reason: [] }],
  ].map(([name, row]) => [name, {
    ...emptySyntheticReport,
    summary: {
      probeCount: 1,
      passCount: row?.status === "fail" || row?.status === "blocked" ? 0 : 1,
      failCount: row?.status === "fail" ? 1 : 0,
      blockedCount: row?.status === "blocked" ? 1 : 0,
    },
    results: [row],
  }]),
  ...Object.keys(emptySyntheticReport.summary).flatMap((key) => [
    ["missing", undefined], ["negative", -1], ["fractional", 0.5], ["string", "0"],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["null", null], ["inconsistent", 1],
  ].map(([name, value]) => [`${name} ${key}`, {
    ...emptySyntheticReport, summary: { ...emptySyntheticReport.summary, [key]: value },
  }])),
];

for (const [name, source, expected] of [
  ["FIFO", 'execFileSync("mkfifo", [outputPath]);', /regular.*file/],
  ["oversized file", 'writeFileSync(outputPath, JSON.stringify({ status: "captured", results: [], data: "x".repeat(100000) }));', /byte limit/],
  ...malformedReports.map(([name, report]) => [
    name, `writeFileSync(outputPath, ${JSON.stringify(JSON.stringify(report))});`, /Invalid synthetic probe report/,
  ]),
]) {
  test(`synthetic CLI rejects a ${name} report bypass`, {
    timeout: 8000, skip: name === "FIFO" && process.platform === "win32",
  }, async (t) => {
    const dir = await syntheticFixture(t, `
      import { execFileSync } from "node:child_process";
      export function register() {
        const { outputPath } = JSON.parse(process.argv[2]);
        ${source}
        process.exit(0);
      }
    `);
    const output = path.join(dir, "result.json");
    await assert.rejects(invokeSynthetic(dir, ["--real-sdk", "--output", output], {
      PLUGIN_INSPECTOR_PROBE_MAX_OUTPUT_BYTES: "4096",
    }), (error) => {
      assert.equal(error.killed, false, "artifact reading must not outlive the inspector budget");
      assert.equal(error.code, 1);
      assert.match(error.stderr, expected);
      return true;
    });
    await assert.rejects(readFile(output), { code: "ENOENT" });
    await assertSyntheticChildGone(dir);
  });
}

test("capture and synthetic helper CLIs default to the mocked SDK", async (t) => {
  const rootDir = await createTempDir(t, "plugin-inspector-helper-cli-");
  await mkdir(path.join(rootDir, "src"), { recursive: true });

  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "fixture", type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "export default definePluginEntry((api) => api.registerTool({",
      '  name: "fixture-tool",',
      '  description: "fixture",',
      '  run: async () => ({ ok: true }),',
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );

  const captureCli = path.resolve("src/capture-cli.js");
  const syntheticCli = path.resolve("src/synthetic-probes-cli.js");
  const captureOut = path.join(rootDir, "capture.json");
  const syntheticOut = path.join(rootDir, "synthetic.json");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await execFileAsync(process.execPath, [captureCli, "./src/index.js", "--output", captureOut], {
    cwd: rootDir,
    env,
  });
  await execFileAsync(process.execPath, [syntheticCli, "--entrypoint", "./src/index.js", "--output", syntheticOut], {
    cwd: rootDir,
    env,
  });

  const capture = JSON.parse(await readFile(captureOut, "utf8"));
  const synthetic = JSON.parse(await readFile(syntheticOut, "utf8"));

  assert.equal(capture.status, "captured");
  assert.ok(capture.captured.some((item) => item.kind === "registration" && item.name === "registerTool"));
  assert.equal(synthetic.status, "captured");
  assert.equal(synthetic.summary.failCount, 0);
  assert.equal(synthetic.summary.blockedCount, 0);
  assert.ok(synthetic.summary.passCount >= 1);
});

test("capture CLIs ignore values consumed by flags when finding entrypoint", async (t) => {
  const rootDir = await createTempDir(t, "plugin-inspector-capture-cli-args-");
  await mkdir(path.join(rootDir, "src"), { recursive: true });

  const pluginSource = [
    'import { definePluginEntry } from "openclaw/plugin-sdk";',
    "export default definePluginEntry((api) => api.registerTool({",
    '  name: "fixture-tool",',
    '  description: "fixture",',
    '  run: async () => ({ ok: true }),',
    "}));",
    "",
  ].join("\n");
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "fixture", type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(rootDir, "src", "index.js"), pluginSource, "utf8");

  const captureCli = path.resolve("src/capture-cli.js");
  const mainCli = path.resolve("src/cli.js");
  const helperOut = path.join(rootDir, "helper-capture.json");
  const mainOut = path.join(rootDir, "main-capture.json");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await execFileAsync(process.execPath, [captureCli, "--output", helperOut, "--plugin-root", rootDir, "./src/index.js"], {
    cwd: rootDir,
    env,
  });
  await execFileAsync(
    process.execPath,
    [mainCli, "capture", "--output", mainOut, "--plugin-root", rootDir, "--mock-sdk", "--allow-execute", "./src/index.js"],
    {
      cwd: rootDir,
      env,
    },
  );

  assert.equal(JSON.parse(await readFile(helperOut, "utf8")).status, "captured");
  assert.equal(JSON.parse(await readFile(mainOut, "utf8")).status, "captured");
});

test("capture CLI does not overwrite an output path when positional entrypoint is missing", async (t) => {
  const rootDir = await createTempDir(t, "plugin-inspector-capture-cli-missing-");
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  const entrypointPath = path.join(rootDir, "src", "index.js");
  const originalSource = "export const untouched = true;\n";
  await writeFile(entrypointPath, originalSource, "utf8");

  const captureCli = path.resolve("src/capture-cli.js");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await assert.rejects(
    execFileAsync(process.execPath, [captureCli, "--output", "./src/index.js"], {
      cwd: rootDir,
      env,
    }),
    /capture requires an entrypoint path/,
  );
  assert.equal(await readFile(entrypointPath, "utf8"), originalSource);
});
