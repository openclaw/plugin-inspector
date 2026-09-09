import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { captureEntrypoint } from "../src/inspector.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("src/cli.js");

async function fixture(t, source) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-capture-"));
  t.after(async () => {
    for (const name of ["pid", "pids"]) {
      const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
      for (const pid of text.split(/\s+/).map(Number).filter((value) => value > 0)) {
        try { process.kill(pid, "SIGKILL"); } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    await rm(dir, { recursive: true, force: true });
  });
  const entrypoint = path.join(dir, "index.mjs");
  await writeFile(entrypoint, source);
  return { dir, entrypoint };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function assertGone(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  for (let i = 0; i < 100 && processExists(pid); i += 1) await delay(10);
  assert.equal(processExists(pid), false, `owned PID ${pid} survived capture`);
}

for (const [name, register] of [
  ["busy loop", "while (true) {}"],
  ["never-settling register", "await new Promise(() => { setInterval(() => {}, 1000); });"],
  ["TERM-resistant register", "process.on('SIGTERM', () => {}); await new Promise(() => { setInterval(() => {}, 1000); });"],
]) {
  test(`mock capture bounds a ${name}`, { timeout: 5000 }, async (t) => {
    const { dir, entrypoint } = await fixture(t, `
      import { writeFileSync } from 'node:fs';
      export default { async register() {
        writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
        ${register}
      } };
    `);
    await assert.rejects(captureEntrypoint(entrypoint, {
      cwd: dir,
      mockSdk: true,
      timeoutMs: 1000,
      killGraceMs: 75,
    }), (error) => {
      assert.equal(error.failureClass, "capture-timeout");
      assert.match(error.message, /timed out after 1000ms/);
      return true;
    });
    await assertGone(Number(await readFile(path.join(dir, "pid"), "utf8")));
  });
}

test("mock capture escalates after its leader exits and a descendant retains stdio", {
  timeout: 8000, skip: process.platform === "win32",
}, async (t) => {
  const descendant = "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);";
  const { dir, entrypoint } = await fixture(t, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    export default { async register() {
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      await new Promise((resolve) => child.once('message', resolve));
      writeFileSync(new URL('./pids', import.meta.url), process.pid + ' ' + child.pid);
      process.on('SIGTERM', () => process.exit(0));
      await new Promise(() => { setInterval(() => {}, 1000); });
    } };
  `);
  await assert.rejects(captureEntrypoint(entrypoint, {
    cwd: dir, mockSdk: true, timeoutMs: 1500, killGraceMs: 75,
  }), { failureClass: "capture-timeout" });
  const pids = (await readFile(path.join(dir, "pids"), "utf8")).split(/\s+/).map(Number);
  for (const pid of pids) await assertGone(pid);
});

test("mock capture cancellation cannot become success or wait for the timeout", { timeout: 5000 }, async (t) => {
  const { dir, entrypoint } = await fixture(t, `
    import { writeFileSync } from 'node:fs';
    export default { async register() {
      process.on('SIGTERM', () => process.exit(0));
      writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
      await new Promise(() => { setInterval(() => {}, 1000); });
    } };
  `);
  const controller = new AbortController();
  const pending = captureEntrypoint(entrypoint, {
    cwd: dir, mockSdk: true, timeoutMs: 3000, killGraceMs: 75, signal: controller.signal,
  });
  // Attach the rejection assertion before aborting; the child may close promptly.
  const rejected = assert.rejects(pending, (error) => {
    assert.equal(error.failureClass, "mock-sdk-capture-error");
    assert.match(error.message, /cancelled/);
    return true;
  });
  let pid;
  for (let i = 0; i < 150; i += 1) {
    pid = Number(await readFile(path.join(dir, "pid"), "utf8").catch(() => ""));
    if (pid) break;
    await delay(10);
  }
  controller.abort();
  await rejected;
  await assertGone(pid);
  await assert.rejects(captureEntrypoint(entrypoint, {
    cwd: dir, mockSdk: true, signal: controller.signal,
  }), /cancelled/);
});

test("mock capture bounds direct pipe floods and intercepted plugin output", {
  timeout: 8000, skip: process.platform === "win32",
}, async (t) => {
  const { dir, entrypoint } = await fixture(t, `
    export default { register() {
      const chunk = 'x'.repeat(65536);
      for (let i = 0; i < 64; i++) { process.stdout.write(chunk); process.stderr.write(chunk); }
    } };
  `);
  const captured = await captureEntrypoint(entrypoint, { cwd: dir, mockSdk: true, timeoutMs: 3000 });
  assert.equal(captured.status, "captured");
  assert.equal(Buffer.byteLength(captured.processOutput.stdout), 1024 * 1024);
  assert.equal(Buffer.byteLength(captured.processOutput.stderr), 1024 * 1024);

  const writer = `
    const { once } = require('node:events');
    const chunk = Buffer.alloc(65536, 'x');
    (async () => {
      while (true) {
        if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
        if (!process.stderr.write(chunk)) await once(process.stderr, 'drain');
      }
    })();
  `;
  await writeFile(entrypoint, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    export default { async register() {
      writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(writer)}], { stdio: ['ignore', 'inherit', 'inherit'] });
      writeFileSync(new URL('./pids', import.meta.url), String(child.pid));
      await new Promise(() => {});
    } };
  `);
  await assert.rejects(captureEntrypoint(entrypoint, {
    cwd: dir, mockSdk: true, timeoutMs: 1000, killGraceMs: 75, maxOutputBytes: 4096,
  }), (error) => {
    assert.equal(error.failureClass, "capture-timeout", error.message);
    assert.equal(Buffer.byteLength(error.cause.stdout), 4096);
    assert.equal(Buffer.byteLength(error.cause.stderr), 4096);
    return true;
  });
  await assertGone(Number(await readFile(path.join(dir, "pid"), "utf8")));
  await assertGone(Number(await readFile(path.join(dir, "pids"), "utf8")));
});

test("valid JSON followed by a late registration rejection is not capture success", { timeout: 5000 }, async (t) => {
  const { dir, entrypoint } = await fixture(t, `
    import { writeSync } from 'node:fs';
    export default { async register() {
      writeSync(1, JSON.stringify({ status: 'captured', captured: [] }));
      await new Promise((_, reject) => setTimeout(() => reject(new Error('late-fixture-rejection')), 25));
    } };
  `);
  await assert.rejects(captureEntrypoint(entrypoint, { cwd: dir, mockSdk: true, timeoutMs: 3000 }),
    { failureClass: "registration-execution-error", message: "Error: late-fixture-rejection" });
});

test("CLI capture flushes large healthy JSON before shedding retained intervals", { timeout: 8000 }, async (t) => {
  const { dir } = await fixture(t, `
    import { writeFileSync } from 'node:fs';
    export default { register() {
      writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
      process.stdout.write('x'.repeat(300000));
      setInterval(() => {}, 1000);
    } };
  `);
  const { stdout } = await execFileAsync(process.execPath,
    [cliPath, "capture", "index.mjs", "--allow-execute", "--mock-sdk"],
    { cwd: dir, timeout: 6000, env: { ...process.env, PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "3000" } });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, "captured");
  assert.equal(parsed.mockSdk, true);
  assert.equal(parsed.processOutput.stdout, "x".repeat(300000));
  await assertGone(Number(await readFile(path.join(dir, "pid"), "utf8")));
});

test("CLI capture uses its environment budget, not the outer watchdog", { timeout: 6000 }, async (t) => {
  const { dir } = await fixture(t, `
    export default { async register() { await new Promise(() => { setInterval(() => {}, 1000); }); } };
  `);
  await assert.rejects(execFileAsync(process.execPath,
    [cliPath, "capture", "index.mjs", "--allow-execute", "--mock-sdk"], {
      cwd: dir,
      env: { ...process.env, PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "750" },
      timeout: 4500,
    }), (error) => {
    assert.equal(error.killed, false);
    assert.equal(error.signal, null);
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /timed out after 750ms/);
    return true;
  });
});
