import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { packageId } from "../src/config.js";
import {
  buildCiPolicyReport,
  buildCiSummary,
  buildContractCapture,
  buildExecutionResultsReport,
  buildFixtureSetColdImportReadiness,
  buildImportLoopProfile,
  buildFixtureSetPlatformProbes,
  buildFixtureSetWorkspacePlan,
  buildProfileDiff,
  buildRefDiff,
  buildRuntimeProfile,
  buildSyntheticProbePlanFromReport,
  capturePluginEntrypoint,
  ci,
  classifyIssueFinding,
  contracts,
  fixtureSuites,
  inspectFixtureSet,
  inspectCompatibilityFixtureSetConfig,
  inspectFixtureSetConfig,
  inspectPluginRoot,
  inspectSourceText,
  issueId,
  knownIssueCodes,
  loadInspectorConfig,
  loadPluginConfig,
  openClawTargetPathCandidates,
  pluginRoot,
  renderCiPolicyMarkdown,
  renderCiSummaryMarkdown,
  renderContractCaptureMarkdown,
  renderExecutionResultsMarkdown,
  renderImportLoopProfileMarkdown,
  renderMarkdownReport,
  renderFixtureSetColdImportReadinessMarkdown,
  renderFixtureSetIssuesReport,
  renderFixtureSetPlatformProbesMarkdown,
  renderFixtureSetWorkspacePlanMarkdown,
  renderProfileDiffMarkdown,
  renderRefDiffMarkdown,
  renderRuntimeProfileMarkdown,
  renderSyntheticProbeMarkdown,
  reports,
  runtime,
  runCapturedSyntheticProbes,
  runEntrypointSyntheticProbes,
  runFixtureSetColdImportReadiness,
  runFixtureSetPlatformProbes,
  runFixtureSetReport,
  runFixtureSetWorkspacePlan,
  runPluginCheck,
  setupPluginInspector,
  staticInspection,
  synthetic,
  validateCiPolicy,
  validateCiPolicyReport,
  validateContractCapture,
  validateContractCoverage,
  validateColdImportReadiness,
  validateFixtureSetPlatformProbes,
  validateFixtureSetWorkspacePlan,
  validateImportLoopProfile,
  validateProfileDiff,
  validateRefDiff,
  validateRuntimeProfile,
  validateSyntheticProbePlan,
  writeFixtureSetColdImportReadiness,
  writeFixtureSetPlatformProbes,
  writeReport,
  writeFixtureSetReports,
  writeFixtureSetWorkspacePlan,
  writeContractCapture,
  writeCiPolicyReport,
  writeCiSummary,
  writeExecutionResultsReport,
  writeImportLoopProfile,
  writeProfileDiff,
  writeRefDiff,
  writeRuntimeProfile,
  writeSyntheticProbePlan,
} from "../src/index.js";

test("package ids collapse separators and trim hyphen edges", () => {
  assert.equal(packageId("@openclaw/openclaw---Weather_Plugin!!!"), "weather-plugin");
});

test("public API runs the plugin-root check and writes reports", async () => {
  const pluginRoot = await createPluginRoot();

  const config = await loadPluginConfig({ pluginRoot });
  assert.equal(config.fixtures[0].id, "weather");

  const inspected = await inspectPluginRoot({ pluginRoot, openclawPath: false });
  assert.equal(inspected.status, "pass");
  assert.equal(inspected.targetOpenClaw.status, "disabled");

  const { report, paths } = await runPluginCheck({ pluginRoot, outDir: "reports", openclawPath: false });
  const written = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(written.fixtures[0].id, "weather");
  assert.equal(paths.jsonPath, path.join(pluginRoot, "reports", "plugin-inspector-report.json"));
});

