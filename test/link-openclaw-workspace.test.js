import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { linkOpenClawWorkspace } from "../src/link-openclaw-workspace-cli.js";

test("links OpenClaw runtime dependencies without rewriting peer contracts", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-link-openclaw-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const packageJsonPath = path.join(rootDir, "package.json");
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: "fixture",
        dependencies: { openclaw: ">=2026.7.2" },
        peerDependencies: { openclaw: ">=2026.7.2" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await linkOpenClawWorkspace(packageJsonPath, "file:../../../openclaw");

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  assert.equal(packageJson.dependencies.openclaw, "file:../../../openclaw");
  assert.equal(packageJson.peerDependencies.openclaw, ">=2026.7.2");
});

test("links peer-only and optional OpenClaw host inputs in their runtime section", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-link-openclaw-sections-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const peerOnlyPath = path.join(rootDir, "peer-only.json");
  const optionalPath = path.join(rootDir, "optional.json");
  await writeFile(peerOnlyPath, '{"name":"peer-only","peerDependencies":{"openclaw":"*"}}\n', "utf8");
  await writeFile(optionalPath, '{"name":"optional","optionalDependencies":{"openclaw":"*"}}\n', "utf8");

  await linkOpenClawWorkspace(peerOnlyPath, "file:../../../openclaw");
  await linkOpenClawWorkspace(optionalPath, "file:../../../openclaw");

  const peerOnly = JSON.parse(await readFile(peerOnlyPath, "utf8"));
  const optional = JSON.parse(await readFile(optionalPath, "utf8"));
  assert.equal(peerOnly.dependencies.openclaw, "file:../../../openclaw");
  assert.equal(peerOnly.peerDependencies.openclaw, "*");
  assert.equal(optional.optionalDependencies.openclaw, "file:../../../openclaw");
  assert.equal(optional.dependencies, undefined);
});
