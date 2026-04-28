import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

export const syntheticRegistrationExecutionProfiles = {
  defineChannelPluginEntry: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "entry wrapper metadata is captured before channel runtime execution",
  },
  definePluginEntry: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "entry wrapper metadata is captured before plugin runtime execution",
  },
  registerChannel: {
    mode: "channel-opt-in",
    callableProperties: ["send", "sendMessage", "receive", "handleMessage"],
    option: "includeChannelRuntime",
  },
  registerAgentHarness: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "agent harness factories are captured as registration metadata; agent runtime execution remains isolated opt-in",
  },
  registerAgentToolResultMiddleware: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "agent tool-result middleware is captured as registration metadata before tool-result pipeline execution",
  },
  registerAutoEnableProbe: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "auto-enable probes are captured as registration metadata before runtime activation checks",
  },
  registerCli: {
    mode: "direct",
    callableProperties: ["handler", "run", "execute"],
  },
  registerCliBackend: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "CLI backend descriptors are captured as registration metadata before backend process execution",
  },
  registerCommand: {
    mode: "direct",
    callableProperties: ["handler", "run", "execute"],
  },
  registerCodexAppServerExtensionFactory: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "Codex app server extension factories are captured as registration metadata before host UI execution",
  },
  registerCompactionProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "compaction providers are captured as registration metadata before compaction runtime execution",
  },
  registerConfigMigration: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "config migrations are captured as registration metadata before mutating stored plugin config",
  },
  registerContextEngine: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "context engine factories are captured as registration metadata; engine startup remains isolated opt-in",
  },
  registerDetachedTaskRuntime: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "detached task runtimes are captured as registration metadata before async task execution",
  },
  registerGatewayDiscoveryService: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "gateway discovery services are captured as registration metadata before network discovery execution",
  },
  registerGatewayMethod: {
    mode: "direct",
    callableProperties: ["handler", "run", "execute", "invoke"],
  },
  registerHttpRoute: {
    mode: "direct",
    callableProperties: ["handler", "run", "execute"],
  },
  registerInteractiveHandler: {
    mode: "direct",
    callableProperties: ["handler", "run", "execute"],
  },
  registerHook: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "legacy hook registrar is captured as metadata; hook handlers are probed through hook events",
  },
  registerImageGenerationProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "image generation providers are captured as registration metadata before provider runtime execution",
  },
  registerMemoryPromptSection: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory prompt section renderers are captured as metadata before prompt-runtime execution",
  },
  registerMediaUnderstandingProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "media understanding providers are captured as registration metadata before provider runtime execution",
  },
  registerMemoryCapability: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory capabilities are captured as registration metadata before memory runtime execution",
  },
  registerMemoryCorpusSupplement: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory corpus supplements are captured as registration metadata before memory runtime execution",
  },
  registerMemoryEmbeddingProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory embedding providers are captured as registration metadata before provider runtime execution",
  },
  registerMemoryFlushPlan: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory flush plans are captured as registration metadata before memory runtime execution",
  },
  registerMemoryRuntime: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory runtime factories are captured as metadata; external memory startup remains isolated opt-in",
  },
  registerMemoryPromptSupplement: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "memory prompt supplements are captured as registration metadata before prompt-runtime execution",
  },
  registerMigrationProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "migration providers are captured as registration metadata before migration runtime execution",
  },
  registerMusicGenerationProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "music generation providers are captured as registration metadata before provider runtime execution",
  },
  registerNodeHostCommand: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "node host commands are captured as registration metadata before host process execution",
  },
  registerProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "provider descriptors are captured as registration metadata before provider runtime execution",
  },
  registerRealtimeTranscriptionProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "realtime transcription providers are captured as registration metadata before provider runtime execution",
  },
  registerRealtimeVoiceProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "realtime voice providers are captured as registration metadata before provider runtime execution",
  },
  registerReload: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "reload handlers are captured as registration metadata before runtime reload execution",
  },
  registerSecurityAuditCollector: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "security audit collectors are captured as registration metadata before filesystem or policy scans",
  },
  registerService: {
    mode: "lifecycle-opt-in",
    callableProperties: ["start", "stop", "dispose"],
    option: "includeLifecycle",
  },
  registerSpeechProvider: {
    mode: "provider-opt-in",
    callableProperties: ["speak", "synthesize", "tts"],
    option: "includeProviderCapabilities",
  },
  registerTool: {
    mode: "direct",
    callableProperties: ["run", "handler", "execute"],
  },
  registerTextTransforms: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "text transforms are captured as registration metadata before content mutation execution",
  },
  registerVideoGenerationProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "video generation providers are captured as registration metadata before provider runtime execution",
  },
  registerWebFetchProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "web fetch providers are captured as registration metadata before provider runtime execution",
  },
  registerWebSearchProvider: {
    mode: "metadata-only",
    callableProperties: [],
    reason: "web search providers are captured as registration metadata before provider runtime execution",
  },
};

