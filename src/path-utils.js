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
