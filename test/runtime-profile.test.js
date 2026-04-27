import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildRuntimeProfile,
  renderRuntimeProfileMarkdown,
  validateRuntimeProfile,
  writeRuntimeProfile,
} from "../src/runtime-profile.js";

test("runtime profile records command timings and plugin surface summaries", async () => {
  const report = {
    targetOpenClaw: {
      status: "ok",
      configuredPath: "../openclaw",
      compatRecordCount: 2,
      hookNameCount: 3,
      apiRegistrarCount: 4,
      capturedRegistrarCount: 5,
      sdkExportCount: 6,
      manifestFieldCount: 7,
      manifestContractFieldCount: 8,
    },
    fixtures: [
      {
        hooks: ["before_tool_call"],
        registrations: ["registerTool"],
        sdkImports: ["openclaw/plugin-sdk"],
      },
    ],
    summary: {
      contractProbeCount: 9,
      issueCount: 10,
    },
  };
  const inspection = {
    inspections: [{ sourceFiles: ["plugins/fixture/index.js"] }],
  };

  const profile = await buildRuntimeProfile({
    commands: [
      {
        id: "node-boot",
        label: "Node boot",
        category: "baseline",
        args: ["-e", "setTimeout(() => undefined, 250)"],
      },
      {
        id: "openclaw-aware",
        label: "OpenClaw aware command",
        category: "target-registry",
        args: ["-e", "setTimeout(() => process.exit(process.argv.includes('--no-openclaw') ? 0 : 1), 250)", "--"],
        openclaw: true,
      },
    ],
    generatedAt: "test",
    inspection,
    openclawPath: false,
    report,
    runs: 1,
  });

  assert.deepEqual(validateRuntimeProfile(profile), []);
  assert.equal(profile.targetOpenClaw.compatRecords, 2);
  assert.equal(profile.fixtureInventory.sourceFiles, 1);
  assert.equal(profile.platform.os, process.platform);
  assert.ok(profile.summary.maxCpuMsEstimate >= 0);
  assert.ok(Number.isFinite(profile.summary.maxHarnessHeapDeltaMb));
  assert.ok(profile.commands.some((command) => command.id === "node-boot" && command.wallMs.max > 0));
  assert.ok(profile.commands.some((command) => command.id === "openclaw-aware"));
  assert.ok(profile.groups.some((group) => group.category === "target-registry" && group.commands.includes("openclaw-aware")));
  assert.ok(profile.groups.every((group) => group.p50WallMs > 0));
  assert.match(renderRuntimeProfileMarkdown(profile), /Target OpenClaw Registry Surface/);
  assert.match(renderRuntimeProfileMarkdown(profile), /Category Rollups/);
  assert.match(renderRuntimeProfileMarkdown(profile), /CPU estimate/);
});

test("runtime profile validation catches failed samples and missing metrics", () => {
  const errors = validateRuntimeProfile({
    commands: [
      {
        id: "bad",
        exitCodes: [1],
        wallMs: { max: 0 },
        peakRssMb: { max: 0 },
      },
    ],
  });

  assert.ok(errors.some((error) => error.includes("nonzero")));
  assert.ok(errors.some((error) => error.includes("wall time")));
  assert.ok(errors.some((error) => error.includes("all commands are missing peak RSS")));
});

test("runtime profile validation accepts partial RSS availability", () => {
  assert.deepEqual(
    validateRuntimeProfile({
      commands: [
        {
          id: "node-boot",
          exitCodes: [0],
          wallMs: { max: 10 },
          peakRssMb: { max: 0 },
        },
        {
          id: "report",
          exitCodes: [0],
          wallMs: { max: 20 },
          peakRssMb: { max: 42 },
        },
      ],
    }),
    [],
  );
});

test("runtime profile validation treats Windows RSS sampling as optional", () => {
  assert.deepEqual(
    validateRuntimeProfile({
      platform: { rssSampler: "unavailable" },
      commands: [
        {
          id: "node-boot",
          exitCodes: [0],
          wallMs: { max: 10 },
          peakRssMb: { max: 0 },
        },
      ],
    }),
    [],
  );
});

test("runtime profile writer emits JSON and Markdown artifacts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-runtime-profile-"));
  const jsonPath = path.join(outputDir, "profile.json");
  const markdownPath = path.join(outputDir, "profile.md");
  const profile = await buildRuntimeProfile({ runs: 1 });

  assert.deepEqual(await writeRuntimeProfile(profile, { jsonPath, markdownPath }), { jsonPath, markdownPath });
  assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).summary.commandCount, 1);
  assert.match(await readFile(markdownPath, "utf8"), /Runtime Profile/);
});
