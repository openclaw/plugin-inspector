import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import {
  defaultSyntheticHookContexts,
  defaultSyntheticHookEvents,
  defaultSyntheticRegistrationArguments,
} from "./synthetic-probes.js";

export const defaultRegistrationAssertions = {
  defineChannelPluginEntry: ["channel id is stable", "setup/config schema can be read", "message envelope metadata is preserved"],
  definePluginEntry: ["entrypoint register function is callable", "entrypoint metadata is preserved"],
  registerChannel: ["channel id is stable", "inbound/outbound envelope shape is captured", "sender metadata is preserved"],
  registerCli: ["command name is stable", "argument schema is captured"],
  registerCommand: ["command id is stable", "interactive command payload is captured"],
  registerContextEngine: ["context engine id is stable", "factory metadata is captured"],
  registerGatewayMethod: ["method name is stable", "request and response schema are captured"],
  registerHttpRoute: ["route method and path are captured", "auth policy metadata is captured"],
  registerInteractiveHandler: ["handler id is stable", "interaction payload and response shape are captured"],
  registerHook: ["legacy hook name is stable", "handler metadata is captured"],
  registerMemoryPromptSection: ["memory prompt section id is stable", "render metadata is captured"],
  registerMemoryRuntime: ["memory runtime id is stable", "runtime factory metadata is captured"],
  registerService: ["service id is stable", "start/stop lifecycle handlers are captured"],
  registerSpeechProvider: ["provider id is stable", "speech request overrides are captured"],
  registerTool: ["tool name is stable", "input schema is captured", "result shape metadata is captured"],
};

export const defaultRegistrationArguments = defaultSyntheticRegistrationArguments;

export const defaultHookAssertions = {
  agent_end: ["final conversation payload is redacted as expected", "agent id and run metadata are present"],
  before_agent_start: ["legacy startup hook payload is accepted", "migration metadata can map to prompt/model hooks"],
  before_prompt_build: ["prompt mutation result is preserved", "agent and conversation metadata are present"],
  before_tool_call: ["block/allow return shapes are preserved", "terminal and approval metadata are present"],
  inbound_claim: ["claim payload preserves channel/source identity", "routing metadata is present"],
  llm_input: ["model input payload is redacted as expected", "model and agent metadata are present"],
  llm_output: ["model output payload is redacted as expected", "model and agent metadata are present"],
  subagent_delivery_target: ["target routing result is preserved", "parent/subagent metadata are present"],
  subagent_ended: ["subagent completion payload is preserved", "status metadata is present"],
  subagent_spawned: ["spawn payload is preserved", "parent/subagent metadata are present"],
};

export const defaultHookEvents = defaultSyntheticHookEvents;

export const defaultHookContexts = defaultSyntheticHookContexts;

