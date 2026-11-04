import path from "node:path";
import { reduceDeclarationsToPublicClosure } from "./declaration-closure.js";
import ts from "./typescript.cjs";

// Names a packed OpenClaw package exposes through its public SDK declarations:
// every export of a ./plugin-sdk entrypoint, plus every member name of the types
// those exports reach. Loaded on demand; importing this module loads TypeScript.
//
// `reduce: false` type-checks the full declaration snapshot exactly as 0.4.4
// and 0.4.5 did. The default first reduces the snapshot to the declarations the
// checker can reach (declaration-closure.js), which yields the same names for
// roughly half the syntax trees.
export function publicSdkSurfaceNames(declarations, packageJson, packageRoot, { reduce = true } = {}) {
  const normalize = (file) => path.resolve(file).split(path.sep).join("/");
  const options = { noLib: true, noEmit: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  let sources = new Map();
  let entryFiles;
  if (reduce) {
    const texts = new Map(declarations.map(({ filePath, source }) => [normalize(filePath), source ?? ""]));
    entryFiles = publicSdkDeclarations(packageJson, packageRoot, texts);
    // Resolve exactly as the program below does: only the declaration snapshot exists.
    const resolutionHost = { fileExists: (file) => texts.has(normalize(file)), readFile: (file) => texts.get(normalize(file)) };
    const resolutionCache = ts.createModuleResolutionCache(normalize(packageRoot || "."), normalize, options);
    const resolveModule = (specifier, containingFile) => {
      const resolved = ts.resolveModuleName(specifier, containingFile, options, resolutionHost, resolutionCache).resolvedModule;
      return resolved && normalize(resolved.resolvedFileName);
    };
    for (const [name, text] of reduceDeclarationsToPublicClosure({ files: texts, entryFiles, resolveModule })) {
      // TypeScript declaration semantics never read JSDoc; skip building it.
      sources.set(name, ts.createSourceFile(name, text, { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone }, true));
    }
  } else {
    sources = new Map(declarations.map(({ filePath, source }) => {
      const name = normalize(filePath);
      return [name, ts.createSourceFile(name, source ?? "", ts.ScriptTarget.Latest, true)];
    }));
    entryFiles = publicSdkDeclarations(packageJson, packageRoot, sources);
  }
  // Use only the already-read declaration snapshot; resolution must never read
  // installed dependencies or execute the selected package.
  const host = {
    getSourceFile: (file) => sources.get(normalize(file)),
    fileExists: (file) => sources.has(normalize(file)),
    readFile: (file) => sources.get(normalize(file))?.text,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => normalize(packageRoot || "."),
    getDirectories: () => [],
    getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const names = new Set();
  const seen = new Set();
  function collectMembers(type) {
    if (!type || seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) collectMembers(part);
    }
    for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
      collectMembers(checker.getReturnTypeOfSignature(signature));
    }
    for (const member of checker.getPropertiesOfType(type)) {
      names.add(member.name);
      const declaration = member.valueDeclaration ?? member.declarations?.[0];
      if (declaration) collectMembers(checker.getTypeOfSymbolAtLocation(member, declaration));
    }
  }
  for (const file of entryFiles) {
    const source = program.getSourceFile(file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!module || source.parseDiagnostics.length) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (symbol.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Type)) names.add(exported.name);
      if (symbol.flags & ts.SymbolFlags.Type) collectMembers(checker.getDeclaredTypeOfSymbol(symbol));
      if (symbol.flags & ts.SymbolFlags.Value) {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (declaration) collectMembers(checker.getTypeOfSymbolAtLocation(symbol, declaration));
      }
    }
  }
  return names;
}

function publicSdkDeclarations(packageJson, packageRoot, sources) {
  const files = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const resolved = path.resolve(packageRoot, value).split(path.sep).join("/");
      const candidates = /\.d\.[cm]?ts$/.test(resolved) ? [resolved]
        : /\.mjs$/.test(resolved) ? [resolved.replace(/\.mjs$/, ".d.mts"), resolved.replace(/\.mjs$/, ".d.ts")]
        : /\.cjs$/.test(resolved) ? [resolved.replace(/\.cjs$/, ".d.cts"), resolved.replace(/\.cjs$/, ".d.ts")]
        : [resolved.replace(/\.js$/, ".d.ts")];
      const declaration = candidates.find((candidate) => sources.has(candidate));
      if (declaration) files.add(declaration);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const [specifier, value] of Object.entries(packageJson.exports ?? {})) {
    if (specifier === "./plugin-sdk" || specifier.startsWith("./plugin-sdk/")) visit(value);
  }
  return files;
}
