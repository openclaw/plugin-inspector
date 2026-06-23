import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, open, readFile, readlink, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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
// special bits) so the atomic replace stays permission-neutral. Existing
// symlinked manifests resolve to their target before staging so the link itself
// is never replaced.
export async function writeJsonFileAtomic(jsonPath, value) {
  const writePath = await resolveJsonWritePath(jsonPath);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = join(dirname(writePath), `.${basename(writePath)}.${process.pid}.${randomUUID()}.tmp`);

  let existingMode;
  try {
    existingMode = (await stat(writePath)).mode & 0o7777;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const handle = await open(tempPath, "wx");
  let stagingError = null;
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
    if (existingMode !== undefined) {
      await handle.chmod(existingMode);
    }
  } catch (error) {
    stagingError = error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      stagingError ??= error;
    }
  }

  if (stagingError) {
    await unlink(tempPath).catch(() => {});
    throw stagingError;
  }

  try {
    await rename(tempPath, writePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function resolveJsonWritePath(jsonPath) {
  try {
    return await realpath(jsonPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  let writePath = jsonPath;
  const seen = new Set();
  for (let hops = 0; hops < 40; hops += 1) {
    const normalizedPath = resolve(writePath);
    if (seen.has(normalizedPath)) {
      const error = new Error(`too many symbolic links resolving ${jsonPath}`);
      error.code = "ELOOP";
      throw error;
    }
    seen.add(normalizedPath);

    let entry;
    try {
      entry = await lstat(writePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return writePath;
      }
      throw error;
    }

    if (!entry.isSymbolicLink()) {
      return writePath;
    }

    const target = await readlink(writePath);
    writePath = resolve(dirname(writePath), target);
  }

  const error = new Error(`too many symbolic links resolving ${jsonPath}`);
  error.code = "ELOOP";
  throw error;
}
