import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const SKIP_DIRS = new Set([".git", "coverage", "node_modules", "reports"]);

export const mockSdkSubpathExports = {
  "plugin-entry": [
    "buildPluginConfigSchema",
    "definePluginEntry",
    "emptyPluginConfigSchema",
  ],
  core: [
    "buildChannelOutboundSessionRoute",
    "buildChannelConfigSchema",
    "buildPluginConfigSchema",
    "createActionGate",
    "createChannelPluginBase",
    "createChatChannelPlugin",
    "createDedupeCache",
    "defineChannelPluginEntry",
    "definePluginEntry",
    "defineSetupPluginEntry",
    "emptyChannelConfigSchema",
    "emptyPluginConfigSchema",
    "jsonResult",
    "readNumberParam",
    "readReactionParams",
    "readStringArrayParam",
    "readStringParam",
  ],
  "channel-actions": [
    "createActionGate",
    "jsonResult",
    "readNumberParam",
    "readReactionParams",
    "readStringArrayParam",
    "readStringParam",
  ],
  "channel-core": [
    "buildChannelConfigSchema",
    "buildChannelOutboundSessionRoute",
    "buildThreadAwareOutboundSessionRoute",
    "clearAccountEntryFields",
    "createChannelPluginBase",
    "createChatChannelPlugin",
    "defineChannelPluginEntry",
    "defineSetupPluginEntry",
    "parseOptionalDelimitedEntries",
    "recoverCurrentThreadSessionId",
    "stripChannelTargetPrefix",
    "stripTargetKindPrefix",
    "tryReadSecretFileSync",
  ],
  "webhook-ingress": [
    "applyBasicWebhookRequestGuards",
    "beginWebhookRequestPipelineOrReject",
    "createAuthRateLimiter",
    "createWebhookInFlightLimiter",
    "isJsonContentType",
    "isRequestBodyLimitError",
    "normalizePluginHttpPath",
    "normalizeWebhookPath",
    "readJsonWebhookBodyOrReject",
    "readRequestBodyWithLimit",
    "readWebhookBodyOrReject",
    "registerPluginHttpRoute",
    "registerWebhookTarget",
    "registerWebhookTargetWithPluginRoute",
    "requestBodyErrorToText",
    "resolveRequestClientIp",
    "resolveSingleWebhookTarget",
    "resolveSingleWebhookTargetAsync",
    "resolveWebhookPath",
    "resolveWebhookTargetWithAuthOrReject",
    "resolveWebhookTargetWithAuthOrRejectSync",
    "resolveWebhookTargets",
    "withResolvedWebhookRequestPipeline",
  ],
  "provider-entry": [
    "buildSingleProviderApiKeyCatalog",
    "createProviderApiKeyAuthMethod",
    "defineSingleProviderPluginEntry",
  ],
  "provider-auth": ["createProviderApiKeyAuthMethod"],
  "provider-auth-runtime": ["createProviderApiKeyAuthMethod"],
  "provider-http": [
    "assertOkOrThrowHttpError",
    "assertOkOrThrowProviderError",
    "createProviderHttpError",
    "extractProviderErrorDetail",
    "extractProviderRequestId",
    "fetchWithTimeout",
    "formatProviderErrorPayload",
    "formatProviderHttpErrorMessage",
    "normalizeBaseUrl",
    "postJsonRequest",
    "readResponseTextLimited",
    "resolveProviderEndpoint",
    "resolveProviderRequestCapabilities",
    "resolveProviderRequestPolicy",
    "truncateErrorDetail",
  ],
  "provider-model-shared": [
    "ANTHROPIC_BY_MODEL_REPLAY_HOOKS",
    "DEFAULT_CONTEXT_TOKENS",
    "NATIVE_ANTHROPIC_REPLAY_HOOKS",
    "OPENAI_COMPATIBLE_REPLAY_HOOKS",
    "PASSTHROUGH_GEMINI_REPLAY_HOOKS",
    "buildProviderReplayFamilyHooks",
    "getModelProviderHint",
    "isProxyReasoningUnsupportedModelHint",
    "normalizeProviderId",
    "resolveProviderEndpoint",
  ],
  "provider-stream": [
    "GOOGLE_THINKING_STREAM_HOOKS",
    "KILOCODE_THINKING_STREAM_HOOKS",
    "MINIMAX_FAST_MODE_STREAM_HOOKS",
    "MOONSHOT_THINKING_STREAM_HOOKS",
    "OPENAI_RESPONSES_STREAM_HOOKS",
    "OPENROUTER_THINKING_STREAM_HOOKS",
    "TOOL_STREAM_DEFAULT_ON_HOOKS",
    "buildProviderStreamFamilyHooks",
  ],
  "provider-stream-shared": ["buildProviderStreamFamilyHooks"],
  "provider-tools": [
    "GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS",
    "HTML_ENTITY_TOOL_CALL_ARGUMENTS_ENCODING",
    "XAI_TOOL_SCHEMA_PROFILE",
    "XAI_UNSUPPORTED_SCHEMA_KEYWORDS",
    "applyXaiModelCompat",
    "buildProviderToolCompatFamilyHooks",
    "cleanSchemaForGemini",
    "findOpenAIStrictSchemaViolations",
    "findUnsupportedSchemaKeywords",
    "inspectGeminiToolSchemas",
    "inspectOpenAIToolSchemas",
    "normalizeGeminiToolSchemas",
    "normalizeOpenAIToolSchemas",
    "resolveXaiModelCompatPatch",
    "stripUnsupportedSchemaKeywords",
    "stripXaiUnsupportedKeywords",
  ],
  "provider-web-search": ["createWebSearchProviderContractFields", "jsonResult", "readStringParam"],
  "provider-web-search-config-contract": [
    "createWebSearchProviderContractFields",
    "getScopedCredentialValue",
    "getTopLevelCredentialValue",
    "mergeScopedSearchConfig",
    "resolveProviderWebSearchPluginConfig",
    "setProviderWebSearchPluginConfigValue",
    "setScopedCredentialValue",
    "setTopLevelCredentialValue",
  ],
  "runtime-env": ["createRuntimeEnv", "resolveRuntimeEnv"],
  "runtime-logger": ["createLoggerBackedRuntime", "createSubsystemLogger"],
  "config-runtime": [
    "buildPluginConfigSchema",
    "emptyPluginConfigSchema",
    "isSecretRef",
    "normalizeSecretInputString",
  ],
  "plugin-runtime": ["createLoggerBackedRuntime", "createSubsystemLogger"],
  "secret-input": [
    "buildOptionalSecretInputSchema",
    "buildSecretInputArraySchema",
    "buildSecretInputSchema",
    "coerceSecretRef",
    "hasConfiguredSecretInput",
    "isSecretRef",
    "normalizeResolvedSecretInputString",
    "normalizeSecretInput",
    "normalizeSecretInputString",
    "resolveSecretInputString",
  ],
  "security-runtime": [
    "buildHostnameAllowlistPolicyFromSuffixAllowlist",
    "fetchWithSsrFGuard",
    "formatErrorMessage",
    "generateSecureToken",
    "hasConfiguredSecretInput",
    "isBlockedHostnameOrIp",
    "isPrivateNetworkOptInEnabled",
    "mergeSsrFPolicies",
    "redactSensitiveText",
    "safeEqualSecret",
    "wrapExternalContent",
  ],
  "ssrf-runtime": [
    "SsrFBlockedError",
    "closeDispatcher",
    "createPinnedDispatcher",
    "fetchWithSsrFGuard",
    "formatErrorMessage",
    "isBlockedHostnameOrIp",
    "isPrivateOrLoopbackHost",
    "resolvePinnedHostname",
    "resolvePinnedHostnameWithPolicy",
    "ssrfPolicyFromHttpBaseUrlAllowedHostname",
  ],
  "browser-security-runtime": [
    "SafeOpenError",
    "SsrFBlockedError",
    "extractErrorCode",
    "formatErrorMessage",
    "generateSecureToken",
    "hasProxyEnvConfigured",
    "isBlockedHostnameOrIp",
    "isNotFoundPathError",
    "isPathInside",
    "normalizeHostname",
    "openFileWithinRoot",
    "redactSensitiveText",
    "safeEqualSecret",
    "wrapExternalContent",
    "writeFileFromPathWithinRoot",
  ],
  "media-runtime": ["renderQrTerminal"],
  "text-runtime": ["chunkTextForOutbound", "truncateText"],
  testing: ["createMockPluginRuntime"],
};

