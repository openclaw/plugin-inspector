import { Definition, Referencer } from "eslint-scope";

// Scope facts for a few names, computed with eslint-scope's own Referencer.
//
// Runtime-import classification asks eslint-scope about very few names: is a
// `require(...)` callee lexically declared, which references reach a
// `createRequire` import or its handle, and which references reach a few
// bindings (namespace imports, `.then` callback parameters, declarator ids).
// A full ScopeManager also builds a Reference for every identifier and a
// Variable for every declaration; for a large bundle that graph is several MB
// that lives, and is promoted, while the file is analyzed.
//
// This runs the unchanged Referencer (so which identifiers are references or
// definitions, in which scope, with which flags, and in which order, is
// eslint-scope's) against a scope manager whose scopes keep declarations and
// references only for the requested names. Resolution follows eslint-scope's
// Scope#__close: a scope resolves its pending references when it closes and
// delegates the rest upward, function scopes reject parameter references to
// body-only declarations, non-arrow function scopes declare `arguments`, and
// the global scope closes statically. A name's resolution depends only on that
// name's declarations, so restricting to requested names changes nothing for
// them. Callers must use the full ScopeManager when eslint-scope would treat
// scopes as dynamic (direct `eval`, `with`); `detectedEval` reports the former.
export function analyzeScopeFacts(ast, { ecmaVersion, sourceType }, names) {
  const options = {
    optimistic: false,
    nodejsScope: false,
    impliedStrict: false,
    sourceType,
    ecmaVersion,
    childVisitorKeys: null,
    fallback: "iteration",
  };
  const manager = new FactScopeManager(options, names);
  const referencer = new Referencer(options, manager);
  referencer.visit(ast);
  if (manager.__currentScope !== null) throw new Error("currentScope should be null.");
  return manager;
}

const READ = 0x1;
const WRITE = 0x2;

class FactReference {
  constructor(identifier, from, flag, init) {
    this.identifier = identifier;
    this.from = from;
    this.flag = flag;
    this.init = init;
    this.resolved = null;
  }

  isRead() {
    return Boolean(this.flag & READ);
  }

  isWrite() {
    return Boolean(this.flag & WRITE);
  }

  // Without eval or with, every scope is static and nothing is tainted.
  isStatic() {
    return this.resolved !== null;
  }
}

class FactVariable {
  constructor(name, scope) {
    this.name = name;
    this.scope = scope;
    this.identifiers = [];
    this.defs = [];
    this.references = [];
  }
}

const VARIABLE_SCOPES = new Set(["global", "module", "function", "class-field-initializer", "class-static-block"]);

class FactScope {
  constructor(manager, type, upper, block, isMethodDefinition) {
    this.manager = manager;
    this.type = type;
    this.upper = upper;
    this.block = block;
    this.variableScope = VARIABLE_SCOPES.has(type) ? this : upper.variableScope;
    this.isStrict = Boolean(upper?.isStrict) || isMethodDefinition || type === "class" || type === "module";
    this.set = undefined;
    this.left = undefined;
    if (type === "function" && block.type !== "ArrowFunctionExpression" && manager.names.has("arguments")) {
      this.variable("arguments");
    }
  }

  variable(name) {
    this.set ??= new Map();
    let variable = this.set.get(name);
    if (!variable) {
      this.set.set(name, variable = new FactVariable(name, this));
      this.manager.variables.push(variable);
    }
    return variable;
  }

  __define(node, def) {
    if (!node || node.type !== "Identifier" || !this.manager.names.has(node.name)) return;
    const variable = this.variable(node.name);
    if (def) {
      variable.defs.push(def);
      this.manager.declare(def.node, variable);
      this.manager.declare(def.parent, variable);
    }
    variable.identifiers.push(node);
  }

