import ts from "typescript";
import { isSdkSpecifier, nameText, stringExpressionPrefix, walk } from "./syntax.js";
import { createTypeProvenance } from "./types.js";
import { capabilityContextMember } from "./host-context.js";

const sdkExport = (module, name) => ({ kind: "export", module, name });

/** Follow unchanged values; wrappers and arbitrary SDK return values do not inherit identity. */
export function createProvenance({ checker, program, localSource, sources, targetRoot, entrypoints = [] }) {
  const resolving = new Set();
  const resolvingSymbols = new Set();
  let scope = { bindings: new Map(), literalBindings: new Map(), functions: new Set(), cache: new WeakMap() };
  const exporting = new Set();
  const { typeValue, inferred } = createTypeProvenance({ checker, program, resolve, select, moduleValue, targetRoot });
  const sourceNames = new Set(sources.map((source) => source.fileName));
  const argumentsByParameter = new Map();
  const restArgumentsByParameter = new Map();
  const callsByFunction = new Map();
  const assignments = new Map();
  const entryParameters = new Set();
  function inScope(next, operation) {
    const previous = scope;
    scope = next;
    try { return operation(); } finally { scope = previous; }
  }
  for (const source of sources) walk(source, (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      if (declaration && sourceNames.has(declaration.getSourceFile().fileName)) {
        callsByFunction.set(declaration, [...(callsByFunction.get(declaration) ?? []), node]);
        for (const [index, parameter] of declaration.parameters.entries()) {
          if (parameter.dotDotDotToken) {
            restArgumentsByParameter.set(parameter, [...(restArgumentsByParameter.get(parameter) ?? []), [...(node.arguments ?? [])].slice(index)]);
            continue;
          }
          const argument = node.arguments?.[index];
          if (argument) argumentsByParameter.set(parameter, [...(argumentsByParameter.get(parameter) ?? []), argument]);
        }
      }
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(node.operatorToken.kind) && (ts.isIdentifier(node.left) || ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      assignments.set(symbol, [...(assignments.get(symbol) ?? []), node.right]);
    }
  });

  function moduleValue(specifier, source, dependencyKind) {
    if (isSdkSpecifier(specifier)) return { kind: "namespace", module: specifier, dependencyKind };
    const resolved = specifier && localSource(specifier, source);
    return resolved ? { kind: "namespace", source: resolved, dependencyKind } : undefined;
  }

  function exported(source, name) {
    if (!source) return undefined;
    const key = `${source.fileName}#${name}`;
    if (exporting.has(key)) return undefined;
    exporting.add(key);
    let result;
    for (const statement of source.statements) {
      if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const parts = [];
        let base = statement.expression.left;
        while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
          parts.unshift(ts.isPropertyAccessExpression(base) ? base.name.text : literal(base.argumentExpression));
          base = base.expression;
        }
        const declaration = ts.isIdentifier(base) && checker.getSymbolAtLocation(base)?.valueDeclaration;
        if (ts.isIdentifier(base) && (!declaration || ts.isBinaryExpression(declaration))) {
          const member = base.text === "module" && parts[0] === "exports" ? parts.slice(1) : base.text === "exports" ? parts : undefined;
          if (member && (member.length === 0 && name === "default" || member.length === 1 && member[0] === name)) result ??= resolve(statement.expression.right);
        }
      } else if (ts.isExportDeclaration(statement)) {
        const namespace = statement.moduleSpecifier && moduleValue(statement.moduleSpecifier.text, source);
        if (!statement.exportClause && namespace) result ??= select(namespace, name);
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) {
          if (item.name.text === name) result ??= namespace ? select(namespace, (item.propertyName ?? item.name).text) : resolve(item.propertyName ?? item.name);
        }
      } else if (name === "default" && ts.isExportAssignment(statement)) result ??= resolve(statement.expression);
      else if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          if (nameText(declaration.name) === name) result ??= resolve(declaration.initializer);
        }
        else if (nameText(statement.name) === name || name === "default" && statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) result ??= declarationValue(statement);
      }
    }
    exporting.delete(key);
    return result;
  }

  const selecting = new WeakMap();
  function select(value, key) {
    if (!value || key === undefined) return undefined;
    // A recursive helper can rebuild the same spread node in fresh call scopes.
    // Guard its source identity, not the temporary wrapper object's identity.
    const identity = value.node ?? value;
    const activeKeys = selecting.get(identity) ?? new Set();
    if (activeKeys.has(key)) return undefined;
    selecting.set(identity, activeKeys);
    activeKeys.add(key);
    try { return inScope(value.scope ?? scope, () => selectValue(value, key)); } finally { activeKeys.delete(key); }
  }

  function selectValue(value, key) {
    if (!value || key === undefined) return undefined;
    if (value.builtin) return value;
    if (value.kind === "namespace") {
      const selected = value.module ? sdkExport(value.module, key) : exported(value.source, key);
      return selected && value.dependencyKind ? { ...selected, dependencyKind: value.dependencyKind } : selected;
    }
    if (value.kind === "export") return { ...value, selected: true };
    if (value.kind === "capability-context") return capabilityContextMember(value, key);
    if (value.kind === "projection") return value.keys.includes(key) ? select(value.base, key) : undefined;
    if (value.kind === "import-type") return select(moduleValue(value.node.argument.literal.text, value.node.getSourceFile()), key);
    if (value.kind === "api" || value.kind === "runtime") {
      const type = value.type && checker.getNonNullableType(value.type);
      const property = type?.getProperty(key);
      const selectedType = property && checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations[0]);
      const indexType = type && checker.getIndexTypeOfType(type, ts.IndexKind.String);
      // A local intersection can add plugin-owned fields; do not label those as
      // inherited host members. Ordinary API reads still retain removed names.
      if (value.restrictType && type && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) && !property && !indexType) return undefined;
      if (value.kind === "api" && !value.path.length && key === "runtime") return { kind: "runtime", path: [], type: selectedType ?? indexType };
      if (!property && value.path.length && ["trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "map", "filter", "find", "includes", "startsWith", "endsWith", "replace", "split", "join", "slice", "push", "forEach"].includes(key)) return { ...value, builtin: true };
      return { ...value, path: [...value.path, key], type: selectedType ?? indexType };
    }
    if (value.kind === "type-object") {
      const property = value.node.members.find((member) => nameText(member.name) === key);
      return property ? typeValue(property.type) : combine((value.bases ?? []).map((base) => select(base, key)));
    }
    if (value.kind === "runtime-store" && ["getRuntime", "tryGetRuntime"].includes(key)) return { kind: "return", value: value.value };
    if (value.kind === "runtime-store" && key === "setRuntime") return { kind: "sdk-helper" };
    if (value.kind === "object") {
      const alternatives = [];
      for (const item of [...(value.node.properties ?? [])].reverse()) {
        if (ts.isSpreadAssignment(item)) {
          alternatives.push(select(resolve(item.expression), key));
          const property = checker.getTypeAtLocation(item.expression).getProperty(key);
          // A present non-SDK property also replaces an earlier SDK alias.
          // Optional spread properties can leave the earlier value in place.
          if (property && !(property.flags & ts.SymbolFlags.Optional)) return combine(alternatives);
        }
        if (nameText(item.name) === key) return combine([...alternatives, ts.isShorthandPropertyAssignment(item) ? resolve(item.name) : resolve(item.initializer ?? item)]);
      }
      return combine(alternatives);
    }
    if (value.kind === "array") return resolve(value.node.elements[Number(key)]);
    if (value.kind === "values") return value.values[Number(key)];
    if (value.kind === "union") {
      const arrayFallback = value.values.some((item) => item.kind === "array");
      return combine(value.values.map((item) => arrayFallback && key === "length" && ["api", "runtime"].includes(item.kind) && !item.type?.getProperty(key)
        ? { ...item, builtin: true } : select(item, key)));
    }
    return undefined;
  }

  function combine(values) {
    const defined = values.filter(Boolean);
    if (!defined.length) return undefined;
    if (defined.length === 1) return defined[0];
    return { kind: "union", values: defined };
  }

  function builtinBoundary(value, receiver) {
    if (value?.kind === "union") return combine(value.values.map((item) => builtinBoundary(item, receiver)));
    if (["api", "runtime"].includes(value?.kind)) return { ...value, builtin: true };
    if (value?.kind === "export") {
      const type = checker.getTypeAtLocation(receiver);
      if ((type.isUnion() ? type.types : [type]).some((member) => member.flags & ts.TypeFlags.Object)) return { ...value, selected: true };
    }
    return { kind: "builtin" };
  }

  function isBuiltinProperty(node) {
    const symbol = checker.getSymbolAtLocation(node.name ?? node.argumentExpression);
    return symbol?.declarations?.some((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
  }

  function enclosingFunction(node) {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return parent;
  }

  function invocationScope(fn, args, lexicalScope = scope) {
    const values = args.map(resolve);
    const literalValues = args.map((argument) => literals(argument));
    const bindings = new Map(lexicalScope.bindings);
    const literalBindings = new Map(lexicalScope.literalBindings);
    for (const [index, parameter] of fn.parameters.entries()) {
      if (parameter.dotDotDotToken) {
        bindings.set(parameter, { kind: "values", values: values.slice(index) });
        literalBindings.set(parameter, []);
        continue;
      }
      bindings.set(parameter, index < args.length ? values[index] : resolve(parameter.initializer));
      literalBindings.set(parameter, index < args.length ? literalValues[index] : literals(parameter.initializer));
    }
    return { bindings, literalBindings, functions: new Set([...lexicalScope.functions, fn]), cache: new WeakMap() };
  }

  function invocationScopes(fn, seen = new Set()) {
    if (seen.has(fn) || scope.functions.has(fn)) return [scope];
    const calls = callsByFunction.get(fn);
    if (!calls?.length) return [scope];
    const next = new Set([...seen, fn]);
    return calls.flatMap((call) => {
      const caller = enclosingFunction(call);
      const contexts = caller ? invocationScopes(caller, next) : [scope];
      return contexts.map((context) => inScope(context, () => invocationScope(fn, call.arguments ?? [])));
    });
  }

  function elementValue(node) {
    const evaluate = () => isBuiltinProperty(node) ? builtinBoundary(resolve(node.expression), node.expression) : combine(literals(node.argumentExpression).map((key) => select(resolve(node.expression), key)));
    const fn = enclosingFunction(node);
    // Call correlation only matters when callers supply different known keys.
    // A fixed key needs no call graph expansion; an unknown key cannot become
    // a concrete SDK identity by enumerating unrelated caller contexts.
    return literals(node.argumentExpression).length > 1 && fn && !scope.functions.has(fn) && callsByFunction.has(fn)
      ? combine(invocationScopes(fn).map((context) => inScope(context, evaluate))) : evaluate();
  }

  function declarationValue(declaration) {
    if (ts.isTypeAliasDeclaration(declaration)) {
      const origin = ts.isTypeReferenceNode(declaration.type) ? resolve(declaration.type.typeName) : ts.isTypeQueryNode(declaration.type) ? resolve(declaration.type.exprName) : undefined;
      if (origin?.kind === "export") return origin;
    }
    if (ts.isImportSpecifier(declaration)) {
      const node = declaration.parent.parent.parent;
      return select(moduleValue(node.moduleSpecifier.text, node.getSourceFile()), (declaration.propertyName ?? declaration.name).text);
    }
    if (ts.isNamespaceImport(declaration)) return moduleValue(declaration.parent.parent.moduleSpecifier.text, declaration.getSourceFile());
    if (ts.isImportEqualsDeclaration(declaration)) {
      const reference = declaration.moduleReference;
      return ts.isExternalModuleReference(reference)
        ? moduleValue(literal(reference.expression), declaration.getSourceFile(), declaration.isTypeOnly ? undefined : "require")
        : resolve(reference);
    }
    if (ts.isImportClause(declaration)) return select(moduleValue(declaration.parent.moduleSpecifier.text, declaration.getSourceFile()), "default");
    if (ts.isExportSpecifier(declaration)) {
      const node = declaration.parent.parent;
      return node.moduleSpecifier ? select(moduleValue(node.moduleSpecifier.text, node.getSourceFile()), (declaration.propertyName ?? declaration.name).text) : symbolValue(checker.getExportSpecifierLocalTargetSymbol(declaration));
    }
    if (ts.isBindingElement(declaration)) {
      const owner = declaration.parent.parent;
      const base = ts.isBindingElement(owner) ? declarationValue(owner) : declarationValue(owner);
      const key = ts.isArrayBindingPattern(declaration.parent) ? String(declaration.parent.elements.indexOf(declaration)) : nameText(declaration.propertyName ?? declaration.name);
      return select(base, key) ?? resolve(declaration.initializer);
    }
    if (ts.isShorthandPropertyAssignment(declaration)) {
      return symbolValue(checker.getShorthandAssignmentValueSymbol(declaration));
    }
    if (ts.isParameter(declaration)) {
      if (entryParameters.has(declaration)) return { kind: "api", path: [], type: checker.getTypeAtLocation(declaration) };
      if (scope.bindings.has(declaration)) return scope.bindings.get(declaration);
      if (declaration.dotDotDotToken) return combine((restArgumentsByParameter.get(declaration) ?? []).map((args) => ({ kind: "values", values: args.map(resolve) })));
      const actual = combine((argumentsByParameter.get(declaration) ?? []).map(resolve));
      if (actual) return actual;
      const callback = declaration.parent;
      const call = callback.parent;
      if (callback.parameters?.[0] === declaration && ts.isCallExpression(call)) {
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "then") {
          const namespace = resolve(call.expression.expression);
          if (namespace?.kind === "namespace") return namespace;
        }
        const helper = resolve(call.expression);
        if (helper?.kind === "export" && ["createLazyRuntimeMethod", "createLazyRuntimeSurface"].includes(helper.name)) {
          const loader = resolve(call.arguments[0]);
          return loader?.kind === "function" ? returned(loader, []) : loader?.value;
        }
      }
    }
    if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration) || ts.isMethodDeclaration(declaration)) return { kind: "function", node: declaration, scope };
    if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && ts.isForOfStatement(declaration.parent.parent)) {
      function elements(value) {
        if (value?.kind === "union") return combine(value.values.map(elements));
        if (value?.kind === "array") return inScope(value.scope, () => combine(value.node.elements.map(resolve)));
      }
      return elements(resolve(declaration.parent.parent.expression));
    }
    if (declaration.initializer) return resolve(declaration.initializer);
    if (declaration.type) {
      const value = typeValue(declaration.type);
      return ["export", "namespace"].includes(value?.kind) || ["api", "runtime"].includes(value?.kind) && checker.getTypeFromTypeNode(declaration.type).getCallSignatures().length ? { kind: "signature", value } : value;
    }
    return undefined;
  }

  function symbolValue(symbol) {
    if (!symbol || resolvingSymbols.has(symbol)) return undefined;
    resolvingSymbols.add(symbol);
    try { return combine([...(symbol.declarations ?? []).map(declarationValue), ...(assignments.get(symbol) ?? []).map(resolve)]); }
    finally { resolvingSymbols.delete(symbol); }
  }

  function directBuiltinReference(value, node) {
    if (value?.kind === "union") return combine(value.values.map((item) => directBuiltinReference(item, node)));
    if (!value?.builtin) return value;
    const origin = value.builtinOrigin ?? node;
    // A builtin access still reads the SDK field in this expression. Its
    // computed result is not an unchanged SDK alias in a later expression.
    if (origin.getSourceFile() !== node.getSourceFile() || origin.pos < node.pos || origin.end > node.end) return undefined;
    return { ...value, builtinOrigin: origin };
  }

  function resolve(node) {
    if (!node) return undefined;
    if (scope.cache.has(node)) return scope.cache.get(node);
    if (resolving.has(node)) return undefined;
    resolving.add(node);
    let value;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) {
      value = resolve(node.expression);
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const declared = typeValue(node.type);
        if (["api", "runtime"].includes(declared?.kind)) value = declared;
      }
    }
    else if (ts.isIdentifier(node)) value = symbolValue(checker.getSymbolAtLocation(node));
    else if (node.kind === ts.SyntaxKind.SuperKeyword) {
      let parent = node.parent;
      while (parent && !ts.isClassLike(parent)) parent = parent.parent;
      const base = parent?.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
      value = base && resolve(base.expression);
    }
    else if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) value = ts.isPropertyAccessExpression(node) && isBuiltinProperty(node) ? builtinBoundary(resolve(node.expression), node.expression) : select(resolve(node.expression ?? node.left), nameText(node.name ?? node.right));
    else if (ts.isElementAccessExpression(node)) value = elementValue(node);
    else if (ts.isObjectLiteralExpression(node)) value = { kind: "object", node, scope };
    else if (ts.isArrayLiteralExpression(node)) value = { kind: "array", node, scope };
    else if (ts.isConditionalExpression(node)) value = combine([resolve(node.whenTrue), resolve(node.whenFalse)]);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) value = combine([resolve(node.left), resolve(node.right)]);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(node.operatorToken.kind)) value = resolve(node.right);
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require" && !checker.getSymbolAtLocation(node.expression)?.valueDeclaration) value = moduleValue(literal(node.arguments[0]), node.getSourceFile(), node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : "require");
      else {
        const callee = resolve(node.expression);
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "then" && resolve(node.expression.expression)?.kind === "namespace") {
          const callback = resolve(node.arguments[0]);
          if (callback?.kind === "function") value = returned(callback, [node.expression.expression]);
        }
        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Promise" && node.expression.name.text === "all") value = resolve(node.arguments[0]);
        if (callee?.kind === "export" && callee.name === "createPluginRuntimeStore") value = { kind: "runtime-store", value: typeValue(node.typeArguments?.[0]) };
        if (callee?.kind === "export" && callee.name === "createLazyRuntimeModule") {
          const loader = resolve(node.arguments[0]);
          if (loader?.kind === "function") value = { kind: "lazy-module", value: returned(loader, []) };
        }
        if (callee?.kind === "export" && callee.name === "loadBundledEntryExportSync") {
          const descriptor = resolve(node.arguments[1]);
          if (descriptor?.kind === "object") {
            const field = (key) => descriptor.node.properties.find((item) => nameText(item.name) === key)?.initializer;
            const specifier = literal(field("specifier"));
            const name = literal(field("exportName"));
            if (specifier?.startsWith(".") && name) value = select(moduleValue(specifier, node.getSourceFile()), name);
          }
        }
        if (callee?.kind === "return" || callee?.kind === "lazy-module") value = callee.value;
        if (callee?.kind === "function") {
          value = returned(callee, node.arguments) ?? typeValue(callee.node.type);
        }
      }
    }
    else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) value = { kind: "function", node, scope };
    if (!value && ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol?.declarations?.every((declaration) => sourceNames.has(declaration.getSourceFile().fileName))) value = symbolValue(symbol);
    }
    value ??= inferred(node);
    value = directBuiltinReference(value, node);
    resolving.delete(node);
    scope.cache.set(node, value);
    return value;
  }

  function returned(callee, args) {
    const fn = callee.node;
    return inScope(invocationScope(fn, args, callee.scope), () => returnedBody(fn));
  }

  function returnedBody(fn) {
    if (!fn.body) return undefined;
    const returns = [];
    const visit = (child) => {
      if (ts.isReturnStatement(child)) returns.push(resolve(child.expression));
      else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
    };
    if (ts.isBlock(fn.body)) visit(fn.body);
    else returns.push(resolve(fn.body));
    return combine(returns);
  }

  function literals(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.text];
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return literals(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration?.initializer) return literals(declaration.initializer, seen);
      if (declaration && ts.isParameter(declaration)) {
        if (scope.literalBindings.has(declaration)) return scope.literalBindings.get(declaration);
        const values = (argumentsByParameter.get(declaration) ?? []).flatMap((argument) => literals(argument, new Set(seen)));
        if (values.length) return [...new Set(values)];
      }
    }
    const type = checker.getTypeAtLocation(node);
    const types = type.isUnion() ? type.types : [type];
    return types.every((member) => member.isStringLiteral() || member.isNumberLiteral()) ? types.map((member) => String(member.value)) : [];
  }

  function literal(node) {
    const values = literals(node);
    if (values.length === 1) return values[0];
    const value = stringExpressionPrefix(node, checker);
    return value.complete ? value.prefix : undefined;
  }

  for (const source of entrypoints) {
    let entry = exported(source, "default") ?? { kind: "namespace", source };
    const seen = new Set();
    for (let depth = 0; entry && !seen.has(entry) && depth < 12; depth++) {
      seen.add(entry);
      const register = entry.kind === "function" ? entry : select(entry, "register");
      if (register?.kind === "function") {
        if (register.node.parameters[0]) entryParameters.add(register.node.parameters[0]);
        break;
      }
      entry = select(entry, "default") ?? select(entry, "module");
    }
  }
  // Entry discovery may resolve aliases before their API parameters are marked.
  scope.cache = new WeakMap();

  return { resolve, select, exported, moduleValue, literal, literals, typeValue };
}
