#!/usr/bin/env node
// Checks packed-sdk-certificates.js against the full type-checked public
// surface (the 0.4.4/0.4.5 computation) for packed OpenClaw snapshots:
// every identifier and string literal spelled in the snapshot is queried, and
// any certified answer that disagrees with the type check fails the run. Also
// reports how many SDK retirement replacement names are decided without the
// type checker.
//
//   node scripts/verify-packed-sdk-certificates.mjs --target <unpacked openclaw package> [--target ...]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { certifyPublicSdkNames } from "../src/packed-sdk-certificates.js";
import { listDeclarationFiles } from "../src/declaration-files.js";
import { publicSdkSurfaceNames } from "../src/packed-sdk-surface.js";
import { replacementNames } from "../src/registry-deprecations.js";
import ts from "../src/typescript.cjs";
import sdkRetirements from "../src/sdk-retirements.json" with { type: "json" };

const { values } = parseArgs({ options: { target: { type: "string", multiple: true } } });
if (!values.target?.length) {
  console.error("Usage: node scripts/verify-packed-sdk-certificates.mjs --target <unpacked openclaw package> [--target ...]");
  process.exit(2);
}

let failed = false;
for (const target of values.target) {
  const packageRoot = path.resolve(target);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const declarations = [];
  for (const filePath of await listDeclarationFiles(path.join(packageRoot, "dist"))) {
    declarations.push({ filePath, source: await readFile(filePath, "utf8") });
  }
  const truth = publicSdkSurfaceNames(declarations, packageJson, packageRoot, { reduce: false });
  const tokens = new Set(replacementNames(sdkRetirements.records));
  for (const { filePath, source } of declarations) {
    const visit = (node) => {
      if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isPrivateIdentifier(node)) tokens.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false));
  }
  const all = certifyPublicSdkNames({ declarations, packageJson, packageRoot, names: tokens });
  const wrongAvailable = [...all.available].filter((name) => !truth.has(name));
  const wrongUnavailable = [...all.unavailable].filter((name) => truth.has(name));
  const inventory = certifyPublicSdkNames({ declarations, packageJson, packageRoot, names: replacementNames(sdkRetirements.records) });
  const label = `openclaw@${packageJson.version}`;
  console.log(`${label}: ${tokens.size} names: ${all.available.size} available, ${all.unavailable.size} unavailable, ${all.undecided.size} undecided; `
    + `inventory ${inventory.available.size} available, ${inventory.unavailable.size} unavailable, ${inventory.undecided.size} undecided`
    + (inventory.undecided.size ? ` (${[...inventory.undecided].join(", ")})` : ""));
  if (wrongAvailable.length || wrongUnavailable.length) {
    failed = true;
    console.error(`${label}: certificates disagree with the type check: available ${wrongAvailable.slice(0, 20).join(", ")}; unavailable ${wrongUnavailable.slice(0, 20).join(", ")}`);
  }
}
if (failed) process.exit(1);
