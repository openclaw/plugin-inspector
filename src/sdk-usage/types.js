import path from "node:path";
import ts from "typescript";
import { nameText } from "./syntax.js";
import { capabilityContextTypes } from "./host-context.js";

const roots = new Map([["OpenClawPluginApi", "api"], ["PluginRuntime", "runtime"]]);

/** Type syntax establishes ownership; it never means that a method executes. */
export function createTypeProvenance({ checker, program, resolve, select, moduleValue, targetRoot }) {
  const visiting = new Set();
  function builtinUtility(node) {
    const symbol = checker.getSymbolAtLocation(node.typeName);
    return symbol?.declarations?.some((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
  }
  function typeValue(node) {
    if (!node || visiting.has(node)) return undefined;
    visiting.add(node);
    let value;
    if (ts.isTypeReferenceNode(node)) {
      const origin = resolve(node.typeName);
      if (origin?.kind === "export" && roots.has(origin.name)) value = { kind: roots.get(origin.name), path: [], type: checker.getTypeFromTypeNode(node) };
      if (origin?.kind === "export" && capabilityContextTypes.has(origin.name)) value = { kind: "capability-context", type: checker.getTypeFromTypeNode(node) };
      if (!value && nameText(node.typeName) === "Pick" && builtinUtility(node) && node.typeArguments?.length === 2) {
        const [baseNode, keyNode] = node.typeArguments;
        const declared = ts.isTypeQueryNode(baseNode) ? resolve(baseNode.exprName) : typeValue(baseNode);
        const base = declared?.kind === "signature" ? declared.value : declared;
        const keyType = checker.getTypeFromTypeNode(keyNode);
        const alternatives = keyType.isUnion() ? keyType.types : [keyType];
        if (alternatives.every((type) => type.isStringLiteral())) value = { kind: "projection", base, keys: alternatives.map((type) => type.value), selectionNode: node };
      }
      if (!value && ["NonNullable", "Readonly", "Required", "Partial"].includes(nameText(node.typeName)) && builtinUtility(node)) value = typeValue(node.typeArguments?.[0]);
      if (!value) {
        let symbol = checker.getSymbolAtLocation(node.typeName);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isTypeAliasDeclaration(declaration)) value ??= typeValue(declaration.type);
          if (ts.isInterfaceDeclaration(declaration)) value ??= { kind: "type-object", node: declaration, bases: declaration.heritageClauses?.flatMap((clause) => clause.types.map(typeValue)).filter(Boolean) ?? [] };
        }
      }
    } else if (ts.isExpressionWithTypeArguments(node)) {
      const origin = resolve(node.expression);
      if (origin?.kind === "export" && roots.has(origin.name)) value = { kind: roots.get(origin.name), path: [], type: checker.getTypeAtLocation(node) };
    } else if (ts.isIndexedAccessTypeNode(node)) {
      const key = ts.isLiteralTypeNode(node.indexType) ? node.indexType.literal.text : undefined;
      const declared = typeValue(node.objectType);
      value = select(declared?.kind === "signature" ? declared.value : declared, key);
    } else if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) value = typeValue(node.type);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      // The module itself is a type dependency, never a runtime load.
      value = moduleValue(node.argument.literal.text, node.getSourceFile());
      if (node.qualifier) {
        const names = [];
        function parts(name) {
          if (ts.isQualifiedName(name)) { parts(name.left); parts(name.right); }
          else names.push(name.text);
        }
        parts(node.qualifier);
        for (const name of names) value = select(value, name);
        if (value?.kind === "export" && roots.has(value.name)) value = { kind: roots.get(value.name), path: [], type: checker.getTypeFromTypeNode(node) };
      }
    }
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      const values = node.types.map(typeValue).filter(Boolean).map((value) => ts.isIntersectionTypeNode(node) && ["api", "runtime"].includes(value.kind) ? { ...value, restrictType: true } : value);
      value = values.length === 1 ? values[0] : values.length ? { kind: "union", values } : undefined;
    } else if (ts.isTypeLiteralNode(node)) value = { kind: "type-object", node };
    // A matching function signature alone does not prove the value is the SDK implementation.
    else if (ts.isTypeQueryNode(node)) value = { kind: "signature", value: resolve(node.exprName) };
    visiting.delete(node);
    return value;
  }
  function inferred(node) {
    const type = checker.getTypeAtLocation(node);
    function fromType(type) {
      // Only host definitions reached through the public SDK can infer an unannotated API handle.
      const symbol = type.aliasSymbol ?? type.symbol;
      const root = roots.get(symbol?.name);
      if (root && targetRoot && symbol.declarations?.some((declaration) => {
        const relative = path.relative(targetRoot, declaration.getSourceFile().fileName);
        return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      })) return { kind: root, path: [], type };
      if (type.isUnion()) {
        for (const member of type.types) { const value = fromType(member); if (value) return value; }
      }
      return undefined;
    }
    return fromType(type);
  }
  return { typeValue, inferred };
}
