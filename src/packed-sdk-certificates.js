import path from "node:path";
import { splitTopLevelStatements } from "./declaration-closure.js";
import ts from "./typescript.cjs";

// Decides, without building a TypeScript program, whether each queried name is
// one of the public SDK names of a packed OpenClaw snapshot, as defined by
// publicSdkSurfaceNames: an export of a ./plugin-sdk entrypoint, or a property
// of a type the public-surface walk reaches (properties, property types and
// call-signature return types, starting at those exports).
//
// Every answer is a certificate:
// - available: the name is an entry export that resolves to a declaration, or
//   an own member of a type reached through steps whose TypeScript semantics
//   are unambiguous (plain references to interfaces, classes and object types,
//   unions and intersections that cannot collapse to any/never, literal
//   conditionals, destructured bindings with a literal property).
// - unavailable: no text the walk could reach spells the name where a property
//   name can come from (member names, string literals, namespace members,
//   export names), and nothing reachable can compute it (template literal
//   types, intrinsic string types, tuple indices). The over-approximation
//   follows every reference except signature parameter types (never walked),
//   implements clauses, array elements (no lib: arrays have no members) and
//   type arguments of generics that cannot resolve (error types). If a
//   reachable conditional type infers from a parameter position, type
//   arguments and conditional operands are followed with parameters too.
// - undecided: anything else. The caller answers those with the type checker.
//
// Memory stays proportional to one file piece at a time plus compact
// per-statement summaries; statements the positive walk visits are re-parsed
// on their own.
export function certifyPublicSdkNames({ declarations, packageJson = {}, packageRoot = "", names }) {
  const queried = new Set(names);
  const normalize = (file) => path.resolve(file).split(path.sep).join("/");
  const texts = new Map(declarations.map(({ filePath, source }) => [normalize(filePath), source ?? ""]));
  const options = { noLib: true, noEmit: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const resolutionHost = { fileExists: (file) => texts.has(normalize(file)), readFile: (file) => texts.get(normalize(file)) };
  const resolutionCache = ts.createModuleResolutionCache(normalize(packageRoot || "."), normalize, options);
  // Long-lived lookups avoid concatenated string keys (see bindModule).
  const resolvedModules = new Map();
  const resolveModule = (specifier, containingFile) => {
    let byFile = resolvedModules.get(containingFile);
    if (!byFile) resolvedModules.set(containingFile, byFile = new Map());
    if (!byFile.has(specifier)) {
      const resolved = ts.resolveModuleName(specifier, containingFile, options, resolutionHost, resolutionCache).resolvedModule;
      byFile.set(specifier, resolved ? normalize(resolved.resolvedFileName) : undefined);
    }
    return byFile.get(specifier);
  };
  const entries = publicSdkDeclarationFiles(packageJson, packageRoot, texts, normalize);

  if (process.env.PI_MARK) console.error("MARK cert-start");
  ts.createSourceFile("x.ts", "let a", ts.ScriptTarget.Latest);
  if (process.env.PI_MARK) console.error("MARK ts-loaded");
  const environment = { globals: new Map(), ambientModules: new Map(), ambientPattern: false };
  const modules = new Map();
  for (const [fileName, text] of texts) modules.set(fileName, bindModule(fileName, text, environment));
  if (process.env.PI_MARK) console.error("MARK cert-bind");
  const context = { modules, texts, environment, resolveModule, queried, statementNode: statementParser(modules, texts) };

  // A single conservative pass when the snapshot can infer at all, instead of
  // a second pass after finding a conditional that infers from parameters.
  const mayInfer = [...texts.values()].some((text) => /\binfer\s/.test(text));
  const reachable = reachableNameEvidence(context, entries, mayInfer);
  if (process.env.PI_MARK) console.error("MARK cert-negative");
  const unavailable = new Set([...queried].filter((name) => !reachable.mayProduce(name)));
  const candidates = new Set([...queried].filter((name) => !unavailable.has(name)));
  const available = candidates.size ? positiveNames(context, entries, candidates) : new Set();
  if (process.env.PI_MARK) console.error("MARK cert-positive");
  const undecided = new Set([...candidates].filter((name) => !available.has(name)));
  return { available, unavailable, undecided };
}

export function publicSdkDeclarationFiles(packageJson, packageRoot, sources, normalize = (file) => path.resolve(file).split(path.sep).join("/")) {
  const files = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const resolved = normalize(path.resolve(packageRoot, value));
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

const LANGUAGE = { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone };
const ALL = "*";
// Property names TypeScript can create without spelling them.
const SYNTHESIZED = /^(?:\d+|length|prototype)$/;

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function push(map, key, value) {
  (map.get(key) ?? map.set(key, []).get(key)).push(value);
}

// Module tables live through the whole certification, so they are compact:
// single entries are stored directly (arrays only for repeated keys), plain
// declarations are small integers, local exports are their local name, and
// statement spans sit in an off-heap typed array.
function add(map, key, value) {
  const current = map.get(key);
  if (current === undefined) map.set(key, value);
  else if (Array.isArray(current)) current.push(value);
  else map.set(key, [current, value]);
}

function tableEntries(map, key) {
  const value = map.get(key);
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const KINDS = ["alias", "interface", "alias-type", "class", "function", "enum", "namespace", "other", "variable", "binding"];
const EXPRESSION = Object.freeze({ expression: true });

function declarationEntry(value) {
  return typeof value === "number" ? { index: value >> 3, kind: KINDS[value & 7] } : value;
}

function exportEntry(value) {
  return typeof value === "string" ? { local: value } : value;
}

function statementCount(module) {
  return module.count;
}

function statementSpan(module, index) {
  return [module.spans[index * 2], module.spans[index * 2 + 1]];
}

// ---------------------------------------------------------------------------
// Pass 1: module tables (declarations, imports, exports) and the environment.

// Visit every top-level statement, parsing a large file a piece at a time and
// each piece once. If any piece does not parse cleanly, the whole file is
// parsed instead so statement boundaries always match TypeScript's.
function forEachTopLevelStatement(fileName, text, begin, callback) {
  // Small pieces keep each syntax tree short-lived (see statementParser).
  const pieces = splitTopLevelStatements(text, 8 * 1024) ?? [[0, text.length]];
  let state = begin();
  let index = 0;
  let isModule = false;
  for (const [start, end] of pieces) {
    const source = ts.createSourceFile(fileName, text.slice(start, end), LANGUAGE, false);
    if (source.parseDiagnostics.length && pieces.length > 1) {
      state = begin();
      const whole = ts.createSourceFile(fileName, text, LANGUAGE, false);
      for (const [wholeIndex, node] of whole.statements.entries()) callback(state, node, wholeIndex, whole, 0);
      return { state, isModule: ts.isExternalModule(whole), hasParseErrors: whole.parseDiagnostics.length > 0 };
    }
    isModule ||= ts.isExternalModule(source);
    for (const node of source.statements) callback(state, node, index++, source, start);
    if (source.parseDiagnostics.length) return { state, isModule, hasParseErrors: true };
  }
  return { state, isModule, hasParseErrors: false };
}

function bindModule(fileName, text, environment) {
  const environmentEntries = { globals: [], ambientModules: [], ambientPattern: false };
  const { state: module, isModule, hasParseErrors } = forEachTopLevelStatement(fileName, text, () => {
    environmentEntries.globals.length = 0;
    environmentEntries.ambientModules.length = 0;
    environmentEntries.ambientPattern = false;
    return newModule(fileName);
  }, (module, node, index, source, offset) => bindStatement(module, environmentEntries, node, index, source, offset));
  module.isModule = isModule;
  // TypeScript still binds a file with syntax errors, but not predictably.
  module.uncertain ||= hasParseErrors;
  for (const [name, entry] of environmentEntries.globals) push(environment.globals, name, entry);
  for (const [name, entry] of environmentEntries.ambientModules) push(environment.ambientModules, name, entry);
  environment.ambientPattern ||= environmentEntries.ambientPattern;
  if (!module.isModule) {
    for (const name of module.declarations.keys()) for (const { index } of tableEntries(module.declarations, name).map(declarationEntry)) push(environment.globals, name, { fileName, index });
  }
  // An ambient module without export declarations exports every declaration.
  for (const [name, entry] of module.pendingExports) add(module.exports, name, entry);
  if (module.isModule && !module.hasExportDeclarations) {
    for (const name of module.declarations.keys()) if (!module.exports.has(name)) add(module.exports, name, name);
  }
  delete module.pendingExports;
  return module;
}

function newModule(fileName) {
  return {
    fileName,
    isModule: false,
    uncertain: false,
    spans: new Int32Array(64),
    count: 0,
    declarations: new Map(),
    imports: new Map(),
    exports: new Map(),
    stars: [],
    exportEquals: false,
    hasExportDeclarations: false,
    pendingExports: [],
  };
}

function bindStatement(module, environment, node, index, source, offset) {
  const fileName = module.fileName;
  const pendingExports = module.pendingExports;
  {
    if ((index + 1) * 2 > module.spans.length) {
      const grown = new Int32Array(module.spans.length * 2);
      grown.set(module.spans);
      module.spans = grown;
    }
    module.spans[index * 2] = offset + node.getStart(source);
    module.spans[index * 2 + 1] = offset + node.end;
    module.count = index + 1;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
      const from = node.moduleSpecifier.text;
      if (clause.name) module.imports.set(clause.name.text, { from, name: "default", index });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) module.imports.set(bindings.name.text, { from, name: ALL, index });
      else if (bindings) for (const element of bindings.elements) module.imports.set(element.name.text, { from, name: (element.propertyName ?? element.name).text, index });
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) {
        module.imports.set(node.name.text, { from: node.moduleReference.expression.text, name: ALL, index });
      } else {
        add(module.declarations, node.name.text, index * 8);
      }
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) pendingExports.push([node.name.text, node.name.text]);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      module.hasExportDeclarations = true;
      const from = node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (node.moduleSpecifier && from === undefined) {
        module.uncertain = true;
        return;
      }
      if (!node.exportClause) module.stars.push(from);
      else if (ts.isNamespaceExport(node.exportClause)) add(module.exports, node.exportClause.name.text, { from, name: ALL });
      else for (const element of node.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        add(module.exports, element.name.text, from === undefined ? local : { from, name: local });
      }
      return;
    }
    if (ts.isExportAssignment(node)) {
      module.hasExportDeclarations = true;
      if (node.isExportEquals) module.exportEquals = true;
      // `export default name` exports that local binding, like `export { name as default }`.
      else pendingExports.push(["default", ts.isIdentifier(node.expression) ? node.expression.text : EXPRESSION]);
      return;
    }
    if (ts.isModuleDeclaration(node)) {
      if (ts.isStringLiteralLike(node.name)) {
        environment.ambientModules.push([node.name.text, { fileName, index }]);
        if (node.name.text.includes("*")) environment.ambientPattern = true;
        return;
      }
      if (node.flags & ts.NodeFlags.GlobalAugmentation) {
        if (node.body && ts.isModuleBlock(node.body)) for (const inner of node.body.statements) for (const name of declaredNames(inner)) environment.globals.push([name, { fileName, index }]);
        return;
      }
    }
    if (ts.isNamespaceExportDeclaration(node)) {
      environment.globals.push([node.name.text, { fileName, index }]);
      return;
    }
    const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(module.declarations, declaration.name.text, { index, kind: "variable", declarationIndex: node.declarationList.declarations.indexOf(declaration) });
          if (exported) pendingExports.push([declaration.name.text, declaration.name.text]);
          continue;
        }
        const bind = (pattern, top) => {
          for (const element of pattern.elements) {
            if (ts.isOmittedExpression(element)) continue;
            if (!ts.isIdentifier(element.name)) {
              bind(element.name, false);
              continue;
            }
            const property = top && ts.isObjectBindingPattern(pattern) && !element.dotDotDotToken ? (element.propertyName ?? element.name).text : undefined;
            add(module.declarations, element.name.text, { index, kind: "binding", property, declarationIndex: node.declarationList.declarations.indexOf(declaration) });
            if (exported) pendingExports.push([element.name.text, element.name.text]);
          }
        };
        bind(declaration.name, true);
      }
      return;
    }
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (name === undefined) {
      if (isDefault && exported) pendingExports.push(["default", EXPRESSION]);
      return;
    }
    const kind = ts.isInterfaceDeclaration(node) ? "interface" : ts.isTypeAliasDeclaration(node) ? "alias-type"
      : ts.isClassDeclaration(node) ? "class" : ts.isFunctionDeclaration(node) ? "function"
        : ts.isEnumDeclaration(node) ? "enum" : ts.isModuleDeclaration(node) ? "namespace" : "other";
    add(module.declarations, name, index * 8 + KINDS.indexOf(kind));
    if (exported) pendingExports.push([isDefault ? "default" : name, name]);
  }
}

