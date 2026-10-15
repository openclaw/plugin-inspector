import ts from "typescript";
import { nameText } from "./syntax.js";

export function collectManifestContracts(file, report) {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
  if (source.parseDiagnostics.length) {
    report.unknown(source.statements[0] ?? source, "Manifest JSON could not be parsed");
    return;
  }
  const object = source.statements[0]?.expression;
  if (!object || !ts.isObjectLiteralExpression(object)) return;
  const add = (field, node) => {
    if (ts.isStringLiteralLike(node)) report.add("manifest-contract", `manifest.${field}:${node.text}`, "manifest-declaration", "declarative", node);
  };
  function values(field, node) {
    if (ts.isArrayLiteralExpression(node)) for (const item of node.elements) values(field, item);
    else if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) values(`${field}.${nameText(property.name)}`, property.initializer);
    }
    else add(field, node);
  }
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const field = nameText(property.name);
    const value = property.initializer;
    if (["channels", "providers", "skills", "contracts"].includes(field)) values(field, value);
    if (["commandAliases", "cliCommands"].includes(field) && ts.isArrayLiteralExpression(value)) {
      for (const item of value.elements) if (ts.isObjectLiteralExpression(item)) {
        const name = item.properties.find((child) => ts.isPropertyAssignment(child) && nameText(child.name) === "name");
        if (name) add(`${field}.name`, name.initializer);
      }
    }
  }
}
