import { knownIssueCodes } from "./issues.js";

export const knownIssueClasses = new Set([
  "compat-gap",
  "deprecation-warning",
  "fixture-regression",
  "inspector-gap",
  "live-issue",
  "upstream-metadata",
]);

export function validateContractCoverage(report, options = {}) {
  const errors = [];
  const issueCodes = options.knownIssueCodes ?? knownIssueCodes;
  const issueClasses = options.knownIssueClasses ?? knownIssueClasses;

  if (report.breakages.length > 0) {
    for (const breakage of report.breakages) {
      errors.push(`hard breakage: ${breakage.fixture} ${breakage.code}: ${breakage.message}`);
    }
  }

  requireUniqueIssueIds(report, errors);
  requireKnownIssueCodes(report, errors, issueCodes);
  requireKnownIssueClasses(report, errors, issueClasses);
  requireIssueEvidence(report, errors);
  requireP1ProbeCoverage(report, errors);
  requireFixtureEvidence(report, errors);
  requireTargetHookRegistry(report, errors);
  requireTargetApiBuilder(report, errors);
  requireTargetCapturedRegistration(report, errors);
  requireTargetSdkExports(report, errors);
  requireTargetManifestTypes(report, errors);
  requireCompatRecordReconciliation(report, errors);

  return errors;
}

function requireTargetHookRegistry(report, errors) {
  if (report.targetOpenClaw.status === "ok" && report.targetOpenClaw.hookNames.length === 0) {
    errors.push("target OpenClaw hook registry was found but no hook names were parsed");
  }
}

function requireTargetApiBuilder(report, errors) {
  if (report.targetOpenClaw.status === "ok" && report.targetOpenClaw.apiRegistrars.length === 0) {
    errors.push("target OpenClaw API builder was found but no api.register* names were parsed");
  }
}

function requireTargetCapturedRegistration(report, errors) {
  if (report.targetOpenClaw.status === "ok" && report.targetOpenClaw.capturedRegistrars.length === 0) {
    errors.push("target OpenClaw captured-registration helper was found but no api.register* names were parsed");
  }
}

function requireTargetSdkExports(report, errors) {
  if (report.targetOpenClaw.status === "ok" && report.targetOpenClaw.sdkExports.length === 0) {
    errors.push("target OpenClaw package metadata was found but no plugin SDK exports were parsed");
  }
}

function requireTargetManifestTypes(report, errors) {
  if (report.targetOpenClaw.status !== "ok") {
    return;
  }
  if (report.targetOpenClaw.manifestFields.length === 0) {
    errors.push("target OpenClaw manifest types were found but no PluginManifest fields were parsed");
  }
  if (report.targetOpenClaw.manifestContractFields.length === 0) {
    errors.push("target OpenClaw manifest types were found but no PluginManifestContracts fields were parsed");
  }
}

function requireUniqueIssueIds(report, errors) {
  const seen = new Set();
  for (const issue of report.issues) {
    if (seen.has(issue.id)) {
      errors.push(`duplicate issue id: ${issue.id}`);
    }
    seen.add(issue.id);
  }
}

function requireKnownIssueCodes(report, errors, issueCodes) {
  for (const issue of report.issues) {
    if (!issueCodes.has(issue.code)) {
      errors.push(`${issue.id}: unknown issue code ${issue.code}`);
    }
  }
}

function requireKnownIssueClasses(report, errors, issueClasses) {
  for (const issue of report.issues) {
    if (!issueClasses.has(issue.issueClass)) {
      errors.push(`${issue.id}: unknown issue class ${issue.issueClass}`);
    }
  }
}

function requireIssueEvidence(report, errors) {
  for (const issue of report.issues) {
    if (!Array.isArray(issue.evidence) || issue.evidence.length === 0) {
      errors.push(`${issue.id}: missing evidence`);
    }
  }
}

function requireP1ProbeCoverage(report, errors) {
  const probesByFixture = new Map();
  for (const probe of report.contractProbes) {
    const probes = probesByFixture.get(probe.fixture) ?? [];
    probes.push(probe);
    probesByFixture.set(probe.fixture, probes);
  }

  for (const issue of report.issues.filter((item) => item.severity === "P1")) {
    const probes = probesByFixture.get(issue.fixture) ?? [];
    if (probes.length === 0) {
      errors.push(`${issue.id}: P1 issue has no contract probe for ${issue.fixture}`);
    }
  }
}

function requireFixtureEvidence(report, errors) {
  for (const fixture of report.fixtures) {
    for (const hook of fixture.hooks) {
      if (!fixture.hookDetails.some((detail) => detail.name === hook)) {
        errors.push(`${fixture.id}: hook ${hook} has no source evidence`);
      }
    }
    for (const registration of fixture.registrations) {
      if (!fixture.registrationDetails.some((detail) => detail.name === registration)) {
        errors.push(`${fixture.id}: registration ${registration} has no source evidence`);
      }
    }
    for (const contract of fixture.manifestContracts) {
      if (contract !== "invalidManifest" && fixture.manifestFiles.length === 0) {
        errors.push(`${fixture.id}: manifest contract ${contract} has no manifest evidence`);
      }
    }
  }
}

function requireCompatRecordReconciliation(report, errors) {
  if (report.targetOpenClaw.status !== "ok") {
    return;
  }

  const presentRecords = new Set(
    report.logs
      .filter((finding) => finding.code === "compat-record-present")
      .map((finding) => `${finding.fixture}:${finding.compatRecord}`),
  );
  const missingRecords = new Set(
    report.suggestions
      .filter((finding) => finding.code === "missing-compat-record")
      .map((finding) => `${finding.fixture}:${finding.compatRecord}`),
  );
  const compatGapRecords = new Set(
    report.issues
      .filter((issue) => issue.issueClass === "compat-gap" && issue.compatRecord)
      .map((issue) => `${issue.fixture}:${issue.compatRecord}`),
  );

  for (const finding of [...report.warnings, ...report.suggestions].filter((item) => item.compatRecord)) {
    const key = `${finding.fixture}:${finding.compatRecord}`;
    if (!presentRecords.has(key) && !missingRecords.has(key) && !compatGapRecords.has(key)) {
      errors.push(`${finding.fixture}: compat record ${finding.compatRecord} was not reconciled`);
    }
  }
}
