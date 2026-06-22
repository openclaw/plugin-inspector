import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("check command runs from a plugin root without fixture config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cli-root-"));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/openclaw-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );

  const cliPath = path.resolve("src/cli.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", "--out", "reports", "--no-openclaw"], {
    cwd: rootDir,
  });
  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const issues = await readFile(path.join(rootDir, "reports", "plugin-inspector-issues.md"), "utf8");

  assert.match(stdout, /Status: PASS/);
  assert.equal(report.summary.logCount, report.logs.length);
  assert.match(stdout, new RegExp(`Logs: ${report.logs.length}\\b`));
  assert.doesNotMatch(stdout, /Logs: undefined/);
  assert.equal(report.targetOpenClaw.status, "disabled");
  assert.equal(report.fixtures[0].id, "weather");
  assert.ok(report.fixtures[0].package.openclaw.entrypoints.some((entrypoint) => entrypoint.exists));
  assert.match(issues, /# OpenClaw Plugin Issue Findings/);

  await execFileAsync(
    process.execPath,
    [cliPath, "check", "--out", "capture-reports", "--no-openclaw", "--capture", "--allow-execute"],
    { cwd: rootDir },
  );
  const capture = JSON.parse(
    await readFile(path.join(rootDir, "capture-reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(capture.summary.capturedCount, 1);
  assert.equal(capture.summary.registrationCount, 1);
});

test("check command can target a plugin root and use runtime aliases", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-target-");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "--plugin-root", rootDir, "--out", "reports", "--no-openclaw", "--runtime", "--mock-sdk", "--allow-execute"],
    {
      cwd: os.tmpdir(),
    },
  );

  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const capture = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(report.fixtures[0].id, "weather");
  assert.equal(capture.summary.capturedCount, 1);
});

test("check command sanitizes absolute OpenClaw paths in JSON output and artifacts", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-sanitize-");
  const openclawPath = await createTargetOpenClaw(rootDir);
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "check", "--out", "reports", "--openclaw", openclawPath, "--json"],
    { cwd: rootDir },
  );
  const output = JSON.parse(stdout);
  const artifact = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));

  assert.equal(output.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.equal(artifact.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.deepEqual(artifact.targetOpenClaw.searchedPaths, ["<OPENCLAW_PATH>"]);
  assert.doesNotMatch(stdout, new RegExp(escapeRegExp(openclawPath)));
});

test("inspect command runs from a plugin root and can write CI outputs", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-inspect-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "inspect",
    "--out",
    "reports",
    "--no-openclaw",
    "--sarif",
    "--junit",
  ], {
    cwd: rootDir,
  });

  const sarif = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector.sarif"), "utf8"));
  const junit = await readFile(path.join(rootDir, "reports", "plugin-inspector.junit.xml"), "utf8");

  assert.match(stdout, /Status: PASS/);
  assert.equal(sarif.version, "2.1.0");
  assert.match(junit, /<testsuite name="plugin-inspector"/);
});

