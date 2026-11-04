#!/usr/bin/env node
import { readFlag, readMockSdkFlag, findCaptureEntrypoint as findEntrypoint } from "./cli-options.js";
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

  const result = await captureEntrypoint(entrypoint, { mockSdk, pluginRoot, isolateCapture: true });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    await writeArtifacts([{ path: outputPath, content: json }]);
  } else {
    process.stdout.write(json);
  }
}
