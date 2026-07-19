import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeReportArtifact } from "../src/report-sanitizer.js";

test("returns the same report untouched when no absolute OpenClaw paths are present", () => {
  const report = {
    targetOpenClaw: { configuredPath: "../relative/openclaw", searchedPaths: ["also/relative"] },
    issues: [{ title: "kept ../relative/openclaw" }],
  };

  const result = sanitizeReportArtifact(report);

  // No absolute path => the original object is returned by reference, unmodified.
  assert.equal(result, report);
  assert.equal(result.targetOpenClaw.configuredPath, "../relative/openclaw");
  assert.deepEqual(result.targetOpenClaw.searchedPaths, ["also/relative"]);
  assert.equal(result.issues[0].title, "kept ../relative/openclaw");
});

test("does not mutate the input report and clones nested values", () => {
  const report = {
    targetOpenClaw: { configuredPath: "/home/user/openclaw", searchedPaths: [] },
    issues: [{ evidence: ["/home/user/openclaw/logs"] }],
  };

  const result = sanitizeReportArtifact(report);

  assert.notEqual(result, report);
  // Input is left intact; only the returned clone is sanitized.
  assert.equal(report.targetOpenClaw.configuredPath, "/home/user/openclaw");
  assert.equal(report.issues[0].evidence[0], "/home/user/openclaw/logs");
  assert.equal(result.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.equal(result.issues[0].evidence[0], "<OPENCLAW_PATH>/logs");
});

test("replaces the longest matching path first so nested paths never leak a suffix", () => {
  const base = "/home/user/openclaw";
  const nested = "/home/user/openclaw/extensions/telegram";
  const report = {
    targetOpenClaw: { configuredPath: base, searchedPaths: [nested] },
    note: `loaded ${nested}/index.ts against ${base}`,
  };

  const result = sanitizeReportArtifact(report);

  // Longest-first ordering is what prevents `${base}` from partially matching
  // inside `${nested}` and leaving `/extensions/telegram` exposed.
  assert.equal(result.note, "loaded <OPENCLAW_PATH>/index.ts against <OPENCLAW_PATH>");
  assert.equal(result.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.deepEqual(result.targetOpenClaw.searchedPaths, ["<OPENCLAW_PATH>"]);
});

test("honors a custom openclawPathPlaceholder", () => {
  const report = { targetOpenClaw: { configuredPath: "/srv/openclaw" }, note: "at /srv/openclaw" };

  const result = sanitizeReportArtifact(report, { openclawPathPlaceholder: "[REDACTED]" });

  assert.equal(result.targetOpenClaw.configuredPath, "[REDACTED]");
  assert.equal(result.note, "at [REDACTED]");
});

test("detects Windows drive-letter and UNC absolute paths", () => {
  const drivePath = "C:\\Users\\me\\openclaw";
  const uncPath = "\\\\build-server\\share\\openclaw";
  const report = {
    targetOpenClaw: { configuredPath: drivePath, searchedPaths: [uncPath] },
    note: `drive ${drivePath}\\logs and unc ${uncPath}\\logs`,
  };

  const result = sanitizeReportArtifact(report);

  assert.equal(result.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
  assert.deepEqual(result.targetOpenClaw.searchedPaths, ["<OPENCLAW_PATH>"]);
  assert.equal(result.note, "drive <OPENCLAW_PATH>\\logs and unc <OPENCLAW_PATH>\\logs");
});

test("ignores non-string and non-absolute searchedPaths entries", () => {
  const report = {
    targetOpenClaw: {
      configuredPath: "/opt/openclaw",
      searchedPaths: ["/opt/openclaw", "relative/openclaw", null, 42],
    },
    note: "found at /opt/openclaw but not relative/openclaw",
  };

  const result = sanitizeReportArtifact(report);

  // Only the absolute string entries are sanitized; relative/non-string ones pass through.
  assert.equal(result.note, "found at <OPENCLAW_PATH> but not relative/openclaw");
  assert.equal(result.targetOpenClaw.configuredPath, "<OPENCLAW_PATH>");
});
