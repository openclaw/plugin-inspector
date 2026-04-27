import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildCiSummary, deriveCiStatus, renderCiSummaryMarkdown, writeCiSummary } from "../src/advanced.js";

test("ci summary rolls up compatibility, policy, ref diff, and profile findings", async () => {
  const summary = await buildCiSummary({
    title: "Crabpot CI Summary",
    mode: "full",
    openclawLabel: "openclaw/openclaw@main",
    reports: {
      compatibility: {
        summary: {
          breakageCount: 0,
          warningCount: 2,
          suggestionCount: 3,
          issueCount: 4,
          p0IssueCount: 1,
          p1IssueCount: 1,
          liveIssueCount: 1,
          compatGapCount: 1,
        },
        issues: [
          {
            severity: "P1",
            issueClass: "inspector-gap",
            fixture: "fixture",
            code: "registration-capture-gap",
            title: "runtime registrations need capture",
            decision: "inspector-follow-up",
          },
        ],
      },
      refDiff: {
        summary: {
          hardRegressionCount: 0,
          warningRegressionCount: 1,
        },
        regressions: [
          {
            action: "warn",
            severity: "P3",
            dimension: "sdkExports",
            code: "sdkExports.removed-unused",
            message: "unused export removed",
          },
        ],
      },
      ciPolicy: {
        summary: {
          failCount: 0,
          warnCount: 1,
        },
        checks: [
          {
            action: "warn",
            id: "execution-results.blocked.fixture.registerChannel.0",
            message: "allowed-blocked",
            evidence: ["registerChannel"],
          },
        ],
      },
      profileDiff: {
        summary: {
          warnCount: 1,
        },
        checks: [
          {
            action: "warn",
            id: "profile.wall-p95",
            metric: "p95WallMs",
            baseline: 100,
            current: 200,
            message: "p95 regressed",
          },
        ],
      },
      execution: {
        summary: {
          passCount: 6,
          failCount: 0,
          blockedCount: 2,
        },
      },
      platform: {
        summary: {
          windowsRiskStepCount: 3,
          containerRiskStepCount: 2,
          jitiAlternativeCount: 1,
        },
      },
      importLoop: {
        summary: {
          p50WallMs: 50,
          p95WallMs: 75,
          maxPeakRssMb: 40,
          maxCpuMsEstimate: 30,
        },
      },
    },
  });

  assert.equal(summary.status, "pass");
  assert.equal(summary.summary.p0Issues, 1);
  assert.equal(summary.summary.policyWarnings, 1);
  assert.equal(summary.summary.platformWindowsRisks, 3);
  assert.equal(summary.summary.loaderJitiCandidates, 1);
  assert.equal(summary.summary.importLoopP50Ms, 50);
  assert.match(renderCiSummaryMarkdown(summary), /Crabpot CI Summary/);
  assert.match(renderCiSummaryMarkdown(summary), /Windows portability risks/);
  assert.match(renderCiSummaryMarkdown(summary), /p50 50 ms \/ p95 75 ms \/ max RSS 40 MB \/ CPU 30 ms/);
  assert.match(renderCiSummaryMarkdown(summary), /\| P0 issues\s+\| 1\s+\|/);
});

test("ci summary status fails on blocking report classes", () => {
  assert.equal(deriveCiStatus({ compatibility: { summary: { breakageCount: 1 } } }), "fail");
  assert.equal(deriveCiStatus({ refDiff: { summary: { hardRegressionCount: 1 } } }), "fail");
  assert.equal(deriveCiStatus({ ciPolicy: { summary: { failCount: 1 } } }), "fail");
  assert.equal(deriveCiStatus({ profileDiff: { summary: { failCount: 1 } } }), "fail");
  assert.equal(deriveCiStatus({ execution: { summary: { failCount: 1 } } }), "fail");
  assert.equal(deriveCiStatus({}), "pass");
});

test("ci summary writer emits JSON and Markdown artifacts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-ci-summary-"));
  const jsonPath = path.join(dir, "summary.json");
  const markdownPath = path.join(dir, "summary.md");
  const summary = await buildCiSummary({
    mode: "isolated",
    openclawLabel: "openclaw/openclaw@fixture",
    reports: {
      execution: {
        summary: {
          passCount: 1,
          failCount: 0,
          blockedCount: 0,
        },
      },
    },
  });

  assert.deepEqual(await writeCiSummary(summary, { jsonPath, markdownPath }), { jsonPath, markdownPath });
  assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).mode, "isolated");
  assert.match(await readFile(markdownPath, "utf8"), /openclaw\/openclaw@fixture/);
});
