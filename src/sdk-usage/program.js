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

// A single inferred export can prevent declaration emit for an otherwise typed
// facade. Keep inferred code, but avoid crawling imports used only by typed bodies.
function withoutTypedImplementations(text, fileName, canDropImport) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) return text;
  const edits = [];
  const used = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
    if (ts.isIdentifier(node)) used.add(node.text);
    const body = ts.isFunctionLike(node) && node.type && node.body;
    if (body) {
      edits.push({ start: body.getStart(source), end: body.end,
        text: ts.isBlock(body) ? "{ throw null; }" : "(null as never)" });
    }
    ts.forEachChild(node, (child) => { if (child !== body) visit(child); });
  }
  visit(source);
  if (!edits.length) return text;
  for (const statement of source.statements) {
    let names;
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      const bindings = clause.namedBindings;
      names = [clause.name, ...(bindings
        ? ts.isNamespaceImport(bindings) ? [bindings.name] : bindings.elements.map((item) => item.name)
        : [])].filter(Boolean);
    } else if (ts.isImportEqualsDeclaration(statement)) names = [statement.name];
    const specifier = ts.isImportDeclaration(statement) ? statement.moduleSpecifier
      : ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)
        ? statement.moduleReference.expression : undefined;
    if (names?.length && names.every((name) => !used.has(name.text)) &&
        specifier && ts.isStringLiteralLike(specifier) && canDropImport(specifier.text)) {
      edits.push({ start: statement.getStart(source), end: statement.end, text: "" });
    }
  }
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}

