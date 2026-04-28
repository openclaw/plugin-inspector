#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginInspectorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = buildCrabpotFollowthroughChecklist({
    pluginInspectorRoot,
    crabpotRoot: options.crabpotRoot,
    expectedRef: options.expectedRef,
    expectedVersion: options.expectedVersion,
    requirePublishedPin: options.requirePublishedPin,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printChecklist(result);
  }

  if (result.status === "fail") {
    process.exitCode = 1;
  }
}

export function buildCrabpotFollowthroughChecklist(options = {}) {
  const root = options.pluginInspectorRoot ?? pluginInspectorRoot;
  const crabpotRoot = path.resolve(root, options.crabpotRoot ?? "../crabpot");
  const expectedRef = options.expectedRef ?? gitHead(root);
  const expectedVersion = options.expectedVersion ?? packageVersion(root);
  const sourcePath = path.join(crabpotRoot, "scripts", "plugin-inspector-source.mjs");
  const pins = existsSync(sourcePath) ? readCrabpotPins(sourcePath) : {};
  const advancedConsumers = findAdvancedConsumers(crabpotRoot);
  const expectedPackage = `@openclaw/plugin-inspector@${expectedVersion}`;
  const checks = [
    {
      id: "crabpot-source-ref",
      status: pins.pluginInspectorRef === expectedRef ? "pass" : "fail",
      message: `crabpot source ref points at plugin-inspector ${expectedRef}`,
      expected: expectedRef,
      actual: pins.pluginInspectorRef ?? "missing",
      fix: `update ${path.relative(process.cwd(), sourcePath)} pluginInspectorRef to ${expectedRef}`,
    },
    {
      id: "crabpot-public-api-migration",
      status: advancedConsumers.length === 0 ? "pass" : "fail",
      message: "crabpot scripts use the plugin-inspector root public API",
      expected: "no advanced bundle consumers",
      actual: advancedConsumers.length === 0 ? "none" : advancedConsumers.join(", "),
      fix: "switch listed crabpot scripts from loadPluginInspector() to loadPluginInspectorPublicApi() or local helpers",
    },
    {
      id: "crabpot-package-pin",
      status: pins.pluginInspectorPackage === expectedPackage ? "pass" : options.requirePublishedPin ? "fail" : "manual",
      message: `crabpot package smoke pin uses ${expectedPackage}`,
      expected: expectedPackage,
      actual: pins.pluginInspectorPackage ?? "missing",
      fix: `after npm publish, update ${path.relative(process.cwd(), sourcePath)} pluginInspectorPackage to ${expectedPackage}`,
    },
    {
      id: "crabpot-source-smoke",
      status: "manual",
      message: "run crabpot source-mode plugin-inspector smoke",
      command: "CRABPOT_PLUGIN_INSPECTOR_CLI=source npm run plugin-inspector:smoke",
    },
    {
      id: "crabpot-package-smoke",
      status: "manual",
      message: "run crabpot package-mode plugin-inspector smoke",
      command: "npm run plugin-inspector:smoke",
    },
  ];

  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    pluginInspectorRef: expectedRef,
    pluginInspectorVersion: expectedVersion,
    crabpotRoot,
    checks,
  };
}

function parseArgs(argv) {
  const options = {
    crabpotRoot: "../crabpot",
    expectedRef: undefined,
    expectedVersion: undefined,
    json: false,
    requirePublishedPin: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--crabpot") {
      options.crabpotRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-ref") {
      options.expectedRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-version") {
      options.expectedVersion = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--published") {
      options.requirePublishedPin = true;
    }
  }

  return options;
}

function readCrabpotPins(sourcePath) {
  const text = readFileSync(sourcePath, "utf8");
  return {
    pluginInspectorRef: text.match(/pluginInspectorRef\s*=\s*"([^"]+)"/)?.[1],
    pluginInspectorPackage: text.match(/pluginInspectorPackage\s*=\s*"([^"]+)"/)?.[1],
  };
}

function findAdvancedConsumers(crabpotRoot) {
  const scriptsDir = path.join(crabpotRoot, "scripts");
  if (!existsSync(scriptsDir)) {
    return [];
  }

  const consumers = [];
  for (const filePath of walkFiles(scriptsDir)) {
    if (!filePath.endsWith(".mjs") || path.basename(filePath) === "plugin-inspector-source.mjs") {
      continue;
    }
    const text = readFileSync(filePath, "utf8");
    if (/\bloadPluginInspector\s*\(/.test(text) || /src["']\s*,\s*["']advanced\.js/.test(text)) {
      consumers.push(path.relative(crabpotRoot, filePath));
    }
  }
  return consumers.sort();
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function gitHead(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function packageVersion(root) {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

function printChecklist(result) {
  console.log(`crabpot follow-through: ${result.status}`);
  console.log(`plugin-inspector ref: ${result.pluginInspectorRef}`);
  console.log(`plugin-inspector version: ${result.pluginInspectorVersion}`);
  for (const check of result.checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.actual && check.actual !== check.expected) {
      console.log(`  expected: ${check.expected}`);
      console.log(`  actual: ${check.actual}`);
    }
    if (check.command) {
      console.log(`  command: ${check.command}`);
    }
    if (check.status === "fail" && check.fix) {
      console.log(`  fix: ${check.fix}`);
    }
  }
}