function declaredNames(node) {
  if (ts.isVariableStatement(node)) {
    const names = [];
    const bind = (name) => {
      if (ts.isIdentifier(name)) names.push(name.text);
      else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
    };
    for (const declaration of node.declarationList.declarations) bind(declaration.name);
    return names;
  }
  return node.name && ts.isIdentifier(node.name) ? [node.name.text] : [];
}

// ---------------------------------------------------------------------------
// Statements are re-parsed on their own whenever a walk needs them. Keeping
// parsed statements would let their syntax trees survive young-generation
// collections, which makes V8 grow the young generation (and RSS) far more
// than re-parsing costs.

function statementParser(modules, texts) {
  return (fileName, index) => {
    const [start, end] = statementSpan(modules.get(fileName), index);
    const source = ts.createSourceFile(fileName, texts.get(fileName).slice(start, end), LANGUAGE, false);
    return source.statements.length === 1 && !source.parseDiagnostics.length ? source.statements[0] : null;
  };
}

// Identifiers that name a member rather than refer to a declaration.
function isMemberName(node, parent) {
  return (parent.name === node && (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)
      || ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessor(parent)
      || ts.isSetAccessor(parent) || ts.isEnumMember(parent) || ts.isParameter(parent)
      || ts.isNamedTupleMember(parent) || ts.isPropertyAssignment(parent)))
    || (ts.isBindingElement(parent) && parent.propertyName === node)
    || (ts.isQualifiedName(parent) && parent.right === node)
    || (ts.isPropertyAccessExpression(parent) && parent.name === node);
}

