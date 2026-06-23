import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, symlink, writeFile, chmod, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeJsonFileAtomic } from "../src/json-file.js";

test("writeJsonFileAtomic writes formatted JSON with trailing newline", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-json-file-"));
  const jsonPath = path.join(rootDir, "package.json");

  await writeJsonFileAtomic(jsonPath, { name: "fixture" });

  assert.equal(await readFile(jsonPath, "utf8"), `${JSON.stringify({ name: "fixture" }, null, 2)}\n`);
});

test("writeJsonFileAtomic preserves an existing file mode", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-json-file-"));
  const jsonPath = path.join(rootDir, "package.json");
  await writeFile(jsonPath, "{}\n", "utf8");
  await chmod(jsonPath, 0o600);

  await writeJsonFileAtomic(jsonPath, { name: "fixture" });

  assert.equal((await lstat(jsonPath)).mode & 0o777, 0o600);
});

test("writeJsonFileAtomic preserves package.json symlinks and updates their targets", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-json-file-"));
  const targetPath = path.join(rootDir, "target-package.json");
  const linkPath = path.join(rootDir, "package.json");
  await writeFile(targetPath, "{}\n", "utf8");
  await symlink("target-package.json", linkPath);

  await writeJsonFileAtomic(linkPath, { name: "fixture" });

  assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
  assert.equal(await readFile(targetPath, "utf8"), `${JSON.stringify({ name: "fixture" }, null, 2)}\n`);
});

test("writeJsonFileAtomic removes the temp file when staging fails", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-json-file-"));
  const jsonPath = path.join(rootDir, "package.json");
  await writeFile(jsonPath, "{}\n", "utf8");

  const handle = await open(jsonPath, "r");
  const fileHandlePrototype = Object.getPrototypeOf(handle);
  await handle.close();
  const originalSync = fileHandlePrototype.sync;
  fileHandlePrototype.sync = async () => {
    throw new Error("forced sync failure");
  };

  try {
    await assert.rejects(writeJsonFileAtomic(jsonPath, { name: "fixture" }), /forced sync failure/);
  } finally {
    fileHandlePrototype.sync = originalSync;
  }

  const files = await readdir(rootDir);
  assert.deepEqual(files, ["package.json"]);
  assert.equal(await readFile(jsonPath, "utf8"), "{}\n");
});