  __referencing(node, assign, writeExpr, maybeImplicitGlobal, partial, init) {
    if (!node || node.type !== "Identifier" || node.name === "super" || !this.manager.names.has(node.name)) return;
    (this.left ??= []).push(new FactReference(node, this, assign || READ, Boolean(init)));
  }

  __detectEval() {
    this.manager.detectedEval = true;
  }

  __detectThis() {}

  // eslint-scope FunctionScope#__isValidResolution.
  isValidResolution(reference, variable) {
    if (this.type !== "function" || this.block.type === "Program") return true;
    const bodyStart = this.block.body.range[0];
    return !(variable.scope === this
      && reference.identifier.range[0] < bodyStart
      && variable.defs.every((def) => def.name.range[0] >= bodyStart));
  }

  __close() {
    for (const reference of this.left ?? []) {
      const variable = this.set?.get(reference.identifier.name);
      if (variable && this.isValidResolution(reference, variable)) {
        variable.references.push(reference);
        reference.resolved = variable;
      } else if (this.upper) {
        (this.upper.left ??= []).push(reference);
      }
    }
    this.left = undefined;
    return this.type === "global" ? null : this.upper;
  }
}

class FactScopeManager {
  constructor(options, names) {
    this.__options = options;
    this.names = names;
    this.__currentScope = null;
    this.declared = new Map();
    this.variables = [];
    this.detectedEval = false;
  }

  declare(node, variable) {
    if (node === null || node === undefined) return;
    let variables = this.declared.get(node);
    if (!variables) this.declared.set(node, variables = []);
    if (!variables.includes(variable)) variables.push(variable);
  }

  getDeclaredVariables(node) {
    return this.declared.get(node) ?? [];
  }

  __nest(scope) {
    this.__currentScope = scope;
    return scope;
  }

  __nestGlobalScope(node) { return this.__nest(new FactScope(this, "global", null, node, false)); }
  __nestBlockScope(node) { return this.__nest(new FactScope(this, "block", this.__currentScope, node, false)); }
  __nestFunctionScope(node, isMethodDefinition) { return this.__nest(new FactScope(this, "function", this.__currentScope, node, isMethodDefinition)); }
  __nestForScope(node) { return this.__nest(new FactScope(this, "for", this.__currentScope, node, false)); }
  __nestCatchScope(node) { return this.__nest(new FactScope(this, "catch", this.__currentScope, node, false)); }
  __nestWithScope() { throw new UnsupportedScope("with"); }
  __nestClassScope(node) { return this.__nest(new FactScope(this, "class", this.__currentScope, node, false)); }
  __nestClassFieldInitializerScope(node) { return this.__nest(new FactScope(this, "class-field-initializer", this.__currentScope, node, true)); }
  __nestClassStaticBlockScope(node) { return this.__nest(new FactScope(this, "class-static-block", this.__currentScope, node, true)); }
  __nestSwitchScope(node) { return this.__nest(new FactScope(this, "switch", this.__currentScope, node, false)); }
  __nestModuleScope(node) { return this.__nest(new FactScope(this, "module", this.__currentScope, node, false)); }
  __nestFunctionExpressionNameScope(node) {
    const scope = this.__nest(new FactScope(this, "function-expression-name", this.__currentScope, node, false));
    scope.__define(node.id, new Definition("FunctionName", node.id, node, null, null, null));
    return scope;
  }

  __isOptimistic() { return this.__options.optimistic; }
  __ignoreEval() { return this.__options.ignoreEval; }
  __isJSXEnabled() { return this.__options.jsx === true; }
  isGlobalReturn() { return this.__options.nodejsScope || this.__options.sourceType === "commonjs"; }
  isModule() { return this.__options.sourceType === "module"; }
  isImpliedStrict() { return Boolean(this.__options.impliedStrict); }
  isStrictModeSupported() { return this.__options.ecmaVersion >= 5; }
  __isES6() { return this.__options.ecmaVersion >= 6; }
}

export class UnsupportedScope extends Error {}