export const defaultSyntheticHookEvents = {
  agent_end: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    conversationId: "conversation-fixture",
    status: "completed",
    transcript: [{ role: "assistant", content: "[redacted fixture output]" }],
  },
  before_agent_start: {
    agentId: "agent-fixture",
    runId: "run-fixture",
    config: { source: "plugin-inspector" },
  },
  before_prompt_build: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    conversationId: "conversation-fixture",
    messages: [{ role: "user", content: "fixture prompt" }],
    metadata: { source: "plugin-inspector" },
  },
  before_tool_call: {
    runId: "run-fixture",
    toolName: "fixture_tool",
    params: {},
    toolCallId: "call-fixture",
  },
  inbound_claim: {
    channelId: "fixture-channel",
    source: { type: "external", id: "fixture-source" },
    message: { id: "message-fixture", text: "claim this message" },
  },
  llm_input: {
    agentId: "agent-fixture",
    model: "gpt-5.4",
    messages: [{ role: "user", content: "[redacted fixture input]" }],
  },
  llm_output: {
    agentId: "agent-fixture",
    model: "gpt-5.4",
    output: { role: "assistant", content: "[redacted fixture output]" },
  },
  subagent_delivery_target: {
    childSessionKey: "child-session",
    agentId: "agent-child",
    label: "fixture child",
    mode: "run",
    requester: { channel: "fixture-channel", accountId: "fixture-account" },
  },
  subagent_ended: {
    childSessionKey: "child-session",
    agentId: "agent-child",
    status: "completed",
  },
  subagent_spawned: {
    childSessionKey: "child-session",
    agentId: "agent-child",
    label: "fixture child",
    mode: "run",
  },
};

export const defaultSyntheticHookContexts = {
  agent_end: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
    channelId: "fixture-channel",
  },
  before_agent_start: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
  },
  before_prompt_build: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
    channelId: "fixture-channel",
  },
  before_tool_call: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
    toolName: "fixture_tool",
  },
  inbound_claim: {
    channelId: "fixture-channel",
    accountId: "fixture-account",
  },
  llm_input: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
  },
  llm_output: {
    runId: "run-fixture",
    agentId: "agent-fixture",
    sessionId: "session-fixture",
  },
  subagent_delivery_target: {
    runId: "run-fixture",
    parentAgentId: "agent-parent",
  },
  subagent_ended: {
    runId: "run-fixture",
    parentAgentId: "agent-parent",
  },
  subagent_spawned: {
    runId: "run-fixture",
    parentAgentId: "agent-parent",
  },
};

