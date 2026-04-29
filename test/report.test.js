import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildSarifReport,
  buildCompatibilityReport,
  buildCompatibilityFixtureReport,
  buildIssues,
  classifyCompatibilityFixture,
  classifyCompatRecordCoverage,
  classifyPackageContracts,
  classifyTargetOpenClawCoverage,
  inspectFixtureSet,
  loadInspectorConfig,
  renderCompatibilityIssuesReport,
  renderCompatibilityMarkdownReport,
  renderJunitXml,
  renderMarkdownReport,
  renderMarkdownTable,
  renderTextSummary,
  writeArtifacts,
  writeCompatibilityReport,
  writeCiOutputArtifacts,
  writeReport,
} from "../src/advanced.js";

test("markdown report includes summary and inventory", async () => {
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);
  const markdown = renderMarkdownReport(report);

  assert.match(markdown, /# OpenClaw Plugin Inspector Report/);
  assert.match(markdown, /\| sample-plugin \| high \| native-tool \| before_tool_call \| definePluginEntry, registerTool \| tools \|/);
});

test("text summary includes artifact paths and top blocking findings", () => {
  const summary = renderTextSummary(
    {
      status: "fail",
      summary: {
        fixtureCount: 1,
        breakageCount: 1,
        issueCount: 1,
        logCount: 0,
      },
      breakages: [
        {
          fixture: "weather",
          code: "missing-expected-seam",
          level: "breakage",
          message: "weather: missing expected registration registerTool",
          evidence: ["src/index.js:12"],
        },
      ],
      warnings: [],
      issues: [
        {
          fixture: "weather",
          code: "sdk-export-missing",
          severity: "P0",
          status: "blocking",
          title: "SDK export is missing",
          evidence: ["src/index.js:1"],
        },
      ],
    },
    {
      artifacts: {
        jsonPath: "reports/plugin-inspector-report.json",
        markdownPath: "reports/plugin-inspector-report.md",
      },
    },
  );

  assert.match(summary, /Status: FAIL/);
  assert.match(summary, /Issues: 1/);
  assert.match(summary, /Reports:/);
  assert.match(summary, /json: reports\/plugin-inspector-report\.json/);
  assert.match(summary, /Top findings:/);
  assert.match(summary, /BREAKAGE weather missing-expected-seam/);
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

test("compatibility report artifacts sanitize absolute OpenClaw target paths", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sanitized-report-"));
  const absoluteOpenClawPath = path.join(outDir, "openclaw");
  const report = {
    generatedAt: "test",
    status: "pass",
    targetOpenClaw: {
      status: "ok",
      configuredPath: absoluteOpenClawPath,
      searchedPaths: [absoluteOpenClawPath],
      compatRecords: [],
      compatRecordStatuses: {},
    },
    summary: {
      fixtureCount: 1,
      highPriorityFixtures: 1,
      breakageCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      decisionCount: 0,
      issueCount: 1,
      p0IssueCount: 0,
      p1IssueCount: 0,
      liveIssueCount: 0,
      liveP0IssueCount: 0,
      compatGapCount: 0,
      deprecationWarningCount: 0,
      inspectorGapCount: 1,
      upstreamIssueCount: 0,
      fixtureRegressionCount: 0,
      contractProbeCount: 0,
    },
    fixtures: [
      {
        id: "sample-plugin",
        priority: "high",
        seams: ["native-tool"],
        hooks: [],
        registrations: [],
        manifestContracts: [],
      },
    ],
    breakages: [],
    warnings: [],
    suggestions: [],
    issues: [
      {
        fixture: "sample-plugin",
        code: "package-dependency-install-required",
        issueClass: "inspector-gap",
        decision: "inspector-follow-up",
        severity: "P2",
        title: `sample-plugin: path ${absoluteOpenClawPath}`,
        status: "open",
        compatStatus: "none",
        live: false,
        evidence: [absoluteOpenClawPath],
      },
    ],
    contractProbes: [],
    logs: [],
    decisions: [],
  };

  const markdown = renderCompatibilityMarkdownReport(report);
  const issues = renderCompatibilityIssuesReport(report);
  const paths = await writeCompatibilityReport(report, {
    jsonPath: path.join(outDir, "report.json"),
    markdownPath: path.join(outDir, "report.md"),
    issuesPath: path.join(outDir, "issues.md"),
  });
  const artifact = JSON.parse(await readFile(paths.jsonPath, "utf8"));

  assert.equal(report.targetOpenClaw.configuredPath, absoluteOpenClawPath);
  assert.equal(artifact.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.deepEqual(artifact.targetOpenClaw.searchedPaths, ["<OPENCLAW_PATH>"]);
  assert.equal(artifact.issues[0].evidence[0], "<OPENCLAW_PATH>");
  assert.equal(artifact.issues[0].title, "sample-plugin: path <OPENCLAW_PATH>");
  assert.doesNotMatch(markdown, new RegExp(escapeRegExp(absoluteOpenClawPath)));
  assert.doesNotMatch(issues, new RegExp(escapeRegExp(absoluteOpenClawPath)));
  assert.match(markdown, /<OPENCLAW_PATH>/);
  assert.match(await readFile(paths.markdownPath, "utf8"), /<OPENCLAW_PATH>/);
  assert.match(await readFile(paths.issuesPath, "utf8"), /<OPENCLAW_PATH>/);
});

test("compatibility report assembly classifies fixtures, issues, probes, and compat records", async () => {
  const report = await buildCompatibilityReport({
    generatedAt: "test",
    fixtures: [
      {
        id: "fixture",
        name: "Fixture",
        path: "plugins/fixture",
        priority: "high",
        seams: ["native-tool"],
        why: "covers native tool seams",
      },
    ],
    inspections: [
      {
        id: "fixture",
        status: "ok",
        hooks: ["before_tool_call"],
        hookDetails: [{ name: "before_tool_call", ref: "plugins/fixture/src/index.ts:1" }],
        registrations: ["registerTool"],
        registrationDetails: [{ name: "registerTool", ref: "plugins/fixture/src/index.ts:2" }],
        manifestContracts: [],
        manifestFiles: [],
        sdkImports: [{ specifier: "openclaw/plugin-sdk", ref: "plugins/fixture/src/index.ts:3" }],
        sourceFiles: ["plugins/fixture/src/index.ts"],
      },
    ],
    failures: ["fixture: missing hooks: missing_hook"],
    targetOpenClaw: {
      status: "ok",
      compatRecords: [],
      compatRecordStatuses: {},
      hookNames: ["before_tool_call"],
      apiRegistrars: ["registerTool"],
      capturedRegistrars: ["registerTool"],
      sdkExports: ["openclaw/plugin-sdk"],
      manifestFields: ["id"],
      manifestContractFields: [],
    },
    buildFixtureReport: ({ fixture, inspection }) => ({
      id: fixture.id,
      name: fixture.name,
      priority: fixture.priority,
      seams: fixture.seams,
      why: fixture.why,
      status: inspection.status,
      hooks: inspection.hooks,
      hookDetails: inspection.hookDetails,
      registrations: inspection.registrations,
      registrationDetails: inspection.registrationDetails,
      manifestContracts: inspection.manifestContracts,
      manifestFiles: [],
      sourceFiles: inspection.sourceFiles,
      pluginManifests: [],
      package: {
        path: "plugins/fixture/package.json",
        name: "fixture-plugin",
        version: "1.0.0",
        dependencies: [],
        peerDependencies: [],
        optionalDependencies: [],
        openclaw: {
          compatPluginApi: "^1.0.0",
          entrypoints: [
            {
              kind: "extension",
              specifier: "dist/index.js",
              relativePath: "plugins/fixture/dist/index.js",
              exists: true,
              requiresBuild: false,
            },
          ],
        },
      },
      packages: [],
      sdkImports: ["openclaw/plugin-sdk"],
      sdkImportDetails: inspection.sdkImports,
    }),
  });

  assert.equal(report.status, "fail");
  assert.equal(report.summary.fixtureCount, 1);
  assert.equal(report.summary.breakageCount, 1);
  assert.ok(report.logs.some((finding) => finding.code === "seam-inventory"));
  assert.ok(report.warnings.some((finding) => finding.code === "legacy-root-sdk-import"));
  assert.ok(report.suggestions.some((finding) => finding.code === "before-tool-call-probe"));
  assert.ok(report.suggestions.some((finding) => finding.code === "missing-compat-record"));
  assert.ok(report.issues.some((issue) => issue.code === "missing-expected-seam"));
  assert.ok(report.contractProbes.some((probe) => probe.id === "hook.before_tool_call.terminal-block-approval:fixture"));
  assert.ok(report.decisions.some((decision) => decision.seam === "compat-registry"));
});

test("compat record coverage logs unavailable targets", () => {
  const logs = [];
  classifyCompatRecordCoverage({
    targetOpenClaw: { status: "missing", configuredPath: "../openclaw" },
    findings: [{ fixture: "fixture", compatRecord: "legacy-root-sdk-import" }],
    suggestions: [],
    logs,
    decisions: [],
  });

  assert.deepEqual(logs[0], {
    fixture: "openclaw",
    code: "target-openclaw-unavailable",
    level: "log",
    message: "target OpenClaw checkout was not available, so compat record coverage was not checked",
    evidence: ["../openclaw"],
  });
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

  const issues = buildIssues({
    suggestions: result.suggestions,
    targetOpenClaw: { status: "ok", compatRecordStatuses: {} },
  });
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === "package-dependency-install-required" &&
        issue.title === "fixture: cold import requires dependency installation in an isolated workspace",
    ),
  );
});

