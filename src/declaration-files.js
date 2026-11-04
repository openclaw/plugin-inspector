import { readdir } from "node:fs/promises";
import path from "node:path";

export async function listDeclarationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listDeclarationFiles(entryPath)));
    else if (entry.isFile() && /\.d\.[cm]?ts$/.test(entry.name)) files.push(entryPath);
  }
  return files.sort();
}

export function publicSdkDeclarationFiles(packageJson, packageRoot, sources, normalize = (file) => path.resolve(file).split(path.sep).join("/")) {
  const files = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const resolved = normalize(path.resolve(packageRoot, value));
      const candidates = /\.d\.[cm]?ts$/.test(resolved) ? [resolved]
        : /\.mjs$/.test(resolved) ? [resolved.replace(/\.mjs$/, ".d.mts"), resolved.replace(/\.mjs$/, ".d.ts")]
        : /\.cjs$/.test(resolved) ? [resolved.replace(/\.cjs$/, ".d.cts"), resolved.replace(/\.cjs$/, ".d.ts")]
        : [resolved.replace(/\.js$/, ".d.ts")];
      const declaration = candidates.find((candidate) => sources.has(candidate));
      if (declaration) files.add(declaration);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const [specifier, value] of Object.entries(packageJson.exports ?? {})) {
    if (specifier === "./plugin-sdk" || specifier.startsWith("./plugin-sdk/")) visit(value);
  }
  return files;
}
