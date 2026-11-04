#!/usr/bin/env node
// Maintains src/packed-sdk-qualifications.json: for released OpenClaw npm
// packages, which SDK retirement replacements their public declarations
// expose. Each answer is computed twice, with the full-snapshot type check that
// 0.4.4/0.4.5 ran on every publish and with the reduced on-demand path, and the
// two must agree on every public name before anything is written.
//
//   node scripts/packed-sdk-qualifications.mjs --write --version 2026.10.10 [--version ...]
//   node scripts/packed-sdk-qualifications.mjs --check
//
// Both modes download from the npm registry (verified against dist.integrity);
// neither runs in the default offline checks.
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { packedSdkSnapshotDigest, PACKED_SDK_QUALIFICATION_ALGORITHM, replacementNames } from "../src/registry-deprecations.js";
import { publicSdkSurfaceNames } from "../src/packed-sdk-surface.js";
import sdkRetirements from "../src/sdk-retirements.json" with { type: "json" };
import { downloadNpmPackage, isPackedOpenClawSurfaceEntry } from "./lib/npm-package.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const tablePath = path.join(repositoryRoot, "src/packed-sdk-qualifications.json");

const { values } = parseArgs({
  options: {
    write: { type: "boolean" },
    check: { type: "boolean" },
    version: { type: "string", multiple: true },
    "package-dir": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help || (!values.write && !values.check)) {
  console.log("Usage: node scripts/packed-sdk-qualifications.mjs (--write --version <openclaw-version>... | --check) [--package-dir <unpacked openclaw package>]");
  process.exit(values.help ? 0 : 2);
}

const wanted = replacementNames(sdkRetirements.records);
const table = JSON.parse(await readFile(tablePath, "utf8"));

if (values.write) {
  const versions = values.version ?? [];
  if (!versions.length) throw new Error("--write needs at least one --version");
  const targets = new Map(table.targets.map((target) => [target.version, target]));
  // A changed inventory invalidates every stored answer; recompute them all.
  if (JSON.stringify(table.checkedNames) !== JSON.stringify(wanted) || table.algorithm !== PACKED_SDK_QUALIFICATION_ALGORITHM) targets.clear();
  for (const version of new Set([...targets.keys(), ...versions])) {
    targets.set(version, await qualify(version));
  }
  const next = {
    algorithm: PACKED_SDK_QUALIFICATION_ALGORITHM,
    checkedNames: wanted,
    targets: [...targets.values()].sort((left, right) => left.version.localeCompare(right.version, "en", { numeric: true })),
  };
  await writeFile(tablePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${next.targets.length} OpenClaw snapshot qualifications to ${path.relative(process.cwd(), tablePath)}.`);
} else {
  const problems = [];
  if (table.algorithm !== PACKED_SDK_QUALIFICATION_ALGORITHM) problems.push(`table algorithm ${table.algorithm} is not ${PACKED_SDK_QUALIFICATION_ALGORITHM}`);
  if (JSON.stringify(table.checkedNames) !== JSON.stringify(wanted)) problems.push("checkedNames no longer match src/sdk-retirements.json; rerun --write");
  for (const stored of table.targets) {
    const fresh = await qualify(stored.version);
    if (fresh.snapshotSha256 !== stored.snapshotSha256) problems.push(`${stored.version}: snapshot digest changed`);
    if (JSON.stringify(fresh.available) !== JSON.stringify(stored.available)) problems.push(`${stored.version}: available replacements differ`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Verified ${table.targets.length} OpenClaw snapshot qualifications against a full type check.`);
}

async function qualify(version) {
  const workspace = await mkdtemp(path.join(tmpdir(), "plugin-inspector-openclaw-"));
  try {
    const packageRoot = values["package-dir"] && values.version?.length === 1
      ? path.resolve(values["package-dir"])
      : await downloadNpmPackage("openclaw", version, workspace, { filter: isPackedOpenClawSurfaceEntry });
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (packageJson.name !== "openclaw" || packageJson.version !== version) throw new Error(`${packageRoot} is not openclaw@${version}`);
    const declarations = [];
    for (const filePath of await listDeclarationFiles(path.join(packageRoot, "dist"))) {
      declarations.push({ filePath, source: await readFile(filePath, "utf8") });
    }
    const full = publicSdkSurfaceNames(declarations, packageJson, packageRoot, { reduce: false });
    const reduced = publicSdkSurfaceNames(declarations, packageJson, packageRoot, { reduce: true });
    // Unique-symbol member names embed checker-local ids (__@name@123); every
    // other public name must match exactly.
    const comparable = (names) => [...names].filter((name) => !name.startsWith("__@")).sort();
    const left = comparable(full);
    const right = comparable(reduced);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      const missing = left.filter((name) => !reduced.has(name));
      const extra = right.filter((name) => !full.has(name));
      throw new Error(`openclaw@${version}: reduced type check disagrees (missing ${missing.slice(0, 10).join(", ")}; extra ${extra.slice(0, 10).join(", ")})`);
    }
    const available = wanted.filter((name) => full.has(name));
    console.log(`openclaw@${version}: ${left.length} public names, ${available.length}/${wanted.length} replacement names available`);
    return {
      package: "openclaw",
      version,
      snapshotSha256: packedSdkSnapshotDigest({ declarations, packageJson, packageRoot }),
      publicNameCount: left.length,
      available,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function listDeclarationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listDeclarationFiles(entryPath)));
    else if (entry.isFile() && /\.d\.[cm]?ts$/.test(entry.name)) files.push(entryPath);
  }
  return files.sort();
}
