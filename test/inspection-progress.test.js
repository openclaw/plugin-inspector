import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fixtureSuites } from "../src/index.js";
import { runInspectionPhase } from "../src/inspection-progress.js";
import { createTempDir } from "./helpers/temp-dir.js";

async function fixtureConfig(t) {
  const rootDir = await createTempDir(t, "inspector-progress-");
  for (const id of ["alpha", "beta"]) {
    const root = path.join(rootDir, id);
    await mkdir(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: id, version: "1.0.0", type: "module", main: "index.js" }));
    await writeFile(path.join(root, "index.js"), 'throw new Error("must not execute fixture source");\nexport default function register(api) { api.on("agent_end", () => {}); }\n');
  }
  return {
    version: 1,
    rootDir,
    submoduleRoot: ".",
    fixtures: ["alpha", "beta"].map((id) => ({ id, path: id, repo: "local", priority: "high", seams: ["llm-observer"] })),
  };
}

function summary(events) {
  return events.map(({ phase, event, fixtureId }) => [phase, event, fixtureId]);
}

test("public inspection reports ordered phase timings without changing deterministic reports", async (t) => {
  const config = await fixtureConfig(t);
  const options = { config, openclawPath: false, generatedAt: "test" };
  const baseline = await fixtureSuites.inspect(options);
  const events = [];
  const report = await fixtureSuites.inspect({ ...options, onInspectionProgress(event) { events.push(event); } });

  assert.deepEqual(report, baseline);
  assert.deepEqual(summary(events), [
    ["target", "start", undefined], ["target", "end", undefined],
    ["fixture", "start", "alpha"], ["sdk", "start", "alpha"],
    ["sdk", "end", "alpha"], ["fixture", "end", "alpha"],
    ["fixture", "start", "beta"], ["sdk", "start", "beta"],
    ["sdk", "end", "beta"], ["fixture", "end", "beta"],
  ]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), (event.fixtureId === undefined
      ? ["elapsedMs", "event", "phase"] : ["elapsedMs", "event", "fixtureId", "phase"]));
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Number.isFinite(event.elapsedMs), true);
    assert.ok(event.elapsedMs >= 0);
    if (event.event === "start") assert.equal(event.elapsedMs, 0);
  }
});

test("static inspection and readiness planners forward the optional observer", async (t) => {
  const config = await fixtureConfig(t);
  const staticEvents = [];
  await fixtureSuites.inspectStatic({ config, onInspectionProgress: (event) => staticEvents.push(event) });
  assert.equal(staticEvents.filter(({ phase, event }) => phase === "fixture" && event === "end").length, 2);
  assert.equal(staticEvents.some(({ phase }) => phase === "target"), false);

  const planEvents = [];
  await fixtureSuites.buildWorkspacePlan({ config, openclawPath: false, onInspectionProgress: (event) => planEvents.push(event) });
  assert.equal(planEvents.filter(({ phase, event }) => phase === "fixture" && event === "end").length, 2);
  assert.equal(planEvents[0].phase, "target");
});

test("throwing, rejecting, and non-settling observers do not change or stall inspection", { timeout: 5000 }, async (t) => {
  const config = await fixtureConfig(t);
  const options = { config, openclawPath: false, generatedAt: "test" };
  const baseline = await fixtureSuites.inspect(options);
  for (const onInspectionProgress of [
    () => { throw new Error("observer failure"); },
    () => Promise.reject(new Error("async observer failure")),
    () => new Promise(() => {}),
    () => ({ get then() { throw new Error("thenable failure"); } }),
  ]) {
    assert.deepEqual(await fixtureSuites.inspect({ ...options, onInspectionProgress }), baseline);
  }
});

test("missing fixtures finish without an SDK phase", async (t) => {
  const config = await fixtureConfig(t);
  config.fixtures = [{ ...config.fixtures[0], id: "missing", path: "missing" }];
  const events = [];
  const report = await fixtureSuites.inspect({ config, openclawPath: false, onInspectionProgress: (event) => events.push(event) });
  assert.equal(report.fixtures[0].status, "missing");
  assert.deepEqual(summary(events).slice(2), [["fixture", "start", "missing"], ["fixture", "end", "missing"]]);
});

test("phase failure preserves the original error without exposing its payload", async () => {
  const original = new Error("private fixture source and error details");
  const events = [];
  await assert.rejects(runInspectionPhase({ onInspectionProgress(event) { events.push(event); throw new Error("observer failure"); } },
    { phase: "sdk", fixtureId: "synthetic" }, () => { throw original; }), (error) => error === original);
  assert.deepEqual(summary(events), [["sdk", "start", "synthetic"], ["sdk", "error", "synthetic"]]);
  assert.equal(JSON.stringify(events).includes(original.message), false);
});

test("nested SDK failure closes both phases and preserves its rejection", async () => {
  const original = new Error("private SDK failure");
  const events = [];
  const options = { onInspectionProgress: (event) => events.push(event) };
  await assert.rejects(runInspectionPhase(options, { phase: "fixture", fixtureId: "synthetic" }, () =>
    runInspectionPhase(options, { phase: "sdk", fixtureId: "synthetic" }, () => Promise.reject(original))),
  (error) => error === original);
  assert.deepEqual(summary(events), [
    ["fixture", "start", "synthetic"], ["sdk", "start", "synthetic"],
    ["sdk", "error", "synthetic"], ["fixture", "error", "synthetic"],
  ]);
});