test("inspect command only fails plugin-root findings when check mode is requested", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-inspect-non-check-");
  await writeFile(
    path.join(rootDir, "plugin-inspector.config.json"),
    `${JSON.stringify(
      { version: 1, plugin: { id: "weather", priority: "high", sourceRoot: "src", expect: { registrations: ["missingTool"] } } },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "inspect", "--out", "reports", "--no-openclaw"],
    { cwd: rootDir },
  );

  assert.match(stdout, /Status: FAIL/);
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "inspect", "--out", "check-reports", "--no-openclaw", "--check"], { cwd: rootDir }),
    (error) => {
      assert.match(error.stderr, /plugin-inspector found 1 breakages/);
      return true;
    },
  );
});

test("capture command defaults to the mock SDK", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-capture-mock-default-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "capture", "src/index.js", "--allow-execute"],
    {
      cwd: rootDir,
      env: { ...process.env, PLUGIN_INSPECTOR_EXECUTE_ISOLATED: "1" },
    },
  );
  const capture = JSON.parse(stdout);

  assert.equal(capture.mockSdk, true);
  assert.equal(capture.captured.some((item) => item.kind === "registration" && item.name === "registerTool"), true);
});

test("inspect command with config applies author-facing filtering", async () => {
  const rootDir = await createFixtureSetRoot("plugin-inspector-cli-inspect-config-author-");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(process.execPath, [
    cliPath,
    "inspect",
    "--config",
    path.join(rootDir, "plugin-inspector.config.json"),
    "--out",
    "reports",
    "--no-openclaw",
    "--author-facing",
  ]);
  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));

  assert.equal(report.issues.some((issue) => issue.code === "runtime-tool-capture"), false);
  assert.equal(report.summary.inspectorGapCount, 0);
  assert.ok(report.issues.some((issue) => issue.code === "legacy-root-sdk-import"));
  assert.ok(report.issues.every((issue) => issue.authorRemediation?.docsUrl));
});

test("report command with config rejects the legacy inspector-gap flag", async () => {
  const rootDir = await createFixtureSetRoot("plugin-inspector-cli-report-config-legacy-");
  const cliPath = path.resolve("src/cli.js");

  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        cliPath,
        "report",
        "--config",
        path.join(rootDir, "plugin-inspector.config.json"),
        "--out",
        "reports",
        "--include-inspector-gaps",
      ]),
    (error) => {
      assert.match(error.stderr, /--include-inspector-gaps has been replaced by --author-facing/);
      return true;
    },
  );
});

test("check command can enable runtime capture from plugin config", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-config-runtime-");
  await writeFile(
    path.join(rootDir, "plugin-inspector.config.json"),
    `${JSON.stringify({ version: 1, capture: { runtime: true, mockSdk: true } }, null, 2)}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(process.execPath, [cliPath, "check", "--out", "reports", "--no-openclaw", "--allow-execute"], {
    cwd: rootDir,
  });

  const capture = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-runtime-capture.json"), "utf8"),
  );
  assert.equal(capture.summary.registrationCount, 1);
});

test("check command filters author-facing output and rejects the legacy inspector-gap flag", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-inspector-gaps-");
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(process.execPath, [cliPath, "check", "--out", "reports", "--no-openclaw"], {
    cwd: rootDir,
  });
  const defaultReport = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"),
  );

  await execFileAsync(process.execPath, [cliPath, "check", "--out", "author-reports", "--no-openclaw", "--author-facing"], {
    cwd: rootDir,
  });
  const authorReport = JSON.parse(
    await readFile(path.join(rootDir, "author-reports", "plugin-inspector-report.json"), "utf8"),
  );

  assert.ok(defaultReport.suggestions.some((finding) => finding.code === "runtime-tool-capture"));
  assert.ok(defaultReport.issues.some((issue) => issue.issueClass === "inspector-gap"));
  assert.equal(authorReport.suggestions.some((finding) => finding.code === "runtime-tool-capture"), false);
  assert.equal(authorReport.issues.some((issue) => issue.issueClass === "inspector-gap"), false);
  assert.ok(authorReport.issues.some((issue) => issue.code === "legacy-root-sdk-import"));
  assert.ok(authorReport.issues.every((issue) => issue.authorRemediation?.docsUrl));

  await assert.rejects(
    () =>
      execFileAsync(
        process.execPath,
        [cliPath, "check", "--out", "legacy-reports", "--no-openclaw", "--include-inspector-gaps"],
        { cwd: rootDir },
      ),
    (error) => {
      assert.match(error.stderr, /--include-inspector-gaps has been replaced by --author-facing/);
      return true;
    },
  );
});

test("config command prints resolved plugin root config", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-config-print-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "config", "--plugin-root", rootDir]);
  const { stdout: jsonStdout } = await execFileAsync(process.execPath, [
    cliPath,
    "config",
    "--plugin-root",
    rootDir,
    "--json",
  ]);
  const config = JSON.parse(jsonStdout);

  assert.match(stdout, /Plugin: weather/);
  assert.match(stdout, /Runtime capture: off/);
  assert.equal(config.fixtures[0].id, "weather");
  assert.equal(config.fixtures[0].subdir, "src");
});

