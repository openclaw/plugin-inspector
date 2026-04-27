#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { captureEntrypoint, runCapturedSyntheticProbes, writeArtifacts } from "./advanced.js";
import { createMockSdkPackage } from "./sdk-mock.js";

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

  const capture = await captureForSyntheticProbes(entrypoint, {
    mockSdk,
    pluginRoot,
    apiOptions: { retainHandlers: true },
  });
  const results = await runCapturedSyntheticProbes(capture, {
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

async function captureForSyntheticProbes(entrypoint, options) {
  if (options.mockSdk !== true) {
    return captureEntrypoint(entrypoint, options);
  }

  const resolvedEntrypoint = path.resolve(process.cwd(), entrypoint);
  const pluginRoot = path.resolve(process.cwd(), options.pluginRoot ?? path.dirname(resolvedEntrypoint));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-mock-sdk-"));
  try {
    const { loaderPath } = await createMockSdkPackage(workspace, { pluginRoot });
    register(pathToFileURL(loaderPath));
    return captureEntrypoint(entrypoint, {
      ...options,
      mockSdk: false,
      pluginRoot,
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
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
