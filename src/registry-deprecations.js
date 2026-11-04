import { createHash } from "node:crypto";
import path from "node:path";
import { collectRuntimeModuleImports } from "./runtime-imports.js";
import qualifications from "./packed-sdk-qualifications.json" with { type: "json" };

// Packed packages may predate the pinned inventory. Only prescribe replacements
// exposed by that package's public SDK declarations.
//
// Answering that exactly means type-checking the package's public declarations
// (packed-sdk-surface.js). That pass is the largest allocation of publish-time
// inspection, and its answer depends only on the declaration snapshot, so
// released OpenClaw snapshots ship precomputed in packed-sdk-qualifications.json
// (regenerate and verify with scripts/packed-sdk-qualifications.mjs). Any other
// snapshot is type-checked on demand with the same result.
export async function retirementRecordsForPackedTarget(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const available = await availableReplacementNames(records, { declarations, packageJson, packageRoot });
  return records.filter((record) => !Array.isArray(record.replacementExports)
    || record.replacementExports.every((name) => available.has(name)));
}

export async function availableReplacementNames(records, { declarations = [], packageJson = {}, packageRoot = "" } = {}) {
  const wanted = replacementNames(records);
  if (wanted.length === 0) return new Set();
  const known = precomputedReplacementNames(wanted, packedSdkSnapshotDigest({ declarations, packageJson, packageRoot }));
  if (known) return known;
  const { publicSdkSurfaceNames } = await import("./packed-sdk-surface.js");
  const names = publicSdkSurfaceNames(declarations, packageJson, packageRoot);
  return new Set(wanted.filter((name) => names.has(name)));
}

export function replacementNames(records) {
  return [...new Set(records.flatMap((record) => Array.isArray(record.replacementExports) ? record.replacementExports : []))].sort();
}

export const PACKED_SDK_QUALIFICATION_ALGORITHM = 1;

// Identifies everything the qualification reads: the ./plugin-sdk export map
// and every declaration file's package-relative path and exact text.
export function packedSdkSnapshotDigest({ declarations = [], packageJson = {}, packageRoot = "" }) {
  const hash = createHash("sha256");
  hash.update(`plugin-inspector packed SDK snapshot ${PACKED_SDK_QUALIFICATION_ALGORITHM}\0`);
  const sdkExports = Object.entries(packageJson.exports ?? {})
    .filter(([specifier]) => specifier === "./plugin-sdk" || specifier.startsWith("./plugin-sdk/"));
  hash.update(`${JSON.stringify(sdkExports)}\0`);
  const files = declarations.map(({ filePath, source }) => ({
    name: path.relative(path.resolve(packageRoot || "."), path.resolve(filePath)).split(path.sep).join("/"),
    source: source ?? "",
  })).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const { name, source } of files) {
    hash.update(`${name}\0${Buffer.byteLength(source)}\0`);
    hash.update(source);
  }
  return hash.digest("hex");
}

function precomputedReplacementNames(wanted, digest) {
  if (qualifications.algorithm !== PACKED_SDK_QUALIFICATION_ALGORITHM) return null;
  const target = qualifications.targets.find((entry) => entry.snapshotSha256 === digest);
  if (!target) return null;
  // The table answers only for names it checked; a newer inventory falls back.
  const checked = new Set(qualifications.checkedNames);
  if (!wanted.every((name) => checked.has(name))) return null;
  const available = new Set(target.available);
  return new Set(wanted.filter((name) => available.has(name)));
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