export const mockSdkExportNames = [
  ...new Set([
    "createPlugin",
    "definePlugin",
    "pluginSdkMock",
    ...Object.values(mockSdkSubpathExports).flat(),
  ]),
].sort();

export async function createMockSdkPackage(rootDir, options = {}) {
  const packageDir = path.join(rootDir, "node_modules", "openclaw");
  const pluginSdkDir = path.join(packageDir, "plugin-sdk");
  const externalDir = path.join(rootDir, "mock-modules", "external");
  await mkdir(pluginSdkDir, { recursive: true });
  await mkdir(externalDir, { recursive: true });
  const imports = options.pluginRoot ? await collectRuntimeImports(options.pluginRoot) : emptyRuntimeImports();
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw",
        version: "0.0.0-plugin-inspector-mock",
        type: "module",
        exports: {
          "./plugin-sdk": "./plugin-sdk/index.js",
          "./plugin-sdk/*": "./plugin-sdk/*.js",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const rootExportNames = new Set([
    ...mockSdkExportNames,
    ...(imports.bySpecifier.get("openclaw/plugin-sdk") ?? []),
  ]);
  await writeFile(path.join(pluginSdkDir, "index.js"), mockSdkSource(rootExportNames), "utf8");
  for (const [subpath, exportNames] of Object.entries(mockSdkSubpathExports)) {
    const specifier = `openclaw/plugin-sdk/${subpath}`;
    await writeFile(
      path.join(pluginSdkDir, `${subpath}.js`),
      mockSdkSubpathSource(exportNames, imports.bySpecifier.get(specifier) ?? new Set(), {
        zod: subpath === "zod",
      }),
      "utf8",
    );
  }
  for (const specifier of imports.openclawSdkSpecifiers) {
    if (specifier === "openclaw/plugin-sdk") {
      continue;
    }
    const relative = safePluginSdkSubpath(specifier.slice("openclaw/plugin-sdk/".length));
    if (!relative) {
      continue;
    }
    if (mockSdkSubpathExports[relative]) {
      continue;
    }
    const targetPath = path.join(pluginSdkDir, `${relative}.js`);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      dynamicMockModuleSource(imports.bySpecifier.get(specifier) ?? new Set(), {
        includeSdkRuntime: true,
        zod: relative === "zod",
      }),
      "utf8",
    );
  }

  const externalMap = {};
  for (const specifier of imports.bareSpecifiers) {
    const fileName = `${safeModuleFileName(specifier)}.js`;
    externalMap[specifier] = path.join(externalDir, fileName);
    await writeFile(
      path.join(externalDir, fileName),
      externalMockModuleSource(specifier, imports.bySpecifier.get(specifier) ?? new Set()),
      "utf8",
    );
  }

  const fallbackExternalPath = path.join(externalDir, "__fallback__.js");
  await writeFile(fallbackExternalPath, externalMockModuleSource("__fallback__", new Set()), "utf8");
  const loaderPath = path.join(rootDir, "mock-loader.mjs");
  await writeFile(
    loaderPath,
    mockLoaderSource({
      externalMap,
      fallbackExternalPath,
      pluginSdkDir,
    }),
    "utf8",
  );

  return { packageDir, loaderPath, pluginSdkDir };
}

function emptyRuntimeImports() {
  return {
    bySpecifier: new Map(),
    openclawSdkSpecifiers: new Set(["openclaw/plugin-sdk"]),
    bareSpecifiers: new Set(),
  };
}

async function collectRuntimeImports(pluginRoot) {
  const bySpecifier = new Map();
  const openclawSdkSpecifiers = new Set(["openclaw/plugin-sdk"]);
  const bareSpecifiers = new Set();
  for (const filePath of await listSourceFiles(pluginRoot)) {
    const text = await readFile(filePath, "utf8");
    for (const entry of parseModuleImports(text)) {
      if (entry.specifier.startsWith("openclaw/plugin-sdk")) {
        openclawSdkSpecifiers.add(entry.specifier);
      } else if (isMockableBareSpecifier(entry.specifier)) {
        bareSpecifiers.add(entry.specifier);
      } else {
        continue;
      }
      const names = bySpecifier.get(entry.specifier) ?? new Set();
      for (const name of entry.names) {
        names.add(name);
      }
      bySpecifier.set(entry.specifier, names);
    }
  }
  return { bySpecifier, openclawSdkSpecifiers, bareSpecifiers };
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".clawhub") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...(await listSourceFiles(fullPath)));
      }
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseModuleImports(text) {
  const entries = [];
  const patterns = [
    /\bimport\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*\s+from|\{([\s\S]*?)\}\s+from)\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (isTypeOnlyImportOrExport(match[0], match[1] ?? "")) {
        continue;
      }
      const specifier = match[2];
      if (specifier) {
        entries.push({ specifier, names: parseNamedImports(match[1] ?? "") });
      }
    }
  }
  for (const match of text.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    entries.push({ specifier: match[1], names: new Set() });
  }
  return entries;
}

