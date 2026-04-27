export const contractProbeRules = {
  "before-tool-call-probe": {
    id: "hook.before_tool_call.terminal-block-approval",
    contract: "Hook returns preserve terminal, block, and approval semantics.",
    target: "hook-runner",
  },
  "channel-contract-probe": {
    id: "channel.runtime.envelope-config-metadata",
    contract: "Channel setup, message envelope, sender metadata, and config schema remain stable.",
    target: "channel-runtime",
  },
  "conversation-access-hook": {
    id: "hook.llm-observer.privacy-payload",
    contract: "LLM observer hooks receive documented prompt/output fields with expected redaction behavior.",
    target: "hook-runner",
  },
  "legacy-root-sdk-import": {
    id: "sdk.import.root-barrel-cold-import",
    contract: "Root plugin SDK barrel remains importable or has a machine-readable migration path.",
    target: "sdk-alias",
  },
  "legacy-before-agent-start": {
    id: "hook.compat.before-agent-start-migration",
    contract: "Legacy before_agent_start remains wired until plugins migrate to before_model_resolve and before_prompt_build.",
    target: "hook-runner",
  },
  "sdk-export-missing": {
    id: "sdk.import.package-export-cold-import",
    contract: "Every observed OpenClaw plugin SDK import remains exported by the target OpenClaw package.",
    target: "sdk-alias",
  },
  "provider-auth-env-vars": {
    id: "manifest.compat.provider-auth-env-vars",
    contract: "Legacy provider auth env metadata continues to map into config/help surfaces.",
    target: "manifest-loader",
  },
  "channel-env-vars": {
    id: "manifest.compat.channel-env-vars",
    contract: "Legacy channel env metadata continues to map into channel setup/help surfaces.",
    target: "manifest-loader",
  },
  "manifest-unknown-contracts": {
    id: "manifest.schema.contract-keys",
    contract: "Manifest contract keys are represented in target OpenClaw PluginManifestContracts.",
    target: "manifest-loader",
  },
  "manifest-unknown-fields": {
    id: "manifest.schema.top-level-fields",
    contract: "Manifest top-level fields are represented in target OpenClaw PluginManifest.",
    target: "manifest-loader",
  },
  "registration-capture-gap": {
    id: "api.capture.runtime-registrars",
    contract: "External inspector capture records service, route, gateway, command, and interactive registrations.",
    target: "inspector-capture-api",
  },
  "package-build-artifact-entrypoint": {
    id: "package.entrypoint.build-before-cold-import",
    contract: "Inspector can build or resolve source aliases before cold importing package entrypoints.",
    target: "package-loader",
  },
  "package-dependency-install-required": {
    id: "package.entrypoint.isolated-dependency-install",
    contract: "Inspector installs package dependencies in an isolated workspace before cold import.",
    target: "package-loader",
  },
  "package-entrypoint-missing": {
    id: "package.entrypoint.exists",
    contract: "OpenClaw package entrypoints resolve to files in the published or built plugin package.",
    target: "package-loader",
  },
  "package-openclaw-entry-missing": {
    id: "package.entrypoint.openclaw-metadata",
    contract: "OpenClaw package metadata declares entrypoints for cold import and registration capture.",
    target: "package-loader",
  },
  "package-openclaw-metadata-missing": {
    id: "package.metadata.openclaw",
    contract: "Plugins that register OpenClaw APIs declare OpenClaw install and entrypoint metadata.",
    target: "package-loader",
  },
  "package-manifest-version-drift": {
    id: "package.metadata.version-alignment",
    contract: "Package and OpenClaw manifest versions stay aligned for release compatibility reporting.",
    target: "package-loader",
  },
  "package-plugin-api-compat-missing": {
    id: "package.compat.plugin-api-range",
    contract: "Package metadata declares the OpenClaw plugin API range used by the plugin.",
    target: "package-loader",
  },
  "package-typescript-source-entrypoint": {
    id: "package.entrypoint.typescript-loader",
    contract: "Inspector can compile or load TypeScript source entrypoints before registration capture.",
    target: "package-loader",
  },
  "runtime-tool-capture": {
    id: "tool.registration.schema-capture",
    contract: "Registered runtime tools expose stable names, input schemas, and result metadata.",
    target: "tool-runtime",
  },
};

export function buildContractProbes({ warnings = [], suggestions = [], fixtures = [] }) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const probes = [];

  for (const finding of [...warnings, ...suggestions]) {
    const rule = contractProbeRules[finding.code];
    if (!rule) {
      continue;
    }
    probes.push({
      id: `${rule.id}:${finding.fixture}`,
      fixture: finding.fixture,
      priority: probePriority(finding.code, fixtureById.get(finding.fixture)?.priority),
      target: rule.target,
      contract: rule.contract,
      evidence: finding.evidence ?? [],
    });
  }

  return dedupeBy(probes, (probe) => probe.id).sort(
    (left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.id.localeCompare(right.id),
  );
}

export function probePriority(code, fixturePriority) {
  if (
    [
      "before-tool-call-probe",
      "conversation-access-hook",
      "missing-compat-record",
      "registration-capture-gap",
      "sdk-export-missing",
    ].includes(code)
  ) {
    return "P1";
  }
  if (fixturePriority === "high") {
    return "P2";
  }
  return "P3";
}

function dedupeBy(values, keyForValue) {
  const output = new Map();
  for (const value of values) {
    output.set(keyForValue(value), value);
  }
  return [...output.values()];
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 4;
}
