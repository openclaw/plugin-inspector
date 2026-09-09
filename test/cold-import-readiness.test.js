import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildColdImportReadiness,
  renderColdImportReadinessMarkdown,
  validateColdImportReadiness,
} from "../src/advanced.js";

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

test("cold import readiness preserves combined blocker evidence", async (t) => {
  const cases = [
    {
      name: "SDK alias precedes dependencies for an existing entrypoint",
      entrypoint: { kind: "extension", specifier: "./index.js", relativePath: "index.js", exists: true },
      status: "sdk-alias-required",
      blocker: "dependency-install-required",
      assertion: "fixture dependencies are installed in an isolated workspace before cold import",
      buildRequiredCount: 0,
      dependencyInstallRequiredCount: 1,
    },
    {
      name: "absent build output precedes SDK alias",
      entrypoint: { kind: "extension", specifier: "./dist/index.js", relativePath: "dist/index.js", exists: false, requiresBuild: true },
      status: "build-required",
      blocker: "build-required",
      assertion: "plugin build or source alias resolution runs before cold import",
      buildRequiredCount: 1,
      dependencyInstallRequiredCount: 0,
    },
    {
      name: "absent plain entrypoint precedes SDK alias",
      entrypoint: { kind: "extension", specifier: "./missing.js", relativePath: "missing.js", exists: false },
      status: "missing",
      blocker: "missing-entrypoint",
      assertion: "plugin package metadata points at an existing OpenClaw entrypoint",
      buildRequiredCount: 0,
      dependencyInstallRequiredCount: 0,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const readiness = buildColdImportReadiness({
        report: readinessReport([fixture.entrypoint], {
          dependencies: ["left-pad"],
          sdkImportDetails: [
            {
              specifier: "openclaw/plugin-sdk/legacy-helper",
              ref: "index.js:1",
            },
          ],
        }),
      });
      const entrypoint = readiness.fixtures[0].entrypoints[0];

      assert.deepEqual(
        { status: entrypoint.status, buildRequiredCount: readiness.summary.buildRequiredCount },
        { status: fixture.status, buildRequiredCount: fixture.buildRequiredCount },
      );
      assert.deepEqual(
        entrypoint.blockers.map((blocker) => blocker.code),
        [fixture.blocker, "sdk-alias-required"],
      );
      assert.deepEqual(entrypoint.assertions, [
        fixture.assertion,
        "target OpenClaw exports the imported SDK alias or provides a migration shim",
      ]);
      assert.equal(readiness.summary.dependencyInstallRequiredCount, fixture.dependencyInstallRequiredCount);
      assert.equal(readiness.summary.sdkAliasRequiredCount, 1);
      assert.deepEqual(validateColdImportReadiness(readiness), []);
    });
  }
});

test("cold import readiness treats openclaw as a host-linked dependency", () => {
  const readiness = buildColdImportReadiness({
    report: readinessReport(
      [{ kind: "extension", specifier: "./index.js", relativePath: "index.js", exists: true }],
      {
        dependencies: ["openclaw"],
      },
    ),
  });
  const entrypoint = readiness.fixtures[0].entrypoints[0];

  assert.equal(entrypoint.status, "ready");
  assert.deepEqual(entrypoint.blockers, []);
  assert.equal(readiness.summary.dependencyInstallRequiredCount, 0);
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