test("target OpenClaw coverage classifier reports missing public surface", () => {
  const result = classifyTargetOpenClawCoverage({
    fixture: { id: "fixture" },
    inspection: {
      hooks: ["missing_hook"],
      hookDetails: [{ name: "missing_hook", ref: "plugins/fixture/src/index.ts:1" }],
      registrationDetails: [{ name: "registerMissing", ref: "plugins/fixture/src/index.ts:2" }],
    },
    fixtureReport: {
      sdkImports: ["openclaw/plugin-sdk/browser-security-runtime", "openclaw/plugin-sdk/missing"],
      sdkImportDetails: [
        {
          specifier: "openclaw/plugin-sdk/browser-security-runtime",
          ref: "plugins/fixture/src/index.ts:3",
        },
        { specifier: "openclaw/plugin-sdk/missing", ref: "plugins/fixture/src/index.ts:4" },
      ],
      pluginManifests: [
        {
          path: "plugins/fixture/openclaw.plugin.json",
          keys: ["id", "unknownField"],
          contracts: ["unknownContract"],
        },
      ],
    },
    targetOpenClaw: {
      status: "ok",
      hookNames: ["known_hook"],
      apiRegistrars: ["registerTool"],
      sdkExports: ["openclaw/plugin-sdk", "openclaw/plugin-sdk/browser-security-runtime"],
      reservedSdkExports: ["openclaw/plugin-sdk/browser-security-runtime"],
      manifestFields: ["id"],
      manifestContractFields: ["tools"],
    },
  });

  assert.ok(result.warnings.some((finding) => finding.code === "unknown-hook-name"));
  assert.ok(result.warnings.some((finding) => finding.code === "unknown-registration-name"));
  assert.ok(result.warnings.some((finding) => finding.code === "reserved-sdk-import"));
  assert.ok(result.warnings.some((finding) => finding.code === "sdk-export-missing"));
  assert.ok(result.warnings.some((finding) => finding.code === "manifest-unknown-fields"));
  assert.ok(result.warnings.some((finding) => finding.code === "manifest-unknown-contracts"));
  assert.ok(result.logs.some((finding) => finding.code === "manifest-fields-checked"));
  assert.ok(result.decisions.some((decision) => decision.seam === "sdk-alias"));
});