export const defaultSyntheticRegistrationArguments = {
  defineChannelPluginEntry: [{ id: "fixture-channel", setup: "function", receive: "function" }],
  definePluginEntry: [{ id: "fixture-plugin", register: "function" }],
  registerChannel: [{ id: "fixture-channel", send: "function", receive: "function" }],
  registerCli: [{ name: "fixture-command", args: [{ name: "input", type: "string" }] }],
  registerCommand: [{ name: "fixture-command", handler: "function" }],
  registerContextEngine: [{ id: "fixture-context-engine", factory: "function" }],
  registerGatewayMethod: [{ name: "fixture.gateway.method", inputSchema: { type: "object" }, handler: "function" }],
  registerHook: ["before_prompt_build", "function"],
  registerHttpRoute: [{ method: "POST", path: "/fixture/probe", handler: "function" }],
  registerInteractiveHandler: [{ id: "fixture-interaction", handler: "function" }],
  registerMemoryPromptSection: [{ id: "fixture-memory-section", render: "function" }],
  registerMemoryRuntime: [{ id: "fixture-memory-runtime", create: "function" }],
  registerService: [{ name: "fixture-service", start: "function", stop: "function" }],
  registerSpeechProvider: [{ id: "fixture-speech", speak: "function" }],
  registerTool: [{ name: "fixture_tool", inputSchema: { type: "object", properties: {} }, run: "function" }],
};

export const defaultSyntheticRegistrationProbeInputs = {
  registerCli: {
    execute: commandProbeArgs,
    handler: commandProbeArgs,
    run: commandProbeArgs,
  },
  registerCommand: {
    execute: commandProbeArgs,
    handler: commandProbeArgs,
    run: commandProbeArgs,
  },
  registerChannel: {
    handleMessage: channelReceiveProbeArgs,
    receive: channelReceiveProbeArgs,
    send: channelSendProbeArgs,
    sendMessage: channelSendProbeArgs,
  },
  registerGatewayMethod: {
    execute: gatewayProbeArgs,
    handler: gatewayProbeArgs,
    run: gatewayProbeArgs,
  },
  registerHttpRoute: {
    execute: httpRouteProbeArgs,
    handler: httpRouteProbeArgs,
    run: httpRouteProbeArgs,
  },
  registerInteractiveHandler: {
    execute: interactiveProbeArgs,
    handler: interactiveProbeArgs,
    run: interactiveProbeArgs,
  },
  registerService: {
    start: lifecycleProbeArgs,
    stop: lifecycleProbeArgs,
  },
  registerSpeechProvider: {
    speak: speechProbeArgs,
    synthesize: speechProbeArgs,
  },
  registerTool: {
    execute: toolExecuteProbeArgs,
    handler: toolRunProbeArgs,
    run: toolRunProbeArgs,
  },
};

export function buildSyntheticProbePlan(options = {}) {
  if (!options.capture) {
    throw new TypeError("buildSyntheticProbePlan requires a capture inventory");
  }

  const hookEvents = options.hookEvents ?? defaultSyntheticHookEvents;
  const hookContexts = options.hookContexts ?? defaultSyntheticHookContexts;
  const registrationArguments = options.registrationArguments ?? defaultSyntheticRegistrationArguments;
  const capture = options.capture;
  const hooks = capture.fixtures.flatMap((fixture) =>
    fixture.hooks.map((hook) => ({
      id: hook.id,
      fixture: fixture.id,
      kind: "hook",
      seam: hook.hook,
      status: hook.syntheticEvent && typeof hook.syntheticEvent === "object" ? "ready" : "blocked",
      blocker: hook.syntheticEvent && typeof hook.syntheticEvent === "object" ? null : "missing synthetic event",
      assertions: hook.assertions,
      syntheticEvent: hook.syntheticEvent ?? hookEvents[hook.hook] ?? { hook: hook.hook },
      syntheticContext: hook.syntheticContext ?? hookContexts[hook.hook] ?? { hook: hook.hook },
      source: hook.ref,
    })),
  );
  const registrations = capture.fixtures.flatMap((fixture) =>
    fixture.registrations.map((registration) => {
      const execution = registrationExecutionProfile(registration.registrar);
      const hasSyntheticArguments = Array.isArray(registration.syntheticArguments);
      const status = hasSyntheticArguments && execution.mode !== "unknown" ? "ready" : "blocked";
      return {
        id: registration.id,
        fixture: fixture.id,
        kind: "registration",
        seam: registration.registrar,
        status,
        blocker: probeBlocker({ hasSyntheticArguments, execution }),
        assertions: registration.assertions,
        syntheticArguments: registration.syntheticArguments ?? registrationArguments[registration.registrar] ?? [{}],
        execution,
        source: registration.ref,
      };
    }),
  );
  const probes = [...hooks, ...registrations];

  return {
    generatedAt: capture.generatedAt,
    summary: {
      fixtureCount: capture.summary.fixtureCount,
      probeCount: probes.length,
      hookProbeCount: hooks.length,
      registrationProbeCount: registrations.length,
      readyCount: probes.filter((probe) => probe.status === "ready").length,
      blockedCount: probes.filter((probe) => probe.status === "blocked").length,
      directExecutionCount: registrations.filter((probe) => probe.execution.mode === "direct").length,
      optInExecutionCount: registrations.filter((probe) => probe.execution.mode.endsWith("-opt-in")).length,
      metadataOnlyCount: registrations.filter((probe) => probe.execution.mode === "metadata-only").length,
    },
    probes,
  };
}

