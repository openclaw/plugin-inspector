import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReleasePlan } from "../scripts/release-plan.mjs";

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "### Changed",
  "",
  "- Tighten package contents.",
  "",
  "## 0.3.0 - 2026-04-27",
  "",
].join("\n");

test("release plan infers the next patch version", () => {
  const plan = buildReleasePlan({
    packageVersion: "0.3.0",
    changelogText: changelog,
    releaseDate: "2026-04-28",
    releaseRef: "abc123",
  });

  assert.equal(plan.status, "pass");
  assert.equal(plan.nextVersion, "0.3.1");
  assert.equal(plan.tagName, "v0.3.1");
  assert.equal(plan.changelogHeading, "## 0.3.1 - 2026-04-28");
  assert.equal(plan.crabpotSourceRef, "abc123");
  assert.equal(plan.crabpotPackagePin, "@openclaw/plugin-inspector@0.3.1");
});

test("release plan rejects non-advancing versions", () => {
  const plan = buildReleasePlan({
    packageVersion: "0.3.0",
    nextVersion: "0.3.0",
    changelogText: changelog,
    releaseDate: "2026-04-28",
    releaseRef: "abc123",
  });

  assert.equal(plan.status, "fail");
  assert.equal(plan.checks.find((check) => check.id === "version-advance").status, "fail");
});

test("release plan leaves the Crabpot source ref explicit when no ref is provided", () => {
  const plan = buildReleasePlan({
    packageVersion: "0.3.0",
    changelogText: changelog,
    releaseDate: "2026-04-28",
  });

  assert.equal(plan.crabpotSourceRef, "REPLACE_WITH_RELEASE_COMMIT_SHA");
  assert.ok(plan.steps.some((step) => step.includes("REPLACE_WITH_RELEASE_COMMIT_SHA")));
});

test("release plan requires unreleased changelog bullets", () => {
  const plan = buildReleasePlan({
    packageVersion: "0.3.0",
    changelogText: "# Changelog\n\n## Unreleased\n",
    releaseDate: "2026-04-28",
    releaseRef: "abc123",
  });

  assert.equal(plan.status, "fail");
  assert.equal(plan.checks.find((check) => check.id === "changelog-unreleased").status, "fail");
});
