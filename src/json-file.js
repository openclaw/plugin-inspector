import { existsSync } from "node:fs";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function readJsonFile(jsonPath) {
  return JSON.parse(await readFile(jsonPath, "utf8"));
}

export async function readOptionalJsonFile(jsonPath) {
  return existsSync(jsonPath) ? readJsonFile(jsonPath) : null;
}

// Writes JSON.stringify(value, null, 2) + newline atomically: stage to a sibling
// temp file, fsync, then rename over the destination. A crash mid-write can only
// truncate the temp file, so an interrupted run never corrupts an existing
// manifest. The destination file mode is preserved exactly (including any
// special bits) so the atomic replace stays permission-neutral.
export async function writeJsonFileAtomic(jsonPath, value) {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = join(dirname(jsonPath), `.${basename(jsonPath)}.${process.pid}.${randomUUID()}.tmp`);

  let existingMode;
  try {
    existingMode = (await stat(jsonPath)).mode & 0o7777;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
    if (existingMode !== undefined) {
      await handle.chmod(existingMode);
    }
  } finally {
    await handle.close();
  }

  try {
    await rename(tempPath, jsonPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}
