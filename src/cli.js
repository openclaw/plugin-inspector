#!/usr/bin/env node
import { captureEntrypoint, inspectFixtureSet, loadInspectorConfig, renderTextSummary, writeReport } from "./index.js";

const args = process.argv.slice(2);
const command = args[0];

try {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "inspect" || command === "report" || command === "ci") {
    await runReport(command, args.slice(1));
  } else if (command === "capture") {
    await runCapture(args.slice(1));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
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
  if (!entrypoint) {
    throw new Error("capture requires an entrypoint path");
  }
  if (process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED !== "1") {
    throw new Error("capture imports plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 in an isolated workspace");
  }

  const result = await captureEntrypoint(entrypoint);
  console.log(JSON.stringify(result, null, 2));
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
  plugin-inspector report --config <path> [--out <dir>] [--check] [--json]
  plugin-inspector inspect --config <path> [--out <dir>] [--check] [--json]
  plugin-inspector ci --config <path> [--out <dir>]
  PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector capture <entrypoint>
`);
}
