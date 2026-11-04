import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { Parser } from "acorn";
import { plainJavaScriptTokens } from "../src/plain-javascript.js";

function isPlain(text) {
  const tokens = plainJavaScriptTokens(text);
  try {
    Parser.parse(text, {
      ecmaVersion: "latest", sourceType: "script",
      allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      onToken: tokens.onToken, onComment: tokens.onComment,
    });
  } catch {
    return false;
  }
  return tokens.isPlain();
}

function strip(text) {
  try {
    return stripTypeScriptTypes(text, { mode: "strip" });
  } catch (error) {
    return error.code;
  }
}

// JavaScript that Node's stripper reads as TypeScript (and changes), or that
// is close to it. Each must be refused.
const ambiguous = {
  "generic call": "f < a > (b);",
  "generic call across lines": "f < a >\n(b);",
  "instantiation before a line break": "a < b >\nc;",
  "nested generic call": "f < g < T >> (x);",
  "generic new": "new A < B > (c);",
  "generic tagged template": "f < a > `x`;",
  "optional generic call": "a?.b < c > (d);",
  "generic call with a conditional type": "f < A extends B ? C : D > (x);",
  "generic call with a function type": "f << T > (x) => T > (g);",
  "generic call with constrained parameters": "f << T extends A < B >, U > (x) => T > (g);",
  "generic call with an object type": "f < { a: b; c: d } > (x);",
  "generic call with a greater-or-equal": "a < b >= c;",
  "arrow return type in a conditional": "x ? (y) : z => w;",
  "arrow function return type in a conditional": "x ? (y) : (z) => w => v;",
  "async arrow return type in a conditional": "a ? async (b) : c => d;",
  "arrow return type in a case": "switch (a) { case (b): c => d; }",
  "declare across a line break": "declare\nconst x = 1;",
  "declare var across a line break": "declare\nvar x;",
  "declare after a statement": "a;\ndeclare\nlet\nx = 1;",
  "namespace across lines": "namespace\nX\n{}",
  "global block": "global\n{}",
  "module declaration": "module\n'x'",
  "type alias across lines": "type\nFoo = 1",
  "abstract class across lines": "abstract\nclass A {}",
  "class field modifier across lines": "class A { readonly\n x = 1 }",
  "declare field across lines": "class A { declare\n x }",
  "import named type": "import type from 'x';",
  "import type renamed": "import { type as x } from 'y';",
  "export type renamed": "var type; export { type as default };",
  "non-null across a line break": "f()\n!g()",
  "HTML open comment": "x = 1 <!-- y\n",
  "HTML close comment": "x = 1\n--> y\n",
  "byte order mark": "\uFEFFvar x = 1;",
};

for (const [name, text] of Object.entries(ambiguous)) {
  test(`plain JavaScript refuses ${name}`, () => {
    assert.equal(isPlain(text), false);
  });
}

const plain = {
  "comparison chain": "if (a < b && c > d) e();",
  "conditional comparisons": "r = c < 3 ? d(r) : c > 3 ? d(t, k, r) : d(t, k);",
  "shifts": "function rotl(x, n) { return x << n | x >>> 32 - n; }",
  "parenthesized shift": "e = s & ((1 << (-nBits)) - 1);",
  "conditional with a call": "x = a ? f(b) : c => d;",
  "conditional with a function": "x = a ? (function (o) { return o; }) : (function (o) { return 1; });",
  "conditional with a nested conditional": "x = a ? (b ? c : d) : e;",
  "member named type": "token.type = type;\nnext();",
  "property named declare": "({ declare: 1, type, module: 2 }).type;",
  "for-of over types": "for (const type of types) use(type);",
  "for-in over types": "for (const type in types) use(type);",
  "type instanceof": "function f(type) { return type instanceof Type; }",
  "conditional type value": "x = c\n  ? type\n  : other;",
  "commonjs export": "module.exports = { type: 1 };\nglobal.x = 1;",
  "prefix not after an operator": "a = b &&\n  !c;",
  "IIFE after a semicolon": "a();\n!function () {}();",
  "HTML comment text in a string": "x = '<!-- -->';\n// --> and <!-- in a comment\n",
  "import and export": "import a, { b as c } from 'm';\nexport { c as d };\nexport default a;",
  "import named type alone": "import { type } from 'x';",
  "arrow functions": "const f = async (a, { b }, [c], ...d) => a;\nconst g = x => y => x + y;",
  "classes": "class A extends B { static x = 1; #y; get z() { return this.#y; } m() {} }",
};

for (const [name, text] of Object.entries(plain)) {
  test(`plain JavaScript accepts ${name}, which strips to itself`, () => {
    assert.equal(isPlain(text), true);
    assert.equal(strip(text), text);
  });
}

test("TypeScript is never plain JavaScript", () => {
  for (const text of ["let a: number = 1;", "enum E { A }", "function f<T>(x: T) {}", "import type { A } from 'a';", "x as T;", "a!;"]) {
    assert.equal(isPlain(text), false, text);
  }
});

test("everything refused here is refused for a reason the stripper shares or is conservative", () => {
  // Refusing only costs the stripper call; accepting must be exact. Every
  // ambiguous case that the stripper changes is among the refused ones.
  for (const [name, text] of Object.entries(ambiguous)) {
    const output = strip(text);
    if (typeof output === "string" && output !== text) assert.equal(isPlain(text), false, name);
  }
});