test("ci command writes CI summary artifacts", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-ci-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "ci", "--config", path.join(rootDir, "plugin-inspector.config.json"), "--out", "reports", "--no-openclaw"],
    {
      cwd: rootDir,
    },
  );

  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const summary = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-ci-summary.json"), "utf8"),
  );
  const markdown = await readFile(path.join(rootDir, "reports", "plugin-inspector-ci-summary.md"), "utf8");
  const sarif = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector.sarif"), "utf8"));
  const junit = await readFile(path.join(rootDir, "reports", "plugin-inspector.junit.xml"), "utf8");

  assert.match(stdout, /Status: PASS/);
  assert.match(stdout, /Artifacts: 1/);
  assert.equal(report.targetOpenClaw.status, "disabled");
  assert.ok(Array.isArray(report.issues));
  assert.equal(summary.status, "pass");
  assert.equal(summary.summary.breakages, 0);
  assert.equal(summary.summary.issues, report.summary.issueCount);
  assert.equal(summary.artifacts.compatibility, "plugin-inspector-report.json");
  assert.match(markdown, /# Plugin Inspector CI Summary/);
  assert.equal(sarif.runs[0].tool.driver.name, "plugin-inspector");
  assert.match(junit, /failures="0"/);
});

test("ci command applies author-facing filtering to report, summary, and CI artifacts", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-ci-author-facing-");
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      cliPath,
      "ci",
      "--config",
      path.join(rootDir, "plugin-inspector.config.json"),
      "--out",
      "reports",
      "--no-openclaw",
      "--author-facing",
    ],
    {
      cwd: rootDir,
    },
  );

  const report = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector-report.json"), "utf8"));
  const summary = JSON.parse(
    await readFile(path.join(rootDir, "reports", "plugin-inspector-ci-summary.json"), "utf8"),
  );
  const sarif = JSON.parse(await readFile(path.join(rootDir, "reports", "plugin-inspector.sarif"), "utf8"));
  const junit = await readFile(path.join(rootDir, "reports", "plugin-inspector.junit.xml"), "utf8");

  assert.match(stdout, /Status: PASS/);
  assert.equal(report.issues.some((issue) => issue.code === "runtime-tool-capture"), false);
  assert.equal(summary.summary.inspectorGaps, 0);
  assert.equal(summary.summary.issues, report.summary.issueCount);
  assert.equal(sarif.runs[0].results.some((result) => result.ruleId === "runtime-tool-capture"), false);
  assert.doesNotMatch(junit, /runtime-tool-capture/);
});

test("init command writes plugin config and CI workflow", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "init", "--plugin-root", rootDir, "--ci", "--package-manager", "pnpm", "--force"],
  );
  const config = JSON.parse(await readFile(path.join(rootDir, "plugin-inspector.config.json"), "utf8"));
  const workflow = await readFile(path.join(rootDir, ".github", "workflows", "plugin-inspector.yml"), "utf8");

  assert.match(stdout, /^wrote plugin-inspector\.config\.json$/m);
  assert.match(stdout, /^wrote \.github\/workflows\/plugin-inspector\.yml$/m);
  assert.match(stdout, /^package manager: pnpm$/m);
  assert.equal(stdout.includes(rootDir), false);
  assert.equal(config.plugin.id, "weather");
  assert.equal(config.plugin.sourceRoot, "src");
  assert.equal(config.capture.mockSdk, true);
  assert.match(workflow, /pnpm dlx @openclaw\/plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute/);
});

test("init command detects plugin package managers", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-pm-");
  const cliPath = path.resolve("src/cli.js");
  await writeFile(path.join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  await execFileAsync(process.execPath, [cliPath, "init", "--plugin-root", rootDir, "--ci", "--force"]);
  const workflow = await readFile(path.join(rootDir, ".github", "workflows", "plugin-inspector.yml"), "utf8");

  assert.match(workflow, /cache: pnpm/);
  assert.match(workflow, /corepack enable/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm dlx @openclaw\/plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute/);
});

