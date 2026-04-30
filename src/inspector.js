import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createCaptureApi } from "./capture-api.js";
import { fixtureCheckoutPath, fixtureSourceRoot } from "./config.js";
import { buildCompatibilityFixtureReport } from "./fixture-summary.js";
import { readOpenClawTargetSurface } from "./openclaw-target.js";
import { buildCompatibilityReport, buildReport } from "./report.js";

const execFileAsync = promisify(execFile);
const registrationEquivalents = new Map([
  ["registerChannel", new Set(["createChatChannelPlugin", "defineChannelPluginEntry", "registerChannel"])],
]);

export async function inspectFixtureSet(config, options = {}) {
  const { inspections, failures } = await inspectConfiguredFixtures(config, options);
  return buildReport({ config, inspections, failures, generatedAt: options.generatedAt });
}

export async function inspectCompatibilityFixtureSet(config, options = {}) {
  const { inspections, failures } = await inspectConfiguredFixtures(config, options);
  const targetOpenClaw =
    options.targetOpenClaw ??
    (await readOpenClawTargetSurface({
      configuredPath: options.openclawPath,
      manifest: config,
      rootDir: config.rootDir,
    }));

  return buildCompatibilityReport({
    config,
    inspections,
    failures,
    generatedAt: options.generatedAt,
    targetOpenClaw,
    buildFixtureReport: ({ fixture, inspection }) =>
      buildCompatibilityFixtureReport({
        fixture,
        inspection,
        checkoutPath: fixtureCheckoutPath(config, fixture),
        sourceRoot: fixtureSourceRoot(config, fixture),
        rootDir: config.rootDir,
      }),
  });
}

async function inspectConfiguredFixtures(config, options = {}) {
  const inspections = [];
  const failures = [];

  for (const fixture of config.fixtures) {
    const inspection = await inspectPlugin(fixture, { ...options, config });
    inspections.push(inspection);

    for (const [key, observed] of [
      ["hooks", inspection.hooks],
      ["registrations", inspection.registrations],
      ["manifestContracts", inspection.manifestContracts],
    ]) {
      const expected = fixture.expect?.[key] ?? [];
      const missing = expected.filter((value) => !satisfiesExpectedSeam(key, value, observed));
      if (missing.length > 0) {
        failures.push(`${fixture.id}: missing ${key}: ${missing.join(", ")}`);
      }
    }
  }

  return { inspections, failures };
}

function satisfiesExpectedSeam(key, expected, observed) {
  if (observed.includes(expected)) {
    return true;
  }
  if (key !== "registrations") {
    return false;
  }
  const equivalents = registrationEquivalents.get(expected);
  return Boolean(equivalents && observed.some((value) => equivalents.has(value)));
}

export async function inspectPlugin(fixture, options = {}) {
  const config = options.config ?? { rootDir: options.rootDir ?? process.cwd() };
  const checkoutPath = fixtureCheckoutPath(config, fixture);
  const sourceRoot = fixtureSourceRoot(config, fixture);

  if (!existsSync(checkoutPath)) {
    return emptyInspection(fixture, "missing");
  }

  const files = await listSourceFiles(sourceRoot, { includeDist: Boolean(fixture.package) });
  if (sourceRoot !== checkoutPath) {
    files.push(...(await listSourceFiles(checkoutPath, { shallowRootOnly: true })));
  }

  const hooks = new Set();
  const registrations = new Set();
  const hookDetails = [];
  const registrationDetails = [];
  const sdkImportDetails = [];

  for (const filePath of files) {
    const text = await readFile(filePath, "utf8");
    const relativePath = path.relative(config.rootDir ?? process.cwd(), filePath);
    const sourceInspection = inspectSourceText(text, relativePath);

    for (const hook of sourceInspection.hooks) {
      hooks.add(hook.name);
      hookDetails.push(hook);
    }
    for (const registration of sourceInspection.registrations) {
      registrations.add(registration.name);
      registrationDetails.push(registration);
    }
    for (const sdkImport of sourceInspection.sdkImports) {
      sdkImportDetails.push(sdkImport);
    }
  }

  const manifestInspection = await readManifestContracts(config, checkoutPath, sourceRoot);
  const packageInspection = await readPackageMetadata(config, checkoutPath, sourceRoot);

  return {
    id: fixture.id,
    status: "ok",
    hooks: [...hooks].sort(),
    hookDetails: sortDetails(hookDetails),
    registrations: [...registrations].sort(),
    registrationDetails: sortDetails(registrationDetails),
    manifestContracts: manifestInspection.contracts,
    manifestFiles: manifestInspection.files,
    manifestErrors: manifestInspection.errors,
    packageFiles: packageInspection.files,
    packageErrors: packageInspection.errors,
    packageEntrypoints: packageInspection.entrypoints,
    sdkImports: uniqueDetails(sdkImportDetails),
    sourceFiles: files.map((filePath) => path.relative(config.rootDir ?? process.cwd(), filePath)).sort(),
  };
}

