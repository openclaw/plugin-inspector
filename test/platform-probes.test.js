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
                  command: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 node --import tsx capture.mjs ./src/index.ts",
                },
                {
                  kind: "synthetic-probe",
                  command: "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 node --import tsx synthetic.mjs --entrypoint ./src/index.ts",
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

test("platform probe validation requires jiti fallback and reflected tsx commands", () => {
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
        syntheticUsesTsx: false,
      },
    ],
  });

  assert.ok(errors.some((error) => error.includes("Jiti fallback")));
  assert.ok(errors.some((error) => error.includes("tsx loader strategy")));
});
