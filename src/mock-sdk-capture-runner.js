#!/usr/bin/env node
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCaptureApi } from "./capture-api.js";
import { createMockSdkPackage } from "./sdk-mock.js";

const options = JSON.parse(process.argv[2] ?? "{}");
let activeOutputCapture = null;

try {
  const result = await run(options);
  writeRunnerStdout(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  if (error.failureClass) {
    writeRunnerStderr(`[plugin-inspector:${error.failureClass}]\n`);
  }
  writeRunnerStderr(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

async function run(options) {
  const entrypoint = path.resolve(options.cwd ?? process.cwd(), options.entrypoint);
  const pluginRoot = path.resolve(options.cwd ?? process.cwd(), options.pluginRoot ?? path.dirname(entrypoint));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-mock-sdk-"));

  cleanupTempDirOnExit(workspace);
  const { loaderPath } = await createMockSdkPackage(workspace, { pluginRoot });
  register(pathToFileURL(loaderPath));
  return await captureLinkedEntrypoint(entrypoint, options);
}

function cleanupTempDirOnExit(dir) {
  process.once("exit", () => {
    rmSync(dir, { force: true, recursive: true });
  });
}

async function captureLinkedEntrypoint(entrypoint, options) {
  const outputCapture = installProcessOutputCapture();
  activeOutputCapture = outputCapture;

  let module;
  try {
    module = await import(pathToFileURL(entrypoint).href);
  } catch (error) {
    await drainAsyncOutput();
    throw capturePhaseError(error, "entrypoint-import-error");
  }
  const register = findRegisterExport(module);

  if (!register) {
    await drainAsyncOutput();
    return withProcessOutput(
      {
        status: "no-register-export",
        entrypoint: options.entrypoint,
        mockSdk: true,
        captured: [],
      },
      outputCapture,
    );
  }

  const api = createCaptureApi(options.apiOptions);
  try {
    await register(api);
  } catch (error) {
    await drainAsyncOutput();
    throw capturePhaseError(error, "registration-execution-error");
  }
  await drainAsyncOutput();

  const result = {
    status: "captured",
    entrypoint: options.entrypoint,
    mockSdk: true,
    captured: api.getCapturedContracts(),
  };
  if (options.apiOptions?.retainHandlers === true) {
    result.retained = api.getRetainedContracts();
  }
  return withProcessOutput(result, outputCapture);
}

function withProcessOutput(result, outputCapture) {
  const stdout = outputCapture.stdout();
  const stderr = outputCapture.stderr();
  if (stdout.length === 0 && stderr.length === 0) {
    return result;
  }
  return {
    ...result,
    processOutput: {
      stdout,
      stderr,
    },
  };
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

function installProcessOutputCapture() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    invokeWriteCallback(encoding, callback);
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    invokeWriteCallback(encoding, callback);
    return true;
  };

  return {
    originalStdoutWrite,
    originalStderrWrite,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}

function invokeWriteCallback(encoding, callback) {
  if (typeof encoding === "function") {
    encoding();
  } else if (typeof callback === "function") {
    callback();
  }
}

async function drainAsyncOutput() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
}

function writeRunnerStdout(text) {
  (activeOutputCapture?.originalStdoutWrite ?? process.stdout.write.bind(process.stdout))(text);
}

function writeRunnerStderr(text) {
  (activeOutputCapture?.originalStderrWrite ?? process.stderr.write.bind(process.stderr))(text);
}
