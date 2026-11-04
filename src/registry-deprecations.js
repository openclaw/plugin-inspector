import { collectRuntimeModuleImports } from "./runtime-imports.js";

// Packed packages may predate the pinned inventory. Only prescribe replacements
// exposed by that package's public SDK declarations.
//
// "Exposed" means one of the names publicSdkSurfaceNames finds by type-checking
// the public declarations. Only the inventory's replacement names are asked
// about, and packed-sdk-certificates.js decides each one from the declaration
// text without a type checker, exactly when it claims a name is available and
// soundly when it claims one is not. Any name it cannot decide is answered by
// the (reduced) type check, so the result never depends on which path ran.
export async function retirementRecordsForPackedTarget(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const available = await availableReplacementNames(records, { declarations, packageJson, packageRoot });
  return records.filter((record) => !Array.isArray(record.replacementExports)
    || record.replacementExports.every((name) => available.has(name)));
}

export async function availableReplacementNames(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const wanted = replacementNames(records);
  if (wanted.length === 0) return new Set();
  const { certifyPublicSdkNames } = await import("./packed-sdk-certificates.js");
  const { available, undecided } = certifyPublicSdkNames({ declarations, packageJson, packageRoot, names: wanted });
  if (undecided.size === 0) return available;
  const { publicSdkSurfaceNames } = await import("./packed-sdk-surface.js");
  const names = publicSdkSurfaceNames(declarations, packageJson, packageRoot);
  for (const name of undecided) if (names.has(name)) available.add(name);
  return available;
}

export function replacementNames(records) {
  return [...new Set(records.flatMap((record) => Array.isArray(record.replacementExports) ? record.replacementExports : []))].sort();
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

export function inspectRegistryDeprecations(text, filePath, records = [], { analysisCache } = {}) {
  if (records.length === 0) return [];
  if (!text.includes("openclaw/plugin-sdk") && !text.includes("runtime")) return [];
  const imports = collectRuntimeModuleImports(text, { includeStaticMembers: true, includeRuntimeMembers: true, analysisCache });
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
