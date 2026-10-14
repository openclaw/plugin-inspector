import * as nodeModule from "node:module";
import { parse } from "acorn";
import { analyze } from "eslint-scope";

const literalModuleImport = /(?<![$\w.])(?<kind>[$A-Z_a-z][$\w]*)\s*\(\s*(?<quote>["'`])(?<specifier>[^"'`\\\r\n]+)\k<quote>/dg;

export function collectRuntimeModuleImports(text, { includeStaticNamespaces = false } = {}) {
  // Preserve possible-import offsets through erasure; AST and scopes classify them.
  // Named factories use createRequire or a \u escape. Avoid parsing unrelated
  // calls, which can dominate whole-plugin inspection.
  const mayUseCreateRequire = text.includes("createRequire") || text.includes("\\u");
  const entries = [...text.matchAll(literalModuleImport)].map(moduleImportEntry)
    .filter((entry) => entry && (mayUseCreateRequire || ["require", "import"].includes(entry.kind)));
  if (entries.length === 0 && !includeStaticNamespaces) return entries;
  const { runtimeText, imports } = classifyRuntimeImports(text, entries);
  let ast;
  let scopes;
  try {
    // Accept both source modules and CommonJS wrappers without changing their runtime.
    ast = parse(runtimeText, {
      ecmaVersion: "latest", ranges: true, sourceType: "script",
      allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
    });
    scopes = analyze(ast, {
      ecmaVersion: 2026,
      sourceType: ast.body.some((node) => /^(?:Import|Export).*Declaration$/.test(node.type)) ? "module" : "commonjs",
    });
  } catch {
    // Keep known imports if syntax is incomplete/unsupported; never guess namespace exports.
    // Type erasure has already classified each occurrence, even when AST analysis fails.
    const retained = new Set(imports.map(({ entry }) => entry.specifierStart));
    return [...scanLiteralModuleImports(text)].filter((entry) =>
      ["require", "import"].includes(entry.kind) && retained.has(entry.specifierStart))
      .map((entry) => ({ ...entry, names: new Set() }));
  }

  const parents = new Map();
  const nodes = [];
  visit(ast);
  function visit(node, parent) {
    if (!node || typeof node.type !== "string") return;
    parents.set(node, parent);
    nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  }
  const requireReferences = new Set();
  const lexicalReferences = new Set(scopes.scopes.flatMap((scope) =>
    scope.references.filter((reference) => reference.resolved).map((reference) => reference.identifier)));
  for (const declaration of nodes) {
    if (declaration.type !== "ImportDeclaration" || !["module", "node:module"].includes(declaration.source.value)) continue;
    for (const binding of declaration.specifiers) {
      const variable = scopes.getDeclaredVariables(declaration).find((value) => value.identifiers.includes(binding.local));
      if (!variable || variable.defs.length !== 1 || variable.references.some((reference) => reference.isWrite())) continue;
      // Named imports identify the factory without following mutable module objects.
      if (binding.type !== "ImportSpecifier" || binding.imported.name !== "createRequire") continue;
      for (const reference of variable.references) {
        const factory = reference.identifier;
        const call = parents.get(factory);
        if (!reference.isStatic() || call?.type !== "CallExpression" || call.callee !== factory || call.arguments.length !== 1) continue;
        const owner = parents.get(call);
        if (owner?.type !== "VariableDeclarator" || owner.init !== call || owner.id.type !== "Identifier") continue;
        const handle = scopes.getDeclaredVariables(owner).find((value) => value.identifiers.includes(owner.id));
        if (!handle || handle.defs.length !== 1 || handle.references.some((value) => value.isWrite() && !value.init)) continue;
        for (const use of handle.references) {
          if (use.isStatic() && use.isRead()) requireReferences.add(use.identifier);
        }
      }
    }
  }

  const byMarker = new Map(imports.map(({ marker, entry }) => [marker, entry]));
  const result = [];
  for (const node of nodes) {
    if (includeStaticNamespaces && node.type === "ImportDeclaration") {
      for (const binding of node.specifiers) {
        if (binding.type !== "ImportNamespaceSpecifier") continue;
        const names = new Set();
        collectBindingNames(binding.local, node, names);
        result.push({ specifier: node.source.value, specifierStart: node.source.start + 1,
          kind: "namespace", index: node.start, names });
      }
    }
    const source = node.type === "ImportExpression" ? node.source
      : node.type === "CallExpression" && node.callee.type === "Identifier"
        && ((node.callee.name === "require" && !lexicalReferences.has(node.callee)) || requireReferences.has(node.callee))
        && node.arguments.length === 1 ? node.arguments[0] : null;
    const specifier = source?.type === "Literal" ? source.value
      : source?.type === "TemplateLiteral" && source.expressions.length === 0 ? source.quasis[0].value.cooked : null;
    const candidate = byMarker.get(specifier);
    if (!candidate) continue;
    const entry = node.type === "CallExpression" ? { ...candidate, kind: "require" } : candidate;
    const names = new Set();
    result.push({ ...entry, names });
    const access = parents.get(node);
    const call = parents.get(access);
    if (node.type === "ImportExpression" && access?.type === "MemberExpression" && access.object === node
      && !access.computed && access.property.name === "then" && call?.type === "CallExpression" && call.callee === access) {
      const callback = call.arguments[0];
      if (callback?.type === "ArrowFunctionExpression" || callback?.type === "FunctionExpression") {
        collectBindingNames(callback.params[0], callback, names);
      }
    }
    // Promise methods belong to import(), not its awaited module namespace.
    const module = entry.kind === "require" ? node
      : parents.get(node)?.type === "AwaitExpression" ? parents.get(node) : null;
    if (!module) continue;
    const parent = parents.get(module);
    if (parent?.type === "MemberExpression" && parent.object === module && !parent.computed && parent.property.type === "Identifier") {
      names.add(parent.property.name);
    }
    if (parent?.type === "VariableDeclarator" && parent.init === module) collectBindingNames(parent.id, parent, names);
  }
  return result.sort((a, b) => a.index - b.index);

  function collectBindingNames(binding, owner, names) {
    if (binding?.type === "ObjectPattern") {
      for (const property of binding.properties) {
        if (property.type === "Property" && !property.computed && property.key.type === "Identifier") {
          names.add(property.key.name);
        }
      }
    } else if (binding?.type === "Identifier") {
      // Resolve references to this declaration, including closures but excluding shadowed names.
      for (const variable of scopes.getDeclaredVariables(owner)) {
        if (!variable.identifiers.includes(binding)) continue;
        for (const reference of variable.references) {
          const access = parents.get(reference.identifier);
          if (access?.type === "MemberExpression" && access.object === reference.identifier && !access.computed && access.property.type === "Identifier") {
            names.add(access.property.name);
          }
        }
      }
    }
  }
}

function* scanLiteralModuleImports(text) {
  const quotedOrComment = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/;
  const code = new RegExp(quotedOrComment.source + "|" + literalModuleImport.source + "|[`{}]", "dg");
  const template = /\\[\s\S]|`|\$\{/g;
  const templateDepths = [];
  let inTemplateText = false;
  let cursor = 0;
  // Skip quoted/comment text, but scan executable template interpolations.
  while (cursor < text.length) {
    const pattern = inTemplateText ? template : code;
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) break;
    cursor = pattern.lastIndex;
    if (inTemplateText) {
      if (match[0] === "`") {
        templateDepths.pop();
        inTemplateText = false;
      } else if (match[0] === "${") {
        templateDepths[templateDepths.length - 1] = 1;
        inTemplateText = false;
      }
      continue;
    }
    if (match[0] === "`") {
      templateDepths.push(0);
      inTemplateText = true;
    } else if (templateDepths.length && match[0] === "{") {
      templateDepths[templateDepths.length - 1] += 1;
    } else if (templateDepths.length && match[0] === "}") {
      inTemplateText = --templateDepths[templateDepths.length - 1] === 0;
    }
    const entry = moduleImportEntry(match);
    if (entry) yield entry;
  }
}

