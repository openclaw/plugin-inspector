import assert from "node:assert/strict";
import { test } from "node:test";
import { validateContractCoverage } from "../src/contract-coverage.js";

test("contract coverage fails missing evidence and P1 probe gaps", () => {
  const report = {
    breakages: [],
    warnings: [],
    suggestions: [],
    logs: [],
    targetOpenClaw: { status: "disabled" },
    fixtures: [
      {
        id: "fixture",
        hooks: ["before_tool_call"],
        hookDetails: [],
        registrations: ["registerService"],
        registrationDetails: [],
        manifestContracts: [],
        manifestFiles: [],
      },
    ],
    issues: [
      {
        id: "PLUGIN-0001",
        fixture: "fixture",
        severity: "P1",
        issueClass: "inspector-gap",
        code: "conversation-access-hook",
        evidence: [],
      },
    ],
    contractProbes: [],
  };

  const errors = validateContractCoverage(report);
  assert.ok(errors.some((error) => error.includes("missing evidence")));
  assert.ok(errors.some((error) => error.includes("P1 issue has no contract probe")));
  assert.ok(errors.some((error) => error.includes("hook before_tool_call has no source evidence")));
  assert.ok(errors.some((error) => error.includes("registration registerService has no source evidence")));
});

test("contract coverage rejects unknown issue classifier codes and classes", () => {
  const report = {
    breakages: [],
    warnings: [],
    suggestions: [],
    logs: [],
    targetOpenClaw: { status: "disabled" },
    fixtures: [],
    issues: [
      {
        id: "PLUGIN-UNKNOWN",
        fixture: "fixture",
        severity: "P2",
        issueClass: "new-class",
        code: "new-unclassified-thing",
        evidence: ["fixture"],
      },
    ],
    contractProbes: [],
  };

  assert.deepEqual(validateContractCoverage(report), [
    "PLUGIN-UNKNOWN: unknown issue code new-unclassified-thing",
    "PLUGIN-UNKNOWN: unknown issue class new-class",
  ]);
});

test("contract coverage requires parsed target surface when OpenClaw is available", () => {
  const report = {
    breakages: [],
    warnings: [],
    suggestions: [],
    logs: [],
    targetOpenClaw: {
      status: "ok",
      hookNames: [],
      apiRegistrars: [],
      capturedRegistrars: [],
      sdkExports: [],
      manifestFields: [],
      manifestContractFields: [],
    },
    fixtures: [],
    issues: [],
    contractProbes: [],
  };

  assert.deepEqual(validateContractCoverage(report), [
    "target OpenClaw hook registry was found but no hook names were parsed",
    "target OpenClaw API builder was found but no api.register* names were parsed",
    "target OpenClaw captured-registration helper was found but no api.register* names were parsed",
    "target OpenClaw package metadata was found but no plugin SDK exports were parsed",
    "target OpenClaw manifest types were found but no PluginManifest fields were parsed",
    "target OpenClaw manifest types were found but no PluginManifestContracts fields were parsed",
  ]);
});

test("contract coverage rejects duplicate issue ids", () => {
  const report = {
    breakages: [],
    warnings: [],
    suggestions: [],
    logs: [],
    targetOpenClaw: { status: "disabled" },
    fixtures: [],
    issues: [
      {
        id: "PLUGIN-DUPE",
        fixture: "fixture",
        severity: "P2",
        issueClass: "upstream-metadata",
        code: "manifest-unknown-fields",
        evidence: ["one"],
      },
      {
        id: "PLUGIN-DUPE",
        fixture: "fixture",
        severity: "P2",
        issueClass: "upstream-metadata",
        code: "manifest-unknown-fields",
        evidence: ["two"],
      },
    ],
    contractProbes: [],
  };

  assert.deepEqual(validateContractCoverage(report), ["duplicate issue id: PLUGIN-DUPE"]);
});

test("contract coverage requires compat record reconciliation evidence", () => {
  const report = {
    breakages: [],
    warnings: [
      {
        fixture: "fixture",
        code: "provider-auth-env-vars",
        compatRecord: "fixture.provider-auth-env-vars",
      },
    ],
    suggestions: [],
    logs: [],
    targetOpenClaw: {
      status: "ok",
      hookNames: ["before_tool_call"],
      apiRegistrars: ["registerTool"],
      capturedRegistrars: ["registerTool"],
      sdkExports: ["openclaw/plugin-sdk"],
      manifestFields: ["id"],
      manifestContractFields: ["tools"],
    },
    fixtures: [],
    issues: [],
    contractProbes: [],
  };

  assert.deepEqual(validateContractCoverage(report), [
    "fixture: compat record fixture.provider-auth-env-vars was not reconciled",
  ]);

  report.logs.push({
    fixture: "fixture",
    code: "compat-record-present",
    compatRecord: "fixture.provider-auth-env-vars",
  });
  assert.deepEqual(validateContractCoverage(report), []);
});
