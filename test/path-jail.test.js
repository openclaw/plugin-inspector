import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  fixtureSourceRoot,
  inspectPlugin,
  loadPluginRootConfig,
  readOpenClawTargetSurface,
} from "../src/advanced.js";
import { inspectPluginRoot } from "../src/index.js";

const uncSpecifier = "//evil.example/share/x.js";
const windowsAbsoluteSpecifier = path.win32.join("C:", "Windows", "win.ini");

test("resolveJailedPluginPath rejects ../, Windows absolute, and UNC specifiers and keeps in-root paths", async () => {
  const { resolveJailedPluginPath } = await import("../src/path-utils.js");
  assert.equal(typeof resolveJailedPluginPath, "function");

  const root = path.win32.join("C:", "plugins", "demo");
  const naiveUnc = path.win32.resolve(root, uncSpecifier);
  assert.match(naiveUnc.replaceAll("/", "\\"), /^\\\\evil\.example\\share\\x\.js$/i);

  const naiveAbsolute = path.win32.resolve(root, windowsAbsoluteSpecifier);
  assert.equal(naiveAbsolute, windowsAbsoluteSpecifier);

  assert.equal(resolveJailedPluginPath(root, "../secret.js"), null);
  assert.equal(resolveJailedPluginPath(root, "..\\secret.js"), null);
  assert.equal(resolveJailedPluginPath(root, windowsAbsoluteSpecifier), null);
  assert.equal(resolveJailedPluginPath(root, "C:/Windows/win.ini"), null);
  assert.equal(resolveJailedPluginPath(root, uncSpecifier), null);
  assert.equal(resolveJailedPluginPath(root, "\\\\evil.example\\share\\x.js"), null);

  const accepted = resolveJailedPluginPath(root, "src/index.js");
  assert.ok(accepted);
  assert.equal(path.relative(path.resolve(root), accepted).split(path.sep).join("/"), "src/index.js");
});

test("inspect rejects a relative ../ entrypoint escape and still accepts src/index.js", async (t) => {
  const workspace = await createWorkspace(t);
  const leakedPath = path.join(workspace, "jail-escape-marker.js");
  await writeFile(leakedPath, 'export default function register(api) { api.registerHttpRoute({ path: "/leaked" }); }\n', "utf8");

  const pluginRoot = await writePlugin(workspace, {
    packageJson: {
      main: "../jail-escape-marker.js",
      openclaw: {
        extensions: ["../jail-escape-marker.js"],
        entrypoint: "src/index.js",
      },
    },
  });

  const inspection = await inspectPlugin(pluginFixture(), { config: { rootDir: pluginRoot } });
  assert.ok(inspection.sourceFiles.some((file) => normalizeRel(file).endsWith("src/index.js")));
  assert.ok(!inspection.sourceFiles.some((file) => file.includes("jail-escape-marker")));
  assert.ok(!inspection.registrations.includes("registerHttpRoute"));
  assert.ok(inspection.registrations.includes("registerTool"));

  const report = await inspectPluginRoot({ pluginRoot, openclawPath: false });
  const escaped = report.fixtures[0].package.openclaw.entrypoints.filter((entrypoint) =>
    entrypoint.specifier.includes("jail-escape-marker"),
  );
  assert.ok(escaped.length > 0);
  assert.ok(escaped.every((entrypoint) => entrypoint.exists === false));
  assert.ok(escaped.every((entrypoint) => !isUncLike(entrypoint.relativePath)));
});

