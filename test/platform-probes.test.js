import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlatformProbes,
  renderPlatformProbesMarkdown,
  validatePlatformProbes,
} from "../src/advanced.js";

test("platform probes classify loader and shell portability risks", () => {
  const report = buildPlatformProbes({
    plan: {
      generatedAt: "test",
      mode: "plan-only",
      summary: {
        fixtureCount: 1,
      },
      fixtures: [
        {
          id: "fixture",
          entrypoints: [
            {
              id: "cold-import.extension:fixture:index",
              status: "ts-loader-required",
              entrypoint: "plugins/fixture/src/index.ts",
              packageManager: "pnpm",
              loaderStrategy: {
                source: "typescript-source",
                primary: "tsx",
                alternatives: ["jiti"],
                reason: "test",
              },
              steps: [
                {
                  kind: "prepare",
                  command: "mkdir -p .workspaces/fixture && rsync -a plugins/fixture/ .workspaces/fixture/",
                },
                {
                  kind: "install",
                  command: "pnpm install --ignore-scripts",
                },
                {
                  kind: "capture",
                  command: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 node capture.mjs ./src/index.ts --mock-sdk",
                },
                {
                  kind: "synthetic-probe",
                  command: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 node synthetic.mjs --entrypoint ./src/index.ts --mock-sdk",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(validatePlatformProbes(report), []);
  assert.equal(report.summary.tsLoaderEntrypointCount, 1);
  assert.equal(report.summary.jitiAlternativeCount, 1);
  assert.ok(report.summary.windowsRiskStepCount > 0);
  assert.ok(report.summary.containerRiskStepCount > 0);
  assert.match(renderPlatformProbesMarkdown(report), /Jiti/);
  assert.match(renderPlatformProbesMarkdown(report), /rsync/);
});

test("platform probes separate executor-covered portability risks from residual risks", () => {
  const report = buildPlatformProbes({
    plan: {
      generatedAt: "test",
      mode: "plan-only",
      summary: {
        fixtureCount: 1,
      },
      fixtures: [
        {
          id: "fixture",
          entrypoints: [
            {
              id: "cold-import.extension:fixture:index",
              status: "dependency-install-required",
              entrypoint: "plugins/fixture/index.js",
              packageManager: "pnpm",
              loaderStrategy: {
                source: "javascript",
                primary: "node",
                alternatives: [],
                reason: "test",
              },
              steps: [
                {
                  kind: "prepare",
                  command: "mkdir -p .workspaces/fixture && rsync -a plugins/fixture/ .workspaces/fixture/",
                },
                {
                  kind: "audit",
                  command: "pnpm audit --json > ../../results/fixture/package-audit.json || true",
                },
                {
                  kind: "capture",
                  command: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 node capture.mjs ./index.js",
                },
              ],
            },
          ],
        },
      ],
    },
    stepCoverage({ riskCodes }) {
      return {
        reason: "covered by Crabpot structured executor",
        riskCodes: riskCodes.filter((code) =>
          ["posix-mkdir", "posix-env-prefix", "posix-null-failure", "rsync-required", "shell-redirection"].includes(code),
        ),
      };
    },
  });

  assert.equal(report.summary.portabilityFindingCount, 1);
  assert.equal(report.summary.coveredPortabilityFindingCount, 3);
  assert.equal(report.summary.windowsRiskStepCount, 1);
  assert.deepEqual(report.portabilityFindings[0].riskCodes, ["package-manager-availability"]);
  assert.ok(report.coveredPortabilityFindings.every((finding) => finding.coverage === "covered by Crabpot structured executor"));
  assert.doesNotMatch(renderPlatformProbesMarkdown(report), /replace shell mkdir/);
  assert.match(renderPlatformProbesMarkdown(report), /Covered Portability Findings/);
});

test("platform probe validation requires jiti fallback and reflected TypeScript loader commands", () => {
  const errors = validatePlatformProbes({
    mode: "plan-only",
    targets: ["linux", "macos", "windows", "container"],
    summary: {
      tsLoaderEntrypointCount: 1,
      jitiAlternativeCount: 0,
    },
    entrypoints: [
      {
        id: "cold-import.extension:fixture:index",
        loaderPrimary: "tsx",
        captureUsesTsx: true,
        captureUsesTypeScriptLoader: true,
        syntheticUsesTsx: false,
        syntheticUsesMockSdk: false,
        syntheticUsesTypeScriptLoader: false,
      },
    ],
  });

  assert.ok(errors.some((error) => error.includes("Jiti fallback")));
  assert.ok(errors.some((error) => error.includes("TypeScript loader strategy")));
});
