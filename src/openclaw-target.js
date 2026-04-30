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
  const pluginSdkEntrypointsPath = path.join(resolvedPath, "src/plugin-sdk/entrypoints.ts");
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
  const pluginSdkEntrypointsSource = existsSync(pluginSdkEntrypointsPath)
    ? await readFile(pluginSdkEntrypointsPath, "utf8")
    : "";
  const reservedSdkExports = pluginSdkEntrypointsSource
    ? parsePluginSdkEntrypointSpecifiers(pluginSdkEntrypointsSource, "reservedBundledPluginSdkEntrypoints")
    : [];
  const supportedFacadeSdkExports = pluginSdkEntrypointsSource
    ? parsePluginSdkEntrypointSpecifiers(pluginSdkEntrypointsSource, "supportedBundledFacadeSdkEntrypoints")
    : [];
  const publicPluginOwnedSdkExports = pluginSdkEntrypointsSource
    ? parsePluginSdkEntrypointSpecifiers(pluginSdkEntrypointsSource, "publicPluginOwnedSdkEntrypoints")
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
    pluginSdkEntrypointsPath: existsSync(pluginSdkEntrypointsPath)
      ? relativePath(rootDir, pluginSdkEntrypointsPath)
      : null,
    reservedSdkExportCount: reservedSdkExports.length,
    reservedSdkExports,
    supportedFacadeSdkExports,
    publicPluginOwnedSdkExports,
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
  let cursor = 0;
  while (cursor < source.length) {
    const codeProperty = readStringProperty(source, "code", cursor);
    if (!codeProperty) {
      break;
    }

    const statusProperty = readStringProperty(source, "status", codeProperty.end);
    if (statusProperty) {
      entries.push({ code: codeProperty.value, status: statusProperty.value });
      cursor = statusProperty.end;
    } else {
      cursor = codeProperty.end;
    }
  }
  return dedupeBy(entries, (entry) => entry.code).sort((left, right) => left.code.localeCompare(right.code));
}

function readStringProperty(source, property, fromIndex) {
  const propertyIndex = findProperty(source, property, fromIndex);
  if (propertyIndex === -1) {
    return null;
  }
  const colonIndex = source.indexOf(":", propertyIndex + property.length);
  if (colonIndex === -1) {
    return null;
  }
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < source.length && isWhitespace(source[quoteIndex])) {
    quoteIndex += 1;
  }
  if (!isQuote(source[quoteIndex])) {
    return null;
  }
  return readQuotedValue(source, quoteIndex);
}

function findProperty(source, property, fromIndex) {
  let index = source.indexOf(property, fromIndex);
  while (index !== -1) {
    const previous = index === 0 ? "" : source[index - 1];
    const next = source[index + property.length] ?? "";
    if (!isIdentifierChar(previous) && !isIdentifierChar(next)) {
      return index;
    }
    index = source.indexOf(property, index + property.length);
  }
  return -1;
}

function readQuotedValue(source, quoteIndex) {
  const quote = source[quoteIndex];
  let value = "";
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      value += source[index + 1] ?? "";
      index += 1;
    } else if (char === quote) {
      return { value, end: index + 1 };
    } else {
      value += char;
    }
  }
  return null;
}

function isQuote(char) {
  return char === '"' || char === "'" || char === "`";
}

function isIdentifierChar(char) {
  if (char === "_" || char === "$") {
    return true;
  }
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
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
    reservedSdkExports: [],
    supportedFacadeSdkExports: [],
    publicPluginOwnedSdkExports: [],
    manifestFields: [],
    manifestContractFields: [],
  };
}

export function parsePluginSdkEntrypointSpecifiers(source, exportName) {
  return parseExportedStringArray(source, exportName).map((entrypoint) => `openclaw/plugin-sdk/${entrypoint}`).sort();
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
