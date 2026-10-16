import ts from "typescript";
import { nameText } from "./syntax.js";

/** Index argument flow through actual local bodies without instantiating generic signatures. */
export function createCallTargetResolver({ checker, program, localSource, sourceNames, consumeWork, assignments }) {
  const visiting = new Set();
  const constructing = new Set();
  const selecting = new Map();
  const bindingCaches = new WeakMap();
  const emptyBindings = new Map();
  let cycleGeneration = 0;
  function declarations(symbol, bindings) {
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return [...(symbol?.declarations ?? []).flatMap((declaration) => {
      if (!sourceNames.has(declaration.getSourceFile().fileName)) return [];
      if (bindings.has(declaration)) return values(bindings.get(declaration), bindings);
      if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration)) return values(declaration.initializer, bindings);
      if (ts.isBindingElement(declaration)) {
        const key = ts.isArrayBindingPattern(declaration.parent) ? String(declaration.parent.elements.indexOf(declaration)) : nameText(declaration.propertyName ?? declaration.name);
        return bindingValues(declaration, key, bindings);
      }
      if (ts.isShorthandPropertyAssignment(declaration)) return declarations(checker.getShorthandAssignmentValueSymbol(declaration), bindings);
      if (ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) return values(declaration, bindings);
      return [declaration];
    }), ...(assignments.get(symbol) ?? []).flatMap((expression) => values(expression, bindings))];
  }
  function bindingValues(declaration, key, bindings) {
    const owner = declaration.parent.parent;
    if (ts.isBindingElement(owner)) {
      const parentKey = ts.isArrayBindingPattern(owner.parent) ? String(owner.parent.elements.indexOf(owner)) : nameText(owner.propertyName ?? owner.name);
      return bindingValues(owner, parentKey, bindings).flatMap((value) => properties(value, key, bindings) ?? []);
    }
    return properties(owner.initializer, key, bindings) ?? values(declaration.initializer, bindings);
  }
  function properties(expression, key, bindings) {
    if (!expression || key === undefined) return undefined;
    const keys = selecting.get(expression) ?? new Set();
    if (keys.has(key)) { cycleGeneration++; return []; }
    selecting.set(expression, keys);
    keys.add(key);
    try {
      let found = false;
      const result = values(expression, bindings).flatMap((value) => {
        if (ts.isSourceFile(value)) {
          const symbol = checker.getSymbolAtLocation(value);
          const exported = symbol && checker.getExportsOfModule(symbol).find((item) => item.name === key);
          if (exported) { found = true; return declarations(exported, bindings); }
          return [];
        }
        if (ts.isArrayLiteralExpression(value) && value.elements[Number(key)]) { found = true; return values(value.elements[Number(key)], bindings); }
        if (!ts.isObjectLiteralExpression(value)) return [];
        let setterOnly = false;
        for (const property of [...value.properties].reverse()) {
          if (ts.isSpreadAssignment(property)) {
            const spread = properties(property.expression, key, bindings);
            if (spread !== undefined) { found = true; return setterOnly ? [] : spread; }
            const spreadValues = values(property.expression, bindings);
            if (!spreadValues.length || !spreadValues.every(ts.isObjectLiteralExpression)) { found = true; return []; }
          } else if (nameText(property.name) === key) {
            found = true;
            // A setter preserves an earlier getter, but replaces a data property.
            if (ts.isSetAccessorDeclaration(property)) { setterOnly = true; continue; }
            if (setterOnly && !ts.isGetAccessorDeclaration(property)) return [];
            return ts.isShorthandPropertyAssignment(property)
              ? declarations(checker.getShorthandAssignmentValueSymbol(property), bindings)
              : values(property.initializer ?? property, bindings);
          }
        }
        return [];
      });
      return found ? result : undefined;
    } finally {
      keys.delete(key);
      if (!keys.size) selecting.delete(expression);
    }
  }
  function values(expression, bindings) {
    if (!expression || !consumeWork(expression)) return [];
    if (visiting.has(expression)) { cycleGeneration++; return []; }
    let cache = bindingCaches.get(bindings);
    if (!cache) { cache = new WeakMap(); bindingCaches.set(bindings, cache); }
    if (cache.has(expression)) return cache.get(expression);
    visiting.add(expression);
    try {
      const generation = cycleGeneration;
      const result = [...new Set(evaluate(expression, bindings))];
      // A cycle cut depends on the current traversal, not only these bindings.
      if (generation === cycleGeneration) cache.set(expression, result);
      return result;
    } finally { visiting.delete(expression); }
  }
  function evaluate(expression, bindings) {
    if (ts.isGetAccessorDeclaration(expression)) return expression.body ? returnedValues(expression, bindings) : [];
    if (ts.isSetAccessorDeclaration(expression)) return [];
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isExpressionWithTypeArguments(expression) || ts.isAwaitExpression(expression)) return values(expression.expression, bindings);
    if (ts.isIdentifier(expression)) return declarations(checker.getSymbolAtLocation(expression), bindings);
    if (expression.kind === ts.SyntaxKind.SuperKeyword) {
      let owner = expression.parent;
      while (owner && !ts.isClassLike(owner)) owner = owner.parent;
      const base = owner?.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
      return base ? values(base.expression, bindings) : [];
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const key = ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : undefined;
      const direct = properties(expression.expression, key, bindings);
      return direct ?? declarations(checker.getSymbolAtLocation(expression), bindings);
    }
    if (ts.isConditionalExpression(expression)) return [...values(expression.whenTrue, bindings), ...values(expression.whenFalse, bindings)];
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) return [...values(expression.left, bindings), ...values(expression.right, bindings)];
    if (ts.isCallExpression(expression)) {
      if (expression.expression.kind === ts.SyntaxKind.ImportKeyword && expression.arguments[0] && ts.isStringLiteralLike(expression.arguments[0])) {
        const source = localSource(expression.arguments[0].text, expression.getSourceFile());
        return source && sourceNames.has(source.fileName) ? [source] : [];
      }
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "all" && ts.isIdentifier(callee.expression) && callee.expression.text === "Promise") {
        const declarations = checker.getSymbolAtLocation(callee.expression)?.declarations;
        if (declarations?.length && declarations.every((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile()))) return values(expression.arguments[0], bindings);
      }
      return targets(expression.expression, false, bindings).flatMap((fn) => {
        const inner = new Map(bindings);
        for (const [index, parameter] of fn.parameters.entries()) {
          const argument = expression.arguments[index] ?? parameter.initializer;
          if (argument) inner.set(parameter, argument);
        }
        return returnedValues(fn, inner);
      });
    }
    return [expression];
  }
  function returnedValues(fn, bindings) {
    const results = [];
    function returns(node) {
      if (ts.isReturnStatement(node)) results.push(...values(node.expression, bindings));
      else if (!ts.isFunctionLike(node)) ts.forEachChild(node, returns);
    }
    if (ts.isBlock(fn.body)) returns(fn.body);
    else results.push(...values(fn.body, bindings));
    return results;
  }
  function targets(expression, construct, bindings = emptyBindings) {
    return [...new Set(values(expression, bindings).flatMap((value) => {
      if (construct && ts.isClassLike(value)) {
        if (constructing.has(value)) { cycleGeneration++; return []; }
        constructing.add(value);
        try {
          const constructors = value.members.filter((member) => ts.isConstructorDeclaration(member) && member.body);
          if (constructors.length) return constructors;
          const base = value.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
          return base ? targets(base.expression, true, bindings) : [];
        } finally { constructing.delete(value); }
      }
      return ts.isFunctionLike(value) && value.body ? [value] : [];
    }))];
  }
  return (node) => targets(node.expression, ts.isNewExpression(node) || node.expression.kind === ts.SyntaxKind.SuperKeyword);
}
