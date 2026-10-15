import path from "node:path";
import ts from "typescript";

function publicTypePaths(targetRoot) {
  if (!targetRoot) return undefined;
  const paths = { "openclaw/plugin-sdk": [path.join(targetRoot, "src/plugin-sdk/index.ts")], "openclaw/plugin-sdk/*": [path.join(targetRoot, "src/plugin-sdk/*.ts")] };
  const packageText = ts.sys.readFile(path.join(targetRoot, "package.json"));
  if (!packageText) return paths;
  let metadata;
  try { metadata = JSON.parse(packageText); } catch { return paths; }
  function typeCondition(value) {
    if (!value || typeof value !== "object") return undefined;
    if (typeof value.types === "string") return value.types;
    for (const nested of Object.values(value)) { const found = typeCondition(nested); if (found) return found; }
  }
  for (const [key, value] of Object.entries(metadata.exports ?? {})) {
    if (key !== "./plugin-sdk" && !key.startsWith("./plugin-sdk/")) continue;
    const types = typeCondition(value);
    if (!types) continue;
    const resolved = path.resolve(targetRoot, types);
    if (path.relative(targetRoot, resolved).startsWith("..") || !ts.sys.fileExists(resolved)) continue;
    paths[`openclaw/${key.slice(2)}`] = [resolved];
  }
  return paths;
}

/** Resolve inspected files and the explicit host; never crawl installed dependencies. */
export function createUsageProgram(files, targetRoot) {
  const sources = files.filter((file) => !file.metadata).map((file) => ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true));
  const byPath = new Map(sources.map((source) => [source.fileName, source]));
  function insideTarget(file) {
    if (!targetRoot) return false;
    const relative = path.relative(targetRoot, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && !relative.split(path.sep).includes("node_modules");
  }
  const options = {
    allowJs: true, lib: ["lib.es2023.d.ts"], noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...(targetRoot ? { paths: publicTypePaths(targetRoot) } : {}),
  };
  const host = ts.createCompilerHost(options);
  const realpath = host.realpath?.bind(host);
  host.realpath = (name) => byPath.has(name) ? name : realpath?.(name) ?? name;
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion) => byPath.get(name) ?? readSource(name, languageVersion);
  host.resolveModuleNames = (names, containingFile) => names.map((name) => {
    const resolved = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
    if (!resolved) return undefined;
    if (byPath.has(resolved.resolvedFileName)) return resolved;
    // Only the explicit public host target may add files outside the inspected
    // set. A plugin-relative import must not crawl neighboring source trees.
    if (!insideTarget(resolved.resolvedFileName)) return undefined;
    if (name === "openclaw/plugin-sdk" || name.startsWith("openclaw/plugin-sdk/") || name.startsWith(".") && insideTarget(containingFile)) return resolved;
    return undefined;
  });
  host.writeFile = () => {};
  const program = ts.createProgram(sources.map((source) => source.fileName), options, host);
  const checker = program.getTypeChecker();
  function localSource(specifier, from) {
    const resolved = host.resolveModuleNames([specifier], from.fileName)[0];
    return resolved && program.getSourceFile(resolved.resolvedFileName);
  }
  return { sources, checker, program, localSource, targetRoot };
}
