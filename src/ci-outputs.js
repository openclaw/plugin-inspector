import path from "node:path";
import { writeArtifacts } from "./artifacts.js";

export const defaultSarifPath = "plugin-inspector.sarif";
export const defaultJunitPath = "plugin-inspector.junit.xml";

export async function writeCiOutputArtifacts(report, options = {}) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? "reports");
  const artifacts = [];

  if (options.sarifPath) {
    artifacts.push({
      name: "sarifPath",
      path: path.resolve(outDir, options.sarifPath),
      json: buildSarifReport(report),
    });
  }

  if (options.junitPath) {
    artifacts.push({
      name: "junitPath",
      path: path.resolve(outDir, options.junitPath),
      content: renderJunitXml(report),
    });
  }

  if (artifacts.length === 0) {
    return {};
  }

  return writeArtifacts(artifacts, { check: options.check });
}

export function buildSarifReport(report) {
  const findings = reportFindings(report);
  const rules = [...new Map(findings.map((finding) => [finding.code, sarifRule(finding)])).values()];
  const fixtureById = new Map((report.fixtures ?? []).map((fixture) => [fixture.id, fixture]));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "plugin-inspector",
            informationUri: "https://github.com/openclaw/plugin-inspector",
            rules,
          },
        },
        results: findings.map((finding) => sarifResult(finding, fixtureById)),
      },
    ],
  };
}

export function renderJunitXml(report) {
  const findings = reportFindings(report);
  const testcases = findings.length > 0 ? findings.map(junitFindingTestcase) : [junitPassingTestcase(report)];
  const failures = findings.filter(isBlockingFinding).length;
  const tests = testcases.length;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="plugin-inspector" tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    ...testcases,
    "</testsuite>",
    "",
  ].join("\n");
}

export function reportFindings(report) {
  const findings = new Map();
  for (const finding of [...(report.breakages ?? []), ...(report.warnings ?? []), ...(report.suggestions ?? [])]) {
    findings.set(findingKey(finding), finding);
  }
  for (const issue of report.issues ?? []) {
    const finding = issueToFinding(issue);
    findings.set(findingKey(finding), {
      ...findings.get(findingKey(finding)),
      ...finding,
    });
  }
  return [...findings.values()];
}

function issueToFinding(issue) {
  return {
    fixture: issue.fixture,
    code: issue.code,
    level: issue.status === "blocking" ? "breakage" : "warning",
    message: issue.title,
    evidence: issue.evidence ?? [],
    severity: issue.severity,
    issueClass: issue.issueClass,
  };
}

function findingKey(finding) {
  return [
    finding.fixture ?? "",
    finding.code ?? "",
    ...normalizeEvidence(finding.evidence),
  ].join("\n");
}

function sarifRule(finding) {
  return {
    id: finding.code,
    shortDescription: {
      text: finding.code,
    },
    fullDescription: {
      text: finding.message ?? finding.code,
    },
    defaultConfiguration: {
      level: sarifLevel(finding),
    },
  };
}

function sarifResult(finding, fixtureById) {
  return {
    ruleId: finding.code,
    level: sarifLevel(finding),
    message: {
      text: finding.message ?? finding.code,
    },
    locations: [sarifLocation(finding, fixtureById)],
    properties: {
      fixture: finding.fixture,
      severity: finding.severity ?? finding.level,
      issueClass: finding.issueClass,
      evidence: normalizeEvidence(finding.evidence),
    },
  };
}

function sarifLocation(finding, fixtureById) {
  const parsed = parseEvidenceLocation(normalizeEvidence(finding.evidence)[0]);
  const fixture = fixtureById.get(finding.fixture);
  const uri = parsed?.uri ?? fixture?.path ?? ".";
  return {
    physicalLocation: {
      artifactLocation: {
        uri: normalizeUri(uri),
      },
      region: {
        startLine: parsed?.line ?? 1,
      },
    },
  };
}

function parseEvidenceLocation(evidence) {
  if (!evidence) {
    return null;
  }

  const ref = evidence.includes(" @ ") ? evidence.split(" @ ").pop() : evidence;
  const match = /^(?<uri>.+?):(?<line>\d+)(?::\d+)?$/.exec(ref);
  if (!match?.groups?.uri) {
    return null;
  }
  return {
    uri: match.groups.uri,
    line: Number(match.groups.line),
  };
}

function junitFindingTestcase(finding) {
  const classname = `plugin-inspector.${xmlName(finding.fixture ?? "unknown")}`;
  const name = `${finding.level ?? "finding"}:${finding.code}`;
  const output = normalizeEvidence(finding.evidence).join("\n");
  if (!isBlockingFinding(finding)) {
    return [
      `  <testcase classname="${escapeXml(classname)}" name="${escapeXml(name)}">`,
      output ? `    <system-out>${escapeXml(output)}</system-out>` : "",
      "  </testcase>",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `  <testcase classname="${escapeXml(classname)}" name="${escapeXml(name)}">`,
    `    <failure message="${escapeXml(finding.message ?? finding.code)}">${escapeXml(output || finding.message || finding.code)}</failure>`,
    "  </testcase>",
  ].join("\n");
}

function junitPassingTestcase(report) {
  return `  <testcase classname="plugin-inspector" name="status:${escapeXml(report.status ?? "pass")}"/>`;
}

function isBlockingFinding(finding) {
  return finding.level === "breakage" || finding.status === "blocking" || finding.severity === "P0";
}

function sarifLevel(finding) {
  if (isBlockingFinding(finding) || finding.severity === "P1") {
    return "error";
  }
  if (finding.level === "warning" || finding.severity === "P2") {
    return "warning";
  }
  return "note";
}

function normalizeEvidence(evidence) {
  if (Array.isArray(evidence)) {
    return evidence.map(String);
  }
  if (evidence == null) {
    return [];
  }
  return [String(evidence)];
}

function normalizeUri(uri) {
  return String(uri).replaceAll(path.sep, "/");
}

function xmlName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
