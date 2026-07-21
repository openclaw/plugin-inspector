#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? ".");
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const readmeText = readFileSync(path.join(root, "README.md"), "utf8");
  const filePaths = npmPackFilePaths(root);
  const result = buildPackageContentsChecklist({ filePaths, packageJson, readmeText });

  printChecklist(result);
  if (result.status === "fail") {
    process.exitCode = 1;
  }
}

export function buildPackageContentsChecklist({ filePaths, packageJson, readmeText = "" }) {
  const files = new Set(filePaths);
  const checks = [
    ...requiredFileChecks(files),
    ...entrypointChecks(files, packageJson),
    ...readmeAssetChecks(files, readmeText),
    ...forbiddenPathChecks(filePaths),
  ];

  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    entryCount: filePaths.length,
    checks,
  };
}

function requiredFileChecks(files) {
  return [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "src/cli.js",
    "src/index.js",
    "examples/github-actions-plugin-inspector.yml",
    "examples/plugin-inspector.config.json",
  ].map((filePath) => presenceCheck(files, "package-required-file", filePath));
}

function entrypointChecks(files, packageJson) {
  const checks = [];
  for (const [name, filePath] of Object.entries(packageJson.bin ?? {})) {
    checks.push(presenceCheck(files, "package-bin-entry", normalizePackagePath(filePath), name));
  }
  for (const [name, target] of Object.entries(packageJson.exports ?? {})) {
    for (const filePath of exportTargets(target)) {
      checks.push(presenceCheck(files, "package-export-entry", normalizePackagePath(filePath), name));
    }
  }
  return checks;
}

function readmeAssetChecks(files, readmeText) {
  const assetPaths = new Set();
  for (const match of readmeText.matchAll(/<img\s+[^>]*src=["']([^"']+)["']/gi)) {
    assetPaths.add(match[1]);
  }
  for (const match of readmeText.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    assetPaths.add(match[1]);
  }

  return [...assetPaths]
    .filter((assetPath) => isPackageRelativeAsset(assetPath))
    .map((assetPath) => presenceCheck(files, "package-readme-asset", normalizePackagePath(assetPath)));
}

function forbiddenPathChecks(filePaths) {
  const forbiddenPrefixes = ["test/", "scripts/", ".github/"];
  return filePaths
    .filter((filePath) => forbiddenPrefixes.some((prefix) => filePath.startsWith(prefix)))
    .map((filePath) => ({
      id: "package-forbidden-path",
      status: "fail",
      message: `${filePath} should not be published in the npm package`,
    }));
}

function presenceCheck(files, id, filePath, detail = filePath) {
  return {
    id,
    status: files.has(filePath) ? "pass" : "fail",
    message: `${detail} includes ${filePath}`,
    expected: filePath,
    actual: files.has(filePath) ? filePath : "missing",
  };
}

function exportTargets(target) {
  if (typeof target === "string") {
    return [target];
  }
  if (target && typeof target === "object") {
    return Object.values(target).flatMap((value) => exportTargets(value));
  }
  return [];
}

function isPackageRelativeAsset(assetPath) {
  return !assetPath.startsWith("http://")
    && !assetPath.startsWith("https://")
    && !assetPath.startsWith("#")
    && !assetPath.startsWith("/");
}

function normalizePackagePath(filePath) {
  return filePath.replace(/^\.\//, "");
}

function npmPackFilePaths(root) {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pack = parseNpmPackResult(output);
  return pack.files.map((file) => file.path).sort();
}

export function parseNpmPackResult(output) {
  const parsed = JSON.parse(output);
  const packs = Array.isArray(parsed) ? parsed : Object.values(parsed);
  if (packs.length !== 1 || !Array.isArray(packs[0]?.files)) {
    throw new Error("npm pack did not return exactly one package with a file list");
  }
  return packs[0];
}

function printChecklist(result) {
  console.log(`package contents: ${result.status}`);
  console.log(`package entries: ${result.entryCount}`);
  for (const check of result.checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.status === "fail" && check.actual !== check.expected) {
      console.log(`  expected: ${check.expected}`);
      console.log(`  actual: ${check.actual}`);
    }
  }
}
