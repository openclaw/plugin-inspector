import { loadTypeScript } from "./typescript.js";

const ts = loadTypeScript();

// Packed OpenClaw ships its public SDK as rolled-up dist/*.d.ts chunks: about
// 5 MB of declarations. Type-checking all of them at once needs roughly 250 MB,
// more than a 512 MiB publish action can spare next to plugin inspection. This
// reduces the snapshot to the declarations a type checker can still reach from
// the public SDK entrypoints, without changing any type the checker resolves.
//
// Two reductions, each conservative:
//
// 1. Type arguments of a type reference whose name cannot resolve are dropped.
//    The packed snapshot has no lib files and no dependencies, so references
//    such as Promise<...>, Pick<...> or z.ZodObject<...> (zod imported from an
//    unresolvable module) are error types whatever their arguments say. A name
//    counts as resolvable if it is declared in any enclosing scope, at file
//    level, as a global, or imported from a module that resolves (to a file or
//    to an ambient `declare module`). Arguments containing `infer`, and every
//    reference inside a namespace body, are left untouched.
// 2. Top-level statements outside the public closure are dropped. A kept
//    statement keeps every same-file declaration and import binding whose name
//    appears as any identifier inside it (declaration merging keeps all
//    declarations of a name), and every module export it reaches through an
//    import, re-export, `export *` or `import("...")` type. Entry files, global
//    scripts, ambient modules, global augmentations and files with parse
//    errors are kept whole.
//
// Files are parsed a few top-level statements at a time and only compact
// summaries are retained, so the reduction never holds a whole chunk's syntax
// tree.
export function reduceDeclarationsToPublicClosure({ files, entryFiles, resolveModule }) {
  let environment = scanDeclarationEnvironment(files);
  let summaries;
  try {
    summaries = summarizeDeclarations(files, environment, resolveModule);
  } catch (error) {
    if (!(error instanceof EnvironmentMismatch)) throw error;
    environment = { ...environment, eraseTypeArguments: false, skippedAsModules: new Set() };
    summaries = summarizeDeclarations(files, environment, resolveModule);
  }

  const work = [];
  const requested = new Map();
  const keptLocals = new Map();
  const kept = new Map();
  const keptSpecifiers = new Map();
  const setFor = (map, key) => map.get(key) ?? map.set(key, new Set()).get(key);

  const keepStatement = (summary, index) => {
    const statements = setFor(kept, summary.fileName);
    if (statements.has(index)) return;
    statements.add(index);
    work.push(() => followStatement(summary, summary.statements[index]));
  };
  const keepSpecifier = (summary, statementIndex, specifierIndex) => {
    const specifiers = setFor(keptSpecifiers, summary.fileName);
    const key = `${statementIndex}:${specifierIndex}`;
    if (specifiers.has(key)) return;
    specifiers.add(key);
    keepStatement(summary, statementIndex);
    const statement = summary.statements[statementIndex];
    const specifier = statement.exportSpecifiers[specifierIndex];
    if (statement.moduleSpecifier === undefined) keepLocal(summary, specifier.local);
    else requestExport(resolveModule(statement.moduleSpecifier, summary.fileName), specifier.local);
  };
  const keepLocal = (summary, name) => {
    const names = setFor(keptLocals, summary.fileName);
    if (names.has(name)) return;
    names.add(name);
    for (const index of summary.declarationsByName.get(name) ?? []) keepStatement(summary, index);
    for (const { statementIndex, from, imported } of summary.importBindings.get(name) ?? []) {
      keepStatement(summary, statementIndex);
      requestExport(resolveModule(from, summary.fileName), imported);
    }
  };
  const requestExport = (fileName, name) => {
    const summary = fileName && summaries.get(fileName);
    if (!summary) return;
    const names = setFor(requested, fileName);
    if (names.has(name) || names.has(ALL_EXPORTS)) return;
    names.add(name);
    if (summary.keepWhole) return;
    const all = name === ALL_EXPORTS;
    // A local export shadows a star export; following both over-approximates.
    for (const index of summary.starExports) {
      const statement = summary.statements[index];
      keepStatement(summary, index);
      const target = resolveModule(statement.moduleSpecifier, fileName);
      if (statement.exportStar === null) {
        if (all || name !== "default") requestExport(target, name);
      } else if (all || statement.exportStar === name) {
        requestExport(target, ALL_EXPORTS);
      }
    }
    const providers = all ? [...summary.exports.values()].flat() : summary.exports.get(name) ?? [];
    for (const { index, specifierIndex } of providers) {
      if (specifierIndex === undefined) keepStatement(summary, index);
      else keepSpecifier(summary, index, specifierIndex);
    }
  };
  const followStatement = (summary, statement) => {
    for (const name of statement.references) keepLocal(summary, name);
    for (const name of statement.declares) keepLocal(summary, name);
    for (const { from, name } of statement.importTypes) requestExport(resolveModule(from, summary.fileName), name);
  };

  for (const summary of summaries.values()) {
    const whole = summary.keepWhole || entryFiles.has(summary.fileName);
    for (const [index, statement] of summary.statements.entries()) {
      if (!whole && !statement.alwaysKeep) continue;
      keepStatement(summary, index);
      for (const specifierIndex of statement.exportSpecifiers.keys()) keepSpecifier(summary, index, specifierIndex);
      if (statement.exportStar !== undefined) {
        requestExport(resolveModule(statement.moduleSpecifier, summary.fileName), ALL_EXPORTS);
      }
    }
  }
  while (work.length) work.pop()();

  const reduced = new Map();
  for (const [fileName, text] of files) {
    const summary = summaries.get(fileName);
    reduced.set(fileName, summary.keepWhole || entryFiles.has(fileName)
      ? renderWhole(summary, text)
      : renderKept(summary, text, kept.get(fileName) ?? new Set(), keptSpecifiers.get(fileName) ?? new Set()));
  }
  return reduced;
}

