import ts from "typescript";

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function isSdkSpecifier(value) {
  return typeof value === "string" && (value === "openclaw/plugin-sdk" || value.startsWith("openclaw/plugin-sdk/"));
}

/** Proven string fragments before the first unresolved expression. */
export function stringExpressionPrefix(node, checker, seen = new Set()) {
  if (!node || seen.has(node)) return { prefix: "", complete: false };
  const next = new Set([...seen, node]);
  if (ts.isStringLiteralLike(node)) return { prefix: node.text, complete: true };
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return stringExpressionPrefix(node.expression, checker, next);
  if (ts.isIdentifier(node)) return stringExpressionPrefix(checker.getSymbolAtLocation(node)?.valueDeclaration?.initializer, checker, next);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringExpressionPrefix(node.left, checker, next);
    if (!left.complete) return left;
    const right = stringExpressionPrefix(node.right, checker, next);
    return { prefix: left.prefix + right.prefix, complete: right.complete };
  }
  if (ts.isTemplateExpression(node)) {
    let prefix = node.head.text;
    for (const span of node.templateSpans) {
      const value = stringExpressionPrefix(span.expression, checker, next);
      prefix += value.prefix;
      if (!value.complete) return { prefix, complete: false };
      prefix += span.literal.text;
    }
    return { prefix, complete: true };
  }
  return { prefix: "", complete: false };
}

export function inType(node) {
  if (node.getSourceFile().isDeclarationFile) return true;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isExpressionWithTypeArguments(current) && ts.isHeritageClause(current.parent) && current.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(current.parent.parent)) return false;
    if (ts.isTypeNode(current)) return true;
    if (ts.isExpressionStatement(current) || ts.isStatement(current)) return false;
  }
  return false;
}

export function referenceKind(node) {
  if (inType(node)) return "type-reference";
  let current = node;
  let member = false;
  function forwarded(parent, child) {
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent)) return parent.expression === child;
    if (ts.isConditionalExpression(parent)) return parent.whenTrue === child || parent.whenFalse === child;
    return ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind);
  }
  while (current.parent && ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent)) && current.parent.expression === current
    || forwarded(current.parent, current))) {
    member ||= ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent);
    current = current.parent;
  }
  if ((ts.isCallExpression(current.parent) || ts.isNewExpression(current.parent)) && current.parent.expression === current) return "call";
  if (member) return "member-access";
  return null;
}

export function isDependencyDeclaration(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current) || ts.isImportEqualsDeclaration(current)) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

export function nameText(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : undefined;
}
