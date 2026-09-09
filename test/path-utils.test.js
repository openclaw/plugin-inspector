import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  normalizeRepoPath,
  posixJoin,
  resolveFromRoot,
  resolveRequiredFromRoot,
  slugForArtifact,
  toRepoPath,
} from "../src/path-utils.js";

test("resolveFromRoot joins a relative value under the root and passes an absolute value through", () => {
  assert.equal(resolveFromRoot("/root", "sub/file.json"), path.join("/root", "sub/file.json"));
  assert.equal(resolveFromRoot("/root", "/abs/file.json"), "/abs/file.json");
});

test("resolveRequiredFromRoot throws a labeled error when the value is missing", () => {
  assert.throws(() => resolveRequiredFromRoot("/root", "", "config"), {
    message: "config path is required",
  });
  assert.throws(() => resolveRequiredFromRoot("/root", undefined, "workflow"), {
    message: "workflow path is required",
  });
});

test("resolveRequiredFromRoot resolves like resolveFromRoot once a value is present", () => {
  assert.equal(resolveRequiredFromRoot("/root", "x.json", "config"), path.join("/root", "x.json"));
  assert.equal(resolveRequiredFromRoot("/root", "/abs/x.json", "config"), "/abs/x.json");
});

test("normalizeRepoPath rewrites backslashes to forward slashes and coerces to string", () => {
  assert.equal(normalizeRepoPath("a\\b\\c"), "a/b/c");
  assert.equal(normalizeRepoPath("already/posix"), "already/posix");
  assert.equal(normalizeRepoPath(123), "123");
});

test("toRepoPath normalizes both backslashes and the platform separator to forward slashes", () => {
  assert.equal(toRepoPath("a\\b/c"), "a/b/c");
  assert.equal(toRepoPath(path.join("a", "b", "c")), "a/b/c");
});

test("posixJoin drops falsy segments before joining", () => {
  assert.equal(posixJoin("a", "", "b"), "a/b");
  assert.equal(posixJoin("a", null, undefined, "b"), "a/b");
  assert.equal(posixJoin(0, "a"), "a");
});

test("posixJoin collapses runs of slashes into a single separator", () => {
  assert.equal(posixJoin("a/", "/b"), "a/b");
  assert.equal(posixJoin("a//b", "c"), "a/b/c");
});

test("slugForArtifact replaces non-alphanumeric runs with a single dash", () => {
  assert.equal(slugForArtifact("Hello, World!"), "Hello-World");
  assert.equal(slugForArtifact("a__b"), "a-b");
  assert.equal(slugForArtifact(123), "123");
});

test("slugForArtifact trims leading and trailing dashes", () => {
  assert.equal(slugForArtifact("  Hello, World!  "), "Hello-World");
  assert.equal(slugForArtifact("--a__b--"), "a-b");
  assert.equal(slugForArtifact("!!!"), "");
});