export function buildContractCapture(options = {}) {
  const report = options.report;
  if (!report) {
    throw new TypeError("buildContractCapture requires a compatibility report");
  }

  const registrationAssertions = options.registrationAssertions ?? defaultRegistrationAssertions;
  const registrationArguments = options.registrationArguments ?? defaultRegistrationArguments;
  const hookAssertions = options.hookAssertions ?? defaultHookAssertions;
  const hookEvents = options.hookEvents ?? defaultHookEvents;
  const hookContexts = options.hookContexts ?? defaultHookContexts;
  const capturedRegistrars = new Set(report.targetOpenClaw.capturedRegistrars ?? []);
  const sdkExports = new Set(report.targetOpenClaw.sdkExports ?? []);

  const fixtures = report.fixtures.map((fixture) => ({
    id: fixture.id,
    priority: fixture.priority,
    registrations: fixture.registrationDetails.map((registration) => ({
      id: `registration.${registration.name}:${fixture.id}:${slugRef(registration.ref)}`,
      fixture: fixture.id,
      registrar: registration.name,
      ref: registration.ref,
      support: capturedRegistrars.has(registration.name) ? "target-captured" : "inspector-shim-required",
      assertions: registrationAssertions[registration.name] ?? ["registration arguments are captured"],
      syntheticArguments: registrationArguments[registration.name] ?? [{}],
    })),
    hooks: fixture.hookDetails.map((hook) => ({
      id: `hook.${hook.name}:${fixture.id}:${slugRef(hook.ref)}`,
      fixture: fixture.id,
      hook: hook.name,
      ref: hook.ref,
      support: "synthetic-event-required",
      assertions: hookAssertions[hook.name] ?? ["hook payload and return value are captured"],
      syntheticEvent: hookEvents[hook.name] ?? { hook: hook.name, fixture: fixture.id },
      syntheticContext: hookContexts[hook.name] ?? { hook: hook.name, fixture: fixture.id },
    })),
    sdkImports: fixture.sdkImportDetails.map((sdkImport) => ({
      id: `sdk.${sdkImport.specifier}:${fixture.id}:${slugRef(sdkImport.ref)}`,
      fixture: fixture.id,
      specifier: sdkImport.specifier,
      ref: sdkImport.ref,
      support: sdkExports.has(sdkImport.specifier) ? "target-exported" : "compat-alias-required",
      assertions: ["package export exists", "cold import resolves without plugin credentials"],
    })),
    packageEntrypoints: packageEntrypoints(fixture),
  }));

  const issueProbes = report.contractProbes.map((probe) => ({
    id: probe.id,
    fixture: probe.fixture,
    priority: probe.priority,
    target: probe.target,
    evidence: probe.evidence,
    assertions: assertionsForProbeTarget(probe.target),
  }));

  const allRegistrations = fixtures.flatMap((fixture) => fixture.registrations);
  const allHooks = fixtures.flatMap((fixture) => fixture.hooks);
  const allSdkImports = fixtures.flatMap((fixture) => fixture.sdkImports);
  const allPackageEntrypoints = fixtures.flatMap((fixture) => fixture.packageEntrypoints);

  return {
    generatedAt: report.generatedAt,
    targetOpenClaw: {
      status: report.targetOpenClaw.status,
      configuredPath: report.targetOpenClaw.configuredPath,
      capturedRegistrarCount: report.targetOpenClaw.capturedRegistrarCount ?? 0,
      sdkExportCount: report.targetOpenClaw.sdkExportCount ?? 0,
    },
    summary: {
      fixtureCount: fixtures.length,
      registrationCount: allRegistrations.length,
      hookCount: allHooks.length,
      sdkImportCount: allSdkImports.length,
      packageEntrypointCount: allPackageEntrypoints.length,
      issueProbeCount: issueProbes.length,
      inspectorShimRequiredCount: allRegistrations.filter((item) => item.support === "inspector-shim-required").length,
      compatAliasRequiredCount: allSdkImports.filter((item) => item.support === "compat-alias-required").length,
    },
    fixtures,
    issueProbes,
  };
}

export function validateContractCapture(capture) {
  const errors = [];

  for (const fixture of capture.fixtures) {
    for (const section of ["registrations", "hooks", "sdkImports", "packageEntrypoints"]) {
      for (const item of fixture[section]) {
        if (!item.ref && section !== "packageEntrypoints") {
          errors.push(`${item.id}: missing source reference`);
        }
        if (!Array.isArray(item.assertions) || item.assertions.length === 0) {
          errors.push(`${item.id}: missing capture assertions`);
        }
        if (section === "registrations" && !Array.isArray(item.syntheticArguments)) {
          errors.push(`${item.id}: missing synthetic registration arguments`);
        }
        if (section === "hooks" && (!item.syntheticEvent || typeof item.syntheticEvent !== "object")) {
          errors.push(`${item.id}: missing synthetic hook event`);
        }
        if (section === "hooks" && (!item.syntheticContext || typeof item.syntheticContext !== "object")) {
          errors.push(`${item.id}: missing synthetic hook context`);
        }
      }
    }
  }

  for (const probe of capture.issueProbes) {
    if (!Array.isArray(probe.evidence) || probe.evidence.length === 0) {
      errors.push(`${probe.id}: missing probe evidence`);
    }
    if (!Array.isArray(probe.assertions) || probe.assertions.length === 0) {
      errors.push(`${probe.id}: missing probe assertions`);
    }
  }

  return errors;
}

