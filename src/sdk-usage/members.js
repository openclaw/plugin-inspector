import ts from "typescript";
import { inType, nameText, referenceKind, walk } from "./syntax.js";

export function collectSdkMembers({ sources, report, provenance }) {
  const { resolve, select, literal, literals, typeValue } = provenance;
  function record(value, kind, node, classification = inType(node) ? "type" : "runtime") {
    if (value?.kind === "union") { for (const member of value.values) record(member, kind, node, classification); return; }
    if (!["api", "runtime"].includes(value?.kind) || !value.path.length) return;
    report.add(`${value.kind}-member`, `${value.kind}.${value.path.join(".")}`, value.builtin ? "member-access" : kind, classification, node);
  }
  function hookNames(node) {
    if (!node) return [];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(hookNames);
    return literals(node);
  }
  function unresolvedSdkReceiver(value) {
    if (value?.kind === "union") return value.values.some(unresolvedSdkReceiver);
    return ["api", "runtime"].includes(value?.kind) || value?.kind === "namespace" && Boolean(value.module);
  }
  for (const source of sources) walk(source, (node) => {
    if (ts.isQualifiedName(node) && !ts.isQualifiedName(node.parent)) record(resolve(node), "type-reference", node, "type");
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (ts.isElementAccessExpression(node) && !literals(node.argumentExpression).length && unresolvedSdkReceiver(resolve(node.expression))) report.unknown(node, "Computed SDK member is not statically resolvable");
      if (node.parent.expression === node && (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))) return;
      const value = resolve(node);
      record(value, referenceKind(node) ?? "member-access", node);
    }
    if (ts.isCallExpression(node)) {
      const value = resolve(node.expression);
      record(value, "call", node.expression);
      if (!value) for (const argument of node.arguments) {
        const handle = resolve(argument);
        if (["api", "runtime"].includes(handle?.kind) && !handle.path.length) report.unknown(node, "SDK handle escapes into an unresolved external call");
      }
      if (value?.kind === "api" && value.path.length === 1 && ["on", "registerHook"].includes(value.path[0])) {
        const names = hookNames(node.arguments[0]);
        for (const name of names) report.add("hook", `hook.${name}`, "hook-registration", "runtime", node.arguments[0]);
        if (!names.length) report.unknown(node, "Hook name is not statically resolvable");
      }
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) record(resolve(node.name), "member-access", node);
    if (ts.isTypeReferenceNode(node)) {
      const value = typeValue(node);
      if (value?.kind === "projection" && value.selectionNode === node) for (const key of value.keys) record(select(value.base, key), "type-reference", node, "type");
    }
    if (ts.isIndexedAccessTypeNode(node) && !ts.isIndexedAccessTypeNode(node.parent)) {
      const selectedByPick = ts.isTypeReferenceNode(node.parent) && nameText(node.parent.typeName) === "Pick" && node.parent.typeArguments?.[0] === node;
      if (!selectedByPick) record(typeValue(node), "type-reference", node, "type");
    }
  });
}