function moduleImportEntry(match) {
  const groups = match.groups;
  if (!groups?.specifier || (groups.quote === "`" && groups.specifier.includes("${"))) return null;
  return {
    specifier: groups.specifier,
    specifierStart: match.indices.groups.specifier[0],
    kind: groups.kind,
    index: groups.kind === "import" ? match.indices.groups.kind[0] : match.index,
  };
}

function classifyRuntimeImports(text, entries) {
  const markedImports = entries.map((entry, index) => {
    const { specifier, specifierStart } = entry;
    return {
      entry,
      specifierStart,
      specifierEnd: specifierStart + specifier.length,
      marker: `${specifier}__plugin_inspector_runtime_import_${index}__`,
    };
  });
  const parts = [];
  let cursor = 0;
  for (const markedImport of markedImports) {
    parts.push(text.slice(cursor, markedImport.specifierStart), markedImport.marker);
    cursor = markedImport.specifierEnd;
  }
  parts.push(text.slice(cursor));
  const markedText = parts.join("");

  let runtimeText = null;
  try {
    runtimeText = eraseTypeScript(markedText);
  } catch {
    // Unsupported or incomplete TypeScript cannot prove an import is type-only.
  }
  // Scan once, including overlapping suffixes inside a specifier. The full marker
  // must match: an unrelated string with the same numeric suffix is not retention.
  const retained = new Set();
  if (runtimeText !== null) {
    for (const match of runtimeText.matchAll(/(?=__plugin_inspector_runtime_import_(\d+)__)/g)) {
      const markedImport = markedImports[Number(match[1])];
      if (!markedImport || retained.has(markedImport)) continue;
      const start = match.index - markedImport.entry.specifier.length;
      if (start >= 0 && runtimeText.startsWith(markedImport.marker, start)) retained.add(markedImport);
    }
  }
  return {
    runtimeText: runtimeText ?? markedText,
    imports: runtimeText === null ? markedImports : markedImports.filter((entry) => retained.has(entry)),
  };
}

function eraseTypeScript(text) {
  if (typeof nodeModule.stripTypeScriptTypes === "function") {
    try {
      return nodeModule.stripTypeScriptTypes(text, { mode: "transform" });
    } catch (error) {
      if (error?.code !== "ERR_INVALID_ARG_VALUE") throw error;
      return nodeModule.stripTypeScriptTypes(text, { mode: "strip" });
    }
  }
  if (typeof globalThis.Bun?.Transpiler === "function") {
    // Analyze source bindings: the Bun target injects a require binding that
    // would make native calls look shadowed after type erasure.
    const transpiler = new globalThis.Bun.Transpiler({ loader: "ts", target: "node" });
    return transpiler.transformSync(text);
  }
  return null;
}
