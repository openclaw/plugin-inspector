import ts from "typescript";

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function isSdkSpecifier(value) {
  return typeof value === "string" && (value === "openclaw/plugin-sdk" || value.startsWith("openclaw/plugin-sdk/"));
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
  while (current.parent && ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent)) && current.parent.expression === current
    || ts.isParenthesizedExpression(current.parent))) {
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
