import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { buildImportLoopProfile } from "../src/import-loop-profile.js";
import { runProfiledProcess } from "../src/process-profile.js";
import { buildRuntimeProfile } from "../src/runtime-profile.js";

const posixOnly = { skip: process.platform === "win32", timeout: 8000 };
const exitOnTerm = "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);";

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-process-"));
  t.after(async () => {
    await cleanupPids(path.join(dir, "pids"));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
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
  assert.equal(processExists(pid), false, `owned PID ${pid} survived completion`);
}

async function cleanupPids(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  for (const pid of text.trim().split(/\s+/).map(Number).filter((value) => value > 0)) {
    try { process.kill(pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

for (const [name, source] of [
  ["busy loop", "while (true) {}"],
  ["retained interval", "setInterval(() => {}, 1000)"],
  ["zero exit from SIGTERM", exitOnTerm],
]) {
  test(`profile timeout fails and reaps a ${name}`, { timeout: 5000 }, async () => {
    const result = await runProfiledProcess({
      command: process.execPath,
      args: ["-e", source],
      timeoutMs: 500,
      killGraceMs: 75,
    });
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.wallMs >= 450 && result.wallMs < 2500);
    await assertGone(result.pid);
  });
}

test("profile drains bounded stdout and stderr through close", { timeout: 5000 }, async () => {
  const result = await runProfiledProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(200000)); process.stderr.write('y'.repeat(200000));"],
    timeoutMs: 3000,
    maxOutputBytes: 64,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutPreview, "x".repeat(64));
  assert.equal(result.stderrPreview, "y".repeat(64));
  await assertGone(result.pid);
});

test("profile output flood stays capped until the production timeout", { timeout: 5000 }, async () => {
  const result = await runProfiledProcess({
    command: process.execPath,
    args: ["-e", `
      const { once } = require('node:events');
      const chunk = Buffer.alloc(65536, 'x');
      (async () => {
        while (true) {
          if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
          if (!process.stderr.write(chunk)) await once(process.stderr, 'drain');
        }
      })();
    `],
    timeoutMs: 500,
    killGraceMs: 75,
    maxOutputBytes: 4096,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.byteLength(result.stdoutPreview), 4096);
  assert.equal(Buffer.byteLength(result.stderrPreview), 4096);
  await assertGone(result.pid);
});

for (const mode of ["timeout", "normal exit", "cancel"]) {
  test(`profile cleans a TERM-resistant descendant holding stdio after ${mode}`, posixOnly, async (t) => {
    const dir = await tempDir(t);
    const pidsFile = path.join(dir, "pids");
    const descendant = `
      process.on('SIGTERM', () => {});
      process.send('ready');
      setInterval(() => {}, 1000);
    `;
    const source = `
      const fs = require('node:fs');
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.once('message', () => {
        fs.writeFileSync(${JSON.stringify(pidsFile)}, process.pid + ' ' + child.pid);
        process.on('SIGTERM', () => process.exit(0));
        ${mode === "normal exit" ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
      });
    `;
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const unrelatedClosed = new Promise((resolve) => unrelated.once("close", resolve));
    t.after(async () => { unrelated.kill("SIGKILL"); await unrelatedClosed; });
    const controller = new AbortController();
    const pending = runProfiledProcess({
      command: process.execPath,
      args: ["-e", source],
      timeoutMs: 1500,
      killGraceMs: 75,
      signal: controller.signal,
    });
    if (mode === "cancel") {
      for (let i = 0; i < 100; i += 1) {
        if (await readFile(pidsFile, "utf8").catch(() => "")) break;
        await delay(10);
      }
      controller.abort();
      controller.abort();
    }
    const result = await pending;
    const pids = (await readFile(pidsFile, "utf8")).trim().split(/\s+/).map(Number);
    assert.equal(result.timedOut, mode === "timeout");
    assert.equal(result.cancelled === true, mode === "cancel");
    assert.equal(result.exitCode === 0, mode === "normal exit");
    for (const pid of pids) await assertGone(pid);
    assert.equal(processExists(unrelated.pid), true);
    assert.ok(result.wallMs < 3500);
  });
}

test("already cancelled profiles do not spawn a child", { timeout: 3000 }, async (t) => {
  const dir = await tempDir(t);
  const marker = path.join(dir, "ran");
  const result = await runProfiledProcess({
    command: process.execPath,
    args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
    signal: AbortSignal.abort(),
  });
  assert.equal(result.cancelled, true);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.pid, undefined);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("profile budgets use valid API then environment values without a zero opt-out", { timeout: 10000 }, async (t) => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2 ** 31]) {
    await t.test(String(timeoutMs), async () => {
      const result = await runProfiledProcess({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 1200)"],
        timeoutMs,
        env: { ...process.env, PLUGIN_INSPECTOR_PROFILE_TIMEOUT_MS: "150" },
      });
      assert.equal(result.timedOut, true);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.wallMs < 1000);
    });
  }
  for (const options of [
    { timeoutMs: 2000, env: { ...process.env, PLUGIN_INSPECTOR_PROFILE_TIMEOUT_MS: "1" } },
    { env: { ...process.env, PLUGIN_INSPECTOR_PROFILE_TIMEOUT_MS: "1junk" } },
  ]) {
    const result = await runProfiledProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 100)"],
      ...options,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  }
});

