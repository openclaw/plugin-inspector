#!/usr/bin/env node
// Builds a synthetic "future" OpenClaw package from a real packed one: the same
// declarations plus a new ./plugin-sdk entrypoint and new chunks that expose
// SDK retirement replacements the source release does not, through the
// declaration shapes a later release could use. Retirement qualification of
// the result must match the full type check (0.4.5 computes it), and the
// publish path must stay within its memory budget without any per-release data.
//
//   node scripts/make-future-openclaw-fixture.mjs --from <unpacked openclaw package> --out <dir> [--computed-names] [--undecidable]
//
// --computed-names adds a mapped type whose keys come from a template literal
// over a finite union, so replacement names are computed rather than spelled
// (certified exactly by enumerating the template).
// --undecidable adds a conditional type over object types: deciding it needs
// TypeScript's assignability, so certificates leave its names to the exact
// type-checked fallback.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { from: { type: "string" }, out: { type: "string" }, "computed-names": { type: "boolean" }, undecidable: { type: "boolean" } },
});
if (!values.from || !values.out) {
  console.error("Usage: node scripts/make-future-openclaw-fixture.mjs --from <unpacked openclaw package> --out <dir> [--computed-names]");
  process.exit(2);
}
const from = path.resolve(values.from);
const out = path.resolve(values.out);
await mkdir(out, { recursive: true });
await cp(from, out, { recursive: true });
const packageJson = JSON.parse(await readFile(path.join(out, "package.json"), "utf8"));
packageJson.version = `${packageJson.version.replace(/-.*$/, "")}-future.1`;

const files = {
  // A rolled-up chunk in the style of the real ones: minified export aliases.
  "dist/future-sessions-Fz9.d.ts": `import { t as FutureLinkStore } from "./future-links-Ab1.js";
//#region src/sessions/future-session-manager.d.ts
/** A session manager whose persistence is asynchronous. */
declare class SessionManager {
  static openAsync(sessionKey: string): Promise<SessionManager>;
  appendMessageAsync(message: unknown): Promise<void>;
  persistAsync(): Promise<void>;
  get links(): FutureLinkStore;
}
interface FutureWorkspaceGrant {
  acquireManagedWorkspaceAsync(owner: string): Promise<{ assertCurrentAsync(): Promise<void>; release(): void }>;
}
type FutureVersioned<Version extends 1 | 2 = 1> = Version extends 2 ? { statusAsync(): Promise<string> } : { selectV1(): void };
type FutureBox<T> = { value: T; cancelAsync(): Promise<void> };
declare const { readAsync, writeBack }: { readAsync: () => Promise<FutureRecorder>; writeBack: () => void };
interface FutureRecorder { recordTurnAsync(): Promise<void> }
declare enum FutureMode { selectAsync = "selectAsync" }
//#endregion
export { SessionManager as a, FutureWorkspaceGrant as i, FutureVersioned as n, FutureBox as o, readAsync as r, FutureMode as s, writeBack as u };
`,
  "dist/future-links-Ab1.d.ts": `//#region src/sessions/future-links.d.ts
interface FutureLinkStore {
  listLinksAsync(): Promise<string[]>;
  linkAsync(id: string): Promise<void>;
  unlinkAsync(id: string): Promise<void>;
}
//#endregion
export { FutureLinkStore as t };
`,
  // An entry with no export declarations: every declaration is exported.
  "dist/plugin-sdk/future-runtime.d.ts": `import { a as SessionManager, i as FutureWorkspaceGrant, n as FutureVersioned, o as FutureBox, r as readAsync, s as FutureMode } from "../future-sessions-Fz9.js";
type FutureRuntime = {
  sessions: typeof SessionManager;
  workspace: FutureWorkspaceGrant;
  versioned: FutureVersioned<2>;
  boxed: FutureBox<string>;
  read: typeof readAsync;
  mode: typeof FutureMode;
};
declare function createFutureRuntime(): FutureRuntime;
declare global {
  interface FutureGlobalHook { resolveConfigAsync(): Promise<unknown> }
}
export declare const futureHook: FutureGlobalHook;
`,
  "dist/plugin-sdk/future-default.d.ts": `declare const runtime: { openAsync(): Promise<void> };
export default runtime;
export { a as SessionManager } from "../future-sessions-Fz9.js";
`,
};
if (values["computed-names"]) {
  files["dist/plugin-sdk/future-computed.d.ts"] = `type Verbs = "unlink" | "personalStatus";
export type FutureComputed = { [K in Verbs as \`\${K}Async\`]: () => Promise<void> };
`;
  packageJson.exports["./plugin-sdk/future-computed"] = { types: "./dist/plugin-sdk/future-computed.d.ts", default: "./dist/plugin-sdk/future-computed.js" };
}
if (values.undecidable) {
  files["dist/plugin-sdk/future-conditional.d.ts"] = `type Narrow<T, Kind> = T extends { kind: Kind } ? { disconnectAsync(): Promise<void> } : { retireProfileAsync(): Promise<void> };
export type FutureConditional = Narrow<{ kind: "session"; id: string }, "session">;
`;
  packageJson.exports["./plugin-sdk/future-conditional"] = { types: "./dist/plugin-sdk/future-conditional.d.ts", default: "./dist/plugin-sdk/future-conditional.js" };
}
for (const [name, source] of Object.entries(files)) await writeFile(path.join(out, name), source);
packageJson.exports["./plugin-sdk/future-runtime"] = { types: "./dist/plugin-sdk/future-runtime.d.ts", default: "./dist/plugin-sdk/future-runtime.js" };
packageJson.exports["./plugin-sdk/future-default"] = { types: "./dist/plugin-sdk/future-default.d.ts", default: "./dist/plugin-sdk/future-default.js" };
await writeFile(path.join(out, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`${out}: openclaw@${packageJson.version}`);
