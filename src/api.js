import path from "node:path";
import { createCaptureApi } from "./capture-api.js";
import { loadInspectorConfig, loadPluginRootConfig } from "./config.js";
import { renderCompatibilityIssuesReport, renderCompatibilityMarkdownReport } from "./compatibility-report.js";
import { writePluginInspectorInit } from "./init.js";
import { captureEntrypoint } from "./inspector.js";
import { renderTextSummary, writeCompatibilityReport } from "./report.js";
import { writeCiOutputArtifacts } from "./ci-outputs.js";
import { buildRuntimeCaptureReport, writeRuntimeCaptureReport } from "./runtime-capture-report.js";
import { inspectCompatibilityFixtureSet, inspectFixtureSet } from "./inspector.js";
import {
  buildColdImportReadiness,
  renderColdImportReadinessMarkdown,
  validateColdImportReadiness,
  writeColdImportReadiness,
} from "./cold-import-readiness.js";

export async function loadPluginConfig(options = {}) {
  if (options.config) {
    return options.config;
  }
  const cwd = options.pluginRoot ?? options.cwd;
  if (options.configPath) {
    return options.fixtureSet === true
      ? loadInspectorConfig(options.configPath, { cwd })
      : loadPluginRootConfig(options.configPath, { cwd });
  }
  return loadPluginRootConfig(null, { cwd });
}

export async function inspectPluginRoot(options = {}) {
  const config = await loadPluginConfig(options);
  return inspectCompatibilityFixtureSet(config, {
    generatedAt: options.generatedAt,
    openclawPath: options.openclawPath,
    targetOpenClaw: options.targetOpenClaw,
  });
}

export async function inspectFixtureSetConfig(options = {}) {
  const config = options.config ?? (await loadInspectorConfig(options.configPath, { cwd: options.cwd }));
  return inspectFixtureSet(config, { generatedAt: options.generatedAt });
}

export async function inspectCompatibilityFixtureSetConfig(options = {}) {
  const config = await loadFixtureSetConfig(options);
  return inspectCompatibilityFixtureSet(config, {
    generatedAt: options.generatedAt,
    openclawPath: options.openclawPath,
    targetOpenClaw: options.targetOpenClaw,
  });
}

export async function writePluginReports(report, options = {}) {
  return writeCompatibilityReport(report, {
    basename: options.basename,
    check: options.check,
    cwd: options.cwd ?? options.pluginRoot,
    issuesBasename: options.issuesBasename,
    outDir: options.outDir,
  });
}

export async function writeFixtureSetReports(report, options = {}) {
  return writeCompatibilityReport(report, {
    basename: options.basename,
    check: options.check,
    cwd: options.cwd,
    formatEvidence: options.formatEvidence,
    issuesBasename: options.issuesBasename,
    issuesPath: options.issuesPath,
    issuesTitle: options.issuesTitle,
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    markdownTitle: options.markdownTitle,
    outDir: options.outDir,
    severityLabels: options.severityLabels,
    title: options.title,
  });
}

export function renderFixtureSetMarkdownReport(report, options = {}) {
  return renderCompatibilityMarkdownReport(report, options);
}

export function renderFixtureSetIssuesReport(report, options = {}) {
  return renderCompatibilityIssuesReport(report, options);
}

export async function runFixtureSetReport(options = {}) {
  const report = await inspectCompatibilityFixtureSetConfig(options);
  const paths = options.write === false ? null : await writeFixtureSetReports(report, options);
  return { report, paths };
}

export async function buildFixtureSetColdImportReadiness(options = {}) {
  const config = options.report ? null : await loadFixtureSetConfig(options);
  const report =
    options.report ??
    (await inspectCompatibilityFixtureSet(config, {
      generatedAt: options.generatedAt,
      openclawPath: options.openclawPath,
      targetOpenClaw: options.targetOpenClaw,
    }));

  return buildColdImportReadiness({
    ...options,
    report,
    rootDir: options.rootDir ?? config?.rootDir ?? options.cwd,
  });
}

export function renderFixtureSetColdImportReadinessMarkdown(readiness, options = {}) {
  return renderColdImportReadinessMarkdown(readiness, options);
}

export async function writeFixtureSetColdImportReadiness(readiness, options = {}) {
  return writeColdImportReadiness(readiness, options);
}

export async function runFixtureSetColdImportReadiness(options = {}) {
  const readiness = await buildFixtureSetColdImportReadiness(options);
  const paths = options.write === false ? null : await writeFixtureSetColdImportReadiness(readiness, options);
  return { readiness, paths };
}

export async function runPluginCheck(options = {}) {
  const outDir = options.outDir ?? "reports";
  const config = await loadPluginConfig(options);
  const report = await inspectPluginRoot({ ...options, config });
  const paths = await writePluginReports(report, { ...options, pluginRoot: config.rootDir, outDir });
  const result = { report, paths };
  const capture = options.capture ?? config.capture?.runtime ?? false;
  const mockSdk = options.mockSdk ?? config.capture?.mockSdk ?? true;

  if (capture === true) {
    if (!executionAllowed(options)) {
      throw new Error("runtime capture imports plugin code; rerun with PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 or --allow-execute in an isolated workspace");
    }
    const runtimeCapture = await buildRuntimeCaptureReport({
      mockSdk,
      report,
      rootDir: config.rootDir,
    });
    const runtimeCapturePaths = await writeRuntimeCaptureReport(runtimeCapture, {
      jsonPath: path.resolve(config.rootDir, outDir, "plugin-inspector-runtime-capture.json"),
      markdownPath: path.resolve(config.rootDir, outDir, "plugin-inspector-runtime-capture.md"),
    });
    result.runtimeCapture = runtimeCapture;
    result.runtimeCapturePaths = runtimeCapturePaths;
    if (runtimeCapture.summary.failedCount > 0) {
      throw new Error(`plugin-inspector runtime capture failed for ${runtimeCapture.summary.failedCount} entrypoints`);
    }
  }

  if (options.failOnBreakages === true && report.status !== "pass") {
    throw new Error(`plugin-inspector found ${report.summary.breakageCount} breakages`);
  }

  return result;
}

export async function capturePluginEntrypoint(entrypoint, options = {}) {
  return captureEntrypoint(entrypoint, options);
}

export async function setupPluginInspector(options = {}) {
  return writePluginInspectorInit(options);
}

export { createCaptureApi, renderTextSummary, validateColdImportReadiness, writeCiOutputArtifacts };

function executionAllowed(options) {
  return options.allowExecution === true || process.env.PLUGIN_INSPECTOR_EXECUTE_ISOLATED === "1";
}

async function loadFixtureSetConfig(options) {
  if (options.config) {
    return {
      ...options.config,
      rootDir: options.config.rootDir ?? options.rootDir ?? options.cwd ?? process.cwd(),
    };
  }
  return loadInspectorConfig(options.configPath, { cwd: options.cwd ?? options.rootDir });
}