// Identifiers that can become property names.
function producesName(node, parent, inNamespace) {
  if (!parent) return false;
  if (parent.name === node && (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent)
    || ts.isMethodDeclaration(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)
    || ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent))) return true;
  if (ts.isExportSpecifier(parent)) return true;
  // Declarations inside namespaces become members of the namespace object.
  return inNamespace && (parent.name === node || ts.isBindingElement(parent));
}

function locallyDeclaredTypeNames(node) {
  const names = [];
  if (node.typeParameters) for (const parameter of node.typeParameters) names.push(parameter.name.text);
  if (ts.isMappedTypeNode(node)) names.push(node.typeParameter.name.text);
  if (ts.isInferTypeNode(node)) names.push(node.typeParameter.name.text);
  return names;
}

// ---------------------------------------------------------------------------
// Name resolution shared by both certificates.

function resolveLocal(context, fileName, name, seen = new Set()) {
  const key = `${fileName}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const module = context.modules.get(fileName);
  if (!module || module.uncertain) return undefined;
  const declarations = tableEntries(module.declarations, name).map(declarationEntry);
  const imported = module.imports.get(name);
  if (imported) {
    if (declarations.length) return undefined;
    const target = context.resolveModule(imported.from, fileName);
    if (!target) return undefined;
    if (imported.name === ALL) return [{ module: target }];
    return resolveExport(context, target, imported.name, seen);
  }
  return declarations.length ? declarations.map((declaration) => ({ ...declaration, fileName })) : undefined;
}

function resolveExport(context, fileName, name, seen = new Set()) {
  const module = context.modules.get(fileName);
  if (!module || module.uncertain || module.exportEquals) return undefined;
  const direct = module.exports.has(name) ? tableEntries(module.exports, name).map(exportEntry) : undefined;
  if (direct) {
    if (direct.length !== 1 || direct[0].expression) return undefined;
    const entry = direct[0];
    if (entry.local !== undefined) return resolveLocal(context, fileName, entry.local, seen);
    const target = context.resolveModule(entry.from, fileName);
    if (!target) return undefined;
    return entry.name === ALL ? [{ module: target }] : resolveExport(context, target, entry.name, seen);
  }
  if (name === "default") return undefined;
  const found = [];
  for (const from of module.stars) {
    const target = from !== undefined && context.resolveModule(from, fileName);
    if (!target) return undefined;
    if (exportNames(context, target).has(name)) found.push(resolveExport(context, target, name, seen));
  }
  // Absent, or offered by several star exports: no claim.
  return found.length === 1 ? found[0] : undefined;
}

function exportNames(context, fileName, seen = new Set()) {
  context.exportNameCache ??= new Map();
  if (context.exportNameCache.has(fileName)) return context.exportNameCache.get(fileName);
  if (seen.has(fileName)) return new Set();
  seen.add(fileName);
  const module = context.modules.get(fileName);
  const names = new Set(module ? module.exports.keys() : []);
  for (const from of module?.stars ?? []) {
    const target = from !== undefined && context.resolveModule(from, fileName);
    if (target) for (const name of exportNames(context, target, seen)) if (name !== "default") names.add(name);
  }
  context.exportNameCache.set(fileName, names);
  return names;
}

// ---------------------------------------------------------------------------
// The exact set of strings a type denotes, when it is a finite union of
// literals: string, number and boolean literals, unions, template literals
// whose holes are themselves finite, and references to non-generic aliases of
// such types (or to bound mapped-type keys). Anything else is null (unknown).
// TypeScript computes template literal and mapped-type names from exactly
// these sets, so names they produce can be enumerated instead of guessed.
const MAX_FINITE_STRINGS = 4096;

function finiteStrings(context, node, fileName, { bindings = new Map(), unknown = new Set(), keysOnly = false } = {}, depth = 0) {
  if (!node || depth > 16) return null;
  const recurse = (child, file = fileName, options = { bindings, unknown, keysOnly }) => finiteStrings(context, child, file, options, depth + 1);
  switch (node.kind) {
    case ts.SyntaxKind.ParenthesizedType: return recurse(node.type);
    case ts.SyntaxKind.LiteralType: {
      const literal = node.literal;
      if (ts.isStringLiteralLike(literal)) return [literal.text];
      if (ts.isNumericLiteral(literal)) return [String(Number(literal.text))];
      if (ts.isPrefixUnaryExpression(literal) && literal.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(literal.operand)) return [String(-Number(literal.operand.text))];
      if (keysOnly) return null;
      if (literal.kind === ts.SyntaxKind.TrueKeyword) return ["true"];
      if (literal.kind === ts.SyntaxKind.FalseKeyword) return ["false"];
      if (literal.kind === ts.SyntaxKind.NullKeyword) return ["null"];
      return null;
    }
    case ts.SyntaxKind.UnionType: {
      const values = new Set();
      for (const part of node.types) {
        const set = recurse(part);
        if (!set) return null;
        for (const value of set) values.add(value);
        if (values.size > MAX_FINITE_STRINGS) return null;
      }
      return [...values];
    }
    case ts.SyntaxKind.TemplateLiteralType: {
      let values = [node.head.text];
      for (const span of node.templateSpans) {
        // Template holes accept booleans and null as text even where keys may not.
        const set = finiteStrings(context, span.type, fileName, { bindings, unknown, keysOnly: false }, depth + 1);
        if (!set || values.length * set.length > MAX_FINITE_STRINGS) return null;
        values = values.flatMap((prefix) => set.map((value) => `${prefix}${value}${span.literal.text}`));
      }
      return values;
    }
    case ts.SyntaxKind.TypeReference: {
      if (!ts.isIdentifier(node.typeName) || node.typeArguments) return null;
      const name = node.typeName.text;
      if (bindings.has(name)) return bindings.get(name);
      if (unknown.has(name)) return null;
      const resolved = resolveLocal(context, fileName, name);
      if (!resolved || resolved.length !== 1 || resolved[0].kind !== "alias-type") return null;
      const alias = context.statementNode(resolved[0].fileName, resolved[0].index);
      if (!alias || !ts.isTypeAliasDeclaration(alias) || alias.typeParameters) return null;
      return recurse(alias.type, resolved[0].fileName, { bindings: new Map(), unknown: new Set(), keysOnly });
    }
    default: return null;
  }
}

// Property names of `{ [K in C as N]: ... }` when C is a finite set of string
// or number literal keys and N (if present) is finite for each key. A mapped
// type over such keys is not homomorphic and is always an object type.
function mappedTypeNames(context, node, fileName, unknown) {
  const parameter = node.typeParameter;
  if (!parameter.constraint || ts.isTypeOperatorNode(parameter.constraint)) return null;
  const keys = finiteStrings(context, parameter.constraint, fileName, { unknown, keysOnly: true });
  if (!keys) return null;
  if (!node.nameType) return keys;
  const names = new Set();
  for (const key of keys) {
    const mapped = finiteStrings(context, node.nameType, fileName, { bindings: new Map([[parameter.name.text, [key]]]), unknown, keysOnly: true });
    if (!mapped) return null;
    for (const name of mapped) names.add(name);
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Positive certificates.

function positiveNames(context, entries, queried) {
  const available = new Set();
  const statementNode = context.statementNode;
  const typeLike = (declaration) => ["interface", "alias-type", "class", "enum"].includes(declaration.kind);
  const valueLike = (declaration) => ["variable", "binding", "function", "class", "enum"].includes(declaration.kind);
  const work = [];
  const visited = new Map();
  // Declarations are always walked from their own scope, so a declaration and
  // meaning (plus the property of a destructured binding) identify a visit.
  const enqueue = (declaration, meaning) => {
    let seen = visited.get(declaration.fileName);
    if (!seen) visited.set(declaration.fileName, seen = new Set());
    const key = declaration.property === undefined && declaration.innerIndex === undefined ? declaration.index * 2 + (meaning === "type" ? 1 : 0)
      : `${declaration.index}\0${meaning}\0${declaration.property ?? ""}\0${declaration.innerIndex ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    work.push({ declaration, meaning });
  };
  for (const entry of entries) {
    for (const name of exportNames(context, entry)) {
      const resolved = resolveExport(context, entry, name);
      // A source file's module symbol is a value module: `export * as ns` names it.
      if (resolved?.length && resolved.every((declaration) => declaration.module)) {
        if (queried.has(name)) available.add(name);
        continue;
      }
      if (!resolved || resolved.some((declaration) => declaration.module || declaration.kind === "namespace" || declaration.kind === "alias" || declaration.kind === "other")) continue;
      if (queried.has(name) && resolved.some((declaration) => typeLike(declaration) || valueLike(declaration))) available.add(name);
      for (const declaration of resolved) {
        if (typeLike(declaration)) enqueue(declaration, "type");
        if (valueLike(declaration)) enqueue(declaration, "value");
      }
    }
  }

  const typeParameters = (node) => new Set((node?.typeParameters ?? []).map((parameter) => parameter.name.text));
  const union = (left, right) => (right.size ? new Set([...left, ...right]) : left);
  const memberName = (member) => {
    const name = member.name;
    return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) ? name.text : undefined;
  };
  const kindOf = (node) => ts.isInterfaceDeclaration(node) ? "interface" : ts.isTypeAliasDeclaration(node) ? "alias-type"
    : ts.isClassDeclaration(node) ? "class" : ts.isFunctionDeclaration(node) ? "function" : ts.isEnumDeclaration(node) ? "enum"
      : ts.isVariableStatement(node) ? "variable" : "other";
  // A name a module neither declares nor imports resolves to the global scope.
  const globalDeclarations = (fileName, name) => {
    const module = context.modules.get(fileName);
    if (!module || module.uncertain || module.declarations.has(name) || module.imports.has(name)) return undefined;
    const result = [];
    for (const { fileName: globalFile, index } of context.environment.globals.get(name) ?? []) {
      const node = statementNode(globalFile, index);
      if (!node) return undefined;
      const statements = ts.isModuleDeclaration(node) ? node.body && ts.isModuleBlock(node.body) ? node.body.statements : [] : [node];
      for (const [innerIndex, statement] of statements.entries()) {
        if (!declaredNames(statement).includes(name)) continue;
        const declaration = { fileName: globalFile, index, kind: kindOf(statement), ...(statement !== node ? { innerIndex } : {}) };
        if (declaration.kind === "variable") {
          declaration.declarationIndex = statement.declarationList.declarations.findIndex((variable) => ts.isIdentifier(variable.name) && variable.name.text === name);
          if (declaration.declarationIndex < 0) return undefined;
        }
        result.push(declaration);
      }
    }
    return result.length ? result : undefined;
  };
  const declarationsOf = (fileName, name, tainted) => {
    if (tainted.has(name)) return undefined;
    const resolved = resolveLocal(context, fileName, name) ?? globalDeclarations(fileName, name);
    if (!resolved || resolved.some((declaration) => declaration.module)) return undefined;
    return resolved;
  };
  const declarationNode = (declaration) => {
    const node = statementNode(declaration.fileName, declaration.index);
    if (declaration.innerIndex === undefined) return node;
    return node && ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body) ? node.body.statements[declaration.innerIndex] ?? null : null;
  };

  // The type cannot be any, unknown, never or an error type, so a union or
  // intersection containing it still exists and the walk visits every part.
  const safe = (node, fileName, tainted, objectOnly, depth = 0) => {
    if (depth > 24) return false;
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedType: return safe(node.type, fileName, tainted, objectOnly, depth + 1);
      case ts.SyntaxKind.TypeLiteral: case ts.SyntaxKind.FunctionType: case ts.SyntaxKind.ConstructorType:
      case ts.SyntaxKind.ArrayType: case ts.SyntaxKind.TupleType: return true;
      case ts.SyntaxKind.StringKeyword: case ts.SyntaxKind.NumberKeyword: case ts.SyntaxKind.BooleanKeyword:
      case ts.SyntaxKind.BigIntKeyword: case ts.SyntaxKind.SymbolKeyword: case ts.SyntaxKind.UndefinedKeyword:
      case ts.SyntaxKind.NullKeyword: case ts.SyntaxKind.VoidKeyword: case ts.SyntaxKind.LiteralType:
      case ts.SyntaxKind.ObjectKeyword: return !objectOnly;
      case ts.SyntaxKind.UnionType: return !objectOnly && node.types.every((type) => safe(type, fileName, tainted, false, depth + 1));
      case ts.SyntaxKind.IntersectionType: return node.types.every((type) => safe(type, fileName, tainted, true, depth + 1));
      case ts.SyntaxKind.TypeOperator: return node.operator === ts.SyntaxKind.ReadonlyKeyword && (ts.isArrayTypeNode(node.type) || ts.isTupleTypeNode(node.type));
      case ts.SyntaxKind.MappedType: return mappedTypeNames(context, node, fileName, tainted) !== null;
      case ts.SyntaxKind.TypeQuery: {
        // typeof a class, function or enum is an object type.
        if (node.typeArguments || !ts.isIdentifier(node.exprName)) return false;
        const values = declarationsOf(fileName, node.exprName.text, new Set())?.filter(valueLike) ?? [];
        return values.length > 0 && values.every((declaration) => ["class", "function", "enum"].includes(declaration.kind));
      }
      case ts.SyntaxKind.TypeReference: {
        if (!ts.isIdentifier(node.typeName)) return false;
        const resolved = declarationsOf(fileName, node.typeName.text, tainted);
        const types = resolved?.filter(typeLike) ?? [];
        if (!types.length) return false;
        const count = node.typeArguments?.length ?? 0;
        return types.every((declaration) => {
          const target = declarationNode(declaration);
          if (!target) return false;
          if (declaration.kind === "enum") return !objectOnly && count === 0;
          const parameters = target.typeParameters ?? [];
          const required = parameters.filter((parameter) => !parameter.default).length;
          if (count < required || count > parameters.length) return false;
          if (declaration.kind === "interface" || declaration.kind === "class") return true;
          // A generic alias of an object literal type stays an object type with
          // the same member names under any instantiation.
          if (parameters.length) return ts.isTypeLiteralNode(target.type);
          return safe(target.type, declaration.fileName, new Set(), objectOnly, depth + 1);
        });
      }
      default: return false;
    }
  };

  const walkMembers = (members, fileName, tainted, statics) => {
    for (const member of members) {
      if (ts.isIndexSignatureDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member) || ts.isClassStaticBlockDeclaration(member)) continue;
      if (statics !== undefined && hasModifier(member, ts.SyntaxKind.StaticKeyword) !== statics) continue;
      const inner = union(tainted, typeParameters(member));
      if (ts.isCallSignatureDeclaration(member)) {
        if (member.type) certainType(member.type, fileName, inner);
        continue;
      }
      const name = memberName(member);
      if (name !== undefined && queried.has(name)) available.add(name);
      if (ts.isSetAccessor(member)) {
        const parameter = member.parameters[0];
        if (parameter?.type) certainType(parameter.type, fileName, inner);
      } else if (member.type) {
        certainType(member.type, fileName, inner);
      }
    }
  };

  const certainType = (node, fileName, tainted) => {
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedType: return certainType(node.type, fileName, tainted);
      case ts.SyntaxKind.TypeLiteral: return walkMembers(node.members, fileName, tainted);
      case ts.SyntaxKind.FunctionType: if (node.type) certainType(node.type, fileName, union(tainted, typeParameters(node))); return;
      case ts.SyntaxKind.TupleType: for (const element of node.elements) certainType(ts.isNamedTupleMember(element) ? element.type : element, fileName, tainted); return;
      case ts.SyntaxKind.UnionType: if (safe(node, fileName, tainted, false)) for (const type of node.types) certainType(type, fileName, tainted); return;
      case ts.SyntaxKind.IntersectionType: if (safe(node, fileName, tainted, true)) for (const type of node.types) certainType(type, fileName, tainted); return;
      case ts.SyntaxKind.MappedType: {
        const names = mappedTypeNames(context, node, fileName, tainted);
        if (!names) return;
        for (const name of names) if (queried.has(name)) available.add(name);
        if (node.type) certainType(node.type, fileName, union(tainted, new Set([node.typeParameter.name.text])));
        return;
      }
      case ts.SyntaxKind.TypeQuery: {
        // typeof walks the value meaning of the name.
        if (node.typeArguments || !ts.isIdentifier(node.exprName)) return;
        const values = declarationsOf(fileName, node.exprName.text, new Set())?.filter(valueLike) ?? [];
        for (const declaration of values) enqueue(declaration, "value");
        return;
      }
      case ts.SyntaxKind.TypeReference: {
        if (!ts.isIdentifier(node.typeName)) return;
        const resolved = declarationsOf(fileName, node.typeName.text, tainted);
        const types = resolved?.filter(typeLike) ?? [];
        if (!types.length) return;
        if (types.length === 1) {
          const target = declarationNode(types[0]);
          const branch = target && literalConditionalBranch(target, node);
          if (branch) return certainType(branch, types[0].fileName, typeParameters(target));
        }
        if (!safe(node, fileName, tainted, false)) return;
        for (const declaration of types) enqueue(declaration, "type");
        return;
      }
      default:
    }
  };

  // Stop as soon as every candidate is proven available.
  while (work.length && available.size < queried.size) {
    const { declaration, meaning } = work.pop();
    const node = declarationNode(declaration);
    if (!node) continue;
    const fileName = declaration.fileName;
    const tainted = typeParameters(node);
    if (meaning === "type") {
      if (ts.isInterfaceDeclaration(node)) {
        walkMembers(node.members, fileName, tainted);
        for (const clause of node.heritageClauses ?? []) {
          for (const base of clause.types) {
            if (ts.isIdentifier(base.expression)) certainType(ts.factory.createTypeReferenceNode(base.expression.text, base.typeArguments ? [...base.typeArguments] : undefined), fileName, tainted);
          }
        }
      } else if (ts.isClassDeclaration(node)) {
        walkMembers(node.members, fileName, tainted, false);
      } else if (ts.isTypeAliasDeclaration(node)) {
        certainType(node.type, fileName, tainted);
      }
    } else if (declaration.kind === "binding") {
      // A destructured binding has its property's type, not the annotation's.
      const variable = ts.isVariableStatement(node) ? node.declarationList.declarations[declaration.declarationIndex] : undefined;
      const annotation = variable?.type;
      const members = declaration.property !== undefined && annotation && ts.isTypeLiteralNode(annotation)
        ? annotation.members.filter((member) => memberName(member) === declaration.property) : [];
      if (members.length === 1 && members[0].type && (ts.isPropertySignature(members[0]) || ts.isMethodSignature(members[0]))) {
        certainType(members[0].type, fileName, union(tainted, typeParameters(members[0])));
      }
    } else if (ts.isVariableStatement(node)) {
      // Only the declarator that was reached.
      const variable = node.declarationList.declarations[declaration.declarationIndex];
      if (variable && ts.isIdentifier(variable.name) && variable.type) certainType(variable.type, fileName, tainted);
    } else if (ts.isFunctionDeclaration(node)) {
      if (node.type) certainType(node.type, fileName, tainted);
    } else if (ts.isClassDeclaration(node)) {
      // Statics only: `prototype` has no declaration, so the walk never enters
      // the instance type from the class value.
      walkMembers(node.members, fileName, tainted, true);
    } else if (ts.isEnumDeclaration(node)) {
      for (const member of node.members) {
        const name = memberName(member);
        if (name !== undefined && queried.has(name)) available.add(name);
      }
    }
  }
  return available;
}

