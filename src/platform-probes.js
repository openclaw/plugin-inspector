import { renderMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

export const defaultPlatformTargets = ["linux", "macos", "windows", "container"];

export function buildPlatformProbes(options = {}) {
  const plan = options.plan;
  if (!plan) {
    throw new TypeError("buildPlatformProbes requires an isolated workspace plan");
  }

  const targets = options.targets ?? defaultPlatformTargets;
  const entrypoints = plan.fixtures.flatMap((fixture) =>
    fixture.entrypoints.map((entrypoint) => summarizeEntrypoint(fixture.id, entrypoint)),
  );
  const portabilityFindings = plan.fixtures.flatMap((fixture) =>
    fixture.entrypoints.flatMap((entrypoint) =>
      entrypoint.steps
        .map((step) => summarizeStep(fixture.id, entrypoint, step))
        .filter((finding) => finding.riskCodes.length > 0),
    ),
  );

  return {
    generatedAt: plan.generatedAt,
    mode: "plan-only",
    targets,
    summary: {
      fixtureCount: plan.summary.fixtureCount,
      entrypointCount: entrypoints.length,
      tsLoaderEntrypointCount: entrypoints.filter((entrypoint) => entrypoint.loaderPrimary === "tsx").length,
      jitiAlternativeCount: entrypoints.filter((entrypoint) => entrypoint.loaderAlternatives.includes("jiti")).length,
      lazyImportProbeCount: entrypoints.filter((entrypoint) => entrypoint.capturePlanned && entrypoint.syntheticProbePlanned).length,
      portabilityFindingCount: portabilityFindings.length,
      windowsRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("windows")).length,
      macosRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("macos")).length,
      linuxRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("linux")).length,
      containerRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("container")).length,
    },
    entrypoints,
    portabilityFindings,
    recommendations: buildRecommendations(portabilityFindings, entrypoints),
  };
}

export function validatePlatformProbes(report, options = {}) {
  const targets = options.targets ?? defaultPlatformTargets;
  const errors = [];
  if (report.mode !== "plan-only") {
    errors.push("platform probes must stay plan-only in default checks");
  }
  if (!targets.every((target) => report.targets.includes(target))) {
    errors.push(`platform probes must cover ${targets.join(", ")} targets`);
  }
  if (report.summary.tsLoaderEntrypointCount !== report.summary.jitiAlternativeCount) {
    errors.push("all TypeScript loader entrypoints must track a Jiti fallback candidate");
  }
  for (const entrypoint of report.entrypoints) {
    if (entrypoint.loaderPrimary === "tsx" && (!entrypoint.captureUsesTsx || !entrypoint.syntheticUsesTsx)) {
      errors.push(`${entrypoint.id}: tsx loader strategy is not reflected in capture and synthetic commands`);
    }
  }
  return errors;
}

export async function writePlatformProbes(report, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    json: report,
    markdown: renderPlatformProbesMarkdown(report, options),
    check: options.check,
  });
}

export function renderPlatformProbesMarkdown(report, options = {}) {
  return [
    `# ${options.title ?? "Plugin Inspector Platform And Loader Probes"}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Targets: ${report.targets.join(", ")}`,
    "",
    "## Summary",
    "",
    markdownTable(Object.entries(report.summary).map(([key, value]) => [key, value]), ["Metric", "Value"]),
    "",
    "## Loader Probes",
    "",
    markdownTable(
      report.entrypoints.map((entrypoint) => [
        entrypoint.fixture,
        entrypoint.status,
        entrypoint.loaderPrimary,
        entrypoint.loaderAlternatives.join(", ") || "-",
        entrypoint.captureUsesTsx ? "yes" : "no",
        entrypoint.syntheticUsesTsx ? "yes" : "no",
        entrypoint.entrypoint,
      ]),
      ["Fixture", "Status", "Primary", "Alternatives", "Capture TSX", "Synthetic TSX", "Entrypoint"],
    ),
    "",
    "## Portability Findings",
    "",
    markdownTable(
      report.portabilityFindings.map((finding) => [
        finding.fixture,
        finding.kind,
        finding.platforms.join(", ") || "-",
        finding.riskCodes.join(", "),
        finding.mitigation,
      ]),
      ["Fixture", "Step", "Platforms", "Risks", "Mitigation"],
    ),
    "",
    "## Recommendations",
    "",
    markdownTable(
      report.recommendations.map((recommendation) => [recommendation.area, recommendation.action]),
      ["Area", "Action"],
    ),
  ].join("\n");
}

