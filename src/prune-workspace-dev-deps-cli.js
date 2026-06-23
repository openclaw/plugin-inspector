#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { writeJsonFileAtomic } from "./json-file.js";
import path from "node:path";

const packageJsonPath = path.resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
let changed = false;

for (const [name, specifier] of Object.entries(packageJson.devDependencies ?? {})) {
  if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
    delete packageJson.devDependencies[name];
    changed = true;
  }
}

if (packageJson.devDependencies && Object.keys(packageJson.devDependencies).length === 0) {
  delete packageJson.devDependencies;
  changed = true;
}

if (changed) {
  await writeJsonFileAtomic(packageJsonPath, packageJson);
}
