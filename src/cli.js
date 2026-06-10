#!/usr/bin/env node
import path from "node:path";
import {
  loadPluginConfig,
  renderTextSummary,
  runBatchAnalysis,
  sanitizeReportArtifact,
  runPluginCheck,
} from "./index.js";
import {
  buildCiSummary,
  captureEntrypoint,
  defaultJunitPath,
  defaultSarifPath,
  inspectCompatibilityFixtureSet,
  inspectFixtureSet,
  loadInspectorConfig,
  writeCiOutputArtifacts,
  writeCiSummary,
  writeCompatibilityReport,
  writePluginInspectorInit,
  writeArtifacts,
  writeReport,
} from "./advanced.js";

const args = process.argv.slice(2);
const command = args[0]?.startsWith("-") ? "check" : (args[0] ?? "check");
const commandArgs = args[0]?.startsWith("-") ? args : args.slice(1);

try {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
  } else if (command === "check") {
    await runCheck(commandArgs);
  } else if (command === "init") {
    await runInit(commandArgs);
  } else if (command === "config") {
    await runConfig(commandArgs);
  } else if (command === "inspect" || command === "report") {
    if (command === "inspect" && !commandArgs.includes("--config")) {
      await runCheck(commandArgs);
    } else {
      await runReport(command, commandArgs);
    }
  } else if (command === "ci") {
    await runCi(commandArgs);
  } else if (command === "batch") {
    await runBatch(commandArgs);
  } else if (command === "capture") {
    await runCapture(commandArgs);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function runBatch(commandArgs) {
  const inputDir = readFirstPositional(commandArgs, new Set(["--out", "--openclaw", "--concurrency"]));
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const openclawPath = commandArgs.includes("--no-openclaw") ? false : readFlag(commandArgs, "--openclaw");
  const concurrency = Number(readFlag(commandArgs, "--concurrency") ?? "4");
  const json = commandArgs.includes("--json");
  const check = commandArgs.includes("--check");
  const keepPluginReports = commandArgs.includes("--keep-plugin-reports");
  const authorFacing = readAuthorFacingFlag(commandArgs);
  if (!inputDir) {
    throw new Error("batch requires a folder of plugin roots");
  }
  const { report, paths } = await runBatchAnalysis({
    rootDir: inputDir,
    outDir,
    openclawPath,
    concurrency,
    authorFacing,
    keepPluginReports,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBatchTextSummary(report, paths));
  }

  if (check && report.summary.pluginsWithErrors > 0) {
    throw new Error(`plugin-inspector batch found ${report.summary.pluginsWithErrors} plugin(s) with errors`);
  }
}

async function runConfig(commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const pluginRoot = readFlag(commandArgs, "--plugin-root") ?? readFlag(commandArgs, "--root");
  const config = await loadPluginConfig({ configPath, pluginRoot });

  if (commandArgs.includes("--json")) {
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log(renderConfigTextSummary(config));
  }
}

async function runCheck(commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const pluginRoot = readFlag(commandArgs, "--plugin-root") ?? readFlag(commandArgs, "--root");
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const openclawPath = commandArgs.includes("--no-openclaw") ? false : readFlag(commandArgs, "--openclaw");
  const json = commandArgs.includes("--json");
  const capture = readRuntimeFlag(commandArgs);
  const mockSdk = readMockSdkFlag(commandArgs);
  const allowExecution = readAllowExecutionFlag(commandArgs);
  const ciOutputs = readCiOutputFlags(commandArgs);
  const authorFacing = readAuthorFacingFlag(commandArgs);
  const { report, paths } = await runPluginCheck({
    allowExecution,
    authorFacing,
    capture,
    configPath,
    mockSdk,
    openclawPath,
    outDir,
    pluginRoot,
  });
  await writeCiOutputArtifacts(report, {
    ...ciOutputs,
    cwd: path.dirname(paths.jsonPath),
    outDir: ".",
  });

  if (json) {
    console.log(JSON.stringify(sanitizeReportArtifact(report), null, 2));
  } else {
    console.log(renderTextSummary(report, { artifacts: paths }));
  }

  if (report.status !== "pass") {
    throw new Error(`plugin-inspector found ${report.summary.breakageCount} breakages`);
  }
}

async function runInit(commandArgs) {
  const pluginRoot = readFlag(commandArgs, "--plugin-root") ?? readFlag(commandArgs, "--root");
  const configPath = readFlag(commandArgs, "--config") ?? undefined;
  const workflowPath = readFlag(commandArgs, "--workflow") ?? undefined;
  const packageManager = readFlag(commandArgs, "--package-manager") ?? undefined;
  const result = await writePluginInspectorInit({
    pluginRoot,
    configPath,
    workflowPath,
    packageManager,
    ci: commandArgs.includes("--ci"),
    dryRun: commandArgs.includes("--dry-run"),
    scripts: commandArgs.includes("--scripts"),
    force: commandArgs.includes("--force"),
  });

  if (commandArgs.includes("--json")) {
    console.log(JSON.stringify(initCommandSummary(result), null, 2));
    return;
  }

  for (const filePath of result.written) {
    console.log(`${result.dryRun ? "would write" : "wrote"} ${path.relative(result.pluginRoot, filePath)}`);
  }
  console.log(`package manager: ${result.packageManager}`);
}

async function runReport(command, commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const openclawPath = commandArgs.includes("--no-openclaw") ? false : readFlag(commandArgs, "--openclaw");
  const check = commandArgs.includes("--check") || command === "ci";
  const json = commandArgs.includes("--json");
  const ciOutputs = readCiOutputFlags(commandArgs);
  const authorFacing = readAuthorFacingFlag(commandArgs);
  const config = await loadInspectorConfig(configPath);
  const report = authorFacing
    ? await inspectCompatibilityFixtureSet(config, { authorFacing, openclawPath })
    : await inspectFixtureSet(config);
  const paths = authorFacing
    ? await writeCompatibilityReport(report, { cwd: config.rootDir, outDir })
    : await writeReport(report, { outDir });
  await writeCiOutputArtifacts(report, {
    ...ciOutputs,
    cwd: path.dirname(paths.jsonPath),
    outDir: ".",
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderTextSummary(report, { artifacts: paths }));
  }

  if (check && report.status !== "pass") {
    throw new Error(`plugin-inspector found ${report.summary.breakageCount} breakages`);
  }
}

async function runCi(commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const pluginRoot = readFlag(commandArgs, "--plugin-root") ?? readFlag(commandArgs, "--root");
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const openclawPath = commandArgs.includes("--no-openclaw") ? false : readFlag(commandArgs, "--openclaw");
  const json = commandArgs.includes("--json");
  const capture = readRuntimeFlag(commandArgs);
  const mockSdk = readMockSdkFlag(commandArgs);
  const allowExecution = readAllowExecutionFlag(commandArgs);
  const ciOutputs = readCiOutputFlags(commandArgs, { defaultEnabled: true });
  const authorFacing = readAuthorFacingFlag(commandArgs);
  const { report, reportDir } = await runCiCompatibilityReport({
    allowExecution,
    authorFacing,
    capture,
    configPath,
    mockSdk,
    openclawPath,
    outDir,
    pluginRoot,
  });

  const summary = await buildCiSummary({
    artifactBaseDir: reportDir,
    reportPaths: {
      compatibility: "plugin-inspector-report.json",
    },
    reports: {
      compatibility: report,
    },
  });
  await writeCiSummary(summary, {
    jsonPath: path.join(reportDir, "plugin-inspector-ci-summary.json"),
    markdownPath: path.join(reportDir, "plugin-inspector-ci-summary.md"),
  });
  await writeCiOutputArtifacts(report, {
    ...ciOutputs,
    cwd: reportDir,
    outDir: ".",
  });

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(renderCiTextSummary(summary));
  }

  if (summary.status !== "pass") {
    throw new Error("plugin-inspector ci summary failed");
  }
}

