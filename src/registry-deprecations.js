import path from "node:path";
import ts from "typescript";
import { collectRuntimeModuleImports } from "./runtime-imports.js";

// Packed packages may predate the pinned inventory. Only prescribe replacements
// exposed by that package's public SDK declarations.
export function retirementRecordsForPackedTarget(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const available = publicReplacementNames(declarations, packageJson, packageRoot);
  return records.filter((record) => !Array.isArray(record.replacementExports)
    || record.replacementExports.every((name) => available.has(name)));
}

function publicReplacementNames(declarations, packageJson, packageRoot) {
  const normalize = (file) => path.resolve(file).split(path.sep).join("/");
  const sources = new Map(declarations.map(({ filePath, source }) => {
    const name = normalize(filePath);
    return [name, ts.createSourceFile(name, source ?? "", ts.ScriptTarget.Latest, true)];
  }));
  const options = { noLib: true, noEmit: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  // Use only the already-read declaration snapshot; resolution must never read
  // installed dependencies or execute the selected package.
  const host = {
    getSourceFile: (file) => sources.get(normalize(file)),
    fileExists: (file) => sources.has(normalize(file)),
    readFile: (file) => sources.get(normalize(file))?.text,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => normalize(packageRoot || "."),
    getDirectories: () => [],
    getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const names = new Set();
  const seen = new Set();
  function collectMembers(type) {
    if (!type || seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) collectMembers(part);
    }
    for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
      collectMembers(checker.getReturnTypeOfSignature(signature));
    }
    for (const member of checker.getPropertiesOfType(type)) {
      names.add(member.name);
      const declaration = member.valueDeclaration ?? member.declarations?.[0];
      if (declaration) collectMembers(checker.getTypeOfSymbolAtLocation(member, declaration));
    }
  }
  for (const file of publicSdkDeclarations(packageJson, packageRoot, sources)) {
    const source = program.getSourceFile(file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!module || source.parseDiagnostics.length) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (symbol.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Type)) names.add(exported.name);
      if (symbol.flags & ts.SymbolFlags.Type) collectMembers(checker.getDeclaredTypeOfSymbol(symbol));
      if (symbol.flags & ts.SymbolFlags.Value) {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (declaration) collectMembers(checker.getTypeOfSymbolAtLocation(symbol, declaration));
      }
    }
  }
  return names;
}

function publicSdkDeclarations(packageJson, packageRoot, sources) {
  const files = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const resolved = path.resolve(packageRoot, value).split(path.sep).join("/");
      const candidates = /\.d\.[cm]?ts$/.test(resolved) ? [resolved]
        : /\.mjs$/.test(resolved) ? [resolved.replace(/\.mjs$/, ".d.mts"), resolved.replace(/\.mjs$/, ".d.ts")]
        : /\.cjs$/.test(resolved) ? [resolved.replace(/\.cjs$/, ".d.cts"), resolved.replace(/\.cjs$/, ".d.ts")]
        : [resolved.replace(/\.js$/, ".d.ts")];
      const declaration = candidates.find((candidate) => sources.has(candidate));
      if (declaration) files.add(declaration);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const [specifier, value] of Object.entries(packageJson.exports ?? {})) {
    if (specifier === "./plugin-sdk" || specifier.startsWith("./plugin-sdk/")) visit(value);
  }
  return files;
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
