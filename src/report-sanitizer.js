import path from "node:path";

export function sanitizeReportArtifact(report, options = {}) {
  const sensitivePaths = sensitiveOpenClawPaths(report);
  if (sensitivePaths.length === 0) {
    return report;
  }
  const placeholder = options.openclawPathPlaceholder ?? "<OPENCLAW_PATH>";
  return sanitizeValue(report, sensitivePaths, placeholder);
}

function sensitiveOpenClawPaths(report) {
  const targetOpenClaw = report?.targetOpenClaw;
  return unique(
    [targetOpenClaw?.configuredPath, ...(targetOpenClaw?.searchedPaths ?? [])]
      .filter((value) => typeof value === "string" && isAbsolutePath(value))
      .sort((left, right) => right.length - left.length),
  );
}

function sanitizeValue(value, sensitivePaths, placeholder) {
  if (typeof value === "string") {
    return sensitivePaths.reduce((result, sensitivePath) => result.replaceAll(sensitivePath, placeholder), value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, sensitivePaths, placeholder));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, sanitizeValue(entryValue, sensitivePaths, placeholder)]),
    );
  }
  return value;
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
}

function unique(values) {
  return [...new Set(values)];
}