test("init command can add package scripts", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-scripts-");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(process.execPath, [cliPath, "init", "--plugin-root", rootDir, "--scripts", "--force"]);
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["plugin:check"], "plugin-inspector inspect --no-openclaw");
  assert.equal(packageJson.scripts["plugin:ci"], "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute");
});

test("init command can preview generated files", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-dry-run-");
  const cliPath = path.resolve("src/cli.js");
  const beforeConfig = await readFile(path.join(rootDir, "plugin-inspector.config.json"), "utf8");
  const beforePackageJson = await readFile(path.join(rootDir, "package.json"), "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "init",
    "--plugin-root",
    rootDir,
    "--ci",
    "--scripts",
    "--dry-run",
  ]);

  assert.match(stdout, /^would write plugin-inspector\.config\.json$/m);
  assert.match(stdout, /^would write \.github\/workflows\/plugin-inspector\.yml$/m);
  assert.match(stdout, /^would write package\.json$/m);
  assert.equal(await readFile(path.join(rootDir, "plugin-inspector.config.json"), "utf8"), beforeConfig);
  assert.equal(await readFile(path.join(rootDir, "package.json"), "utf8"), beforePackageJson);
  await assert.rejects(readFile(path.join(rootDir, ".github", "workflows", "plugin-inspector.yml"), "utf8"), {
    code: "ENOENT",
  });
});

test("init command can print a JSON summary", async () => {
  const rootDir = await createCliPluginRoot("plugin-inspector-cli-init-json-");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "init",
    "--plugin-root",
    rootDir,
    "--ci",
    "--scripts",
    "--dry-run",
    "--json",
  ]);
  const summary = JSON.parse(stdout);

  assert.equal(summary.dryRun, true);
  assert.equal(summary.packageManager, "npm");
  assert.equal(summary.pluginRoot, rootDir);
  assert.deepEqual(summary.files, [
    "plugin-inspector.config.json",
    ".github/workflows/plugin-inspector.yml",
    "package.json",
  ]);
});

