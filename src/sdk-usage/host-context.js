// These host-injected helpers are part of the public capability-catalog contract.
// A matching arbitrary function signature is not sufficient: ownership must start
// at PluginCapabilityCatalogContext/HostContext imported from the public SDK.
// Keep this small adapter separate from general symbol/alias extraction.
const helperModules = {
  isProviderApiKeyConfigured: "provider-auth",
  isProviderApiKeyConfiguredAsync: "provider-auth",
  isProviderAuthProfileConfigured: "provider-auth",
  isProviderAuthProfileConfiguredAsync: "provider-auth",
  resolveProviderAuthProfileApiKey: "provider-auth",
  resolveAgentDir: "agent-scope-runtime",
  createRealtimeTranscriptionWebSocketSession: "realtime-transcription-session",
  resolveProviderRequestHeaders: "provider-http",
  createProviderHttpError: "provider-http",
  readProviderJsonResponse: "provider-http",
  readProviderTextResponse: "provider-http",
  formatErrorMessage: "error-runtime",
  warn: "runtime-env",
  redactSensitiveText: "security-runtime",
  fetchWithSsrFGuard: "ssrf-runtime",
  captureWsEvent: "proxy-capture",
  captureWsEventAsync: "proxy-capture",
  createDebugProxyWebSocketAgent: "proxy-capture",
  resolveDebugProxySettings: "proxy-capture",
};

export const capabilityContextTypes = new Set([
  "PluginCapabilityCatalogContext", "PluginCapabilityCatalogHostContext",
]);

export function capabilityContextMember(value, key) {
  const module = helperModules[key];
  if (!module || !value.type.getProperty(key)) return undefined;
  return { kind: "export", module: `openclaw/plugin-sdk/${module}`, name: key };
}
