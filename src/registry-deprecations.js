import path from "node:path";
import { collectRuntimeModuleImports } from "./runtime-imports.js";

// replacementExports is the full list of calls a record tells the author to
// use. A packed package can be older than this snapshot, so every name has to
// be a public declaration export before that text is safe to show.
export function retirementRecordsForPackedTarget(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const available = publicReplacementNames(declarations, packageJson, packageRoot);
  return records.filter((record) => {
    const names = Array.isArray(record.replacementExports) ? record.replacementExports : [];
    if (names.length === 0) return true;
    return names.every((name) => available.has(name));
  });
}

function publicReplacementNames(declarations, packageJson, packageRoot) {
  const byStem = new Map();
  for (const declaration of declarations) {
    byStem.set(declarationStem(declaration.filePath, packageRoot), declaration);
  }
  const names = new Set();
  const seenFiles = new Set();
  for (const stem of pluginSdkExportStems(packageJson)) {
    collectPublicNames(stem, byStem, names, seenFiles);
  }
  return names;
}

function collectPublicNames(stem, byStem, names, seenFiles) {
  if (seenFiles.has(stem)) return;
  const declaration = byStem.get(stem);
  if (!declaration) return;
  seenFiles.add(stem);
  const source = declaration.source ?? "";
  for (const name of exportedDeclarationNames(source)) names.add(name);
  for (const alias of exportedTypeAliasNames(source)) {
    addReferencedTypeMembers(stem, alias, byStem, names);
  }
  for (const reexport of reexportsFrom(source, stem)) {
    if (reexport.all) {
      collectPublicNames(reexport.stem, byStem, names, seenFiles);
      continue;
    }
    names.add(reexport.publicName);
    addReferencedTypeMembers(reexport.stem, reexport.importedName, byStem, names);
  }
  for (const binding of importedBindings(source, stem)) {
    if (!usesImportedType(source, binding.local) && !localExportNames(source).includes(binding.local)) continue;
    addReferencedTypeMembers(binding.stem, binding.imported, byStem, names);
  }
  for (const local of localExportNames(source)) names.add(local);
}

function addReferencedTypeMembers(stem, typeName, byStem, names, seen = new Set()) {
  const declaration = byStem.get(stem);
  if (!declaration || !typeName) return;
  const source = declaration.source ?? "";
  const declaredName = declaredNameForExport(source, typeName);
  const seenKey = `${stem}:${declaredName}`;
  if (seen.has(seenKey)) return;
  seen.add(seenKey);
  for (const member of membersOfNamedType(source, declaredName)) names.add(member);
  const rhs = typeAliasRhs(source, declaredName);
  const parts = intersectionConstituents(rhs);
  for (const body of parts.objectBodies) {
    for (const member of typeMembers(body)) names.add(member);
  }
  const parents = [extendedTypeName(source, declaredName), ...parts.types].filter(Boolean);
  for (const parent of parents) {
    const parentBinding = importedBindings(source, stem).find((binding) => binding.local === parent);
    if (parentBinding) addReferencedTypeMembers(parentBinding.stem, parentBinding.imported, byStem, names, seen);
    else addReferencedTypeMembers(stem, parent, byStem, names, seen);
  }
}

function declarationStem(filePath, packageRoot) {
  return path.relative(packageRoot, filePath).split(path.sep).join("/").replace(/\.d\.ts$/, "");
}

function pluginSdkExportStems(packageJson) {
  const stems = [];
  const visit = (value) => {
    if (typeof value === "string") {
      stems.push(value.replace(/^\.\//, "").replace(/\.(?:[cm]?js|d\.ts)$/, ""));
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const [specifier, value] of Object.entries(packageJson.exports ?? {})) {
    if (specifier !== "./plugin-sdk" && !specifier.startsWith("./plugin-sdk/")) continue;
    visit(value);
  }
  return stems;
}

function resolveRelativeStem(fromStem, specifier) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromStem), specifier));
  return resolved.replace(/\.(?:[cm]?js|d\.ts)$/, "");
}

