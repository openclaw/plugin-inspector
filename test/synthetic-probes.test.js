import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildSyntheticProbePlan,
  captureEntrypoint,
  renderSyntheticProbeMarkdown,
  runCapturedSyntheticProbes,
  validateSyntheticProbePlan,
} from "../src/index.js";

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

async function captureLocalFixture(lines) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-probes-"));
  const entrypoint = path.join(dir, "fixture.mjs");
  await writeFile(entrypoint, `${lines.join("\n")}\n`, "utf8");
  return captureEntrypoint(entrypoint, {
    apiOptions: { retainHandlers: true },
  });
}
