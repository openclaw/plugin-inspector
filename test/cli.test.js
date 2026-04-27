import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("check command runs from a plugin root without fixture config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cli-root-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/openclaw-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );

  const cliPath = path.resolve("src/cli.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", "--out", "reports", "--no-openclaw"], {
    cwd: rootDir,
  });
  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const issues = await readFile(path.join(rootDir, "reports", "plugin-inspector-issues.md"), "utf8");

  assert.match(stdout, /Status: PASS/);
  assert.equal(report.targetOpenClaw.status, "disabled");
  assert.equal(report.fixtures[0].id, "weather");
  assert.ok(report.fixtures[0].package.openclaw.entrypoints.some((entrypoint) => entrypoint.exists));
  assert.match(issues, /# OpenClaw Plugin Issue Findings/);
});
