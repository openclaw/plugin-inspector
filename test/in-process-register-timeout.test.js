import { assertGone as assertProcessGone } from "./helpers/process-liveness.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { capturePluginEntrypoint } from "../src/index.js";

const assertGone = (pid) => assertProcessGone(pid, `capture process ${pid} survived completion`);

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("src/cli.js");
const captureCliPath = path.resolve("src/capture-cli.js");
const cliRoutes = [
  { name: "capture", args: [cliPath, "capture", "index.mjs", "--real-sdk", "--allow-execute"] },
  { name: "capture-cli", args: [captureCliPath, "index.mjs", "--real-sdk"] },
  { name: "check", args: [cliPath, "check", "--runtime", "--real-sdk", "--allow-execute", "--no-openclaw", "--json"], report: true },
  { name: "config-driven check", args: [cliPath, "check", "--allow-execute", "--no-openclaw", "--json"], report: true },
];

async function fixture(t, source) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-real-capture-"));
  t.after(async () => {
    const pid = Number(await readFile(path.join(dir, "pid"), "utf8").catch(() => ""));
    if (pid > 0 && pid !== process.pid) {
      try { process.kill(pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "@example/capture-fixture", version: "1.0.0", type: "module",
    openclaw: { extensions: ["index.mjs"] },
  }));
  await writeFile(path.join(dir, "openclaw.plugin.json"), JSON.stringify({ id: "capture-fixture", configSchema: {} }));
  await writeFile(path.join(dir, "plugin-inspector.config.json"), JSON.stringify({
    version: 1, capture: { runtime: true, mockSdk: false },
  }));
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(entrypoint, source);
  return { dir, entrypoint };
}

function invokeCli(route, dir) {
  return execFileAsync(process.execPath, route.args, {
    cwd: dir,
    env: {
      ...process.env,
      PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1",
      PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "1000",
      PLUGIN_INSPECTOR_CAPTURE_KILL_GRACE_MS: "75",
    },
    timeout: 6000,
    killSignal: "SIGKILL",
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function readRuntimeReport(dir) {
  return JSON.parse(await readFile(path.join(dir, "reports", "plugin-inspector-runtime-capture.json"), "utf8"));
}

for (const route of cliRoutes) {
  for (const [name, source] of [
    ["busy registration", "export function register() { while (true) {} }"],
    ["pending import", "await new Promise(() => { setInterval(() => {}, 1000); }); export function register() {}"],
    ["pending registration", "export async function register() { await new Promise(() => { setInterval(() => {}, 1000); }); }"],
  ]) {
    test(`real SDK ${route.name} owns a ${name}`, { timeout: 10000 }, async (t) => {
      const { dir } = await fixture(t, `
        import { writeFileSync } from 'node:fs';
        writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
        ${source}
      `);
      await assert.rejects(invokeCli(route, dir), (error) => {
        assert.equal(error.killed, false, "the inspector must finish before the test watchdog");
        assert.equal(error.signal, null);
        assert.equal(error.code, 1);
        assert.match(error.stderr, route.report ? /runtime capture failed/ : /timed out after 1000ms/);
        return true;
      });
      if (route.report) {
        const report = await readRuntimeReport(dir);
        assert.equal(report.summary.failedCount, 1);
        assert.equal(report.results[0].failureClass, "capture-timeout");
        assert.equal(report.results[0].status, "error");
      }
      await assertGone(Number(await readFile(path.join(dir, "pid"), "utf8")));
    });
  }

  test(`real SDK ${route.name} flushes healthy JSON and sheds retained intervals`, { timeout: 10000 }, async (t) => {
    const { dir } = await fixture(t, `
      import { writeFileSync } from 'node:fs';
      import { fixtureName } from 'openclaw/plugin-sdk';
      export function register(api) {
        writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
        api.registerTool({ name: fixtureName, run() {} });
        process.stdout.write('x'.repeat(300000));
        setInterval(() => {}, 1000);
      }
    `);
    const sdkDir = path.join(dir, "sdk-workspace", "node_modules", "openclaw");
    const dependencyDir = path.join(dir, "sdk-workspace", "node_modules", "fixture-dependency");
    await mkdir(sdkDir, { recursive: true });
    await mkdir(dependencyDir, { recursive: true });
    await mkdir(path.join(dir, "node_modules"), { recursive: true });
    await writeFile(path.join(sdkDir, "package.json"), JSON.stringify({
      name: "openclaw", type: "module", exports: { "./plugin-sdk": "./sdk.mjs" },
    }));
    await writeFile(path.join(sdkDir, "sdk.mjs"), "export { fixtureName } from 'fixture-dependency';\n");
    await writeFile(path.join(dependencyDir, "package.json"), JSON.stringify({
      name: "fixture-dependency", type: "module", exports: "./index.mjs",
    }));
    await writeFile(path.join(dependencyDir, "index.mjs"), "export const fixtureName = 'installed-real-sdk';\n");
    await symlink(sdkDir, path.join(dir, "node_modules", "openclaw"), process.platform === "win32" ? "junction" : "dir");
    const { stdout } = await invokeCli(route, dir);
    const output = JSON.parse(stdout);
    const captured = route.report ? (await readRuntimeReport(dir)).results[0] : output;
    assert.equal(captured.status, "captured");
    assert.equal(captured.captured[0].arguments[0].name, "installed-real-sdk");
    assert.equal(captured.processOutput.stdout, "x".repeat(300000));
    await assertGone(Number(await readFile(path.join(dir, "pid"), "utf8")));
  });

  test(`real SDK ${route.name} rejects partial JSON followed by registration failure`, { timeout: 10000 }, async (t) => {
    const { dir } = await fixture(t, `
      import { writeSync } from 'node:fs';
      export async function register() {
        writeSync(1, JSON.stringify({ status: 'captured', captured: [] }));
        await new Promise((_, reject) => setTimeout(() => reject(new Error('late-registration-failure')), 25));
      }
    `);
    await assert.rejects(invokeCli(route, dir), (error) => {
      assert.equal(error.killed, false);
      assert.equal(error.code, 1);
      assert.match(error.stderr, route.report ? /runtime capture failed/ : /late-registration-failure/);
      return true;
    });
    if (route.report) {
      const report = await readRuntimeReport(dir);
      assert.equal(report.summary.failedCount, 1);
      assert.equal(report.results[0].failureClass, "registration-execution-error");
    }
  });
}

test("real capture API timeout option precedes the environment budget", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, "export function register() { return new Promise(() => {}); }\n");
  await assert.rejects(capturePluginEntrypoint(entrypoint, {
    timeoutMs: 50, env: { PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "1000" },
  }), { failureClass: "capture-timeout", message: "In-process capture timed out after 50ms" });
});

test("real capture API invalid timeout options fall through to the environment", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, "export function register() { return new Promise(() => {}); }\n");
  for (const timeoutMs of [0, -1, NaN, Infinity, 2 ** 31]) {
    await assert.rejects(capturePluginEntrypoint(entrypoint, {
      timeoutMs, env: { PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "50" },
    }), { failureClass: "capture-timeout", message: "In-process capture timed out after 50ms" });
  }
});

