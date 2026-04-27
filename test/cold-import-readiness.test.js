import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildColdImportReadiness,
  renderColdImportReadinessMarkdown,
  validateColdImportReadiness,
} from "../src/index.js";

test("cold import readiness classifies entrypoint blockers", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-readiness-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const readyPath = "ready.js";
  const sideEffectPath = "side-effect.js";
  const unknownPath = "loader.custom";
  await writeFile(path.join(rootDir, readyPath), "export function register() {}\n", "utf8");
  await writeFile(path.join(rootDir, sideEffectPath), "process.env.SECRET; export function register() {}\n", "utf8");
  await writeFile(path.join(rootDir, unknownPath), "export function register() {}\n", "utf8");

  const readiness = buildColdImportReadiness({
    rootDir,
    report: readinessReport([
      { kind: "extension", specifier: "./ready.js", relativePath: readyPath, exists: true },
      { kind: "extension", specifier: "./side-effect.js", relativePath: sideEffectPath, exists: true },
      { kind: "extension", specifier: "./loader.custom", relativePath: unknownPath, exists: true },
      { kind: "extension", specifier: "./dist.js", relativePath: "dist/index.js", exists: false, requiresBuild: true },
      { kind: "extension", specifier: "./index.ts", relativePath: "src/index.ts", exists: true },
    ]),
  });
  const entrypoints = readiness.fixtures[0].entrypoints;

  assert.deepEqual(validateColdImportReadiness(readiness), []);
  assert.equal(readiness.summary.entrypointCount, 5);
  assert.equal(readiness.summary.readyCount, 1);
  assert.equal(readiness.summary.blockedCount, 4);
  assert.equal(readiness.summary.tsLoaderRequiredCount, 1);
  assert.equal(readiness.summary.buildRequiredCount, 1);
  assert.equal(entrypoints.find((entrypoint) => entrypoint.path === readyPath).status, "ready");
  assert.equal(entrypoints.find((entrypoint) => entrypoint.path === sideEffectPath).status, "review-required");
  assert.equal(entrypoints.find((entrypoint) => entrypoint.path === unknownPath).status, "review-required");
  assert.match(renderColdImportReadinessMarkdown(readiness), /## Entrypoints/);
});

test("cold import readiness preserves combined blocker evidence", () => {
  const readiness = buildColdImportReadiness({
    report: readinessReport(
      [{ kind: "extension", specifier: "./index.js", relativePath: "index.js", exists: true }],
      {
        dependencies: ["left-pad"],
        sdkImportDetails: [
          {
            specifier: "openclaw/plugin-sdk/discord",
            ref: "index.js:1",
          },
        ],
      },
    ),
  });
  const entrypoint = readiness.fixtures[0].entrypoints[0];

  assert.equal(entrypoint.status, "sdk-alias-required");
  assert.deepEqual(
    entrypoint.blockers.map((blocker) => blocker.code),
    ["dependency-install-required", "sdk-alias-required"],
  );
  assert.equal(readiness.summary.dependencyInstallRequiredCount, 1);
  assert.equal(readiness.summary.sdkAliasRequiredCount, 1);
  assert.deepEqual(validateColdImportReadiness(readiness), []);
});

test("cold import readiness validation rejects incomplete entries", () => {
  const errors = validateColdImportReadiness({
    fixtures: [
      {
        id: "fixture",
        entrypoints: [
          {
            id: "cold-import.extension:fixture:index",
            path: "plugins/fixture/index.ts",
            status: "ts-loader-required",
            blockers: [{ code: "ts-loader-required" }],
            assertions: [],
          },
        ],
      },
    ],
  });

  assert.ok(errors.some((error) => error.includes("missing cold-import assertions")));
  assert.ok(errors.some((error) => error.includes("blocker is missing code or evidence")));
});

function readinessReport(entrypoints, overrides = {}) {
  return {
    generatedAt: "test",
    targetOpenClaw: {
      status: "ok",
      configuredPath: "../openclaw",
      sdkExports: ["openclaw/plugin-sdk"],
      sdkExportCount: 1,
    },
    fixtures: [
      {
        id: "fixture",
        priority: "high",
        sdkImportDetails: overrides.sdkImportDetails ?? [],
        packages: [
          {
            path: "plugins/fixture/package.json",
            dependencies: overrides.dependencies ?? [],
            peerDependencies: [],
            optionalDependencies: [],
            openclaw: {
              entrypoints,
            },
          },
        ],
      },
    ],
  };
}
