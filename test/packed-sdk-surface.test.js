import assert from "node:assert/strict";
import test from "node:test";
import { publicSdkSurfaceNames } from "../src/packed-sdk-surface.js";
import {
  availableReplacementNames,
  packedSdkSnapshotDigest,
  PACKED_SDK_QUALIFICATION_ALGORITHM,
  replacementNames,
} from "../src/registry-deprecations.js";
import qualifications from "../src/packed-sdk-qualifications.json" with { type: "json" };
import sdkRetirements from "../src/sdk-retirements.json" with { type: "json" };

const packageRoot = "/openclaw";

function snapshot(files, exports = { "./plugin-sdk": "./dist/plugin-sdk/index.js" }) {
  return {
    packageRoot,
    packageJson: { name: "openclaw", exports },
    declarations: Object.entries(files).map(([name, source]) => ({ filePath: `${packageRoot}/${name}`, source })),
  };
}

function names(input, reduce) {
  return [...publicSdkSurfaceNames(input.declarations, input.packageJson, input.packageRoot, { reduce })]
    .filter((name) => !name.startsWith("__@"))
    .sort();
}

// The reduced snapshot must give the type checker exactly the public names the
// full snapshot gives it (the 0.4.4/0.4.5 computation).
function assertSameSurface(input, { includes = [], excludes = [] } = {}) {
  const full = names(input, false);
  assert.deepEqual(names(input, true), full);
  for (const name of includes) assert.ok(full.includes(name), `expected ${name} in the public surface`);
  for (const name of excludes) assert.ok(!full.includes(name), `expected ${name} outside the public surface`);
  return full;
}

test("reduced declarations keep re-exports, stars, namespaces, defaults and merged declarations", () => {
  assertSameSurface(snapshot({
    "dist/plugin-sdk/index.d.ts": [
      'import { H as Hidden } from "../chunk-a.js";',
      'export { a as publicFunction, B as PublicInterface } from "../chunk-a.js";',
      'export * from "../chunk-b.js";',
      'export * as grouped from "../chunk-c.js";',
      'export type { T as PublicType } from "../chunk-d.js";',
      'export { default as defaulted } from "../chunk-e.js";',
      'import * as whole from "../chunk-f.js";',
      "export declare const wholeModule: typeof whole;",
      'export declare function typed(): import("../chunk-g.js").Imported;',
      "export declare function make(): Hidden;",
      "",
    ].join("\n"),
    "dist/chunk-a.d.ts": [
      "declare function x(): Viaduct;",
      "interface Viaduct { viaReturn: Deep; }",
      "interface Deep { deepMember(): Leaf; }",
      "type Leaf = { leafMember: 1 } | { otherLeaf: 2 };",
      "interface Y { instanceMember: string; }",
      "interface Y { mergedMember: string; }",
      "interface H { hiddenReachable: Box<{ boxedMember: number }>; }",
      "interface Box<T> { value: T; }",
      "interface Unused { unusedMember: string; }",
      "declare class Manager { static openAsync(): Manager; appendAsync(): void; }",
      "export { x as a, Y as B, H, Unused as U, Manager as M };",
      "",
    ].join("\n"),
    "dist/chunk-b.d.ts": [
      'export * from "./chunk-b2.js";',
      "export interface StarExported { starMember: string; }",
      "",
    ].join("\n"),
    "dist/chunk-b2.d.ts": "export declare const nested: { nestedStarMember: 1 };\nexport default interface NotStarred { notReExported: 1 }\n",
    "dist/chunk-c.d.ts": "export declare function namespaced(): { namespacedMember: 1 };\nexport interface OnlyInNamespace { namespaceTypeMember: 1 }\n",
    "dist/chunk-d.d.ts": "type T = { typeOnlyMember: 1 };\nexport { T };\n",
    "dist/chunk-e.d.ts": "declare const value: { defaultMember: 1 };\nexport default value;\n",
    "dist/chunk-f.d.ts": "export declare const f1: { moduleObjectMember: 1 };\nexport interface F2 { notAValue: 1 }\n",
    "dist/chunk-g.d.ts": "export interface Imported { importTypeMember: 1 }\nexport interface Sibling { siblingMember: 1 }\n",
  }), {
    includes: ["publicFunction", "viaReturn", "deepMember", "leafMember", "otherLeaf", "mergedMember", "boxedMember",
      "nestedStarMember", "namespacedMember", "typeOnlyMember", "defaultMember", "moduleObjectMember", "importTypeMember", "hiddenReachable"],
    excludes: ["unusedMember", "siblingMember", "notReExported"],
  });
});

test("type arguments of unresolvable references are erased only when no declaration could give them meaning", () => {
  // Without lib files or dependencies, Promise<...> and z.Zod*<...> are error types.
  assertSameSurface(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { S, api, Unwrap, ns_exports, Shadow } from "../chunk.js";\n',
    "dist/chunk.d.ts": [
      'import { z } from "zod";',
      'import type { Missing } from "./missing.js";',
      "declare const S: z.ZodObject<{ zodOnlyMember: z.ZodString }>;",
      "interface Api { load(): Promise<{ promiseOnlyMember: 1 }>; wrapped: Wrapper<{ wrappedMember: 1 }>; missing: Missing<{ missingMember: 1 }>; }",
      "declare const api: Api;",
      "interface Wrapper<T> { inner: T; }",
      "type Unwrap<T> = T extends Wrapper<infer U> ? U : Pick<T, never>;",
      "declare const unwrapped: Unwrap<Wrapper<{ inferredMember: 1 }>>;",
      "type Shadow<Promise> = { shadowed: Promise };",
      "declare namespace ns_exports { export { api as namespacedApi }; }",
      "declare namespace Merged { interface Inner { inNamespace: Promise<{ namespacePromiseMember: 1 }>; } }",
      "export { S, api, Unwrap, ns_exports, Shadow, unwrapped, Merged };",
      "",
    ].join("\n"),
  }), { includes: ["load", "wrappedMember", "inner"], excludes: ["promiseOnlyMember", "zodOnlyMember"] });
});

