import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import { x as extractTar } from "tar";
import { readOpenClawTargetSurface } from "./openclaw-target.js";

const defaultRegistryUrl = "https://registry.npmjs.org";
const defaultFetchTimeoutMs = 30_000;
const defaultMaxArchiveBytes = 256 * 1024 * 1024;
const defaultMaxMetadataBytes = 16 * 1024 * 1024;
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
    const distTags = await fetchJson(`${registryUrl}/-/package/openclaw/dist-tags`, fetchImpl, options);
    version = distTags?.[requested];
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

  const versionMetadata = await fetchJson(`${registryUrl}/openclaw/${encodeURIComponent(version)}`, fetchImpl, options);
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
  const parsed = semver.parse(version);
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : version;
}

export function satisfiesOpenClawVersionRange(version, range) {
  return Boolean(semver.valid(version) && semver.validRange(range) && semver.satisfies(version, range));
}

export function satisfiesOpenClawCompatibilityRange({ targetVersion, eligibilityVersion, range }) {
  try {
    const target = semver.parse(targetVersion);
    if (!target) return false;
    return new semver.Range(range).set.some((comparators) => {
      const branch = comparators.map((comparator) => comparator.value).filter(Boolean).join(" ") || "*";
      if (semver.satisfies(targetVersion, branch)) return true;
      const constrainsTargetPrerelease = comparators.some(
        (comparator) =>
          (comparator.semver?.prerelease?.length ?? 0) > 0 &&
          comparator.semver.major === target.major &&
          comparator.semver.minor === target.minor &&
          comparator.semver.patch === target.patch,
      );
      return !constrainsTargetPrerelease && semver.satisfies(eligibilityVersion, branch);
    });
  } catch {
    return false;
  }
}

async function preparePackageArchive(resolvedTarget, options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchWithTimeout(fetchImpl, downloadUrlFor(resolvedTarget), {}, options, "npm archive");
  if (!response.ok) {
    await cancelBody(response.body);
    throw new Error(`failed to download OpenClaw ${resolvedTarget.version}: HTTP ${response.status}`);
  }
  const archive = await readLimitedBody(response, maxArchiveBytes(options), "npm archive");
  verifyArchive(archive, resolvedTarget.source);

  await mkdir(path.dirname(options.targetDir), { recursive: true });
  const temporaryDir = await mkdtemp(path.join(path.dirname(options.targetDir), `.${path.basename(options.targetDir)}-`));
  try {
    const archivePath = path.join(temporaryDir, "openclaw.tgz");
    await writeFile(archivePath, archive);
    // Async tar rejection can leave filesystem writes running. Finish extraction
    // before finally removes its workspace, including when strict validation fails.
    extractTar({ cwd: temporaryDir, file: archivePath, strict: true, sync: true });
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

async function fetchJson(url, fetchImpl, options = {}) {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: { accept: "application/json" } },
    options,
    "npm metadata",
  );
  if (!response.ok) {
    await cancelBody(response.body);
    throw new Error(`failed to resolve OpenClaw npm metadata: HTTP ${response.status}`);
  }
  const body = await readLimitedBody(response, maxMetadataBytes(options), "npm metadata");
  return JSON.parse(body.toString("utf8"));
}

async function fetchWithTimeout(fetchImpl, url, init, options, what) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(fetchTimeoutMs(options)) });
  } catch (error) {
    throw mapTargetFetchError(error, what);
  }
}

async function readLimitedBody(response, maxBytes, what) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response.body);
    throw targetDownloadLimitError(what, maxBytes);
  }

  let reader;
  try {
    if (!response.body || typeof response.body.getReader !== "function") {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw targetDownloadLimitError(what, maxBytes);
      return buffer;
    }

    reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw targetDownloadLimitError(what, maxBytes);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  } catch (error) {
    throw mapTargetFetchError(error, what);
  } finally {
    reader?.releaseLock();
  }
}

async function cancelBody(body) {
  try {
    await body?.cancel?.();
  } catch {}
}

function fetchTimeoutMs(options) {
  const timeout = positiveInteger(
    options.fetchTimeoutMs ?? process.env.PLUGIN_INSPECTOR_TARGET_FETCH_TIMEOUT_MS,
    defaultFetchTimeoutMs,
  );
  // Node clamps overflowing timer delays to 1ms instead of honoring the budget.
  return timeout <= 2_147_483_647 ? timeout : defaultFetchTimeoutMs;
}

function maxArchiveBytes(options) {
  return positiveInteger(options.maxArchiveBytes ?? process.env.PLUGIN_INSPECTOR_TARGET_ARCHIVE_MAX_BYTES, defaultMaxArchiveBytes);
}

function maxMetadataBytes(options) {
  return positiveInteger(options.maxMetadataBytes ?? process.env.PLUGIN_INSPECTOR_TARGET_METADATA_MAX_BYTES, defaultMaxMetadataBytes);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mapTargetFetchError(error, what) {
  if (error?.failureClass) return error;
  if (isTimeoutError(error)) {
    const wrapped = new Error(`OpenClaw ${what} download timed out`);
    wrapped.failureClass = "target-download-timeout";
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

function isTimeoutError(error) {
  for (let current = error; current; current = current.cause) {
    if (current.name === "TimeoutError" || current.name === "AbortError") return true;
  }
  return false;
}

function targetDownloadLimitError(what, maxBytes) {
  const error = new Error(`OpenClaw ${what} exceeds the ${maxBytes} byte download limit`);
  error.failureClass = "target-download-too-large";
  return error;
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
  const url = String(value);
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return url.slice(0, end);
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
