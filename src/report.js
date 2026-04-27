import path from "node:path";
import { renderMarkdownTable, writeArtifacts, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { renderCompatibilityIssuesReport, renderCompatibilityMarkdownReport } from "./compatibility-report.js";
import { buildContractProbes } from "./contract-probes.js";
import { classifyCompatibilityFixture } from "./fixture-summary.js";
import { buildIssues, summarizeIssueClasses } from "./issues.js";

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

export async function buildCompatibilityReport(options = {}) {
  const fixtureInputs = options.fixtures ?? options.config?.fixtures ?? [];
  const targetOpenClaw = options.targetOpenClaw ?? emptyTargetOpenClaw();
  const inspectionById = new Map((options.inspections ?? []).map((inspection) => [inspection.id, inspection]));
  const fixtureReports = [];
  const breakages = [];
  const warnings = [];
  const suggestions = [];
  const logs = [];
  const decisions = [];
  const buildFixtureReport = options.buildFixtureReport ?? defaultCompatibilityFixtureReport;

  for (const fixture of fixtureInputs) {
    const inspection = normalizeInspection(inspectionById.get(fixture.id), fixture);
    const fixtureReport = await buildFixtureReport({ fixture, inspection, targetOpenClaw });
    fixtureReports.push(fixtureReport);

    logs.push(seamInventoryFinding(fixture, inspection));

    const fixtureClassification = classifyCompatibilityFixture({
      fixture,
      inspection,
      fixtureReport,
      targetOpenClaw,
    });
    warnings.push(...fixtureClassification.warnings);
    suggestions.push(...fixtureClassification.suggestions);
    logs.push(...fixtureClassification.logs);
    decisions.push(...fixtureClassification.decisions);
  }

  for (const failure of options.failures ?? []) {
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
      action: "Investigate whether OpenClaw removed a plugin-facing contract or the fixture pin changed upstream behavior.",
      evidence: failure,
    });
  }

  classifyCompatRecordCoverage({
    targetOpenClaw,
    findings: [...warnings, ...suggestions],
    suggestions,
    logs,
    decisions,
  });

  const issues = buildIssues({
    breakages,
    warnings,
    suggestions,
    targetOpenClaw,
    idPrefix: options.issueIdPrefix,
  });
  const contractProbes = buildContractProbes({ warnings, suggestions, fixtures: fixtureReports });
  const issueSummary = summarizeIssueClasses(issues);

  return {
    generatedAt: options.generatedAt ?? "deterministic",
    targetOpenClaw,
    status: breakages.length === 0 ? "pass" : "fail",
    summary: {
      fixtureCount: fixtureReports.length,
      highPriorityFixtures: fixtureReports.filter((fixture) => fixture.priority === "high").length,
      breakageCount: breakages.length,
      warningCount: warnings.length,
      suggestionCount: suggestions.length,
      decisionCount: decisions.length,
      issueCount: issues.length,
      p0IssueCount: issues.filter((issue) => issue.severity === "P0").length,
      p1IssueCount: issues.filter((issue) => issue.severity === "P1").length,
      liveIssueCount: issueSummary["live-issue"],
      liveP0IssueCount: issues.filter((issue) => issue.issueClass === "live-issue" && issue.severity === "P0").length,
      compatGapCount: issueSummary["compat-gap"],
      deprecationWarningCount: issueSummary["deprecation-warning"],
      inspectorGapCount: issueSummary["inspector-gap"],
      upstreamIssueCount: issueSummary["upstream-metadata"],
      fixtureRegressionCount: issueSummary["fixture-regression"],
      contractProbeCount: contractProbes.length,
    },
    fixtures: fixtureReports,
    breakages,
    warnings,
    suggestions,
    issues,
    contractProbes,
    logs,
    decisions,
  };
}

