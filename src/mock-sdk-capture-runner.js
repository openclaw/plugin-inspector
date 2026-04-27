#!/usr/bin/env node
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCaptureApi } from "./capture-api.js";
import { createMockSdkPackage } from "./sdk-mock.js";

const options = JSON.parse(process.argv[2] ?? "{}");

try {
  const result = await run(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  if (error.failureClass) {
    process.stderr.write(`[plugin-inspector:${error.failureClass}]\n`);
  }
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

async function run(options) {
  const entrypoint = path.resolve(options.cwd ?? process.cwd(), options.entrypoint);
  const pluginRoot = path.resolve(options.cwd ?? process.cwd(), options.pluginRoot ?? path.dirname(entrypoint));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-sdk-"));

  try {
    await createMockSdkPackage(workspace);
    const linkedPluginRoot = path.join(workspace, "plugin");
    await symlink(pluginRoot, linkedPluginRoot, "junction");
    const linkedEntrypoint = path.join(linkedPluginRoot, path.relative(pluginRoot, entrypoint));
    return await captureLinkedEntrypoint(linkedEntrypoint, options);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function captureLinkedEntrypoint(entrypoint, options) {
  let module;
  try {
    module = await import(pathToFileURL(entrypoint).href);
  } catch (error) {
    throw capturePhaseError(error, "entrypoint-import-error");
  }
  const register = findRegisterExport(module);

  if (!register) {
    return {
      status: "no-register-export",
      entrypoint: options.entrypoint,
      mockSdk: true,
      captured: [],
    };
  }

  const api = createCaptureApi(options.apiOptions);
  try {
    await register(api);
  } catch (error) {
    throw capturePhaseError(error, "registration-execution-error");
  }
  const result = {
    status: "captured",
    entrypoint: options.entrypoint,
    mockSdk: true,
    captured: api.getCapturedContracts(),
  };
  if (options.apiOptions?.retainHandlers === true) {
    result.retained = api.getRetainedContracts();
  }
  return result;
}

function capturePhaseError(error, failureClass) {
  error.failureClass = failureClass;
  return error;
}

function findRegisterExport(module) {
  if (typeof module.register === "function") {
    return module.register;
  }
  if (typeof module.default === "function") {
    return module.default;
  }
  if (typeof module.default?.register === "function") {
    return module.default.register;
  }
  return null;
}
