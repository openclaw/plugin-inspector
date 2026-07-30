import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { c as createTar } from "tar";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  prepareOpenClawTarget,
  resolveOpenClawTargetVersion,
  satisfiesOpenClawCompatibilityRange,
  satisfiesOpenClawVersionRange,
} from "../src/advanced.js";

const execFileAsync = promisify(execFile);
const affectedBeta = "2026.7.2-beta.4";

test("official OpenClaw tags resolve to exact versions and prepared targets reuse the cache", async (t) => {
  const fixture = await createRegistryFixture(t);

  const latest = await resolveOpenClawTargetVersion("latest", { registryUrl: fixture.registryUrl });
  const beta = await resolveOpenClawTargetVersion("beta", { registryUrl: fixture.registryUrl });
  await assert.rejects(
    () => prepareOpenClawTarget(JSON.parse(JSON.stringify(beta)), { cacheDir: fixture.cacheDir }),
    /directly returned by resolveOpenClawTargetVersion/,
  );
  const first = await prepareOpenClawTarget(beta, { cacheDir: fixture.cacheDir });
  const second = await prepareOpenClawTarget(beta, { cacheDir: fixture.cacheDir });

  assert.equal(latest.version, "2026.7.1-2");
  assert.equal(latest.eligibilityVersion, "2026.7.1");
  assert.equal(latest.source.distTag, "latest");
  assert.equal(beta.version, affectedBeta);
  assert.equal(beta.source.distTag, "beta");
  assert.equal(beta.source.tarball.includes("fixture-secret"), false);
  assert.equal(JSON.stringify(beta).includes("fixture-secret"), false);
  assert.equal(first.version, affectedBeta);
  assert.deepEqual(first.apiRegistrars, ["registerCli", "registerTool"]);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(fixture.requests.filter((request) => request.startsWith(`/openclaw/-/openclaw-${affectedBeta}.tgz`)).length, 1);
});

test("targets without verifiable npm integrity metadata are rejected", async (t) => {
  const fixture = await createRegistryFixture(t);
  fixture.distMetadata.integrity = null;
  fixture.distMetadata.shasum = null;

  await assert.rejects(
    () => resolveOpenClawTargetVersion("beta", { registryUrl: fixture.registryUrl }),
    /verifiable integrity metadata/,
  );
});

test("registry-controlled dist-tags cannot escape the target cache", async (t) => {
  const fixture = await createRegistryFixture(t);
  fixture.distTags.beta = "../../outside";

  await assert.rejects(
    () => resolveOpenClawTargetVersion("beta", { registryUrl: fixture.registryUrl }),
    /did not resolve to a valid exact version/,
  );
});

test("declared compatibility uses complete npm semver range syntax", () => {
  assert.equal(satisfiesOpenClawVersionRange("2026.7.1", "2026.3.22 - 2026.7.1"), true);
  assert.equal(satisfiesOpenClawVersionRange("2026.7.1", "2026.7"), true);
  assert.equal(satisfiesOpenClawVersionRange("2026.7.1", "2026.x"), true);
  assert.equal(
    satisfiesOpenClawCompatibilityRange({
      targetVersion: affectedBeta,
      eligibilityVersion: "2026.7.2",
      range: ">=2026.7.2 || >=2026.8.0-beta.1",
    }),
    true,
  );
  assert.equal(
    satisfiesOpenClawCompatibilityRange({
      targetVersion: affectedBeta,
      eligibilityVersion: "2026.7.2",
      range: ">=2026.7.2-beta.5 <2026.7.2 || >=2026.8.0",
    }),
    false,
  );
});

test("beta eligibility preserves historical prerelease lower bounds", () => {
  assert.equal(
    satisfiesOpenClawCompatibilityRange({
      targetVersion: affectedBeta,
      eligibilityVersion: "2026.7.2",
      range: ">=2026.3.24-beta.2",
    }),
    true,
  );
});

