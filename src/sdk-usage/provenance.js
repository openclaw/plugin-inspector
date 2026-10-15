import ts from "typescript";
import { isSdkSpecifier, nameText, walk } from "./syntax.js";
import { createTypeProvenance } from "./types.js";

const sdkExport = (module, name) => ({ kind: "export", module, name });

/** Follow unchanged values; wrappers and arbitrary SDK return values do not inherit identity. */
export function createProvenance({ checker, localSource, sources }) {
  const resolving = new Set();
  const cached = new Map();
  const exporting = new Set();
  const { typeValue, inferred } = createTypeProvenance({ checker, resolve, select });
  const sourceNames = new Set(sources.map((source) => source.fileName));
  const argumentsByParameter = new Map();
  const assignments = new Map();
  for (const source of sources) walk(source, (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      if (declaration && sourceNames.has(declaration.getSourceFile().fileName)) {
        for (const [index, parameter] of declaration.parameters.entries()) {
          const argument = node.arguments?.[index];
          if (argument) argumentsByParameter.set(parameter, [...(argumentsByParameter.get(parameter) ?? []), argument]);
        }
      }
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(node.operatorToken.kind) && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      assignments.set(symbol, [...(assignments.get(symbol) ?? []), node.right]);
    }
  });

  function moduleValue(specifier, source, dependencyKind) {
    return isSdkSpecifier(specifier) ? { kind: "namespace", module: specifier, dependencyKind }
      : specifier?.startsWith(".") ? { kind: "namespace", source: localSource(specifier, source), dependencyKind } : undefined;
  }

  function exported(source, name) {
    if (!source) return undefined;
    const key = `${source.fileName}#${name}`;
    if (exporting.has(key)) return undefined;
    exporting.add(key);
    let result;
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
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
        else if (nameText(statement.name) === name) result ??= declarationValue(statement);
      }
    }
    exporting.delete(key);
    return result;
  }

  function select(value, key) {
    if (!value || key === undefined) return undefined;
    if (value.kind === "namespace") {
      const selected = value.module ? sdkExport(value.module, key) : exported(value.source, key);
      return selected && value.dependencyKind ? { ...selected, dependencyKind: value.dependencyKind } : selected;
    }
    if (value.kind === "export") return { ...value, selected: true };
    if (value.kind === "projection") return value.keys.includes(key) ? select(value.base, key) : undefined;
    if (value.kind === "import-type") return select(moduleValue(value.node.argument.literal.text, value.node.getSourceFile()), key);
    if (value.kind === "api" || value.kind === "runtime") {
      if (value.kind === "api" && !value.path.length && key === "runtime") return { kind: "runtime", path: [] };
      if (value.path.length && ["trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "map", "filter", "find", "includes", "startsWith", "endsWith", "replace", "split", "join", "slice", "push", "forEach"].includes(key)) return { ...value, builtin: true };
      return { ...value, path: [...value.path, key] };
    }
    if (value.kind === "type-object") {
      const property = value.node.members.find((member) => nameText(member.name) === key);
      return property && typeValue(property.type);
    }
    if (value.kind === "runtime-store" && ["getRuntime", "tryGetRuntime"].includes(key)) return { kind: "return", value: value.value };
    if (value.kind === "runtime-store" && key === "setRuntime") return { kind: "sdk-helper" };
    if (value.kind === "object") {
      for (const item of value.node.properties ?? []) {
        if (ts.isSpreadAssignment(item)) { const spread = select(resolve(item.expression), key); if (spread) return spread; }
        if (nameText(item.name) === key) return ts.isShorthandPropertyAssignment(item) ? resolve(item.name) : resolve(item.initializer ?? item);
      }
    }
    if (value.kind === "array") return resolve(value.node.elements[Number(key)]);
    if (value.kind === "union") return combine(value.values.map((item) => select(item, key)));
    return undefined;
  }

  function combine(values) {
    const defined = values.filter(Boolean);
    if (!defined.length) return undefined;
    if (defined.length === 1) return defined[0];
    return { kind: "union", values: defined };
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
        if (helper?.kind === "export" && helper.name === "createLazyRuntimeMethod") return resolve(call.arguments[0])?.value;
      }
    }
    if (declaration.initializer) return resolve(declaration.initializer);
    if (declaration.type) {
      const value = typeValue(declaration.type);
      return ["api", "runtime"].includes(value?.kind) && checker.getTypeFromTypeNode(declaration.type).getCallSignatures().length ? { kind: "signature", value } : value;
    }
    if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration) || ts.isMethodDeclaration(declaration)) return { kind: "function", node: declaration };
    return undefined;
  }

  function symbolValue(symbol) {
    if (!symbol) return undefined;
    return combine([...(symbol.declarations ?? []).map(declarationValue), ...(assignments.get(symbol) ?? []).map(resolve)]);
  }

  function resolve(node) {
    if (!node) return undefined;
    if (cached.has(node)) return cached.get(node);
    if (resolving.has(node)) return undefined;
    resolving.add(node);
    let value;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) value = resolve(node.expression);
    else if (ts.isIdentifier(node)) value = symbolValue(checker.getSymbolAtLocation(node));
    else if (node.kind === ts.SyntaxKind.SuperKeyword) {
      let parent = node.parent;
      while (parent && !ts.isClassLike(parent)) parent = parent.parent;
      const base = parent?.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
      value = base && resolve(base.expression);
    }
    else if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) value = select(resolve(node.expression ?? node.left), nameText(node.name ?? node.right));
    else if (ts.isElementAccessExpression(node)) value = combine(literals(node.argumentExpression).map((key) => select(resolve(node.expression), key)));
    else if (ts.isObjectLiteralExpression(node)) value = { kind: "object", node };
    else if (ts.isArrayLiteralExpression(node)) value = { kind: "array", node };
    else if (ts.isConditionalExpression(node)) value = combine([resolve(node.whenTrue), resolve(node.whenFalse)]);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) value = combine([resolve(node.left), resolve(node.right)]);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(node.operatorToken.kind)) value = resolve(node.right);
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require" && !checker.getSymbolAtLocation(node.expression)?.valueDeclaration) value = moduleValue(literal(node.arguments[0]), node.getSourceFile(), node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : "require");
      else {
        const callee = resolve(node.expression);
        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Promise" && node.expression.name.text === "all") value = resolve(node.arguments[0]);
        if (callee?.kind === "export" && callee.name === "createPluginRuntimeStore") value = { kind: "runtime-store", value: typeValue(node.typeArguments?.[0]) };
        if (callee?.kind === "export" && callee.name === "createLazyRuntimeModule") {
          const loader = resolve(node.arguments[0]);
          if (loader?.kind === "function") value = { kind: "lazy-module", value: returned(loader.node) };
        }
        if (callee?.kind === "return") value = callee.value;
        if (callee?.kind === "function") {
          value = returned(callee.node) ?? typeValue(callee.node.type);
        }
      }
    }
    else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) value = { kind: "function", node };
    value ??= inferred(node);
    resolving.delete(node);
    cached.set(node, value);
    return value;
  }

  function returned(fn) {
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
        const values = (argumentsByParameter.get(declaration) ?? []).flatMap((argument) => literals(argument, new Set(seen)));
        if (values.length) return [...new Set(values)];
      }
    }
    const type = checker.getTypeAtLocation(node);
    const types = type.isUnion() ? type.types : [type];
    return types.every((member) => member.isStringLiteral() || member.isNumberLiteral()) ? types.map((member) => String(member.value)) : [];
  }

  function literal(node) { const values = literals(node); return values.length === 1 ? values[0] : undefined; }

  return { resolve, select, exported, moduleValue, literal, literals, typeValue };
}
