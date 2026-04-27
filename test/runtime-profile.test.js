import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildRuntimeProfile,
  defaultRuntimeProfileOptions,
  renderRuntimeProfileMarkdown,
  validateRuntimeProfile,
  writeRuntimeProfile,
} from "../src/index.js";

test("runtime profile measures configured commands and summarizes fixture inventory", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-profile-"));
  const profile = await buildRuntimeProfile({
    rootDir,
    report: reportFixture(),
    inspection: inspectionFixture(),
    commands: [
      {
        id: "fixture-command",
        label: "Fixture command",
        category: "fixture",
        args: ["-e", "setTimeout(() => console.log('fixture ok'), 300)"],
      },
    ],
  });

  assert.equal(profile.generatedAt, defaultRuntimeProfileOptions.generatedAt);
  assert.equal(profile.runs, 1);
  assert.equal(profile.summary.commandCount, 1);
  assert.equal(profile.targetOpenClaw.hookNames, 2);
  assert.equal(profile.fixtureInventory.sourceFiles, 3);
  assert.equal(profile.groups[0].category, "fixture");
  assert.equal(profile.commands[0].exitCodes[0], 0);
  assert.match(profile.commands[0].samples[0].stdoutPreview, /fixture ok/);
  assert.deepEqual(validateRuntimeProfile(profile), []);
  assert.match(renderRuntimeProfileMarkdown(profile), /Plugin Runtime Profile/);
});

test("runtime profile forwards OpenClaw path flags for opt-in commands", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-profile-"));
  const argvPath = path.join(rootDir, "argv.json");
  const recorderPath = path.join(rootDir, "recorder.mjs");
  await writeFile(
    recorderPath,
    [
      "import { writeFile } from 'node:fs/promises';",
      "await writeFile(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)));",
    ].join("\n"),
    "utf8",
  );

  await buildRuntimeProfile({
    rootDir,
    openclawPath: "./openclaw",
    env: { ARGV_OUT: argvPath },
    commands: [
      {
        id: "openclaw-aware",
        label: "OpenClaw aware",
        category: "target",
        args: [recorderPath],
        openclaw: true,
      },
    ],
  });

  assert.deepEqual(JSON.parse(await readFile(argvPath, "utf8")), ["--openclaw", "./openclaw"]);
});

test("runtime profile validates failed commands and missing metrics", () => {
  const errors = validateRuntimeProfile({
    platform: { rssSampler: "ps" },
    commands: [
      {
        id: "failed",
        exitCodes: [1],
        wallMs: { max: 0 },
        peakRssMb: { max: 0 },
      },
    ],
  });

  assert.ok(errors.some((error) => error.includes("nonzero exit code")));
  assert.ok(errors.some((error) => error.includes("missing wall time")));
  assert.ok(errors.some((error) => error.includes("missing peak RSS")));
});

test("runtime profile writer emits JSON and Markdown artifacts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-profile-report-"));
  const jsonPath = path.join(outputDir, "profile.json");
  const markdownPath = path.join(outputDir, "profile.md");
  const profile = runtimeProfileFixture();

  assert.deepEqual(await writeRuntimeProfile(profile, { jsonPath, markdownPath }), { jsonPath, markdownPath });
  assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).summary.commandCount, 1);
  assert.match(await readFile(markdownPath, "utf8"), /Runtime Profile/);
});

function reportFixture() {
  return {
    targetOpenClaw: {
      status: "ok",
      configuredPath: "../openclaw",
      compatRecordCount: 1,
      hookNameCount: 2,
      apiRegistrarCount: 3,
      capturedRegistrarCount: 4,
      sdkExportCount: 5,
      manifestFieldCount: 6,
      manifestContractFieldCount: 7,
    },
    fixtures: [
      {
        hooks: ["before_tool_call"],
        registrations: ["registerTool"],
        sdkImports: ["openclaw/plugin-sdk"],
      },
    ],
    summary: {
      contractProbeCount: 8,
      issueCount: 9,
    },
  };
}

function inspectionFixture() {
  return {
    inspections: [
      { sourceFiles: ["a.js", "b.js"] },
      { sourceFiles: ["c.js"] },
    ],
  };
}

function runtimeProfileFixture() {
  return {
    generatedAt: "deterministic",
    runs: 1,
    targetOpenClaw: {
      status: "ok",
      configuredPath: "../openclaw",
      compatRecords: 1,
      hookNames: 2,
      apiRegistrars: 3,
      capturedRegistrars: 4,
      sdkExports: 5,
      manifestFields: 6,
      manifestContractFields: 7,
    },
    fixtureInventory: {
      fixtures: 1,
      sourceFiles: 3,
      observedHooks: 1,
      observedRegistrations: 1,
      observedSdkImports: 1,
      contractProbes: 8,
      issueFindings: 9,
    },
    summary: {
      commandCount: 1,
      p50WallMs: 10,
      p95WallMs: 10,
      maxPeakRssMb: 20,
      maxRssDeltaMb: 1,
      maxCpuMsEstimate: 2,
      maxHarnessHeapDeltaMb: 0.1,
    },
    groups: [
      {
        category: "fixture",
        commandCount: 1,
        p50WallMs: 10,
        p95WallMs: 10,
        maxPeakRssMb: 20,
        maxCpuMsEstimate: 2,
        commands: ["fixture-command"],
      },
    ],
    commands: [
      {
        id: "fixture-command",
        label: "Fixture command",
        category: "fixture",
        wallMs: { median: 10, max: 10 },
        peakRssMb: { max: 20 },
        rssDeltaMb: { max: 1 },
        cpuMsEstimate: { max: 2 },
        harnessHeapDeltaMb: { max: 0.1 },
        exitCodes: [0],
      },
    ],
  };
}
