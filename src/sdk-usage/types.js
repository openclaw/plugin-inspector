import path from "node:path";
import ts from "typescript";
import { nameText } from "./syntax.js";
import { capabilityContextTypes } from "./host-context.js";

const roots = new Map([["OpenClawPluginApi", "api"], ["PluginRuntime", "runtime"]]);

/** Type syntax establishes ownership; it never means that a method executes. */
export function createTypeProvenance({ checker, resolve, select, targetRoot }) {
  const visiting = new Set();
  function typeValue(node) {
    if (!node || visiting.has(node)) return undefined;
    visiting.add(node);
    let value;
    if (ts.isTypeReferenceNode(node)) {
      const origin = resolve(node.typeName);
      if (origin?.kind === "export" && roots.has(origin.name)) value = { kind: roots.get(origin.name), path: [] };
      if (origin?.kind === "export" && capabilityContextTypes.has(origin.name)) value = { kind: "capability-context", type: checker.getTypeFromTypeNode(node) };
      if (!value && nameText(node.typeName) === "Pick" && node.typeArguments?.length === 2) {
        const [baseNode, keyNode] = node.typeArguments;
        const base = ts.isTypeQueryNode(baseNode) ? resolve(baseNode.exprName) : typeValue(baseNode);
        const keyType = checker.getTypeFromTypeNode(keyNode);
        const alternatives = keyType.isUnion() ? keyType.types : [keyType];
        if (alternatives.every((type) => type.isStringLiteral())) value = { kind: "projection", base, keys: alternatives.map((type) => type.value) };
      }
      if (!value) {
        let symbol = checker.getSymbolAtLocation(node.typeName);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isTypeAliasDeclaration(declaration)) value ??= typeValue(declaration.type);
        }
      }
    } else if (ts.isIndexedAccessTypeNode(node)) {
      const key = ts.isLiteralTypeNode(node.indexType) ? node.indexType.literal.text : undefined;
      value = select(typeValue(node.objectType), key);
    } else if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) value = typeValue(node.type);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      // The module itself is a type dependency, never a runtime load.
      value = { kind: "import-type", node };
    }
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      const values = node.types.map(typeValue).filter(Boolean);
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
      })) return { kind: root, path: [] };
      if (type.isUnion()) {
        for (const member of type.types) { const value = fromType(member); if (value) return value; }
      }
      return undefined;
    }
    return fromType(type);
  }
  return { typeValue, inferred };
}
