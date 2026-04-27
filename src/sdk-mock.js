import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const mockSdkSubpathExports = {
  "plugin-entry": [
    "buildPluginConfigSchema",
    "definePluginEntry",
    "emptyPluginConfigSchema",
  ],
  core: [
    "buildChannelConfigSchema",
    "buildPluginConfigSchema",
    "createChatChannelPlugin",
    "createDedupeCache",
    "defineChannelPluginEntry",
    "definePluginEntry",
    "defineSetupPluginEntry",
    "emptyChannelConfigSchema",
    "emptyPluginConfigSchema",
    "jsonResult",
    "readNumberParam",
    "readStringParam",
  ],
  "channel-core": [
    "buildChannelConfigSchema",
    "buildThreadAwareOutboundSessionRoute",
    "clearAccountEntryFields",
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

export async function createMockSdkPackage(rootDir) {
  const packageDir = path.join(rootDir, "node_modules", "openclaw");
  const pluginSdkDir = path.join(packageDir, "plugin-sdk");
  await mkdir(pluginSdkDir, { recursive: true });
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
  await writeFile(path.join(pluginSdkDir, "index.js"), mockSdkSource(), "utf8");
  for (const [subpath, exportNames] of Object.entries(mockSdkSubpathExports)) {
    await writeFile(path.join(pluginSdkDir, `${subpath}.js`), mockSdkSubpathSource(exportNames), "utf8");
  }
  return packageDir;
}

function mockSdkSource() {
  return `function normalizeEntry(entry) {
  return typeof entry === "function" ? { register: entry } : entry;
}

export function definePluginEntry(entry) {
  return normalizeEntry(entry);
}

export function defineChannelPluginEntry(entry) {
  return normalizeEntry(entry);
}

export function defineSetupPluginEntry(entry) {
  return normalizeEntry(entry);
}

export function createChatChannelPlugin(entry) {
  return normalizeEntry(entry);
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
  return schema;
}

export const emptyPluginConfigSchema = { type: "object", properties: {}, additionalProperties: false };

export function buildChannelConfigSchema(schema = {}) {
  return schema;
}

export const emptyChannelConfigSchema = emptyPluginConfigSchema;

export function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function readNumberParam(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readStringParam(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
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

export function buildSecretInputSchema() {
  return { type: "string" };
}

export function buildOptionalSecretInputSchema() {
  return { anyOf: [buildSecretInputSchema(), { type: "undefined" }] };
}

export function buildSecretInputArraySchema() {
  return { type: "array", items: buildSecretInputSchema() };
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
  return { type: "apiKey", ...options };
}

export function buildSingleProviderApiKeyCatalog(options = {}) {
  return {
    order: "simple",
    async run(ctx) {
      return { provider: await options.buildProvider?.(ctx) };
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
  return route;
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

export default {
${mockSdkExportNames.map((name) => `  ${name},`).join("\n")}
};
`;
}

function mockSdkSubpathSource(exportNames) {
  return `${exportNames.map((name) => `export { ${name} } from "./index.js";`).join("\n")}
export { default } from "./index.js";
`;
}
