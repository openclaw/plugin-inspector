import path from "node:path";
import ts from "typescript";

/** Declared plugin entrypoints receive the host API, even when they have no SDK imports. */
export function pluginEntrypointSources({ root, files, sources, inputKind, report }) {
  const metadata = files.find((file) => file.path === path.join(root, "package.json"));
  if (!metadata) return [];
  let pkg;
  const source = ts.createSourceFile(metadata.path, metadata.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
  const unresolved = (reason) => report.unknown(source, reason);
  try { pkg = JSON.parse(metadata.text); } catch { unresolved("Package metadata could not be parsed"); return []; }
  // Published packages may omit their TypeScript source entries. The runtime
  // peer is authoritative when declared; a missing peer must remain unresolved.
  const field = inputKind === "artifact" && pkg.openclaw?.runtimeExtensions !== undefined
    ? "runtimeExtensions" : "extensions";
  const entries = pkg.openclaw?.[field];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    unresolved(`Declared plugin ${field} must be an array`);
    return [];
  }
  if (field === "runtimeExtensions" && Array.isArray(pkg.openclaw.extensions) && entries.length !== pkg.openclaw.extensions.length) {
    unresolved("Declared runtime entrypoints do not match the source entrypoint count");
  }
  const byPath = new Map(sources.map((source) => [source.fileName, source]));
  const found = new Set();
  for (const entry of entries) {
    if (typeof entry !== "string") { unresolved("Declared plugin entrypoint is not a string"); continue; }
    const resolved = path.resolve(root, entry);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { unresolved("Declared plugin entrypoint is outside the inspected root"); continue; }
    let candidates = [resolved];
    if (inputKind === "source") {
      const stem = relative.replace(/^(?:dist|build)[/\\]/, "").replace(/\.[cm]?jsx?$/, "");
      candidates.push(...[".ts", ".mts", ".cts", ".tsx"].flatMap((extension) => [path.join(root, stem + extension), path.join(root, "src", stem + extension)]));
    }
    candidates = [...new Set(candidates)].filter((file) => byPath.has(file));
    if (byPath.has(resolved)) found.add(byPath.get(resolved));
    else if (candidates.length === 1) found.add(byPath.get(candidates[0]));
    else unresolved(`Declared plugin entrypoint could not be resolved uniquely: ${entry}`);
  }
  return [...found];
}