async function runCiCompatibilityReport({
  allowExecution,
  authorFacing,
  capture,
  configPath,
  mockSdk,
  openclawPath,
  outDir,
  pluginRoot,
}) {
  if (configPath) {
    const config = await loadInspectorConfig(configPath, { cwd: pluginRoot });
    const report = await inspectCompatibilityFixtureSet(config, { authorFacing, openclawPath });
    await writeCompatibilityReport(report, { cwd: config.rootDir, outDir });
    return {
      report,
      reportDir: path.resolve(config.rootDir, outDir),
    };
  }

  const { report } = await runPluginCheck({
    allowExecution,
    authorFacing,
    capture,
    mockSdk,
    openclawPath,
    outDir,
    pluginRoot,
  });
  return {
    report,
    reportDir: path.resolve(pluginRoot ?? process.cwd(), outDir),
  };
}

async function runCapture(commandArgs) {
  const entrypoint = findCaptureEntrypoint(commandArgs);
  const outputPath = readFlag(commandArgs, "--output");
  const pluginRoot = readFlag(commandArgs, "--plugin-root");
  const mockSdk = readMockSdkFlag(commandArgs) ?? commandArgs.includes("--mock-sdk");
  const allowExecution = readAllowExecutionFlag(commandArgs);
  if (!entrypoint) {
    throw new Error("capture requires an entrypoint path");
  }
  if (!allowExecution && process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED !== "1") {
    throw new Error("capture imports plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 or --allow-execute in an isolated workspace");
  }

  const result = await captureEntrypoint(entrypoint, { mockSdk, pluginRoot });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    await writeArtifacts([{ path: outputPath, content: json }]);
  } else {
    process.stdout.write(json);
  }
}

