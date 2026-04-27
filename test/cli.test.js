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

  await execFileAsync(process.execPath, [cliPath, "check", "--out", "capture-reports", "--no-openclaw", "--capture"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1",
    },
  });
  const capture = JSON.parse(
    await readFile(path.join(rootDir, "capture-reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(capture.summary.capturedCount, 1);
  assert.equal(capture.summary.registrationCount, 1);
});

test("check command can target a plugin root and use runtime aliases", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-target-");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "--plugin-root", rootDir, "--out", "reports", "--no-openclaw", "--runtime", "--mock-sdk"],
    {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1",
      },
    },
  );

  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const capture = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(report.fixtures[0].id, "weather");
  assert.equal(capture.summary.capturedCount, 1);
});

test("check command can enable runtime capture from plugin config", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-config-runtime-");
  await writeFile(
    path.join(rootDir, "plugin-inspector.config.json"),
    `${JSON.stringify({ version: 1, capture: { runtime: true, mockSdk: true } }, null, 2)}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(process.execPath, [cliPath, "check", "--out", "reports", "--no-openclaw"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1",
    },
  });

  const capture = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(capture.summary.registrationCount, 1);
});

test("init command writes plugin config and CI workflow", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "init", "--plugin-root", rootDir, "--ci", "--package-manager", "pnpm"],
  );
  const config = JSON.parse(await readFile(path.join(rootDir, "plugin-inspector.config.json"), "utf8"));
  const workflow = await readFile(path.join(rootDir, ".github", "workflows", "plugin-inspector.yml"), "utf8");

  assert.match(stdout, /plugin-inspector\.config\.json/);
  assert.equal(config.plugin.id, "weather");
  assert.equal(config.plugin.sourceRoot, "src");
  assert.equal(config.capture.mockSdk, true);
  assert.match(workflow, /pnpm dlx @openclaw\/plugin-inspector check --no-openclaw/);
  assert.match(workflow, /--runtime --mock-sdk/);
});

async function createCliPluginRoot(prefix) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
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
  return rootDir;
}
