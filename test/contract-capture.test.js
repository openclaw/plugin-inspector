import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContractCapture,
  renderContractCaptureMarkdown,
  validateContractCapture,
} from "../src/advanced.js";

test("contract capture turns compatibility reports into executable inventory", () => {
  const capture = buildContractCapture({
    report: {
      generatedAt: "test",
      targetOpenClaw: {
        status: "available",
        configuredPath: "../openclaw",
        capturedRegistrarCount: 1,
        capturedRegistrars: ["registerTool"],
        sdkExportCount: 1,
        sdkExports: ["openclaw/plugin-sdk"],
      },
      fixtures: [
        {
          id: "fixture",
          priority: "high",
          registrationDetails: [{ name: "registerTool", ref: "plugins/fixture/src/index.js:1" }],
          hookDetails: [{ name: "before_tool_call", ref: "plugins/fixture/src/index.js:2" }],
          sdkImportDetails: [{ specifier: "openclaw/plugin-sdk", ref: "plugins/fixture/src/index.js:3" }],
          packages: [
            {
              openclaw: {
                entrypoints: [
                  {
                    kind: "plugin",
                    specifier: ".",
                    relativePath: "dist/index.js",
                    exists: true,
                    requiresBuild: false,
                  },
                ],
              },
            },
          ],
        },
      ],
      contractProbes: [
        {
          id: "sdk.import.package-export-cold-import:fixture",
          fixture: "fixture",
          priority: "P1",
          target: "sdk-alias",
          evidence: ["plugins/fixture/src/index.js:3"],
        },
      ],
    },
  });

  assert.deepEqual(validateContractCapture(capture), []);
  assert.equal(capture.summary.registrationCount, 1);
  assert.equal(capture.summary.hookCount, 1);
  assert.equal(capture.summary.sdkImportCount, 1);
  assert.equal(capture.fixtures[0].registrations[0].support, "target-captured");
  assert.equal(capture.fixtures[0].hooks[0].syntheticEvent.toolName, "fixture_tool");
  assert.equal(capture.fixtures[0].sdkImports[0].support, "target-exported");
  assert.match(renderContractCaptureMarkdown(capture), /## Registration Capture/);
});

test("contract capture validation rejects incomplete inventory", () => {
  const errors = validateContractCapture({
    fixtures: [
      {
        registrations: [
          {
            id: "registration.registerTool:fixture:index",
            registrar: "registerTool",
            ref: "",
            assertions: [],
          },
        ],
        hooks: [
          {
            id: "hook.before_tool_call:fixture:index",
            hook: "before_tool_call",
            ref: "plugins/fixture/index.js:1",
            assertions: [],
            syntheticEvent: null,
            syntheticContext: null,
          },
        ],
        sdkImports: [],
        packageEntrypoints: [{ id: "entrypoint.fixture:index", assertions: [] }],
      },
    ],
    issueProbes: [{ id: "issue.fixture", evidence: [], assertions: [] }],
  });

  assert.ok(errors.some((error) => error.includes("registration.registerTool") && error.includes("missing source reference")));
  assert.ok(errors.some((error) => error.includes("synthetic registration arguments")));
  assert.ok(errors.some((error) => error.includes("synthetic hook event")));
  assert.ok(errors.some((error) => error.includes("missing probe evidence")));
});