export function validateSyntheticProbePlan(plan) {
  const errors = [];
  for (const probe of plan.probes) {
    if (!probe.source) {
      errors.push(`${probe.id}: missing source reference`);
    }
    if (!Array.isArray(probe.assertions) || probe.assertions.length === 0) {
      errors.push(`${probe.id}: missing probe assertions`);
    }
    if (probe.status === "blocked") {
      errors.push(`${probe.id}: ${probe.blocker}`);
    }
  }
  return errors;
}

export async function writeSyntheticProbePlan(plan, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    json: plan,
    markdown: renderSyntheticProbeMarkdown(plan, options),
  });
}

export async function runCapturedSyntheticProbes(capture, options = {}) {
  const hookEvents = options.hookEvents ?? defaultSyntheticHookEvents;
  const hookContexts = options.hookContexts ?? defaultSyntheticHookContexts;
  const captured = capture.captured ?? [];
  const retained = new Map((capture.retained ?? []).map((item) => [item.captureIndex, item]));
  const results = [];

  for (let index = 0; index < captured.length; index += 1) {
    const entry = captured[index];
    const retainedEntry = retained.get(index);
    if (!retainedEntry) {
      results.push(blockedResult(entry, index, "handler retention was not enabled"));
      continue;
    }
    if (entry.kind === "hook") {
      results.push(await runHookProbe(entry, retainedEntry, index, { hookEvents, hookContexts }));
      continue;
    }
    if (entry.kind === "registration") {
      results.push(...(await runRegistrationProbes(entry, retainedEntry, index, options)));
    }
  }

  return {
    entrypoint: capture.entrypoint,
    status: capture.status,
    summary: {
      probeCount: results.length,
      passCount: results.filter((result) => result.status === "pass").length,
      failCount: results.filter((result) => result.status === "fail").length,
      blockedCount: results.filter((result) => result.status === "blocked").length,
    },
    results,
  };
}

