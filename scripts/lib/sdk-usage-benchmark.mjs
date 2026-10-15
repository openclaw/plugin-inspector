import { readFile } from "node:fs/promises";
import path from "node:path";

const sorted = (values) => [...new Set(values)].sort();
const sameSet = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

/** Compare serialized report data, never derive expectations from detector output. */
export async function compareSdkUsage(expected, actual, sourceRoot) {
  const result = {
    pluginId: expected.plugin.id,
    passed: false,
    expectedIdentities: expected.findings.length,
    actualIdentities: 0,
    truePositives: 0,
    falsePositives: [],
    falseNegatives: [],
    classificationMismatches: [],
    referenceKindMismatches: [],
    invalidEvidence: [],
    missingUnknowns: [],
    extraUnknowns: [],
    reportErrors: [],
  };
  if (!actual || !Array.isArray(actual.entries) || !Array.isArray(actual.unknowns)) {
    result.reportErrors.push("Missing SDK inventory entries or unknowns");
    return result;
  }
  if (actual.schemaVersion !== 1 || actual.analysisVersion !== "1") {
    result.reportErrors.push("Unsupported inventory schema/analysis version");
  }
  if (actual.inputKind !== "source") result.reportErrors.push("Expected source inputKind");
  const expectedStatus = expected.unknowns.length ? "partial" : "complete";
  if (actual.status !== expectedStatus) result.reportErrors.push(`Expected ${expectedStatus} status`);
  const coverage = {
    filesDiscovered: expected.reviewedFiles.length + expected.excludedFiles.length,
    filesAnalyzed: expected.reviewedFiles.length,
    filesExcluded: expected.excludedFiles.length,
  };
  for (const [field, count] of Object.entries(coverage)) {
    if (actual.coverage?.[field] !== count) result.reportErrors.push(`Wrong coverage.${field}: expected ${count}`);
  }

  const reviewed = new Set(expected.reviewedFiles.map((file) => file.path));
  const sources = new Map();
  function sourcePath(value) {
    if (typeof value !== "string" || path.isAbsolute(value)) return null;
    const normalized = value.replaceAll("\\", "/");
    if (reviewed.has(normalized)) return normalized;
    const relative = path.posix.normalize(`${expected.plugin.path}/${normalized}`);
    return reviewed.has(relative) ? relative : null;
  }
  async function validSite(site, field) {
    const relative = sourcePath(site?.path);
    if (!relative || !Number.isSafeInteger(site.line) || site.line < 1 || typeof site[field] !== "string" || !site[field].trim()) return false;
    if (!sources.has(relative)) sources.set(relative, (await readFile(path.join(sourceRoot, relative), "utf8")).split(/\r?\n/));
    const snippet = site[field].trim();
    const lines = sources.get(relative).slice(site.line - 1, site.line - 1 + snippet.split("\n").length);
    return lines.join("\n").includes(snippet);
  }

  const expectedByKey = new Map(expected.findings.map((entry) => [entry.key, entry]));
  const actualByKey = new Map();
  for (const entry of actual.entries) {
    if (!entry || typeof entry.key !== "string" || entry.key !== `${entry.kind}:${entry.identity}`) {
      result.reportErrors.push("Malformed SDK identity");
      continue;
    }
    if (actualByKey.has(entry.key)) result.reportErrors.push(`duplicate identity: ${entry.key}`);
    actualByKey.set(entry.key, entry);
    if (!Array.isArray(entry.referenceKinds) || !Array.isArray(entry.deprecationCodes)) {
      result.reportErrors.push(`Missing referenceKinds/deprecationCodes: ${entry.key}`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      result.invalidEvidence.push({ key: entry.key, reason: "Missing evidence" });
    } else {
      for (const site of entry.evidence) {
        if (!(await validSite(site, "snippet"))) result.invalidEvidence.push({ key: entry.key, site });
      }
    }
  }
  result.actualIdentities = actualByKey.size;
  result.falsePositives = sorted([...actualByKey.keys()].filter((key) => !expectedByKey.has(key)));
  result.falseNegatives = sorted([...expectedByKey.keys()].filter((key) => !actualByKey.has(key)));
  result.truePositives = expectedByKey.size - result.falseNegatives.length;
  for (const [key, expectedEntry] of expectedByKey) {
    const entry = actualByKey.get(key);
    if (!entry) continue;
    if (entry.classification !== expectedEntry.classification) {
      result.classificationMismatches.push({ key, expected: expectedEntry.classification, actual: entry.classification });
    }
    if (!sameSet(expectedEntry.referenceKinds, entry.referenceKinds ?? [])) {
      result.referenceKindMismatches.push({ key, expected: sorted(expectedEntry.referenceKinds), actual: sorted(entry.referenceKinds ?? []) });
    }
  }
  const unknownKey = (site) => `${sourcePath(site.path)}:${site.line}:${site.expression}`;
  const expectedUnknowns = new Set(expected.unknowns.map(unknownKey));
  const actualUnknowns = new Set(actual.unknowns.map(unknownKey));
  result.missingUnknowns = sorted([...expectedUnknowns].filter((key) => !actualUnknowns.has(key)));
  result.extraUnknowns = sorted([...actualUnknowns].filter((key) => !expectedUnknowns.has(key)));
  for (const site of actual.unknowns) {
    if (!site.reason?.trim() || !(await validSite(site, "expression"))) {
      result.invalidEvidence.push({ unknown: site, reason: "Unresolved case needs a valid source location and reason" });
    }
  }
  result.passed = Object.values(result).filter(Array.isArray).every((items) => items.length === 0);
  return result;
}