const ALL_EXPORTS = "\0*";

class EnvironmentMismatch extends Error {}

function summarizeDeclarations(files, environment, resolveModule) {
  const summaries = new Map();
  for (const [fileName, text] of files) {
    summaries.set(fileName, summarizeDeclarationFile(fileName, text, { environment, resolveModule }));
  }
  return summaries;
}

// Names visible everywhere in the snapshot program, and module names that
// resolve through ambient declarations instead of files. Text scans only add
// names (fewer erasures), so they can over-approximate safely; files that may
// be scripts or contain `declare global` are parsed for their global names.
function scanDeclarationEnvironment(files) {
  const globals = new Set();
  const ambientModules = new Set();
  const skippedAsModules = new Set();
  let ambientPattern = false;
  let eraseTypeArguments = true;
  for (const [fileName, text] of files) {
    for (const match of text.matchAll(AMBIENT_MODULE_SYNTAX)) {
      ambientModules.add(match[2]);
      if (match[2].includes("*")) ambientPattern = true;
    }
    for (const match of text.matchAll(UMD_GLOBAL_SYNTAX)) globals.add(match[1]);
    if (LIB_REFERENCE_SYNTAX.test(text)) eraseTypeArguments = false;
    if (MODULE_SYNTAX.test(text) && !GLOBAL_AUGMENTATION_SYNTAX.test(text)) {
      skippedAsModules.add(fileName);
      continue;
    }
    const parsed = parseTopLevelStatements(fileName, text);
    const addDeclared = (node) => {
      const names = declaredNames(node);
      if (names === null && !ts.isModuleDeclaration(node) && !isNonDeclaringStatement(node)) eraseTypeArguments = false;
      for (const name of names ?? []) globals.add(name);
    };
    const visit = (node) => {
      if (ts.isModuleDeclaration(node)) {
        if (ts.isStringLiteralLike(node.name)) {
          ambientModules.add(node.name.text);
          if (node.name.text.includes("*")) ambientPattern = true;
        } else if (node.flags & ts.NodeFlags.GlobalAugmentation && node.body && ts.isModuleBlock(node.body)) {
          node.body.statements.forEach(addDeclared);
        }
      }
      if (ts.isNamespaceExportDeclaration(node)) globals.add(node.name.text);
      if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) ts.forEachChild(node, visit);
    };
    parsed.forEachStatement((node) => {
      if (!parsed.isModule) addDeclared(node);
      visit(node);
    });
  }
  return { globals, ambientModules, ambientPattern, eraseTypeArguments, skippedAsModules };
}