// `type A<P ... = Default> = P extends <literals> ? X : Y`, referenced with a
// literal (explicit or default) for P, is exactly X or Y.
function literalConditionalBranch(alias, reference) {
  if (!ts.isTypeAliasDeclaration(alias) || !alias.typeParameters || !ts.isConditionalTypeNode(alias.type)) return undefined;
  const conditional = alias.type;
  const check = conditional.checkType;
  if (!ts.isTypeReferenceNode(check) || !ts.isIdentifier(check.typeName) || check.typeArguments) return undefined;
  const index = alias.typeParameters.findIndex((parameter) => parameter.name.text === check.typeName.text);
  if (index < 0) return undefined;
  const args = reference.typeArguments ?? [];
  const required = alias.typeParameters.filter((parameter) => !parameter.default).length;
  if (args.length < required || args.length > alias.typeParameters.length) return undefined;
  const argument = args[index] ?? alias.typeParameters[index].default;
  const literal = (node) => {
    if (!node || !ts.isLiteralTypeNode(node)) return undefined;
    const value = node.literal;
    if (ts.isStringLiteral(value)) return `s:${value.text}`;
    if (ts.isNumericLiteral(value)) return `n:${Number(value.text)}`;
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return `b:${value.kind}`;
    return undefined;
  };
  const key = literal(argument);
  if (key === undefined) return undefined;
  const targets = ts.isUnionTypeNode(conditional.extendsType) ? conditional.extendsType.types : [conditional.extendsType];
  const keys = targets.map(literal);
  if (keys.some((value) => value === undefined)) return undefined;
  return keys.includes(key) ? conditional.trueType : conditional.falseType;
}

