import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { captureProcessResources, diffProcessResources } from "@openclaw/plugin-inspector/resource-profile";

const moduleUrl = new URL("../src/resource-profile.js", import.meta.url).href;

test("resource snapshots observe CPU work, retained buffers, and timer disposal in the measured child", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "--expose-gc", "-e", `
    import { captureProcessResources, diffProcessResources } from ${JSON.stringify(moduleUrl)};
    globalThis.gc();
    const before = captureProcessResources();
    let retained = Buffer.alloc(8 * 1024 * 1024, 1);
    const timer = setInterval(() => {}, 60_000);
    const cpuStart = process.cpuUsage();
    while (true) {
      const used = process.cpuUsage(cpuStart);
      if (used.user + used.system >= 20_000) break;
    }
    const loaded = captureProcessResources();
    const sentinel = retained[retained.length - 1];
    retained = null;
    clearInterval(timer);
    // Leave the allocation stack before GC so conservative stack roots do not
    // turn the cleanup control into a test of incidental V8 liveness.
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
    const disposed = captureProcessResources();
    process.stdout.write(JSON.stringify({
      pid: process.pid, before, loaded, disposed, sentinel,
      work: diffProcessResources(before, loaded),
      cleanup: diffProcessResources(loaded, disposed),
    }));
  `], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 64 * 1024,
    env: {},
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.notEqual(report.pid, process.pid);
  assert.equal(report.before.pid, report.pid);
  assert.equal(report.sentinel, 1);
  assert.ok(report.work.cpuMs.total >= 20, JSON.stringify(report.work));
  assert.ok(report.work.wallMs > 0);
  assert.ok(report.work.memoryDeltaBytes.arrayBuffers >= 8 * 1024 * 1024);
  assert.equal(report.work.activeResourceDelta.Timeout, 1);
  assert.equal(report.cleanup.activeResourceDelta.Timeout, -1);
  assert.ok(report.cleanup.memoryDeltaBytes.arrayBuffers <= -8 * 1024 * 1024);
});

test("resource differences survive JSON transport and preserve signed memory changes", () => {
  const before = captureProcessResources();
  const after = structuredClone(before);
  after.elapsedMs += 10;
  after.cpuMicros.user += 2500;
  after.cpuMicros.system += 1000;
  after.memoryBytes.heapUsed -= 64;
  after.memoryBytes.external += 128;
  before.activeResources = { Timeout: 2 };
  after.activeResources = { TCPServerWrap: 1 };
  before.eventLoop = { idle: 10, active: 5, utilization: 1 / 3 };
  after.eventLoop = { idle: 16, active: 9, utilization: 9 / 25 };
  const delta = diffProcessResources(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)));
  assert.equal(delta.wallMs, 10);
  assert.deepEqual(delta.cpuMs, { user: 2.5, system: 1, total: 3.5 });
  assert.equal(delta.memoryDeltaBytes.heapUsed, -64);
  assert.equal(delta.memoryDeltaBytes.external, 128);
  assert.deepEqual(delta.activeResourceDelta, { TCPServerWrap: 1, Timeout: -2 });
  assert.deepEqual(delta.eventLoop, { idle: 6, active: 4, utilization: 0.4 });
});

test("an unadvanced event-loop counter is unavailable rather than zero utilization", () => {
  const before = captureProcessResources();
  assert.equal(diffProcessResources(before, structuredClone(before)).eventLoop, null);
});

test("resource differences reject another process lifetime, thread, or reversed counters", () => {
  const before = captureProcessResources();
  for (const field of ["pid", "threadId", "timeOriginMs"]) {
    assert.throws(() => diffProcessResources(before, { ...before, [field]: before[field] + 1 }), /same process lifetime and thread/);
  }
  assert.throws(() => diffProcessResources(before, { ...before, elapsedMs: before.elapsedMs - 1 }), /ordered/);
  assert.throws(() => diffProcessResources(before, { ...before, cpuMicros: { ...before.cpuMicros, user: before.cpuMicros.user - 1 } }), /ordered/);
});

test("worker snapshots identify their own heap boundary within the shared process", { timeout: 5000 }, async () => {
  const parent = captureProcessResources();
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    import(${JSON.stringify(moduleUrl)}).then(({ captureProcessResources }) => parentPort.postMessage(captureProcessResources()));
  `, { eval: true, env: {} });
  try {
    const [snapshot] = await once(worker, "message");
    assert.equal(snapshot.pid, parent.pid);
    assert.notEqual(snapshot.threadId, parent.threadId);
    assert.throws(() => diffProcessResources(parent, snapshot), /same process lifetime and thread/);
  } finally {
    await worker.terminate();
  }
});
