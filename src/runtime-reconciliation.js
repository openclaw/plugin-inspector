export function applyRuntimeExecutionCoverage({ findings = [], executionResults } = {}) {
  const coverage = buildRuntimeExecutionCoverage(executionResults);
  let coveredFindingCount = 0;
  let partiallyCoveredFindingCount = 0;

  for (const finding of findings) {
    const findingCoverage = runtimeCoverageForFinding(finding, coverage);
    if (!findingCoverage) {
      continue;
    }

    finding.runtimeCoverage = findingCoverage;
    if (findingCoverage.status === "covered") {
      finding.status = "runtime-covered";
      coveredFindingCount += 1;
    } else {
      partiallyCoveredFindingCount += 1;
    }
  }

  return {
    coverage,
    coveredFindingCount,
    partiallyCoveredFindingCount,
  };
}

export function buildRuntimeExecutionCoverage(executionResults) {
  const fixtures = new Map();
  for (const artifact of executionResults?.artifacts ?? []) {
    if (artifact.kind !== "capture") {
      continue;
    }

    const fixture = String(artifact.fixture ?? "unknown");
    const fixtureCoverage = ensureFixtureCoverage(fixtures, fixture);
    if (artifact.artifactPath) {
      fixtureCoverage.artifacts.add(artifact.artifactPath);
    }

    for (const captured of normalizeCaptured(artifact.captured)) {
      fixtureCoverage.captured.add(captured);
    }
  }

  return {
    fixtures,
    artifactCount: [...fixtures.values()].reduce((sum, fixture) => sum + fixture.artifacts.size, 0),
  };
}

function runtimeCoverageForFinding(finding, coverage) {
  const fixtureCoverage = coverage.fixtures.get(finding.fixture);
  if (!fixtureCoverage || fixtureCoverage.captured.size === 0) {
    return null;
  }

  const expected = expectedRuntimeCaptureKeys(finding);
  if (expected.length === 0) {
    return null;
  }

  const captured = expected.filter((item) => fixtureCoverage.captured.has(item));
  if (captured.length === 0) {
    return null;
  }

  return {
    status: captured.length === expected.length ? "covered" : "partial",
    captured,
    expected,
    artifacts: [...fixtureCoverage.artifacts].sort(),
  };
}

function expectedRuntimeCaptureKeys(finding) {
  const names = evidenceNames(finding.evidence);
  if (finding.code === "registration-capture-gap") {
    return names.map((name) => `registration:${name}`);
  }
  if (finding.code === "runtime-tool-capture") {
    return ["registration:registerTool"];
  }
  if (finding.code === "conversation-access-hook") {
    return names.map((name) => `hook:${name}`);
  }
  return [];
}

function normalizeCaptured(captured) {
  return (captured ?? [])
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && item.kind && item.name) {
        return `${item.kind}:${item.name}`;
      }
      return "";
    })
    .filter(Boolean);
}

function evidenceNames(evidence) {
  return [
    ...new Set(
      (evidence ?? [])
        .map((item) => String(item).split(" @ ")[0]?.trim())
        .filter(Boolean),
    ),
  ];
}

function ensureFixtureCoverage(fixtures, fixture) {
  let fixtureCoverage = fixtures.get(fixture);
  if (!fixtureCoverage) {
    fixtureCoverage = {
      artifacts: new Set(),
      captured: new Set(),
    };
    fixtures.set(fixture, fixtureCoverage);
  }
  return fixtureCoverage;
}