test("compatibility fixture classifier reports seam and metadata follow-ups", () => {
  const result = classifyCompatibilityFixture({
    fixture: { id: "fixture", path: "plugins/fixture" },
    inspection: {
      status: "ok",
      hooks: ["llm_input", "before_tool_call"],
      hookDetails: [
        { name: "llm_input", ref: "plugins/fixture/src/index.ts:1" },
        { name: "before_tool_call", ref: "plugins/fixture/src/index.ts:2" },
      ],
      registrations: ["registerTool", "registerService"],
      registrationDetails: [
        { name: "registerTool", ref: "plugins/fixture/src/index.ts:3" },
        { name: "registerService", ref: "plugins/fixture/src/index.ts:4" },
      ],
      manifestContracts: [],
    },
    fixtureReport: {
      sdkImports: ["openclaw/plugin-sdk"],
      sdkImportDetails: [{ specifier: "openclaw/plugin-sdk", ref: "plugins/fixture/src/index.ts:5" }],
      pluginManifests: [
        {
          path: "plugins/fixture/openclaw.plugin.json",
          keys: ["id"],
          contracts: [],
          providerAuthEnvVars: { API_KEY: "api key" },
          channelEnvVars: { CHANNEL_ID: "channel id" },
        },
      ],
      package: null,
    },
    targetOpenClaw: {
      status: "ok",
      hookNames: ["llm_input", "before_tool_call"],
      apiRegistrars: ["registerTool"],
      sdkExports: ["openclaw/plugin-sdk"],
      manifestFields: ["id"],
      manifestContractFields: [],
      capturedRegistrars: ["registerTool"],
    },
  });

  assert.ok(result.warnings.some((finding) => finding.code === "provider-auth-env-vars"));
  assert.ok(result.warnings.some((finding) => finding.code === "channel-env-vars"));
  assert.ok(
    result.warnings.some(
      (finding) =>
        finding.code === "conversation-access-hook" &&
        finding.compatRecord === "hook.llm-observer.privacy-payload",
    ),
  );
  assert.ok(result.warnings.some((finding) => finding.code === "legacy-root-sdk-import"));
  assert.ok(result.warnings.some((finding) => finding.code === "package-json-missing"));
  assert.ok(
    result.suggestions.some(
      (finding) =>
        finding.code === "registration-capture-gap" &&
        finding.compatRecord === "api.capture.runtime-registrars",
    ),
  );
  assert.ok(
    result.suggestions.some(
      (finding) =>
        finding.code === "before-tool-call-probe" &&
        finding.compatRecord === "hook.before_tool_call.terminal-block-approval",
    ),
  );
  assert.ok(result.suggestions.some((finding) => finding.code === "runtime-tool-capture"));
  assert.ok(result.decisions.some((decision) => decision.seam === "conversation-access"));
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

test("CI output helpers write SARIF and JUnit artifacts", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-ci-outputs-"));
  const report = {
    status: "fail",
    summary: { fixtureCount: 1, breakageCount: 1 },
    fixtures: [{ id: "weather", path: "." }],
    breakages: [
      {
        fixture: "weather",
        code: "missing-expected-seam",
        level: "breakage",
        message: "weather: missing expected registration registerTool",
        evidence: ["registerTool @ src/index.js:12:4"],
      },
    ],
    warnings: [],
    suggestions: [],
    issues: [],
  };

  const sarif = buildSarifReport(report);
  const junit = renderJunitXml(report);
  const paths = await writeCiOutputArtifacts(report, {
    outDir,
    sarifPath: "plugin-inspector.sarif",
    junitPath: "plugin-inspector.junit.xml",
  });

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "missing-expected-seam");
  assert.equal(sarif.runs[0].results[0].level, "error");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "src/index.js");
  assert.match(junit, /tests="1" failures="1"/);
  assert.match(junit, /missing expected registration registerTool/);
  assert.equal(JSON.parse(await readFile(paths.sarifPath, "utf8")).runs[0].results.length, 1);
  assert.match(await readFile(paths.junitPath, "utf8"), /<testsuite name="plugin-inspector"/);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