function summarizeEntrypoint(fixtureId, entrypoint) {
  const captureStep = entrypoint.steps.find((step) => step.kind === "capture");
  const syntheticStep = entrypoint.steps.find((step) => step.kind === "synthetic-probe");
  return {
    fixture: fixtureId,
    id: entrypoint.id,
    status: entrypoint.status,
    entrypoint: entrypoint.entrypoint,
    packageManager: entrypoint.packageManager,
    loaderSource: entrypoint.loaderStrategy.source,
    loaderPrimary: entrypoint.loaderStrategy.primary,
    loaderAlternatives: entrypoint.loaderStrategy.alternatives,
    capturePlanned: Boolean(captureStep),
    syntheticProbePlanned: Boolean(syntheticStep),
    captureUsesTsx: Boolean(captureStep?.command.includes("--import tsx")),
    syntheticUsesTsx: Boolean(syntheticStep?.command.includes("--import tsx")),
  };
}

function summarizeStep(fixtureId, entrypoint, step) {
  const riskCodes = stepRiskCodes(step);
  return {
    fixture: fixtureId,
    entrypoint: entrypoint.id,
    kind: step.kind,
    platforms: platformsForRiskCodes(riskCodes),
    riskCodes,
    command: step.command,
    mitigation: mitigationForRiskCodes(riskCodes),
  };
}

function stepRiskCodes(step) {
  const risks = new Set();
  if (/\bmkdir -p\b/.test(step.command)) {
    risks.add("posix-mkdir");
  }
  if (/\brsync\b/.test(step.command)) {
    risks.add("rsync-required");
  }
  if (/^[A-Z0-9_]+=/.test(step.command)) {
    risks.add("posix-env-prefix");
  }
  if (/\|\|\s*true/.test(step.command)) {
    risks.add("posix-null-failure");
  }
  if (/\s>\s/.test(step.command)) {
    risks.add("shell-redirection");
  }
  if (step.command.includes("--import tsx")) {
    risks.add("tsx-loader-runtime");
  }
  if (/^(pnpm|yarn|bun)\b/.test(step.command)) {
    risks.add("package-manager-availability");
  }
  return [...risks].sort();
}

function platformsForRiskCodes(riskCodes) {
  const platforms = new Set();
  for (const code of riskCodes) {
    if (["posix-mkdir", "rsync-required", "posix-env-prefix", "posix-null-failure"].includes(code)) {
      platforms.add("windows");
    }
    if (["rsync-required", "package-manager-availability"].includes(code)) {
      platforms.add("container");
    }
    if (code === "package-manager-availability") {
      platforms.add("linux");
      platforms.add("macos");
      platforms.add("windows");
    }
  }
  return [...platforms].sort();
}

function mitigationForRiskCodes(riskCodes) {
  const mitigations = {
    "package-manager-availability": "install the declared package manager before isolated execution",
    "posix-env-prefix": "run isolated commands through a Node wrapper or set env via the runner API",
    "posix-mkdir": "replace shell mkdir with fs.mkdir({ recursive: true }) in the executor",
    "posix-null-failure": "capture audit failures in the executor instead of relying on shell fallthrough",
    "rsync-required": "copy workspaces with a Node fs.cp fallback before Windows/container lanes",
    "shell-redirection": "write audit JSON from the executor instead of shell redirection",
    "tsx-loader-runtime": "verify TS source entrypoints with tsx and Jiti loader lanes",
  };
  return riskCodes.map((code) => mitigations[code]).filter(Boolean).join("; ");
}

function buildRecommendations(portabilityFindings, entrypoints) {
  const recommendations = [];
  if (entrypoints.some((entrypoint) => entrypoint.loaderPrimary === "tsx")) {
    recommendations.push({
      area: "loader",
      action: "keep tsx as the source-entrypoint smoke path, add a Jiti execution lane before treating TS plugin source compatibility as covered",
    });
  }
  if (portabilityFindings.some((finding) => finding.riskCodes.includes("rsync-required"))) {
    recommendations.push({
      area: "workspace-copy",
      action: "move isolated workspace copy into Node fs.cp so Windows and slim containers do not depend on rsync",
    });
  }
  if (portabilityFindings.some((finding) => finding.riskCodes.includes("posix-env-prefix"))) {
    recommendations.push({
      area: "executor",
      action: "replace shell env-prefix commands with structured spawn env for Windows parity",
    });
  }
  return recommendations;
}

function markdownTable(rows, headers) {
  return renderMarkdownTable(rows, headers, { empty: "_none_", escape: false, padding: true });
}
