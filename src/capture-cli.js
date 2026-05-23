#!/usr/bin/env node
import { captureEntrypoint, writeArtifacts } from "./advanced.js";

const args = process.argv.slice(2);

try {
  await run(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function run(commandArgs) {
  const entrypoint = findEntrypoint(commandArgs);
  const outputPath = readFlag(commandArgs, "--output");
  const pluginRoot = readFlag(commandArgs, "--plugin-root");
  const mockSdk = readMockSdkFlag(commandArgs) ?? true;

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

function findEntrypoint(commandArgs) {
  const flagsWithValues = new Set(["--output", "--plugin-root", "--sdk"]);
  const consumedIndexes = new Set();
  for (const [index, arg] of commandArgs.entries()) {
    if (flagsWithValues.has(arg)) {
      consumedIndexes.add(index + 1);
    }
  }
  return commandArgs.find((arg, index) => !arg.startsWith("-") && !consumedIndexes.has(index)) ?? null;
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
