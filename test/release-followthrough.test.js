import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildCrabpotFollowthroughChecklist } from "../scripts/check-crabpot-followthrough.mjs";

test("crabpot follow-through checklist passes matching source refs", async () => {
  const roots = await createFixtureRoots({
    ref: "abc123",
    packagePin: "@openclaw/plugin-inspector@1.2.3",
  });

  const result = buildCrabpotFollowthroughChecklist({
    pluginInspectorRoot: roots.pluginInspectorRoot,
    crabpotRoot: roots.crabpotRoot,
    expectedRef: "abc123",
    expectedVersion: "1.2.3",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.checks.find((check) => check.id === "crabpot-source-ref").status, "pass");
  assert.equal(result.checks.find((check) => check.id === "crabpot-package-pin").status, "pass");
});

test("crabpot follow-through checklist fails stale refs and optionally stale package pins", async () => {
  const roots = await createFixtureRoots({
    ref: "old-ref",
    packagePin: "@openclaw/plugin-inspector@1.0.0",
  });

  const preRelease = buildCrabpotFollowthroughChecklist({
    pluginInspectorRoot: roots.pluginInspectorRoot,
    crabpotRoot: roots.crabpotRoot,
    expectedRef: "new-ref",
    expectedVersion: "1.2.3",
  });
  const postRelease = buildCrabpotFollowthroughChecklist({
    pluginInspectorRoot: roots.pluginInspectorRoot,
    crabpotRoot: roots.crabpotRoot,
    expectedRef: "old-ref",
    expectedVersion: "1.2.3",
    requirePublishedPin: true,
  });

  assert.equal(preRelease.status, "fail");
  assert.equal(preRelease.checks.find((check) => check.id === "crabpot-package-pin").status, "manual");
  assert.equal(postRelease.status, "fail");
  assert.equal(postRelease.checks.find((check) => check.id === "crabpot-package-pin").status, "fail");
});

async function createFixtureRoots({ ref, packagePin }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-release-followthrough-"));
  const pluginInspectorRoot = path.join(root, "plugin-inspector");
  const crabpotRoot = path.join(root, "crabpot");
  await mkdir(path.join(crabpotRoot, "scripts"), { recursive: true });
  await mkdir(pluginInspectorRoot, { recursive: true });
  await writeFile(
    path.join(pluginInspectorRoot, "package.json"),
    `${JSON.stringify({ version: "1.2.3" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(crabpotRoot, "scripts", "plugin-inspector-source.mjs"),
    [
      `export const pluginInspectorRef = "${ref}";`,
      `export const pluginInspectorPackage = "${packagePin}";`,
      "",
    ].join("\n"),
    "utf8",
  );
  return { pluginInspectorRoot, crabpotRoot };
}
