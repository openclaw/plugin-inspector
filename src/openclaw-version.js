import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import { x as extractTar } from "tar";
import { readOpenClawTargetSurface } from "./openclaw-target.js";

const defaultRegistryUrl = "https://registry.npmjs.org";
const supportedTags = new Set(["latest", "beta"]);
const downloadUrls = new WeakMap();

export async function resolveOpenClawTargetVersion(requestedVersion, options = {}) {
  const requested = requestedVersion ?? "latest";
  if (typeof requested !== "string" || requested.trim().length === 0) {
    throw new Error("OpenClaw target version must be latest, beta, or an exact version");
  }

  const registryUrl = normalizeRegistryUrl(
    options.registryUrl ?? process.env.PLUGIN_INSPECTOR_NPM_REGISTRY ?? defaultRegistryUrl,
  );
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let version = requested;
  let distTag = null;

  if (supportedTags.has(requested)) {
    const metadata = await fetchJson(`${registryUrl}/openclaw`, fetchImpl);
    version = metadata["dist-tags"]?.[requested];
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`OpenClaw npm dist-tag ${requested} did not resolve to an exact version`);
    }
    if (!isExactOpenClawVersion(version)) {
      throw new Error(`OpenClaw npm dist-tag ${requested} did not resolve to a valid exact version`);
    }
    distTag = requested;
  } else if (!isExactOpenClawVersion(requested)) {
    throw new Error("--openclaw-version must be latest, beta, or an exact OpenClaw version");
  }

  const versionMetadata = await fetchJson(`${registryUrl}/openclaw/${encodeURIComponent(version)}`, fetchImpl);
  if (versionMetadata.version !== version || typeof versionMetadata.dist?.tarball !== "string") {
    throw new Error(`OpenClaw npm metadata for ${version} is incomplete`);
  }
  if (!hasVerifiableIntegrity(versionMetadata.dist)) {
    throw new Error(`OpenClaw npm metadata for ${version} has no verifiable integrity metadata`);
  }

  const resolvedTarget = {
    requestedVersion: requested,
    version,
    eligibilityVersion: openClawEligibilityVersion(version),
    source: {
      type: "npm",
      package: "openclaw",
      registry: sanitizeUrlForReport(registryUrl),
      distTag,
      tarball: sanitizeUrlForReport(versionMetadata.dist.tarball),
      integrity: versionMetadata.dist.integrity ?? null,
      shasum: versionMetadata.dist.shasum ?? null,
      repository: sanitizeRepositoryForReport(versionMetadata.repository),
    },
  };
  downloadUrls.set(resolvedTarget, versionMetadata.dist.tarball);
  return resolvedTarget;
}

export async function prepareOpenClawTarget(resolvedTarget, options = {}) {
  if (!resolvedTarget?.version || !resolvedTarget?.source?.integrity && !resolvedTarget?.source?.shasum) {
    throw new Error("prepareOpenClawTarget requires a resolved npm target");
  }
  if (!downloadUrls.has(resolvedTarget)) {
    throw new Error("prepareOpenClawTarget requires the target object directly returned by resolveOpenClawTargetVersion");
  }

  const cacheDir = path.resolve(
    options.cacheDir ??
      process.env.PLUGIN_INSPECTOR_CACHE_DIR ??
      path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "plugin-inspector"),
  );
  const cacheKey = cacheKeyFor(resolvedTarget);
  const targetDir = path.join(cacheDir, "openclaw", cacheKey);
  const packageDir = path.join(targetDir, "package");
  let cacheHit = await isPreparedPackage(packageDir, resolvedTarget.version);

  if (!cacheHit) {
    await preparePackageArchive(resolvedTarget, { ...options, cacheDir, targetDir });
    cacheHit = false;
  }

  const surface = await readOpenClawTargetSurface({ rootDir: packageDir, configuredPath: "." });
  if (surface.status !== "ok") {
    throw new Error(`prepared OpenClaw ${resolvedTarget.version} package has no readable public plugin surface`);
  }

  return {
    ...surface,
    configuredPath: `npm:openclaw@${resolvedTarget.version}`,
    searchedPaths: [`npm:openclaw@${resolvedTarget.version}`],
    requestedVersion: resolvedTarget.requestedVersion,
    version: resolvedTarget.version,
    eligibilityVersion: resolvedTarget.eligibilityVersion,
    source: resolvedTarget.source,
    cache: { hit: cacheHit, key: cacheKey },
  };
}

