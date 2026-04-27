import path from "node:path";
import { renderMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";

export function buildReport({ config, inspections, failures = [], generatedAt = "deterministic" }) {
  const inspectionById = new Map(inspections.map((inspection) => [inspection.id, inspection]));
  const fixtures = [];
  const breakages = [];
  const logs = [];
  const decisions = [];

  for (const fixture of config.fixtures) {
    const inspection = inspectionById.get(fixture.id) ?? emptyFixtureReport(fixture);
    fixtures.push({
      id: fixture.id,
      path: fixture.path,
      priority: fixture.priority,
      seams: fixture.seams,
      status: inspection.status,
      hooks: inspection.hooks,
      registrations: inspection.registrations,
      manifestContracts: inspection.manifestContracts,
      sdkImports: inspection.sdkImports,
      sourceFiles: inspection.sourceFiles,
      manifestFiles: inspection.manifestFiles,
      packageFiles: inspection.packageFiles,
      packageEntrypoints: inspection.packageEntrypoints,
    });

    logs.push({
      fixture: fixture.id,
      code: "seam-inventory",
      level: "log",
      message: `observed ${inspection.hooks.length} hooks, ${inspection.registrations.length} registrations, and ${inspection.manifestContracts.length} manifest contracts`,
      evidence: [
        ...inspection.hooks.map((hook) => `hook:${hook}`),
        ...inspection.registrations.map((registration) => `registration:${registration}`),
        ...inspection.manifestContracts.map((contract) => `manifestContract:${contract}`),
      ],
    });
  }

  for (const failure of failures) {
    const fixture = failure.split(":")[0] || "unknown";
    breakages.push({
      fixture,
      code: "missing-expected-seam",
      level: "breakage",
      message: failure,
      evidence: [failure],
    });
    decisions.push({
      fixture,
      decision: "inspector-follow-up",
      seam: "expected-seam",
      action: "Investigate whether OpenClaw removed a plugin-facing contract or the fixture pin changed behavior.",
      evidence: failure,
    });
  }

  return {
    generatedAt,
    status: breakages.length === 0 ? "pass" : "fail",
    summary: {
      fixtureCount: fixtures.length,
      highPriorityFixtures: fixtures.filter((fixture) => fixture.priority === "high").length,
      breakageCount: breakages.length,
      warningCount: 0,
      suggestionCount: 0,
      decisionCount: decisions.length,
      logCount: logs.length,
    },
    fixtures,
    breakages,
    warnings: [],
    suggestions: [],
    logs,
    decisions,
  };
}

export async function writeReport(report, options = {}) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? "reports");
  const basename = options.basename ?? "plugin-inspector-report";
  const jsonPath = path.join(outDir, `${basename}.json`);
  const markdownPath = path.join(outDir, `${basename}.md`);

  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: report,
    markdown: renderMarkdownReport(report),
    check: options.check,
  });
}

export function renderTextSummary(report) {
  return [
    `Status: ${report.status.toUpperCase()}`,
    `Fixtures: ${report.summary.fixtureCount}`,
    `Breakages: ${report.summary.breakageCount}`,
    `Logs: ${report.summary.logCount}`,
  ].join("\n");
}

export function renderMarkdownReport(report) {
  return [
    "# OpenClaw Plugin Inspector Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status.toUpperCase()}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Fixtures", report.summary.fixtureCount],
        ["High-priority fixtures", report.summary.highPriorityFixtures],
        ["Hard breakages", report.summary.breakageCount],
        ["Warnings", report.summary.warningCount],
        ["Suggestions", report.summary.suggestionCount],
        ["Decision rows", report.summary.decisionCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Hard Breakages",
    "",
    findingsTable(report.breakages),
    "",
    "## Fixture Seam Inventory",
    "",
    markdownTable(
      report.fixtures.map((fixture) => [
        fixture.id,
        fixture.priority,
        fixture.seams.join(", "),
        fixture.hooks.join(", ") || "-",
        fixture.registrations.join(", ") || "-",
        fixture.manifestContracts.join(", ") || "-",
      ]),
      ["Fixture", "Priority", "Seams", "Hooks", "Registrations", "Manifest contracts"],
    ),
    "",
    "## Decision Matrix",
    "",
    markdownTable(
      report.decisions.map((decision) => [
        decision.fixture,
        decision.decision,
        decision.seam,
        decision.action,
        decision.evidence,
      ]),
      ["Fixture", "Decision", "Seam", "Action", "Evidence"],
    ),
    "",
    "## Raw Logs",
    "",
    findingsTable(report.logs),
  ].join("\n");
}

function findingsTable(findings) {
  if (findings.length === 0) {
    return "_None._";
  }
  return markdownTable(
    findings.map((finding) => [
      finding.fixture,
      finding.level,
      finding.code,
      finding.message,
      (finding.evidence ?? []).join("<br>") || "-",
    ]),
    ["Fixture", "Level", "Code", "Message", "Evidence"],
  );
}

function markdownTable(rows, headers) {
  return renderMarkdownTable(rows, headers);
}

function emptyFixtureReport(fixture) {
  return {
    id: fixture.id,
    status: "missing",
    hooks: [],
    registrations: [],
    manifestContracts: [],
    sdkImports: [],
    sourceFiles: [],
    manifestFiles: [],
    packageFiles: [],
    packageEntrypoints: [],
  };
}
