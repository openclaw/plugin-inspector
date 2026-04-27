import path from "node:path";

export function resolveFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
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