test("inspect rejects an absolute Windows-style entrypoint even on this host", async (t) => {
  const workspace = await createWorkspace(t);
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-jail-abs-"));
  t.after(() => rm(outsideDir, { recursive: true, force: true }));
  const leakedPath = path.join(outsideDir, "jail-escape-marker.js");
  await writeFile(leakedPath, 'export default function register(api) { api.registerHttpRoute({ path: "/leaked" }); }\n', "utf8");

  const absoluteSpecifier = path.win32.normalize(leakedPath);
  assert.equal(path.win32.isAbsolute(absoluteSpecifier), true);

  const pluginRoot = await writePlugin(workspace, {
    packageJson: {
      main: absoluteSpecifier,
      openclaw: {
        extensions: [absoluteSpecifier],
        entrypoint: "src/index.js",
      },
    },
  });

  const inspection = await inspectPlugin(pluginFixture(), { config: { rootDir: pluginRoot } });
  assert.ok(inspection.sourceFiles.some((file) => normalizeRel(file).endsWith("src/index.js")));
  assert.ok(!inspection.sourceFiles.some((file) => file.includes("jail-escape-marker")));
  assert.ok(!inspection.registrations.includes("registerHttpRoute"));

  const report = await inspectPluginRoot({ pluginRoot, openclawPath: false });
  const escaped = report.fixtures[0].package.openclaw.entrypoints.filter((entrypoint) =>
    path.win32.isAbsolute(entrypoint.specifier) || entrypoint.specifier.includes("jail-escape-marker"),
  );
  assert.ok(escaped.length > 0);
  assert.ok(escaped.every((entrypoint) => entrypoint.exists === false));
});

test("inspect does not resolve a UNC entrypoint to a host share", async (t) => {
  const { resolveJailedPluginPath } = await import("../src/path-utils.js");
  const workspace = await createWorkspace(t);
  const pluginRoot = await writePlugin(workspace, {
    packageJson: {
      openclaw: {
        extensions: [uncSpecifier],
        entrypoint: "src/index.js",
      },
    },
  });

  const naive = path.win32.resolve(pluginRoot, uncSpecifier);
  assert.match(naive.replaceAll("/", "\\"), /^\\\\evil\.example\\share\\x\.js$/i);
  assert.equal(resolveJailedPluginPath(pluginRoot, uncSpecifier), null);

  const report = await inspectPluginRoot({ pluginRoot, openclawPath: false });
  const uncEntrypoints = report.fixtures[0].package.openclaw.entrypoints.filter((entrypoint) =>
    entrypoint.specifier.includes("evil.example"),
  );
  assert.ok(uncEntrypoints.length > 0);
  assert.ok(uncEntrypoints.every((entrypoint) => entrypoint.exists === false));
  assert.ok(uncEntrypoints.every((entrypoint) => entrypoint.relativePath !== naive));
});

test("config sourceRoot cannot escape the plugin root via ../ or a Windows absolute path", async (t) => {
  const workspace = await createWorkspace(t);
  const leakedDir = path.join(workspace, "leaked-src");
  await mkdir(leakedDir, { recursive: true });
  await writeFile(
    path.join(leakedDir, "jail-escape-marker.js"),
    'export default function register(api) { api.registerHttpRoute({ path: "/leaked" }); }\n',
    "utf8",
  );

  const pluginRoot = await writePlugin(workspace, {
    config: {
      version: 1,
      plugin: {
        id: "weather",
        priority: "high",
        seams: ["plugin"],
        sourceRoot: "../leaked-src",
      },
    },
  });

  const config = await loadPluginRootConfig(null, { cwd: pluginRoot });
  const sourceRoot = fixtureSourceRoot(config, config.fixtures[0]);
  assertInside(pluginRoot, sourceRoot);
  assert.notEqual(path.resolve(sourceRoot), path.resolve(leakedDir));

  const inspection = await inspectPlugin(config.fixtures[0], { config });
  assert.ok(!inspection.sourceFiles.some((file) => file.includes("jail-escape-marker")));
  assert.ok(!inspection.registrations.includes("registerHttpRoute"));

  const absolutePlugin = await writePlugin(workspace, {
    dirName: "abs-source-plugin",
    config: {
      version: 1,
      plugin: {
        id: "weather",
        priority: "high",
        seams: ["plugin"],
        sourceRoot: path.win32.normalize(leakedDir),
      },
    },
  });
  const absoluteConfig = await loadPluginRootConfig(null, { cwd: absolutePlugin });
  const absoluteSourceRoot = fixtureSourceRoot(absoluteConfig, absoluteConfig.fixtures[0]);
  assertInside(absolutePlugin, absoluteSourceRoot);
  assert.notEqual(path.resolve(absoluteSourceRoot), path.resolve(leakedDir));
});

