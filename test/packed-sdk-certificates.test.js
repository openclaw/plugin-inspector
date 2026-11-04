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

test("inherited members use the effective derived property type", async () => {
  const input = snapshot({
    "dist/plugin-sdk/index.d.ts": [
      "interface Base { child: { compareAndApply(): void } | { other(): void }; inheritedAsync(): void }",
      "interface Derived extends Base { child: { other(): void } }",
      "export { Derived };",
    ].join("\n"),
  });
  assertCertified(input, ["compareAndApply", "inheritedAsync", "other"], {
    available: ["other"],
    undecided: ["compareAndApply", "inheritedAsync"],
  });
  const { retirementRecordsForPackedTarget } = await import("../src/registry-deprecations.js");
  const records = ["compareAndApply", "inheritedAsync"].map((name) => ({
    code: name, status: "deprecated", replacementExports: [name],
  }));
  assert.deepEqual(await retirementRecordsForPackedTarget(records, input), [records[1]]);
});

test("cyclic named re-exports do not hide an accompanying valid API", () => {
  assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { Loop } from "../a.js"; export interface Api { compareAndApply(): void }',
    "dist/a.d.ts": 'export { Loop } from "./b.js";',
    "dist/b.d.ts": 'export { Loop } from "./a.js";',
  }), ["compareAndApply"], { available: ["compareAndApply"] });
});

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
    // Only a member of a destructuring annotation, which is never itself
    // walked: each binding has its property's type.
    unavailable: ["writeAsync"],
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

test("finite template literal keys are computed exactly; open templates, tuples and intrinsic types block negative certificates", () => {
  const result = assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      "type Methods = \"read\" | \"write\";",
      "declare const api: { [K in Methods as `${K}Async`]: () => void } & { pair: [string, number] };",
      "export { api };",
      "",
    ].join("\n"),
  }), ["readAsync", "writeAsync", "deleteSync", "1", "length"]);
  assert.ok(result.available.has("readAsync") && result.available.has("writeAsync"));
  assert.ok(result.unavailable.has("deleteSync"));
  assert.ok(result.undecided.has("1") && result.undecided.has("length"));
  const open = assertCertified(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": "type Handlers = { [K in `on${string}`]: () => void };\ndeclare const api: Handlers & { name: `${number}-id` };\nexport { api };\n",
  }), ["onReadAsync", "readAsync", "12-id"]);
  // `on${string}` is an index pattern, not a property, but it could match.
  assert.ok(open.undecided.has("onReadAsync") && open.unavailable.has("readAsync") && open.undecided.has("12-id"));
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

