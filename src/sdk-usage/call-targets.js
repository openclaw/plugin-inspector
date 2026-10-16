import ts from "typescript";
import { nameText } from "./syntax.js";

/** Index argument flow through actual local bodies without instantiating generic signatures. */
export function createCallTargetResolver({ checker, sourceNames, consumeWork, assignments }) {
  const visiting = new Set();
  const constructing = new Set();
  const selecting = new Map();
  const bindingCaches = new WeakMap();
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
      return [declaration];
    }), ...(assignments.get(symbol) ?? []).flatMap((expression) => values(expression, bindings))];
  }
  function bindingValues(declaration, key, bindings) {
    const owner = declaration.parent.parent;
    if (ts.isBindingElement(owner)) {
      const parentKey = nameText(owner.propertyName ?? owner.name);
      return bindingValues(owner, parentKey, bindings).flatMap((value) => properties(value, key, bindings) ?? []);
    }
    return properties(owner.initializer, key, bindings) ?? values(declaration.initializer, bindings);
  }
  function properties(expression, key, bindings) {
    if (!expression || key === undefined) return undefined;
    const keys = selecting.get(expression) ?? new Set();
    if (keys.has(key)) return [];
    selecting.set(expression, keys);
    keys.add(key);
    try {
      let found = false;
      const result = values(expression, bindings).flatMap((value) => {
        if (ts.isArrayLiteralExpression(value) && value.elements[Number(key)]) { found = true; return values(value.elements[Number(key)], bindings); }
        if (!ts.isObjectLiteralExpression(value)) return [];
        for (const property of [...value.properties].reverse()) {
          if (ts.isSpreadAssignment(property)) {
            const spread = properties(property.expression, key, bindings);
            if (spread !== undefined) { found = true; return spread; }
            const spreadValues = values(property.expression, bindings);
            if (!spreadValues.length || !spreadValues.every(ts.isObjectLiteralExpression)) { found = true; return []; }
          } else if (nameText(property.name) === key) {
            found = true;
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
    if (!expression || visiting.has(expression) || !consumeWork(expression)) return [];
    let cache = bindingCaches.get(bindings);
    if (!cache) { cache = new WeakMap(); bindingCaches.set(bindings, cache); }
    if (cache.has(expression)) return cache.get(expression);
    visiting.add(expression);
    try {
      const result = [...new Set(evaluate(expression, bindings))];
      cache.set(expression, result);
      return result;
    } finally { visiting.delete(expression); }
  }
  function evaluate(expression, bindings) {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isExpressionWithTypeArguments(expression)) return values(expression.expression, bindings);
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
      return targets(expression.expression, false, bindings).flatMap((fn) => {
        const inner = new Map(bindings);
        for (const [index, parameter] of fn.parameters.entries()) {
          const argument = expression.arguments[index] ?? parameter.initializer;
          if (argument) inner.set(parameter, argument);
        }
        const results = [];
        function returns(node) {
          if (ts.isReturnStatement(node)) results.push(...values(node.expression, inner));
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, returns);
        }
        if (ts.isBlock(fn.body)) returns(fn.body);
        else results.push(...values(fn.body, inner));
        return results;
      });
    }
    return [expression];
  }
  function targets(expression, construct, bindings = new Map()) {
    return [...new Set(values(expression, bindings).flatMap((value) => {
      if (construct && ts.isClassLike(value)) {
        if (constructing.has(value)) return [];
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
