import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./json-file.js";

export async function buildCompatibilityFixtureReport({ fixture, inspection, checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const pluginManifests = await readPluginManifests({ checkoutPath, sourceRoot, rootDir });
  const packageSummaries = await readPackageSummaries({ checkoutPath, sourceRoot, rootDir });
  const packageJson = selectPrimaryPackage(packageSummaries);
  const sdkImports = unique((inspection.sdkImports ?? []).map((sdkImport) => sdkImport.specifier));

  return {
    id: fixture.id,
    name: fixture.name,
    priority: fixture.priority,
    seams: fixture.seams,
    why: fixture.why,
    status: inspection.status,
    hooks: inspection.hooks,
    hookDetails: inspection.hookDetails ?? [],
    registrations: inspection.registrations,
    registrationDetails: inspection.registrationDetails ?? [],
    manifestContracts: inspection.manifestContracts,
    manifestFiles: inspection.manifestFiles ?? [],
    sourceFiles: inspection.sourceFiles ?? [],
    pluginManifests,
    package: packageJson,
    packages: packageSummaries,
    sdkImports,
    sdkImportDetails: inspection.sdkImports ?? [],
  };
}

export async function readPluginManifests({ checkoutPath, sourceRoot, rootDir = process.cwd() }) {
  const candidates = unique(
    [path.join(sourceRoot, "openclaw.plugin.json"), path.join(checkoutPath, "openclaw.plugin.json")].filter(
      existsSync,
    ),
  );
  const manifests = [];

  for (const manifestPath of candidates) {
    const manifest = await readJsonFile(manifestPath);
    manifests.push({
      path: path.relative(rootDir, manifestPath),
      id: manifest.id ?? null,
      name: manifest.name ?? null,
      version: manifest.version ?? null,
      keys: Object.keys(manifest).sort(),
      contracts: Object.keys(manifest.contracts ?? {}).sort(),
      providerAuthEnvVars: manifest.providerAuthEnvVars ?? {},
      channelEnvVars: manifest.channelEnvVars ?? {},
      activation: manifest.activation ?? null,
    });
  }

  return manifests;
}

export async function readPackageSummaries({ checkoutPath, sourceRoot, rootDir = process.cwd(), maxDepth = 3 }) {
  const candidates = unique([
    path.join(sourceRoot, "package.json"),
    path.join(checkoutPath, "package.json"),
    ...(await findPackageFiles(checkoutPath, { maxDepth })),
  ].filter(existsSync));
  const summaries = [];

  for (const packagePath of candidates) {
    const packageJson = await readJsonFile(packagePath);
    summaries.push(summarizePackage(packagePath, packageJson, { rootDir }));
  }

  return summaries.sort((left, right) => packageRank(left) - packageRank(right) || left.path.localeCompare(right.path));
}

export function summarizePackage(packagePath, packageJson, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const packageDir = path.dirname(packagePath);
  const openclaw = packageJson.openclaw
    ? {
        extensions: arrayValues(packageJson.openclaw.extensions),
        runtimeExtensions: arrayValues(packageJson.openclaw.runtimeExtensions),
        setupEntry: typeof packageJson.openclaw.setupEntry === "string" ? packageJson.openclaw.setupEntry : null,
        compatPluginApi:
          typeof packageJson.openclaw.compat?.pluginApi === "string" ? packageJson.openclaw.compat.pluginApi : null,
        buildOpenClawVersion:
          typeof packageJson.openclaw.build?.openclawVersion === "string"
            ? packageJson.openclaw.build.openclawVersion
            : null,
        buildPluginSdkVersion:
          typeof packageJson.openclaw.build?.pluginSdkVersion === "string"
            ? packageJson.openclaw.build.pluginSdkVersion
            : null,
      }
    : null;

  if (openclaw) {
    openclaw.entrypoints = collectOpenClawEntrypoints(packageDir, openclaw, { rootDir });
  }

  return {
    path: path.relative(rootDir, packagePath),
    name: packageJson.name ?? null,
    version: packageJson.version ?? null,
    type: packageJson.type ?? null,
    main: typeof packageJson.main === "string" ? packageJson.main : null,
    dependencies: Object.keys(packageJson.dependencies ?? {}).sort(),
    peerDependencies: Object.keys(packageJson.peerDependencies ?? {}).sort(),
    optionalDependencies: Object.keys(packageJson.optionalDependencies ?? {}).sort(),
    openclaw,
  };
}

function collectOpenClawEntrypoints(packageDir, openclaw, options) {
  const entrypoints = [
    ...openclaw.extensions.map((specifier) => ({ kind: "extension", specifier })),
    ...openclaw.runtimeExtensions.map((specifier) => ({ kind: "runtimeExtension", specifier })),
    ...(openclaw.setupEntry ? [{ kind: "setupEntry", specifier: openclaw.setupEntry }] : []),
  ];

  return entrypoints.map((entrypoint) => {
    const resolvedPath = path.resolve(packageDir, entrypoint.specifier);
    const relativePath = path.relative(options.rootDir, resolvedPath);
    return {
      ...entrypoint,
      relativePath,
      exists: existsSync(resolvedPath),
      requiresBuild: /(^|\/)dist\//.test(entrypoint.specifier) || /(^|\/)build\//.test(entrypoint.specifier),
    };
  });
}

async function findPackageFiles(root, options, depth = 0) {
  if (!existsSync(root) || depth > options.maxDepth) {
    return [];
  }

  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === "package.json") {
      files.push(entryPath);
      continue;
    }
    if (!entry.isDirectory() || shouldSkipPackageDir(entry.name)) {
      continue;
    }
    files.push(...(await findPackageFiles(entryPath, options, depth + 1)));
  }
  return files;
}

function shouldSkipPackageDir(name) {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "build" || name === "coverage";
}

function selectPrimaryPackage(packages) {
  return packages[0] ?? null;
}

function packageRank(packageSummary) {
  if (packageSummary.openclaw?.entrypoints.length > 0) {
    return 0;
  }
  if (packageSummary.openclaw) {
    return 1;
  }
  return 2;
}

function arrayValues(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function unique(values) {
  return [...new Set(values)];
}
