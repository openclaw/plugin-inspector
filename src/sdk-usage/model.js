import path from "node:path";
import { sdkUsageDeprecationCodes } from "../sdk-deprecation-rules.js";

export function createUsageReport({ root, inputKind = "source" }) {
  const entries = new Map();
  const unknowns = new Map();
  const coverage = { filesDiscovered: 0, filesAnalyzed: 0, filesExcluded: 0 };
  let failed = false;

  function site(node, source = node.getSourceFile()) {
    const start = node.getStart(source);
    const { line } = source.getLineAndCharacterOfPosition(start);
    const text = source.text.split(/\r?\n/)[line];
    return { path: path.relative(root, source.fileName).replaceAll("\\", "/"), line: line + 1, snippet: text.trim() };
  }

  function add(kind, identity, referenceKind, classification, node) {
    const key = `${kind}:${identity}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, kind, identity, classifications: new Set(), referenceKinds: new Set(), evidence: new Map(), deprecationCodes: new Set(sdkUsageDeprecationCodes(kind, identity)) };
      entries.set(key, entry);
    }
    entry.classifications.add(classification);
    entry.referenceKinds.add(referenceKind);
    const evidence = site(node);
    entry.evidence.set(`${evidence.path}:${evidence.line}`, evidence);
    return entry;
  }

  function unknown(node, reason) {
    const evidence = site(node);
    const value = { path: evidence.path, line: evidence.line, expression: node.getText().trim() || evidence.snippet, reason };
    unknowns.set(`${value.path}:${value.line}:${reason}`, value);
  }

  function finish() {
    return {
      schemaVersion: 1, analysisVersion: "1", inputKind,
      status: failed ? "failed" : unknowns.size ? "partial" : "complete",
      coverage,
      entries: [...entries.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map((entry) => ({
        key: entry.key, kind: entry.kind, identity: entry.identity,
        classification: entry.classifications.size > 1 ? "mixed" : [...entry.classifications][0],
        referenceKinds: [...entry.referenceKinds].sort(),
        evidence: [...entry.evidence.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).slice(0, 12),
        deprecationCodes: [...entry.deprecationCodes].sort(),
      })),
      unknowns: [...unknowns.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.reason.localeCompare(b.reason)),
    };
  }
  return { add, unknown, coverage, inputKind, finish, fail: () => { failed = true; } };
}