export function renderSyntheticProbeMarkdown(plan, options = {}) {
  return [
    `# ${options.title ?? "Plugin Inspector Synthetic Probes"}`,
    "",
    `Generated: ${plan.generatedAt}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Fixtures", plan.summary.fixtureCount],
        ["Probes", plan.summary.probeCount],
        ["Hook probes", plan.summary.hookProbeCount],
        ["Registration probes", plan.summary.registrationProbeCount],
        ["Ready", plan.summary.readyCount],
        ["Blocked", plan.summary.blockedCount],
        ["Direct execution", plan.summary.directExecutionCount],
        ["Opt-in execution", plan.summary.optInExecutionCount],
        ["Metadata-only", plan.summary.metadataOnlyCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Probe Inventory",
    "",
    markdownTable(
      plan.probes.map((probe) => [
        probe.fixture,
        probe.kind,
        probe.seam,
        probe.status,
        probe.execution?.mode ?? "hook-direct",
        probe.source,
        probe.assertions.join("; "),
      ]),
      ["Fixture", "Kind", "Seam", "Status", "Execution", "Evidence", "Assertions"],
    ),
  ].join("\n");
}

function registrationExecutionProfile(registrar) {
  return (
    syntheticRegistrationExecutionProfiles[registrar] ?? {
      mode: "unknown",
      callableProperties: [],
      reason: "registrar has not been classified for synthetic execution",
    }
  );
}

function probeBlocker({ hasSyntheticArguments, execution }) {
  if (!hasSyntheticArguments) {
    return "missing synthetic arguments";
  }
  if (execution.mode === "unknown") {
    return execution.reason;
  }
  return null;
}

async function runHookProbe(entry, retainedEntry, captureIndex, { hookEvents, hookContexts }) {
  if (typeof retainedEntry.handler !== "function") {
    return blockedResult(entry, captureIndex, "captured hook has no callable handler");
  }
  return runProbe({
    captureIndex,
    kind: "hook",
    seam: entry.name,
    label: entry.name,
    invoke: () =>
      retainedEntry.handler(
        hookEvents[entry.name] ?? { hook: entry.name },
        hookContexts[entry.name] ?? { hook: entry.name },
      ),
  });
}

async function runRegistrationProbes(entry, retainedEntry, captureIndex, options) {
  const profile = registrationExecutionProfile(entry.name);
  if (profile.mode === "unknown") {
    return [blockedResult(entry, captureIndex, "captured registration has no execution profile")];
  }
  if (profile.mode === "metadata-only") {
    return [metadataOnlyResult(entry, captureIndex, profile.reason)];
  }

  const descriptor =
    retainedEntry.arguments?.find((value) => value && typeof value === "object") ?? retainedEntry.returnValue;
  if (!descriptor || typeof descriptor !== "object") {
    return [blockedResult(entry, captureIndex, "captured registration has no object descriptor")];
  }
  if (profile.option && options[profile.option] !== true) {
    return [blockedResult(entry, captureIndex, `captured registration requires ${profile.option}=true`)];
  }

  const invocations = registrationInvocations(entry.name, descriptor, retainedEntry.returnValue, profile, options);
  if (invocations.length === 0) {
    return [blockedResult(entry, captureIndex, "captured registration has no supported callable probe")];
  }

  return Promise.all(
    invocations.map((invocation) =>
      runProbe({
        captureIndex,
        kind: "registration",
        seam: entry.name,
        label: invocation.label,
        invoke: invocation.invoke,
      }),
    ),
  );
}

function registrationInvocations(registrar, descriptor, returnValue, profile, options) {
  const invocations = [];
  const allowReturnValueFallback = descriptor === returnValue;

  for (const property of profile.callableProperties) {
    const callable =
      typeof descriptor[property] === "function"
        ? descriptor[property]
        : allowReturnValueFallback
          ? returnValue?.[property]
          : undefined;
    if (typeof callable === "function") {
      invocations.push({
        label: `${registrar}.${property}`,
        invoke: () => invokeRegistrationCallable(callable, registrar, property, options),
      });
    }
  }
  return invocations;
}

function invokeRegistrationCallable(callable, registrar, property, options) {
  const event = syntheticRegistrationEvent(registrar, property, options);
  const inputFactory = options.registrationProbeInputs?.[registrar]?.[property] ?? defaultSyntheticRegistrationProbeInputs[registrar]?.[property];
  const args = inputFactory ? inputFactory(event, options) : [event];
  return callable(...args);
}

function syntheticRegistrationEvent(registrar, property, options) {
  const hookEvents = options.hookEvents ?? defaultSyntheticHookEvents;
  const beforeToolCall = hookEvents.before_tool_call ?? defaultSyntheticHookEvents.before_tool_call;
  return {
    source: options.syntheticSource ?? "plugin-inspector.synthetic",
    registrar,
    property,
    params: {},
    input: {},
    body: {},
    headers: {},
    toolName: beforeToolCall.toolName,
    toolCall: {
      id: beforeToolCall.toolCallId,
      name: beforeToolCall.toolName,
    },
    respond(ok, result, error) {
      return { ok, result, ...(error ? { error } : {}) };
    },
  };
}

function toolRunProbeArgs(event) {
  return [
    event.params,
    {
      source: event.source,
      toolName: event.toolName,
      toolCallId: event.toolCall.id,
      signal: new AbortController().signal,
      logger: console,
    },
  ];
}

function toolExecuteProbeArgs(event) {
  return [event.toolCall.id, event.params, new AbortController().signal, () => undefined];
}

function httpRouteProbeArgs(event) {
  return [
    {
      method: "POST",
      path: "/fixture/probe",
      url: "http://127.0.0.1/fixture/probe",
      headers: event.headers,
      body: event.body,
      json: async () => event.body,
      text: async () => JSON.stringify(event.body),
    },
    {
      source: event.source,
      params: event.params,
      logger: console,
    },
  ];
}

function commandProbeArgs(event) {
  return [
    event.input,
    {
      source: event.source,
      signal: new AbortController().signal,
      logger: console,
    },
  ];
}

function gatewayProbeArgs(event) {
  return [
    {
      ...event,
      params: event.params,
      body: event.body,
      headers: event.headers,
      respond: event.respond,
    },
    {
      source: event.source,
      logger: console,
    },
  ];
}

function channelSendProbeArgs(event) {
  return [
    {
      source: event.source,
      channelId: "fixture-channel",
      accountId: "fixture-account",
      to: "fixture-recipient",
      text: "fixture message",
      replyToId: "fixture-reply",
      threadId: "fixture-thread",
      logger: console,
      signal: new AbortController().signal,
    },
  ];
}

function channelReceiveProbeArgs(event) {
  return [
    {
      source: event.source,
      channelId: "fixture-channel",
      accountId: "fixture-account",
      message: {
        id: "message-fixture",
        text: "fixture inbound message",
        sender: { id: "sender-fixture", displayName: "Fixture Sender" },
      },
      route: {
        sessionKey: "fixture-session",
        baseSessionKey: "fixture-base-session",
        peer: { kind: "direct", id: "sender-fixture" },
        chatType: "direct",
        from: "sender-fixture",
        to: "fixture-channel",
      },
      logger: console,
      signal: new AbortController().signal,
    },
  ];
}

function interactiveProbeArgs(event) {
  return [
    {
      id: "interaction-fixture",
      payload: event.body,
    },
    {
      source: event.source,
      logger: console,
    },
  ];
}

function lifecycleProbeArgs(event) {
  return [
    {
      source: event.source,
      config: {},
      logger: console,
      runtime: { env: {}, logger: console },
      secrets: { get: async () => null, has: async () => false },
      signal: new AbortController().signal,
    },
  ];
}

function speechProbeArgs(event) {
  return [
    {
      text: "fixture speech request",
      voice: "fixture",
    },
    {
      source: event.source,
      logger: console,
    },
  ];
}

async function runProbe({ captureIndex, kind, seam, label, invoke }) {
  try {
    const output = await invoke();
    return {
      captureIndex,
      kind,
      seam,
      label,
      status: "pass",
      output: summarizeValue(output),
    };
  } catch (error) {
    return {
      captureIndex,
      kind,
      seam,
      label,
      status: "fail",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function blockedResult(entry, captureIndex, reason) {
  return {
    captureIndex,
    kind: entry.kind,
    seam: entry.name,
    label: entry.name,
    status: "blocked",
    reason,
  };
}

function metadataOnlyResult(entry, captureIndex, reason) {
  return {
    captureIndex,
    kind: entry.kind,
    seam: entry.name,
    label: entry.name,
    status: "pass",
    output: { mode: "metadata-only", reason },
  };
}

function summarizeValue(value) {
  if (typeof value === "function") {
    return { type: "function" };
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value).sort(),
    };
  }
  return { type: typeof value, value };
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
