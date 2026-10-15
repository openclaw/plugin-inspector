import { readFile, realpath } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { parse } from "acorn";

// Interpret only literal registry data. Never import or execute a target checkout.
export async function readCompatRegistryRecords(registryPath) {
  const directory = await realpath(path.dirname(registryPath));
  const modules = new Map();
  async function load(filePath) {
    const resolved = await realpath(filePath);
    if (path.dirname(resolved) !== directory) throw new Error("Compatibility record module escapes registry directory");
    if (modules.has(resolved)) return modules.get(resolved);
    const source = await readFile(resolved, "utf8");
    const module = parseDataModule(source);
    modules.set(resolved, module);
    module.importValue = async (specifier, name) => {
      if (!/^\.\/[a-zA-Z0-9-]+\.js$/.test(specifier)) return undefined;
      return (await load(path.join(directory, specifier.replace(/\.js$/, ".ts")))).resolve(name);
    };
    return module;
  }
  const module = await load(registryPath);
  const values = module.declarations.has("PLUGIN_COMPAT_RECORDS")
    ? [await module.resolve("PLUGIN_COMPAT_RECORDS")]
    : await Promise.all([...module.declarations.keys()].map((name) => module.resolve(name)));
  return normalizeRecords(values.flat(Infinity));
}

function parseDataModule(source) {
  const ast = parse(stripTypeScriptTypes(source, { mode: "strip" }), {
    ecmaVersion: "latest", sourceType: "module",
  });
  const declarations = new Map();
  const imports = new Map();
  for (const statement of ast.body) {
    const node = statement.declaration ?? statement;
    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations) {
        if (declaration.id.type === "Identifier") declarations.set(declaration.id.name, declaration.init);
      }
    } else if (node.type === "ImportDeclaration") {
      for (const binding of node.specifiers) {
        if (binding.type === "ImportSpecifier") imports.set(binding.local.name, [node.source.value, binding.imported.name]);
      }
    }
  }
  const resolving = new Set();
  const values = new Map();
  const module = { declarations, resolve, importValue: async () => undefined };
  async function resolve(name) {
    if (values.has(name)) return values.get(name);
    if (resolving.has(name)) throw new Error(`Cyclic compatibility record data: ${name}`);
    resolving.add(name);
    try {
      const value = imports.has(name)
        ? await module.importValue(...imports.get(name))
        : await evaluate(declarations.get(name));
      values.set(name, value);
      return value;
    } finally {
      resolving.delete(name);
    }
  }
  async function evaluate(node) {
    if (!node) return undefined;
    if (node.type === "Literal") return node.value;
    if (node.type === "Identifier") return resolve(node.name);
    if (node.type === "ArrayExpression") {
      const result = [];
      for (const element of node.elements) {
        const value = await evaluate(element?.type === "SpreadElement" ? element.argument : element);
        if (element?.type === "SpreadElement") {
          // Computed registries are outside the literal-data contract.
          if (value === undefined) continue;
          if (!Array.isArray(value)) throw new Error("Unsupported compatibility record array spread");
          result.push(...value);
        } else result.push(value);
      }
      return result;
    }
    if (node.type === "ObjectExpression") {
      const result = Object.create(null);
      for (const property of node.properties) {
        if (property.type === "SpreadElement") {
          const value = await evaluate(property.argument);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported compatibility record object spread");
          Object.assign(result, value);
        } else if (!property.computed && property.kind === "init" && !property.method) {
          result[property.key.name ?? property.key.value] = await evaluate(property.value);
        }
      }
      return result;
    }
    return undefined;
  }
  return module;
}

function normalizeRecords(values) {
  const records = values.filter((value) => typeof value?.code === "string" && typeof value?.status === "string")
    .map((value) => ({
      code: value.code,
      status: value.status,
      tests: stringArray(value.tests),
      surfaces: stringArray(value.surfaces),
      ...(typeof value.replacement === "string" ? { replacement: value.replacement } : {}),
      ...(typeof value.removeAfter === "string" ? { removeAfter: value.removeAfter } : {}),
      ...(typeof value.docsPath === "string" ? { docsPath: value.docsPath } : {}),
    }));
  return [...new Map(records.map((record) => [record.code, record])).values()]
    .sort((left, right) => left.code.localeCompare(right.code));
}

function stringArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string"))].sort() : [];
}
