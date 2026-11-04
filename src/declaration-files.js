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