test("batch command scans plugin roots and writes aggregate impact reports", async () => {
  const corpusDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cli-batch-corpus-"));
  const goodRoot = await createCliPluginRoot("plugin-inspector-cli-batch-good-");
  const brokenRoot = await createCliPluginRoot("plugin-inspector-cli-batch-broken-");
  await mkdir(path.join(corpusDir, "plugins"), { recursive: true });
  await copyPluginRoot(goodRoot, path.join(corpusDir, "plugins", "good-plugin"));
  await copyPluginRoot(brokenRoot, path.join(corpusDir, "plugins", "broken-plugin"));
  await writeFile(
    path.join(corpusDir, "plugins", "broken-plugin", "plugin-inspector.config.json"),
    `${JSON.stringify(
      {
        version: 1,
        plugin: {
          id: "broken-plugin",
          priority: "high",
          sourceRoot: "src",
          expect: { registrations: ["registerMissingTool"] },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "batch",
    corpusDir,
    "--out",
    "batch-reports",
    "--no-openclaw",
    "--json",
  ]);
  const jsonPath = path.join(corpusDir, "batch-reports", "plugin-inspector-batch-report.json");
  const markdownPath = path.join(corpusDir, "batch-reports", "plugin-inspector-batch-report.md");
  const stdoutReport = JSON.parse(stdout);
  const artifactReport = JSON.parse(await readFile(jsonPath, "utf8"));
  const markdown = await readFile(markdownPath, "utf8");

  assert.equal(stdoutReport.summary.pluginCount, 2);
  assert.equal(artifactReport.summary.pluginCount, 2);
  assert.equal(artifactReport.summary.pluginsWithErrors, 1);
  const missingSeam = artifactReport.findingFrequency.find(
    (finding) => finding.code === "missing-expected-seam",
  );
  assert.equal(missingSeam.plugins, 1);
  assert.deepEqual(
    artifactReport.plugins.map((plugin) => plugin.packageName).sort(),
    ["@example/openclaw-weather", "@example/openclaw-weather"],
  );
  assert.match(markdown, /# Plugin Inspector Batch Report/);
  assert.match(markdown, /missing-expected-seam/);
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        cliPath,
        "batch",
        "--out",
        "check-reports",
        "--no-openclaw",
        "--check",
        corpusDir,
      ]),
    (error) => {
      assert.match(error.stderr, /plugin-inspector batch found 1 plugin\(s\) with errors/);
      return true;
    },
  );
});

test("batch command applies author-facing filtering to aggregate summaries", async () => {
  const corpusDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-cli-batch-author-facing-"));
  const pluginRoot = await createCliPluginRoot("plugin-inspector-cli-batch-author-plugin-");
  await mkdir(path.join(corpusDir, "plugins"), { recursive: true });
  await copyPluginRoot(pluginRoot, path.join(corpusDir, "plugins", "weather"));
  await writeFile(
    path.join(corpusDir, "plugins", "weather", "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "batch",
    corpusDir,
    "--out",
    "batch-reports",
    "--no-openclaw",
    "--author-facing",
    "--json",
  ]);
  const stdoutReport = JSON.parse(stdout);

  assert.equal(stdoutReport.findingFrequency.some((finding) => finding.code === "runtime-tool-capture"), false);
  assert.ok(stdoutReport.findingFrequency.some((finding) => finding.code === "legacy-root-sdk-import"));
  assert.ok(
    stdoutReport.plugins.every((plugin) =>
      plugin.findings.every((finding) => finding.authorRemediation?.docsUrl),
    ),
  );
});

test("clawhub batch analysis skill documents export plus batch workflow", async () => {
  const skill = await readFile(path.resolve(".agents/skills/clawhub-batch-analysis/SKILL.md"), "utf8");

  assert.match(skill, /^name: clawhub-batch-analysis/m);
  assert.match(skill, /\/api\/v1\/plugins\/export/);
  assert.match(skill, /plugin-inspector batch/);
  assert.match(skill, /finding frequency/i);
});

async function createCliPluginRoot(prefix) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/openclaw-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "plugin-inspector.config.json"),
    `${JSON.stringify({ version: 1, plugin: { id: "weather", priority: "high", sourceRoot: "src" } }, null, 2)}\n`,
    "utf8",
  );
  return rootDir;
}

async function copyPluginRoot(sourceDir, targetDir) {
  await mkdir(path.join(targetDir, "src"), { recursive: true });
  for (const file of ["package.json", "openclaw.plugin.json", "plugin-inspector.config.json"]) {
    await writeFile(path.join(targetDir, file), await readFile(path.join(sourceDir, file), "utf8"), "utf8");
  }
  await writeFile(
    path.join(targetDir, "src", "index.js"),
    await readFile(path.join(sourceDir, "src", "index.js"), "utf8"),
    "utf8",
  );
}

async function createFixtureSetRoot(prefix) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const fixtureDir = path.join(rootDir, "fixture");
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(
    path.join(rootDir, "plugin-inspector.config.json"),
    `${JSON.stringify(
      {
        version: 1,
        submoduleRoot: ".",
        fixtures: [
          {
            id: "fixture",
            path: "fixture",
            priority: "high",
            seams: ["native-tool"],
            expect: { registrations: ["definePluginEntry", "registerTool"] },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/openclaw-weather",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["src/index.js"],
          compat: { pluginApi: "^1.0.0" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(fixtureDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );
  return rootDir;
}

async function createTargetOpenClaw(rootDir) {
  const openclawPath = path.join(rootDir, "target-openclaw");
  await mkdir(path.join(openclawPath, "src/plugins/compat"), { recursive: true });
  await writeFile(
    path.join(openclawPath, "src/plugins/compat/registry.ts"),
    'export const records = [{ code: "legacy-root-sdk-import", status: "deprecated" }];\n',
    "utf8",
  );
  return openclawPath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
