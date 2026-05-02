import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

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
  const stepFindings = plan.fixtures.flatMap((fixture) =>
    fixture.entrypoints.flatMap((entrypoint) => entrypoint.steps.map((step) => summarizeStep(fixture.id, entrypoint, step, options.stepCoverage))),
  );
  const portabilityFindings = stepFindings.flatMap((finding) => (finding.residual ? [finding.residual] : []));
  const coveredPortabilityFindings = stepFindings.flatMap((finding) => (finding.covered ? [finding.covered] : []));

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
      coveredPortabilityFindingCount: coveredPortabilityFindings.length,
      windowsRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("windows")).length,
      macosRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("macos")).length,
      linuxRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("linux")).length,
      containerRiskStepCount: portabilityFindings.filter((finding) => finding.platforms.includes("container")).length,
    },
    entrypoints,
    portabilityFindings,
    coveredPortabilityFindings,
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
    if (
      entrypoint.loaderPrimary === "tsx" &&
      (!entrypoint.captureUsesTypeScriptLoader || !entrypoint.syntheticUsesTypeScriptLoader)
    ) {
      errors.push(`${entrypoint.id}: TypeScript loader strategy is not reflected in capture and synthetic commands`);
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
        entrypoint.captureUsesMockSdk ? "yes" : "no",
        entrypoint.syntheticUsesMockSdk ? "yes" : "no",
        entrypoint.entrypoint,
      ]),
      [
        "Fixture",
        "Status",
        "Primary",
        "Alternatives",
        "Capture TSX",
        "Synthetic TSX",
        "Capture Mock SDK",
        "Synthetic Mock SDK",
        "Entrypoint",
      ],
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
    "## Covered Portability Findings",
    "",
    markdownTable(
      (report.coveredPortabilityFindings ?? []).map((finding) => [
        finding.fixture,
        finding.kind,
        finding.platforms.join(", ") || "-",
        finding.riskCodes.join(", "),
        finding.coverage,
      ]),
      ["Fixture", "Step", "Platforms", "Covered Risks", "Coverage"],
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
  const captureUsesTsx = Boolean(captureStep?.command.includes("--import tsx"));
  const syntheticUsesTsx = Boolean(syntheticStep?.command.includes("--import tsx"));
  const captureUsesMockSdk = Boolean(captureStep?.command.includes("--mock-sdk"));
  const syntheticUsesMockSdk = Boolean(syntheticStep?.command.includes("--mock-sdk"));
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
    captureUsesTsx,
    syntheticUsesTsx,
    captureUsesMockSdk,
    syntheticUsesMockSdk,
    captureUsesTypeScriptLoader: captureUsesTsx || captureUsesMockSdk,
    syntheticUsesTypeScriptLoader: syntheticUsesTsx || syntheticUsesMockSdk,
  };
}

function summarizeStep(fixtureId, entrypoint, step, stepCoverage) {
  const riskCodes = stepRiskCodes(step);
  const coverage = normalizeStepCoverage(stepCoverage?.({ fixture: fixtureId, entrypoint, step, riskCodes }), riskCodes);
  const residualRiskCodes = riskCodes.filter((code) => !coverage.riskCodes.includes(code));
  const common = {
    fixture: fixtureId,
    entrypoint: entrypoint.id,
    kind: step.kind,
    command: step.command,
  };
  return {
    residual:
      residualRiskCodes.length > 0
        ? {
            ...common,
            coveredRiskCodes: coverage.riskCodes,
            platforms: platformsForRiskCodes(residualRiskCodes),
            riskCodes: residualRiskCodes,
            mitigation: mitigationForRiskCodes(residualRiskCodes),
          }
        : null,
    covered:
      coverage.riskCodes.length > 0
        ? {
            ...common,
            coverage: coverage.reason,
            platforms: platformsForRiskCodes(coverage.riskCodes),
            riskCodes: coverage.riskCodes,
          }
        : null,
  };
}

function normalizeStepCoverage(coverage, riskCodes) {
  if (!coverage) {
    return { reason: "", riskCodes: [] };
  }
  const requested = coverage === true ? riskCodes : coverage.coveredRiskCodes ?? coverage.handledRiskCodes ?? coverage.riskCodes ?? coverage;
  const covered = Array.isArray(requested) ? requested : [];
  return {
    reason: typeof coverage.reason === "string" && coverage.reason ? coverage.reason : "covered by isolated workspace executor",
    riskCodes: covered.filter((code) => riskCodes.includes(code)).sort(),
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
      action: "keep mock-SDK TypeScript capture green, add a real host-loader/Jiti lane before treating TS plugin source compatibility as covered",
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
  return renderPaddedMarkdownTable(rows, headers);
}
