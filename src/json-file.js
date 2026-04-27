import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function readJsonFile(jsonPath) {
  return JSON.parse(await readFile(jsonPath, "utf8"));
}

export async function readOptionalJsonFile(jsonPath) {
  return existsSync(jsonPath) ? readJsonFile(jsonPath) : null;
}
