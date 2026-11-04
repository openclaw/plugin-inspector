import { Parser } from "acorn";
import { analyze } from "eslint-scope";
import { requestedScopeNames } from "../../src/runtime-imports.js";
import { analyzeScopeFacts } from "../../src/scope-facts.js";

// Compares src/scope-facts.js with eslint-scope's full ScopeManager for the
// names the runtime-import analysis requests. Returns { skipped } when the
// analysis would not use scope facts (unparseable, direct eval, `with`, deep).
export function compareScopeFacts(text) {
  let ast;
  try {
    ast = Parser.parse(text, {
      ecmaVersion: "latest", ranges: true, sourceType: "script",
      allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      allowHashBang: true,
    });
  } catch {
    return { skipped: true, differences: [] };
  }
  const nodes = [];
  let dynamic = false;
  let maxDepth = 0;
  const visit = (node, depth) => {
    if (!node || typeof node.type !== "string") return;
    nodes.push(node);
    if (depth > maxDepth) maxDepth = depth;
    if (node.type === "WithStatement" || (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "eval")) dynamic = true;
    for (const key in node) {
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) visit(child, depth + 1);
      else if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  try {
    visit(ast, 0);
  } catch {
    return { skipped: true, differences: [] };
  }
  if (dynamic || maxDepth > 500) return { skipped: true, differences: [] };
  const options = {
    ecmaVersion: 2026,
    sourceType: ast.body.some((node) => /^(?:Import|Export).*Declaration$/.test(node.type)) ? "module" : "commonjs",
  };
  const names = requestedScopeNames(nodes);
  let full;
  let light;
  let fullError;
  let lightError;
  try {
    full = analyze(ast, options);
  } catch (error) {
    fullError = String(error?.message ?? error);
  }
  try {
    light = analyzeScopeFacts(ast, options, names);
  } catch (error) {
    lightError = String(error?.message ?? error);
  }
  if (fullError || lightError) {
    return { skipped: false, differences: [`analysis error: full ${fullError} / facts ${lightError}`] };
  }
  const signature = (variable) => JSON.stringify({
    defs: variable.defs.length,
    identifiers: variable.identifiers.map((identifier) => identifier.start),
    references: variable.references.map((reference) => [reference.identifier.start, reference.isRead(), reference.isWrite(), Boolean(reference.init), reference.isStatic()]),
  });
  const key = (variable) => `${variable.name}@${variable.identifiers.length ? variable.identifiers[0].start : `scope:${variable.scope.block.start}`}`;
  const fullVariables = new Map();
  for (const scope of full.scopes) {
    for (const variable of scope.variables) if (names.has(variable.name)) fullVariables.set(key(variable), signature(variable));
  }
  const lightVariables = new Map(light.variables.map((variable) => [key(variable), signature(variable)]));
  const differences = [];
  for (const [name, value] of fullVariables) {
    // eslint-scope declares `arguments` in every non-arrow function; facts
    // only when requested, and an unreferenced implicit variable has no effect.
    if (!lightVariables.has(name)) {
      if (JSON.parse(value).references.length || JSON.parse(value).identifiers.length) differences.push(`missing ${name}`);
      continue;
    }
    if (lightVariables.get(name) !== value) differences.push(`variable ${name}: full ${value} / facts ${lightVariables.get(name)}`);
  }
  for (const name of lightVariables.keys()) if (!fullVariables.has(name)) differences.push(`extra ${name}`);
  for (const node of nodes) {
    if (node.type !== "ImportDeclaration" && node.type !== "VariableDeclarator") continue;
    const fullDeclared = full.getDeclaredVariables(node).filter((variable) => names.has(variable.name)).map(key).sort().join(",");
    const lightDeclared = light.getDeclaredVariables(node).map(key).sort().join(",");
    if (fullDeclared !== lightDeclared) differences.push(`declared at ${node.start}: full ${fullDeclared} / facts ${lightDeclared}`);
  }
  return { skipped: false, differences };
}
