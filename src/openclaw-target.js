import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
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

  if (match.kind === "package") {
    return readPackedOpenClawTargetSurface({ rootDir, requestedPaths, ...match });
  }

  const { requestedPath, resolvedPath, registryPath } = match;
  const hookTypesPath = path.join(resolvedPath, "src/plugins/hook-types.ts");
  const apiBuilderPath = path.join(resolvedPath, "src/plugins/api-builder.ts");
  const capturedRegistrationPath = path.join(resolvedPath, "src/plugins/captured-registration.ts");
  const currentManifestTypesPath = path.join(resolvedPath, "src/plugins/manifest-types.ts");
  const legacyManifestTypesPath = path.join(resolvedPath, "src/plugins/manifest.ts");
  const pluginSdkEntrypointsPath = path.join(resolvedPath, "src/plugin-sdk/entrypoints.ts");
  const packagePath = path.join(resolvedPath, "package.json");

  const registrySource = await readFile(registryPath, "utf8");
  const compatRecordEntries = parseCompatRecordEntries(registrySource);
  const hookTypesSource = existsSync(hookTypesPath) ? await readFile(hookTypesPath, "utf8") : "";
  const hookNames = hookTypesSource ? parseConstStringArray(hookTypesSource, "PLUGIN_HOOK_NAMES") : [];
  const apiBuilderSource = existsSync(apiBuilderPath) ? await readFile(apiBuilderPath, "utf8") : "";
  const apiRegistrars = apiBuilderSource ? parseApiRegistrars(apiBuilderSource) : [];
  const currentManifestTypesSource = existsSync(currentManifestTypesPath)
    ? await readFile(currentManifestTypesPath, "utf8")
    : "";
  const legacyManifestTypesSource = existsSync(legacyManifestTypesPath)
    ? await readFile(legacyManifestTypesPath, "utf8")
    : "";
  const currentManifestFields = parseTypeFields(currentManifestTypesSource, "PluginManifest");
  const legacyManifestFields = parseTypeFields(legacyManifestTypesSource, "PluginManifest");
  const currentManifestContractFields = parseTypeFields(currentManifestTypesSource, "PluginManifestContracts");
  const legacyManifestContractFields = parseTypeFields(legacyManifestTypesSource, "PluginManifestContracts");
  const useCurrentManifestTypes = currentManifestFields.length > 0;
  const manifestTypesPath = useCurrentManifestTypes ? currentManifestTypesPath : legacyManifestTypesPath;
  const manifestFields = useCurrentManifestTypes ? currentManifestFields : legacyManifestFields;
  const manifestContractFields =
    currentManifestContractFields.length > 0 ? currentManifestContractFields : legacyManifestContractFields;
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
  return parseStringArrayMatch(match);
}

function parseConstStringArray(source, constName) {
  const match = source.match(new RegExp(`(?:export\\s+)?const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`));
  return parseStringArrayMatch(match);
}

function parseStringArrayMatch(match) {
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
      return { kind: "checkout", requestedPath, resolvedPath, registryPath };
    }
    if (existsSync(path.join(resolvedPath, "package.json")) && existsSync(path.join(resolvedPath, "dist"))) {
      return { kind: "package", requestedPath, resolvedPath };
    }
  }
  return null;
}

