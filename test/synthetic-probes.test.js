import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildSyntheticProbePlan,
  captureEntrypoint,
  createCaptureApi,
  defaultSyntheticHookContexts,
  defaultSyntheticHookEvents,
  renderSyntheticProbeMarkdown,
  runCapturedSyntheticProbes,
  runEntrypointSyntheticProbes,
  validateSyntheticProbePlan,
} from "../src/advanced.js";
import { buildSyntheticProbePlanFromReport } from "../src/synthetic-probe-suite.js";

test("synthetic probe plan maps capture inventory to executable probes", () => {
  const plan = buildSyntheticProbePlan({
    capture: {
      generatedAt: "test",
      summary: { fixtureCount: 1 },
      fixtures: [
        {
          id: "fixture",
          hooks: [
            {
              id: "hook.before_tool_call:fixture:index",
              hook: "before_tool_call",
              ref: "src/index.js",
              assertions: ["synthetic hook payload is accepted"],
              syntheticEvent: { toolName: "fixture_tool" },
            },
          ],
          registrations: [
            {
              id: "registration.registerTool:fixture:index",
              registrar: "registerTool",
              ref: "src/index.js",
              assertions: ["tool schema is captured"],
              syntheticArguments: [{ name: "fixture_tool" }],
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(validateSyntheticProbePlan(plan), []);
  assert.equal(plan.summary.probeCount, 2);
  assert.equal(plan.summary.readyCount, 2);
  assert.match(renderSyntheticProbeMarkdown(plan), /registerTool/);
});

test("synthetic probe plan can be built from a compatibility report", () => {
  const plan = buildSyntheticProbePlanFromReport({
    generatedAt: "test",
    targetOpenClaw: {
      capturedRegistrars: ["registerTool"],
      sdkExports: [],
    },
    summary: {},
    fixtures: [
      {
        id: "fixture",
        priority: "high",
        hookDetails: [{ name: "before_tool_call", ref: "src/index.js:1" }],
        registrationDetails: [{ name: "registerTool", ref: "src/index.js:2" }],
        sdkImportDetails: [],
        packages: [],
      },
    ],
    contractProbes: [],
  });

  assert.equal(plan.generatedAt, "test");
  assert.equal(plan.summary.probeCount, 2);
  assert.equal(plan.summary.readyCount, 2);
  assert.deepEqual(validateSyntheticProbePlan(plan), []);
});

test("synthetic probe plan blocks unclassified registrars", () => {
  const plan = buildSyntheticProbePlan({
    capture: {
      generatedAt: "test",
      summary: { fixtureCount: 1 },
      fixtures: [
        {
          id: "fixture",
          hooks: [],
          registrations: [
            {
              id: "registration.registerMystery:fixture:index",
              registrar: "registerMystery",
              ref: "src/index.js",
              assertions: ["mystery registration is classified"],
              syntheticArguments: [{}],
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.blockedCount, 1);
  assert.match(validateSyntheticProbePlan(plan).join("\n"), /not been classified/);
});

test("synthetic probe plan classifies generated kitchen-sink registrars", () => {
  const kitchenSinkRegistrars = [
    "createChatChannelPlugin",
    "registerAgentEventSubscription",
    "registerAgentHarness",
    "registerAgentToolResultMiddleware",
    "registerAutoEnableProbe",
    "registerBoardWidgetContentKind",
    "registerChannel",
    "defineBundledChannelEntry",
    "registerCli",
    "registerCliBackend",
    "registerCodexAppServerExtensionFactory",
    "registerCommand",
    "registerCompactionProvider",
    "registerConfigMigration",
    "registerContextEngine",
    "registerControlUiDescriptor",
    "registerDetachedTaskRuntime",
    "registerEmbeddingProvider",
    "registerGatewayDiscoveryService",
    "registerGatewayMethod",
    "registerHook",
    "registerHostedMediaResolver",
    "registerHttpRoute",
    "registerImageGenerationProvider",
    "registerInteractiveHandler",
    "registerMcpServerConnectionResolver",
    "registerMediaUnderstandingProvider",
    "registerMeetingNotesSourceProvider",
    "registerMemoryCapability",
    "registerMemoryCorpusSupplement",
    "registerMemoryEmbeddingProvider",
    "registerMemoryFlushPlan",
    "registerMemoryPromptPreparation",
    "registerMemoryPromptSection",
    "registerMemoryPromptSupplement",
    "registerMemoryRuntime",
    "registerMigrationProvider",
    "registerModelCatalogProvider",
    "registerMusicGenerationProvider",
    "registerNodeCliFeature",
    "registerNodeHostCommand",
    "registerNodeInvokePolicy",
    "registerProvider",
    "registerRealtimeTranscriptionProvider",
    "registerRealtimeVoiceProvider",
    "registerReload",
    "registerRuntimeLifecycle",
    "registerSecurityAuditCollector",
    "registerService",
    "registerSessionAction",
    "registerSessionCatalog",
    "registerSessionExtension",
    "registerSessionSchedulerJob",
    "registerSpeechProvider",
    "registerTextTransforms",
    "registerTool",
    "registerToolMetadata",
    "registerTranscriptSourceProvider",
    "registerTrustedToolPolicy",
    "registerVideoGenerationProvider",
    "registerWebFetchProvider",
    "registerWebSearchProvider",
    "registerWidgetPresenter",
    "registerWorkerProvider",
  ];
  const plan = buildSyntheticProbePlan({
    capture: {
      generatedAt: "test",
      summary: { fixtureCount: 1 },
      fixtures: [
        {
          id: "kitchen-sink",
          hooks: [],
          registrations: kitchenSinkRegistrars.map((registrar) => ({
            id: `registration.${registrar}:kitchen-sink:index`,
            registrar,
            ref: "src/generated-registrars.js",
            assertions: [`${registrar} is classified`],
            syntheticArguments: [{}],
          })),
        },
      ],
    },
  });

  assert.equal(plan.summary.probeCount, kitchenSinkRegistrars.length);
  assert.equal(plan.summary.blockedCount, 0);
  assert.deepEqual(validateSyntheticProbePlan(plan), []);
});

test("synthetic probes capture metadata-only registrars without invoking runtime callbacks", async () => {
  const api = createCaptureApi({ retainHandlers: true });
  const invoked = [];
  const callback = (name) => () => { invoked.push(name); };
  const registrations = [
    ...["current_channel", "node_panel"].map((target) => ["registerWidgetPresenter", {
      target,
      description: `Fixture ${target}`,
      availability: callback(`${target}.availability`),
      present: callback(`${target}.present`),
      ...(target === "current_channel"
        ? { match: callback(`${target}.match`), capabilities: { sourceKinds: ["html"] } }
        : {}),
    }]),
    ["registerBoardWidgetContentKind", {
      kind: "fixture",
      label: "Fixture",
      resources: {
        surface: "fixture",
        paths: [],
        readPublicResource: callback("board.readPublicResource"),
      },
      validateSource: callback("board.validateSource"),
      composeDocument: callback("board.composeDocument"),
    }],
    ["registerMemoryPromptPreparation", async () => {
      invoked.push("memory.prepare");
      return [];
    }],
    ["registerTranscriptSourceProvider", {
      id: "fixture",
      name: "Fixture",
      sourceKinds: ["live-audio", "posthoc-transcript"],
      start: callback("transcript.start"),
      watchOccupancy: callback("transcript.watchOccupancy"),
      stop: callback("transcript.stop"),
      status: callback("transcript.status"),
      importTranscript: callback("transcript.importTranscript"),
    }],
    ["registerWorkerProvider", {
      id: "fixture",
      resolveAllocation: callback("worker.resolveAllocation"),
      provision: callback("worker.provision"),
      inspect: callback("worker.inspect"),
      renew: callback("worker.renew"),
      destroy: callback("worker.destroy"),
    }],
    ["registerMcpServerConnectionResolver", {
      serverName: "fixture",
      resolve: callback("mcp.resolve"),
    }],
  ];
  for (const [registrar, argument] of registrations) {
    api[registrar](argument);
  }
  const capture = {
    status: "captured",
    captured: api.getCapturedContracts(),
    retained: api.getRetainedContracts(),
  };
  assert.deepEqual(capture.captured.map((entry) => entry.name), registrations.map(([registrar]) => registrar));
  assert.equal(capture.retained.length, registrations.length);
  for (const [index, [registrar, argument]] of registrations.entries()) {
    assert.equal(capture.retained[index].name, registrar);
    assert.equal(capture.retained[index].arguments[0], argument);
  }

  for (const options of [{}, { includeLifecycle: true, includeChannelRuntime: true, includeProviderCapabilities: true }]) {
    const result = await runCapturedSyntheticProbes(capture, options);

    assert.deepEqual(result.summary, {
      probeCount: registrations.length,
      passCount: registrations.length,
      failCount: 0,
      blockedCount: 0,
    });
    assert.deepEqual(
      result.results.map((item) => [item.seam, item.output.mode]),
      registrations.map(([registrar]) => [registrar, "metadata-only"]),
    );
    assert.deepEqual(invoked, []);
  }
});

test("default hook payloads cover message and agent lifecycle readers", () => {
  assert.equal(typeof defaultSyntheticHookEvents.before_agent_start.prompt, "string");
  assert.equal(typeof defaultSyntheticHookEvents.message_received.content, "string");
  assert.equal(defaultSyntheticHookEvents.agent_end.success, true);
  assert.equal(defaultSyntheticHookContexts.message_sent.channelId, "fixture-channel");
});

test("synthetic probes invoke retained hook and tool handlers", async () => {
  const capture = await captureLocalFixture([
    "export function register(api) {",
    "  api.on('before_tool_call', (event, ctx) => ({ seen: event.toolName, ctxTool: ctx.toolName }));",
    "  api.registerTool({",
    "    name: 'fixture_tool',",
    "    execute(toolCallId, params) { return { toolCallId, sawParams: typeof params === 'object' }; },",
    "  });",
    "}",
  ]);

  const result = await runCapturedSyntheticProbes(capture);

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(
    result.results.map((item) => `${item.status}:${item.kind}:${item.label}`),
    ["pass:hook:before_tool_call", "pass:registration:registerTool.execute"],
  );
});

test("synthetic probes execute gateway lifecycle around ordinary probes without reordering results", async () => {
  const capture = await captureLocalFixture([
    "let started = false;",
    "let ordinaryProbeCount = 0;",
    "export function register(api) {",
    "  api.on('gateway_stop', () => {",
    "    if (!started || ordinaryProbeCount !== 2) throw new Error('gateway stopped before ordinary probes');",
    "    started = false;",
    "  });",
    "  api.on('before_reset', () => {",
    "    if (!started) throw new Error('ordinary hook ran outside gateway lifecycle');",
    "    ordinaryProbeCount += 1;",
    "  });",
    "  api.registerCommand({",
    "    name: 'fixture-command',",
    "    handler() {",
    "      if (!started) throw new Error('registration ran outside gateway lifecycle');",
    "      ordinaryProbeCount += 1;",
    "    },",
    "  });",
    "  api.on('gateway_start', () => {",
    "    if (started) throw new Error('gateway started twice');",
    "    started = true;",
    "  });",
    "}",
  ]);

  const result = await runCapturedSyntheticProbes(capture);

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(
    result.results.map((item) => [item.captureIndex, item.label]),
    [
      [0, "gateway_stop"],
      [1, "before_reset"],
      [2, "registerCommand.handler"],
      [3, "gateway_start"],
    ],
  );
});

test("synthetic probes pass registrar-specific handler inputs", async () => {
  const capture = await captureLocalFixture([
    "export function register(api) {",
    "  api.registerTool({",
    "    name: 'fixture_tool',",
    "    run(params, ctx) { return { sawParams: typeof params === 'object', toolName: ctx.toolName }; },",
    "  });",
    "  api.registerHttpRoute({",
    "    method: 'POST',",
    "    path: '/fixture',",
    "    handler(req, ctx) { return { method: req.method, hasLogger: Boolean(ctx.logger) }; },",
    "  });",
    "}",
  ]);

  const result = await runCapturedSyntheticProbes(capture);

  assert.equal(result.summary.failCount, 0);
  assert.deepEqual(
    result.results.map((item) => `${item.status}:${item.label}`),
    ["pass:registerTool.run", "pass:registerHttpRoute.handler"],
  );
});

test("synthetic probes pass channel envelopes and gateway responders", async () => {
  const capture = await captureLocalFixture([
    "export function register(api) {",
    "  api.registerChannel({",
    "    id: 'fixture_channel',",
    "    async send(ctx) { return { messageId: ctx.replyToId, to: ctx.to }; },",
    "    async receive(ctx) { return { messageId: ctx.message.id, peer: ctx.route.peer.id }; },",
    "  });",
    "  api.registerGatewayMethod('fixture.ping', ({ respond, params }) => respond(true, { sawParams: typeof params === 'object' }));",
    "}",
  ]);

  const blocked = await runCapturedSyntheticProbes(capture);
  assert.equal(blocked.summary.blockedCount, 1);

  const result = await runCapturedSyntheticProbes(capture, { includeChannelRuntime: true });

  assert.equal(result.summary.failCount, 0);
  assert.deepEqual(
    result.results.map((item) => `${item.status}:${item.label}`),
    [
      "pass:registerChannel.send",
      "pass:registerChannel.receive",
      "pass:registerGatewayMethod.handler",
      "pass:registerGatewayMethod.run",
      "pass:registerGatewayMethod.execute",
    ],
  );
});

test("synthetic probes can execute string plus handler registrations", async () => {
  const capture = await captureLocalFixture([
    "export function register(api) {",
    "  api.registerGatewayMethod('fixture.ping', (event) => ({ method: event.registrar, property: event.property }));",
    "}",
  ]);

  const result = await runCapturedSyntheticProbes(capture);

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(
    result.results.map((item) => `${item.status}:${item.label}`),
    [
      "pass:registerGatewayMethod.handler",
      "pass:registerGatewayMethod.run",
      "pass:registerGatewayMethod.execute",
    ],
  );
});

test("synthetic probes keep opt-in registrations guarded", async () => {
  const capture = await captureLocalFixture([
    "export function register(api) {",
    "  api.registerService({ name: 'fixture_service', start() { return { started: true }; } });",
    "}",
  ]);

  const blocked = await runCapturedSyntheticProbes(capture);
  assert.equal(blocked.summary.blockedCount, 1);
  assert.match(blocked.results[0].reason, /includeLifecycle=true/);

  const executed = await runCapturedSyntheticProbes(capture, { includeLifecycle: true });
  assert.equal(executed.summary.passCount, 1);
  assert.equal(executed.results[0].label, "registerService.start");
});

test("mock SDK capture preserves retained registration metadata across subprocesses", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-mock-sdk-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry((api) => {",
      "  api.registerTool({ name: 'fixture_tool', run(params) { return { sawParams: typeof params === 'object' }; } });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const capture = await captureEntrypoint("fixture.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
    apiOptions: { retainHandlers: true },
  });
  const result = await runCapturedSyntheticProbes(capture);

  assert.equal(capture.retained.length, 1);
  assert.equal(result.summary.blockedCount, 1);
  assert.match(result.results[0].reason, /no supported callable probe/);
});

test("mock SDK entrypoint synthetic probes execute retained handlers in-process", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-mock-sdk-entrypoint-"));
  const entrypoint = path.join(dir, "fixture.ts");
  await writeFile(
    entrypoint,
    [
      'import type { OpenClawPluginApi } from "openclaw/plugin-sdk";',
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      "",
      "export default definePluginEntry((api: OpenClawPluginApi) => {",
      "  api.on('before_tool_call', (event) => ({ seen: event.toolName }));",
      "  api.registerTool({ name: 'fixture_tool', run(params) { return { sawParams: typeof params === 'object' }; } });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await runEntrypointSyntheticProbes("fixture.ts", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(
    result.results.map((item) => `${item.status}:${item.kind}:${item.label}`),
    ["pass:hook:before_tool_call", "pass:registration:registerTool.run"],
  );
});

test("mock SDK agent runtime path helpers return concrete paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-agent-dir-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      'import path from "node:path";',
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      'import { resolveAuthProfileOrder, resolveDefaultAgentDir } from "openclaw/plugin-sdk/agent-runtime";',
      "",
      "export default definePluginEntry((api) => {",
      "  api.registerCommand({",
      "    name: 'fixture-command',",
      "    handler() {",
      "      return { agentDir: path.resolve(resolveDefaultAgentDir({})), authProfiles: resolveAuthProfileOrder({}).length };",
      "    },",
      "  });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await runEntrypointSyntheticProbes("fixture.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(result.results[0].output, { type: "object", keys: ["agentDir", "authProfiles"] });
});

test("mock SDK windows spawn helpers return concrete invocations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-windows-spawn-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(
    entrypoint,
    [
      'import { spawn, spawnSync } from "node:child_process";',
      'import { definePluginEntry } from "openclaw/plugin-sdk";',
      'import { materializeWindowsSpawnProgram, resolveWindowsSpawnProgram } from "openclaw/plugin-sdk/windows-spawn";',
      "",
      "function spawnWithOpenStdin(invocation) {",
      "  return new Promise((resolve, reject) => {",
      "    const child = spawn(invocation.command, invocation.argv, { stdio: ['pipe', 'pipe', 'pipe'] });",
      "    let stdout = '';",
      "    let stderr = '';",
      "    const timeout = setTimeout(() => {",
      "      child.kill();",
      "      reject(new Error('mock app-server did not idle-exit'));",
      "    }, 3000);",
      "    child.stdout.on('data', (chunk) => { stdout += chunk; });",
      "    child.stderr.on('data', (chunk) => { stderr += chunk; });",
      "    child.on('error', (error) => {",
      "      clearTimeout(timeout);",
      "      reject(error);",
      "    });",
      "    child.on('close', (code) => {",
      "      clearTimeout(timeout);",
      "      if (code !== 0) {",
      "        reject(new Error(stderr || `mock exited ${code}`));",
      "        return;",
      "      }",
      "      resolve(JSON.parse(stdout.trim().split(/\\n/)[0]).result);",
      "    });",
      "    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize' }) + '\\n');",
      "  });",
      "}",
      "",
      "export default definePluginEntry((api) => {",
      "  api.registerCommand({",
      "    name: 'fixture-command',",
      "    async handler() {",
      "      const program = resolveWindowsSpawnProgram({ command: 'codex', packageName: '@openai/codex' });",
      "      const invocation = materializeWindowsSpawnProgram(program, ['app-server']);",
      "      const child = spawnSync(invocation.command, invocation.argv, {",
      "        input: JSON.stringify({ id: 1, method: 'initialize' }) + '\\n',",
      "        encoding: 'utf8',",
      "        timeout: 3000,",
      "      });",
      "      if (child.error) throw child.error;",
      "      if (child.status !== 0) throw new Error(child.stderr || `mock exited ${child.status}`);",
      "      return {",
      "        sync: JSON.parse(child.stdout).result.userAgent,",
      "        async: (await spawnWithOpenStdin(invocation)).userAgent,",
      "      };",
      "    },",
      "  });",
      "});",
    ].join("\n"),
    "utf8",
  );

  const result = await runEntrypointSyntheticProbes("fixture.mjs", {
    cwd: dir,
    pluginRoot: dir,
    mockSdk: true,
  });

  assert.equal(result.summary.failCount, 0);
  assert.equal(result.summary.blockedCount, 0);
  assert.deepEqual(result.results[0].output, { type: "object", keys: ["async", "sync"] });
});

for (const mockSdk of [false, true]) {
  test(`synthetic modelAuth executes no-auth handlers and fails uncaught auth (mockSdk=${mockSdk})`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-model-auth-"));
    const entrypoint = path.join(dir, "fixture.mjs");
    await writeFile(entrypoint, [
      'import assert from "node:assert/strict";',
      "export function register(api) {",
      "  const { resolveProviderIdForAuth, ensureAuthProfileStore, isProviderApiKeyConfigured } = api.runtime.modelAuth;",
      "  api.registerTool({",
      "    name: resolveProviderIdForAuth('fixture-provider'),",
      "    run() {",
      "      assert.equal(isProviderApiKeyConfigured({ provider: 'fixture-provider' }), false);",
      "      assert.deepEqual(ensureAuthProfileStore(), { version: 1, profiles: {} });",
      "      return resolveProviderIdForAuth('fixture-provider');",
      "    },",
      "  });",
      "  api.on('before_tool_call', () => api.runtime.modelAuth.getRuntimeAuthForModel({ model: { provider: 'fixture-provider' } }));",
      "  const unexpected = () => { throw new Error('opt-in callback executed'); };",
      "  api.registerService({ name: 'fixture-service', start: unexpected });",
      "  api.registerChannel({ id: 'fixture-channel', send: unexpected });",
      "  api.registerSpeechProvider({ id: 'fixture-speech', speak: unexpected });",
      "}",
    ].join("\n"), "utf8");

    const result = await runEntrypointSyntheticProbes(entrypoint, { mockSdk });

    assert.deepEqual(result.summary, { probeCount: 5, passCount: 1, failCount: 1, blockedCount: 3 });
    assert.deepEqual(result.results[0].output, { type: "string", value: "fixture-provider" });
    assert.equal(result.results[1].status, "fail");
    assert.equal(result.results[1].error, "Model auth is unavailable in capture mocks");
    assert.deepEqual(result.results.slice(2).map((item) => item.reason), [
      "captured registration requires includeLifecycle=true",
      "captured registration requires includeChannelRuntime=true",
      "captured registration requires includeProviderCapabilities=true",
    ]);
  });
}

async function captureLocalFixture(lines) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(entrypoint, `${lines.join("\n")}\n`, "utf8");
  return captureEntrypoint(entrypoint, {
    apiOptions: { retainHandlers: true },
  });
}