const MODULE_SYNTAX = /^(?:import|export)\b/m;
const GLOBAL_AUGMENTATION_SYNTAX = /\bdeclare\s+global\b/;
const AMBIENT_MODULE_SYNTAX = /\bmodule\s*(["'])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
const UMD_GLOBAL_SYNTAX = /\bas\s+namespace\s+([A-Za-z_$][\w$]*)/g;
const LIB_REFERENCE_SYNTAX = /<reference\s+lib\s*=/;

function isNonDeclaringStatement(statement) {
  return ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)
    || ts.isNamespaceExportDeclaration(statement) || ts.isEmptyStatement(statement);
}

const LANGUAGE_OPTIONS = { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone };

function summarizeDeclarationFile(fileName, text, { environment, resolveModule }) {
  const parsed = parseTopLevelStatements(fileName, text);
  const isModule = parsed.isModule;
  // A file the environment scan skipped must really be a module, or its global
  // names were never collected and erasure is not provably safe.
  if (!isModule && environment.skippedAsModules.has(fileName)) throw new EnvironmentMismatch();
  const keepWhole = !isModule || parsed.hasParseErrors || parsed.hasReferenceDirectives;
  const statements = [];
  const declarationsByName = new Map();
  const importBindings = new Map();
  const unresolvedImports = new Set();
  const moduleResolves = (from) => environment.ambientPattern || environment.ambientModules.has(from) || Boolean(resolveModule(from, fileName));
  const push = (map, key, value) => (map.get(key) ?? map.set(key, []).get(key)).push(value);

  // Bind file-level names before collecting references so erasure can tell
  // which type names resolve.
  parsed.forEachStatement((node, index) => {
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause;
      const bind = (local, imported) => {
        push(importBindings, local, { statementIndex: index, from, imported });
        if (!moduleResolves(from)) unresolvedImports.add(local);
      };
      if (clause.name) bind(clause.name.text, "default");
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) bind(bindings.name.text, ALL_EXPORTS);
      else if (bindings) for (const element of bindings.elements) bind(element.name.text, moduleExportName(element.propertyName ?? element.name));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteralLike(node.moduleReference.expression)) {
      push(importBindings, node.name.text, { statementIndex: index, from: node.moduleReference.expression.text, imported: ALL_EXPORTS });
    } else {
      for (const name of declaredNames(node) ?? []) push(declarationsByName, name, index);
    }
  });
  const erasable = (name) => !keepWhole && environment.eraseTypeArguments && !environment.globals.has(name)
    && (unresolvedImports.has(name) ? !declarationsByName.has(name) : !declarationsByName.has(name) && !importBindings.has(name));

  parsed.forEachStatement((node, index, source, offset) => {
    const statement = {
      start: offset + node.getStart(source),
      end: offset + node.end,
      declares: [],
      exportedNames: [],
      exportSpecifiers: [],
      references: new Set(),
      importTypes: [],
      erasures: [],
      alwaysKeep: keepWhole,
      exportStar: undefined,
      moduleSpecifier: undefined,
    };
    statements[index] = statement;
    const context = { erasable, offset };
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause || !ts.isStringLiteralLike(node.moduleSpecifier)) statement.alwaysKeep = true;
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        if (!ts.isStringLiteralLike(node.moduleReference.expression)) statement.alwaysKeep = true;
      } else {
        collectReferences(node.moduleReference, statement, context);
      }
      statement.declares.push(node.name.text);
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) statement.exportedNames.push(node.name.text);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        if (!ts.isStringLiteralLike(node.moduleSpecifier)) {
          statement.alwaysKeep = true;
          return;
        }
        statement.moduleSpecifier = node.moduleSpecifier.text;
      }
      const clause = node.exportClause;
      if (!clause) statement.exportStar = null;
      else if (ts.isNamespaceExport(clause)) statement.exportStar = moduleExportName(clause.name);
      else {
        statement.exportList = {
          prefix: `export ${node.isTypeOnly ? "type " : ""}{ `,
          suffix: ` }${node.moduleSpecifier ? ` from ${node.moduleSpecifier.getText(source)}` : ""}${node.attributes ? ` ${node.attributes.getText(source)}` : ""};`,
        };
        for (const element of clause.elements) {
          statement.exportSpecifiers.push({
            exported: moduleExportName(element.name),
            local: moduleExportName(element.propertyName ?? element.name),
            text: element.getText(source),
          });
        }
      }
      return;
    }
    collectReferences(node, statement, context);
    if (ts.isExportAssignment(node)) {
      // `export =` replaces the module shape; `export default` adds one export.
      if (node.isExportEquals) statement.alwaysKeep = true;
      else statement.exportedNames.push("default");
      return;
    }
    if (ts.isModuleDeclaration(node) && (!ts.isIdentifier(node.name) || node.flags & ts.NodeFlags.GlobalAugmentation)) {
      statement.alwaysKeep = true;
      return;
    }
    const names = declaredNames(node);
    if (names === null) {
      statement.alwaysKeep = true;
      return;
    }
    statement.declares.push(...names);
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      statement.exportedNames.push(...(hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? ["default"] : names));
    }
  });
  const exports = new Map();
  const starExports = [];
  for (const [index, statement] of statements.entries()) {
    if (statement.exportStar !== undefined) starExports.push(index);
    for (const name of statement.exportedNames) push(exports, name, { index });
    for (const [specifierIndex, specifier] of statement.exportSpecifiers.entries()) push(exports, specifier.exported, { index, specifierIndex });
  }
  return { fileName, isModule, keepWhole, statements, declarationsByName, importBindings, exports, starExports };
}

