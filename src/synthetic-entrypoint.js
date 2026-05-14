import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { captureEntrypoint } from "./inspector.js";
import { createMockSdkPackage } from "./sdk-mock.js";
import { runCapturedSyntheticProbes } from "./synthetic-probes.js";

export async function runEntrypointSyntheticProbes(entrypoint, options = {}) {
  const capture = await captureEntrypointForSyntheticProbes(entrypoint, {
    ...options,
    apiOptions: {
      ...(options.apiOptions ?? {}),
      retainHandlers: true,
    },
  });
  return runCapturedSyntheticProbes(capture, options);
}

async function captureEntrypointForSyntheticProbes(entrypoint, options) {
  if (options.mockSdk !== true) {
    return captureEntrypoint(entrypoint, options);
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedEntrypoint = path.resolve(cwd, entrypoint);
  const pluginRoot = path.resolve(cwd, options.pluginRoot ?? path.dirname(resolvedEntrypoint));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-mock-sdk-"));
  cleanupTempDirOnExit(workspace);
  const { loaderPath } = await createMockSdkPackage(workspace, { pluginRoot });
  register(pathToFileURL(loaderPath));

  return captureEntrypoint(entrypoint, {
    ...options,
    cwd,
    mockSdk: false,
    pluginRoot,
  });
}

function cleanupTempDirOnExit(dir) {
  process.once("exit", () => {
    rmSync(dir, { force: true, recursive: true });
  });
}