// A later OpenClaw release can add entrypoints and declaration shapes the
// certificates have never seen; answers must still match the full type check.
function futureSnapshot({ computedNames = false } = {}) {
  const files = {
    "dist/plugin-sdk/index.d.ts": 'export { a as Existing } from "../existing.js";\n',
    "dist/existing.d.ts": "interface Existing { existingAsync(): void }\ninterface Existing { mergedFutureAsync(): void }\nexport { Existing as a };\n",
    "dist/future-sessions.d.ts": [
      'import { t as LinkStore } from "./future-links.js";',
      "declare class SessionManager { static openAsync(): Promise<SessionManager>; appendMessageAsync(): Promise<void>; get links(): LinkStore; }",
      "type Versioned<Version extends 1 | 2 = 1> = Version extends 2 ? { statusAsync(): void } : { selectV1(): void };",
      "type Box<T> = { value: T; cancelAsync(): void };",
      "declare const { readAsync, writeBack }: { readAsync: () => Recorder; writeBack: () => void };",
      "interface Recorder { recordTurnAsync(): void }",
      'declare enum Mode { selectAsync = "selectAsync" }',
      "export { SessionManager as a, Versioned as n, Box as o, readAsync as r, Mode as s };",
      "",
    ].join("\n"),
    "dist/future-links.d.ts": "interface LinkStore { listLinksAsync(): void; linkAsync(): void }\nexport { LinkStore as t };\n",
    "dist/plugin-sdk/future-runtime.d.ts": [
      'import { a as SessionManager, n as Versioned, o as Box, r as readAsync, s as Mode } from "../future-sessions.js";',
      "type FutureRuntime = { sessions: typeof SessionManager; versioned: Versioned<2>; boxed: Box<string>; read: typeof readAsync; mode: typeof Mode };",
      "declare function createFutureRuntime(): FutureRuntime;",
      "declare global { interface FutureGlobalHook { resolveConfigAsync(): void } }",
      "export declare const futureHook: FutureGlobalHook;",
      "",
    ].join("\n"),
    "dist/plugin-sdk/future-default.d.ts": "declare const runtime: { defaultOpenAsync(): void };\nexport default runtime;\nexport * as futureNamespace from \"../future-links.js\";\n",
  };
  const exports = {
    "./plugin-sdk": "./dist/plugin-sdk/index.js",
    "./plugin-sdk/future-runtime": { types: "./dist/plugin-sdk/future-runtime.d.ts" },
    "./plugin-sdk/future-default": { types: "./dist/plugin-sdk/future-default.d.ts" },
  };
  if (computedNames) {
    files["dist/plugin-sdk/future-computed.d.ts"] = 'type Verbs = "unlink" | "personalStatus";\nexport type Computed = { [K in Verbs as `${K}Async`]: () => void };\n';
    exports["./plugin-sdk/future-computed"] = { types: "./dist/plugin-sdk/future-computed.d.ts" };
  }
  return snapshot(files, exports);
}

const futureNames = ["existingAsync", "mergedFutureAsync", "createFutureRuntime", "openAsync", "appendMessageAsync", "listLinksAsync", "linkAsync",
  "statusAsync", "selectV1", "cancelAsync", "recordTurnAsync", "readAsync", "writeBack", "selectAsync", "resolveConfigAsync", "defaultOpenAsync",
  "futureNamespace", "unlinkAsync", "personalStatusAsync", "neverAsync"];

test("future entrypoints, typeof, globals, merging, defaults and literal conditionals are certified like the type check", () => {
  const result = assertCertified(futureSnapshot(), futureNames, {
    available: ["existingAsync", "mergedFutureAsync", "createFutureRuntime", "openAsync", "statusAsync", "cancelAsync", "recordTurnAsync",
      "selectAsync", "resolveConfigAsync", "defaultOpenAsync", "futureNamespace"],
    unavailable: ["readAsync", "writeBack", "unlinkAsync", "personalStatusAsync", "neverAsync"],
  });
  // Instance members of a class reached only as a value (typeof exposes statics;
  // `prototype` has no declaration) and the untaken branch of a conditional are
  // not public, but are spelled in reached statements: the type check decides.
  assert.deepEqual([...result.undecided].sort(), ["appendMessageAsync", "linkAsync", "listLinksAsync", "selectV1"]);
});

test("names a future release computes from finite template keys are certified exactly", () => {
  const result = assertCertified(futureSnapshot({ computedNames: true }), futureNames);
  assert.ok(result.available.has("unlinkAsync") && result.available.has("personalStatusAsync"));
});

test("retirement qualification of a future release equals the full type check, with or without the fallback", async () => {
  const { retirementRecordsForPackedTarget } = await import("../src/registry-deprecations.js");
  for (const computedNames of [false, true]) {
    const input = futureSnapshot({ computedNames });
    const records = futureNames.map((name) => ({ code: `record-${name}`, status: "deprecated", replacementExports: [name] }));
    records.push({ code: "pair", status: "deprecated", replacementExports: ["linkAsync", "unlinkAsync"] });
    const truth = publicSdkSurfaceNames(input.declarations, input.packageJson, input.packageRoot, { reduce: false });
    const expected = records.filter((record) => record.replacementExports.every((name) => truth.has(name)));
    assert.deepEqual(await retirementRecordsForPackedTarget(records, input), expected, `computedNames=${computedNames}`);
  }
});
