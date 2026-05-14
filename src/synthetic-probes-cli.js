#!/usr/bin/env node
import { runEntrypointSyntheticProbes, writeArtifacts } from "./advanced.js";

const args = process.argv.slice(2);

try {
  await run(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function run(commandArgs) {
  const entrypoint = readFlag(commandArgs, "--entrypoint") ?? commandArgs.find((arg) => !arg.startsWith("-"));
  const outputPath = readFlag(commandArgs, "--output");
  const pluginRoot = readFlag(commandArgs, "--plugin-root");
  const includeLifecycle = commandArgs.includes("--include-lifecycle");
  const includeChannelRuntime = commandArgs.includes("--include-channel-runtime");
  const includeProviderCapabilities = commandArgs.includes("--include-provider-capabilities");
  const mockSdk = readMockSdkFlag(commandArgs) ?? true;

  if (!entrypoint) {
    throw new Error("synthetic probes require --entrypoint <path>");
  }
  if (process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED !== "1") {
    throw new Error("synthetic probes import plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 in an isolated workspace");
  }

  const results = await runEntrypointSyntheticProbes(entrypoint, {
    mockSdk,
    pluginRoot,
    apiOptions: { retainHandlers: true },
    includeLifecycle,
    includeChannelRuntime,
    includeProviderCapabilities,
  });
  const json = `${JSON.stringify(results, null, 2)}\n`;

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
