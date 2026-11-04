import { readFile } from "node:fs/promises";

// Reads a UTF-8 file as one string. readFile(path, "utf8") decodes large files
// chunk by chunk into a concatenated string that V8 later flattens into a copy:
// a multi-megabyte declaration file costs about four times its size in young
// objects that survive collection. Decoding the whole buffer at once gives the
// same text as a single (external) string.
export async function readText(filePath) {
  return (await readFile(filePath)).toString("utf8");
}