test("public CLI reports Honcho memory registrars as errors against the affected exact beta", async (t) => {
  const fixture = await createRegistryFixture(t);
  const pluginRoot = await createHonchoPlugin(t, ">=2026.3.22");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "inspect", "--plugin-root", pluginRoot, "--out", "reports", "--openclaw-version", affectedBeta],
    {
      cwd: pluginRoot,
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
        PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
      },
    },
  );

  const report = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));
  const finding = report.breakages.find((item) => item.code === "unknown-registration-name");
  const issue = report.issues.find((item) => item.code === "unknown-registration-name");

  assert.equal(report.status, "fail");
  assert.equal(report.targetOpenClaw.requestedVersion, affectedBeta);
  assert.equal(report.targetOpenClaw.version, affectedBeta);
  assert.equal(report.targetOpenClaw.eligibilityVersion, "2026.7.2");
  assert.equal(report.targetOpenClaw.source.package, "openclaw");
  assert.equal(report.fixtures[0].package.openclaw.compatPluginApi, ">=2026.3.22");
  assert.deepEqual(finding.evidence.map((item) => item.split(" @ ")[0]), [
    "registerMemoryPromptSection",
    "registerMemoryRuntime",
  ]);
  assert.match(issue.authorRemediation.summary, /available in the target OpenClaw version/i);
  assert.equal("docsUrl" in issue.authorRemediation, false);
});

test("version-derived API removals outside the declared range remain informational", async (t) => {
  const fixture = await createRegistryFixture(t);
  const pluginRoot = await createHonchoPlugin(t, "<2026.7.2");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "inspect", "--plugin-root", pluginRoot, "--out", "reports", "--openclaw-version", affectedBeta],
    {
      cwd: pluginRoot,
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
        PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
      },
    },
  );

  const report = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));
  const finding = report.suggestions.find((item) => item.code === "unknown-registration-name");

  assert.equal(report.status, "pass");
  assert.equal(report.breakages.some((item) => item.code === "unknown-registration-name"), false);
  assert.equal(finding.compatibility.inDeclaredRange, false);
  assert.equal(finding.compatibility.declaredRange, "<2026.7.2");
  assert.equal(finding.compatibility.evaluatedVersion, "2026.7.2");
});

test("the affected exact beta remains eligible when the declared range names that prerelease", async (t) => {
  const fixture = await createRegistryFixture(t);
  const pluginRoot = await createHonchoPlugin(t, affectedBeta);
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "inspect", "--plugin-root", pluginRoot, "--out", "reports", "--openclaw-version", affectedBeta],
    {
      cwd: pluginRoot,
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
        PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
      },
    },
  );

  const report = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));
  const finding = report.breakages.find((item) => item.code === "unknown-registration-name");

  assert.equal(report.status, "fail");
  assert.equal(finding.compatibility.targetVersion, affectedBeta);
  assert.equal(finding.compatibility.inDeclaredRange, true);
});

test("stable eligibility does not override a range requiring a later prerelease", async (t) => {
  const fixture = await createRegistryFixture(t);
  const pluginRoot = await createHonchoPlugin(t, ">=2026.7.2-beta.5 <2026.7.2");
  const cliPath = path.resolve("src/cli.js");

  await execFileAsync(
    process.execPath,
    [cliPath, "inspect", "--plugin-root", pluginRoot, "--out", "reports", "--openclaw-version", affectedBeta],
    {
      cwd: pluginRoot,
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
        PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
      },
    },
  );

  const report = JSON.parse(await readFile(path.join(pluginRoot, "reports", "plugin-inspector-report.json"), "utf8"));
  const finding = report.suggestions.find((item) => item.code === "unknown-registration-name");

  assert.equal(report.status, "pass");
  assert.equal(finding.compatibility.targetVersion, affectedBeta);
  assert.equal(finding.compatibility.inDeclaredRange, false);
});

test("public CLI rejects an openclaw-version flag without a value", async () => {
  const cliPath = path.resolve("src/cli.js");
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "inspect", "--openclaw-version"]),
    (error) => {
      assert.match(error.stderr, /--openclaw-version requires a value/);
      return true;
    },
  );
});