// Parse a declaration file a few top-level statements at a time. A 2.7 MB
// rolled-up chunk otherwise builds one syntax tree of ~100 MB just to be
// summarized. Statements are split only at depth zero, after `;` or `}`, and
// before a keyword that can only start a new declaration; if any piece fails to
// parse, the whole file is parsed instead, so statement boundaries always match
// TypeScript's own.
function parseTopLevelStatements(fileName, text) {
  const pieces = splitTopLevelStatements(text);
  const parse = (pieceText) => ts.createSourceFile(fileName, pieceText, LANGUAGE_OPTIONS, false);
  if (pieces) {
    let isModule = false;
    let hasReferenceDirectives = false;
    let count = 0;
    let valid = true;
    for (const [start, end] of pieces) {
      const source = parse(text.slice(start, end));
      if (source.parseDiagnostics.length) {
        valid = false;
        break;
      }
      isModule ||= ts.isExternalModule(source);
      hasReferenceDirectives ||= referenceDirectives(source);
      count += source.statements.length;
    }
    if (valid) {
      return {
        isModule,
        hasParseErrors: false,
        hasReferenceDirectives,
        forEachStatement(callback) {
          let index = 0;
          for (const [start, end] of pieces) {
            const source = parse(text.slice(start, end));
            for (const node of source.statements) callback(node, index++, source, start);
          }
          if (index !== count) throw new Error(`declaration statements changed while summarizing ${fileName}`);
        },
      };
    }
  }
  const source = parse(text);
  return {
    isModule: ts.isExternalModule(source),
    hasParseErrors: source.parseDiagnostics.length > 0,
    hasReferenceDirectives: referenceDirectives(source),
    forEachStatement(callback) {
      for (const [index, node] of source.statements.entries()) callback(node, index, source, 0);
    },
  };
}

function referenceDirectives(source) {
  return source.referencedFiles.length > 0 || source.typeReferenceDirectives.length > 0 || source.libReferenceDirectives.length > 0;
}

const STATEMENT_KEYWORDS = new Set([
  ts.SyntaxKind.ImportKeyword, ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.InterfaceKeyword, ts.SyntaxKind.TypeKeyword, ts.SyntaxKind.NamespaceKeyword,
  ts.SyntaxKind.ModuleKeyword, ts.SyntaxKind.AbstractKeyword, ts.SyntaxKind.EnumKeyword,
  ts.SyntaxKind.FunctionKeyword, ts.SyntaxKind.ClassKeyword, ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.LetKeyword, ts.SyntaxKind.VarKeyword, ts.SyntaxKind.GlobalKeyword,
]);
const PIECE_BYTES = 64 * 1024;

