#!/usr/bin/env node
// Measures the publish-time inspection path that ClawHub runs in a 512 MiB
// Node action: read a packed OpenClaw target (package.json + dist/**/*.d.ts,
// including SDK retirement qualification), then run the author-facing
// pluginRoot.runCheck against one unpacked plugin package. Every measured run
// is a fresh child process, so peak RSS (getrusage maxrss, which also sees
// synchronous compiler work no sampling timer could) covers exactly one cold
// publish, like a cold Convex action.
//
// With --baseline, the same inputs are measured against another inspector
// build (for example an installed @openclaw/plugin-inspector@0.4.5), outputs
// are compared, and --max-ratio turns the comparison into a gate.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const MiB = 1024 * 1024;
const FIXED_GENERATED_AT = "2026-01-01T00:00:00.000Z";

const { values } = parseArgs({
  options: {
    child: { type: "boolean" },
    target: { type: "string" },
    plugin: { type: "string", multiple: true },
    inspector: { type: "string" },
    baseline: { type: "string" },
    runs: { type: "string" },
    "max-old-space-size": { type: "string" },
    "uncached-target": { type: "boolean" },
    "max-ratio": { type: "string" },
    "budget-mib": { type: "string" },
    "outputs-dir": { type: "string" },
    diagnose: { type: "boolean" },
    json: { type: "string" },
    help: { type: "boolean" },
  },
});

const usage = `Usage: node scripts/publish-memory-benchmark.mjs --target <packed-openclaw-dir> --plugin <name>=<package-dir> [--plugin ...]
  [--inspector <src/index.js>] [--baseline <src/index.js>] [--runs 3] [--max-old-space-size <MiB>]
  [--uncached-target] [--max-ratio <0..1>] [--budget-mib <MiB>] [--outputs-dir <dir>] [--json <file>]

--target           Directory holding the packed openclaw package.json and dist/**/*.d.ts.
--plugin           Package name and unpacked plugin package root (ClawPack or npm tarball).
--inspector        Inspector entry to measure (default: this checkout's src/index.js).
--baseline         Another inspector entry to measure on the same inputs. Outputs
                   (target surface and findings) must be identical to the candidate's.
--max-ratio        Fail when a plugin's median candidate peak RSS exceeds this
                   fraction of its median baseline peak RSS. Requires --baseline.
--budget-mib       Fail when a plugin's median candidate peak RSS exceeds this many MiB.
--uncached-target  Append a comment to one declaration file of a copy of the target,
                   so its snapshot misses the shipped qualification table and the
                   on-demand type check runs (outputs stay identical).
--outputs-dir      Write each implementation's normalized target surface and findings.
--diagnose         Sample memory between awaits and print what the largest samples before
                   and after TypeScript loads were made of (heap, young generation,
                   external, other).`;

if (values.help) console.log(usage);
else if (values.child) await runChild();
else await runParent();

