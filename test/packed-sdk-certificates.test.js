import assert from "node:assert/strict";
import test from "node:test";
import { certifyPublicSdkNames } from "../src/packed-sdk-certificates.js";
import { publicSdkSurfaceNames } from "../src/packed-sdk-surface.js";

const packageRoot = "/openclaw";

function snapshot(files, exports = { "./plugin-sdk": "./dist/plugin-sdk/index.js" }) {
  return {
    packageRoot,
    packageJson: { name: "openclaw", exports },
    declarations: Object.entries(files).map(([name, source]) => ({ filePath: `${packageRoot}/${name}`, source })),
  };
}

// Every certified answer must agree with the full type-checked walk (the
// 0.4.4/0.4.5 computation); `decided` lists names that must not be left to the
// type checker.
function assertCertified(input, names, { available = [], unavailable = [], undecided = [] } = {}) {
  const truth = publicSdkSurfaceNames(input.declarations, input.packageJson, input.packageRoot, { reduce: false });
  const result = certifyPublicSdkNames({ ...input, names });
  for (const name of result.available) assert.ok(truth.has(name), `${name} certified available but the type check disagrees`);
  for (const name of result.unavailable) assert.ok(!truth.has(name), `${name} certified unavailable but the type check finds it`);
  for (const name of available) assert.ok(result.available.has(name), `${name} should be certified available`);
  for (const name of unavailable) assert.ok(result.unavailable.has(name), `${name} should be certified unavailable`);
  for (const name of undecided) assert.ok(result.undecided.has(name), `${name} should be left to the type checker`);
  return result;
}

test("entry exports, members, statics, enums and bindings are certified available", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": [
      'export { createStore, Store, Manager, Mode, readAsync, Box } from "../chunk.js";',
      'export * from "../star.js";',
      "",
    ].join("\n"),
    "dist/chunk.d.ts": [
      "declare function createStore(): Store;",
      "interface Store { getEntryAsync(): Entry; nested: { listAsync(): void } }",
      "interface Entry { appendAsync(): void }",
      "declare class Manager { static openAsync(): Manager; closeAsync(): void; }",
      "declare enum Mode { syncMode = 1 }",
      "declare const { readAsync, writeAsync }: { readAsync: () => Reader; writeAsync: () => void };",
      "interface Reader { readMoreAsync(): void }",
      "type Box<T> = { boxedAsync(): T };",
      "export { createStore, Store, Manager, Mode, readAsync, writeAsync, Box };",
      "",
    ].join("\n"),
    "dist/star.d.ts": "export declare function starredAsync(): void;\n",
  }), ["createStore", "getEntryAsync", "appendAsync", "listAsync", "openAsync", "closeAsync", "syncMode", "readAsync", "readMoreAsync", "starredAsync", "boxedAsync", "writeAsync"], {
    available: ["createStore", "getEntryAsync", "appendAsync", "listAsync", "openAsync", "closeAsync", "syncMode", "readAsync", "readMoreAsync", "starredAsync", "boxedAsync"],
    // Spelled in a reached statement: the per-statement negative pass leaves
    // it to the type checker (which finds it is not public).
    undecided: ["writeAsync"],
  });
});

test("an ambient module without export declarations exports every declaration", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": [
      "type Options = { cancelOnDeadline?: boolean; settle?: Settle };",
      "type Settle = { sourceSessionKeys: string };",
      "export type Visible = { visibleAsync(): void };",
      "",
    ].join("\n"),
  }), ["Options", "cancelOnDeadline", "sourceSessionKeys", "visibleAsync"], { available: ["Options", "cancelOnDeadline", "sourceSessionKeys", "visibleAsync"] });
});

test("parameter types, implements clauses, arrays and unresolvable generics are not walked", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      'import type { z } from "zod";',
      "interface Api { run(options: Hidden): void; list: readonly Listed[]; picked: Pick<Picked, \"a\">; schema: z.ZodObject<{ zodAsync: 1 }>; }",
      "interface Hidden { hiddenAsync(): void }",
      "interface Listed { listedAsync(): void }",
      "interface Picked { pickedAsync(): void }",
      "interface Contract { contractAsync(): void }",
      "declare class Impl implements Contract { implAsync(): void }",
      "declare const api: Api & { impl: Impl };",
      "export { api };",
      "",
    ].join("\n"),
  }), ["run", "hiddenAsync", "listedAsync", "pickedAsync", "zodAsync", "contractAsync", "implAsync"], {
    available: ["run", "implAsync"],
    unavailable: ["hiddenAsync", "listedAsync", "pickedAsync", "zodAsync", "contractAsync"],
  });
});

