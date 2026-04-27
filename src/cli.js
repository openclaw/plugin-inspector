#!/usr/bin/env node
import {
  renderTextSummary,
  runPluginCheck,
} from "./index.js";
import {
  captureEntrypoint,
  inspectFixtureSet,
  loadInspectorConfig,
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
  } else if (command === "inspect" || command === "report" || command === "ci") {
    await runReport(command, commandArgs);
  } else if (command === "capture") {
    await runCapture(commandArgs);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function runCheck(commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const openclawPath = commandArgs.includes("--no-openclaw") ? false : readFlag(commandArgs, "--openclaw");
  const json = commandArgs.includes("--json");
  const capture = commandArgs.includes("--capture");
  const { report } = await runPluginCheck({ configPath, outDir, openclawPath, capture });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderTextSummary(report));
  }

  if (report.status !== "pass") {
    throw new Error(`plugin-inspector found ${report.summary.breakageCount} breakages`);
  }
}

async function runReport(command, commandArgs) {
  const configPath = readFlag(commandArgs, "--config");
  const outDir = readFlag(commandArgs, "--out") ?? "reports";
  const check = commandArgs.includes("--check") || command === "ci";
  const json = commandArgs.includes("--json");
  const config = await loadInspectorConfig(configPath);
  const report = await inspectFixtureSet(config);
  await writeReport(report, { outDir });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderTextSummary(report));
  }

  if (check && report.status !== "pass") {
    throw new Error(`plugin-inspector found ${report.summary.breakageCount} breakages`);
  }
}

async function runCapture(commandArgs) {
  const entrypoint = commandArgs.find((arg) => !arg.startsWith("-"));
  const outputPath = readFlag(commandArgs, "--output");
  const pluginRoot = readFlag(commandArgs, "--plugin-root");
  const mockSdk = commandArgs.includes("--mock-sdk");
  if (!entrypoint) {
    throw new Error("capture requires an entrypoint path");
  }
  if (process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED !== "1") {
    throw new Error("capture imports plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 in an isolated workspace");
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

function printHelp() {
  console.log(`plugin-inspector

Usage:
  plugin-inspector check [--config <path>] [--out <dir>] [--openclaw <path>] [--no-openclaw] [--capture] [--json]
  plugin-inspector report --config <path> [--out <dir>] [--check] [--json]
  plugin-inspector inspect --config <path> [--out <dir>] [--check] [--json]
  plugin-inspector ci --config <path> [--out <dir>]
  PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector capture <entrypoint> [--mock-sdk] [--plugin-root <path>] [--output <path>]
`);
}