test("public API exposes grouped facades for common workflows", () => {
  assert.equal(pluginRoot.loadConfig, loadPluginConfig);
  assert.equal(pluginRoot.inspect, inspectPluginRoot);
  assert.equal(pluginRoot.runCheck, runPluginCheck);
  assert.equal(fixtureSuites.inspect, inspectCompatibilityFixtureSetConfig);
  assert.equal(fixtureSuites.runReport, runFixtureSetReport);
  assert.equal(staticInspection.inspectSourceText, inspectSourceText);
  assert.equal(reports.renderMarkdown, renderMarkdownReport);
  assert.equal(typeof reports.sanitizeArtifact, "function");
  assert.equal(typeof reports.readOpenClawTargetSurface, "function");
  assert.equal(contracts.buildCapture, buildContractCapture);
  assert.equal(contracts.validateCoverage, validateContractCoverage);
  assert.equal(ci.buildSummary, buildCiSummary);
  assert.equal(ci.buildPolicyReport, buildCiPolicyReport);
  assert.equal(runtime.buildProfile, buildRuntimeProfile);
  assert.equal(runtime.buildRefDiff, buildRefDiff);
  assert.equal(synthetic.buildPlanFromReport, buildSyntheticProbePlanFromReport);
  assert.equal(synthetic.runCaptured, runCapturedSyntheticProbes);
  assert.equal(synthetic.runEntrypoint, runEntrypointSyntheticProbes);
});

test("public API reads plugin config from package.json", async () => {
  const pluginRoot = await createPluginRoot({
    packageConfig: {
      plugin: {
        id: "weather-pkg",
        priority: "medium",
        seams: ["channel"],
        sourceRoot: "src",
        expect: {
          registrations: ["definePluginEntry"],
        },
      },
      capture: {
        mockSdk: true,
      },
    },
  });

  const config = await loadPluginConfig({ pluginRoot });

  assert.equal(config.configPath, "package.json#pluginInspector");
  assert.equal(config.fixtures[0].id, "weather-pkg");
  assert.equal(config.fixtures[0].priority, "medium");
  assert.deepEqual(config.fixtures[0].seams, ["channel"]);
  assert.equal(config.capture.mockSdk, true);
});

test("public API keeps crabpot-style fixture configs behind an explicit helper", async () => {
  const report = await inspectFixtureSetConfig({ configPath: "test/fixtures/inspector.config.json" });

  assert.equal(report.status, "pass");
  assert.equal(report.summary.fixtureCount, 1);
});

test("public API exposes static source and fixture-set inspection primitives", async () => {
  const sourceInspection = inspectSourceText(
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "export default definePluginEntry((api) => {",
      '  api.on("before_tool_call", () => undefined);',
      '  api.registerTool({ name: "weather" });',
      "});",
    ].join("\n"),
    "plugins/weather/src/index.js",
  );
  const config = await loadInspectorConfig("test/fixtures/inspector.config.json");
  const report = await inspectFixtureSet(config);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-root-report-"));
  const paths = await writeReport(report, { outDir, basename: "static-inspection" });

  assert.deepEqual(sourceInspection.hooks.map((hook) => hook.name), ["before_tool_call"]);
  assert.deepEqual(sourceInspection.registrations.map((registration) => registration.name), [
    "registerTool",
    "definePluginEntry",
  ]);
  assert.equal(report.status, "pass");
  assert.match(renderMarkdownReport(report), /# OpenClaw Plugin Inspector Report/);
  assert.equal(paths.jsonPath, path.join(outDir, "static-inspection.json"));
});