test("a stalled output-flooding ps cannot outlive the profile", posixOnly, async (t) => {
  const dir = await tempDir(t);
  const pidsFile = path.join(dir, "pids");
  const ps = path.join(dir, "ps");
  await writeFile(ps, `#!${process.execPath}
    require('node:fs').appendFileSync(${JSON.stringify(pidsFile)}, process.pid + '\\n');
    process.on('SIGTERM', () => {});
    process.stdout.write('1 1 '.repeat(20000));
    setTimeout(() => process.exit(0), 1800);
  `);
  await chmod(ps, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
  t.after(() => { process.env.PATH = originalPath; });
  const result = await runProfiledProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 500)"],
    timeoutMs: 2000,
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.wallMs < 1500, `sampler delayed completion to ${result.wallMs}ms`);
  assert.equal(result.statSampleCount, 0);
  const pids = (await readFile(pidsFile, "utf8")).trim().split(/\s+/).map(Number);
  assert.ok(pids.length > 0);
  for (const pid of pids) await assertGone(pid);
});

test("higher-level profiles reject a timeout even when SIGTERM exits zero", posixOnly, async (t) => {
  const runtime = await buildRuntimeProfile({
    commands: [{ id: "hang", label: "Hang", category: "baseline", args: ["-e", exitOnTerm] }],
    generatedAt: "test",
    runs: 1,
    timeoutMs: 500,
    killGraceMs: 75,
  });
  const hang = runtime.commands.find((command) => command.id === "hang");
  assert.ok(hang.exitCodes.every((code) => code !== 0));
  assert.ok(hang.samples.every((sample) => sample.timedOut));

  const rootDir = await tempDir(t);
  const entrypoint = path.join(rootDir, "index.mjs");
  await writeFile(entrypoint, "export default { register() {} };");
  const profile = await buildImportLoopProfile({
    baseline: false,
    captureCommand: () => ({ command: process.execPath, args: ["-e", exitOnTerm] }),
    entrypoint,
    rootDir,
    runs: 1,
    env: { PLUGIN_INSPECTOR_PROFILE_TIMEOUT_MS: "500" },
    killGraceMs: 75,
  });
  assert.equal(profile.summary.failCount, profile.samples.length);
  assert.ok(profile.samples.every((sample) => sample.timedOut && sample.exitCode !== 0));
});