function isTypeOnlyImportOrExport(statement, clause) {
  return /^\s*import\s+type\b/u.test(statement) || /^\s*export\s+type\b/u.test(statement) || /^\s*type\b/u.test(clause);
}

function parseNamedImports(clause) {
  const names = new Set();
  const named = /\{([\s\S]*?)\}/.exec(clause)?.[1] ?? clause;
  for (const rawPart of named.split(",")) {
    const part = rawPart.trim();
    if (!part || part.startsWith("type ")) {
      continue;
    }
    const sourceName = part.replace(/^type\s+/u, "").split(/\s+as\s+/u)[0]?.trim();
    if (sourceName && /^[A-Za-z_$][\w$]*$/u.test(sourceName)) {
      names.add(sourceName);
    }
  }
  return names;
}

function isMockableBareSpecifier(specifier) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("node:") &&
    !specifier.startsWith("data:") &&
    !specifier.startsWith("file:")
  );
}

function safeModuleFileName(specifier) {
  return specifier.replace(/[^A-Za-z0-9._-]+/gu, "__");
}

function mockLoaderSource({ externalMap, fallbackExternalPath, pluginSdkDir }) {
  return `import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { builtinModules, stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const externalMap = new Map(Object.entries(${JSON.stringify(externalMap)}));
const fallbackExternalPath = ${JSON.stringify(fallbackExternalPath)};
const pluginSdkDir = ${JSON.stringify(pluginSdkDir)};
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => \`node:\${name}\`)]);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "openclaw/plugin-sdk") {
    return moduleUrl(path.join(pluginSdkDir, "index.js"));
  }
  if (specifier.startsWith("openclaw/plugin-sdk/")) {
    const subpath = safePluginSdkSubpath(specifier.slice("openclaw/plugin-sdk/".length));
    if (!subpath) {
      throw Object.assign(new Error(\`invalid OpenClaw plugin SDK subpath: \${specifier}\`), {
        code: "ERR_INVALID_MODULE_SPECIFIER",
      });
    }
    return moduleUrl(path.join(pluginSdkDir, \`\${subpath}.js\`));
  }
  if (externalMap.has(specifier)) {
    return moduleUrl(externalMap.get(specifier));
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const resolved = resolveExtensionless(specifier, context.parentURL);
    if (resolved) {
      return moduleUrl(resolved);
    }
    if (isMockableBareSpecifier(specifier)) {
      return moduleUrl(externalMap.get(specifier) ?? fallbackExternalPath);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\\.[cm]?ts$/u.test(fileURLToPath(url))) {
    const rawSource = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source: stripPluginTypeScript(rawSource), shortCircuit: true };
  }
  return nextLoad(url, context);
}

function stripPluginTypeScript(source) {
  try {
    return stripTypeScriptTypes(source, { mode: "transform" });
  } catch (error) {
    if (error?.code !== "ERR_INVALID_ARG_VALUE") {
      throw error;
    }
    return stripTypeScriptTypes(source, { mode: "strip" });
  }
}

function moduleUrl(filePath) {
  return { url: pathToFileURL(filePath).href, shortCircuit: true };
}

function resolveExtensionless(specifier, parentURL) {
  if (!parentURL || (!specifier.startsWith(".") && !specifier.startsWith("/"))) {
    return null;
  }
  const parentDir = path.dirname(fileURLToPath(parentURL));
  const base = specifier.startsWith("/") ? specifier : path.resolve(parentDir, specifier);
  const parsed = path.parse(base);
  const withoutJsExtension = [".js", ".mjs", ".cjs"].includes(parsed.ext) ? path.join(parsed.dir, parsed.name) : null;
  const candidates = [
    base,
    ...(withoutJsExtension ? [\`\${withoutJsExtension}.ts\`, \`\${withoutJsExtension}.mts\`, \`\${withoutJsExtension}.cts\`] : []),
    \`\${base}.js\`,
    \`\${base}.mjs\`,
    \`\${base}.ts\`,
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
    path.join(base, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isMockableBareSpecifier(specifier) {
  return !builtins.has(specifier) &&
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("data:") &&
    !specifier.startsWith("file:");
}

function safePluginSdkSubpath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll("\\\\", "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}
`;
}

function safePluginSdkSubpath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}

function dynamicMockModuleSource(exportNames, options = {}) {
  const names = new Set([...exportNames].filter(isValidExportName));
  if (options.zod) {
    addZodExports(names);
  }
  return `${genericMockRuntimeSource(options)}
${[...names].map(genericExportStatement).join("\n")}

export default ${options.zod ? "createZNamespace()" : 'createMockValue("default")'};
`;
}

function externalMockModuleSource(specifier, exportNames) {
  if (specifier === "@larksuiteoapi/node-sdk") {
    return larkSdkMockModuleSource(exportNames);
  }
  const names = new Set([...exportNames].filter(isValidExportName));
  if (specifier === "zod") {
    addZodExports(names);
  }
  return dynamicMockModuleSource(names, { zod: specifier === "zod" });
}

function larkSdkMockModuleSource(exportNames) {
  const larkExports = new Set([
    "AppType",
    "Client",
    "Domain",
    "EventDispatcher",
    "LoggerLevel",
    "WSClient",
    ...exportNames,
  ]);
  larkExports.delete("defaultHttpInstance");
  return `${genericMockRuntimeSource()}
const requestInterceptors = {
  handlers: [],
  use(handler) {
    this.handlers.push(handler);
    return this.handlers.length - 1;
  },
};

export const defaultHttpInstance = {
  interceptors: {
    request: requestInterceptors,
    response: {
      handlers: [],
      use(handler) {
        this.handlers.push(handler);
        return this.handlers.length - 1;
      },
    },
  },
  request: createMockValue("defaultHttpInstance.request"),
  get: createMockValue("defaultHttpInstance.get"),
  post: createMockValue("defaultHttpInstance.post"),
  put: createMockValue("defaultHttpInstance.put"),
  patch: createMockValue("defaultHttpInstance.patch"),
  delete: createMockValue("defaultHttpInstance.delete"),
  head: createMockValue("defaultHttpInstance.head"),
  options: createMockValue("defaultHttpInstance.options"),
};
${[...larkExports].filter(isValidExportName).map(genericExportStatement).join("\n")}

export default createMockValue("default");
`;
}

function addZodExports(names) {
  for (const name of ["z", "any", "array", "boolean", "enum", "literal", "number", "object", "record", "string", "unknown"]) {
    names.add(name);
  }
}

function isValidExportName(name) {
  return name !== "default" && /^[A-Za-z_$][\w$]*$/u.test(name);
}