test("a conditional that infers from parameters makes the inferred parameter types reachable", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { Args } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      "type ParamsOf<T> = T extends (options: infer P) => unknown ? P : never;",
      "declare function configure(options: { inferredAsync(): void }): void;",
      "declare function other(options: { otherAsync(): void }): void;",
      "type Args = { args: ParamsOf<typeof configure> };",
      "export { Args, other };",
      "",
    ].join("\n"),
  }), ["inferredAsync", "otherAsync"], { unavailable: ["otherAsync"] });
});

test("a literal conditional selects its branch exactly", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { Runtime } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      "type Base<T> = { compareAndApply(value: T): void };",
      "type Store<T, Version extends 1 | 2 = 1> = Version extends 2 ? { versionTwoAsync(): void } : Base<T>;",
      "type Runtime = { state: { open<T>(): Store<T> } };",
      "export { Runtime };",
      "",
    ].join("\n"),
  }), ["compareAndApply", "versionTwoAsync"], { available: ["compareAndApply"] });
});

test("unions and intersections that could collapse are not trusted", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      "interface Live { liveAsync(): void }",
      "interface Other { otherAsync(): void }",
      "declare const api: { safe: Live | Other; collapsed: Missing | Live; withAny: any | Other };",
      "export { api };",
      "",
    ].join("\n"),
  }), ["liveAsync", "otherAsync"], { available: ["liveAsync", "otherAsync"] });
});

test("template literal types, tuples and intrinsic types block negative certificates for names they can compute", () => {
  const result = assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      "type Methods = \"read\" | \"write\";",
      "declare const api: { [K in Methods as `${K}Async`]: () => void } & { pair: [string, number] };",
      "export { api };",
      "",
    ].join("\n"),
  }), ["readAsync", "writeAsync", "deleteSync", "1", "length"]);
  assert.ok(result.undecided.has("readAsync") && result.undecided.has("writeAsync"));
  assert.ok(result.unavailable.has("deleteSync"));
  assert.ok(result.undecided.has("1") && result.undecided.has("length"));
});

test("global scripts, global augmentations and ambient modules are reachable from anywhere", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": [
      'import { External } from "external";',
      "export declare const api: { external: External; global: GlobalThing; augmented: Augmented };",
      "",
    ].join("\n"),
    "dist/globals.d.ts": "interface GlobalThing { globalAsync(): void }\n",
    "dist/augment.d.ts": "export {};\ndeclare global { interface Augmented { augmentedAsync(): void } }\n",
    "dist/ambient.d.ts": 'export {};\ndeclare module "external" { interface External { ambientAsync(): void } }\n',
  }), ["globalAsync", "augmentedAsync", "ambientAsync", "nowhereAsync"], { unavailable: ["nowhereAsync"] });
});

test("only the reached declarator of a variable statement is walked", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { a } from "../chunk.js";\n',
    "dist/chunk.d.ts": "declare const a: { aAsync(): void }, b: { bAsync(): void };\nexport { a, b };\n",
  }), ["aAsync", "bAsync"], { available: ["aAsync"], undecided: ["bAsync"] });
});

test("ambiguous star exports and unresolved re-exports are never claimed", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export * from "../one.js";\nexport * from "../two.js";\nexport { missingAsync } from "../one.js";\n',
    "dist/one.d.ts": "export declare function sharedAsync(): void;\n",
    "dist/two.d.ts": "export declare function sharedAsync(): { twoAsync(): void };\n",
  }), ["sharedAsync", "missingAsync", "twoAsync"]);
});

test("files that do not parse are kept conservative", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": "interface Api { okAsync(): void; broken: { ; }\ndeclare const api: Api;\nexport { api };\n",
  }), ["okAsync", "brokenAsync"]);
});