function splitTopLevelStatements(text) {
  if (text.length <= PIECE_BYTES) return null;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const pieces = [];
  const templateDepths = [];
  let pieceStart = 0;
  let depth = 0;
  let boundary = false;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (boundary && depth === 0 && STATEMENT_KEYWORDS.has(token)) {
      const start = scanner.getTokenFullStart();
      if (start - pieceStart >= PIECE_BYTES) {
        pieces.push([pieceStart, start]);
        pieceStart = start;
      }
    }
    boundary = false;
    switch (token) {
      case ts.SyntaxKind.OpenBraceToken:
      case ts.SyntaxKind.OpenParenToken:
      case ts.SyntaxKind.OpenBracketToken:
        depth += 1;
        break;
      case ts.SyntaxKind.CloseParenToken:
      case ts.SyntaxKind.CloseBracketToken:
        depth -= 1;
        break;
      case ts.SyntaxKind.CloseBraceToken:
        if (templateDepths.length && templateDepths.at(-1) === depth) {
          if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) templateDepths.pop();
          break;
        }
        depth -= 1;
        boundary = depth === 0;
        break;
      case ts.SyntaxKind.TemplateHead:
        templateDepths.push(depth);
        break;
      case ts.SyntaxKind.SemicolonToken:
        boundary = depth === 0;
        break;
      default:
        break;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0 || templateDepths.length) return null;
  pieces.push([pieceStart, text.length]);
  return pieces.length > 1 ? pieces : null;
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function declaredNames(node) {
  if (ts.isVariableStatement(node)) {
    const names = [];
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) return null;
      names.push(declaration.name.text);
    }
    return names;
  }
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)
    || ts.isImportEqualsDeclaration(node)) {
    return node.name && ts.isIdentifier(node.name) ? [node.name.text] : null;
  }
  return null;
}

function collectReferences(root, statement, { erasable, offset = 0 }) {
  const visit = (node, scope, inNamespace) => {
    if (ts.isIdentifier(node)) {
      statement.references.add(node.text);
      return;
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      const from = ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal) ? argument.literal.text : undefined;
      if (from === undefined) statement.alwaysKeep = true;
      else {
        let qualifier = node.qualifier;
        while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
        statement.importTypes.push({ from, name: qualifier ? qualifier.text : ALL_EXPORTS });
      }
    }
    // Namespace bodies merge across declarations; never guess their scope.
    if (ts.isModuleBlock(node)) inNamespace = true;
    if (ts.isTypeReferenceNode(node) && node.typeArguments && !inNamespace) {
      let head = node.typeName;
      while (ts.isQualifiedName(head)) head = head.left;
      if (!scope.has(head.text) && erasable(head.text) && !containsInfer(node.typeArguments)) {
        statement.erasures.push([offset + node.typeName.end, offset + node.end]);
        visit(node.typeName, scope, inNamespace);
        return;
      }
    }
    const declared = locallyDeclaredTypeNames(node);
    if (declared.length) scope = new Set([...scope, ...declared]);
    ts.forEachChild(node, (child) => visit(child, scope, inNamespace));
  };
  visit(root, new Set(), false);
}

// Type names a node introduces for its descendants.
function locallyDeclaredTypeNames(node) {
  const names = [];
  if (node.typeParameters) for (const parameter of node.typeParameters) names.push(parameter.name.text);
  if (ts.isMappedTypeNode(node)) names.push(node.typeParameter.name.text);
  if (ts.isConditionalTypeNode(node)) {
    const visit = (child) => {
      if (ts.isInferTypeNode(child)) names.push(child.typeParameter.name.text);
      ts.forEachChild(child, visit);
    };
    visit(node.extendsType);
  }
  return names;
}

function containsInfer(nodes) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isInferTypeNode(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return found;
}

// Whole files keep their exact text (comments, directives, positions); only
// erased type arguments become spaces.
function renderWhole(summary, text) {
  if (summary.keepWhole) return text;
  let output = "";
  let cursor = 0;
  for (const statement of summary.statements) {
    for (const [start, end] of statement.erasures) {
      output += text.slice(cursor, start) + " ".repeat(end - start);
      cursor = end;
    }
  }
  return output + text.slice(cursor);
}

function renderKept(summary, text, keptStatements, keptSpecifiers) {
  const parts = [];
  for (const [index, statement] of summary.statements.entries()) {
    if (!keptStatements.has(index)) continue;
    if (statement.exportList) {
      const specifiers = statement.exportSpecifiers.filter((_, specifierIndex) => keptSpecifiers.has(`${index}:${specifierIndex}`));
      if (specifiers.length) parts.push(`${statement.exportList.prefix}${specifiers.map((specifier) => specifier.text).join(", ")}${statement.exportList.suffix}`);
      continue;
    }
    parts.push(renderStatement(statement, text));
  }
  // Keep module files modules so kept global augmentations keep their meaning.
  if (summary.isModule) parts.push("export {};");
  return parts.join("\n");
}

function renderStatement(statement, text) {
  let cursor = statement.start;
  let output = "";
  for (const [start, end] of statement.erasures) {
    output += text.slice(cursor, start);
    cursor = end;
  }
  return output + text.slice(cursor, statement.end);
}

function moduleExportName(node) {
  return node.text;
}
