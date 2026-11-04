import assert from "node:assert/strict";
import test from "node:test";
import { compareScopeFacts } from "./support/scope-facts-compare.js";

// The runtime-import analysis reads scope facts for a few names from a light
// scope manager driven by eslint-scope's Referencer; they must equal the full
// ScopeManager's for every scoping rule that can affect those names.
const cases = {
  "shadowed require parameter": 'function f(require) { return require("x"); }',
  "default parameter cannot see body declarations": 'function g(x = require("x")) { var require = 1; return x; }',
  "block, catch, for, switch and class scopes": '{ let require; require("a"); } try {} catch (require) { require("b"); } for (const require of []) require("c"); switch (1) { case 1: let require; require("d"); } class require { m() { require("e"); } }',
  "class heritage and fields resolve inside the class scope": 'class C extends require("a") { static s = require("b"); static { var require; } }',
  "named function expressions": 'const k = function require(p) { return require("x"); };',
  "createRequire handles": 'import { createRequire } from "node:module"; const r = createRequire(import.meta.url); r("x").y; let w = createRequire(u); w = null; w("z");',
  "namespace imports, callbacks and awaited imports": 'import * as ns from "x"; ns.a(); function q(ns) { ns.b(); } import("y").then((m) => { m.c(); { const m = {}; m.d(); } }); const s = await import("z"); s.e(); (() => { var s; s.f(); })();',
  "hoisting and redeclaration": 'const t = require("x"), u = t; t.a(); function h() { return arguments; } var v = require("y"); var v; v.b();',
  "destructuring defaults and computed keys": 'const { a: aa = require("x") } = {}; aa.k(); const o = { require, [require("y").k]: 1 };',
  "exports and labels": 'export { y }; const y = require("x"); label: { require("z"); break label; }',
  "async arrows with defaults": 'const fn = async (z = require("w")) => { const m = await import("x"); m.l(); return z; };',
  "commonjs wrapper": 'var require = 1; module.exports = function () { return require("x"); };',
};

for (const [name, source] of Object.entries(cases)) {
  test(`scope facts match eslint-scope: ${name}`, () => {
    const result = compareScopeFacts(source);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.differences, []);
  });
}

test("files with direct eval or with use the full scope analysis", () => {
  assert.equal(compareScopeFacts('eval("1"); require("x");').skipped, true);
  assert.equal(compareScopeFacts('with (o) { require("x"); }').skipped, true);
});
