import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("capture and synthetic helper CLIs default to the mocked SDK", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-helper-cli-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });

  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "fixture", type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "export default definePluginEntry((api) => api.registerTool({",
      '  name: "fixture-tool",',
      '  description: "fixture",',
      '  run: async () => ({ ok: true }),',
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );

  const captureCli = path.resolve("src/capture-cli.js");
  const syntheticCli = path.resolve("src/synthetic-probes-cli.js");
  const captureOut = path.join(rootDir, "capture.json");
  const syntheticOut = path.join(rootDir, "synthetic.json");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await execFileAsync(process.execPath, [captureCli, "./src/index.js", "--output", captureOut], {
    cwd: rootDir,
    env,
  });
  await execFileAsync(process.execPath, [syntheticCli, "--entrypoint", "./src/index.js", "--output", syntheticOut], {
    cwd: rootDir,
    env,
  });

  const capture = JSON.parse(await readFile(captureOut, "utf8"));
  const synthetic = JSON.parse(await readFile(syntheticOut, "utf8"));

  assert.equal(capture.status, "captured");
  assert.ok(capture.captured.some((item) => item.kind === "registration" && item.name === "registerTool"));
  assert.equal(synthetic.status, "captured");
  assert.equal(synthetic.summary.failCount, 0);
  assert.equal(synthetic.summary.blockedCount, 0);
  assert.ok(synthetic.summary.passCount >= 1);
});

test("capture CLIs ignore values consumed by flags when finding entrypoint", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-capture-cli-args-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });

  const pluginSource = [
    'import { definePluginEntry } from "openclaw/plugin-sdk";',
    "export default definePluginEntry((api) => api.registerTool({",
    '  name: "fixture-tool",',
    '  description: "fixture",',
    '  run: async () => ({ ok: true }),',
    "}));",
    "",
  ].join("\n");
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "fixture", type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(rootDir, "src", "index.js"), pluginSource, "utf8");

  const captureCli = path.resolve("src/capture-cli.js");
  const mainCli = path.resolve("src/cli.js");
  const helperOut = path.join(rootDir, "helper-capture.json");
  const mainOut = path.join(rootDir, "main-capture.json");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await execFileAsync(process.execPath, [captureCli, "--output", helperOut, "--plugin-root", rootDir, "./src/index.js"], {
    cwd: rootDir,
    env,
  });
  await execFileAsync(
    process.execPath,
    [mainCli, "capture", "--output", mainOut, "--plugin-root", rootDir, "--mock-sdk", "--allow-execute", "./src/index.js"],
    {
      cwd: rootDir,
      env,
    },
  );

  assert.equal(JSON.parse(await readFile(helperOut, "utf8")).status, "captured");
  assert.equal(JSON.parse(await readFile(mainOut, "utf8")).status, "captured");
});

test("capture CLI does not overwrite an output path when positional entrypoint is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-capture-cli-missing-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  const entrypointPath = path.join(rootDir, "src", "index.js");
  const originalSource = "export const untouched = true;\n";
  await writeFile(entrypointPath, originalSource, "utf8");

  const captureCli = path.resolve("src/capture-cli.js");
  const env = { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" };

  await assert.rejects(
    execFileAsync(process.execPath, [captureCli, "--output", "./src/index.js"], {
      cwd: rootDir,
      env,
    }),
    /capture requires an entrypoint path/,
  );
  assert.equal(await readFile(entrypointPath, "utf8"), originalSource);
});
