import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildColdImportReadiness,
  buildWorkspacePlan,
  renderWorkspacePlanMarkdown,
  validateWorkspacePlan,
} from "../src/advanced.js";

test("workspace plan maps blocked entrypoints to opt-in install/build/capture steps", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-workspace-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await mkdir(path.join(rootDir, "plugins/fixture"), { recursive: true });
  await writeFile(
    path.join(rootDir, "plugins/fixture/package.json"),
    JSON.stringify(
      {
        name: "fixture",
        packageManager: "npm@10.0.0",
        scripts: { build: "tsup" },
        dependencies: { "left-pad": "^1.3.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(path.join(rootDir, "plugins/fixture/package-lock.json"), "{}\n", "utf8");
  await mkdir(path.join(rootDir, "plugins/build"), { recursive: true });
  await writeFile(
    path.join(rootDir, "plugins/build/package.json"),
    JSON.stringify({ name: "build-fixture", scripts: { build: "tsup" } }, null, 2),
    "utf8",
  );

  const report = readinessReport();
  const readiness = buildColdImportReadiness({ report, rootDir });
  const plan = await buildWorkspacePlan({
    report,
    readiness,
    rootDir,
    optInEnv: "TEST_EXEC=1",
    workspaceRoot: ".workspaces",
    resultsRoot: ".results",
    captureScript: "capture.mjs",
    syntheticProbeScript: "synthetic.mjs",
  });

  assert.deepEqual(validateWorkspacePlan(plan, { optInEnv: "TEST_EXEC=1" }), []);
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.optIn.env, "TEST_EXEC=1");
  assert.equal(plan.summary.entrypointCount, 2);
  assert.equal(plan.summary.artifactStepCount, 2);
  assert.equal(plan.summary.installStepCount, 1);
  assert.equal(plan.summary.auditStepCount, 1);
  assert.equal(plan.summary.buildStepCount, 1);
  assert.equal(plan.summary.captureStepCount, 2);
  assert.equal(plan.summary.syntheticProbeStepCount, 2);
  assert.equal(plan.summary.targetOpenClawLinkStepCount, 2);
  assert.equal(plan.summary.tsLoaderEntrypointCount, 1);
  assert.equal(plan.summary.jitiAlternativeCount, 1);

  const entrypoint = plan.fixtures[0].entrypoints.find((item) => item.packageName === "fixture");
  assert.ok(entrypoint);
  assert.equal(entrypoint.packageManager, "npm");
  assert.equal(entrypoint.lockfile, "plugins/fixture/package-lock.json");
  assert.ok(entrypoint.requiredCapabilities.includes("target-openclaw-link"));
  assert.ok(entrypoint.requiredCapabilities.includes("dependency-install"));
  assert.ok(entrypoint.requiredCapabilities.includes("sdk-alias-compat"));
  assert.ok(entrypoint.requiredCapabilities.includes("ts-loader"));
  assert.ok(entrypoint.steps.some((step) => step.kind === "install" && step.command === "npm install --ignore-scripts"));
  assert.ok(entrypoint.steps.some((step) => step.kind === "capture" && step.command.includes("node --import tsx capture.mjs")));
  assert.ok(entrypoint.steps.some((step) => step.kind === "synthetic-probe" && step.command.includes("synthetic.mjs")));
  const buildEntrypoint = plan.fixtures[0].entrypoints.find((item) => item.packageName === "build-fixture");
  assert.ok(buildEntrypoint);
  assert.ok(buildEntrypoint.requiredCapabilities.includes("build"));
  assert.ok(buildEntrypoint.steps.some((step) => step.kind === "build" && step.command === "npm run build"));
  assert.match(renderWorkspacePlanMarkdown(plan), /Entrypoint Workspaces/);
});

test("workspace plan validation keeps execution opt-in and explicit", () => {
  const plan = {
    mode: "execute",
    optIn: { env: "NOPE=1" },
    fixtures: [
      {
        id: "fixture",
        entrypoints: [
          {
            id: "cold-import.extension:fixture:index",
            packagePath: "plugins/fixture/package.json",
            entrypoint: "plugins/fixture/index.js",
            loaderStrategy: { primary: "node", alternatives: [], reason: "test" },
            requiredCapabilities: ["dependency-install"],
            blockers: [],
            steps: [{ kind: "capture", command: "node capture.js", cwd: ".", reason: "capture" }],
          },
        ],
      },
    ],
  };

  const errors = validateWorkspacePlan(plan);
  assert.ok(errors.some((error) => error.includes("plan-only")));
  assert.ok(errors.some((error) => error.includes("PLUGIN_INSPECTOR_EXECUTE_ISOLATED")));
  assert.ok(errors.some((error) => error.includes("missing prepare step")));
  assert.ok(errors.some((error) => error.includes("dependency install capability has no install step")));
  assert.ok(errors.some((error) => error.includes("dependency install capability has no audit step")));

  plan.fixtures[0].entrypoints[0].loaderStrategy = null;
  const loaderErrors = validateWorkspacePlan(plan);
  assert.ok(loaderErrors.some((error) => error.includes("missing loader strategy")));
  plan.fixtures[0].entrypoints[0].loaderStrategy = { primary: "node", alternatives: [], reason: "test" };

  plan.fixtures[0].entrypoints[0].requiredCapabilities = ["target-openclaw-link"];
  const linkErrors = validateWorkspacePlan(plan);
  assert.ok(linkErrors.some((error) => error.includes("target-openclaw-link capability has no link-openclaw step")));

  plan.fixtures[0].entrypoints[0].requiredCapabilities = ["build", "ts-loader"];
  const buildErrors = validateWorkspacePlan(plan);
  assert.ok(buildErrors.some((error) => error.includes("build capability has no build step")));
  assert.ok(buildErrors.some((error) => error.includes("jiti fallback")));

  plan.fixtures[0].entrypoints[0].requiredCapabilities = [];
  plan.fixtures[0].entrypoints[0].steps = [{ kind: "prepare", command: "", cwd: ".", reason: "" }];
  const stepErrors = validateWorkspacePlan(plan);
  assert.ok(stepErrors.some((error) => error.includes("prepare step missing command, cwd, or reason")));
});

function readinessReport() {
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
        sdkImportDetails: [
          {
            specifier: "openclaw/plugin-sdk/legacy-helper",
            ref: "plugins/fixture/src/index.ts:1",
          },
        ],
        packages: [
          {
            path: "plugins\\fixture\\package.json",
            name: "fixture",
            dependencies: ["left-pad"],
            peerDependencies: [],
            optionalDependencies: [],
            openclaw: {
              entrypoints: [
                {
                  kind: "extension",
                  specifier: "./src/index.ts",
                  relativePath: "plugins/fixture/src/index.ts",
                  exists: true,
                },
              ],
            },
          },
          {
            path: "plugins\\build\\package.json",
            name: "build-fixture",
            dependencies: [],
            peerDependencies: [],
            optionalDependencies: [],
            openclaw: {
              entrypoints: [
                {
                  kind: "extension",
                  specifier: "./dist/index.js",
                  relativePath: "plugins/build/dist/index.js",
                  exists: false,
                  requiresBuild: true,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
