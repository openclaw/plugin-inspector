import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIssues, classifyIssueFinding, issueId, knownIssueCodes, summarizeIssueClasses } from "../src/advanced.js";

test("issue ids are stable fingerprints", () => {
  const finding = {
    fixture: "codex-app-server",
    code: "sdk-export-missing",
    severity: "P1",
    compatRecord: "plugin-sdk-export-aliases",
    evidence: ["openclaw/plugin-sdk/legacy-helper @ plugins/sample-plugin/src/controller.ts:104"],
  };

  assert.equal(issueId(finding), issueId({ ignored: "field", ...finding }));
  assert.notEqual(issueId(finding), issueId({ ...finding, evidence: [...finding.evidence, "extra"] }));
  assert.match(issueId(finding, { prefix: "PLUGIN" }), /^PLUGIN-[A-F0-9]{8}$/);
});

test("issue classification separates live breaks from compat and deprecation buckets", () => {
  const cases = [
    {
      name: "untracked SDK alias is a blocking live issue",
      finding: { code: "sdk-export-missing", compatRecord: "plugin-sdk-export-aliases" },
      targetOpenClaw: { compatRecordStatuses: {} },
      metadata: { severity: "P1" },
      expected: { issueClass: "live-issue", compatStatus: "untracked", severity: "P0", live: true },
    },
    {
      name: "active SDK alias compat avoids false P0 escalation",
      finding: { code: "sdk-export-missing", compatRecord: "plugin-sdk-export-aliases" },
      targetOpenClaw: { compatRecordStatuses: { "plugin-sdk-export-aliases": "active" } },
      metadata: { severity: "P1" },
      expected: { issueClass: "live-issue", compatStatus: "active", severity: "P1", live: true },
    },
    {
      name: "deprecated compat remains warning-class even when used",
      finding: { code: "legacy-before-agent-start", compatRecord: "legacy-before-agent-start" },
      targetOpenClaw: { compatRecordStatuses: { "legacy-before-agent-start": "deprecated" } },
      metadata: { severity: "P2" },
      expected: { issueClass: "deprecation-warning", compatStatus: "deprecated", severity: "P2", deprecated: true },
    },
    {
      name: "missing compat record is a compat gap",
      finding: { code: "missing-compat-record", compatRecord: "plugin-sdk-export-aliases" },
      targetOpenClaw: { compatRecordStatuses: {} },
      metadata: { severity: "P1" },
      expected: { issueClass: "compat-gap", compatStatus: "missing", severity: "P1", live: false },
    },
    {
      name: "unknown untracked hook is P0 live break",
      finding: { code: "unknown-hook-name" },
      targetOpenClaw: { compatRecordStatuses: {} },
      metadata: { severity: "P1" },
      expected: { issueClass: "live-issue", compatStatus: "none", severity: "P0", live: true },
    },
  ];

  for (const item of cases) {
    assert.deepEqual(
      pick(classifyIssueFinding(item.finding, item.targetOpenClaw, item.metadata), Object.keys(item.expected)),
      item.expected,
      item.name,
    );
  }
});

test("issue builder applies metadata and class summaries", () => {
  const issues = buildIssues({
    warnings: [
      {
        fixture: "codex-app-server",
        code: "sdk-export-missing",
        level: "warning",
        message: "missing sdk export",
        compatRecord: "plugin-sdk-export-aliases",
        evidence: ["openclaw/plugin-sdk/legacy-helper"],
      },
      {
        fixture: "agentchat",
        code: "manifest-unknown-fields",
        level: "warning",
        message: "unknown field",
        evidence: ["openclaw.plugin.json:channelEnvVars"],
      },
    ],
    suggestions: [
      {
        fixture: "wecom",
        code: "registration-capture-gap",
        level: "suggestion",
        message: "capture registrar",
        evidence: ["registerChannel"],
      },
    ],
    targetOpenClaw: { compatRecordStatuses: {} },
  });

  assert.ok(knownIssueCodes.has("sdk-export-missing"));
  assert.ok(knownIssueCodes.has("reserved-sdk-import"));
  assert.deepEqual(
    issues.map((issue) => [issue.fixture, issue.code, issue.severity, issue.issueClass, issue.status]),
    [
      ["codex-app-server", "sdk-export-missing", "P0", "live-issue", "blocking"],
      ["wecom", "registration-capture-gap", "P1", "inspector-gap", "open"],
      ["agentchat", "manifest-unknown-fields", "P2", "upstream-metadata", "open"],
    ],
  );
  assert.deepEqual(summarizeIssueClasses(issues), {
    "compat-gap": 0,
    "deprecation-warning": 0,
    "fixture-regression": 0,
    "inspector-gap": 1,
    "live-issue": 1,
    "upstream-metadata": 1,
  });
});

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
