import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildSyntheticProbePlan,
  captureEntrypoint,
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
    "registerMediaUnderstandingProvider",
    "registerMeetingNotesSourceProvider",
    "registerMemoryCapability",
    "registerMemoryCorpusSupplement",
    "registerMemoryEmbeddingProvider",
    "registerMemoryFlushPlan",
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
    "registerSessionExtension",
    "registerSessionSchedulerJob",
    "registerSpeechProvider",
    "registerTextTransforms",
    "registerTool",
    "registerToolMetadata",
    "registerTrustedToolPolicy",
    "registerVideoGenerationProvider",
    "registerWebFetchProvider",
    "registerWebSearchProvider",
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

async function captureLocalFixture(lines) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(entrypoint, `${lines.join("\n")}\n`, "utf8");
  return captureEntrypoint(entrypoint, {
    apiOptions: { retainHandlers: true },
  });
}