export async function writeContractCapture(capture, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    json: capture,
    markdown: renderContractCaptureMarkdown(capture, options),
  });
}

export function renderContractCaptureMarkdown(capture, options = {}) {
  return [
    `# ${options.title ?? "Plugin Inspector Contract Capture"}`,
    "",
    `Generated: ${capture.generatedAt}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Fixtures", capture.summary.fixtureCount],
        ["Registrations", capture.summary.registrationCount],
        ["Hooks", capture.summary.hookCount],
        ["SDK imports", capture.summary.sdkImportCount],
        ["Package entrypoints", capture.summary.packageEntrypointCount],
        ["Issue probes", capture.summary.issueProbeCount],
        ["Inspector shim required", capture.summary.inspectorShimRequiredCount],
        ["Compat aliases required", capture.summary.compatAliasRequiredCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Registration Capture",
    "",
    markdownTable(
      capture.fixtures.flatMap((fixture) =>
        fixture.registrations.map((item) => [
          fixture.id,
          item.registrar,
          item.support,
          item.ref,
          item.assertions.join("; "),
        ]),
      ),
      ["Fixture", "Registrar", "Support", "Evidence", "Assertions"],
    ),
    "",
    "## Hook Probes",
    "",
    markdownTable(
      capture.fixtures.flatMap((fixture) =>
        fixture.hooks.map((item) => [
          fixture.id,
          item.hook,
          item.support,
          item.ref,
          item.assertions.join("; "),
        ]),
      ),
      ["Fixture", "Hook", "Support", "Evidence", "Assertions"],
    ),
    "",
    "## SDK Import Probes",
    "",
    markdownTable(
      capture.fixtures.flatMap((fixture) =>
        fixture.sdkImports.map((item) => [
          fixture.id,
          item.specifier,
          item.support,
          item.ref,
          item.assertions.join("; "),
        ]),
      ),
      ["Fixture", "Specifier", "Support", "Evidence", "Assertions"],
    ),
    "",
    "## Issue Probe Backlog",
    "",
    markdownTable(
      capture.issueProbes.map((probe) => [
        probe.id,
        probe.priority,
        probe.fixture,
        probe.target,
        probe.assertions.join("; "),
        probe.evidence.join(", "),
      ]),
      ["ID", "Priority", "Fixture", "Target", "Assertions", "Evidence"],
    ),
  ].join("\n");
}

function packageEntrypoints(fixture) {
  return fixture.packages.flatMap((packageSummary) =>
    (packageSummary.openclaw?.entrypoints ?? []).map((entrypoint) => ({
      id: `package.${entrypoint.kind}:${fixture.id}:${slugRef(entrypoint.relativePath)}`,
      fixture: fixture.id,
      kind: entrypoint.kind,
      specifier: entrypoint.specifier,
      ref: entrypoint.relativePath,
      support: entrypoint.exists ? "source-present" : entrypoint.requiresBuild ? "build-required" : "missing",
      assertions: ["entrypoint path resolves", "entrypoint can be cold-imported after required build step"],
    })),
  );
}

function assertionsForProbeTarget(target) {
  const assertions = {
    "channel-runtime": ["message envelope is stable", "sender/config metadata is preserved"],
    "hook-runner": ["synthetic event payload is accepted", "return semantics are preserved"],
    "inspector-capture-api": ["registration arguments are recorded", "registered handler metadata is retained"],
    "manifest-loader": ["metadata key is accepted", "migration or compatibility mapping is visible"],
    "package-loader": ["entrypoint metadata resolves", "cold import failure mode is classified"],
    "sdk-alias": ["package export exists", "migration metadata is visible when alias is missing"],
    "tool-runtime": ["tool schema is captured", "tool result metadata is retained"],
  };
  return assertions[target] ?? ["probe has fixture evidence and a target contract"];
}

function slugRef(ref) {
  return ref.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
