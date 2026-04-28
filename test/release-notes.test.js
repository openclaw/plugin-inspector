import assert from "node:assert/strict";
import { test } from "node:test";
import { extractReleaseNotes } from "../scripts/release-notes.mjs";

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "### Added",
  "",
  "- Add grouped API helpers.",
  "",
  "## 0.3.0 - 2026-04-27",
  "",
  "### Changed",
  "",
  "- Improve setup.",
  "",
].join("\n");

test("release notes can render unreleased draft notes", () => {
  assert.equal(
    extractReleaseNotes({ changelogText: changelog, version: "Unreleased" }),
    ["## plugin-inspector unreleased", "", "### Added", "", "- Add grouped API helpers.", ""].join("\n"),
  );
});

test("release notes can render versioned changelog sections", () => {
  assert.equal(
    extractReleaseNotes({ changelogText: changelog, version: "0.3.0" }),
    ["## plugin-inspector v0.3.0", "", "### Changed", "", "- Improve setup.", ""].join("\n"),
  );
});

test("release notes fail when a version section is missing", () => {
  assert.throws(() => extractReleaseNotes({ changelogText: changelog, version: "9.9.9" }), /missing a 9\.9\.9/);
});
