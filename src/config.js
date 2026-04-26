import { readFile } from "node:fs/promises";
import path from "node:path";

export const npmPackagePayloadDir = ".crabpot-package";

export async function loadInspectorConfig(configPath, options = {}) {
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), configPath);
  const config = JSON.parse(await readFile(resolvedPath, "utf8"));
  const rootDir = path.resolve(options.cwd ?? process.cwd(), options.rootDir ?? path.dirname(resolvedPath));
  validateInspectorConfig(config);
  return {
    ...config,
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
