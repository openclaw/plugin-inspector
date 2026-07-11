#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonFileAtomic } from "./json-file.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const specifier = process.argv[2];
  await linkOpenClawWorkspace(path.resolve(process.cwd(), "package.json"), specifier);
}

export async function linkOpenClawWorkspace(packageJsonPath, specifier) {
  if (typeof specifier !== "string" || !specifier.startsWith("file:")) {
    throw new TypeError("link-openclaw-workspace requires a file: dependency specifier");
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  let linked = false;
  for (const section of ["dependencies", "optionalDependencies"]) {
    if (Object.hasOwn(packageJson[section] ?? {}, "openclaw")) {
      packageJson[section].openclaw = specifier;
      linked = true;
    }
  }

  if (!linked) {
    packageJson.dependencies ??= {};
    packageJson.dependencies.openclaw = specifier;
  }

  await writeJsonFileAtomic(packageJsonPath, packageJson);
}
