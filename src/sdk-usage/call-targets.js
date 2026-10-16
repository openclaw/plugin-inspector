import ts from "typescript";
import { nameText } from "./syntax.js";

/** Index argument flow through actual local bodies without instantiating generic signatures. */
export function createCallTargetResolver({ checker, program, localSource, sourceNames, consumeWork, assignments, overwrittenNativeMembers, onUnresolvedCall, onDeferredParameterCall, parameterArguments }) {
  const visiting = new Set();
  const constructing = new Set();
  const expandingArrays = new Set();
  const selecting = new Map();
  const bindingCaches = new WeakMap();
  const emptyBindings = new Map();
  let cycleGeneration = 0;
  let unresolvedGeneration = 0;
  let deferredGeneration = 0;
  let currentCall;
  function declarations(symbol, bindings) {
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return [...(symbol?.declarations ?? []).flatMap((declaration) => {
      if (!sourceNames.has(declaration.getSourceFile().fileName)) return [];
      if (bindings.has(declaration)) return values(bindings.get(declaration), bindings);
      if (ts.isParameter(declaration) && declaration.initializer) {
        if (!parameterArguments) {
          deferredGeneration++;
          onDeferredParameterCall(currentCall);
          return [];
        }
        const choices = parameterArguments(declaration).map((argument) => [...new Set(values(argument, bindings))]);
        const first = choices[0] ?? [];
        if (!first.length || choices.some((choice) => choice.length !== first.length || choice.some((value) => !first.includes(value)))) {
          unresolvedGeneration++;
          return [];
        }
        return first;
      }
      if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration)) return values(declaration.initializer, bindings);
      if (ts.isBindingElement(declaration)) {
        const key = ts.isArrayBindingPattern(declaration.parent) ? String(declaration.parent.elements.indexOf(declaration)) : nameText(declaration.propertyName ?? declaration.name);
        return bindingValues(declaration, key, bindings);
      }
      if (ts.isShorthandPropertyAssignment(declaration)) return declarations(checker.getShorthandAssignmentValueSymbol(declaration), bindings);
      if (ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) return values(declaration, bindings);
      return [declaration];
    }), ...(assignments.get(symbol) ?? []).filter((expression) => !visiting.has(expression.parent)).flatMap((expression) => values(ts.isBinaryExpression(expression.parent) && [ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(expression.parent.operatorToken.kind) ? expression.parent : expression, bindings))];
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
        if (ts.isArrayLiteralExpression(value) && String(Number(key)) === key && Number.isInteger(Number(key)) && Number(key) >= 0) {
          found = true;
          return arraySelection(value, Number(key), bindings).selected;
        }
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
  function arraySelection(array, index, bindings) {
    const selected = new Set();
    let remaining = new Set([index]);
    if (!consumeWork(array)) return { selected: [], remaining: [] };
    if (expandingArrays.has(array)) { cycleGeneration++; return { selected: [], remaining: [] }; }
    expandingArrays.add(array);
    try {
      for (const element of array.elements) {
        if (!remaining.size || !consumeWork(element)) break;
        const next = new Set();
        for (const offset of remaining) {
          if (ts.isSpreadElement(element)) {
            const spreads = values(element.expression, bindings);
            if (!spreads.length) unresolvedGeneration++;
            for (const spread of spreads) {
              // An unknown spread has no known length, so later positions cannot be guessed.
              if (!ts.isArrayLiteralExpression(spread)) { unresolvedGeneration++; continue; }
              const result = arraySelection(spread, offset, bindings);
              for (const value of result.selected) selected.add(value);
              for (const rest of result.remaining) next.add(rest);
            }
          } else if (offset === 0) {
            for (const value of values(element, bindings)) selected.add(value);
          } else next.add(offset - 1);
        }
        remaining = next;
      }
      return { selected: [...selected], remaining: [...remaining] };
    } finally { expandingArrays.delete(array); }
  }
  function values(expression, bindings) {
    if (!expression || !consumeWork(expression)) return [];
    if (visiting.has(expression)) { cycleGeneration++; return []; }
    let cache = bindingCaches.get(bindings);
    if (!cache) { cache = new WeakMap(); bindingCaches.set(bindings, cache); }
    if (cache.has(expression)) {
      const cached = cache.get(expression);
      // An alias must preserve uncertainty even when its target list is memoized.
      if (cached.unresolved) unresolvedGeneration++;
      return cached.result;
    }
    visiting.add(expression);
    try {
      const generation = cycleGeneration;
      const unresolvedBefore = unresolvedGeneration;
      const deferredBefore = deferredGeneration;
      const result = [...new Set(evaluate(expression, bindings))];
      // A cycle cut depends on the current traversal, not only these bindings.
      if (generation === cycleGeneration && deferredBefore === deferredGeneration) cache.set(expression, { result, unresolved: unresolvedBefore !== unresolvedGeneration });
      return result;
    } finally { visiting.delete(expression); }
  }
  function evaluate(expression, bindings) {
    if (ts.isGetAccessorDeclaration(expression)) return expression.body ? returnedValues(expression, bindings) : [];
    if (ts.isSetAccessorDeclaration(expression)) return [];
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isExpressionWithTypeArguments(expression) || ts.isAwaitExpression(expression)) return values(expression.expression, bindings);
    if (ts.isIdentifier(expression)) {
      const resolved = declarations(checker.getSymbolAtLocation(expression), bindings);
      return resolved.length || !undefinedValue(expression) ? resolved : [expression];
    }
    if (expression.kind === ts.SyntaxKind.SuperKeyword) {
      let owner = expression.parent;
      while (owner && !ts.isClassLike(owner)) owner = owner.parent;
      const base = owner?.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
      return base ? values(base.expression, bindings) : [];
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const keys = ts.isPropertyAccessExpression(expression) ? [expression.name.text] : literalKeys(expression.argumentExpression, bindings);
      const fallback = () => declarations(checker.getSymbolAtLocation(expression), bindings);
      return keys.length ? keys.flatMap((key) => properties(expression.expression, key, bindings) ?? fallback()) : fallback();
    }
    if (ts.isConditionalExpression(expression)) {
      const whenTrue = values(expression.whenTrue, bindings);
      const whenFalse = values(expression.whenFalse, bindings);
      if (!whenTrue.length || !whenFalse.length) unresolvedGeneration++;
      return [...whenTrue, ...whenFalse];
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.kind;
      if ([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken].includes(operator)) return values(expression.right, bindings);
      const nullish = [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(operator);
      const either = [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.BarBarEqualsToken].includes(operator);
      const both = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken].includes(operator);
      if (nullish || either || both) {
        const left = values(expression.left, bindings);
        const takeRight = (value) => {
          const truth = truthiness(value);
          if (nullish) return value.kind === ts.SyntaxKind.NullKeyword || undefinedValue(value) ? true : truth === undefined ? undefined : false;
          return both || truth === undefined ? truth : !truth;
        };
        return [...left.filter((value) => takeRight(value) !== true), ...(!left.length || left.some((value) => takeRight(value) !== false) ? values(expression.right, bindings) : [])];
      }
    }
    if (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression)) {
      if (ts.isTaggedTemplateExpression(expression)) {
        const args = [expression.template, ...(ts.isTemplateExpression(expression.template) ? expression.template.templateSpans.map((span) => span.expression) : [])];
        return callReturns(expression.tag, args, bindings);
      }
      if (expression.expression.kind === ts.SyntaxKind.ImportKeyword && expression.arguments[0] && ts.isStringLiteralLike(expression.arguments[0])) {
        const source = localSource(expression.arguments[0].text, expression.getSourceFile());
        return source && sourceNames.has(source.fileName) ? [source] : [];
      }
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee) && ["all", "resolve"].includes(callee.name.text) && ts.isIdentifier(callee.expression) && callee.expression.text === "Promise") {
        const declarations = checker.getSymbolAtLocation(callee.expression)?.declarations;
        if (declarations?.length && declarations.every((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile())) && !overwrittenNativeMembers.has(checker.getSymbolAtLocation(callee.name))) return values(expression.arguments[0], bindings);
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "bind" && expression.arguments.length <= 1) {
        const declarations = checker.getSymbolAtLocation(callee.name)?.declarations;
        if (declarations?.length && declarations.every((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile())) && !overwrittenNativeMembers.has(checker.getSymbolAtLocation(callee.name))) return values(callee.expression, bindings);
      }
      return callReturns(expression.expression, expression.arguments, bindings);
    }
    return [expression];
  }
  function undefinedValue(value) {
    return ts.isVoidExpression(value) || ts.isIdentifier(value) && value.text === "undefined" && !checker.getSymbolAtLocation(value)?.valueDeclaration;
  }
  function truthiness(value) {
    if (undefinedValue(value)) return false;
    if (value.kind === ts.SyntaxKind.TrueKeyword || ts.isFunctionLike(value) || ts.isClassLike(value) || ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value) || ts.isRegularExpressionLiteral(value) || ts.isNewExpression(value)) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword) return false;
    if (ts.isNumericLiteral(value)) return Number(value.text) !== 0;
    if (ts.isStringLiteralLike(value)) return Boolean(value.text);
    return undefined;
  }
  function literalKeys(expression, bindings) {
    return values(expression, bindings).flatMap((value) => {
      if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)) return [value.text];
      if (ts.isPrefixUnaryExpression(value) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(value.operator)) return values(value.operand, bindings).filter(ts.isNumericLiteral).map((number) => String(Number(number.text) * (value.operator === ts.SyntaxKind.MinusToken ? -1 : 1)));
      return [];
    });
  }
  function callReturns(callee, args, bindings) {
    return targets(callee, false, bindings).flatMap((fn) => {
      const inner = new Map(bindings);
      for (const [index, parameter] of fn.parameters.entries()) {
        const argument = args[index] ?? parameter.initializer;
        if (argument) inner.set(parameter, argument);
      }
      return returnedValues(fn, inner);
    });
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
  return (node) => {
    const generation = unresolvedGeneration;
    currentCall = node;
    try {
      const result = targets(node.expression, ts.isNewExpression(node) || node.expression.kind === ts.SyntaxKind.SuperKeyword);
      if (generation !== unresolvedGeneration) onUnresolvedCall(node);
      return result;
    } finally { currentCall = undefined; }
  };
}
