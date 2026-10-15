import { collectRuntimeModuleImports } from "./runtime-imports.js";

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
      const sdk = /^(openclaw\/plugin-sdk(?:\/[\w-]+)?)(?:(?:\.|\s+)([\w$]+))?$/.exec(api);
      const symbol = /^[A-Za-z_$][\w$]*$/.test(api) ? api : null;
      const runtime = /^api\.runtime\.([\w$.]+)$/.exec(api);
      if (!sdk && !symbol && !runtime) continue;
      for (const entry of imports) {
        const matches = runtime ? entry.specifier === "api.runtime" && entry.names.has(runtime[1]) : sdk
          ? entry.specifier === sdk[1] && (!sdk[2] || entry.names.has(sdk[2]))
          : /^openclaw\/plugin-sdk(?:\/|$)/.test(entry.specifier) && entry.names.has(symbol);
        if (!matches) continue;
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