test("public API writes compatibility fixture-set reports with custom render options", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-fixture-api-"));
  const report = await inspectCompatibilityFixtureSetConfig({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
  });
  const paths = await writeFixtureSetReports(report, {
    jsonPath: path.join(outDir, "suite.json"),
    markdownPath: path.join(outDir, "suite.md"),
    issuesPath: path.join(outDir, "issues.md"),
    markdownTitle: "Fixture Suite Compatibility",
    issuesTitle: "Fixture Suite Issues",
    formatEvidence: (evidence) => `linked:${evidence}`,
  });
  const result = await runFixtureSetReport({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
    outDir,
    basename: "run",
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(paths, {
    jsonPath: path.join(outDir, "suite.json"),
    markdownPath: path.join(outDir, "suite.md"),
    issuesPath: path.join(outDir, "issues.md"),
  });
  assert.match(await readFile(paths.markdownPath, "utf8"), /# Fixture Suite Compatibility/);
  assert.match(await readFile(paths.issuesPath, "utf8"), /# Fixture Suite Issues/);
  assert.equal(JSON.parse(await readFile(paths.jsonPath, "utf8")).summary.fixtureCount, 1);
  assert.equal(result.report.summary.fixtureCount, 1);
  assert.equal(result.paths.jsonPath, path.join(outDir, "run.json"));
});

test("public API builds fixture-set cold import readiness from config", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cold-import-api-"));
  const readiness = await buildFixtureSetColdImportReadiness({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
  });
  const paths = await writeFixtureSetColdImportReadiness(readiness, {
    jsonPath: path.join(outDir, "cold-import.json"),
    markdownPath: path.join(outDir, "cold-import.md"),
    title: "Fixture Cold Import",
  });
  const result = await runFixtureSetColdImportReadiness({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
    write: false,
  });

  assert.equal(readiness.summary.fixtureCount, 1);
  assert.deepEqual(validateColdImportReadiness(readiness), []);
  assert.match(renderFixtureSetColdImportReadinessMarkdown(readiness), /## Entrypoints/);
  assert.equal(JSON.parse(await readFile(paths.jsonPath, "utf8")).summary.fixtureCount, 1);
  assert.equal(result.paths, null);
  assert.equal(result.readiness.summary.fixtureCount, 1);
});

test("public API builds fixture-set workspace and platform plans from config", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-plan-api-"));
  const plan = await buildFixtureSetWorkspacePlan({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
  });
  const planPaths = await writeFixtureSetWorkspacePlan(plan, {
    jsonPath: path.join(outDir, "workspace.json"),
    markdownPath: path.join(outDir, "workspace.md"),
  });
  const platform = await buildFixtureSetPlatformProbes({ plan });
  const coveredPlan = structuredClone(plan);
  coveredPlan.fixtures[0].entrypoints = [
    {
      id: "cold-import.extension:sample-plugin:index",
      status: "dependency-install-required",
      entrypoint: "plugins/sample-plugin/index.js",
      packageManager: "npm",
      loaderStrategy: {
        source: "javascript",
        primary: "node",
        alternatives: [],
        reason: "test",
      },
      steps: [
        {
          kind: "prepare",
          command: "mkdir -p .workspaces/fixture && rsync -a plugins/fixture/ .workspaces/fixture/",
        },
      ],
    },
  ];
  const coveredPlatform = await buildFixtureSetPlatformProbes({
    plan: coveredPlan,
    stepCoverage({ riskCodes }) {
      return { riskCodes };
    },
  });
  const platformPaths = await writeFixtureSetPlatformProbes(platform, {
    jsonPath: path.join(outDir, "platform.json"),
    markdownPath: path.join(outDir, "platform.md"),
  });
  const planResult = await runFixtureSetWorkspacePlan({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
    write: false,
  });
  const platformResult = await runFixtureSetPlatformProbes({ plan, write: false });

  assert.equal(plan.summary.fixtureCount, 1);
  assert.deepEqual(validateFixtureSetWorkspacePlan(plan), []);
  assert.match(renderFixtureSetWorkspacePlanMarkdown(plan), /## Entrypoint Workspaces/);
  assert.equal(JSON.parse(await readFile(planPaths.jsonPath, "utf8")).summary.fixtureCount, 1);
  assert.equal(platform.summary.fixtureCount, 1);
  assert.equal(coveredPlatform.summary.portabilityFindingCount, 0);
  assert.ok(coveredPlatform.summary.coveredPortabilityFindingCount > 0);
  assert.deepEqual(validateFixtureSetPlatformProbes(platform), []);
  assert.match(renderFixtureSetPlatformProbesMarkdown(platform), /## Loader Probes/);
  assert.equal(JSON.parse(await readFile(platformPaths.jsonPath, "utf8")).summary.fixtureCount, 1);
  assert.equal(planResult.paths, null);
  assert.equal(platformResult.paths, null);
});

test("public API exposes capture through an explicit entrypoint helper", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-api-capture-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      "export function register(api) {",
      "  api.on('before_tool_call', () => undefined);",
      "  api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "}",
    ].join("\n"),
    "utf8",
  );

  const result = await capturePluginEntrypoint(entrypoint, {
    apiOptions: { knownRegistrars: ["registerTool"] },
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(
    result.captured.map((item) => `${item.kind}:${item.name}`),
    ["hook:before_tool_call", "registration:registerTool"],
  );
});

test("public API can initialize plugin inspector files", async () => {
  const pluginRoot = await createPluginRoot();

  const result = await setupPluginInspector({ pluginRoot, ci: true, scripts: true, packageManager: "npm" });
  const config = JSON.parse(await readFile(path.join(pluginRoot, "plugin-inspector.config.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8"));
  const workflow = await readFile(path.join(pluginRoot, ".github", "workflows", "plugin-inspector.yml"), "utf8");

  assert.equal(result.written.length, 3);
  assert.equal(result.packageManager, "npm");
  assert.equal(config.plugin.id, "weather");
  assert.equal(config.capture.mockSdk, true);
  assert.equal(packageJson.scripts["plugin:check"], "plugin-inspector inspect --no-openclaw");
  assert.equal(packageJson.scripts["plugin:ci"], "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute");
  assert.match(workflow, /npx @openclaw\/plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute/);
});

test("public API initializes source root from package export maps", async () => {
  const pluginRoot = await createPluginRoot({
    packageJson: {
      openclaw: null,
      exports: {
        ".": {
          import: "./src/plugin-entry.js",
        },
      },
    },
  });

  await setupPluginInspector({ pluginRoot, force: true });
  const config = JSON.parse(await readFile(path.join(pluginRoot, "plugin-inspector.config.json"), "utf8"));

  assert.equal(config.plugin.sourceRoot, "src");
});

test("fixture-set issue renderer is available without advanced internals", () => {
  const markdown = renderFixtureSetIssuesReport(
    {
      generatedAt: "test",
      status: "pass",
      summary: {
        issueCount: 0,
        p0IssueCount: 0,
        p1IssueCount: 0,
        liveIssueCount: 0,
        liveP0IssueCount: 0,
        compatGapCount: 0,
        deprecationWarningCount: 0,
        inspectorGapCount: 0,
        upstreamIssueCount: 0,
        contractProbeCount: 0,
      },
      issues: [],
      contractProbes: [],
    },
    { title: "Fixture Issues" },
  );

  assert.match(markdown, /# Fixture Issues/);
  assert.match(markdown, /## Triage Summary/);
});

test("public API exposes report issue metadata helpers", () => {
  assert.ok(knownIssueCodes.has("registration-capture-gap"));
  assert.match(issueId({ fixture: "weather", code: "registration-capture-gap" }), /^CRABPOT-[A-F0-9]{8}$/);
  assert.equal(classifyIssueFinding({ code: "registration-capture-gap" }).issueClass, "inspector-gap");
  assert.ok(openClawTargetPathCandidates().some((candidate) => candidate.includes("openclaw")));
});

test("public API exposes contract capture and coverage helpers", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-contract-api-"));
  const report = await inspectCompatibilityFixtureSetConfig({
    configPath: "test/fixtures/inspector.config.json",
    openclawPath: false,
  });
  const capture = buildContractCapture({ report });
  const paths = await writeContractCapture(capture, {
    jsonPath: path.join(outDir, "capture.json"),
    markdownPath: path.join(outDir, "capture.md"),
  });

  assert.equal(capture.summary.fixtureCount, 1);
  assert.deepEqual(validateContractCapture(capture), []);
  assert.deepEqual(validateContractCoverage(report), []);
  assert.match(renderContractCaptureMarkdown(capture), /## Registration Capture/);
  assert.equal(JSON.parse(await readFile(paths.jsonPath, "utf8")).summary.fixtureCount, 1);
});

test("public API exposes execution and CI rollup helpers", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-ci-api-"));
  const resultDir = path.join(rootDir, ".plugin-inspector", "results", "weather");
  const outDir = path.join(rootDir, "reports");
  await mkdir(resultDir, { recursive: true });
  await writeFile(
    path.join(resultDir, "entry.synthetic.json"),
    JSON.stringify({
      summary: { probeCount: 1, passCount: 1, failCount: 0, blockedCount: 0 },
      results: [{ kind: "hook", seam: "before_tool_call", label: "before_tool_call", status: "pass" }],
    }),
    "utf8",
  );
  const policy = {
    version: 1,
    allowedBlocked: [],
    expectedWarnings: [],
    thresholds: {
      wallP95RegressionPercent: 50,
      peakRssRegressionMb: 50,
      bootRegressionMs: 500,
      strictMinimumSamples: 3,
    },
    fixtureSets: { smoke: ["weather"] },
  };
  const compatibilityReport = {
    summary: { breakageCount: 0, p1IssueCount: 0 },
    breakages: [],
    issues: [],
  };

  const execution = await buildExecutionResultsReport({ rootDir });
  const policyReport = buildCiPolicyReport({ policy, compatibilityReport, executionResults: execution });
  const summary = await buildCiSummary({
    reports: { compatibility: compatibilityReport, execution, ciPolicy: policyReport },
  });
  const executionPaths = await writeExecutionResultsReport(execution, {
    jsonPath: path.join(outDir, "execution.json"),
    markdownPath: path.join(outDir, "execution.md"),
  });
  const policyPaths = await writeCiPolicyReport(policyReport, {
    jsonPath: path.join(outDir, "policy.json"),
    markdownPath: path.join(outDir, "policy.md"),
  });
  const summaryPaths = await writeCiSummary(summary, {
    jsonPath: path.join(outDir, "summary.json"),
    markdownPath: path.join(outDir, "summary.md"),
  });

  assert.equal(execution.summary.passCount, 1);
  assert.doesNotThrow(() => validateCiPolicy(policy));
  assert.deepEqual(validateCiPolicyReport(policyReport), []);
  assert.equal(summary.status, "pass");
  assert.match(renderExecutionResultsMarkdown(execution), /Execution Results/);
  assert.match(renderCiPolicyMarkdown(policyReport), /CI Policy/);
  assert.match(renderCiSummaryMarkdown(summary), /CI Summary/);
  assert.equal(JSON.parse(await readFile(executionPaths.jsonPath, "utf8")).summary.passCount, 1);
  assert.equal(JSON.parse(await readFile(policyPaths.jsonPath, "utf8")).status, "pass");
  assert.equal(JSON.parse(await readFile(summaryPaths.jsonPath, "utf8")).status, "pass");
});

test("public API exposes runtime profile and diff helpers", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-profile-api-"));
  const runtimeProfile = await buildRuntimeProfile({ runs: 1 });
  const profileDiff = await buildProfileDiff({
    baseline: profileFixture({ p95WallMs: 100, maxPeakRssMb: 80, nodeBootMs: 25 }),
    current: profileFixture({ p95WallMs: 120, maxPeakRssMb: 90, nodeBootMs: 30 }),
    policy: {
      thresholds: {
        wallP95RegressionPercent: 50,
        peakRssRegressionMb: 50,
        bootRegressionMs: 500,
        strictMinimumSamples: 3,
      },
    },
  });
  const refDiff = await buildRefDiff({
    baseReport: diffReport({ hookNames: ["before_tool_call"], issues: [] }),
    headReport: diffReport({ hookNames: ["before_tool_call"], issues: [] }),
  });
  const importLoopProfile = {
    generatedAt: "deterministic",
    mode: "subprocess-cold-import-loop",
    entrypoint: "fixtures/plugin.mjs",
    summary: {
      runs: 1,
      p50WallMs: 5,
      p95WallMs: 5,
      maxPeakRssMb: 10,
      maxCpuMsEstimate: 2,
      capturedCount: 1,
      failCount: 0,
    },
    samples: [
      {
        index: 0,
        status: "captured",
        capturedCount: 1,
        wallMs: 5,
        peakRssMb: 10,
        cpuMsEstimate: 2,
        exitCode: 0,
      },
    ],
  };

  assert.equal(typeof buildImportLoopProfile, "function");
  const portableRuntimeProfile = {
    ...runtimeProfile,
    platform: { ...runtimeProfile.platform, rssSampler: "unavailable" },
  };

  assert.deepEqual(validateRuntimeProfile(portableRuntimeProfile), []);
  assert.deepEqual(validateProfileDiff(profileDiff), []);
  assert.deepEqual(validateRefDiff(refDiff), []);
  assert.deepEqual(validateImportLoopProfile(importLoopProfile), []);
  assert.match(renderRuntimeProfileMarkdown(portableRuntimeProfile), /Runtime Profile/);
  assert.match(renderProfileDiffMarkdown(profileDiff), /Runtime Profile Diff/);
  assert.match(renderRefDiffMarkdown(refDiff), /Ref Diff/);
  assert.match(renderImportLoopProfileMarkdown(importLoopProfile), /Import Loop Profile/);

  const runtimePaths = await writeRuntimeProfile(portableRuntimeProfile, {
    jsonPath: path.join(outDir, "runtime.json"),
    markdownPath: path.join(outDir, "runtime.md"),
  });
  const profileDiffPaths = await writeProfileDiff(profileDiff, {
    jsonPath: path.join(outDir, "profile-diff.json"),
    markdownPath: path.join(outDir, "profile-diff.md"),
  });
  const refDiffPaths = await writeRefDiff(refDiff, {
    jsonPath: path.join(outDir, "ref-diff.json"),
    markdownPath: path.join(outDir, "ref-diff.md"),
  });
  const importLoopPaths = await writeImportLoopProfile(importLoopProfile, {
    jsonPath: path.join(outDir, "import-loop.json"),
    markdownPath: path.join(outDir, "import-loop.md"),
  });

  assert.equal(JSON.parse(await readFile(runtimePaths.jsonPath, "utf8")).summary.commandCount, 1);
  assert.equal(JSON.parse(await readFile(profileDiffPaths.jsonPath, "utf8")).status, "pass");
  assert.equal(JSON.parse(await readFile(refDiffPaths.jsonPath, "utf8")).status, "pass");
  assert.equal(JSON.parse(await readFile(importLoopPaths.jsonPath, "utf8")).summary.runs, 1);
});

test("public API exposes synthetic probe helpers", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-api-"));
  const plan = buildSyntheticProbePlanFromReport({
    generatedAt: "test",
    targetOpenClaw: {
      capturedRegistrars: ["registerTool"],
      sdkExports: [],
    },
    summary: {},
    fixtures: [
      {
        id: "weather",
        priority: "high",
        hookDetails: [{ name: "before_tool_call", ref: "src/index.js:1" }],
        registrationDetails: [{ name: "registerTool", ref: "src/index.js:2" }],
        sdkImportDetails: [],
        packages: [],
      },
    ],
    contractProbes: [],
  });
  const paths = await writeSyntheticProbePlan(plan, {
    jsonPath: path.join(outDir, "synthetic.json"),
    markdownPath: path.join(outDir, "synthetic.md"),
  });

  assert.equal(typeof runCapturedSyntheticProbes, "function");
  assert.equal(typeof runEntrypointSyntheticProbes, "function");
  assert.deepEqual(validateSyntheticProbePlan(plan), []);
  assert.match(renderSyntheticProbeMarkdown(plan), /registerTool/);
  assert.equal(JSON.parse(await readFile(paths.jsonPath, "utf8")).summary.probeCount, 2);
});

test("public API honors config-driven runtime capture", async () => {
  const pluginRoot = await createPluginRoot();
  await writeFile(
    path.join(pluginRoot, "plugin-inspector.config.json"),
    `${JSON.stringify({ version: 1, capture: { runtime: true, mockSdk: true } }, null, 2)}\n`,
    "utf8",
  );

  const result = await runPluginCheck({ pluginRoot, outDir: "reports", openclawPath: false, allowExecution: true });
  assert.equal(result.runtimeCapture.summary.registrationCount, 1);
});

function profileFixture({ p95WallMs, maxPeakRssMb, nodeBootMs }) {
  return {
    runs: 3,
    summary: { p95WallMs, maxPeakRssMb },
    targetOpenClaw: {
      compatRecords: 1,
      hookNames: 1,
      apiRegistrars: 1,
      capturedRegistrars: 1,
      sdkExports: 1,
      manifestFields: 1,
      manifestContractFields: 1,
    },
    fixtureInventory: {},
    commands: [{ id: "node-boot", wallMs: { median: nodeBootMs } }],
  };
}

function diffReport({ hookNames, issues }) {
  return {
    summary: {
      fixtureCount: 1,
      breakageCount: 0,
      issueCount: issues.length,
      p0IssueCount: issues.filter((issue) => issue.severity === "P0").length,
      p1IssueCount: issues.filter((issue) => issue.severity === "P1").length,
    },
    targetOpenClaw: {
      status: "available",
      compatRecords: [],
      hookNames,
      apiRegistrars: ["registerTool"],
      capturedRegistrars: ["registerTool"],
      sdkExports: ["definePluginEntry"],
      manifestFields: ["name"],
      manifestContractFields: ["permissions"],
    },
    fixtures: [
      {
        id: "weather",
        hooks: hookNames,
        registrations: ["registerTool"],
        sdkImports: ["definePluginEntry"],
        pluginManifests: [{ name: "weather" }],
        manifestContracts: ["permissions"],
      },
    ],
    issues,
  };
}

async function createPluginRoot(options = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-api-root-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  const packageJson = {
    name: "@example/openclaw-weather",
    version: "1.0.0",
    type: "module",
    openclaw: {
      extensions: ["src/index.js"],
      compat: { pluginApi: "^1.0.0" },
    },
    ...(options.packageJson ?? {}),
  };
  if (packageJson.openclaw === null) {
    delete packageJson.openclaw;
  }
  if (options.packageConfig) {
    packageJson.pluginInspector = {
      version: 1,
      ...options.packageConfig,
    };
  }
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );
  return rootDir;
}