export function inspectSourceText(text, filePath = "source.js") {
  const searchableText = stripComments(text);
  const hooks = collectDetailedMatches(searchableText, /\bapi\.on\(\s*["'`]([^"'`]+)["'`]/g, filePath, "name");
  const registrations = [
    ...collectDetailedMatches(searchableText, /\bapi\.(register[A-Za-z0-9]+)\s*\(/g, filePath, "name"),
    ...collectDetailedMatches(searchableText, /\b(defineChannelPluginEntry)\s*\(/g, filePath, "name"),
    ...collectDetailedMatches(searchableText, /\b(createChatChannelPlugin)\s*\(/g, filePath, "name"),
    ...collectDetailedMatches(searchableText, /\b(definePluginEntry)\s*\(/g, filePath, "name"),
  ];
  const sdkImports = collectDetailedMatches(
    searchableText,
    /(?:from\s*["'`]|import\(\s*["'`])([^"'`]*openclaw\/plugin-sdk[^"'`]*)/g,
    filePath,
    "specifier",
  );

  return {
    hooks,
    registrations,
    sdkImports,
  };
}

export async function captureEntrypoint(entrypoint, options = {}) {
  if (options.mockSdk === true) {
    return captureEntrypointWithMockSdk(entrypoint, options);
  }

  const resolvedEntrypoint = path.resolve(options.cwd ?? process.cwd(), entrypoint);
  let module;
  try {
    module = await import(pathToFileURL(resolvedEntrypoint).href);
  } catch (error) {
    throw classifyCapturePhaseError(error, "entrypoint-import-error");
  }
  const register = findRegisterExport(module);

  if (!register) {
    return {
      status: "no-register-export",
      entrypoint: resolvedEntrypoint,
      captured: [],
    };
  }

  const api = createCaptureApi(options.apiOptions);
  try {
    await register(api);
  } catch (error) {
    throw classifyCapturePhaseError(error, "registration-execution-error");
  }
  const result = {
    status: "captured",
    entrypoint: resolvedEntrypoint,
    captured: api.getCapturedContracts(),
  };
  if (options.apiOptions?.retainHandlers === true) {
    result.retained = api.getRetainedContracts();
  }
  return result;
}

export async function captureEntrypointWithMockSdk(entrypoint, options = {}) {
  const runnerPath = fileURLToPath(new URL("./mock-sdk-capture-runner.js", import.meta.url));
  const payload = {
    entrypoint,
    cwd: options.cwd ?? process.cwd(),
    pluginRoot: options.pluginRoot,
    apiOptions: options.apiOptions,
  };
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--no-warnings", "--preserve-symlinks", runnerPath, JSON.stringify(payload)],
      {
        cwd: options.cwd ?? process.cwd(),
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    return JSON.parse(stdout);
  } catch (error) {
    throw classifyMockSdkCaptureError(error);
  }
}

export function classifyMockSdkCaptureError(error) {
  const rawMessage = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
  const missingExport = rawMessage.match(/does not provide an export named ['"]([^'"]+)['"]/)?.[1];
  if (missingExport) {
    return enrichCaptureError(error, {
      message: `Mock SDK import failed: openclaw/plugin-sdk is missing export ${missingExport}`,
      failureClass: "missing-sdk-export",
      missingExport,
    });
  }

  const missingModule =
    rawMessage.match(/Cannot find (?:package|module) ['"]([^'"]*openclaw\/plugin-sdk[^'"]*)['"]/)?.[1] ??
    rawMessage.match(/Package subpath ['"](\.\/plugin-sdk\/[^'"]+)['"]/)?.[1];
  if (missingModule || rawMessage.includes("openclaw/plugin-sdk")) {
    return enrichCaptureError(error, {
      message: `Mock SDK import failed: ${missingModule ?? "openclaw/plugin-sdk module could not be resolved"}`,
      failureClass: "missing-sdk-module",
      missingModule,
    });
  }

  const failureClass = rawMessage.match(/\[plugin-inspector:([^\]]+)\]/)?.[1];
  if (failureClass) {
    return enrichCaptureError(error, {
      message: firstMeaningfulErrorLine(rawMessage.replace(/\[plugin-inspector:[^\]]+\]/, "")) ?? "Mock SDK capture failed",
      failureClass,
    });
  }

  return enrichCaptureError(error, {
    message: firstMeaningfulErrorLine(rawMessage) ?? "Mock SDK capture failed",
    failureClass: "mock-sdk-capture-error",
  });
}

export function classifyCapturePhaseError(error, failureClass) {
  return enrichCaptureError(error, {
    message: error instanceof Error ? error.message : String(error),
    failureClass,
  });
}

function enrichCaptureError(error, details) {
  const wrapped = new Error(details.message, { cause: error });
  wrapped.failureClass = details.failureClass;
  if (details.missingExport) {
    wrapped.missingExport = details.missingExport;
  }
  if (details.missingModule) {
    wrapped.missingModule = details.missingModule;
  }
  return wrapped;
}

function firstMeaningfulErrorLine(message) {
  return String(message)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("Command failed:"));
}

function findRegisterExport(module) {
  if (typeof module.register === "function") {
    return module.register;
  }
  if (typeof module.default === "function") {
    return module.default;
  }
  if (typeof module.default?.register === "function") {
    return module.default.register;
  }
  return null;
}

function emptyInspection(fixture, status) {
  return {
    id: fixture.id,
    status,
    hooks: [],
    hookDetails: [],
    registrations: [],
    registrationDetails: [],
    manifestContracts: [],
    manifestFiles: [],
    manifestErrors: [],
    packageFiles: [],
    packageErrors: [],
    packageEntrypoints: [],
    sdkImports: [],
    sourceFiles: [],
  };
}

function collectDetailedMatches(text, regex, filePath, key) {
  const details = [];
  for (const match of text.matchAll(regex)) {
    const line = lineForOffset(text, match.index ?? 0);
    details.push({
      [key]: match[1],
      file: filePath,
      line,
      ref: `${filePath}:${line}`,
    });
  }
  return details;
}

async function readManifestContracts(config, checkoutPath, sourceRoot) {
  const manifests = new Set(
    [path.join(sourceRoot, "openclaw.plugin.json"), path.join(checkoutPath, "openclaw.plugin.json")].filter(
      existsSync,
    ),
  );
  const contracts = new Set();
  const files = [];
  const errors = [];

  for (const manifestFile of manifests) {
    const relativePath = path.relative(config.rootDir ?? process.cwd(), manifestFile);
    files.push(relativePath);
    try {
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      for (const key of Object.keys(manifest.contracts ?? {})) {
        contracts.add(key);
      }
    } catch {
      contracts.add("invalidManifest");
      errors.push(`${relativePath}: invalid JSON`);
    }
  }

  return {
    contracts: [...contracts].sort(),
    files: files.sort(),
    errors,
  };
}

async function readPackageMetadata(config, checkoutPath, sourceRoot) {
  const packageFiles = new Set(
    [path.join(sourceRoot, "package.json"), path.join(checkoutPath, "package.json")].filter(existsSync),
  );
  const files = [];
  const errors = [];
  const entrypoints = new Set();

  for (const packageFile of packageFiles) {
    const relativePath = path.relative(config.rootDir ?? process.cwd(), packageFile);
    files.push(relativePath);
    try {
      const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
      collectEntrypoint(entrypoints, packageJson.main);
      collectEntrypoint(entrypoints, packageJson.module);
      collectEntrypoint(entrypoints, packageJson.openclaw?.entry);
      collectEntrypoint(entrypoints, packageJson.openclaw?.entrypoint);
      collectEntrypoint(entrypoints, packageJson.exports?.["."]?.import);
      collectEntrypoint(entrypoints, packageJson.exports?.["."]?.default);
    } catch {
      errors.push(`${relativePath}: invalid JSON`);
    }
  }

  return {
    files: files.sort(),
    errors,
    entrypoints: [...entrypoints].sort(),
  };
}

function collectEntrypoint(entrypoints, value) {
  if (typeof value === "string" && value.length > 0) {
    entrypoints.add(value);
  }
}

async function listSourceFiles(root, options = {}) {
  if (!existsSync(root)) {
    return [];
  }

  const output = [];
  await walk(root, output, options);
  return output;
}

async function walk(dir, output, options) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    const normalized = entryPath.split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, normalized, options)) {
        continue;
      }
      if (options.shallowRootOnly) {
        continue;
      }
      await walk(entryPath, output, options);
      continue;
    }

    if (isSourceFile(entry.name, normalized)) {
      output.push(entryPath);
    }
  }
}

function shouldSkipDir(name, normalizedPath, options = {}) {
  return (
    name === "node_modules" ||
    (!options.includeDist && name === "dist") ||
    name === "build" ||
    name === "coverage" ||
    name === ".git" ||
    name === "test" ||
    name === "tests" ||
    /\/test-shims\//.test(`${normalizedPath}/`)
  );
}

function isSourceFile(name, normalizedPath) {
  return (
    /\.(cjs|mjs|js|ts)$/.test(name) &&
    !name.endsWith(".d.ts") &&
    !/\.test\./.test(name) &&
    !/\.spec\./.test(name)
  );
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function stripComments(text) {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        result += blankCommentChar(text[index]);
        index += 1;
      }
      if (index < text.length) {
        result += "  ";
        index += 1;
      }
    } else if (char === "/" && next === "/") {
      result += "  ";
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        result += " ";
        index += 1;
      }
      index -= 1;
    } else {
      result += char;
    }
  }
  return result;
}

function blankCommentChar(char) {
  return char === "\n" || char === "\r" ? char : " ";
}

function sortDetails(details) {
  return [...details].sort((left, right) => {
    const leftName = left.name ?? left.specifier ?? "";
    const rightName = right.name ?? right.specifier ?? "";
    return leftName.localeCompare(rightName) || left.ref.localeCompare(right.ref);
  });
}

function uniqueDetails(details) {
  const byKey = new Map();
  for (const detail of sortDetails(details)) {
    const key = `${detail.name ?? detail.specifier}:${detail.ref}`;
    byKey.set(key, detail);
  }
  return [...byKey.values()];
}
