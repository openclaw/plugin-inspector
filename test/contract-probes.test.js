import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContractProbes, compatRecordForIssueCode, contractProbeRules, probePriority } from "../src/advanced.js";

test("contract probes map issue findings to executable backlog rows", () => {
  const probes = buildContractProbes({
    fixtures: [
      { id: "wecom", priority: "high" },
      { id: "agentchat", priority: "medium" },
      { id: "codex-app-server", priority: "medium" },
    ],
    warnings: [
      {
        fixture: "codex-app-server",
        code: "sdk-export-missing",
        evidence: ["openclaw/plugin-sdk/legacy-helper"],
      },
      {
        fixture: "agentchat",
        code: "manifest-unknown-fields",
        evidence: ["openclaw.plugin.json:channelEnvVars"],
      },
    ],
    suggestions: [
      {
        fixture: "wecom",
        code: "registration-capture-gap",
        evidence: ["registerChannel"],
      },
      {
        fixture: "wecom",
        code: "registration-capture-gap",
        evidence: ["duplicate"],
      },
      {
        fixture: "wecom",
        code: "unknown-future-code",
        evidence: ["ignored"],
      },
    ],
  });

  assert.ok(contractProbeRules["registration-capture-gap"]);
  assert.equal(compatRecordForIssueCode("registration-capture-gap"), "api.capture.runtime-registrars");
  assert.equal(compatRecordForIssueCode("package-dependency-install-required"), undefined);
  assert.deepEqual(
    probes.map((probe) => [probe.id, probe.priority, probe.target]),
    [
      ["sdk.import.package-export-cold-import:codex-app-server", "P1", "sdk-alias"],
      ["api.capture.runtime-registrars:wecom", "P2", "inspector-capture-api"],
      ["manifest.schema.top-level-fields:agentchat", "P3", "manifest-loader"],
    ],
  );
});

test("contract probe priority escalates critical codes and high-priority fixtures", () => {
  assert.equal(probePriority("sdk-export-missing", "medium"), "P1");
  assert.equal(probePriority("registration-capture-gap", "high"), "P2");
  assert.equal(probePriority("manifest-unknown-fields", "high"), "P2");
  assert.equal(probePriority("manifest-unknown-fields", "medium"), "P3");
});
