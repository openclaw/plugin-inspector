import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureEntrypoint } from "./inspector.js";
import { createMockSdkPackage, installMockSdkLoader } from "./sdk-mock.js";
import { runCapturedSyntheticProbes } from "./synthetic-probes.js";

export async function runEntrypointSyntheticProbes(entrypoint, options = {}) {
  const captureOptions = {
    ...options,
    apiOptions: {
      ...(options.apiOptions ?? {}),
      retainHandlers: true,
    },
  };
  if (options.mockSdk !== true) {
    const capture = await captureEntrypoint(entrypoint, captureOptions);
    return runCapturedSyntheticProbes(capture, options);
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedEntrypoint = path.resolve(cwd, entrypoint);
  const pluginRoot = path.resolve(cwd, options.pluginRoot ?? path.dirname(resolvedEntrypoint));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-synthetic-mock-sdk-"));
  cleanupTempDirOnExit(workspace);
  const mockPackage = await createMockSdkPackage(workspace, { pluginRoot });
  const stopLoader = await installMockSdkLoader(mockPackage);
  try {
    const capture = await captureEntrypoint(entrypoint, {
      ...captureOptions,
      cwd,
      mockSdk: false,
      pluginRoot,
    });
    // Retained handlers can require SDK modules lazily during invocation.
    return await runCapturedSyntheticProbes(capture, options);
  } finally {
    stopLoader();
  }
}

function cleanupTempDirOnExit(dir) {
  process.once("exit", () => {
    rmSync(dir, { force: true, recursive: true });
  });
}