export function classifyCompatRecordCoverage({ targetOpenClaw, findings, suggestions, logs, decisions }) {
  if (targetOpenClaw.status !== "ok") {
    logs.push({
      fixture: "openclaw",
      code: "target-openclaw-unavailable",
      level: "log",
      message: "target OpenClaw checkout was not available, so compat record coverage was not checked",
      evidence: [targetOpenClaw.configuredPath ?? "not configured"],
    });
    return;
  }

  const knownRecords = new Set(targetOpenClaw.compatRecords ?? []);
  for (const finding of findings.filter((item) => item.compatRecord)) {
    if (knownRecords.has(finding.compatRecord)) {
      logs.push({
        fixture: finding.fixture,
        code: "compat-record-present",
        level: "log",
        message: "target OpenClaw checkout has a matching compat registry record",
        evidence: [finding.compatRecord, `status:${targetOpenClaw.compatRecordStatuses?.[finding.compatRecord] ?? "unknown"}`],
        compatRecord: finding.compatRecord,
      });
      continue;
    }

    suggestions.push({
      fixture: finding.fixture,
      code: "missing-compat-record",
      level: "suggestion",
      message: "fixture depends on a compatibility behavior that is not represented in the target compat registry",
      evidence: [finding.compatRecord],
      compatRecord: finding.compatRecord,
    });
    decisions.push({
      fixture: finding.fixture,
      decision: "core-compat-adapter",
      seam: "compat-registry",
      action: "Add or restore a machine-readable OpenClaw compat record before changing this plugin-facing behavior.",
      evidence: finding.compatRecord,
    });
  }
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

export async function writeCompatibilityReport(report, options = {}) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? "reports");
  const basename = options.basename ?? "plugin-inspector-report";
  const jsonPath = path.join(outDir, `${basename}.json`);
  const markdownPath = path.join(outDir, `${basename}.md`);
  const issuesPath = path.join(outDir, options.issuesBasename ?? "plugin-inspector-issues.md");

  return writeArtifacts(
    [
      { name: "jsonPath", path: jsonPath, json: report },
      { name: "markdownPath", path: markdownPath, markdown: renderCompatibilityMarkdownReport(report) },
      { name: "issuesPath", path: issuesPath, markdown: renderCompatibilityIssuesReport(report) },
    ],
    { check: options.check },
  );
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

function defaultCompatibilityFixtureReport({ fixture, inspection }) {
  return {
    id: fixture.id,
    name: fixture.name,
    path: fixture.path,
    priority: fixture.priority,
    seams: fixture.seams,
    why: fixture.why,
    status: inspection.status,
    hooks: inspection.hooks,
    hookDetails: inspection.hookDetails,
    registrations: inspection.registrations,
    registrationDetails: inspection.registrationDetails,
    manifestContracts: inspection.manifestContracts,
    manifestFiles: inspection.manifestFiles,
    sourceFiles: inspection.sourceFiles,
    pluginManifests: [],
    package: null,
    packages: [],
    sdkImports: inspection.sdkImports.map((sdkImport) => sdkImport.specifier).filter(Boolean),
    sdkImportDetails: inspection.sdkImports,
  };
}

function normalizeInspection(inspection, fixture) {
  return {
    id: fixture.id,
    status: "missing",
    hooks: [],
    hookDetails: [],
    registrations: [],
    registrationDetails: [],
    manifestContracts: [],
    manifestFiles: [],
    manifestErrors: [],
    packageFiles: [],
    packageErrors: [],
    packageEntrypoints: [],
    sdkImports: [],
    sourceFiles: [],
    ...inspection,
  };
}

function seamInventoryFinding(fixture, inspection) {
  return {
    fixture: fixture.id,
    code: "seam-inventory",
    level: "log",
    message: `observed ${inspection.hooks.length} hooks, ${inspection.registrations.length} registrations, and ${inspection.manifestContracts.length} manifest contracts`,
    evidence: [
      ...inspection.hooks.map((hook) => `hook:${hook}`),
      ...inspection.registrations.map((registration) => `registration:${registration}`),
      ...inspection.manifestContracts.map((contract) => `manifestContract:${contract}`),
    ],
  };
}

function emptyTargetOpenClaw() {
  return {
    configuredPath: null,
    status: "not-configured",
    compatRecords: [],
    compatRecordStatuses: {},
    hookNames: [],
    apiRegistrars: [],
    capturedRegistrars: [],
    sdkExports: [],
    manifestFields: [],
    manifestContractFields: [],
  };
}
