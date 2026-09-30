import path from "node:path";

export function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

// Lexical string check only. Does not follow or reject symlinks or Windows junctions.
export function isWithinPluginRoot(rootDir, candidatePath, pathApi = path) {
  const root = pathApi.resolve(rootDir);
  const candidate = pathApi.resolve(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return relative === "" || (!isParentDirectoryRelative(relative) && !pathApi.isAbsolute(relative));
}

export function isParentDirectoryRelative(relative) {
  if (typeof relative !== "string" || relative.length === 0) {
    return false;
  }
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith("../") ||
    relative.startsWith("..\\")
  );
}

export function resolveJailedPluginPath(rootDir, specifier, pathApi = path) {
  if (typeof specifier !== "string" || specifier.length === 0) {
    return null;
  }
  if (path.win32.isAbsolute(specifier) || path.posix.isAbsolute(specifier) || /^[A-Za-z]:/u.test(specifier)) {
    return null;
  }
  const root = pathApi.resolve(rootDir);
  const resolved = pathApi.resolve(root, specifier);
  if (!isWithinPluginRoot(root, resolved, pathApi)) {
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
