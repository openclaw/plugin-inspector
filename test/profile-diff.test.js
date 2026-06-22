import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildProfileDiff,
  defaultProfileDiffOptions,
  renderProfileDiffMarkdown,
  validateProfileDiff,
} from "../src/advanced.js";

const policy = {
  thresholds: {
    wallP95RegressionPercent: 50,
    peakRssRegressionMb: 50,
    bootRegressionMs: 500,
    strictMinimumSamples: 3,
  },
};

test("profile diff warns on noisy regressions by default", async () => {
  const diff = await buildProfileDiff({
    baseline: profile({ p95WallMs: 100, maxPeakRssMb: 100, nodeBootMs: 50, runs: 1 }),
    current: profile({ p95WallMs: 200, maxPeakRssMb: 180, nodeBootMs: 700, runs: 1 }),
    policy,
  });

  assert.equal(diff.generatedAt, defaultProfileDiffOptions.generatedAt);
  assert.equal(diff.status, "pass");
  assert.equal(diff.summary.warnCount, 3);
  assert.deepEqual(validateProfileDiff(diff), []);
  assert.match(renderProfileDiffMarkdown(diff), /Runtime Profile Diff/);
});

test("profile diff fails strict regressions after enough samples", async () => {
  const diff = await buildProfileDiff({
    baseline: profile({ p95WallMs: 100, maxPeakRssMb: 100, nodeBootMs: 50, runs: 3 }),
    current: profile({ p95WallMs: 200, maxPeakRssMb: 180, nodeBootMs: 700, runs: 3 }),
    policy,
    strict: true,
  });

  assert.equal(diff.status, "fail");
  assert.ok(validateProfileDiff(diff).some((error) => error.includes("profile.wall-p95")));
});

test("profile diff does not fail strict regressions before the sample floor", async () => {
  const diff = await buildProfileDiff({
    baseline: profile({ p95WallMs: 100, maxPeakRssMb: 100, nodeBootMs: 50, runs: 3 }),
    current: profile({ p95WallMs: 200, maxPeakRssMb: 180, nodeBootMs: 700, runs: 2 }),
    policy,
    strict: true,
  });

  assert.equal(diff.status, "pass");
  assert.equal(diff.summary.warnCount, 3);
  assert.deepEqual(validateProfileDiff(diff), []);
});

test("profile diff threshold boundaries are inclusive", async () => {
  const diff = await buildProfileDiff({
    baseline: profile({ p95WallMs: 100, maxPeakRssMb: 100, nodeBootMs: 50, runs: 3 }),
    current: profile({ p95WallMs: 150, maxPeakRssMb: 150, nodeBootMs: 550, runs: 3 }),
    policy,
    strict: true,
  });

  assert.equal(diff.status, "pass");
  assert.equal(diff.summary.passCount, 10);
  assert.deepEqual(validateProfileDiff(diff), []);
});

test("profile diff counts array-valued registry surfaces", async () => {
  const diff = await buildProfileDiff({
    baseline: profile({
      p95WallMs: 100,
      maxPeakRssMb: 100,
      nodeBootMs: 50,
      runs: 3,
      targetOpenClaw: { compatRecords: ["one"], sdkExports: ["sdk"] },
    }),
    current: profile({
      p95WallMs: 100,
      maxPeakRssMb: 100,
      nodeBootMs: 50,
      runs: 3,
      targetOpenClaw: { compatRecords: ["one", "two"], sdkExports: ["sdk", "core", "testing"] },
    }),
    policy,
  });

  const compatRecords = diff.checks.find((check) => check.id === "registry.compatRecords");
  const sdkExports = diff.checks.find((check) => check.id === "registry.sdkExports");
  assert.equal(compatRecords.baseline, 1);
  assert.equal(compatRecords.current, 2);
  assert.equal(compatRecords.delta, 1);
  assert.equal(sdkExports.baseline, 1);
  assert.equal(sdkExports.current, 3);
  assert.equal(sdkExports.delta, 2);
});

test("profile diff warns but does not fail when baseline is missing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-profile-baseline-"));
  const diff = await buildProfileDiff({
    baselinePath: path.join(dir, "missing.json"),
    current: profile({ p95WallMs: 100, maxPeakRssMb: 100, nodeBootMs: 50, runs: 3 }),
    policy,
    strict: true,
  });

  assert.equal(diff.status, "pass");
  assert.equal(diff.summary.warnCount, 1);
  assert.equal(diff.checks[0].id, "profile.baseline.missing");
  assert.deepEqual(validateProfileDiff(diff), []);
});

function profile({ p95WallMs, maxPeakRssMb, nodeBootMs, runs, targetOpenClaw = {} }) {
  return {
    runs,
    summary: {
      commandCount: 1,
      p50WallMs: p95WallMs,
      p95WallMs,
      maxPeakRssMb,
    },
    targetOpenClaw: {
      compatRecords: 1,
      hookNames: 2,
      apiRegistrars: 3,
      capturedRegistrars: 4,
      sdkExports: 5,
      manifestFields: 6,
      manifestContractFields: 7,
      ...targetOpenClaw,
    },
    fixtureInventory: {
      fixtures: 1,
      sourceFiles: 1,
      observedHooks: 1,
      observedRegistrations: 1,
      observedSdkImports: 1,
      contractProbes: 1,
      issueFindings: 1,
    },
    commands: [
      {
        id: "node-boot",
        wallMs: { median: nodeBootMs },
      },
    ],
  };
}
