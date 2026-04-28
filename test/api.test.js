import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildContractCapture,
  buildFixtureSetColdImportReadiness,
  buildFixtureSetPlatformProbes,
  buildFixtureSetWorkspacePlan,
  capturePluginEntrypoint,
  classifyIssueFinding,
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
  renderContractCaptureMarkdown,
  renderMarkdownReport,
  renderFixtureSetColdImportReadinessMarkdown,
  renderFixtureSetIssuesReport,
  renderFixtureSetPlatformProbesMarkdown,
  renderFixtureSetWorkspacePlanMarkdown,
  runFixtureSetColdImportReadiness,
  runFixtureSetPlatformProbes,
  runFixtureSetReport,
  runFixtureSetWorkspacePlan,
  runPluginCheck,
  setupPluginInspector,
  validateContractCapture,
  validateContractCoverage,
  validateColdImportReadiness,
  validateFixtureSetPlatformProbes,
  validateFixtureSetWorkspacePlan,
  writeFixtureSetColdImportReadiness,
  writeFixtureSetPlatformProbes,
  writeReport,
  writeFixtureSetReports,
  writeFixtureSetWorkspacePlan,
  writeContractCapture,
} from "../src/index.js";

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