// ---------------------------------------------------------------------------
// Negative certificates.

function reachableNameEvidence(context, entries, mayInfer) {
  const { modules, environment, resolveModule, queried } = context;
  const run = (followContexts, everythingDeep) => {
    const tokens = new Set();
    const templates = [];
    let computesNames = false;
    let infersFromParameters = false;
    let conditionalOnThis = false;
    // Per module: 0 unreached, 1 reached, 2 reached deeply (off-heap).
    const reached = new Map();
    const work = [];
    const reachStatement = (fileName, index, deep) => {
      deep ||= everythingDeep;
      let states = reached.get(fileName);
      if (!states) reached.set(fileName, states = new Uint8Array(statementCount(modules.get(fileName))));
      const want = deep ? 2 : 1;
      if (states[index] >= want) return;
      states[index] = want;
      work.push([fileName, index, deep]);
    };
    const reachModule = (fileName, deep) => {
      for (const name of exportNames(context, fileName)) {
        // Every export name counts: even one that resolves to nothing becomes a
        // name (TypeScript's unknown symbol is a property).
        if (queried.has(name)) tokens.add(name);
        reachExport(fileName, name, deep);
      }
      const module = modules.get(fileName);
      // Modules whose shape is uncertain contribute everything they contain.
      if (module && (module.uncertain || module.exportEquals)) for (let index = 0; index < statementCount(module); index += 1) reachStatement(fileName, index, deep);
    };
    const reachName = (fileName, name, deep) => {
      const module = modules.get(fileName);
      if (!module) return;
      for (const { index } of tableEntries(module.declarations, name).map(declarationEntry)) reachStatement(fileName, index, deep);
      const imported = module.imports.get(name);
      if (imported) {
        const target = resolveModule(imported.from, fileName);
        if (target) {
          if (imported.name === ALL) reachModule(target, deep);
          else reachExport(target, imported.name, deep);
        }
        for (const { fileName: ambientFile, index } of environment.ambientModules.get(imported.from) ?? []) reachStatement(ambientFile, index, deep);
      }
      for (const { fileName: globalFile, index } of environment.globals.get(name) ?? []) reachStatement(globalFile, index, deep);
    };
    const reachSpecifier = (fileName, specifier, deep) => {
      const target = resolveModule(specifier, fileName);
      if (target) reachModule(target, deep);
      for (const { fileName: ambientFile, index } of environment.ambientModules.get(specifier) ?? []) reachStatement(ambientFile, index, deep);
    };
    const reachExport = (fileName, name, deep, seen = new Set()) => {
      const key = `${fileName}\0${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      const module = modules.get(fileName);
      if (!module) return;
      for (const entry of tableEntries(module.exports, name).map(exportEntry)) {
        if (entry.expression) {
          for (let index = 0; index < statementCount(module); index += 1) reachStatement(fileName, index, deep);
        } else if (entry.local !== undefined) {
          reachName(fileName, entry.local, deep);
        } else {
          const target = resolveModule(entry.from, fileName);
          if (target) entry.name === ALL ? reachModule(target, deep) : reachExport(target, entry.name, deep, seen);
        }
      }
      for (const from of module.stars) {
        const target = from !== undefined && resolveModule(from, fileName);
        if (target) reachExport(target, name, deep, seen);
      }
    };
    const arraysHaveMembers = environment.globals.has("Array") || environment.globals.has("ReadonlyArray");
    const resolvable = (module, name, scope) => {
      if (scope.has(name) || module.declarations.has(name)) return true;
      const imported = module.imports.get(name);
      if (imported) return Boolean(resolveModule(imported.from, module.fileName)) || environment.ambientPattern || environment.ambientModules.has(imported.from);
      return environment.globals.has(name);
    };
    // Parse one reached statement and take its evidence. Deep statements count
    // everything; others skip what the walk never visits, and with
    // followContexts follow the operands a conditional can infer from deeply.
    let skipTokens = new Set();
    // Mapped-type keys in scope, bound to their finite key sets (or null).
    const mappedKeys = new Map();
    const absorbStatement = (fileName, index, statementDeep) => {
      const module = modules.get(fileName);
      const node = context.statementNode(fileName, index);
      if (!node) {
        computesNames = true;
        return;
      }
      const visit = (current, deep, scope, inNamespace, parent) => {
        // The walk never visits parameter types; a conditional that infers from
        // them reaches them only through a context visited deeply.
        if (!deep && ts.isParameter(current) && parent && !ts.isSetAccessor(parent) && !ts.isIndexSignatureDeclaration(parent)) return;
        if (!deep && ts.isHeritageClause(current) && current.token === ts.SyntaxKind.ImplementsKeyword) return;
        if (!arraysHaveMembers && (ts.isArrayTypeNode(current)
          || (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword && ts.isArrayTypeNode(current.type)))) return;
        if (ts.isIdentifier(current)) {
          if (queried.has(current.text) && producesName(current, parent, inNamespace) && !skipTokens.has(current)) tokens.add(current.text);
          if (!parent || !isMemberName(current, parent)) reachName(fileName, current.text, deep);
          return;
        }
        if (ts.isStringLiteralLike(current) || ts.isPrivateIdentifier(current) || ts.isNumericLiteral(current)) {
          if (queried.has(current.text) && (!ts.isNumericLiteral(current) || producesName(current, parent, inNamespace)) && !skipTokens.has(current)) tokens.add(current.text);
        }
        if (ts.isTemplateLiteralTypeNode(current)) {
          // Enumerate what a finite template computes; otherwise match its shape.
          const values = finiteStrings(context, current, fileName, { bindings: mappedKeys, unknown: new Set([...scope].filter((name) => !mappedKeys.has(name))) });
          if (values) for (const value of values) { if (queried.has(value)) tokens.add(value); }
          else templates.push([current.head.text, ...current.templateSpans.map((span) => span.literal.text)]);
        }
        if (current.kind === ts.SyntaxKind.IntrinsicKeyword) computesNames = true;
        if (ts.isImportTypeNode(current)) {
          const argument = current.argument;
          if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) reachSpecifier(fileName, argument.literal.text, deep);
          else computesNames = true;
        }
        if (ts.isModuleBlock(current)) inNamespace = true;
        const declared = locallyDeclaredTypeNames(current);
        if (declared.length) scope = new Set([...scope, ...declared]);
        if (ts.isConditionalTypeNode(current)) {
          const inspect = (child, inParameter) => {
            if (ts.isInferTypeNode(child) && inParameter) infersFromParameters = true;
            if (ts.isThisTypeNode(child)) conditionalOnThis = true;
            ts.forEachChild(child, (grandchild) => inspect(grandchild, inParameter || ts.isParameter(child)));
          };
          inspect(current.checkType, false);
          inspect(current.extendsType, false);
          if (followContexts && !deep) {
            visit(current.checkType, true, scope, inNamespace, current);
            visit(current.extendsType, true, scope, inNamespace, current);
            visit(current.trueType, deep, scope, inNamespace, current);
            visit(current.falseType, deep, scope, inNamespace, current);
            return;
          }
        }
        const typeArguments = (ts.isTypeReferenceNode(current) || ts.isExpressionWithTypeArguments(current) || ts.isImportTypeNode(current) || ts.isTypeQueryNode(current)) ? current.typeArguments : undefined;
        if (typeArguments && (ts.isTypeReferenceNode(current) || ts.isExpressionWithTypeArguments(current)) && !inNamespace) {
          let head = ts.isTypeReferenceNode(current) ? current.typeName : current.expression;
          while (ts.isQualifiedName(head) || ts.isPropertyAccessExpression(head)) head = ts.isQualifiedName(head) ? head.left : head.expression;
          // A generic that cannot resolve is an error type whatever its arguments say.
          if (ts.isIdentifier(head) && !resolvable(module, head.text, scope)) {
            visit(head, deep, scope, inNamespace, current);
            return;
          }
        }
        if (ts.isMappedTypeNode(current)) {
          const key = current.typeParameter.name.text;
          const previous = mappedKeys.get(key);
          const hadPrevious = mappedKeys.has(key);
          const constraint = current.typeParameter.constraint;
          mappedKeys.set(key, constraint && !ts.isTypeOperatorNode(constraint)
            ? finiteStrings(context, constraint, fileName, { bindings: mappedKeys, unknown: new Set([...scope].filter((name) => !mappedKeys.has(name) && name !== key)) })
            : null);
          ts.forEachChild(current, (child) => visit(child, deep, scope, inNamespace, current));
          if (hadPrevious) mappedKeys.set(key, previous);
          else mappedKeys.delete(key);
          return;
        }
        const deepChildren = followContexts && !deep ? new Set([
          ...(typeArguments ?? []),
          ...(ts.isTypeParameterDeclaration(current) ? [current.constraint, current.default].filter(Boolean) : []),
        ]) : undefined;
        ts.forEachChild(current, (child) => visit(child, deep || Boolean(deepChildren?.has(child)), scope, inNamespace, current));
      };
      // A destructured declaration's annotation is never itself the type of
      // anything (each binding has its property's type), so without a rest
      // element its own member names cannot become property names.
      const unnamedMembers = new Set();
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isObjectBindingPattern(declaration.name) || !declaration.type || !ts.isTypeLiteralNode(declaration.type)) continue;
          if (declaration.name.elements.some((element) => element.dotDotDotToken)) continue;
          for (const member of declaration.type.members) if (member.name) unnamedMembers.add(member.name);
        }
      }
      skipTokens = unnamedMembers;
      visit(node, statementDeep, new Set(), false, undefined);
    };

    for (const entry of entries) reachModule(entry, false);
    // Global and ambient declarations can be found from anywhere.
    for (const list of environment.globals.values()) for (const { fileName, index } of list) reachStatement(fileName, index, false);
    for (const list of environment.ambientModules.values()) for (const { fileName, index } of list) reachStatement(fileName, index, false);
    if (environment.ambientPattern) computesNames = true;
    for (const module of modules.values()) {
      if (module.uncertain || !module.isModule) for (let index = 0; index < statementCount(module); index += 1) reachStatement(module.fileName, index, false);
    }
    while (work.length) {
      const [fileName, index, deep] = work.pop();
      absorbStatement(fileName, index, deep);
    }
    return { tokens, templates, computesNames, infersFromParameters, conditionalOnThis };
  };

  // A conditional that infers from a parameter position can surface parameter
  // types of whatever reaches it: follow its operands and type arguments deeply.
  // When the snapshot can infer at all, do so from the start.
  let result = run(mayInfer, false);
  if (result.infersFromParameters && !mayInfer) result = run(true, false);
  if (result.infersFromParameters && result.conditionalOnThis) result = run(true, true);
  const patterns = result.templates.map((parts) => new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")}$`));
  return {
    mayProduce: (name) => result.computesNames || SYNTHESIZED.test(name) || name.startsWith("__")
      || result.tokens.has(name) || patterns.some((pattern) => pattern.test(name)),
  };
}