function genericExportStatement(name) {
  if (name === "z") {
    return "export const z = createZNamespace();";
  }
  if (name === "Type") {
    return "export const Type = createTypeNamespace();";
  }
  if (["any", "array", "boolean", "enum", "literal", "number", "object", "record", "string", "unknown"].includes(name)) {
    if (name === "enum") {
      return "const zodEnum = createZNamespace().enum;\nexport { zodEnum as enum };";
    }
    return `export const ${name} = createZNamespace().${name};`;
  }
  if (["createChatChannelPlugin", "createPlugin", "defineChannelPluginEntry", "definePlugin", "definePluginEntry", "defineSetupPluginEntry"].includes(name)) {
    return name === "definePluginEntry" ? "export { definePluginEntry };" : `export const ${name} = definePluginEntry;`;
  }
  if (name === "defineBundledChannelEntry") {
    return "export { defineBundledChannelEntry };";
  }
  if (name === "defineBundledChannelSetupEntry") {
    return "export { defineBundledChannelSetupEntry };";
  }
  if (name === "loadBundledEntryExportSync") {
    return "export { loadBundledEntryExportSync };";
  }
  if (/^[A-Z].*Schema$/u.test(name)) {
    return `export const ${name} = createSchema();`;
  }
  return `export const ${name} = createMockValue(${JSON.stringify(name)});`;
}