async function runParent() {
  if (!values.target || !values.plugin?.length || (values["max-ratio"] && !values.baseline)) {
    console.error(usage);
    process.exit(2);
  }
  const runs = Number(values.runs ?? 3);
  let target = path.resolve(values.target);
  const scratch = await mkdtemp(path.join(tmpdir(), "plugin-inspector-publish-memory-"));
  try {
    if (values["uncached-target"]) target = await uncachedCopy(target, scratch);
    const implementations = [["candidate", path.resolve(values.inspector ?? path.join(repositoryRoot, "src/index.js"))]];
    if (values.baseline) implementations.unshift(["baseline", path.resolve(values.baseline)]);
    const plugins = values.plugin.map((spec) => {
      const separator = spec.indexOf("=");
      if (separator < 1) throw new Error(`--plugin expects <name>=<dir>, got ${spec}`);
      return { name: spec.slice(0, separator), dir: path.resolve(spec.slice(separator + 1)) };
    });
    const results = [];
    for (const plugin of plugins) {
      const row = { plugin: plugin.name };
      for (const [label, inspector] of implementations) {
        const samples = [];
        for (let run = 0; run < runs; run += 1) {
          samples.push(await measureOnce({ plugin, target, inspector, scratch, outputs: run === 0 && values["outputs-dir"] ? path.resolve(values["outputs-dir"], label, plugin.name) : "" }));
        }
        row[label] = summarize(samples);
      }
      if (row.baseline) {
        row.ratio = Math.round((row.candidate.peakRssMiB / row.baseline.peakRssMiB) * 1000) / 1000;
        row.identicalOutputs = row.candidate.targetSurfaceSha256 === row.baseline.targetSurfaceSha256
          && row.candidate.findingsSha256 === row.baseline.findingsSha256;
      }
      results.push(row);
    }
    const summary = {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      maxOldSpaceSizeMiB: values["max-old-space-size"] ? Number(values["max-old-space-size"]) : null,
      uncachedTarget: Boolean(values["uncached-target"]),
      implementations: Object.fromEntries(implementations.map(([label, inspector]) => [label, path.relative(process.cwd(), inspector) || inspector])),
      results,
    };
    if (values.json) await writeFile(path.resolve(values.json), `${JSON.stringify(summary, null, 2)}\n`);
    printSummary(summary);
    const failures = [];
    for (const row of results) {
      if (row.baseline && !row.identicalOutputs) failures.push(`${row.plugin}: target surface or findings differ from the baseline`);
      if (values["max-ratio"] && row.ratio > Number(values["max-ratio"])) {
        failures.push(`${row.plugin}: peak RSS ${row.candidate.peakRssMiB} MiB is ${row.ratio} of the baseline's ${row.baseline.peakRssMiB} MiB (limit ${values["max-ratio"]})`);
      }
      if (values["budget-mib"] && row.candidate.peakRssMiB > Number(values["budget-mib"])) {
        failures.push(`${row.plugin}: peak RSS ${row.candidate.peakRssMiB} MiB exceeds the ${values["budget-mib"]} MiB budget`);
      }
    }
    if (failures.length) {
      console.error(`Publish-time inspection memory check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
      process.exitCode = 1;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left.peakRssBytes - right.peakRssBytes);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    runs: samples.length,
    peakRssMiB: round(median.peakRssBytes / MiB),
    peakRssMiBRange: [round(sorted[0].peakRssBytes / MiB), round(sorted.at(-1).peakRssBytes / MiB)],
    afterTargetPeakRssMiB: round(median.stages.target.peakRssBytes / MiB),
    targetMs: Math.round(median.stages.target.ms),
    inspectionMs: Math.round(median.stages.inspection.ms),
    totalMs: Math.round(median.totalMs),
    compatDeprecations: median.compatDeprecationCount,
    findings: median.findingCount,
    targetSurfaceSha256: median.targetSurfaceSha256,
    findingsSha256: median.findingsSha256,
    ...(median.sampledPeak ? { sampledPeak: median.sampledPeak } : {}),
  };
}

function printSummary(summary) {
  console.log(`node ${summary.node} ${summary.platform}; --max-old-space-size=${summary.maxOldSpaceSizeMiB ?? "unset"}; target ${summary.uncachedTarget ? "outside" : "as given to"} the qualification table`);
  for (const [label, inspector] of Object.entries(summary.implementations)) console.log(`${label}: ${inspector}`);
  const rows = [];
  for (const row of summary.results) {
    for (const label of Object.keys(summary.implementations)) {
      const result = row[label];
      rows.push({
        plugin: row.plugin,
        inspector: label,
        "peak RSS MiB (median)": result.peakRssMiB,
        range: result.peakRssMiBRange.join("–"),
        "after target MiB": result.afterTargetPeakRssMiB,
        "target ms": result.targetMs,
        "inspection ms": result.inspectionMs,
        "retirement records": result.compatDeprecations,
        findings: result.findings,
        outputs: `${result.targetSurfaceSha256.slice(0, 10)}/${result.findingsSha256.slice(0, 10)}`,
        "vs baseline": label === "candidate" && row.ratio !== undefined ? `${Math.round(row.ratio * 1000) / 10}%` : "",
      });
    }
  }
  console.table(rows);
  const samples = [];
  for (const row of summary.results) {
    for (const label of Object.keys(summary.implementations)) {
      for (const [phase, sample] of Object.entries(row[label].sampledPeak ?? {})) {
        samples.push({ plugin: row.plugin, inspector: label, phase, ...sample });
      }
    }
  }
  if (samples.length) {
    console.log("Largest sampled RSS between awaits (MiB):");
    console.table(samples);
  }
}

async function uncachedCopy(target, scratch) {
  const copy = path.join(scratch, "uncached-target", "package");
  await cp(target, copy, { recursive: true });
  const declaration = (await readdir(path.join(copy, "dist"))).filter((name) => name.endsWith(".d.ts")).sort()[0];
  await appendFile(path.join(copy, "dist", declaration), "\n// plugin-inspector publish-memory benchmark: not a shipped snapshot\n");
  return copy;
}

async function measureOnce({ plugin, target, inspector, scratch, outputs }) {
  const workspace = await mkdtemp(path.join(scratch, "run-"));
  try {
    // Like ClawHub, inspect a disposable copy so report writes never touch the input.
    const root = path.join(workspace, "package");
    await cp(plugin.dir, root, { recursive: true });
    const resultPath = path.join(workspace, "result.json");
    const nodeArgs = values["max-old-space-size"] ? [`--max-old-space-size=${values["max-old-space-size"]}`] : [];
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        ...nodeArgs,
        "--no-warnings",
        fileURLToPath(import.meta.url),
        "--child",
        "--target", target,
        "--plugin", `${plugin.name}=${root}`,
        "--inspector", inspector,
        "--json", resultPath,
        ...(outputs ? ["--outputs-dir", outputs] : []),
        ...(values.diagnose ? ["--diagnose"] : []),
      ], { stdio: ["ignore", "inherit", "inherit"] });
      child.on("error", reject);
      child.on("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${plugin.name} benchmark child exited with ${signal ?? code}`))));
    });
    return JSON.parse(await readFile(resultPath, "utf8"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runChild() {
  const started = performance.now();
  const [spec] = values.plugin;
  const separator = spec.indexOf("=");
  const packageName = spec.slice(0, separator);
  const root = spec.slice(separator + 1);
  const target = values.target;
  const stages = {};
  let sampled = null;
  let sampler;
  if (values.diagnose) {
    const { createRequire } = await import("node:module");
    const cache = createRequire(import.meta.url).cache;
    const v8 = await import("node:v8");
    sampler = setInterval(() => {
      const usage = process.memoryUsage();
      const typescriptLoaded = Object.keys(cache).some((key) => /[\\/]typescript[\\/]lib[\\/]typescript\.js$/.test(key));
      const key = typescriptLoaded ? "withTypeScript" : "withoutTypeScript";
      if (sampled?.[key] && usage.rss <= sampled[key].rss * MiB) return;
      const space = (name) => round((v8.getHeapSpaceStatistics().find((item) => item.space_name === name)?.space_size ?? 0) / MiB);
      sampled = {
        ...sampled,
        [key]: {
          rss: round(usage.rss / MiB),
          heapTotal: round(usage.heapTotal / MiB),
          heapUsed: round(usage.heapUsed / MiB),
          newSpace: space("new_space"),
          external: round(usage.external / MiB),
          other: round((usage.rss - usage.heapTotal - usage.external) / MiB),
        },
      };
    }, 2);
  }
  const mark = (stage, since) => {
    stages[stage] = { ms: performance.now() - since, peakRssBytes: peakRssBytes() };
  };

  let since = performance.now();
  await writeSyntheticConfig(root, packageName);
  const { openClawTargets, pluginRoot, reports } = await import(pathToFileURL(values.inspector).href);
  mark("import", since);

  // Mirrors ClawHub prepareOpenClawInspectorTarget: read the packed surface,
  // then decorate it with the resolved npm identity.
  since = performance.now();
  const surface = await reports.readOpenClawTargetSurface({ rootDir: target, configuredPath: "." });
  if (surface.status !== "ok") throw new Error(`packed OpenClaw target is not readable: ${surface.status}`);
  const version = surface.version;
  const targetOpenClaw = {
    ...surface,
    configuredPath: `npm:openclaw@${version}`,
    searchedPaths: [`npm:openclaw@${version}`],
    requestedVersion: "latest",
    version,
    eligibilityVersion: openClawTargets.eligibilityVersion(version),
    source: { type: "npm", package: "openclaw", registry: "https://registry.npmjs.org", distTag: "latest" },
    cache: { hit: true, key: `${version}-benchmark` },
  };
  mark("target", since);

  // Mirrors ClawHub buildPublishInspectorRunCheckOptions.
  since = performance.now();
  const { report } = await pluginRoot.runCheck({
    pluginRoot: root,
    openclawPath: false,
    targetOpenClaw,
    outDir: "reports",
    capture: false,
    mockSdk: true,
    allowExecution: false,
    authorFacing: true,
    generatedAt: FIXED_GENERATED_AT,
  });
  mark("inspection", since);
  if (sampler) clearInterval(sampler);

  const normalize = (value) => JSON.parse(JSON.stringify(value).replaceAll(path.resolve(target), "<target>").replaceAll(root, "<plugin>"));
  const normalizedSurface = normalize(surface);
  const findings = normalize({
    status: report.status,
    summary: report.summary,
    breakages: report.breakages,
    warnings: report.warnings,
    issues: report.issues,
  });
  if (values["outputs-dir"]) {
    await mkdir(values["outputs-dir"], { recursive: true });
    await writeFile(path.join(values["outputs-dir"], "target-surface.json"), `${JSON.stringify(normalizedSurface, null, 2)}\n`);
    await writeFile(path.join(values["outputs-dir"], "findings.json"), `${JSON.stringify(findings, null, 2)}\n`);
  }
  await writeFile(values.json, JSON.stringify({
    peakRssBytes: peakRssBytes(),
    totalMs: performance.now() - started,
    stages,
    compatDeprecationCount: surface.compatDeprecations.length,
    findingCount: (report.breakages?.length ?? 0) + (report.warnings?.length ?? 0),
    targetSurfaceSha256: sha256(JSON.stringify(normalizedSurface)),
    findingsSha256: sha256(JSON.stringify(findings)),
    ...(sampled ? { sampledPeak: sampled } : {}),
  }));
}

// ClawHub writes this when the package has no inspector config of its own.
async function writeSyntheticConfig(root, packageName) {
  if (existsSync(path.join(root, "plugin-inspector.config.json")) || existsSync(path.join(root, ".plugin-inspector.json"))) return;
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (isObject(packageJson.pluginInspector) || isObject(packageJson["plugin-inspector"])) return;
  const id = packageName.split("/").pop().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "published-plugin";
  await writeFile(path.join(root, ".plugin-inspector.json"), `${JSON.stringify({ version: 1, plugin: { id } }, null, 2)}\n`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function peakRssBytes() {
  return process.resourceUsage().maxRSS * 1024;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
