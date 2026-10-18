import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { buildImportLoopProfile } from "../src/import-loop-profile.js";
import { runProfiledProcess } from "../src/process-profile.js";
import { buildRuntimeProfile, validateRuntimeProfile, writeRuntimeProfile } from "../src/runtime-profile.js";

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-failure-profile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function assertGone(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  const exists = () => {
    try { process.kill(pid, 0); return true; } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  for (let i = 0; i < 100 && exists(); i += 1) await delay(10);
  assert.equal(exists(), false, `owned PID ${pid} survived completion`);
}

test("profile retains full bounded failure output without changing previews", { timeout: 5000 }, async () => {
  const stderr = "Error: capture failed\r\n    at capture (fixture.mjs:4:2)\r\n    at main (fixture.mjs:8:1)\r\n\r\nNode.js v24.21.0\r\n";
  const run = (exitCode, maxOutputBytes = 1024) => runProfiledProcess({
    command: process.execPath,
    args: ["-e", `process.stdout.write('capture context'); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = ${exitCode};`],
    timeoutMs: 3000,
    maxOutputBytes,
  });
  const failed = await run(7);
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.stderrPreview, "\r\nNode.js v24.21.0");
  assert.deepEqual(failed.processOutput, { stdout: "capture context", stderr, outputTruncated: false });
  assert.equal(failed.timeoutMs, 3000);
  assert.equal(failed.signal, null);
  await assertGone(failed.pid);

  const capped = await run(7, 32);
  assert.deepEqual(capped.processOutput, {
    stdout: "capture context", stderr: stderr.slice(0, 32), outputTruncated: true,
  });
  await assertGone(capped.pid);

  const success = await run(0);
  assert.equal(success.exitCode, 0);
  assert.equal(success.stderrPreview, failed.stderrPreview);
  assert.equal(Object.hasOwn(success, "processOutput"), false);
  await assertGone(success.pid);
});

for (const mode of ["timeout", "cancel"]) {
  test(`profile retains failure output after ${mode}`, { timeout: 5000 }, async () => {
    const controller = new AbortController();
    const pending = runProfiledProcess({
      command: process.execPath,
      args: ["-e", "process.stderr.write('capture entered\\n'); setInterval(() => {}, 1000);"],
      timeoutMs: 1000,
      killGraceMs: 75,
      signal: controller.signal,
    });
    const cancel = mode === "cancel" ? setTimeout(() => controller.abort(), 500) : undefined;
    const result = await pending;
    clearTimeout(cancel);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.timedOut, mode === "timeout");
    assert.equal(result.cancelled, mode === "cancel");
    assert.deepEqual(result.processOutput, {
      stdout: "", stderr: "capture entered\n", outputTruncated: false,
    });
    assert.ok(result.signal);
    await assertGone(result.pid);
  });
}

test("import-loop retains failure diagnostics for baseline and plugin samples", { timeout: 5000 }, async (t) => {
  const rootDir = await tempDir(t);
  let calls = 0;
  const profile = await buildImportLoopProfile({
    rootDir, baselineRuns: 1, runs: 2,
    captureCommand: () => ({
      command: process.execPath,
      args: ["-e", `process.stderr.write('failure-${++calls}\\nstack\\n\\nNode.js v24.21.0\\n'); process.exitCode = 7;`],
    }),
  });
  const samples = [...profile.baseline.samples, ...profile.samples];
  assert.equal(calls, 3);
  assert.equal(profile.summary.baselineFailCount, 1);
  assert.equal(profile.summary.failCount, 2);
  for (const [index, sample] of samples.entries()) {
    assert.equal(sample.exitCode, 7);
    assert.equal(sample.stderrPreview, "\nNode.js v24.21.0");
    assert.deepEqual(sample.processOutput, {
      stdout: "", stderr: `failure-${index + 1}\nstack\n\nNode.js v24.21.0\n`, outputTruncated: false,
    });
    assert.ok(sample.pid > 0);
    assert.equal(sample.signal, null);
    assert.equal(sample.timeoutMs, 30_000);
    await assertGone(sample.pid);
  }
});

test("runtime profile writes ordered failed-sample diagnostics before validation", { timeout: 8000 }, async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-failure-profile-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const orderPath = path.join(rootDir, "order.json");
  const command = (id) => ({
    id, args: ["-e", `
      const fs = require('node:fs');
      const file = ${JSON.stringify(orderPath)};
      const order = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      const index = order.filter((item) => item === '${id}').length + 1;
      order.push('${id}'); fs.writeFileSync(file, JSON.stringify(order));
      if ('${id}' === 'capture' && index === 2) {
        process.stderr.write('Error: synthetic capture failure\\r\\n    at capture\\r\\n    at main\\r\\n\\r\\nNode.js v24.21.0\\r\\n');
        process.exitCode = 7;
      } else process.stdout.write('${id}-' + index);
    `],
  });
  const profile = await buildRuntimeProfile({ rootDir, commands: [command("prepare"), command("capture")], runs: 3 });
  const jsonPath = path.join(rootDir, "profile.json");
  await writeRuntimeProfile(profile, { jsonPath, markdownPath: path.join(rootDir, "profile.md") });
  const written = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.deepEqual(JSON.parse(await readFile(orderPath, "utf8")),
    ["prepare", "prepare", "prepare", "capture", "capture", "capture"]);
  const capture = written.commands[1];
  assert.deepEqual(capture.samples.map((sample) => sample.exitCode), [0, 7, 0]);
  assert.deepEqual(capture.samples.filter((sample) => sample.exitCode === 0).map((sample) => sample.stdoutPreview),
    ["capture-1", "capture-3"]);
  assert.equal(capture.samples[1].stderrPreview, "\r\nNode.js v24.21.0");
  assert.equal(capture.samples[1].processOutput.stderr,
    "Error: synthetic capture failure\r\n    at capture\r\n    at main\r\n\r\nNode.js v24.21.0\r\n");
  assert.equal(capture.samples[1].processOutput.outputTruncated, false);
  assert.match(validateRuntimeProfile(written).join("\n"), /capture: nonzero exit code\(s\): 0, 7/);
});