for (const mode of ["timeout", "cancel", "success"]) {
  test(`default import-loop owns its runner and descendants on ${mode}`, posixOnly, async (t) => {
    const rootDir = await tempDir(t);
    const entrypoint = path.join(rootDir, "index.mjs");
    const pidsFile = path.join(rootDir, "pids");
    const descendant = "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);";
    await writeFile(entrypoint, `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      export default { async register(api) {
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        await new Promise((resolve) => child.once('message', resolve));
        writeFileSync(${JSON.stringify(pidsFile)}, process.pid + ' ' + child.pid);
        api.on('before_tool_call', () => undefined);
        ${mode === "success" ? "" : "await new Promise(() => { setInterval(() => {}, 1000); });"}
      } };
    `);
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const unrelatedClosed = new Promise((resolve) => unrelated.once("close", resolve));
    t.after(async () => { unrelated.kill("SIGKILL"); await unrelatedClosed; });
    const controller = new AbortController();
    const pending = buildImportLoopProfile({
      rootDir, entrypoint, baseline: false, runs: 1,
      timeoutMs: mode === "timeout" ? 1000 : 3000,
      killGraceMs: 75,
      signal: controller.signal,
      env: { PLUGIN_INSPECTOR_CAPTURE_TIMEOUT_MS: "5000" },
    });
    if (mode === "cancel") {
      for (let i = 0; i < 150; i += 1) {
        if (await readFile(pidsFile, "utf8").catch(() => "")) break;
        await delay(10);
      }
      controller.abort();
    }
    const profile = await pending;
    const pids = (await readFile(pidsFile, "utf8")).trim().split(/\s+/).map(Number);
    for (const pid of pids) await assertGone(pid);
    assert.equal(processExists(unrelated.pid), true);
    assert.equal(profile.summary.failCount, mode === "success" ? 0 : 1);
    assert.equal(profile.samples[0].timedOut, mode === "timeout");
    assert.equal(profile.samples[0].cancelled, mode === "cancel");
    if (mode === "success") {
      const artifact = JSON.parse(await readFile(path.join(rootDir, ".plugin-inspector/import-loop/capture-0.json"), "utf8"));
      assert.equal(artifact.status, "captured");
      assert.equal(artifact.captured[0].name, "before_tool_call");
    }
  });
}

test("default import-loop preserves captures over 1 MiB and retained timers", { timeout: 8000 }, async (t) => {
  const rootDir = await tempDir(t);
  const entrypoint = path.join(rootDir, "index.mjs");
  await writeFile(entrypoint, `
    import { writeFileSync } from 'node:fs';
    export default { register(api) {
      writeFileSync(new URL('./pids', import.meta.url), String(process.pid));
      api.on('before_tool_call', () => undefined);
      process.stdout.write('x'.repeat(700000));
      process.stderr.write('y'.repeat(700000));
      setInterval(() => {}, 1000);
    } };
  `);
  const profile = await buildImportLoopProfile({
    rootDir, entrypoint, baselineRuns: 1, runs: 1, timeoutMs: 3000,
  });
  assert.equal(profile.summary.baselineFailCount, 0);
  assert.equal(profile.summary.failCount, 0);
  const artifactDir = path.join(rootDir, ".plugin-inspector/import-loop");
  const baseline = JSON.parse(await readFile(path.join(artifactDir, "baseline-0.json"), "utf8"));
  const sampleJson = await readFile(path.join(artifactDir, "capture-0.json"), "utf8");
  const sample = JSON.parse(sampleJson);
  assert.equal(baseline.status, "captured");
  assert.equal(baseline.captured.length, 1);
  assert.equal(sample.captured[0].name, "before_tool_call");
  assert.ok(Buffer.byteLength(sampleJson) > 1024 * 1024);
  assert.equal(sample.processOutput.stdout, "x".repeat(700000));
  assert.equal(sample.processOutput.stderr, "y".repeat(700000));
  await assertGone(Number(await readFile(path.join(rootDir, "pids"), "utf8")));
});

test("default import-loop rejects capture results above the 10 MiB capture cap", { timeout: 5000 }, async (t) => {
  const rootDir = await tempDir(t);
  const entrypoint = path.join(rootDir, "index.mjs");
  await writeFile(entrypoint, `
    export default { register(api) { api.on('x'.repeat(6 * 1024 * 1024), () => undefined); } };
  `);
  const profile = await buildImportLoopProfile({
    rootDir, entrypoint, baseline: false, runs: 1, timeoutMs: 3000,
  });
  assert.equal(profile.summary.failCount, 1);
  assert.notEqual(profile.samples[0].exitCode, 0);
  assert.match(profile.samples[0].stderrPreview, /10485760-byte limit/);
  await assert.rejects(readFile(path.join(rootDir, ".plugin-inspector/import-loop/capture-0.json")), { code: "ENOENT" });
});