/** Resolve inspected files and the explicit host; never crawl installed dependencies. */
export function createUsageProgram(files, targetRoot, hostCache) {
  const sources = files.filter((file) => !file.metadata).map((file) => ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true));
  const byPath = new Map(sources.map((source) => [source.fileName, source]));
  function insideTarget(file) {
    if (!targetRoot) return false;
    const relative = path.relative(targetRoot, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && !relative.split(path.sep).includes("node_modules");
  }
  const options = {
    allowJs: true, lib: ["lib.es2023.d.ts"], types: [], noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...(targetRoot ? { paths: publicTypePaths(targetRoot) } : {}),
  };
  const host = ts.createCompilerHost(options);
  const resolutionCache = hostCache?.resolutionCache ?? ts.createModuleResolutionCache(process.cwd(), host.getCanonicalFileName, options);
  if (hostCache) hostCache.resolutionCache = resolutionCache;
  const realpath = host.realpath?.bind(host);
  host.realpath = (name) => byPath.has(name) ? name : realpath?.(name) ?? name;
  const readSource = host.getSourceFile.bind(host);
  const declarationEffects = hostCache?.declarationEffects ?? new Map();
  if (hostCache) hostCache.declarationEffects = declarationEffects;
  const effectDecisions = new Map();
  function canDropImport(specifier, from) {
    const resolve = (name, containing) => {
      const resolved = ts.resolveModuleName(name, containing, options, host, resolutionCache).resolvedModule?.resolvedFileName;
      return resolved && insideTarget(resolved) ? resolved : null;
    };
    const root = resolve(specifier, from);
    if (!root) return true;
    const pending = [root];
    const seen = new Set();
    while (pending.length) {
      const name = pending.pop();
      if (seen.has(name) || effectDecisions.get(name) === false) continue;
      if (effectDecisions.get(name) === true) return false;
      seen.add(name);
      let facts = declarationEffects.get(name);
      if (!facts) {
        const raw = host.readFile(name);
        if (raw === undefined) return false;
        const syntax = ts.createSourceFile(name, raw, options.target, true);
        let effects = !ts.isExternalModule(syntax) || /\.[cm]?jsx?$/.test(name) || syntax.referencedFiles.length > 0 ||
          syntax.typeReferenceDirectives.length > 0 || syntax.libReferenceDirectives.length > 0 ||
          syntax.hasNoDefaultLib || syntax.parseDiagnostics.length > 0;
        function visit(node) {
          if (ts.isModuleDeclaration(node) || ts.isNamespaceExportDeclaration(node)) effects = true;
          else ts.forEachChild(node, visit);
        }
        visit(syntax);
        facts = { effects, imports: ts.preProcessFile(raw, true, true).importedFiles.map((entry) => entry.fileName) };
        declarationEffects.set(name, facts);
      }
      if (facts.effects) { effectDecisions.set(root, true); return false; }
      for (const dependency of facts.imports) {
        const resolved = resolve(dependency, name);
        if (resolved) pending.push(resolved);
      }
    }
    for (const name of seen) effectDecisions.set(name, false);
    return true;
  }
  const hostFiles = new Set();
  const libraryDirectory = path.dirname(ts.getDefaultLibFilePath(options));
  host.getSourceFile = (name, languageVersion) => {
    if (byPath.has(name)) return byPath.get(name);
    const library = path.dirname(name) === libraryDirectory && /^lib(?:\..+)?\.d\.ts$/.test(path.basename(name));
    if (!library && !hostFiles.has(name)) return undefined;
    const cached = hostCache?.sources.get(name);
    const cachedSource = cached?.source?.deref();
    let source = cachedSource;
    if (!source && cached) {
      source = ts.createSourceFile(name, cached.text, languageVersion, true);
      source.isDeclarationFile = cached.isDeclarationFile;
    }
    if (!source && hostFiles.has(name) && /\.[cm]?tsx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name)) {
      const text = host.readFile(name);
      // Declaration emit may drop reference directives without diagnostics.
      // Retain those sources so referenced host types keep their authorization.
      if (text !== undefined && !/\/\/\/\s*<reference\b/.test(text)) {
        // Host implementation bodies can pull the entire core into the type
        // graph. Keep its declaration view only when TypeScript can preserve
        // exported types without inference; otherwise retain the source intact.
        const declaration = ts.transpileDeclaration(text, {
          fileName: name, reportDiagnostics: true,
          compilerOptions: { target: options.target, module: options.module, isolatedDeclarations: true },
        });
        if (!declaration.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
          source = ts.createSourceFile(name, declaration.outputText, languageVersion, true);
          source.isDeclarationFile = true;
        } else {
          source = ts.createSourceFile(name, withoutTypedImplementations(text, name,
            (specifier) => canDropImport(specifier, name)), languageVersion, true);
        }
      }
    }
    source ??= readSource(name, languageVersion);
    // Reuse host syntax while it remains live, but let memory pressure collect
    // unused trees. The current program keeps its own input trees alive.
    if (source && hostCache && !cachedSource) hostCache.sources.set(name, { text: source.text, isDeclarationFile: source.isDeclarationFile, source: new WeakRef(source) });
    // Public host declarations may reference their own declaration files.
    // Plugin reference directives never authorize files outside the input set.
    if (source && hostFiles.has(name)) for (const reference of source.referencedFiles) {
      const referenced = path.resolve(path.dirname(name), reference.fileName);
      // Compiler-host requests use TypeScript's forward-slash filenames.
      if (insideTarget(referenced)) hostFiles.add(referenced.split(path.sep).join("/"));
    }
    return source;
  };
  host.resolveModuleNames = (names, containingFile) => names.map((name) => {
    const resolved = ts.resolveModuleName(name, containingFile, options, host, resolutionCache).resolvedModule;
    if (!resolved) return undefined;
    // TypeScript redirects equal package IDs to one copy, leaving other input
    // ASTs unbound. Inventory every physical bundled file with its own evidence.
    if (byPath.has(resolved.resolvedFileName)) return { ...resolved, packageId: undefined };
    // Only the explicit public host target may add files outside the inspected
    // set. A plugin-relative import must not crawl neighboring source trees.
    if (!insideTarget(resolved.resolvedFileName)) return undefined;
    if (name === "openclaw/plugin-sdk" || name.startsWith("openclaw/plugin-sdk/") || name.startsWith(".") && !byPath.has(containingFile) && insideTarget(containingFile)) {
      hostFiles.add(resolved.resolvedFileName);
      return resolved;
    }
    return undefined;
  });
  host.writeFile = () => {};
  // Share immutable host inputs, not the previous plugin's program/checker.
  // Retaining that graph overlaps two large published artifacts in memory.
  const program = ts.createProgram(sources.map((source) => source.fileName), options, host);
  const checker = program.getTypeChecker();
  function localSource(specifier, from) {
    const resolved = host.resolveModuleNames([specifier], from.fileName)[0];
    return resolved && program.getSourceFile(resolved.resolvedFileName);
  }
  return { sources, checker, program, localSource, targetRoot };
}
