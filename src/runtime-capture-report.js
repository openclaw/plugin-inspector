import path from "node:path";
import { renderMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { captureEntrypoint } from "./inspector.js";

export async function buildRuntimeCaptureReport(options = {}) {
  const report = options.report;
  if (!report) {
    throw new TypeError("buildRuntimeCaptureReport requires a compatibility report");
  }

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const results = [];
  for (const fixture of report.fixtures) {
    for (const target of captureTargets(fixture, rootDir)) {
      results.push(await captureTarget(target, options));
    }
  }

  return {
    generatedAt: options.generatedAt ?? report.generatedAt,
    mode: {
      mockSdk: options.mockSdk !== false,
      isolated: true,
    },
    summary: {
      targetCount: results.length,
      capturedCount: results.filter((result) => result.status === "captured").length,
      skippedCount: results.filter((result) => result.status.startsWith("skipped")).length,
      failedCount: results.filter((result) => result.status === "error").length,
      registrationCount: results.flatMap((result) => result.captured ?? []).filter((item) => item.kind === "registration")
        .length,
      hookCount: results.flatMap((result) => result.captured ?? []).filter((item) => item.kind === "hook").length,
    },
    results,
  };
}

export async function writeRuntimeCaptureReport(captureReport, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: options.jsonPath ?? path.join(process.cwd(), "reports/plugin-inspector-runtime-capture.json"),
    markdownPath: options.markdownPath ?? path.join(process.cwd(), "reports/plugin-inspector-runtime-capture.md"),
    json: captureReport,
    markdown: renderRuntimeCaptureMarkdown(captureReport, options),
  });
}

export function renderRuntimeCaptureMarkdown(captureReport, options = {}) {
  return [
    `# ${options.title ?? "Plugin Inspector Runtime Capture"}`,
    "",
    `Generated: ${captureReport.generatedAt}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Targets", captureReport.summary.targetCount],
        ["Captured", captureReport.summary.capturedCount],
        ["Skipped", captureReport.summary.skippedCount],
        ["Failed", captureReport.summary.failedCount],
        ["Registrations", captureReport.summary.registrationCount],
        ["Hooks", captureReport.summary.hookCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Entrypoints",
    "",
    markdownTable(
      captureReport.results.map((result) => [
        result.fixture,
        result.status,
        result.entrypoint,
        (result.captured ?? []).map((item) => `${item.kind}:${item.name}`).join(", ") || result.error || "-",
      ]),
      ["Fixture", "Status", "Entrypoint", "Captured"],
    ),
  ].join("\n");
}

function captureTargets(fixture, rootDir) {
  return fixture.packages.flatMap((packageSummary) => {
    const packageRoot = path.dirname(path.resolve(rootDir, packageSummary.path));
    return (packageSummary.openclaw?.entrypoints ?? []).map((entrypoint) => ({
      fixture: fixture.id,
      packagePath: packageSummary.path,
      packageRoot,
      entrypoint,
      entrypointPath: path.resolve(rootDir, entrypoint.relativePath),
      rootDir,
    }));
  });
}

async function captureTarget(target, options) {
  if (!target.entrypoint.exists) {
    return {
      fixture: target.fixture,
      status: "skipped-missing",
      packagePath: target.packagePath,
      entrypoint: target.entrypoint.relativePath,
      captured: [],
    };
  }

  try {
    const result = await captureEntrypoint(path.relative(target.rootDir, target.entrypointPath), {
      cwd: target.rootDir,
      pluginRoot: target.packageRoot,
      mockSdk: options.mockSdk !== false,
      apiOptions: options.apiOptions,
      env: options.env,
    });
    return {
      fixture: target.fixture,
      packagePath: target.packagePath,
      entrypoint: target.entrypoint.relativePath,
      ...result,
    };
  } catch (error) {
    return {
      fixture: target.fixture,
      status: "error",
      packagePath: target.packagePath,
      entrypoint: target.entrypoint.relativePath,
      error: error.message,
      captured: [],
    };
  }
}

function markdownTable(rows, headers) {
  return renderMarkdownTable(rows, headers);
}
