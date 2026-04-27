import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const defaultOpenClawCheckoutPaths = ["./openclaw", "../openclaw"];

export async function readOpenClawTargetSurface(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const configuredPath = options.configuredPath;

  if (configuredPath === false) {
    return emptyTargetSurface({ configuredPath: null, status: "disabled" });
  }

  const requestedPaths = openClawTargetPathCandidates(options.manifest, configuredPath);
  if (requestedPaths.length === 0) {
    return emptyTargetSurface({ configuredPath: null, status: "not-configured" });
  }

  const match = findTargetCheckout(rootDir, requestedPaths);
  if (!match) {
    return emptyTargetSurface({
      configuredPath: requestedPaths[0],
      searchedPaths: requestedPaths,
      status: "missing",
    });
  }

  const { requestedPath, resolvedPath, registryPath } = match;
  const hookTypesPath = path.join(resolvedPath, "src/plugins/hook-types.ts");
  const apiBuilderPath = path.join(resolvedPath, "src/plugins/api-builder.ts");
  const capturedRegistrationPath = path.join(resolvedPath, "src/plugins/captured-registration.ts");
  const manifestTypesPath = path.join(resolvedPath, "src/plugins/manifest.ts");
  const packagePath = path.join(resolvedPath, "package.json");

  const registrySource = await readFile(registryPath, "utf8");
  const compatRecordEntries = parseCompatRecordEntries(registrySource);
  const hookTypesSource = existsSync(hookTypesPath) ? await readFile(hookTypesPath, "utf8") : "";
  const hookNames = hookTypesSource ? parseExportedStringArray(hookTypesSource, "PLUGIN_HOOK_NAMES") : [];
  const apiBuilderSource = existsSync(apiBuilderPath) ? await readFile(apiBuilderPath, "utf8") : "";
  const apiRegistrars = apiBuilderSource ? parseApiRegistrars(apiBuilderSource) : [];
  const manifestTypesSource = existsSync(manifestTypesPath) ? await readFile(manifestTypesPath, "utf8") : "";
  const manifestFields = manifestTypesSource ? parseTypeFields(manifestTypesSource, "PluginManifest") : [];
  const manifestContractFields = manifestTypesSource ? parseTypeFields(manifestTypesSource, "PluginManifestContracts") : [];
  const capturedRegistrars = existsSync(capturedRegistrationPath)
    ? parseCapturedRegistrars(await readFile(capturedRegistrationPath, "utf8"))
    : [];
  const sdkExports = existsSync(packagePath)
    ? parsePluginSdkExports(JSON.parse(await readFile(packagePath, "utf8")))
    : [];

  return {
    configuredPath: requestedPath,
    searchedPaths: requestedPaths,
    status: "ok",
    compatRegistryPath: relativePath(rootDir, registryPath),
    compatRecordCount: compatRecordEntries.length,
    compatRecords: compatRecordEntries.map((record) => record.code).sort(),
    compatRecordStatuses: Object.fromEntries(compatRecordEntries.map((record) => [record.code, record.status])),
    hookTypesPath: existsSync(hookTypesPath) ? relativePath(rootDir, hookTypesPath) : null,
    hookNameCount: hookNames.length,
    hookNames,
    apiBuilderPath: existsSync(apiBuilderPath) ? relativePath(rootDir, apiBuilderPath) : null,
    apiRegistrarCount: apiRegistrars.length,
    apiRegistrars,
    capturedRegistrationPath: existsSync(capturedRegistrationPath) ? relativePath(rootDir, capturedRegistrationPath) : null,
    capturedRegistrarCount: capturedRegistrars.length,
    capturedRegistrars,
    packagePath: existsSync(packagePath) ? relativePath(rootDir, packagePath) : null,
    sdkExportCount: sdkExports.length,
    sdkExports,
    manifestTypesPath: existsSync(manifestTypesPath) ? relativePath(rootDir, manifestTypesPath) : null,
    manifestFieldCount: manifestFields.length,
    manifestFields,
    manifestContractFieldCount: manifestContractFields.length,
    manifestContractFields,
  };
}

export function openClawTargetPathCandidates(manifest, configuredPath) {
  if (typeof configuredPath === "string") {
    return [configuredPath];
  }
  return unique([manifest?.openclaw?.defaultCheckoutPath, ...defaultOpenClawCheckoutPaths].filter(Boolean));
}

export function parseCompatRecordEntries(source) {
  const entries = [];
  for (const match of source.matchAll(/\{[\s\S]*?\bcode:\s*["'`]([^"'`]+)["'`][\s\S]*?\bstatus:\s*["'`]([^"'`]+)["'`][\s\S]*?\}/g)) {
    entries.push({ code: match[1], status: match[2] });
  }
  return dedupeBy(entries, (entry) => entry.code).sort((left, right) => left.code.localeCompare(right.code));
}

export function parsePluginSdkExports(packageJson) {
  return Object.keys(packageJson.exports ?? {})
    .filter((specifier) => specifier === "./plugin-sdk" || specifier.startsWith("./plugin-sdk/"))
    .map((specifier) => `openclaw/${specifier.slice(2)}`)
    .sort();
}

export function parseExportedStringArray(source, exportName) {
  const match = source.match(new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`));
  if (!match) {
    return [];
  }

  return unique([...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1])).sort();
}

export function parseTypeFields(source, typeName) {
  const marker = `export type ${typeName} = {`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return [];
  }
  const bodyStart = start + marker.length;
  const end = source.indexOf("\n};", bodyStart);
  if (end === -1) {
    return [];
  }
  const body = source.slice(bodyStart, end);
  return unique(
    [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\??:/gm)]
      .map((match) => match[1])
      .filter((field) => !field.startsWith("PluginManifest")),
  ).sort();
}

function findTargetCheckout(rootDir, requestedPaths) {
  for (const requestedPath of requestedPaths) {
    const resolvedPath = path.resolve(rootDir, requestedPath);
    const registryPath = path.join(resolvedPath, "src/plugins/compat/registry.ts");
    if (existsSync(registryPath)) {
      return { requestedPath, resolvedPath, registryPath };
    }
  }
  return null;
}

function emptyTargetSurface({ configuredPath, searchedPaths = undefined, status }) {
  return {
    configuredPath,
    searchedPaths,
    status,
    compatRecords: [],
    compatRecordStatuses: {},
    hookNames: [],
    apiRegistrars: [],
    capturedRegistrars: [],
    sdkExports: [],
    manifestFields: [],
    manifestContractFields: [],
  };
}

function parseCapturedRegistrars(source) {
  return unique([...source.matchAll(/^\s*(register[A-Za-z0-9]+)\s*\(/gm)].map((match) => match[1])).sort();
}

function parseApiRegistrars(source) {
  return unique([...source.matchAll(/\b(register[A-Za-z0-9]+)\b/g)].map((match) => match[1])).sort();
}

function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function dedupeBy(values, keyForValue) {
  const byKey = new Map();
  for (const value of values) {
    byKey.set(keyForValue(value), value);
  }
  return [...byKey.values()];
}

function unique(values) {
  return [...new Set(values)];
}
