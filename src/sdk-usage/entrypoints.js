import path from "node:path";

/** Declared plugin entrypoints receive the host API, even when they have no SDK imports. */
export function pluginEntrypointSources({ root, files, sources, inputKind }) {
  const metadata = files.find((file) => file.path === path.join(root, "package.json"));
  if (!metadata) return [];
  let pkg;
  try { pkg = JSON.parse(metadata.text); } catch { return []; }
  const entries = pkg.openclaw?.extensions;
  if (!Array.isArray(entries)) return [];
  const byPath = new Map(sources.map((source) => [source.fileName, source]));
  const found = new Set();
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const resolved = path.resolve(root, entry);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    let candidates = [resolved];
    if (inputKind === "source") {
      const stem = relative.replace(/^(?:dist|build)[/\\]/, "").replace(/\.[cm]?jsx?$/, "");
      candidates.push(...[".ts", ".mts", ".cts", ".tsx"].flatMap((extension) => [path.join(root, stem + extension), path.join(root, "src", stem + extension)]));
    }
    candidates = [...new Set(candidates)].filter((file) => byPath.has(file));
    if (byPath.has(resolved)) found.add(byPath.get(resolved));
    else if (candidates.length === 1) found.add(byPath.get(candidates[0]));
  }
  return [...found];
}
