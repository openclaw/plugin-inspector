import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIssues,
  classifyIssueFinding,
  issueId,
  issueMetadataByCode,
  knownIssueCodes,
  summarizeIssueClasses,
} from "../src/advanced.js";

const authorFacingKnownIssueCodes = new Set([
  "channel-env-vars",
  "legacy-before-agent-start",
  "legacy-root-sdk-import",
  "manifest-name-missing",
  "manifest-unknown-contracts",
  "manifest-unknown-fields",
  "package-entrypoint-missing",
  "package-install-metadata-incomplete",
  "package-json-missing",
  "package-manifest-version-drift",
  "package-min-host-version-drift",
  "package-npm-pack-entrypoint-missing",
  "package-npm-pack-metadata-missing",
  "package-npm-pack-unavailable",
  "package-openclaw-entry-missing",
  "package-openclaw-metadata-missing",
  "package-openclaw-unsupported-metadata",
  "package-plugin-api-compat-missing",
  "provider-auth-env-vars",
  "reserved-sdk-import",
  "security-manifest-schema-unavailable",
  "sdk-load-session-store",
  "unrecognized-security-manifest",
]);

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
      name: "untracked SDK alias is a compat gap",
      finding: { code: "sdk-export-missing", compatRecord: "plugin-sdk-export-aliases" },
      targetOpenClaw: { compatRecordStatuses: {} },
      metadata: { severity: "P1" },
      expected: { issueClass: "compat-gap", compatStatus: "untracked", severity: "P1", live: false },
    },
    {
      name: "active SDK alias compat stays a compat row",
      finding: { code: "sdk-export-missing", compatRecord: "plugin-sdk-export-aliases" },
      targetOpenClaw: { compatRecordStatuses: { "plugin-sdk-export-aliases": "active" } },
      metadata: { severity: "P1" },
      expected: { issueClass: "compat-gap", compatStatus: "active", severity: "P1", live: false },
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
      name: "active OpenClaw probe contract stays an inspector gap",
      finding: {
        code: "before-tool-call-probe",
        compatRecord: "hook.before_tool_call.terminal-block-approval",
      },
      targetOpenClaw: {
        compatRecordStatuses: { "hook.before_tool_call.terminal-block-approval": "active" },
      },
      metadata: { severity: "P1" },
      expected: { issueClass: "inspector-gap", compatStatus: "active", severity: "P1", live: false },
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
  assert.ok(knownIssueCodes.has("sdk-load-session-store"));
  assert.deepEqual(
    issues.map((issue) => [issue.fixture, issue.code, issue.severity, issue.issueClass, issue.status]),
    [
      ["codex-app-server", "sdk-export-missing", "P1", "compat-gap", "open"],
      ["agentchat", "manifest-unknown-fields", "P2", "upstream-metadata", "open"],
      ["wecom", "registration-capture-gap", "P2", "inspector-gap", "open"],
    ],
  );
  assert.deepEqual(summarizeIssueClasses(issues), {
    "compat-gap": 1,
    "deprecation-warning": 0,
    "fixture-regression": 0,
    "inspector-gap": 1,
    "live-issue": 0,
    "upstream-metadata": 1,
  });
});

test("known author-facing issue codes include author remediation guidance", () => {
  const issues = buildIssues({
    warnings: [...knownIssueCodes].map((code) => ({
      fixture: "sample-plugin",
      code,
      level: "warning",
      message: `${code} message`,
      evidence: [`fixtures/sample-plugin:${code}`],
    })),
    targetOpenClaw: { compatRecordStatuses: {} },
  });

  assert.equal(issues.length, knownIssueCodes.size);
  for (const issue of issues) {
    assert.equal(issue.remediation, undefined, `${issue.code} should not expose legacy remediation`);
    const metadata = issueMetadataByCode[issue.code];
    if (!authorFacingKnownIssueCodes.has(issue.code)) {
      assert.equal(issue.authorRemediation, undefined, `${issue.code} should stay internal-only`);
      assert.equal(metadata.authorRemediation, undefined, `${issue.code} metadata should stay internal-only`);
      continue;
    }

    assert.equal(typeof issue.authorRemediation?.summary, "string", `${issue.code} author remediation summary`);
    assert.ok(issue.authorRemediation.summary.length > 0, `${issue.code} author remediation summary text`);
    assert.equal(typeof issue.authorRemediation.docsUrl, "string", `${issue.code} author remediation docs URL`);
    assert.notEqual(
      issue.authorRemediation,
      metadata.authorRemediation,
      `${issue.code} should not expose shared metadata remediation object`,
    );
    assert.equal(
      issue.authorRemediation.docsUrl,
      `https://docs.openclaw.ai/clawhub/plugin-validation-fixes#${issue.code}`,
      `${issue.code} docs URL`,
    );
    assert.equal(Object.hasOwn(issue.authorRemediation, "steps"), false, `${issue.code} should not expose steps`);
    assert.equal(Object.hasOwn(issue.authorRemediation, "example"), false, `${issue.code} should not expose examples`);
    assert.equal(Object.hasOwn(issue.authorRemediation, "audience"), false, `${issue.code} should not expose audience`);
  }
});

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
