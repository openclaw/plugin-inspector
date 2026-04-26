import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureApi } from "../src/capture-api.js";

test("capture API records hooks and registrations", () => {
  const api = createCaptureApi({ knownRegistrars: ["registerTool"] });

  api.on("before_tool_call", () => undefined);
  const registeredName = api.registerTool({ name: "search", run() {} });
  const service = api.registerService({ name: "gateway", start() {}, stop() {} });

  assert.equal(registeredName, "search");
  assert.equal(service.name, "gateway");
  assert.deepEqual(
    api.getCapturedContracts().map((entry) => `${entry.kind}:${entry.name}`),
    ["hook:before_tool_call", "registration:registerTool", "registration:registerService"],
  );
  assert.equal(api.getCapturedContracts()[1].known, true);
  assert.equal(api.getCapturedContracts()[2].known, false);
});

test("capture API can retain handlers for probes", () => {
  const handler = () => "ok";
  const api = createCaptureApi({ retainHandlers: true });

  api.on("llm_output", handler);

  const retained = api.getRetainedContracts();
  assert.equal(retained.length, 1);
  assert.equal(retained[0].handler, handler);
});