function genericMockRuntimeSource(options = {}) {
  return `${options.includeSdkRuntime ? `import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pendingBundledEntryLoads = new Set();

function definePluginEntry(entry) {
  if (entry && typeof entry === "object" && typeof entry.register === "function") {
    return entry;
  }
  if (entry && typeof entry === "object" && typeof entry.registerFull === "function") {
    return { ...entry, register: entry.registerFull };
  }
  return typeof entry === "function" ? { register: entry } : entry;
}

function defineBundledChannelEntry(entry = {}) {
  return {
    ...entry,
    kind: "bundled-channel-entry",
    async register(api) {
      if (api?.registrationMode === "cli-metadata") {
        return entry.registerCliMetadata?.(api);
      }
      if (api?.registrationMode !== "tool-discovery") {
        api?.registerChannel?.({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          plugin: { id: entry.id, name: entry.name },
        });
      }
      entry.registerCliMetadata?.(api);
      const result = entry.registerFull?.(api);
      if (result && typeof result.then === "function") {
        await result;
      }
      await drainBundledEntryLoads();
      return result;
    },
  };
}

function defineBundledChannelSetupEntry(entry = {}) {
  return {
    ...entry,
    kind: "bundled-channel-setup-entry",
  };
}

function loadBundledEntryExportSync(importMetaUrl, options = {}) {
  return (...args) => {
    const promise = import(resolveBundledEntryUrl(importMetaUrl, options.specifier)).then((module) => {
      const loaded = module[options.exportName] ?? module.default;
      return typeof loaded === "function" ? loaded(...args) : loaded;
    });
    pendingBundledEntryLoads.add(promise);
    promise.finally(() => pendingBundledEntryLoads.delete(promise));
    return promise;
  };
}

async function drainBundledEntryLoads() {
  while (pendingBundledEntryLoads.size > 0) {
    await Promise.all([...pendingBundledEntryLoads]);
  }
}

function resolveBundledEntryUrl(importMetaUrl, specifier) {
  const basePath = fileURLToPath(importMetaUrl);
  const target = specifier ? path.resolve(path.dirname(basePath), specifier) : basePath;
  const resolved = resolveExistingSourcePath(target);
  return pathToFileURL(resolved).href;
}

function resolveExistingSourcePath(target) {
  if (existsSync(target)) {
    return target;
  }
  const parsed = path.parse(target);
  const withoutJsExtension = [".js", ".mjs", ".cjs"].includes(parsed.ext) ? path.join(parsed.dir, parsed.name) : null;
  const candidates = [
    ...(withoutJsExtension ? [\`\${withoutJsExtension}.ts\`, \`\${withoutJsExtension}.mts\`, \`\${withoutJsExtension}.cts\`] : []),
    \`\${target}.js\`,
    \`\${target}.mjs\`,
    \`\${target}.ts\`,
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? target;
}
` : ""}
function createMockValue(name) {
  function fn(...args) {
    if (name === "resolveDefaultAgentDir") {
      return mockAgentDir();
    }
    if (name === "resolveAgentDir") {
      return mockAgentDir(args[1]);
    }
    if (name === "resolveUserPath") {
      return typeof args[0] === "string" ? args[0] : mockAgentDir();
    }
    if (name === "resolveAuthProfileOrder") {
      return [];
    }
    if (name === "resolveWindowsSpawnProgram") {
      return mockWindowsSpawnProgram(args[0]);
    }
    if (name === "materializeWindowsSpawnProgram") {
      return mockWindowsSpawnInvocation(args[0], args[1]);
    }
    if (name === "resolvePreferredOpenClawTmpDir") {
      return process.env.TMPDIR || "/tmp";
    }
    if (name.startsWith("normalize")) {
      return typeof args[0] === "string" ? args[0] : "";
    }
    if (name === "jsonResult") {
      return { type: "json", value: args[0] };
    }
    if (name === "readStringParam") {
      return typeof args[0] === "string" ? args[0] : "";
    }
    return createMockValue(name);
  }
  return new Proxy(fn, {
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }
      if (property === Symbol.toPrimitive) {
        return () => name;
      }
      if (property === "toString") {
        return () => name;
      }
      if (property === "valueOf") {
        return () => name;
      }
      return createMockValue(\`\${name}.\${String(property)}\`);
    },
    construct() {
      return createMockValue(name);
    },
  });
}

function mockAgentDir(agentId = "main") {
  const base = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
  const safeAgentId = String(agentId || "main").replace(/[^a-zA-Z0-9._-]/g, "-");
  return base.replace(/[\\/]+$/, "") + "/plugin-inspector-openclaw/agents/" + safeAgentId + "/agent";
}

function mockWindowsSpawnProgram(params = {}) {
  return {
    command: typeof params.command === "string" && params.command.trim() ? params.command : process.execPath,
    leadingArgv: [],
    resolution: "mock",
    packageName: typeof params.packageName === "string" ? params.packageName : undefined,
  };
}

function mockWindowsSpawnInvocation(program = {}, argv = []) {
  const command = typeof program.command === "string" && program.command.trim() ? program.command : process.execPath;
  if (program.packageName === "@openai/codex") {
    return {
      command: process.execPath,
      argv: ["-e", mockCodexAppServerScript()],
      resolution: program.resolution ?? "mock",
      windowsHide: true,
    };
  }
  return {
    command,
    argv: [...(Array.isArray(program.leadingArgv) ? program.leadingArgv : []), ...(Array.isArray(argv) ? argv : [])],
    resolution: program.resolution ?? "mock",
    shell: program.shell,
    windowsHide: program.windowsHide,
  };
}

function mockCodexAppServerScript() {
  return [
    "const readline = require('node:readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "let idleTimer;",
    "function scheduleIdleExit() {",
    "  if (idleTimer) clearTimeout(idleTimer);",
    "  idleTimer = setTimeout(() => process.exit(0), 1000);",
    "}",
    "function write(id, result) { process.stdout.write(JSON.stringify({ id, result }) + String.fromCharCode(10)); }",
    "rl.on('line', (line) => {",
    "  let message;",
    "  try { message = JSON.parse(line); } catch { return; }",
    "  if (message.id === undefined || message.id === null) return;",
    "  switch (message.method) {",
    "    case 'initialize':",
    "      write(message.id, { userAgent: 'openclaw/999.0.0 (plugin-inspector mock)' });",
    "      break;",
    "    case 'model/list':",
    "      write(message.id, { data: [] });",
    "      break;",
    "    case 'thread/list':",
    "    case 'mcpServerStatus/list':",
    "    case 'skills/list':",
    "      write(message.id, { data: [] });",
    "      break;",
    "    case 'account/read':",
    "      write(message.id, null);",
    "      break;",
    "    case 'account/rateLimits/read':",
    "      write(message.id, null);",
    "      break;",
    "    default:",
    "      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'mock method not implemented' } }) + String.fromCharCode(10));",
    "  }",
    "  scheduleIdleExit();",
    "});",
  ].join("\\n");
}

function createZNamespace() {
  const namespace = {
    any: () => createSchema(),
    array: () => createSchema([]),
    boolean: () => createSchema(),
    enum: (values) => createSchema(Array.isArray(values) ? values[0] : undefined),
    literal: (value) => createSchema(value),
    number: () => createSchema(),
    object: (shape = {}) => createSchema(undefined, shape),
    record: () => createSchema({}),
    string: () => createSchema(),
    unknown: () => createSchema(),
  };
  return new Proxy(namespace, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return () => createSchema();
    },
  });
}

function createSchema(defaultValue, shape) {
  const schema = {
    parse(value) {
      if (shape && isPlainObject(value ?? defaultValue ?? {})) {
        const source = isPlainObject(value) ? value : {};
        const output = isPlainObject(defaultValue) ? clonePlain(defaultValue) : {};
        for (const [key, fieldSchema] of Object.entries(shape)) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            output[key] = parseWithSchema(fieldSchema, source[key]);
            continue;
          }
          const parsed = parseWithSchema(fieldSchema, undefined);
          if (parsed !== undefined) {
            output[key] = parsed;
          }
        }
        return output;
      }
      return value === undefined ? clonePlain(defaultValue) : value;
    },
    default(value) {
      return createSchema(value, shape);
    },
    optional() {
      return this;
    },
    nullable() {
      return this;
    },
    nullish() {
      return this;
    },
    strict() {
      return this;
    },
    passthrough() {
      return this;
    },
    regex() {
      return this;
    },
    min() {
      return this;
    },
    max() {
      return this;
    },
    int() {
      return this;
    },
    positive() {
      return this;
    },
    nonnegative() {
      return this;
    },
    url() {
      return this;
    },
    describe() {
      return this;
    },
    refine() {
      return this;
    },
    superRefine() {
      return this;
    },
    transform() {
      return this;
    },
  };
  return new Proxy(schema, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return () => target;
    },
  });
}

function parseWithSchema(schema, value) {
  return schema && typeof schema.parse === "function" ? schema.parse(value) : value;
}

function clonePlain(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createTypeNamespace() {
  const namespace = {
    Any: () => ({}),
    Array: (items = {}) => ({ type: "array", items }),
    Boolean: () => ({ type: "boolean" }),
    Literal: (value) => ({ const: value }),
    Number: () => ({ type: "number" }),
    Object: (properties = {}) => ({ type: "object", properties }),
    Optional: (schema) => schema,
    String: (options = {}) => ({ type: "string", ...options }),
    Union: (schemas = []) => ({ anyOf: schemas }),
    Unknown: () => ({}),
  };
  return new Proxy(namespace, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return (...args) => ({ kind: String(property), args });
    },
  });
}
`;
}

function mockSdkSource(exportNames = mockSdkExportNames) {
  const dynamicExportNames = [...exportNames].filter((name) => !mockSdkExportNames.includes(name));
  return `function normalizeEntry(entry) {
  return typeof entry === "function" ? { register: entry } : entry;
}

function normalizeRegistrationMode(api) {
  return api?.registrationMode ?? "full";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWithSchema(schema, value) {
  return schema && typeof schema.parse === "function" ? schema.parse(value) : value;
}

function createConfigSchema(schema = {}) {
  if (schema && typeof schema.parse === "function") {
    return schema;
  }
  const shape = isPlainObject(schema?.shape) ? schema.shape : isPlainObject(schema?.properties) ? schema.properties : schema;
  return {
    ...schema,
    parse(value = {}) {
      if (!isPlainObject(shape)) {
        return isPlainObject(value) ? value : {};
      }
      const source = isPlainObject(value) ? value : {};
      const output = { ...source };
      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          output[key] = parseWithSchema(fieldSchema, source[key]);
        }
      }
      return output;
    },
  };
}

export function definePluginEntry(entry) {
  return normalizeEntry(entry);
}

export function defineChannelPluginEntry(entry) {
  if (!isPlainObject(entry) || !entry.plugin) {
    return normalizeEntry(entry);
  }
  const resolved = {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    configSchema: createConfigSchema(entry.configSchema),
    channelPlugin: entry.plugin,
    register(api) {
      const mode = normalizeRegistrationMode(api);
      if (mode === "cli-metadata") {
        entry.registerCliMetadata?.(api);
        return;
      }
      api.registerChannel?.({ plugin: entry.plugin });
      entry.setRuntime?.(api.runtime);
      if (mode === "discovery") {
        entry.registerCliMetadata?.(api);
        return;
      }
      if (mode !== "full") {
        return;
      }
      entry.registerCliMetadata?.(api);
      entry.registerFull?.(api);
    },
  };
  if (entry.setRuntime) {
    resolved.setChannelRuntime = entry.setRuntime;
  }
  return resolved;
}

export function defineSetupPluginEntry(entry) {
  return isPlainObject(entry) && entry.plugin ? entry : { plugin: entry };
}

export function createChatChannelPlugin(entry) {
  if (!isPlainObject(entry) || !entry.base) {
    return normalizeEntry(entry);
  }
  return {
    ...entry.base,
    conversationBindings: {
      supportsCurrentConversationBinding: true,
      ...(entry.base.conversationBindings ?? {}),
    },
    ...(entry.security ? { security: resolveChannelSecurity(entry.security) } : {}),
    ...(entry.pairing ? { pairing: resolveChannelPairing(entry.pairing) } : {}),
    ...(entry.threading ? { threading: resolveChannelThreading(entry.threading) } : {}),
    ...(entry.outbound ? { outbound: resolveChannelOutbound(entry.outbound) } : {}),
  };
}

export function createChannelPluginBase(params = {}) {
  return {
    id: params.id ?? "fixture-channel",
    meta: { id: params.id ?? "fixture-channel", ...(params.meta ?? {}) },
    ...(params.setupWizard ? { setupWizard: params.setupWizard } : {}),
    ...(params.capabilities ? { capabilities: params.capabilities } : {}),
    ...(params.commands ? { commands: params.commands } : {}),
    ...(params.doctor ? { doctor: params.doctor } : {}),
    ...(params.agentPrompt ? { agentPrompt: params.agentPrompt } : {}),
    ...(params.streaming ? { streaming: params.streaming } : {}),
    ...(params.reload ? { reload: params.reload } : {}),
    ...(params.gatewayMethods ? { gatewayMethods: params.gatewayMethods } : {}),
    ...(params.configSchema ? { configSchema: createConfigSchema(params.configSchema) } : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.security ? { security: params.security } : {}),
    ...(params.groups ? { groups: params.groups } : {}),
    setup: params.setup ?? (() => ({})),
  };
}

function resolveChannelSecurity(security) {
  if (!isPlainObject(security) || !security.dm) {
    return security;
  }
  return {
    resolveDmPolicy: ({ account } = {}) => ({
      policy: security.dm.resolvePolicy?.(account ?? {}) ?? security.dm.defaultPolicy ?? "allow",
      allowFrom: security.dm.resolveAllowFrom?.(account ?? {}) ?? [],
    }),
    ...(security.collectWarnings ? { collectWarnings: security.collectWarnings } : {}),
    ...(security.collectAuditFindings ? { collectAuditFindings: security.collectAuditFindings } : {}),
  };
}

function resolveChannelPairing(pairing) {
  if (!isPlainObject(pairing) || !pairing.text) {
    return pairing;
  }
  return {
    idLabel: pairing.text.idLabel,
    normalizeAllowEntry: pairing.text.normalizeAllowEntry,
    notifyApproval: (ctx) => pairing.text.notify?.({ ...ctx, message: pairing.text.message }),
  };
}

function resolveChannelThreading(threading) {
  if (!isPlainObject(threading)) {
    return threading;
  }
  if (threading.resolveReplyToMode) {
    return threading;
  }
  return {
    ...threading,
    resolveReplyToMode: () =>
      threading.topLevelReplyToMode ??
      threading.scopedAccountReplyToMode?.fallback ??
      "thread",
  };
}

function resolveChannelOutbound(outbound) {
  if (!isPlainObject(outbound) || !outbound.attachedResults) {
    return outbound;
  }
  const { base = {}, attachedResults } = outbound;
  return {
    ...base,
    ...(attachedResults.sendText
      ? { sendText: async (ctx) => ({ channel: attachedResults.channel, ...(await attachedResults.sendText(ctx)) }) }
      : {}),
    ...(attachedResults.sendMedia
      ? { sendMedia: async (ctx) => ({ channel: attachedResults.channel, ...(await attachedResults.sendMedia(ctx)) }) }
      : {}),
    ...(attachedResults.sendPoll
      ? { sendPoll: async (ctx) => ({ channel: attachedResults.channel, ...(await attachedResults.sendPoll(ctx)) }) }
      : {}),
  };
}

export function definePlugin(entry) {
  return definePluginEntry(entry);
}

export function createPlugin(entry) {
  return definePluginEntry(entry);
}

export function defineSingleProviderPluginEntry(options) {
  return definePluginEntry({
    ...options,
    register(api) {
      if (options?.provider) {
        api.registerProvider?.({
          id: options.provider.id ?? options.id,
          label: options.provider.label,
          ...options.provider,
        });
      }
      return options?.register?.(api);
    },
  });
}

export function buildPluginConfigSchema(schema = {}) {
  return createConfigSchema(schema);
}

export const emptyPluginConfigSchema = createConfigSchema({ type: "object", properties: {}, additionalProperties: false });

export function buildChannelConfigSchema(schema = {}) {
  return createConfigSchema(schema);
}

export const emptyChannelConfigSchema = emptyPluginConfigSchema;

export function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function readNumberParam(value, keyOrFallback = 0, options = {}) {
  const raw = isPlainObject(value) ? value[keyOrFallback] : value;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    return options.integer ? Math.trunc(parsed) : parsed;
  }
  return isPlainObject(value) ? undefined : keyOrFallback;
}

export function readStringParam(value, keyOrFallback = "") {
  if (isPlainObject(value)) {
    const raw = value[keyOrFallback];
    return typeof raw === "string" ? raw : undefined;
  }
  return typeof value === "string" ? value : keyOrFallback;
}

export function readStringArrayParam(value, key) {
  const raw = isPlainObject(value) ? value[key] : value;
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry));
  }
  return typeof raw === "string" && raw ? [raw] : [];
}

export function readReactionParams(value = {}) {
  return {
    messageId: value.messageId ?? value.id ?? "",
    reaction: value.reaction ?? value.emoji ?? "",
  };
}

export function createActionGate(actions = {}) {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    return value === undefined ? defaultValue : value !== false;
  };
}

export function buildChannelOutboundSessionRoute(params = {}) {
  const peer = params.peer ?? { kind: params.chatType ?? "direct", id: params.to ?? "fixture-peer" };
  const baseSessionKey = [
    params.agentId ?? "agent",
    params.channel ?? "channel",
    params.accountId ?? "default",
    peer.kind,
    peer.id,
  ].filter(Boolean).join(":");
  return {
    sessionKey: baseSessionKey,
    baseSessionKey,
    peer,
    chatType: params.chatType ?? peer.kind ?? "direct",
    from: params.from ?? "fixture-source",
    to: params.to ?? peer.id,
    ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
  };
}

export function createDedupeCache() {
  const seen = new Set();
  return {
    add(value) {
      seen.add(value);
      return true;
    },
    clear() {
      seen.clear();
    },
    delete(value) {
      return seen.delete(value);
    },
    has(value) {
      return seen.has(value);
    },
    get size() {
      return seen.size;
    },
  };
}

export function resolveGlobalDedupeCache() {
  return createDedupeCache();
}

export function generateSecureToken() {
  return "plugin-inspector-token";
}

export function generateSecureUuid() {
  return "00000000-0000-4000-8000-000000000000";
}

export function isSecretRef(value) {
  return typeof value === "string" && value.startsWith("secret:");
}

export function coerceSecretRef(value) {
  return isSecretRef(value) ? value : \`secret:\${String(value ?? "")}\`;
}

export function hasConfiguredSecretInput(value) {
  return value !== undefined && value !== null && value !== "";
}

export function resolveSecretInputString(value) {
  return typeof value === "string" ? value : value?.value ?? "";
}

export function normalizeResolvedSecretInputString(value) {
  return resolveSecretInputString(value).trim();
}

export function normalizeSecretInput(value) {
  return value;
}

export function normalizeSecretInputString(value) {
  return String(value ?? "").trim();
}

function createSimpleSchema(defaultValue) {
  return {
    parse(value) {
      return value === undefined ? defaultValue : value;
    },
    default(value) {
      return createSimpleSchema(value);
    },
    optional() {
      return this;
    },
    nullable() {
      return this;
    },
    nullish() {
      return this;
    },
  };
}

export function buildSecretInputSchema() {
  return createSimpleSchema();
}

export function buildOptionalSecretInputSchema() {
  return createSimpleSchema();
}

export function buildSecretInputArraySchema() {
  return createSimpleSchema([]);
}

export function registerPluginHttpRoute(options = {}) {
  return { ...options, kind: "httpRoute" };
}

export function registerWebhookTarget(options = {}) {
  return { ...options, unregister() {} };
}

export function registerWebhookTargetWithPluginRoute(options = {}) {
  return registerWebhookTarget({ ...options, pluginRoute: true });
}

export function resolveSingleWebhookTarget(target) {
  return target ?? null;
}

export async function resolveSingleWebhookTargetAsync(target) {
  return resolveSingleWebhookTarget(target);
}

export function resolveWebhookTargetWithAuthOrReject(target) {
  return target ?? null;
}

export function resolveWebhookTargetWithAuthOrRejectSync(target) {
  return resolveWebhookTargetWithAuthOrReject(target);
}

export function resolveWebhookTargets(targets = []) {
  return Array.isArray(targets) ? targets : [targets];
}

export async function withResolvedWebhookRequestPipeline(callback) {
  return typeof callback === "function" ? callback({}) : callback;
}

export function normalizeWebhookPath(value = "/") {
  const text = String(value || "/").trim();
  return text.startsWith("/") ? text : \`/\${text}\`;
}

export function resolveWebhookPath(value = "/") {
  return normalizeWebhookPath(typeof value === "string" ? value : value.path);
}

export function normalizePluginHttpPath(value = "/") {
  return normalizeWebhookPath(value);
}

export function createWebhookInFlightLimiter() {
  return { enter: () => true, leave() {} };
}

export function applyBasicWebhookRequestGuards() {
  return { ok: true };
}

export function beginWebhookRequestPipelineOrReject() {
  return { ok: true };
}

export function isJsonContentType(value = "") {
  return String(value).includes("json");
}

export function isRequestBodyLimitError(error) {
  return error?.code === "ERR_BODY_TOO_LARGE";
}

export async function readRequestBodyWithLimit() {
  return "";
}

export async function readJsonWebhookBodyOrReject() {
  return {};
}

export async function readWebhookBodyOrReject() {
  return "";
}

export function requestBodyErrorToText(error) {
  return error?.message ?? String(error ?? "");
}

export function resolveRequestClientIp() {
  return "127.0.0.1";
}

export function createAuthRateLimiter() {
  return { check: () => true };
}

export function createProviderApiKeyAuthMethod(options = {}) {
  return {
    id: options.id ?? "apiKey",
    type: "apiKey",
    ...options,
    async resolve(ctx = {}) {
      return ctx.apiKey ?? ctx.key ?? ctx.token ?? null;
    },
  };
}

export function buildSingleProviderApiKeyCatalog(options = {}) {
  const auth = options.auth ?? createProviderApiKeyAuthMethod(options.authOptions);
  return {
    auth,
    order: "simple",
    async run(ctx) {
      const provider = (await options.buildProvider?.(ctx)) ?? options.provider ?? { id: options.id ?? "provider", auth };
      return {
        provider,
        providers: [provider],
        models: (await options.buildModels?.(ctx)) ?? options.models ?? [],
      };
    },
  };
}

export function buildProviderToolCompatFamilyHooks(family) {
  return { family, hooks: [] };
}

export function buildProviderReplayFamilyHooks(params) {
  return { params, hooks: [] };
}

export function buildProviderStreamFamilyHooks(family) {
  return { family, hooks: [] };
}

export function stripUnsupportedSchemaKeywords(schema) {
  return schema;
}

export function stripXaiUnsupportedKeywords(schema) {
  return schema;
}

export function resolveXaiModelCompatPatch() {
  return {};
}

export function applyXaiModelCompat(model) {
  return model;
}

export function findUnsupportedSchemaKeywords() {
  return [];
}

export function normalizeGeminiToolSchemas(schema) {
  return schema;
}

export function inspectGeminiToolSchemas() {
  return [];
}

export function normalizeOpenAIToolSchemas(schema) {
  return schema;
}

export function findOpenAIStrictSchemaViolations() {
  return [];
}

export function inspectOpenAIToolSchemas() {
  return [];
}

export function cleanSchemaForGemini(schema) {
  return schema;
}

export function getModelProviderHint() {
  return null;
}

export function isProxyReasoningUnsupportedModelHint() {
  return false;
}

export function normalizeProviderId(value) {
  return String(value ?? "").trim();
}

export function resolveProviderEndpoint(value) {
  return value ?? null;
}

export function createWebSearchProviderContractFields(fields = {}) {
  return fields;
}

export function getScopedCredentialValue() {
  return undefined;
}

export function getTopLevelCredentialValue() {
  return undefined;
}

export function mergeScopedSearchConfig(config = {}) {
  return config;
}

export function resolveProviderWebSearchPluginConfig(config = {}) {
  return config;
}

export function setProviderWebSearchPluginConfigValue(config = {}, key, value) {
  return { ...config, [key]: value };
}

export function setScopedCredentialValue(config = {}, key, value) {
  return { ...config, [key]: value };
}

export function setTopLevelCredentialValue(config = {}, key, value) {
  return { ...config, [key]: value };
}

export function createRuntimeEnv(env = {}) {
  return { ...process.env, ...env };
}

export function resolveRuntimeEnv(env = {}) {
  return createRuntimeEnv(env);
}

export function createLoggerBackedRuntime(logger = console) {
  return { logger };
}

export function createSubsystemLogger() {
  return console;
}

export function buildThreadAwareOutboundSessionRoute(route = {}) {
  return route.route ?? route;
}

export function clearAccountEntryFields(entry = {}) {
  return { ...entry };
}

export function parseOptionalDelimitedEntries(value = "") {
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function recoverCurrentThreadSessionId() {
  return null;
}

export function stripChannelTargetPrefix(value) {
  return String(value ?? "").replace(/^channel:/, "");
}

export function stripTargetKindPrefix(value) {
  return String(value ?? "").replace(/^[^:]+:/, "");
}

export function tryReadSecretFileSync() {
  return undefined;
}

export function fetchWithTimeout(...args) {
  return fetch(...args);
}

export function fetchWithSsrFGuard(...args) {
  return fetch(...args);
}

export async function postJsonRequest() {
  return {};
}

export function assertOkOrThrowHttpError(response) {
  return response;
}

export function assertOkOrThrowProviderError(response) {
  return response;
}

export function createProviderHttpError(message = "provider http error") {
  return new Error(message);
}

export function extractProviderErrorDetail(error) {
  return error?.message ?? String(error ?? "");
}

export function extractProviderRequestId() {
  return null;
}

export function formatProviderErrorPayload(value) {
  return String(value ?? "");
}

export function formatProviderHttpErrorMessage(error) {
  return error?.message ?? String(error ?? "");
}

export async function readResponseTextLimited(response) {
  return response?.text ? response.text() : "";
}

export function truncateErrorDetail(value) {
  return String(value ?? "");
}

export function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\\/$/, "");
}

export function resolveProviderRequestCapabilities() {
  return [];
}

export function resolveProviderRequestPolicy() {
  return {};
}

export function buildHostnameAllowlistPolicyFromSuffixAllowlist() {
  return {};
}

export function closeDispatcher() {}

export function createPinnedDispatcher() {
  return {};
}

export function isBlockedHostnameOrIp() {
  return false;
}

export function isPrivateNetworkOptInEnabled() {
  return false;
}

export function isPrivateOrLoopbackHost() {
  return false;
}

export function mergeSsrFPolicies(...policies) {
  return Object.assign({}, ...policies);
}

export function resolvePinnedHostname(hostname) {
  return hostname;
}

export function resolvePinnedHostnameWithPolicy(hostname) {
  return { hostname, allowed: true };
}

export function ssrfPolicyFromHttpBaseUrlAllowedHostname(hostname) {
  return { allow: [hostname] };
}

export function formatErrorMessage(error) {
  return error?.message ?? String(error ?? "");
}

export function extractErrorCode(error) {
  return error?.code ?? null;
}

export function hasProxyEnvConfigured() {
  return false;
}

export function isNotFoundPathError(error) {
  return error?.code === "ENOENT";
}

export function isPathInside() {
  return true;
}

export function normalizeHostname(value) {
  return String(value ?? "").toLowerCase();
}

export function openFileWithinRoot() {
  return undefined;
}

export function writeFileFromPathWithinRoot() {
  return undefined;
}

export function redactSensitiveText(value) {
  return String(value ?? "");
}

export function safeEqualSecret(left, right) {
  return left === right;
}

export function wrapExternalContent(value) {
  return String(value ?? "");
}

export function renderQrTerminal(value) {
  return String(value ?? "");
}

export function chunkTextForOutbound(value) {
  return [String(value ?? "")];
}

export function truncateText(value, maxLength = 4000) {
  return String(value ?? "").slice(0, maxLength);
}

export function createMockPluginRuntime(runtime = {}) {
  return runtime;
}

export class SsrFBlockedError extends Error {
  constructor(message = "SSRF blocked") {
    super(message);
    this.name = "SsrFBlockedError";
  }
}

export class SafeOpenError extends Error {
  constructor(message = "Safe open failed") {
    super(message);
    this.name = "SafeOpenError";
  }
}

export const DEFAULT_CONTEXT_TOKENS = 128000;
export const XAI_TOOL_SCHEMA_PROFILE = "xai";
export const HTML_ENTITY_TOOL_CALL_ARGUMENTS_ENCODING = "html-entities";
export const XAI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set();
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set();
export const OPENAI_COMPATIBLE_REPLAY_HOOKS = buildProviderReplayFamilyHooks("openai-compatible");
export const ANTHROPIC_BY_MODEL_REPLAY_HOOKS = buildProviderReplayFamilyHooks("anthropic-by-model");
export const NATIVE_ANTHROPIC_REPLAY_HOOKS = buildProviderReplayFamilyHooks("native-anthropic");
export const PASSTHROUGH_GEMINI_REPLAY_HOOKS = buildProviderReplayFamilyHooks("passthrough-gemini");
export const GOOGLE_THINKING_STREAM_HOOKS = buildProviderStreamFamilyHooks("google-thinking");
export const KILOCODE_THINKING_STREAM_HOOKS = buildProviderStreamFamilyHooks("kilocode-thinking");
export const MINIMAX_FAST_MODE_STREAM_HOOKS = buildProviderStreamFamilyHooks("minimax-fast-mode");
export const MOONSHOT_THINKING_STREAM_HOOKS = buildProviderStreamFamilyHooks("moonshot-thinking");
export const OPENAI_RESPONSES_STREAM_HOOKS = buildProviderStreamFamilyHooks("openai-responses");
export const OPENROUTER_THINKING_STREAM_HOOKS = buildProviderStreamFamilyHooks("openrouter-thinking");
export const TOOL_STREAM_DEFAULT_ON_HOOKS = buildProviderStreamFamilyHooks("tool-stream-default");
export const pluginSdkMock = true;
${dynamicExportNames.length > 0 ? mockValueRuntimeSource() : ""}
${dynamicExportNames.map(genericExportStatement).join("\n")}

export default {
${[...exportNames].map((name) => `  ${name},`).join("\n")}
};
  `;
}

function mockValueRuntimeSource() {
  return `function createMockValue(name) {
  function fn(...args) {
    if (name === "resolvePreferredOpenClawTmpDir") {
      return process.env.TMPDIR || "/tmp";
    }
    if (name.startsWith("normalize")) {
      return typeof args[0] === "string" ? args[0] : "";
    }
    if (name === "jsonResult") {
      return { type: "json", value: args[0] };
    }
    if (name === "readStringParam") {
      return typeof args[0] === "string" ? args[0] : "";
    }
    return createMockValue(name);
  }
  return new Proxy(fn, {
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }
      if (property === Symbol.toPrimitive) {
        return () => name;
      }
      if (property === "toString") {
        return () => name;
      }
      if (property === "valueOf") {
        return () => name;
      }
      return createMockValue(\`\${name}.\${String(property)}\`);
    },
    construct() {
      return createMockValue(name);
    },
  });
}
`;
}

function mockSdkSubpathSource(staticExportNames, importedExportNames, options = {}) {
  const staticNames = new Set(staticExportNames);
  const dynamicNames = [...importedExportNames].filter((name) => !staticNames.has(name));
  return `${[...staticNames].map((name) => `export { ${name} } from "./index.js";`).join("\n")}
${dynamicNames.length > 0 ? genericMockRuntimeSource({ includeSdkRuntime: true, zod: options.zod }) : ""}
${dynamicNames.map(genericExportStatement).join("\n")}
export { default } from "./index.js";
`;
}
