import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureApi } from "../src/capture-api.js";
import { runCapturedSyntheticProbes } from "../src/synthetic-probes.js";

const negative = { ok: false, payload: { error: "not configured" } };
const expectations = { "fixture.guard": negative };

function capture(handler, options = {}) {
  const api = createCaptureApi({ retainHandlers: true, ...options });
  api.registerGatewayMethod("fixture.guard", handler);
  return { status: "captured", captured: api.getCapturedContracts(), retained: api.getRetainedContracts() };
}

test("exact negative contracts execute the handler and retain bounded evidence", async () => {
  let calls = 0;
  const input = capture(({ respond }) => { calls += 1; respond(false, negative.payload); });
  assert.equal((await runCapturedSyntheticProbes(input)).summary.failCount, 1);
  const result = await runCapturedSyntheticProbes(input, { gatewayMethodExpectations: expectations });
  assert.equal(calls, 2);
  assert.equal(result.summary.passCount, 1);
  assert.deepEqual(result.results[0].gatewayResponse, {
    method: "fixture.guard", expectedOk: false, observedOk: false, matched: true,
  });
});

test("expectations match complete serialized frames without leaking mismatched payloads", async (t) => {
  for (const [ok, payload, error] of [
    [true, negative.payload], [false, { error: "private-secret" }],
    [false, negative.payload, { code: "PRIVATE", message: "private-secret" }],
  ]) {
    await t.test(JSON.stringify([ok, payload, error]), async () => {
      const result = await runCapturedSyntheticProbes(capture(({ respond }) => respond(ok, payload, error)), {
        gatewayMethodExpectations: expectations,
      });
      assert.equal(result.summary.failCount, 1);
      assert.equal(result.results[0].error, "Gateway response did not match the declared expectation");
      assert.equal(result.results[0].gatewayResponse.matched, false);
      assert.doesNotMatch(JSON.stringify(result), /private-secret|PRIVATE/);
    });
  }
});

test("wire errors and successful payloads can be asserted exactly", async () => {
  for (const expected of [
    { ok: false, error: { code: "UNAVAILABLE", message: "not configured" } },
    { ok: true, payload: { ready: false } },
  ]) {
    const result = await runCapturedSyntheticProbes(capture(({ respond }) => {
      respond(expected.ok, expected.payload, expected.error);
    }), { gatewayMethodExpectations: { "fixture.guard": expected } });
    assert.equal(result.summary.passCount, 1);
  }
});

test("invalid, conflicting, missing and duplicate declarations fail before execution", async () => {
  let calls = 0;
  const input = capture(({ respond }) => { calls += 1; respond(false, negative.payload); });
  for (const declaration of [null, false, [], { "": negative }, { ["x".repeat(257)]: negative },
    { "fixture.guard": { ok: "false" } }, { "fixture.guard": { ...negative, extra: true } },
    { "fixture.missing": negative }, { "fixture.guard": { ok: false, error: { message: "private-secret" } } },
  ]) {
    await assert.rejects(runCapturedSyntheticProbes(input, { gatewayMethodExpectations: declaration }),
      /Gateway response expectation/);
  }
  await assert.rejects(runCapturedSyntheticProbes(input, {
    gatewayMethodExpectations: expectations, gatewayMethodPrerequisites: { "fixture.guard": "credentials" },
  }), /conflicts with a prerequisite/);
  await assert.rejects(runCapturedSyntheticProbes({ ...input, retained: [] }, {
    gatewayMethodExpectations: expectations,
  }), /requires one retained method/);
  await assert.rejects(runCapturedSyntheticProbes({
    ...input, captured: [...input.captured, input.captured[0]],
    retained: [...input.retained, { ...input.retained[0], captureIndex: 1 }],
  }, { gatewayMethodExpectations: expectations }), /requires one retained method/);
  assert.equal(calls, 0);
});

test("inherited declarations do not change the default failure", async () => {
  const result = await runCapturedSyntheticProbes(capture(({ respond }) => respond(false, negative.payload)), {
    gatewayMethodExpectations: Object.create(expectations),
  });
  assert.equal(result.summary.failCount, 1);
  assert.equal(result.results[0].gatewayResponse, undefined);
});

test("unexecuted expectations fail instead of receiving blocked or passing credit", async () => {
  const result = await runCapturedSyntheticProbes(capture(null), { gatewayMethodExpectations: expectations });
  assert.equal(result.summary.failCount, 1);
  assert.equal(result.summary.blockedCount, 0);
  assert.equal(result.results[0].error, "Declared Gateway response expectation was not executed");
  assert.equal(result.results[0].gatewayResponse.matched, false);
});

test("first response, frame validation and handler settlement still own the outcome", async (t) => {
  const cases = [
    ["first mismatch", ({ respond }) => { respond(true); respond(false, negative.payload); }],
    ["malformed", ({ respond }) => { respond("false", negative.payload); }],
    ["throw", ({ respond }) => { respond(false, negative.payload); throw new Error("handler threw"); }],
    ["reject", async ({ respond }) => { respond(false, negative.payload); throw new Error("handler rejected"); }],
    ["hang", ({ respond }) => { respond(false, negative.payload); return new Promise(() => {}); }],
    ["missing", () => {}],
  ];
  for (const [name, handler] of cases) {
    await t.test(name, async () => {
      const result = await runCapturedSyntheticProbes(capture(handler), {
        gatewayMethodExpectations: expectations, timeoutMs: 25,
      });
      assert.equal(result.summary.failCount, 1);
      assert.equal(result.results[0].gatewayResponse.matched, false);
    });
  }
  const result = await runCapturedSyntheticProbes(capture(({ respond }) => {
    respond(false, negative.payload); respond(true);
  }), { gatewayMethodExpectations: expectations });
  assert.equal(result.summary.passCount, 1);
});