function strippedDeclaration(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function importedBindings(source, fromStem) {
  const bindings = [];
  for (const match of strippedDeclaration(source).matchAll(/\bimport\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/g)) {
    for (const part of match[1].split(",")) {
      const names = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part.trim());
      if (!names) continue;
      bindings.push({
        imported: names[1],
        local: names[2] ?? names[1],
        stem: resolveRelativeStem(fromStem, match[2]),
      });
    }
  }
  return bindings;
}

function reexportsFrom(source, fromStem) {
  const reexports = [];
  const text = strippedDeclaration(source);
  for (const match of text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/g)) {
    const stem = resolveRelativeStem(fromStem, match[2]);
    for (const part of match[1].split(",")) {
      const names = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part.trim());
      if (!names) continue;
      reexports.push({ all: false, stem, importedName: names[1], publicName: names[2] ?? names[1] });
    }
  }
  for (const match of text.matchAll(/\bexport\s+\*\s+from\s+["'](\.[^"']+)["']/g)) {
    reexports.push({ all: true, stem: resolveRelativeStem(fromStem, match[1]) });
  }
  return reexports;
}

function localExportNames(source) {
  const names = [];
  for (const match of strippedDeclaration(source).matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}(?!\s+from)/g)) {
    for (const part of match[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      const parsed = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(cleaned);
      if (parsed) names.push(parsed[2] ?? parsed[1]);
    }
  }
  return names;
}