export function openClawEligibilityVersion(version) {
  return version.replace(/-(?:beta\.[0-9A-Za-z.-]+|\d+)$/, "");
}

export function satisfiesOpenClawVersionRange(version, range) {
  return Boolean(semver.valid(version) && semver.validRange(range) && semver.satisfies(version, range));
}

export function satisfiesOpenClawCompatibilityRange({ targetVersion, eligibilityVersion, range }) {
  try {
    return new semver.Range(range).set.some((comparators) => {
      const branch = comparators.map((comparator) => comparator.value).filter(Boolean).join(" ") || "*";
      if (semver.satisfies(targetVersion, branch)) return true;
      const includesPrerelease = comparators.some(
        (comparator) => (comparator.semver?.prerelease?.length ?? 0) > 0,
      );
      return !includesPrerelease && semver.satisfies(eligibilityVersion, branch);
    });
  } catch {
    return false;
  }
}

async function preparePackageArchive(resolvedTarget, options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(downloadUrlFor(resolvedTarget));
  if (!response.ok) {
    throw new Error(`failed to download OpenClaw ${resolvedTarget.version}: HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  verifyArchive(archive, resolvedTarget.source);

  await mkdir(path.dirname(options.targetDir), { recursive: true });
  const temporaryDir = await mkdtemp(path.join(path.dirname(options.targetDir), `.${path.basename(options.targetDir)}-`));
  try {
    const archivePath = path.join(temporaryDir, "openclaw.tgz");
    await writeFile(archivePath, archive);
    await extractTar({ cwd: temporaryDir, file: archivePath, strict: true });
    const packageDir = path.join(temporaryDir, "package");
    if (!(await isPreparedPackage(packageDir, resolvedTarget.version))) {
      throw new Error(`downloaded OpenClaw ${resolvedTarget.version} archive has unexpected package metadata`);
    }
    await rm(archivePath, { force: true });
    try {
      await rename(temporaryDir, options.targetDir);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

async function isPreparedPackage(packageDir, version) {
  if (!existsSync(path.join(packageDir, "package.json"))) return false;
  try {
    const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
    return packageJson.name === "openclaw" && packageJson.version === version;
  } catch {
    return false;
  }
}

function verifyArchive(archive, source) {
  if (typeof source.integrity === "string" && source.integrity.startsWith("sha512-")) {
    const actual = createHash("sha512").update(archive).digest("base64");
    if (actual !== source.integrity.slice("sha512-".length)) throw new Error("OpenClaw npm archive failed integrity verification");
    return;
  }
  if (typeof source.shasum === "string" && /^[a-f0-9]{40}$/i.test(source.shasum)) {
    const actual = createHash("sha1").update(archive).digest("hex");
    if (actual !== source.shasum.toLowerCase()) throw new Error("OpenClaw npm archive failed shasum verification");
    return;
  }
  throw new Error("OpenClaw npm archive has no supported integrity metadata");
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`failed to resolve OpenClaw npm metadata: HTTP ${response.status}`);
  return response.json();
}

function cacheKeyFor(target) {
  const identity = target.source.integrity ?? target.source.shasum ?? target.source.tarball;
  const digest = createHash("sha256").update(String(identity)).digest("hex").slice(0, 12);
  return `${target.version}-${digest}`;
}

function downloadUrlFor(target) {
  return downloadUrls.get(target) ?? null;
}

function hasVerifiableIntegrity(dist) {
  return (
    (typeof dist.integrity === "string" && /^sha512-[A-Za-z0-9+/]+=*$/.test(dist.integrity)) ||
    (typeof dist.shasum === "string" && /^[a-f0-9]{40}$/i.test(dist.shasum))
  );
}

function isExactOpenClawVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) && semver.valid(value) === value;
}

function normalizeRegistryUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function sanitizeUrlForReport(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sanitizeRepositoryForReport(repository) {
  if (typeof repository === "string") return sanitizeUrlForReport(repository);
  if (!repository || typeof repository !== "object") return null;
  return {
    ...repository,
    url: typeof repository.url === "string" ? sanitizeUrlForReport(repository.url) : null,
  };
}
