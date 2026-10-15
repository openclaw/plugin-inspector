import ts from "typescript";
import { inType, isDependencyDeclaration, isSdkSpecifier, nameText, referenceKind, stringExpressionPrefix, walk } from "./syntax.js";

export function collectSdkImports({ sources, checker, report, provenance }) {
  const { resolve, select, moduleValue, typeValue } = provenance;
  function record(value, kind, node, typeOnly = inType(node)) {
    if (value?.kind === "union") { for (const item of value.values) record(item, kind, node, typeOnly); return; }
    if (value?.kind !== "export") return;
    report.add("sdk-export", `${value.module}#${value.name}`, kind, typeOnly ? "type" : "runtime", node);
    if (value.dependencyKind && kind !== value.dependencyKind) report.add("sdk-export", `${value.module}#${value.name}`, value.dependencyKind, "runtime", node);
  }
  function dependency(namespace, exported, kind, typeOnly, node, direct) {
    if (direct) report.add("sdk-module", namespace.module, kind, typeOnly || node.getSourceFile().isDeclarationFile ? "type" : "runtime", node);
    if (exported) record(select(namespace, exported), kind, node, typeOnly || node.getSourceFile().isDeclarationFile);
  }
  function directDependencyBinding(binding) {
    let owner = binding.parent.parent;
    let arrayIndex;
    while (ts.isBindingElement(owner)) {
      if (ts.isArrayBindingPattern(owner.parent)) arrayIndex = owner.parent.elements.indexOf(owner);
      owner = owner.parent.parent;
    }
    let expression = owner.initializer;
    if (ts.isParameter(owner) && ts.isCallExpression(owner.parent.parent) && ts.isPropertyAccessExpression(owner.parent.parent.expression) && owner.parent.parent.expression.name.text === "then") expression = owner.parent.parent.expression.expression;
    while (expression && (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression))) expression = expression.expression;
    if (expression && ts.isCallExpression(expression) && expression.expression.getText() === "Promise.all" && ts.isArrayLiteralExpression(expression.arguments[0]) && arrayIndex !== undefined) expression = expression.arguments[0].elements[arrayIndex];
    return expression && ts.isCallExpression(expression) && (expression.expression.kind === ts.SyntaxKind.ImportKeyword || expression.expression.getText() === "require");
  }
  for (const source of sources) walk(source, (node) => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const namespace = resolve(node.name);
      if (namespace) dependency(namespace, "*", node.isTypeOnly ? "type-import" : "require", node.isTypeOnly, node, Boolean(namespace.module));
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const namespace = moduleValue(node.moduleSpecifier.text, source);
      if (!namespace) return;
      const direct = isSdkSpecifier(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (!clause) dependency(namespace, null, "side-effect-import", false, node, direct);
      if (clause?.name) dependency(namespace, "default", clause.isTypeOnly ? "type-import" : "import", clause.isTypeOnly, clause.name, direct);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) dependency(namespace, "*", clause.isTypeOnly ? "type-import" : "import", clause.isTypeOnly, clause.namedBindings, direct);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
        const typeOnly = clause.isTypeOnly || binding.isTypeOnly;
        dependency(namespace, (binding.propertyName ?? binding.name).text, typeOnly ? "type-import" : "import", typeOnly, binding, direct);
      }
    }
    if (ts.isExportDeclaration(node)) {
      const namespace = node.moduleSpecifier && moduleValue(node.moduleSpecifier.text, source);
      const direct = node.moduleSpecifier && isSdkSpecifier(node.moduleSpecifier.text);
      if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const binding of node.exportClause.elements) {
        const typeOnly = node.isTypeOnly || binding.isTypeOnly;
        if (namespace) dependency(namespace, (binding.propertyName ?? binding.name).text, typeOnly ? "type-reexport" : "reexport", typeOnly, binding, direct);
        else record(resolve(binding.propertyName ?? binding.name), typeOnly ? "type-reexport" : "reexport", binding, typeOnly);
      }
      else if (namespace) dependency(namespace, "*", node.isTypeOnly ? "type-reexport" : "reexport", node.isTypeOnly, node, direct);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require" && !checker.getSymbolAtLocation(node.expression)?.valueDeclaration)) {
      const namespace = resolve(node);
      if (namespace?.kind !== "namespace") {
        if (isSdkSpecifier(stringExpressionPrefix(node.arguments[0], checker).prefix)) report.unknown(node, "SDK module import is not statically resolvable");
        return;
      }
      const kind = node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : "require";
      let owner = node;
      while (ts.isAwaitExpression(owner.parent) || ts.isParenthesizedExpression(owner.parent)) owner = owner.parent;
      let pattern = ts.isVariableDeclaration(owner.parent) ? owner.parent.name : undefined;
      if (ts.isArrayLiteralExpression(owner.parent) && ts.isCallExpression(owner.parent.parent) && owner.parent.parent.expression.getText() === "Promise.all") {
        const index = owner.parent.elements.indexOf(owner);
        let group = owner.parent.parent;
        while (ts.isAwaitExpression(group.parent) || ts.isParenthesizedExpression(group.parent)) group = group.parent;
        if (ts.isVariableDeclaration(group.parent) && ts.isArrayBindingPattern(group.parent.name)) pattern = group.parent.name.elements[index]?.name;
      }
      if (ts.isPropertyAccessExpression(owner.parent) && owner.parent.name.text === "then" && ts.isCallExpression(owner.parent.parent)) pattern = owner.parent.parent.arguments[0]?.parameters?.[0]?.name;
      if (pattern && ts.isObjectBindingPattern(pattern)) {
        for (const binding of pattern.elements) dependency(namespace, nameText(binding.propertyName ?? binding.name), kind, false, binding, Boolean(namespace.module));
      } else if (ts.isPropertyAccessExpression(owner.parent) && owner.parent.name.text !== "then") dependency(namespace, owner.parent.name.text, kind, false, owner.parent, Boolean(namespace.module));
      else dependency(namespace, "*", kind, false, node, Boolean(namespace.module));
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      const namespace = moduleValue(node.argument.literal.text, source);
      let owner = node;
      while (ts.isParenthesizedTypeNode(owner.parent)) owner = owner.parent;
      const narrowed = ts.isIndexedAccessTypeNode(owner.parent) && owner.parent.objectType === owner
        || ts.isTypeReferenceNode(owner.parent) && owner.parent.typeArguments?.[0] === owner && typeValue(owner.parent)?.kind === "projection";
      if (namespace) dependency(namespace, node.qualifier ? nameText(node.qualifier) : narrowed ? null : "*", "type-reference", true, node, Boolean(namespace.module));
    }
    if (ts.isIndexedAccessTypeNode(node)) record(typeValue(node), "type-reference", node, true);
    if (ts.isTypeReferenceNode(node)) {
      const projected = typeValue(node);
      if (projected?.kind === "projection" && projected.selectionNode === node) for (const key of projected.keys) record(select(projected.base, key), "type-reference", node, true);
    }
    if (isDependencyDeclaration(node)) return;
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && !directDependencyBinding(node)) record(resolve(node.name), "member-access", node);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) record(resolve(node.expression), "call", node);
    if (ts.isIdentifier(node)) {
      // The complete access is handled below, including the built-in boundary.
      if ((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node) return;
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node || ts.isQualifiedName(node.parent) && node.parent.right === node) return;
      if (node.parent.name === node && !ts.isShorthandPropertyAssignment(node.parent)) return;
      const value = resolve(node);
      if (value?.kind === "namespace") return;
      const kind = referenceKind(node);
      if (kind) record(value, kind, node);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isQualifiedName(node)) {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "then" && resolve(node.expression)?.kind === "namespace") return;
      if (node.parent.expression === node && (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))) return;
      const kind = referenceKind(node) ?? "member-access";
      record(resolve(node), kind, node);
    }
  });
}