async function readPackedOpenClawTargetSurface({ rootDir, requestedPaths, requestedPath, resolvedPath }) {
  const packagePath = path.join(resolvedPath, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageJson.name !== "openclaw") {
    return emptyTargetSurface({ configuredPath: requestedPath, searchedPaths: requestedPaths, status: "missing" });
  }

  const distPath = path.join(resolvedPath, "dist");
  const declarationFiles = await listDeclarationFiles(distPath);
  const declarations = [];
  for (const filePath of declarationFiles) {
    declarations.push({ filePath, source: await readFile(filePath, "utf8") });
  }
  const apiDeclaration = declarations
    .map((declaration) => ({
      ...declaration,
      values: parseObjectTypeFields(declaration.source, "OpenClawPluginApi", (value) => value.startsWith("register")),
    }))
    .sort((left, right) => right.values.length - left.values.length)[0];
  const hookDeclaration = declarations.find((declaration) => declaration.source.includes("type PluginHookName ="));
  const manifestDeclaration = declarations.find((declaration) => declaration.source.includes("type PluginManifestRecord ="));
  const manifestContractDeclaration = declarations.find((declaration) => declaration.source.includes("type PluginManifestContracts ="));
  const apiRegistrars = apiDeclaration?.values ?? [];
  const hookNames = hookDeclaration ? parseStringUnion(hookDeclaration.source, "PluginHookName") : [];
  const manifestFields = manifestDeclaration
    ? parseObjectTypeFields(manifestDeclaration.source, "PluginManifestRecord")
    : [];
  const manifestContractFields = manifestContractDeclaration
    ? parseObjectTypeFields(manifestContractDeclaration.source, "PluginManifestContracts")
    : [];
  const sdkExports = parsePluginSdkExports(packageJson);

  return {
    configuredPath: requestedPath,
    searchedPaths: requestedPaths,
    status: "ok",
    version: packageJson.version ?? null,
    compatRegistryPath: null,
    compatRecordCount: 0,
    compatRecords: [],
    compatRecordStatuses: {},
    hookTypesPath: hookDeclaration ? relativePath(rootDir, hookDeclaration.filePath) : null,
    hookNameCount: hookNames.length,
    hookNames,
    apiBuilderPath: apiDeclaration ? relativePath(rootDir, apiDeclaration.filePath) : null,
    apiRegistrarCount: apiRegistrars.length,
    apiRegistrars,
    capturedRegistrationPath: apiDeclaration ? relativePath(rootDir, apiDeclaration.filePath) : null,
    capturedRegistrarCount: apiRegistrars.length,
    capturedRegistrars: apiRegistrars,
    packagePath: relativePath(rootDir, packagePath),
    sdkExportCount: sdkExports.length,
    sdkExports,
    pluginSdkEntrypointsPath: null,
    reservedSdkExportCount: 0,
    reservedSdkExports: [],
    supportedFacadeSdkExports: [],
    publicPluginOwnedSdkExports: [],
    manifestTypesPath: manifestDeclaration ? relativePath(rootDir, manifestDeclaration.filePath) : null,
    manifestFieldCount: manifestFields.length,
    manifestFields,
    manifestContractFieldCount: manifestContractFields.length,
    manifestContractFields,
  };
}

async function listDeclarationFiles(rootDir) {
  const files = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDeclarationFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function parseObjectTypeFields(source, typeName, filter = () => true) {
  const body = readObjectTypeBody(source, typeName);
  if (!body) return [];
  return unique(parseTopLevelTypeProperties(body).filter(filter)).sort();
}

function parseTopLevelTypeProperties(body) {
  const properties = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let propertyStart = true;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (char === "/" && next === "*") {
      index = body.indexOf("*/", index + 2);
      if (index === -1) break;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = body.indexOf("\n", index + 2);
      if (newline === -1) break;
      index = newline;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      index = skipQuotedTypeText(body, index);
      continue;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;

    if (braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) continue;
    if (char === ";" || char === ",") {
      propertyStart = true;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (!propertyStart || !/[A-Za-z_$]/.test(char)) {
      propertyStart = false;
      continue;
    }

    const match = body.slice(index).match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (!match) {
      propertyStart = false;
      continue;
    }
    const name = match[1];
    index += name.length - 1;
    if (name === "readonly") continue;
    let cursor = index + 1;
    while (/\s/.test(body[cursor] ?? "")) cursor += 1;
    if (body[cursor] === "?") cursor += 1;
    while (/\s/.test(body[cursor] ?? "")) cursor += 1;
    if (body[cursor] === ":") properties.push(name);
    propertyStart = false;
  }
  return properties;
}

function skipQuotedTypeText(source, quoteIndex) {
  const quote = source[quoteIndex];
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === quote) return index;
  }
  return source.length - 1;
}

function readObjectTypeBody(source, typeName) {
  const marker = new RegExp(`(?:export\\s+)?type\\s+${typeName}(?:\\$\\d+)?\\s*=\\s*\\{`, "g");
  const match = marker.exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  return null;
}

function parseStringUnion(source, typeName) {
  const match = source.match(new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`));
  return match ? unique([...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1])).sort() : [];
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
