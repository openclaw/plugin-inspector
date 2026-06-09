import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { runPluginCheck } from "./api.js";

const ignoredDirs = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "reports",
  "dist",
  "build",
  ".plugin-inspector",
]);

export async function runBatchAnalysis(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? options.inputDir ?? process.cwd());
  const outDir = options.outDir ?? "reports";
  const outRoot = path.resolve(rootDir, outDir);
  const concurrency = Math.max(1, Math.min(Math.round(options.concurrency ?? 4), 32));
  const keepPluginReports = options.keepPluginReports === true;
  const pluginRoots = await discoverPluginRoots(rootDir);
  const tempRoot = keepPluginReports ? null : await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-batch-"));
  const entries = [];

  try {
    await runWithConcurrency(pluginRoots, concurrency, async (pluginRoot) => {
      const reportsRoot = keepPluginReports
        ? path.join(outRoot, "plugins", slugForPath(path.relative(rootDir, pluginRoot)))
        : path.join(tempRoot, slugForPath(path.relative(rootDir, pluginRoot)));
      entries.push(
        await inspectBatchPlugin(pluginRoot, {
          ...options,
          rootDir,
          outDir: reportsRoot,
          openclawPath: options.openclawPath,
        }),
      );
    });
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const report = buildBatchReport({
    rootDir,
    entries,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });
  const paths = await writeBatchReport(report, { outDir: outRoot, check: options.checkArtifacts });
  return { report, paths };
}

export async function discoverPluginRoots(rootDir) {
  const roots = [];
  await walk(path.resolve(rootDir));
  roots.sort();
  return roots;

  async function walk(dir) {
    if (await isPluginRoot(dir)) {
      roots.push(dir);
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) continue;
      await walk(path.join(dir, entry.name));
    }
  }
}

export async function writeBatchReport(report, options = {}) {
  return writeJsonMarkdownArtifacts({
    jsonPath: path.join(options.outDir ?? "reports", "plugin-inspector-batch-report.json"),
    markdownPath: path.join(options.outDir ?? "reports", "plugin-inspector-batch-report.md"),
    json: report,
    markdown: renderBatchMarkdown(report),
    check: options.check,
  });
}

function buildBatchReport({ rootDir, entries, generatedAt }) {
  const findingFrequency = findingFrequencyRows(entries);
  const summary = {
    pluginCount: entries.length,
    passed: entries.filter((entry) => entry.status === "pass").length,
    failed: entries.filter((entry) => entry.status !== "pass").length,
    pluginsWithErrors: entries.filter((entry) => entry.errorCount > 0).length,
    pluginsWithWarnings: entries.filter((entry) => entry.warningCount > 0).length,
    errorCount: entries.reduce((sum, entry) => sum + entry.errorCount, 0),
    warningCount: entries.reduce((sum, entry) => sum + entry.warningCount, 0),
    findingCodeCount: findingFrequency.length,
  };
  return {
    generatedAt,
    rootDir,
    summary,
    findingFrequency,
    plugins: entries,
  };
}

