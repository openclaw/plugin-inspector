import { readFile } from "node:fs/promises";
import path from "node:path";

export async function captureApiOptionsForPlugin(apiOptions = {}, options = {}) {
  if (apiOptions.pluginConfig !== undefined || !options.pluginRoot) {
    return apiOptions;
  }

  const pluginConfig = await readSamplePluginConfig(options.pluginRoot);
  if (pluginConfig === undefined) {
    return apiOptions;
  }
  return {
    ...apiOptions,
    pluginConfig,
  };
}

async function readSamplePluginConfig(pluginRoot) {
  const manifestPath = path.join(pluginRoot, "openclaw.plugin.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return undefined;
  }

  const sample = sampleJsonSchema(manifest.configSchema, { key: "config" });
  return isPlainObject(sample) && Object.keys(sample).length > 0 ? sample : undefined;
}

function sampleJsonSchema(schema, context = {}) {
  if (!isPlainObject(schema)) {
    return undefined;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    return schema.const;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "default")) {
    return schema.default;
  }

  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    return sampleObjectSchema(schema);
  }
  if (type === "array") {
    return [];
  }
  if (type === "boolean") {
    return false;
  }
  if (type === "number" || type === "integer") {
    return typeof schema.minimum === "number" ? schema.minimum : 1;
  }
  if (type === "string" || !type) {
    return sampleString(context.key);
  }
  return undefined;
}

function sampleObjectSchema(schema) {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const output = {};

  for (const key of Object.keys(properties)) {
    if (required.has(key)) {
      const value = sampleJsonSchema(properties[key], { key });
      if (value !== undefined) {
        output[key] = value;
      }
    }
  }

  for (const key of Object.keys(properties)) {
    if (properties[key]?.type === "boolean") {
      output[key] = false;
    }
  }

  if (Object.keys(output).length === 0 && Number(schema.minProperties ?? 0) > 0) {
    const key = preferredSamplePropertyKey(properties);
    if (key) {
      const value = sampleJsonSchema(properties[key], { key });
      if (value !== undefined) {
        output[key] = value;
      }
    }
  }

  return output;
}

function preferredSamplePropertyKey(properties) {
  for (const key of ["provider", "model", "apiKey", "id", "name", ...Object.keys(properties)]) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      return key;
    }
  }
  return null;
}

function sampleString(key = "") {
  if (key === "provider") {
    return "openai";
  }
  if (key === "model") {
    return "text-embedding-3-small";
  }
  if (key === "apiKey") {
    return "fixture-api-key";
  }
  if (key === "dbPath") {
    return ".plugin-inspector/state/lancedb";
  }
  return "fixture";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