function readFlag(commandArgs, name) {
  const index = commandArgs.indexOf(name);
  if (index === -1) {
    return null;
  }
  return commandArgs[index + 1] ?? null;
}

function findCaptureEntrypoint(commandArgs) {
  const flagsWithValues = new Set(["--output", "--plugin-root", "--sdk"]);
  const consumedIndexes = new Set();
  for (const [index, arg] of commandArgs.entries()) {
    if (flagsWithValues.has(arg)) {
      consumedIndexes.add(index + 1);
    }
  }
  return commandArgs.find((arg, index) => !arg.startsWith("-") && !consumedIndexes.has(index)) ?? null;
}

function readOptionalPathFlag(commandArgs, name, defaultPath) {
  const index = commandArgs.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = commandArgs[index + 1];
  return value && !value.startsWith("-") ? value : defaultPath;
}

function readCiOutputFlags(commandArgs, options = {}) {
  return {
    sarifPath: commandArgs.includes("--no-sarif")
      ? null
      : (readOptionalPathFlag(commandArgs, "--sarif", defaultSarifPath) ?? (options.defaultEnabled ? defaultSarifPath : null)),
    junitPath: commandArgs.includes("--no-junit")
      ? null
      : (readOptionalPathFlag(commandArgs, "--junit", defaultJunitPath) ?? (options.defaultEnabled ? defaultJunitPath : null)),
  };
}

function readRuntimeFlag(commandArgs) {
  if (commandArgs.includes("--runtime") || commandArgs.includes("--capture")) {
    return true;
  }
  if (commandArgs.includes("--no-runtime") || commandArgs.includes("--no-capture")) {
    return false;
  }
  return undefined;
}

function readMockSdkFlag(commandArgs) {
  const sdk = readFlag(commandArgs, "--sdk");
  if (sdk === "mock") {
    return true;
  }
  if (sdk === "real") {
    return false;
  }
  if (sdk && !["mock", "real"].includes(sdk)) {
    throw new Error("--sdk must be mock or real");
  }
  if (commandArgs.includes("--mock-sdk")) {
    return true;
  }
  if (commandArgs.includes("--real-sdk")) {
    return false;
  }
  return undefined;
}

function readAllowExecutionFlag(commandArgs) {
  return commandArgs.includes("--allow-execute");
}

function readAuthorFacingFlag(commandArgs) {
  if (commandArgs.includes("--include-inspector-gaps")) {
    throw new Error(
      "--include-inspector-gaps has been replaced by --author-facing; default output now includes internal findings.",
    );
  }
  return commandArgs.includes("--author-facing");
}

