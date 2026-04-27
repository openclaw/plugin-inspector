import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const npmPackagePayloadDir = ".crabpot-package";
export const defaultPluginRootConfigFiles = ["plugin-inspector.config.json", ".plugin-inspector.json"];

export async function loadInspectorConfig(configPath, options = {}) {
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), configPath);
  const config = JSON.parse(await readFile(resolvedPath, "utf8"));
  const rootDir = path.resolve(options.cwd ?? process.cwd(), options.rootDir ?? path.dirname(resolvedPath));
  const normalizedConfig = await normalizeInspectorConfig(config, { rootDir });
  validateInspectorConfig(normalizedConfig);
  return {
    ...normalizedConfig,
    rootDir,
    configPath: resolvedPath,
  };
}

export async function loadPluginRootConfig(configPath = null, options = {}) {
  const rootDir = path.resolve(options.cwd ?? process.cwd());
  const resolvedPath = configPath ? path.resolve(rootDir, configPath) : findPluginRootConfigPath(rootDir);
  if (!resolvedPath && !existsSync(path.join(rootDir, "package.json")) && !existsSync(path.join(rootDir, "openclaw.plugin.json"))) {
    throw new Error("run from a plugin root with package.json/openclaw.plugin.json, or pass --config");
  }
  const config = resolvedPath ? JSON.parse(await readFile(resolvedPath, "utf8")) : { version: 1 };
  const normalizedConfig = await normalizePluginRootConfig(config, { rootDir });
  validateInspectorConfig(normalizedConfig);
  return {
    ...normalizedConfig,
    rootDir,
    configPath: resolvedPath,
  };
}

export function validateInspectorConfig(config) {
  const errors = [];

  if (config.version !== 1) {
    errors.push("config.version must be 1");
  }

  if (!config.submoduleRoot || typeof config.submoduleRoot !== "string") {
    errors.push("config.submoduleRoot must be set");
  }

  if (!Array.isArray(config.fixtures) || config.fixtures.length === 0) {
    errors.push("config.fixtures must be a non-empty array");
  }

  if (config.capture !== undefined) {
    if (!config.capture || typeof config.capture !== "object" || Array.isArray(config.capture)) {
      errors.push("config.capture must be an object when present");
    } else {
      if (config.capture.runtime !== undefined && typeof config.capture.runtime !== "boolean") {
        errors.push("config.capture.runtime must be a boolean when present");
      }
      if (config.capture.mockSdk !== undefined && typeof config.capture.mockSdk !== "boolean") {
        errors.push("config.capture.mockSdk must be a boolean when present");
      }
    }
  }

  const ids = new Set();
  const paths = new Set();
  for (const fixture of config.fixtures ?? []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(fixture.id ?? "")) {
      errors.push(`invalid fixture id: ${fixture.id}`);
    }
    if (ids.has(fixture.id)) {
      errors.push(`duplicate fixture id: ${fixture.id}`);
    }
    ids.add(fixture.id);

    if (typeof fixture.path !== "string" || fixture.path.length === 0) {
      errors.push(`${fixture.id}: path must be set`);
    }
    if (paths.has(fixture.path)) {
      errors.push(`duplicate fixture path: ${fixture.path}`);
    }
    paths.add(fixture.path);

    const hasRepo = typeof fixture.repo === "string";
    const hasPackage = fixture.package && typeof fixture.package === "object";
    if (hasRepo === hasPackage) {
      errors.push(`${fixture.id}: fixture must declare exactly one of repo or package`);
    }
    if (!["high", "medium", "low"].includes(fixture.priority)) {
      errors.push(`${fixture.id}: priority must be high, medium, or low`);
    }
    if (!Array.isArray(fixture.seams) || fixture.seams.length === 0) {
      errors.push(`${fixture.id}: seams must be non-empty`);
    }
    for (const key of ["hooks", "registrations", "manifestContracts"]) {
      const values = fixture.expect?.[key];
      if (values !== undefined && (!Array.isArray(values) || values.length === 0)) {
        errors.push(`${fixture.id}: expect.${key} must be a non-empty array when present`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

export function fixtureCheckoutPath(config, fixture) {
  return path.resolve(config.rootDir ?? process.cwd(), fixture.path);
}

export function fixtureSourceRoot(config, fixture) {
  const checkoutPath = fixtureCheckoutPath(config, fixture);
  if (fixture.subdir) {
    return path.join(checkoutPath, fixture.subdir);
  }
  if (fixture.package) {
    return path.join(checkoutPath, npmPackagePayloadDir);
  }
  return checkoutPath;
}

export async function normalizePluginRootConfig(config, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const plugin = config.plugin ?? {};
  const packageJson = await readJsonIfExists(path.join(rootDir, "package.json"));
  const pluginManifest = await readJsonIfExists(path.join(rootDir, "openclaw.plugin.json"));
  const sourceRoot = plugin.sourceRoot ?? config.sourceRoot ?? ".";
  const fixture = {
    id: plugin.id ?? pluginManifest?.id ?? packageId(packageJson?.name) ?? "plugin",
    name: plugin.name ?? pluginManifest?.name ?? packageJson?.name ?? "Plugin",
    path: ".",
    repo: "local",
    priority: plugin.priority ?? config.priority ?? "high",
    seams: plugin.seams ?? config.seams ?? inferPluginSeams(pluginManifest, packageJson),
    why: plugin.why ?? config.why ?? "local OpenClaw plugin root",
    expect: plugin.expect ?? config.expect,
  };

  if (sourceRoot !== ".") {
    fixture.subdir = sourceRoot;
  }

  return {
    version: 1,
    submoduleRoot: ".",
    capture: config.capture,
    openclaw: config.openclaw,
    fixtures: [fixture],
  };
}

export async function normalizeInspectorConfig(config, options = {}) {
  if (Array.isArray(config.fixtures)) {
    return config;
  }
  return normalizePluginRootConfig(config, options);
}

function findPluginRootConfigPath(rootDir) {
  return defaultPluginRootConfigFiles.map((file) => path.join(rootDir, file)).find(existsSync) ?? null;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function packageId(packageName) {
  if (!packageName) {
    return null;
  }
  return packageName
    .split("/")
    .pop()
    .replace(/^openclaw-/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function inferPluginSeams(pluginManifest, packageJson) {
  const contracts = Object.keys(pluginManifest?.contracts ?? {});
  if (contracts.includes("tools")) {
    return ["dynamic-tool"];
  }
  if (packageJson?.openclaw?.extensions || packageJson?.openclaw?.runtimeExtensions) {
    return ["plugin-runtime"];
  }
  return ["plugin-metadata"];
}
