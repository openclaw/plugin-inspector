#!/usr/bin/env node
// Checks src/scope-facts.js against eslint-scope's full ScopeManager on real
// code: for every name the runtime-import analysis requests, each variable's
// defining identifiers, definition count and resolved references (identifier,
// read/write flags, init) must be identical, and so must the set of resolved
// identifiers. Files with direct eval or `with` are skipped, as the analysis
// uses the full ScopeManager for them.
//
//   node scripts/verify-scope-facts.mjs <dir|file> [...]
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { compareScopeFacts } from "../test/support/scope-facts-compare.js";

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("Usage: node scripts/verify-scope-facts.mjs <dir|file> [...]");
  process.exit(2);
}
let files = [];
for (const root of roots) {
  if (statSync(root).isFile()) files.push(root);
  else files.push(...execFileSync("find", [root, "-type", "f", "(", "-name", "*.js", "-o", "-name", "*.mjs", "-o", "-name", "*.cjs", ")", "-size", "-3000k"], { maxBuffer: 1 << 30 }).toString().trim().split("\n").filter(Boolean));
}
const seen = new Set();
let compared = 0;
let skipped = 0;
let failures = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (seen.has(text)) continue;
  seen.add(text);
  const result = compareScopeFacts(text);
  if (result.skipped) {
    skipped += 1;
    continue;
  }
  compared += 1;
  if (result.differences.length) {
    failures += 1;
    if (failures <= 10) console.error(`${file}: ${result.differences.slice(0, 3).join("; ")}`);
  }
}
console.log(`${compared} files compared, ${skipped} skipped (unparseable, eval or with), ${failures} with differences`);
if (failures) process.exit(1);
