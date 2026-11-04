#!/usr/bin/env node
// Downloads the publish-memory benchmark inputs from npm (integrity-verified):
// the packed OpenClaw public surface ClawHub inspects against, and the large
// official channel plugins whose 2026.10.10 publishes ran out of memory.
//
//   node scripts/fetch-publish-memory-fixtures.mjs --out <dir> [--openclaw 2026.10.10] [--plugin @openclaw/matrix@2026.10.10 ...]
//
// Layout: <dir>/openclaw/package and <dir>/plugins/<name>/package.
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { downloadNpmPackage, isPackedOpenClawSurfaceEntry } from "./lib/npm-package.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    openclaw: { type: "string", default: "2026.10.10" },
    plugin: { type: "string", multiple: true },
  },
});
if (!values.out) {
  console.error("Usage: node scripts/fetch-publish-memory-fixtures.mjs --out <dir> [--openclaw <version>] [--plugin <name@version>...]");
  process.exit(2);
}
const out = path.resolve(values.out);
const plugins = values.plugin ?? ["@openclaw/discord@2026.10.10", "@openclaw/matrix@2026.10.10", "@openclaw/whatsapp@2026.10.10"];

const targetRoot = path.join(out, "openclaw");
if (!existsSync(path.join(targetRoot, "package/package.json"))) {
  await downloadNpmPackage("openclaw", values.openclaw, targetRoot, { filter: isPackedOpenClawSurfaceEntry });
}
console.log(`target ${path.join(targetRoot, "package")}`);
for (const spec of plugins) {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const root = path.join(out, "plugins", name.split("/").pop());
  if (!existsSync(path.join(root, "package/package.json"))) await downloadNpmPackage(name, version, root);
  console.log(`plugin ${name}=${path.join(root, "package")}`);
}
