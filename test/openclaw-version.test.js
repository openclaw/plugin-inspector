import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import fsPromises, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { c as createTar, Header } from "tar";
import { gzipSync, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  openClawEligibilityVersion,
  prepareOpenClawTarget,
  resolveOpenClawTargetVersion,
  satisfiesOpenClawCompatibilityRange,
  satisfiesOpenClawVersionRange,
} from "../src/advanced.js";

const execFileAsync = promisify(execFile);
const affectedBeta = "2026.7.2-beta.4";

test("eligibility normalization leaves invalid version-like input unchanged", () => {
  assert.equal(openClawEligibilityVersion("not-a-version-beta.4"), "not-a-version-beta.4");
});

test("official OpenClaw tags resolve to exact versions and prepared targets reuse the cache", async (t) => {
  const fixture = await createRegistryFixture(t);
  const responses = [];
  const fetchImpl = async (url, init) => {
    const response = await fetch(url, init);
    responses.push(response);
    return response;
  };

  const latest = await resolveOpenClawTargetVersion("latest", { registryUrl: fixture.registryUrl, fetch: fetchImpl });
  const beta = await resolveOpenClawTargetVersion("beta", { registryUrl: fixture.registryUrl, fetch: fetchImpl });
  assert.deepEqual(fixture.requests, [
    "/-/package/openclaw/dist-tags",
    "/openclaw/2026.7.1-2",
    "/-/package/openclaw/dist-tags",
    `/openclaw/${affectedBeta}`,
  ]);
  await assert.rejects(
    () => prepareOpenClawTarget(JSON.parse(JSON.stringify(beta)), { cacheDir: fixture.cacheDir }),
    /directly returned by resolveOpenClawTargetVersion/,
  );
  const first = await prepareOpenClawTarget(beta, { cacheDir: fixture.cacheDir, fetch: fetchImpl });
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
  assert.ok(responses.every((response) => response.bodyUsed && !response.body.locked));
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

test("an archive integrity mismatch leaves no prepared target", async (t) => {
  const fixture = await createRegistryFixture(t);
  fixture.distMetadata.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
  const target = await resolveOpenClawTargetVersion(affectedBeta, { registryUrl: fixture.registryUrl });

  await assert.rejects(
    () => prepareOpenClawTarget(target, { cacheDir: fixture.cacheDir }),
    /failed integrity verification/,
  );
  assert.equal(fs.existsSync(fixture.cacheDir), false);
});

for (const kind of ["metadata", "archive"]) {
  for (const behavior of ["stalled-headers", "stalled-body", "oversized-declared", "oversized-chunked", "http-error"]) {
    test(`OpenClaw ${kind} ${behavior} releases the response without preparing a cache entry`, { timeout: 3_000 }, async (t) => {
      const fixture = await createRegistryFixture(t, { [`${kind}Response`]: behavior });
      const target = kind === "archive"
        ? await resolveOpenClawTargetVersion(affectedBeta, { registryUrl: fixture.registryUrl })
        : null;
      let response;
      const stalled = behavior.startsWith("stalled");
      const options = {
        registryUrl: fixture.registryUrl,
        cacheDir: fixture.cacheDir,
        // Non-timeout failures must close the connection before this deadline.
        fetchTimeoutMs: stalled ? 80 : 10_000,
        maxMetadataBytes: 64,
        maxArchiveBytes: 64,
        fetch: async (url, init) => {
          response = await fetch(url, init);
          return response;
        },
      };

      await assert.rejects(
        () => kind === "metadata"
          ? resolveOpenClawTargetVersion(affectedBeta, options)
          : prepareOpenClawTarget(target, options),
        (error) => {
          if (behavior === "http-error") {
            assert.match(error.message, /HTTP 503/);
          } else {
            assert.equal(error.failureClass, stalled ? "target-download-timeout" : "target-download-too-large");
            assert.match(error.message, stalled ? /download timed out/ : /64 byte download limit/);
          }
          return true;
        },
      );
      if (behavior !== "stalled-headers") {
        assert.ok(response.bodyUsed, "consume or cancel the actual fetch body");
        assert.equal(response.body.locked, false, "release the fetch reader");
      }
      await fixture.disconnected;
      assert.equal(fs.existsSync(fixture.cacheDir), false);
    });
  }
}

test("invalid fetch timeout options fall back to a usable deadline", async (t) => {
  const fixture = await createRegistryFixture(t);
  for (const fetchTimeoutMs of [0, -1, 0.5, NaN, Infinity, "invalid", 2 ** 32]) {
    const target = await resolveOpenClawTargetVersion(affectedBeta, { registryUrl: fixture.registryUrl, fetchTimeoutMs });
    assert.equal(target.version, affectedBeta);
  }
});

test("public CLI aborts a hung --openclaw-version fetch", { timeout: 8_000 }, async (t) => {
  const fixture = await createRegistryFixture(t, { metadataResponse: "stalled-headers" });
  const pluginRoot = await createHonchoPlugin(t, ">=2026.3.22");
  const cliPath = path.resolve("src/cli.js");

  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [cliPath, "check", "--plugin-root", pluginRoot, "--openclaw-version", "latest"], {
        cwd: pluginRoot,
        timeout: 4_000,
        env: {
          ...process.env,
          PLUGIN_INSPECTOR_CACHE_DIR: fixture.cacheDir,
          PLUGIN_INSPECTOR_NPM_REGISTRY: fixture.registryUrl,
          PLUGIN_INSPECTOR_TARGET_FETCH_TIMEOUT_MS: "80",
        },
      }),
    (error) => {
      assert.match(error.stderr, /npm metadata download timed out/);
      return true;
    },
  );
});

