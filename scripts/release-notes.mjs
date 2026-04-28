#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const changelogText = readFileSync(options.changelogPath, "utf8");
  process.stdout.write(extractReleaseNotes({ changelogText, version: options.version }));
}

export function extractReleaseNotes({ changelogText, version }) {
  const lines = changelogText.split(/\r?\n/);
  const start = findReleaseStart(lines, version);
  if (start === -1) {
    throw new Error(`CHANGELOG.md is missing a ${version} release section`);
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end).join("\n").trim();
  const title = version === "Unreleased" ? "plugin-inspector unreleased" : `plugin-inspector v${version}`;
  return `## ${title}\n\n${body}\n`;
}

function findReleaseStart(lines, version) {
  if (version === "Unreleased") {
    return lines.findIndex((line) => line.trim() === "## Unreleased");
  }
  return lines.findIndex((line) => line.startsWith(`## ${version} - `));
}

function parseArgs(argv) {
  const options = {
    changelogPath: path.resolve("CHANGELOG.md"),
    version: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--changelog") {
      options.changelogPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--unreleased") {
      options.version = "Unreleased";
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

  if (!options.version) {
    throw new Error("usage: release-notes.mjs <version>|--unreleased [--changelog CHANGELOG.md]");
  }

  return options;
}
