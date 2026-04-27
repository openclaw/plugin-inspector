import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inferPluginSeams, packageId } from "./config.js";

export const defaultInitConfigPath = "plugin-inspector.config.json";
export const defaultInitWorkflowPath = ".github/workflows/plugin-inspector.yml";

export async function writePluginInspectorInit(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot ?? options.cwd ?? process.cwd());
  const configPath = path.resolve(pluginRoot, options.configPath ?? defaultInitConfigPath);
  const written = [];

  if (existsSync(configPath) && options.force !== true) {
    throw new Error(`${path.relative(pluginRoot, configPath)} already exists; pass --force to overwrite it`);
  }

  const config = await buildPluginInspectorConfig({ pluginRoot });
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  written.push(configPath);

  if (options.ci === true) {
    const workflowPath = path.resolve(pluginRoot, options.workflowPath ?? defaultInitWorkflowPath);
    if (existsSync(workflowPath) && options.force !== true) {
      throw new Error(`${path.relative(pluginRoot, workflowPath)} already exists; pass --force to overwrite it`);
    }
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, renderGithubActionsWorkflow({ packageManager: options.packageManager }), "utf8");
    written.push(workflowPath);
  }

  return { pluginRoot, configPath, written };
}

export async function buildPluginInspectorConfig(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot ?? options.cwd ?? process.cwd());
  const packageJson = await readJsonIfExists(path.join(pluginRoot, "package.json"));
  const pluginManifest = await readJsonIfExists(path.join(pluginRoot, "openclaw.plugin.json"));
  const sourceRoot = inferSourceRoot(packageJson);

  const plugin = {
    id: pluginManifest?.id ?? packageId(packageJson?.name) ?? "plugin",
    priority: "high",
    seams: inferPluginSeams(pluginManifest, packageJson),
  };

  if (sourceRoot !== ".") {
    plugin.sourceRoot = sourceRoot;
  }

  return {
    version: 1,
    plugin,
    capture: {
      mockSdk: true,
    },
  };
}

export function renderGithubActionsWorkflow(options = {}) {
  const packageManager = normalizePackageManager(options.packageManager);
  const setup = packageManagerSetup(packageManager);

  return `name: plugin-inspector

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: ${setup.cache}
${setup.corepack ? "      - run: corepack enable\n" : ""}      - run: ${setup.install}
      - run: ${setup.exec} @openclaw/plugin-inspector check --no-openclaw
      - run: PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 ${setup.exec} @openclaw/plugin-inspector check --no-openclaw --runtime --mock-sdk
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
`;
}

function inferSourceRoot(packageJson) {
  const entrypoints = [
    packageJson?.openclaw?.entrypoint,
    ...(packageJson?.openclaw?.extensions ?? []),
    ...(packageJson?.openclaw?.runtimeExtensions ?? []),
  ].filter((value) => typeof value === "string");
  const entrypoint = entrypoints[0] ?? packageJson?.exports?.["."] ?? packageJson?.main ?? "src/index.js";
  if (typeof entrypoint === "string" && entrypoint.startsWith("src/")) {
    return "src";
  }
  return ".";
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizePackageManager(packageManager = "npm") {
  if (["npm", "pnpm", "yarn", "bun"].includes(packageManager)) {
    return packageManager;
  }
  throw new Error("--package-manager must be npm, pnpm, yarn, or bun");
}

function packageManagerSetup(packageManager) {
  if (packageManager === "pnpm") {
    return {
      cache: "pnpm",
      corepack: true,
      install: "pnpm install --frozen-lockfile",
      exec: "pnpm dlx",
    };
  }
  if (packageManager === "yarn") {
    return {
      cache: "yarn",
      corepack: true,
      install: "yarn install --immutable",
      exec: "yarn dlx",
    };
  }
  if (packageManager === "bun") {
    return {
      cache: "npm",
      corepack: false,
      install: "bun install --frozen-lockfile",
      exec: "bunx",
    };
  }
  return {
    cache: "npm",
    corepack: false,
    install: "npm ci",
    exec: "npx",
  };
}