test("batch CLI prepares one resolved beta target for multiple plugin inspections", async (t) => {
  const fixture = await createRegistryFixture(t);
  const corpusRoot = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-version-batch-"));
  t.after(() => rm(corpusRoot, { recursive: true, force: true }));
  await writeHonchoPlugin(path.join(corpusRoot, "honcho-a"), ">=2026.3.22");
  await writeHonchoPlugin(path.join(corpusRoot, "honcho-b"), ">=2026.3.22");
  const cliPath = path.resolve("src/cli.js");

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "batch", corpusRoot, "--out", "reports", "--openclaw-version", "beta", "--json"],
    {
      env: {
        ...process.env,
        PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
        PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
      },
    },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.summary.pluginCount, 2);
  assert.ok(report.plugins.every((plugin) => plugin.targetOpenClaw.version === affectedBeta));
  assert.equal(fixture.requests.filter((request) => request.startsWith(`/openclaw/-/openclaw-${affectedBeta}.tgz`)).length, 1);
});

async function createHonchoPlugin(t, compatibilityRange) {
  const pluginRoot = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-honcho-"));
  t.after(() => rm(pluginRoot, { recursive: true, force: true }));
  await writeHonchoPlugin(pluginRoot, compatibilityRange);
  return pluginRoot;
}

async function writeHonchoPlugin(pluginRoot, compatibilityRange) {
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@fixture/openclaw-honcho",
        version: "1.0.0",
        type: "module",
        openclaw: {
          extensions: ["./index.js"],
          compat: { pluginApi: compatibilityRange },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(pluginRoot, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "honcho", name: "Honcho", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(pluginRoot, "index.js"),
    [
      "export function register(api) {",
      "  api.registerMemoryPromptSection(() => []);",
      "  api.registerMemoryRuntime({ id: 'honcho' });",
      "}",
    ].join("\n"),
    "utf8",
  );
}

async function createRegistryFixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-registry-"));
  const cacheDir = path.join(rootDir, "cache");
  const packageRoot = path.join(rootDir, "archive", "package");
  const tarballPath = path.join(rootDir, `openclaw-${affectedBeta}.tgz`);
  await mkdir(path.join(packageRoot, "dist", "plugin-sdk"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw",
        version: affectedBeta,
        exports: { "./plugin-sdk": { types: "./dist/plugin-sdk/index.d.ts", import: "./dist/plugin-sdk/index.js" } },
        repository: { type: "git", url: "git+https://github.com/openclaw/openclaw.git" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageRoot, "dist", "plugin-sdk", "index.d.ts"),
    'type PluginHookName = "before_prompt_build" | "agent_end"; type OpenClawPluginApi = { id: string; /** compact declaration */ registerTool: (tool: unknown) => void; registerCli: (registrar: { registerNested: () => void }) => void; };',
    "utf8",
  );
  await createTar({ cwd: path.join(rootDir, "archive"), file: tarballPath, gzip: true }, ["package"]);
  const archive = await readFile(tarballPath);

  const requests = [];
  const distTags = { latest: "2026.7.1-2", beta: affectedBeta };
  const distMetadata = {
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    shasum: createHash("sha1").update(archive).digest("hex"),
  };
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    const requestUrl = new URL(request.url, registryUrl(server));
    if (requestUrl.pathname === "/openclaw") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ "dist-tags": distTags }));
      return;
    }
    if (requestUrl.pathname === `/openclaw/${affectedBeta}` || requestUrl.pathname === "/openclaw/2026.7.1-2") {
      const version = requestUrl.pathname.endsWith("2026.7.1-2") ? "2026.7.1-2" : affectedBeta;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: "openclaw",
          version,
          dist: {
            tarball: `${registryUrl(server)}/openclaw/-/openclaw-${version}.tgz?token=fixture-secret`,
            ...distMetadata,
          },
          repository: { type: "git", url: "git+https://github.com/openclaw/openclaw.git" },
        }),
      );
      return;
    }
    if (requestUrl.pathname === `/openclaw/-/openclaw-${affectedBeta}.tgz`) {
      response.setHeader("content-type", "application/octet-stream");
      response.end(await readFile(tarballPath));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  return { cacheDir, distMetadata, distTags, registryUrl: registryUrl(server), requests };
}

function registryUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
