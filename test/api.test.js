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
  setupPluginInspector,
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

test("public API reads plugin config from package.json", async () => {
  const pluginRoot = await createPluginRoot({
    packageConfig: {
      plugin: {
        id: "weather-pkg",
        priority: "medium",
        seams: ["channel"],
        sourceRoot: "src",
        expect: {
          registrations: ["definePluginEntry"],
        },
      },
      capture: {
        mockSdk: true,
      },
    },
  });

  const config = await loadPluginConfig({ pluginRoot });

  assert.equal(config.configPath, "package.json#pluginInspector");
  assert.equal(config.fixtures[0].id, "weather-pkg");
  assert.equal(config.fixtures[0].priority, "medium");
  assert.deepEqual(config.fixtures[0].seams, ["channel"]);
  assert.equal(config.capture.mockSdk, true);
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

test("public API can initialize plugin inspector files", async () => {
  const pluginRoot = await createPluginRoot();

  const result = await setupPluginInspector({ pluginRoot, ci: true, packageManager: "npm" });
  const config = JSON.parse(await readFile(path.join(pluginRoot, "plugin-inspector.config.json"), "utf8"));
  const workflow = await readFile(path.join(pluginRoot, ".github", "workflows", "plugin-inspector.yml"), "utf8");

  assert.equal(result.written.length, 2);
  assert.equal(config.plugin.id, "weather");
  assert.equal(config.capture.mockSdk, true);
  assert.match(workflow, /npx @openclaw\/plugin-inspector check --no-openclaw/);
});

test("public API honors config-driven runtime capture", async () => {
  const pluginRoot = await createPluginRoot();
  await writeFile(
    path.join(pluginRoot, "plugin-inspector.config.json"),
    `${JSON.stringify({ version: 1, capture: { runtime: true, mockSdk: true } }, null, 2)}\n`,
    "utf8",
  );

  const previous = process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED;
  process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED = "1";
  try {
    const result = await runPluginCheck({ pluginRoot, outDir: "reports", openclawPath: false });
    assert.equal(result.runtimeCapture.summary.registrationCount, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED;
    } else {
      process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED = previous;
    }
  }
});

async function createPluginRoot(options = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-api-root-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  const packageJson = {
    name: "@example/openclaw-weather",
    version: "1.0.0",
    type: "module",
    openclaw: {
      extensions: ["src/index.js"],
      compat: { pluginApi: "^1.0.0" },
    },
  };
  if (options.packageConfig) {
    packageJson.pluginInspector = {
      version: 1,
      ...options.packageConfig,
    };
  }
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
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