test("global or ambient declarations of an otherwise missing name keep its type arguments", () => {
  for (const extra of [
    // A global augmentation gives Promise members.
    { "dist/globals.d.ts": "export {};\ndeclare global { interface Promise<T> { then: T; } }\n" },
    // A global script does the same without an augmentation block.
    { "dist/script.d.ts": "interface Promise<T> { then: T; }\n" },
    // An ambient module makes "zod" resolve.
    { "dist/zod.d.ts": 'export {};\ndeclare module "zod" { export namespace z { interface ZodObject<T> { shape: T; } type ZodString = { zodString: 1 }; } }\n' },
    // A UMD global is visible to modules too.
    { "dist/umd.d.ts": "export interface Box<T> { boxed: T; }\nexport as namespace Promise;\n" },
  ]) {
    assertSameSurface(snapshot({
      "dist/plugin-sdk/index.d.ts": 'export { api, S } from "../chunk.js";\n',
      "dist/chunk.d.ts": [
        'import { z } from "zod";',
        "interface Api { load(): Promise<{ promiseMember: 1 }>; }",
        "declare const api: Api;",
        "declare const S: z.ZodObject<{ zodMember: z.ZodString }>;",
        "export { api, S };",
        "",
      ].join("\n"),
      ...extra,
    }));
  }
});

test("large declaration chunks are summarized in pieces with the same statement boundaries", () => {
  const statements = [];
  for (let index = 0; index < 1500; index += 1) {
    statements.push(
      `/** Doc ${index} with { braces } and \`ticks\` */`,
      `interface I${index} { member${index}: \`k${index}-\${string}-\${Wrapper<{ templated${index}: 1 }>}\`; next(): I${index + 1}; }`,
      `type A${index} = { [K in "mapped${index}"]: Promise<{ erased${index}: 1 }> } & { literal${index}: "}" }`,
      `declare function f${index}(callback: (value: { parameter${index}: 1 }) => void): { returned${index}: 1 };`,
    );
  }
  statements.push("interface I1500 { last: 1 }", "interface Wrapper<T> { inner: T }");
  statements.push(`export { ${Array.from({ length: 1500 }, (_, index) => `I${index} as E${index}, A${index} as T${index}, f${index} as g${index}`).join(", ")} };`);
  const chunk = statements.join("\n");
  assert.ok(chunk.length > 256 * 1024);
  const surface = assertSameSurface(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { E0, T7, g9 } from "../chunk.js";\n',
    "dist/chunk.d.ts": chunk,
  }), { includes: ["member0", "member1499", "last", "mapped7", "literal7", "returned9"], excludes: ["erased7", "parameter9", "member0x"] });
  assert.ok(surface.length > 1500);
});

test("files that do not parse are kept whole", () => {
  assertSameSurface(snapshot({
    "dist/plugin-sdk/index.d.ts": 'export { api } from "../chunk.js";\n',
    "dist/chunk.d.ts": "interface Api { ok: Promise<{ promiseMember: 1 }>; broken: { ; }\ndeclare const api: Api;\nexport { api };\n",
  }));
});

test("snapshot digests identify package-relative declaration text and the SDK export map", () => {
  const input = snapshot({ "dist/a.d.ts": "export {};\n", "dist/b.d.ts": "export {};\n" });
  const digest = packedSdkSnapshotDigest(input);
  assert.equal(packedSdkSnapshotDigest({ ...input, declarations: [...input.declarations].reverse() }), digest);
  assert.equal(packedSdkSnapshotDigest({
    ...input,
    packageRoot: "/elsewhere",
    declarations: input.declarations.map((item) => ({ ...item, filePath: item.filePath.replace(packageRoot, "/elsewhere") })),
  }), digest);
  assert.notEqual(packedSdkSnapshotDigest({ ...input, declarations: [{ ...input.declarations[0], source: "export {}; " }, input.declarations[1]] }), digest);
  assert.notEqual(packedSdkSnapshotDigest({ ...input, packageJson: { exports: { "./plugin-sdk/x": "./dist/a.js" } } }), digest);
  // Only the SDK export map matters.
  assert.equal(packedSdkSnapshotDigest({ ...input, packageJson: { ...input.packageJson, version: "9", exports: { ...input.packageJson.exports, "./cli": "./x.js" } } }), digest);
});

test("unknown snapshots are type-checked on demand", async () => {
  const records = [
    { code: "kept", replacementExports: ["fresh"] },
    { code: "dropped", replacementExports: ["fresh", "absent"] },
  ];
  const input = snapshot({ "dist/plugin-sdk/index.d.ts": "export declare function fresh(): void;\n" });
  assert.deepEqual([...await availableReplacementNames(records, input)], ["fresh"]);
  assert.deepEqual([...await availableReplacementNames([{ code: "none" }], input)], []);
});

test("the shipped qualification table answers for the pinned retirement inventory", () => {
  assert.equal(qualifications.algorithm, PACKED_SDK_QUALIFICATION_ALGORITHM);
  assert.deepEqual(qualifications.checkedNames, replacementNames(sdkRetirements.records),
    "src/sdk-retirements.json changed: rerun node scripts/packed-sdk-qualifications.mjs --write");
  const checked = new Set(qualifications.checkedNames);
  for (const target of qualifications.targets) {
    assert.match(target.snapshotSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(target.available, [...target.available].sort());
    for (const name of target.available) assert.ok(checked.has(name), `${target.version}: ${name}`);
  }
});
