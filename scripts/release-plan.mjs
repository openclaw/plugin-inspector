#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractReleaseNotes } from "./release-notes.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const changelogText = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const plan = buildReleasePlan({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    changelogText,
    releaseRef: options.releaseRef,
    releaseDate: options.date,
    nextVersion: options.version,
  });

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printReleasePlan(plan);
  }

  if (plan.status === "fail") {
    process.exitCode = 1;
  }
}

export function buildReleasePlan({
  packageName = "@openclaw/plugin-inspector",
  packageVersion,
  changelogText,
  releaseRef = "REPLACE_WITH_RELEASE_COMMIT_SHA",
  releaseDate = today(),
  nextVersion,
}) {
  const version = nextVersion ?? bumpPatch(packageVersion);
  const checks = [
    {
      id: "version-advance",
      status: compareVersions(version, packageVersion) > 0 ? "pass" : "fail",
      message: `${version} is newer than ${packageVersion}`,
      expected: `>${packageVersion}`,
      actual: version,
    },
    {
      id: "changelog-unreleased",
      status: hasUnreleasedNotes(changelogText) ? "pass" : "fail",
      message: "CHANGELOG.md has non-empty Unreleased notes",
    },
  ];

  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    packageName,
    currentVersion: packageVersion,
    nextVersion: version,
    releaseDate,
    releaseRef,
    tagName: `v${version}`,
    changelogHeading: `## ${version} - ${releaseDate}`,
    crabpotSourceRef: releaseRef,
    crabpotPackagePin: `${packageName}@${version}`,
    releaseNotes: safeReleaseNotes(changelogText),
    checks,
    steps: [
      `update package.json version to ${version}`,
      `move CHANGELOG.md Unreleased notes to "${`## ${version} - ${releaseDate}`}"`,
      `set crabpot pluginInspectorRef to ${releaseRef}`,
      "run npm run release:readiness",
      `create and push annotated tag ${`v${version}`}`,
      `after npm publish, set crabpot pluginInspectorPackage to ${packageName}@${version}`,
      "run npm run release:crabpot -- --published",
    ],
  };
}

function hasUnreleasedNotes(changelogText) {
  try {
    return extractReleaseNotes({ changelogText, version: "Unreleased" })
      .split(/\r?\n/)
      .some((line) => line.trim().startsWith("- "));
  } catch {
    return false;
  }
}

function safeReleaseNotes(changelogText) {
  try {
    return extractReleaseNotes({ changelogText, version: "Unreleased" });
  } catch {
    return "";
  }
}

function bumpPatch(version) {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`cannot infer next patch version from ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function parseVersion(version) {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`invalid semver version: ${version}`);
  }
  return match.slice(1).map(Number);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = {
    root: ".",
    date: today(),
    json: false,
    releaseRef: undefined,
    version: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--date") {
      options.date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--ref") {
      options.releaseRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--version") {
      options.version = argv[index + 1];
      index += 1;
      continue;
    }
    if (!options.version) {
      options.version = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printReleasePlan(plan) {
  console.log(`release plan: ${plan.status}`);
  console.log(`package: ${plan.packageName}`);
  console.log(`current version: ${plan.currentVersion}`);
  console.log(`next version: ${plan.nextVersion}`);
  console.log(`release date: ${plan.releaseDate}`);
  console.log(`release ref: ${plan.releaseRef}`);
  console.log(`tag: ${plan.tagName}`);
  for (const check of plan.checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.status === "fail" && check.actual !== check.expected) {
      console.log(`  expected: ${check.expected}`);
      console.log(`  actual: ${check.actual}`);
    }
  }
  console.log("steps:");
  for (const step of plan.steps) {
    console.log(`- ${step}`);
  }
}
