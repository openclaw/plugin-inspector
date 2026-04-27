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
