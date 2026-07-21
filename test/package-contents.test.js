import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPackageContentsChecklist, parseNpmPackResult } from "../scripts/check-package-contents.mjs";

const packageJson = {
  bin: {
    "plugin-inspector": "src/cli.js",
  },
  exports: {
    ".": "./src/index.js",
    "./capture-api": "./src/capture-api.js",
  },
};

const requiredFiles = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "src/cli.js",
  "src/index.js",
  "src/capture-api.js",
  "examples/github-actions-plugin-inspector.yml",
  "examples/plugin-inspector.config.json",
  "docs/plugin-inspector-banner.jpg",
];

test("package contents pass when entrypoints and README assets are packed", () => {
  const result = buildPackageContentsChecklist({
    filePaths: requiredFiles,
    packageJson,
    readmeText: '<img src="docs/plugin-inspector-banner.jpg" alt="banner"/>',
  });

  assert.equal(result.status, "pass");
});

test("package contents fail when README assets are missing", () => {
  const result = buildPackageContentsChecklist({
    filePaths: requiredFiles.filter((filePath) => filePath !== "docs/plugin-inspector-banner.jpg"),
    packageJson,
    readmeText: '<img src="docs/plugin-inspector-banner.jpg" alt="banner"/>',
  });

  assert.equal(result.status, "fail");
  assert.equal(result.checks.find((check) => check.id === "package-readme-asset").actual, "missing");
});

test("package contents fail when private release scripts are packed", () => {
  const result = buildPackageContentsChecklist({
    filePaths: [...requiredFiles, "scripts/release-notes.mjs"],
    packageJson,
  });

  assert.equal(result.status, "fail");
  assert.equal(
    result.checks.find((check) => check.id === "package-forbidden-path").message,
    "scripts/release-notes.mjs should not be published in the npm package",
  );
});

test("package contents accepts npm pack's keyed result shape", () => {
  const pack = parseNpmPackResult(JSON.stringify({
    "@openclaw/plugin-inspector": { files: [{ path: "package.json" }] },
  }));

  assert.deepEqual(pack.files, [{ path: "package.json" }]);
});
