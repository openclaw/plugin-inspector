import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureApi, defaultCaptureApiRegistrarProfiles } from "../src/capture-api.js";

test("capture API records hooks and registrations", () => {
  const api = createCaptureApi({ knownRegistrars: ["registerTool"] });

  api.on("before_tool_call", () => undefined);
  const registeredTool = api.registerTool({ name: "search", run() {} });
  const service = api.registerService({ name: "gateway", start() {}, stop() {} });

  assert.equal(registeredTool.name, "search");
  assert.equal(service.name, "gateway");
  assert.deepEqual(
    api.getCapturedContracts().map((entry) => `${entry.kind}:${entry.name}`),
    ["hook:before_tool_call", "registration:registerTool", "registration:registerService"],
  );
  assert.equal(api.getCapturedContracts()[1].known, true);
  assert.equal(api.getCapturedContracts()[2].known, false);
});

test("capture API defaults to known OpenClaw registrar profiles", () => {
  const api = createCaptureApi();
  const provider = api.registerProvider({ id: "openai", label: "OpenAI" });
  const route = api.registerHttpRoute({ method: "POST", path: "/webhook", handler() {} });

  assert.equal(provider.id, "openai");
  assert.equal(route.path, "/webhook");
  assert.equal(typeof route.unregister, "function");
  assert.equal(api.getCapturedContracts()[0].known, true);
  assert.ok(defaultCaptureApiRegistrarProfiles.registerTool);
});

test("capture API returns useful channel, gateway, and lifecycle descriptors", () => {
  const api = createCaptureApi();
  const channel = api.registerChannel({ plugin: { id: "fixture-channel", outbound: { sendText() {} } } });
  const gatewayMethod = api.registerGatewayMethod(
    "fixture.ping",
    ({ respond }) => respond(true, { ok: true }),
    { scope: "operator.read" },
  );
  const service = api.registerService({ id: "fixture-service" });

  assert.equal(api.registrationMode, "full");
  assert.equal(channel.id, "fixture-channel");
  assert.equal(channel.plugin.id, "fixture-channel");
  assert.equal(gatewayMethod.method, "fixture.ping");
  assert.equal(gatewayMethod.scope, "operator.read");
  assert.deepEqual(gatewayMethod.handler({ respond: api.gateway.respond }), { ok: true, result: { ok: true } });
  assert.equal(typeof service.dispose, "function");
});

test("capture API records conversation binding resolved callbacks", () => {
  const api = createCaptureApi();

  assert.equal(api.onConversationBindingResolved(() => undefined), api);
  assert.deepEqual(
    api.getCapturedContracts().map((entry) => `${entry.kind}:${entry.name}`),
    ["hook:onConversationBindingResolved"],
  );
});

test("capture API accepts custom registrar return profiles", () => {
  const api = createCaptureApi({
    registrarProfiles: {
      registerCustomThing: {
        returnValue: ({ args }) => ({ custom: args[0].name }),
      },
    },
  });

  const registered = api.registerCustomThing({ name: "fixture" });

  assert.deepEqual(registered, { custom: "fixture" });
  assert.equal(api.getCapturedContracts()[0].known, true);
});

test("capture API exposes mock context helpers", async () => {
  const api = createCaptureApi({
    resolvePath: (value) => `/fixture/${value}`,
    secretValues: {
      token: "redacted",
    },
  });

  await api.store.set("key", { value: 1 });
  const keyedStore = api.runtime.state.openSyncKeyedStore({
    namespace: "capture-test",
    maxEntries: 10,
  });
  const blobStore = api.runtime.state.openBlobStore({
    namespace: "capture-blobs",
    maxEntries: 10,
    maxBytesPerEntry: 1_024,
    maxBytesPerNamespace: 4_096,
  });
  const sourceBytes = Buffer.from([1, 2, 3]);
  keyedStore.register("key", { value: 2 });
  assert.equal(await blobStore.registerIfAbsent("artifact", sourceBytes, { kind: "diff" }), true);
  sourceBytes[0] = 9;

  assert.equal(await api.secrets.get("token"), "redacted");
  assert.equal(await api.secrets.resolve("secret:token"), "redacted");
  assert.deepEqual(await api.store.get("key"), { value: 1 });
  assert.deepEqual(await api.store.list(), ["key"]);
  assert.equal(api.agent.id, "plugin-inspector-agent");
  assert.equal(api.paths.dataDir, ".plugin-inspector/data");
  assert.equal(api.resolvePath("state"), "/fixture/state");
  assert.deepEqual(keyedStore.lookup("key"), { value: 2 });
  const firstLookup = await blobStore.lookup("artifact");
  assert.deepEqual([...(firstLookup?.bytes ?? [])], [1, 2, 3]);
  firstLookup.bytes[1] = 9;
  assert.deepEqual([...((await blobStore.lookup("artifact"))?.bytes ?? [])], [1, 2, 3]);
  assert.deepEqual((await blobStore.entries()).map(({ key, metadata, sizeBytes }) => ({ key, metadata, sizeBytes })), [
    { key: "artifact", metadata: { kind: "diff" }, sizeBytes: 3 },
  ]);
  assert.equal(await blobStore.registerIfAbsent("artifact", new Uint8Array([4]), { kind: "other" }), false);
  const originalDateNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    assert.equal(
      await blobStore.registerIfAbsent("expiring", new Uint8Array([5]), { kind: "old" }, { ttlMs: 10 }),
      true,
    );
    now = 1_011;
    assert.equal(await blobStore.lookup("expiring"), undefined);
    assert.equal(
      await blobStore.registerIfAbsent("expiring", new Uint8Array([6]), { kind: "new" }),
      false,
    );
    assert.deepEqual(await blobStore.deleteExpiredKey("expiring"), {
      key: "expiring",
      metadata: { kind: "old" },
      sizeBytes: 1,
      createdAt: 1_000,
      expiresAt: 1_010,
    });
    assert.equal(
      await blobStore.registerIfAbsent("expiring", new Uint8Array([6]), { kind: "new" }),
      true,
    );
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(keyedStore.update("key", () => undefined), false);
  assert.deepEqual(keyedStore.lookup("key"), { value: 2 });
  assert.equal(
    api.runtime.state.openSyncKeyedStore({ namespace: "capture-test", maxEntries: 10 }),
    keyedStore,
  );
});

test("capture API can retain handlers for probes", () => {
  const handler = () => "ok";
  const api = createCaptureApi({ retainHandlers: true });

  api.on("llm_output", handler);
  const service = api.registerService({ name: "fixture-service" });

  const retained = api.getRetainedContracts();
  assert.equal(retained.length, 2);
  assert.equal(retained[0].handler, handler);
  assert.equal(retained[1].returnValue, service);
  assert.equal(typeof retained[1].returnValue.start, "function");
});