test("defaultCheckoutPath cannot escape the plugin root via ../ or a Windows absolute path", async (t) => {
  const workspace = await createWorkspace(t);
  const checkout = path.join(workspace, "fake-openclaw");
  await writeFakeOpenClawCheckout(checkout);

  const relativePlugin = await writePlugin(workspace, {
    dirName: "relative-checkout-plugin",
    config: {
      version: 1,
      openclaw: { defaultCheckoutPath: "../fake-openclaw" },
    },
  });
  const relativeTarget = await readOpenClawTargetSurface({
    rootDir: relativePlugin,
    manifest: { openclaw: { defaultCheckoutPath: "../fake-openclaw" } },
  });
  assert.equal(relativeTarget.status, "missing");
  assert.ok(!(relativeTarget.searchedPaths ?? []).includes("../fake-openclaw"));

  const absolutePlugin = await writePlugin(workspace, {
    dirName: "absolute-checkout-plugin",
    config: {
      version: 1,
      openclaw: { defaultCheckoutPath: path.win32.normalize(checkout) },
    },
  });
  const absoluteTarget = await readOpenClawTargetSurface({
    rootDir: absolutePlugin,
    manifest: { openclaw: { defaultCheckoutPath: path.win32.normalize(checkout) } },
  });
  assert.equal(absoluteTarget.status, "missing");
  assert.ok(!(absoluteTarget.searchedPaths ?? []).some((candidate) => path.win32.normalize(candidate) === path.win32.normalize(checkout)));
});

function pluginFixture() {
  return {
    id: "weather",
    name: "Weather",
    path: ".",
    repo: "local",
    priority: "high",
    seams: ["plugin"],
  };
}

async function createWorkspace(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-path-jail-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return workspace;
}

async function writePlugin(workspace, options = {}) {
  const pluginRoot = path.join(workspace, options.dirName ?? "plugin");
  await mkdir(path.join(pluginRoot, "src"), { recursive: true });
  const packageJson = {
    name: "@example/openclaw-weather",
    version: "1.0.0",
    type: "module",
    openclaw: {
      extensions: ["src/index.js"],
      compat: { pluginApi: "^1.0.0" },
    },
    ...(options.packageJson ?? {}),
  };
  await writeFile(path.join(pluginRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(pluginRoot, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(pluginRoot, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );
  if (options.config) {
    await writeFile(
      path.join(pluginRoot, "plugin-inspector.config.json"),
      `${JSON.stringify(options.config, null, 2)}\n`,
      "utf8",
    );
  }
  return pluginRoot;
}

async function writeFakeOpenClawCheckout(checkout) {
  await mkdir(path.join(checkout, "src/plugins/compat"), { recursive: true });
  await writeFile(path.join(checkout, "src/plugins/compat/registry.ts"), "export const records = [];\n", "utf8");
  await writeFile(path.join(checkout, "package.json"), `${JSON.stringify({ name: "openclaw", version: "0.0.0" }, null, 2)}\n`, "utf8");
}

function normalizeRel(value) {
  return String(value).split(path.sep).join("/");
}

function isUncLike(value) {
  const normalized = String(value).replaceAll("/", "\\");
  return /^\\\\[^\\]+/u.test(normalized);
}

function assertInside(rootDir, candidatePath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  assert.ok(
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
    `${candidatePath} should stay inside ${rootDir} (relative ${relative})`,
  );
}
