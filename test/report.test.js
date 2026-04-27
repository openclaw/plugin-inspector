import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildCompatibilityFixtureReport,
  classifyPackageContracts,
  inspectFixtureSet,
  loadInspectorConfig,
  renderCompatibilityIssuesReport,
  renderCompatibilityMarkdownReport,
  renderMarkdownReport,
  renderMarkdownTable,
  writeArtifacts,
  writeReport,
} from "../src/index.js";

test("markdown report includes summary and inventory", async () => {
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);
  const markdown = renderMarkdownReport(report);

  assert.match(markdown, /# OpenClaw Plugin Inspector Report/);
  assert.match(markdown, /\| sample-plugin \| high \| native-tool \| before_tool_call \| definePluginEntry, registerTool \| tools \|/);
});

test("compatibility report renderer supports issue metadata and evidence links", () => {
  const report = {
    generatedAt: "test",
    status: "pass",
    targetOpenClaw: {
      status: "ok",
      compatRecords: ["plugin-sdk-export-aliases"],
      compatRecordStatuses: { "plugin-sdk-export-aliases": "active" },
    },
    summary: {
      fixtureCount: 1,
      highPriorityFixtures: 1,
      breakageCount: 0,
      warningCount: 1,
      suggestionCount: 0,
      decisionCount: 1,
      issueCount: 1,
      p0IssueCount: 1,
      p1IssueCount: 0,
      liveIssueCount: 1,
      liveP0IssueCount: 1,
      compatGapCount: 0,
      deprecationWarningCount: 0,
      inspectorGapCount: 0,
      upstreamIssueCount: 0,
      fixtureRegressionCount: 0,
      contractProbeCount: 1,
    },
    fixtures: [
      {
        id: "sample-plugin",
        priority: "high",
        seams: ["native-tool"],
        hooks: ["before_tool_call"],
        registrations: ["registerTool"],
        manifestContracts: ["tools"],
      },
    ],
    breakages: [],
    warnings: [
      {
        fixture: "sample-plugin",
        code: "sdk-export-missing",
        level: "warning",
        message: "SDK alias is unavailable",
        evidence: ["plugins/sample/src/index.ts:1"],
        compatRecord: "plugin-sdk-export-aliases",
      },
    ],
    suggestions: [],
    issues: [
      {
        fixture: "sample-plugin",
        code: "sdk-export-missing",
        issueClass: "live-issue",
        decision: "core-compat-adapter",
        severity: "P0",
        title: "SDK alias is unavailable",
        status: "blocking",
        compatStatus: "untracked",
        live: true,
        evidence: ["plugins/sample/src/index.ts:1"],
      },
    ],
    contractProbes: [
      {
        fixture: "sample-plugin",
        priority: "P1",
        target: "sdk-alias",
        contract: "package export exists",
        id: "sdk.import.package-export-cold-import:sample-plugin",
        evidence: ["plugins/sample/src/index.ts:1"],
      },
    ],
    logs: [],
    decisions: [
      {
        fixture: "sample-plugin",
        decision: "core-compat-adapter",
        seam: "sdk-alias",
        action: "add compat record",
        evidence: "plugins/sample/src/index.ts:1",
      },
    ],
  };

  const options = {
    title: "Crabpot Compatibility Report",
    severityLabels: { P0: "P0!" },
    formatEvidence: (evidence) => `[linked](${evidence})`,
  };
  const markdown = renderCompatibilityMarkdownReport(report, options);
  const issues = renderCompatibilityIssuesReport(report, {
    ...options,
    title: "Crabpot Issue Findings",
  });

  assert.match(markdown, /# Crabpot Compatibility Report/);
  assert.match(markdown, /## Target OpenClaw Compat Records/);
  assert.match(markdown, /sdk\.import\.package-export-cold-import:sample-plugin/);
  assert.match(issues, /# Crabpot Issue Findings/);
  assert.match(issues, /P0! \*\*sample-plugin\*\* `live-issue` `core-compat-adapter`/);
  assert.match(issues, /\[linked\]\(plugins\/sample\/src\/index\.ts:1\)/);
});

test("compatibility fixture summary reads manifests and OpenClaw package metadata", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-fixture-summary-"));
  const fixtureDir = path.join(rootDir, "plugin");
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(
    path.join(fixtureDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "fixture", name: "Fixture", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(fixtureDir, "src", "index.js"), "export function register() {}\n", "utf8");
  await writeFile(
    path.join(fixtureDir, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-plugin",
        version: "1.0.0",
        type: "module",
        dependencies: { zod: "^1.0.0" },
        openclaw: {
          extensions: ["src/index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const report = await buildCompatibilityFixtureReport({
    rootDir,
    checkoutPath: fixtureDir,
    sourceRoot: fixtureDir,
    fixture: {
      id: "fixture",
      name: "Fixture",
      priority: "high",
      seams: ["native-tool"],
      why: "covers package metadata",
    },
    inspection: {
      status: "ok",
      hooks: [],
      hookDetails: [],
      registrations: ["registerTool"],
      registrationDetails: [],
      manifestContracts: ["tools"],
      manifestFiles: ["plugin/openclaw.plugin.json"],
      sourceFiles: ["plugin/src/index.js"],
      sdkImports: [{ specifier: "openclaw/plugin-sdk" }],
    },
  });

  assert.equal(report.pluginManifests[0].id, "fixture");
  assert.equal(report.package.name, "fixture-plugin");
  assert.equal(report.package.openclaw.compatPluginApi, "^1.0.0");
  assert.deepEqual(report.package.openclaw.entrypoints[0], {
    kind: "extension",
    specifier: "src/index.js",
    relativePath: "plugin/src/index.js",
    exists: true,
    requiresBuild: false,
  });
  assert.deepEqual(report.sdkImports, ["openclaw/plugin-sdk"]);
});

test("package contract classifier reports install and entrypoint blockers", () => {
  const result = classifyPackageContracts({
    fixture: {
      id: "fixture",
      path: "plugins/fixture",
    },
    inspection: {
      registrations: ["registerTool"],
    },
    fixtureReport: {
      pluginManifests: [{ version: "2.0.0" }],
      package: {
        path: "plugins/fixture/package.json",
        name: "fixture-plugin",
        version: "1.0.0",
        dependencies: ["zod"],
        peerDependencies: [],
        optionalDependencies: [],
        openclaw: {
          compatPluginApi: null,
          entrypoints: [
            {
              kind: "extension",
              specifier: "dist/index.js",
              relativePath: "plugins/fixture/dist/index.js",
              exists: false,
              requiresBuild: true,
            },
          ],
        },
      },
    },
  });

  assert.ok(result.logs.some((finding) => finding.code === "package-metadata"));
  assert.ok(result.warnings.some((finding) => finding.code === "package-manifest-version-drift"));
  assert.ok(result.warnings.some((finding) => finding.code === "package-plugin-api-compat-missing"));
  assert.ok(result.suggestions.some((finding) => finding.code === "package-build-artifact-entrypoint"));
  assert.ok(result.suggestions.some((finding) => finding.code === "package-dependency-install-required"));
  assert.ok(result.decisions.some((decision) => decision.seam === "cold-import"));
});

test("writeReport writes JSON and Markdown artifacts", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-report-"));
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);

  const paths = await writeReport(report, { outDir, basename: "report" });
  const json = JSON.parse(await readFile(paths.jsonPath, "utf8"));
  const markdown = await readFile(paths.markdownPath, "utf8");

  assert.equal(json.status, "pass");
  assert.match(markdown, /Status: PASS/);
});

test("artifact helpers write stable CI files", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-artifacts-"));
  const jsonPath = path.join(outDir, "summary.json");
  const markdownPath = path.join(outDir, "summary.md");

  const paths = await writeArtifacts(
    [
      { name: "jsonPath", path: jsonPath, json: { status: "pass" } },
      { name: "markdownPath", path: markdownPath, markdown: "# Summary" },
    ],
    { check: true },
  );

  assert.deepEqual(paths, { jsonPath, markdownPath });
  assert.equal(await readFile(jsonPath, "utf8"), '{\n  "status": "pass"\n}\n');
  assert.equal(await readFile(markdownPath, "utf8"), "# Summary\n");
});

test("markdown table helper supports padded empty-table reports", () => {
  assert.equal(
    renderMarkdownTable(
      [
        ["fixture", "P1"],
        ["none", null],
      ],
      ["Name", "Priority"],
      { padding: true, nullValue: "-", escape: false },
    ),
    ["| Name    | Priority |", "| ------- | -------- |", "| fixture | P1       |", "| none    | -        |"].join("\n"),
  );
  assert.equal(renderMarkdownTable([], ["Name"], { empty: "_none_" }), "_none_");
});