function renderCiTextSummary(summary) {
  return [
    `Status: ${summary.status.toUpperCase()}`,
    `Breakages: ${summary.summary.breakages}`,
    `Issues: ${summary.summary.issues}`,
    `Artifacts: ${Object.values(summary.artifacts).filter(Boolean).length}`,
  ].join("\n");
}

function renderBatchTextSummary(report, paths) {
  const lines = [
    "Plugin Inspector Batch",
    `Plugins: ${report.summary.pluginCount}`,
    `Plugins with errors: ${report.summary.pluginsWithErrors}`,
    `Plugins with warnings: ${report.summary.pluginsWithWarnings}`,
    `Finding codes: ${report.summary.findingCodeCount}`,
    "",
    "Reports:",
    `- JSON: ${paths.jsonPath}`,
    `- Markdown: ${paths.markdownPath}`,
  ];
  const topFinding = report.findingFrequency[0];
  if (topFinding) {
    lines.push("", `Top finding: ${topFinding.code} (${topFinding.plugins} plugin(s))`);
  }
  return lines.join("\n");
}

function readFirstPositional(args, valueFlags = new Set()) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) return arg;
    if (valueFlags.has(arg)) index += 1;
  }
  return undefined;
}

function initCommandSummary(result) {
  return {
    dryRun: result.dryRun,
    packageManager: result.packageManager,
    pluginRoot: result.pluginRoot,
    files: result.written.map((filePath) => path.relative(result.pluginRoot, filePath)),
  };
}

function renderConfigTextSummary(config) {
  const fixture = config.fixtures[0];
  return [
    `Plugin: ${fixture.id}`,
    `Root: ${config.rootDir}`,
    `Config: ${config.configPath ?? "auto"}`,
    `Priority: ${fixture.priority}`,
    `Seams: ${fixture.seams.join(", ")}`,
    `Runtime capture: ${config.capture?.runtime === true ? "on" : "off"}`,
    `Mock SDK: ${config.capture?.mockSdk === false ? "off" : "on"}`,
  ].join("\n");
}

function printHelp() {
  console.log(`plugin-inspector

Usage:
  plugin-inspector
  plugin-inspector check [--plugin-root <path>] [--config <path>] [--out <dir>] [--openclaw <path>] [--no-openclaw] [--runtime] [--mock-sdk|--real-sdk] [--allow-execute] [--author-facing] [--json]
  plugin-inspector config [--plugin-root <path>] [--config <path>] [--json]
  plugin-inspector init [--plugin-root <path>] [--config <path>] [--ci] [--scripts] [--package-manager npm|pnpm|yarn|bun] [--dry-run] [--json] [--force]
  plugin-inspector report --config <path> [--out <dir>] [--openclaw <path>] [--no-openclaw] [--author-facing] [--check] [--json]
  plugin-inspector batch <folder> [--out <dir>] [--openclaw <path>] [--no-openclaw] [--concurrency <n>] [--keep-plugin-reports] [--author-facing] [--check] [--json]
  plugin-inspector inspect [--plugin-root <path>] [--config <path>] [--out <dir>] [--openclaw <path>] [--no-openclaw] [--author-facing] [--check] [--json] [--sarif [path]] [--junit [path]] [--allow-execute]
  plugin-inspector ci [--plugin-root <path>] [--config <path>] [--out <dir>] [--openclaw <path>] [--no-openclaw] [--runtime] [--mock-sdk|--real-sdk] [--allow-execute] [--author-facing] [--json] [--no-sarif] [--no-junit]
  plugin-inspector capture <entrypoint> [--mock-sdk|--real-sdk] [--allow-execute] [--plugin-root <path>] [--output <path>]

Default check runs from the current plugin root and writes reports/ unless --out is set.
CI writes SARIF and JUnit artifacts by default; check/inspect can write them with --sarif and --junit.
Runtime capture is opt-in because it imports plugin code; use --runtime with --allow-execute or PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1.
Default output includes author-facing and internal findings; pass --author-facing to show only findings with author remediation docs.
`);
}