test("failed target extraction finishes filesystem work before removing its workspace", async (t) => {
  const fixture = await createRegistryFixture(t, { invalidArchiveHeader: true });
  const target = await resolveOpenClawTargetVersion("beta", { registryUrl: fixture.registryUrl });
  const pending = new Set();
  const cleanupPendingCounts = [];
  let resolveIdle;
  // Observe real callback-based extraction work, including work queued by a callback.
  for (const name of ["stat", "mkdir", "lstat", "open", "write", "futimes", "utimes", "fchown", "chown", "close", "unlink", "rmdir"]) {
    const original = fs[name];
    t.mock.method(fs, name, (...args) => {
      const callback = args.pop();
      const operation = {};
      pending.add(operation);
      return original(...args, (...result) => {
        try {
          callback(...result);
        } finally {
          pending.delete(operation);
          if (pending.size === 0) resolveIdle?.();
        }
      });
    });
  }
  const originalRm = fsPromises.rm;
  t.mock.method(fsPromises, "rm", async (...args) => {
    if (path.dirname(args[0]) === path.join(fixture.cacheDir, "openclaw")) {
      cleanupPendingCounts.push(pending.size);
      // Drain a regressed extractor before actually deleting the test workspace.
      if (pending.size > 0) await new Promise((resolve) => { resolveIdle = resolve; });
    }
    return originalRm(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  await assert.rejects(
    () => prepareOpenClawTarget(target, { cacheDir: fixture.cacheDir }),
    (error) => error.tarCode === "TAR_ENTRY_INVALID" && /checksum failure/.test(error.message),
  );
  assert.deepEqual(cleanupPendingCounts, [0], "cleanup must not overtake extraction filesystem work");
  assert.equal(pending.size, 0);
  assert.deepEqual(await readdir(path.join(fixture.cacheDir, "openclaw")), []);
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

async function createRegistryFixture(t, options = {}) {
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
  let archive = await readFile(tarballPath);
  if (options.invalidArchiveHeader) {
    const invalidHeader = new Header({ path: "package/invalid", type: "File", size: 0, mode: 0o644 });
    invalidHeader.encode();
    invalidHeader.block[0] ^= 1;
    // Queue a real directory creation before the strict parser rejects the next entry.
    archive = gzipSync(Buffer.concat([gunzipSync(archive).subarray(0, 512), invalidHeader.block, Buffer.alloc(1024)]));
    await writeFile(tarballPath, archive);
  }

  const requests = [];
  let resolveDisconnected;
  const disconnected = new Promise((resolve) => { resolveDisconnected = resolve; });
  const distTags = { latest: "2026.7.1-2", beta: affectedBeta };
  const distMetadata = {
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    shasum: createHash("sha1").update(archive).digest("hex"),
  };
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    const requestUrl = new URL(request.url, registryUrl(server));
    const behavior = requestUrl.pathname.endsWith(".tgz") ? options.archiveResponse : options.metadataResponse;
    if (behavior) {
      response.once("close", resolveDisconnected);
      if (behavior === "stalled-headers") return;
      if (behavior === "oversized-declared") {
        response.setHeader("content-length", "65");
        response.flushHeaders();
        return;
      }
      if (behavior === "http-error") response.statusCode = 503;
      response.write(behavior === "oversized-chunked" ? Buffer.alloc(32) : "{");
      if (behavior === "oversized-chunked") {
        setImmediate(() => response.write(Buffer.alloc(64)));
      }
      return;
    }
    if (requestUrl.pathname === "/-/package/openclaw/dist-tags") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(distTags));
      return;
    }
    if (requestUrl.pathname === "/openclaw") {
      // A complete packument need not fit the per-response metadata budget.
      response.setHeader("content-length", String(16 * 1024 * 1024 + 1));
      response.flushHeaders();
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
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  return { cacheDir, disconnected, distMetadata, distTags, registryUrl: registryUrl(server), requests };
}

function registryUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
