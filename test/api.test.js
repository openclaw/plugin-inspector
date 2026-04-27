import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  capturePluginEntrypoint,
  inspectFixtureSetConfig,
  inspectPluginRoot,
  loadPluginConfig,
  runPluginCheck,
} from "../src/index.js";

test("public API runs the plugin-root check and writes reports", async () => {
  const pluginRoot = await createPluginRoot();

  const config = await loadPluginConfig({ pluginRoot });
  assert.equal(config.fixtures[0].id, "weather");

  const inspected = await inspectPluginRoot({ pluginRoot, openclawPath: false });
  assert.equal(inspected.status, "pass");
  assert.equal(inspected.targetOpenClaw.status, "disabled");

  const { report, paths } = await runPluginCheck({ pluginRoot, outDir: "reports", openclawPath: false });
  const written = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(written.fixtures[0].id, "weather");
  assert.equal(paths.jsonPath, path.join(pluginRoot, "reports", "plugin-inspector-report.json"));
});

test("public API keeps crabpot-style fixture configs behind an explicit helper", async () => {
  const report = await inspectFixtureSetConfig({ configPath: "test/fixtures/inspector.config.json" });

  assert.equal(report.status, "pass");
  assert.equal(report.summary.fixtureCount, 1);
});

test("public API exposes capture through an explicit entrypoint helper", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-api-capture-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      "export function register(api) {",
      "  api.on('before_tool_call', () => undefined);",
      "  api.registerTool({ name: 'fixture_tool', inputSchema: { type: 'object' }, run() {} });",
      "}",
    ].join("\n"),
    "utf8",
  );

  const result = await capturePluginEntrypoint(entrypoint, {
    apiOptions: { knownRegistrars: ["registerTool"] },
  });

  assert.equal(result.status, "captured");
  assert.deepEqual(
    result.captured.map((item) => `${item.kind}:${item.name}`),
    ["hook:before_tool_call", "registration:registerTool"],
  );
});

async function createPluginRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-api-root-"));
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
