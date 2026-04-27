import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildExecutionResultsReport,
  renderExecutionResultsMarkdown,
  writeExecutionResultsReport,
} from "../src/execution-results.js";

test("execution results summarize capture, synthetic, audit, and profile artifacts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-results-root-"));
  const resultsDir = path.join(rootDir, ".plugin-inspector", "results");
  const fixtureDir = path.join(resultsDir, "wecom");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    path.join(fixtureDir, "entry.capture.json"),
    JSON.stringify({
      entrypoint: path.join(rootDir, ".plugin-inspector/workspaces/wecom/index.js"),
      status: "captured",
      captured: [{ kind: "hook", name: "before_tool_call" }],
    }),
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "entry.synthetic.json"),
    JSON.stringify({
      entrypoint: path.join(rootDir, ".plugin-inspector/workspaces/wecom/index.js"),
      status: "captured",
      summary: { probeCount: 2, passCount: 1, failCount: 0, blockedCount: 1 },
      results: [
        { kind: "hook", seam: "before_tool_call", label: "before_tool_call", status: "pass" },
        {
          kind: "registration",
          seam: "registerChannel",
          label: "registerChannel",
          status: "blocked",
          reason: "channel runtime opt-in",
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "package-audit.json"),
    JSON.stringify({
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 1,
          moderate: 2,
          high: 3,
          critical: 0,
          total: 6,
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "execution-profile.json"),
    JSON.stringify({
      summary: {
        stepCount: 2,
        failCount: 0,
        totalWallMs: 123,
        maxPeakRssMb: 42.5,
        maxCpuMsEstimate: 80,
      },
      steps: [
        {
          kind: "install",
          wallMs: 100,
          peakRssMb: 42.5,
          cpuMsEstimate: 80,
          command: "npm install --ignore-scripts",
        },
      ],
    }),
    "utf8",
  );

  const report = await buildExecutionResultsReport({ rootDir, resultsDir });
  const markdown = renderExecutionResultsMarkdown(report, { title: "Fixture Execution Results" });

  assert.equal(report.resultsDir, ".plugin-inspector/results");
  assert.equal(report.summary.artifactCount, 4);
  assert.equal(report.summary.auditArtifactCount, 1);
  assert.equal(report.summary.profileArtifactCount, 1);
  assert.equal(report.summary.auditFindingCount, 6);
  assert.equal(report.summary.executionWallMs, 123);
  assert.equal(report.summary.maxPeakRssMb, 42.5);
  assert.equal(report.summary.maxCpuMsEstimate, 80);
  assert.equal(report.summary.capturedRegistrationCount, 1);
  assert.equal(report.summary.passCount, 1);
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.artifacts.find((artifact) => artifact.kind === "synthetic").blocked[0].seam, "registerChannel");
  assert.equal(report.artifacts.find((artifact) => artifact.kind === "audit").findingCount, 6);
  assert.match(markdown, /# Fixture Execution Results/);
  assert.match(markdown, /2 steps \/ 123 ms \/ 42.5 MB/);
  assert.match(markdown, /Execution Profiles/);
});

test("execution results count total-only audit metadata", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-results-root-"));
  const fixtureDir = path.join(rootDir, ".plugin-inspector", "results", "minimal");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    path.join(fixtureDir, "package-audit.json"),
    JSON.stringify({
      metadata: {
        vulnerabilities: {
          total: 4,
        },
      },
    }),
    "utf8",
  );

  const report = await buildExecutionResultsReport({ rootDir });

  assert.equal(report.summary.auditFindingCount, 4);
  assert.equal(report.artifacts[0].findingCount, 4);
});

test("execution results handle empty result directories", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-results-root-"));
  const resultsDir = path.join(rootDir, ".plugin-inspector", "missing-results");

  const report = await buildExecutionResultsReport({ rootDir, resultsDir });

  assert.equal(report.summary.artifactCount, 0);
  assert.equal(report.summary.passCount, 0);
  assert.deepEqual(report.artifacts, []);
  assert.match(renderExecutionResultsMarkdown(report), /## Artifacts\n\n_none_/);
});

test("execution results recurse, sort artifacts, and count alternate audit shapes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-results-root-"));
  const resultsDir = path.join(rootDir, ".plugin-inspector", "results");
  await mkdir(path.join(resultsDir, "z-fixture"), { recursive: true });
  await mkdir(path.join(resultsDir, "a-fixture", "nested"), { recursive: true });
  await writeFile(
    path.join(resultsDir, "z-fixture", "package-audit.json"),
    JSON.stringify({ vulnerabilities: [{ id: "one" }, { id: "two" }] }),
    "utf8",
  );
  await writeFile(
    path.join(resultsDir, "a-fixture", "nested", "package-audit.json"),
    JSON.stringify({ vulnerabilities: { low: {}, high: {}, advisory: {} } }),
    "utf8",
  );

  const report = await buildExecutionResultsReport({ rootDir });

  assert.equal(report.summary.artifactCount, 2);
  assert.equal(report.summary.auditFindingCount, 5);
  assert.deepEqual(
    report.artifacts.map((artifact) => artifact.fixture),
    ["nested", "z-fixture"],
  );
  assert.deepEqual(
    report.artifacts.map((artifact) => artifact.findingCount),
    [3, 2],
  );
});

test("execution results writer preserves failures and repo-relative entrypoint paths", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-results-root-"));
  const resultsDir = path.join(rootDir, ".plugin-inspector", "results");
  const fixtureDir = path.join(resultsDir, "broken");
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-execution-report-"));
  const jsonPath = path.join(outputDir, "execution.json");
  const markdownPath = path.join(outputDir, "execution.md");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    path.join(fixtureDir, "entry.synthetic.json"),
    JSON.stringify({
      entrypoint: path.join(rootDir, "plugins/broken/index.js"),
      status: "captured",
      summary: { probeCount: 1, passCount: 0, failCount: 1, blockedCount: 0 },
      results: [
        {
          kind: "registration",
          seam: "registerTool",
          label: "registerTool.execute",
          status: "fail",
          error: "boom",
        },
      ],
    }),
    "utf8",
  );

  const report = await buildExecutionResultsReport({ rootDir });

  assert.equal(report.artifacts[0].entrypoint, "plugins/broken/index.js");
  assert.match(renderExecutionResultsMarkdown(report), /registerTool\.execute/);
  assert.deepEqual(await writeExecutionResultsReport(report, { jsonPath, markdownPath }), { jsonPath, markdownPath });
  assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).summary.failCount, 1);
  assert.match(await readFile(markdownPath, "utf8"), /boom/);
});
