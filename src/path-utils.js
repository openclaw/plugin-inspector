import path from "node:path";

export function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

export function isUncPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return /^\/\/[^/]+/u.test(value.replaceAll("\\", "/"));
}

export function isWithinPluginRoot(rootDir, candidatePath) {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  if (isUncPath(root) || isUncPath(candidate)) {
    return false;
  }
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveJailedPluginPath(rootDir, specifier) {
  if (typeof specifier !== "string" || specifier.length === 0) {
    return null;
  }
  if (isUncPath(specifier) || path.win32.isAbsolute(specifier) || path.posix.isAbsolute(specifier) || /^[A-Za-z]:/u.test(specifier)) {
    return null;
  }
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, specifier);
  if (isUncPath(resolved) || !isWithinPluginRoot(root, resolved)) {
    return null;
  }
  return resolved;
}

export function resolveRequiredFromRoot(rootDir, value, label) {
  if (!value) {
    throw new Error(`${label} path is required`);
  }
  return resolveFromRoot(rootDir, value);
}

export function toRepoPath(value) {
  return normalizeRepoPath(value).replaceAll(path.sep, "/");
}

export function normalizeRepoPath(value) {
  return String(value).replaceAll("\\", "/");
}

export function posixJoin(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function slugForArtifact(value) {
  return String(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}