function usesImportedType(source, localName) {
  const text = strippedDeclaration(source).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");
  const mention = new RegExp(`\\b${localName}\\b`);
  for (const match of text.matchAll(/\bexport\s+(?:declare\s+)?(?:interface|type|class)\s+[^{;]+/g)) {
    if (mention.test(match[0])) return true;
  }
  for (const match of text.matchAll(/\bexport\s+(?:declare\s+)?(?:interface|type)\s+[A-Za-z_$][\w$]*[^{=]*=?\s*\{([\s\S]*?)\n\}/g)) {
    if (mention.test(match[0])) return true;
  }
  return false;
}

function extendedTypeName(source, typeName) {
  const match = strippedDeclaration(source).match(new RegExp(`\\b(?:interface|type)\\s+${typeName}\\b[^{]*\\bextends\\s+([A-Za-z_$][\\w$]*)`));
  return match?.[1] ?? null;
}

function exportedTypeAliasNames(source) {
  const names = [];
  for (const match of strippedDeclaration(source).matchAll(/\bexport\s+type\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    names.push(match[1]);
  }
  return names;
}

function typeAliasRhs(source, typeName) {
  const text = strippedDeclaration(source);
  const start = text.search(new RegExp(`\\btype\\s+${typeName}\\s*=`));
  if (start < 0) return null;
  const equals = text.indexOf("=", start);
  let depth = 0;
  let rhs = "";
  for (let index = equals + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}" && depth > 0) depth -= 1;
    if (char === ";" && depth === 0) return rhs;
    rhs += char;
  }
  return rhs || null;
}

function intersectionConstituents(rhs) {
  const types = [];
  const objectBodies = [];
  if (!rhs) return { types, objectBodies };
  let depth = 0;
  let current = "";
  const parts = [];
  for (const char of rhs) {
    if (char === "{") {
      if (depth === 0 && current.trim()) parts.push(current);
      depth += 1;
      current = char;
      continue;
    }
    if (char === "}") {
      current += char;
      depth -= 1;
      if (depth === 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    if (char === "&" && depth === 0) {
      if (current.trim()) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) objectBodies.push(trimmed.slice(1, -1));
    else {
      const name = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (name) types.push(name[1]);
    }
  }
  return { types, objectBodies };
}

function declaredNameForExport(source, exportedName) {
  for (const match of strippedDeclaration(source).matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const parsed = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part.trim());
      if (!parsed) continue;
      const original = parsed[1];
      const alias = parsed[2] ?? original;
      if (alias === exportedName) return original;
    }
  }
  return exportedName;
}

function membersOfNamedType(source, typeName) {
  const match = strippedDeclaration(source).match(new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(?:interface|type)\\s+${typeName}\\b[^{=]*=?\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) return [];
  return typeMembers(match[1]);
}

function typeMembers(body) {
  const names = [];
  for (const member of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*[?(:]/g)) {
    if (member[1] === "type" || member[1] === "interface" || member[1] === "readonly") continue;
    names.push(member[1]);
  }
  return names;
}

function exportedDeclarationNames(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const names = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const alias = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      if (alias) names.add(alias[1]);
    }
  }
  for (const match of text.matchAll(/\bexport\s+(?:declare\s+)?(?:interface|type)\s+[A-Za-z_$][\w$]*[^{=]*=?\s*\{([\s\S]*?)\n\}/g)) {
    for (const member of typeMembers(match[1])) names.add(member);
  }
  return names;
}

function parseSurface(api) {
  const sdk = /^(openclaw\/plugin-sdk(?:\/[\w-]+)?)(?:(?:\.|\s+)([\w$]+))?$/.exec(api);
  const symbol = /^[A-Za-z_$][\w$]*$/.test(api) ? api : null;
  const runtime = /^api\.runtime\.([\w$.]+)$/.exec(api);
  return { sdk, symbol, runtime };
}

function matchesSurface({ sdk, symbol, runtime }, entry) {
  return runtime ? entry.specifier === "api.runtime" && entry.names.has(runtime[1]) : sdk
    ? entry.specifier === sdk[1] && (!sdk[2] || entry.names.has(sdk[2]))
    : symbol !== null && /^openclaw\/plugin-sdk(?:\/|$)/.test(entry.specifier) && entry.names.has(symbol);
}

export function registryUsageDeprecationCodes(kind, identity, records = []) {
  let entry;
  if (kind === "sdk-module") entry = { specifier: identity, names: new Set() };
  if (kind === "sdk-export") {
    const [specifier, name] = identity.split("#");
    entry = { specifier, names: new Set([name]) };
  }
  if (kind === "runtime-member") entry = { specifier: "api.runtime", names: new Set([identity.replace(/^runtime\./, "")]) };
  return entry && records.some(record => record.status === "deprecated" &&
    (record.surfaces ?? []).some(surface => matchesSurface(parseSurface(surface), entry)))
    ? ["sdk-deprecated-api"] : [];
}

export function inspectRegistryDeprecations(text, filePath, records = []) {
  if (records.length === 0) return [];
  if (!text.includes("openclaw/plugin-sdk") && !text.includes("runtime")) return [];
  const imports = collectRuntimeModuleImports(text, { includeStaticMembers: true, includeRuntimeMembers: true });
  const findings = [];
  for (const record of records) {
    if (record.status !== "deprecated") continue;
    for (const api of record.surfaces ?? []) {
      // Qualified prose (such as "writable handles") describes conditional use,
      // not a blanket member deprecation. Do not guess from a matching import.
      const { sdk, symbol, runtime } = parseSurface(api);
      if (!sdk && !symbol && !runtime) continue;
      for (const entry of imports) {
        if (!matchesSurface({ sdk, symbol, runtime }, entry)) continue;
        const line = text.slice(0, entry.index).split("\n").length;
        const retirement = record.removeAfter ? ` retires on ${formatDate(record.removeAfter)};` : " is deprecated;";
        const replacement = record.replacement ?? "Consult the target OpenClaw migration guide.";
        findings.push({
          code: "sdk-deprecated-api",
          symbol: sdk?.[2] ?? symbol ?? api,
          surface: api,
          deprecatedApi: api,
          replacement,
          ...(record.removeAfter ? { removeAfter: record.removeAfter } : {}),
          ...(record.docsPath ? { docsPath: record.docsPath } : {}),
          compatRecord: record.code,
          ref: `${filePath}:${line}`,
          message: `${api}${retirement} ${replacement}`,
        });
      }
    }
  }
  return [...new Map(findings.map((finding) => [`${finding.compatRecord}:${finding.deprecatedApi}:${finding.ref}`, finding])).values()];
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
