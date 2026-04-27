import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inferPluginSeams, packageId } from "./config.js";

export const defaultInitConfigPath = "plugin-inspector.config.json";
export const defaultInitWorkflowPath = ".github/workflows/plugin-inspector.yml";
export const defaultInitPackageScripts = {
  "plugin:check": "plugin-inspector inspect --no-openclaw",
  "plugin:ci": "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute",
};

export async function writePluginInspectorInit(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot ?? options.cwd ?? process.cwd());
  const configPath = path.resolve(pluginRoot, options.configPath ?? defaultInitConfigPath);
  const workflowPath = options.ci === true ? path.resolve(pluginRoot, options.workflowPath ?? defaultInitWorkflowPath) : null;
  const packageManager = options.packageManager ?? (await detectPackageManager(pluginRoot));
  const written = [];

  if (existsSync(configPath) && options.force !== true) {
    throw new Error(`${path.relative(pluginRoot, configPath)} already exists; pass --force to overwrite it`);
  }
  if (workflowPath && existsSync(workflowPath) && options.force !== true) {
    throw new Error(`${path.relative(pluginRoot, workflowPath)} already exists; pass --force to overwrite it`);
  }
  const packageJsonPath = path.join(pluginRoot, "package.json");
  const packageJson = options.scripts === true ? await readJsonIfExists(packageJsonPath) : null;
  if (options.scripts === true) {
    if (!packageJson) {
      throw new Error("package.json is required to write plugin-inspector package scripts");
    }
    for (const name of Object.keys(defaultInitPackageScripts)) {
      if (packageJson.scripts?.[name] && options.force !== true) {
        throw new Error(`package.json scripts.${name} already exists; pass --force to overwrite it`);
      }
    }
  }

  const config = await buildPluginInspectorConfig({ pluginRoot });
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  written.push(configPath);

  if (workflowPath) {
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, renderGithubActionsWorkflow({ packageManager }), "utf8");
    written.push(workflowPath);
  }

  if (options.scripts === true) {
    const existingScripts = packageJson.scripts ?? {};
    packageJson.scripts = {
      ...existingScripts,
      ...defaultInitPackageScripts,
    };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    written.push(packageJsonPath);
  }

  return { pluginRoot, configPath, packageManager, written };
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
      - run: ${setup.exec} @openclaw/plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
`;
}

export async function detectPackageManager(pluginRoot) {
  const root = path.resolve(pluginRoot ?? process.cwd());
  const packageJson = await readJsonIfExists(path.join(root, "package.json"));
  const packageManager = packageJson?.packageManager;
  if (typeof packageManager === "string") {
    const [name] = packageManager.split("@");
    if (["npm", "pnpm", "yarn", "bun"].includes(name)) {
      return name;
    }
  }

  if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function inferSourceRoot(packageJson) {
  const entrypoints = [
    packageJson?.openclaw?.entrypoint,
    ...(packageJson?.openclaw?.extensions ?? []),
    ...(packageJson?.openclaw?.runtimeExtensions ?? []),
    ...entrypointStrings(packageJson?.exports?.["."]),
    ...entrypointStrings(packageJson?.exports),
    packageJson?.module,
    packageJson?.main,
  ].filter((value) => typeof value === "string");
  const entrypoint = entrypoints[0] ?? "src/index.js";
  if (stripRelativePrefix(entrypoint).startsWith("src/")) {
    return "src";
  }
  return ".";
}

function entrypointStrings(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return ["import", "default", "require", "node", "module"]
    .map((key) => value[key])
    .filter((item) => typeof item === "string");
}

function stripRelativePrefix(filePath) {
  return filePath.replace(/^\.\//, "");
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