async function inspectBatchPlugin(pluginRoot, options) {
  try {
    const { report } = await runPluginCheck({
      allowExecution: options.allowExecution,
      capture: options.capture,
      configPath: options.configPath,
      mockSdk: options.mockSdk,
      openclawPath: options.openclawPath,
      outDir: options.outDir,
      pluginRoot,
    });
    const findings = normalizeReportFindings(report);
    return {
      pluginRoot,
      relativePath: path.relative(options.rootDir ?? process.cwd(), pluginRoot) || ".",
      status: report.status,
      packageName: packageNameFromReport(report),
      targetOpenClaw: report.targetOpenClaw,
      errorCount: findings.filter((finding) => finding.kind === "error").length,
      warningCount: findings.filter((finding) => finding.kind === "warning").length,
      findings,
    };
  } catch (error) {
    return {
      pluginRoot,
      relativePath: path.relative(options.rootDir ?? process.cwd(), pluginRoot) || ".",
      status: "error",
      packageName: path.basename(pluginRoot),
      targetOpenClaw: null,
      errorCount: 1,
      warningCount: 0,
      findings: [
        {
          kind: "error",
          code: "plugin-inspector-batch-failure",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function normalizeReportFindings(report) {
  return [
    ...(report.breakages ?? []).map((finding) => normalizeFinding(finding, "error")),
    ...(report.issues ?? []).map((finding) =>
      normalizeFinding(
        finding,
        finding.status === "blocking" || finding.severity === "P0" ? "error" : "warning",
      ),
    ),
    ...(report.warnings ?? []).map((finding) => normalizeFinding(finding, "warning")),
    ...(report.suggestions ?? []).map((finding) => normalizeFinding(finding, "warning")),
  ];
}

function normalizeFinding(finding, kind) {
  return {
    kind,
    code: finding.code ?? "plugin-inspector-finding",
    severity: finding.severity,
    issueClass: finding.issueClass,
    message: finding.message ?? finding.title ?? "See plugin report.",
    evidence: finding.evidence,
  };
}

function findingFrequencyRows(entries) {
  const byCode = new Map();
  for (const entry of entries) {
    const seenForPlugin = new Set();
    for (const finding of entry.findings) {
      const current = byCode.get(finding.code) ?? {
        code: finding.code,
        count: 0,
        plugins: 0,
        errors: 0,
        warnings: 0,
      };
      current.count += 1;
      if (!seenForPlugin.has(finding.code)) {
        current.plugins += 1;
        seenForPlugin.add(finding.code);
      }
      if (finding.kind === "error") current.errors += 1;
      else current.warnings += 1;
      byCode.set(finding.code, current);
    }
  }
  return [...byCode.values()].sort((a, b) => b.plugins - a.plugins || b.count - a.count);
}

function renderBatchMarkdown(report) {
  return [
    "# Plugin Inspector Batch Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Root: ${report.rootDir}`,
    "",
    "## Summary",
    "",
    renderMarkdownTable(
      [
        ["Plugins", report.summary.pluginCount],
        ["Passed", report.summary.passed],
        ["Failed", report.summary.failed],
        ["Plugins with errors", report.summary.pluginsWithErrors],
        ["Plugins with warnings", report.summary.pluginsWithWarnings],
        ["Errors", report.summary.errorCount],
        ["Warnings", report.summary.warningCount],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Finding Frequency",
    "",
    report.findingFrequency.length
      ? renderMarkdownTable(
          report.findingFrequency.map((row) => [
            row.code,
            row.plugins,
            row.count,
            row.errors,
            row.warnings,
          ]),
          ["Code", "Plugins", "Findings", "Errors", "Warnings"],
        )
      : "_No findings._",
    "",
    "## Plugins",
    "",
    report.plugins.length
      ? renderMarkdownTable(
          report.plugins.map((plugin) => [
            plugin.packageName,
            plugin.relativePath,
            plugin.status,
            plugin.errorCount,
            plugin.warningCount,
          ]),
          ["Package", "Path", "Status", "Errors", "Warnings"],
        )
      : "_No plugin roots discovered._",
  ].join("\n");
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function isPluginRoot(dir) {
  if (existsSync(path.join(dir, "plugin-inspector.config.json"))) return true;
  if (existsSync(path.join(dir, ".plugin-inspector.json"))) return true;
  if (existsSync(path.join(dir, "openclaw.plugin.json"))) return true;
  const packageJsonPath = path.join(dir, "package.json");
  if (!existsSync(packageJsonPath)) return false;
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return Boolean(packageJson.openclaw || packageJson.pluginInspector || packageJson["plugin-inspector"]);
  } catch {
    return false;
  }
}

function packageNameFromReport(report) {
  return (
    report.fixtures?.[0]?.package?.packageJson?.name ??
    report.fixtures?.[0]?.package?.name ??
    report.fixtures?.[0]?.name ??
    report.fixtures?.[0]?.id ??
    "plugin"
  );
}

function slugForPath(value) {
  return (
    String(value)
      .replaceAll(path.sep, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plugin"
  );
}