test("real capture API uses a 30 second default after invalid environment input", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, "export function register(api) { api.runtime.started(); return new Promise(() => {}); }\n");
  let registered;
  const started = new Promise((resolve) => { registered = resolve; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = capturePluginEntrypoint(entrypoint, {
    env: { PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "invalid" },
    apiOptions: { runtime: { started: registered } },
  });
  const rejected = assert.rejects(pending, {
    failureClass: "capture-timeout", message: "In-process capture timed out after 30000ms",
  });
  await started;
  t.mock.timers.tick(30000);
  await rejected;
});

test("real capture API stops registration after an import exceeds its budget", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, `
    await new Promise((resolve) => setTimeout(resolve, 150));
    export function register(api) { api.runtime.registered(); }
  `);
  let registrations = 0;
  await assert.rejects(capturePluginEntrypoint(entrypoint, {
    timeoutMs: 50,
    apiOptions: { runtime: { registered() { registrations += 1; } } },
  }), { failureClass: "capture-timeout" });
  await delay(200);
  assert.equal(registrations, 0);
});

test("real capture API cancellation stops later setup without mutating its caller", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, `
    await new Promise((resolve) => setTimeout(resolve, 150));
    export function register(api) { api.runtime.registered(); }
  `);
  let registrations = 0;
  const runtime = { registered() { registrations += 1; } };
  const controller = new AbortController();
  const pending = capturePluginEntrypoint(entrypoint, {
    timeoutMs: 1000, signal: controller.signal, apiOptions: { runtime },
  });
  const rejected = assert.rejects(pending, {
    failureClass: "capture-error", message: "In-process capture cancelled",
  });
  controller.abort();
  await rejected;
  await delay(200);
  assert.equal(registrations, 0);
  assert.deepEqual(Object.keys(runtime), ["registered"]);
});

test("real capture API observes late registration rejection after its timeout", { timeout: 3000 }, async (t) => {
  const { entrypoint } = await fixture(t, `
    export function register() {
      return new Promise((_, reject) => setTimeout(() => reject(new Error('late-registration-failure')), 150));
    }
  `);
  await assert.rejects(capturePluginEntrypoint(entrypoint, { timeoutMs: 50 }), { failureClass: "capture-timeout" });
  await delay(200);
});