test("default import-loop cannot reuse a stale artifact after process.exit(0)", { timeout: 5000 }, async (t) => {
  const rootDir = await tempDir(t);
  const entrypoint = path.join(rootDir, "index.mjs");
  const outputDir = path.join(rootDir, "samples");
  const outputPath = path.join(outputDir, "capture-0.json");
  await mkdir(outputDir);
  await writeFile(outputPath, JSON.stringify({ status: "captured", captured: [{ name: "stale" }] }));
  await writeFile(entrypoint, "export default { register() { process.exit(0); } };");
  const profile = await buildImportLoopProfile({ rootDir, entrypoint, outputDir, baseline: false, runs: 1, timeoutMs: 3000 });
  assert.equal(profile.summary.failCount, 1);
  assert.notEqual(profile.samples[0].exitCode, 0);
  assert.match(profile.samples[0].stderrPreview, /Invalid capture artifact/);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

for (const [name, body, expected] of [
  ["artifact write failure", "mkdirSync(outputPath);", /EISDIR/],
  ["oversized runner result", "process.stdout.write('x'.repeat(10000));", /byte limit/],
  ["oversized file bypass", "writeFileSync(outputPath, JSON.stringify({ status: 'captured', captured: [], data: 'x'.repeat(10000) })); process.exit(0);", /byte limit/],
  ["invalid current JSON", "writeFileSync(outputPath, JSON.stringify({ status: 'captured', captured: 'invalid' })); process.exit(0);", /captured contracts/],
]) {
  test(`default import-loop reports ${name}`, { timeout: 5000 }, async (t) => {
    const rootDir = await tempDir(t);
    const entrypoint = path.join(rootDir, "index.mjs");
    const outputDir = path.join(rootDir, "samples");
    const outputPath = path.join(outputDir, "capture-0.json");
    await writeFile(entrypoint, `
      import { mkdirSync, writeFileSync } from 'node:fs';
      const outputPath = ${JSON.stringify(outputPath)};
      export default { register() { ${body} } };
    `);
    const profile = await buildImportLoopProfile({
      rootDir, entrypoint, outputDir, baseline: false, runs: 1, timeoutMs: 3000, maxOutputBytes: 4096,
    });
    assert.equal(profile.summary.failCount, 1);
    assert.notEqual(profile.samples[0].exitCode, 0);
    assert.match(profile.samples[0].stderrPreview, expected);
  });
}

test("custom import-loop commands retain arguments, cwd, env, and artifact ownership", { timeout: 5000 }, async (t) => {
  const rootDir = await tempDir(t);
  const cwd = path.join(rootDir, "custom");
  const outputDir = path.join(rootDir, "samples");
  const outputPath = path.join(outputDir, "capture-0.json");
  const captureScript = path.join(rootDir, "capture.mjs");
  await mkdir(cwd);
  await mkdir(outputDir);
  await writeFile(outputPath, "previous-custom-artifact");
  await writeFile(captureScript, `
    import assert from 'node:assert/strict';
    import { readFile, writeFile } from 'node:fs/promises';
    assert.equal(process.argv[2], 'custom-argument');
    assert.equal(process.cwd(), ${JSON.stringify(cwd)});
    assert.equal(process.env.CUSTOM_CAPTURE, 'present');
    assert.equal(await readFile(process.argv[3], 'utf8'), 'previous-custom-artifact');
    await writeFile(process.argv[3], JSON.stringify({ status: 'captured', captured: [{ name: 'custom' }] }));
  `);
  let calls = 0;
  const profile = await buildImportLoopProfile({
    rootDir, outputDir, entrypoint: "custom-entry", baseline: false, runs: 1,
    captureCommand: (options) => {
      calls += 1;
      assert.deepEqual(options, { entrypoint: "custom-entry", index: 0, outputPath, rootDir });
      return {
        command: process.execPath,
        args: [captureScript, "custom-argument", outputPath],
        cwd,
        env: { CUSTOM_CAPTURE: "present" },
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(profile.summary.failCount, 0);
  assert.equal(profile.summary.capturedCount, 1);
});
