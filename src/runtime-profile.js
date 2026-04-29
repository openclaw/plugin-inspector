import path from "node:path";
import { renderPaddedMarkdownTable, writeJsonMarkdownArtifacts } from "./artifacts.js";
import { resolveFromRoot } from "./path-utils.js";
import { runProfiledProcess } from "./process-profile.js";
import { assertRunCount, percentile } from "./stats.js";

export const defaultRuntimeProfileOptions = {
  generatedAt: "deterministic",
  jsonPath: "reports/plugin-runtime-profile.json",
  markdownPath: "reports/plugin-runtime-profile.md",
  reportTitle: "Plugin Runtime Profile",
  runs: 1,
};

export const defaultRuntimeProfileCommands = [
  {
    id: "node-boot",
    label: "Node boot",
    category: "baseline",
    args: ["-e", "0"],
    openclaw: false,
  },
];

export async function buildRuntimeProfile(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const generatedAt = options.generatedAt ?? defaultRuntimeProfileOptions.generatedAt;
  const runs = options.runs ?? defaultRuntimeProfileOptions.runs;
  const commands = [];
  assertRunCount(runs, 10);

  for (const command of options.commands ?? defaultRuntimeProfileCommands) {
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      samples.push(await profileCommand(command, { ...options, rootDir }));
    }
    commands.push(summarizeCommand(command, samples));
  }

  return {
    generatedAt,
    runs,
    targetOpenClaw: options.targetOpenClaw ?? summarizeTargetOpenClaw(options.report?.targetOpenClaw),
    fixtureInventory: options.fixtureInventory ?? summarizeFixtureInventory(options.report, options.inspection),
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      rssSampler: process.platform === "win32" ? "unavailable" : "ps-immediate-25ms",
      cpuSampler: process.platform === "win32" ? "unavailable" : "ps-percent-immediate-25ms",
    },
    summary: summarizeProfile(commands),
    groups: summarizeCommandGroups(commands),
    commands,
  };
}

export function validateRuntimeProfile(profile) {
  const errors = [];
  for (const command of profile.commands) {
    if (command.exitCodes.some((code) => code !== 0)) {
      errors.push(`${command.id}: nonzero exit code(s): ${command.exitCodes.join(", ")}`);
    }
    if (command.wallMs.max <= 0) {
      errors.push(`${command.id}: missing wall time`);
    }
  }
  if (profile.platform?.rssSampler !== "unavailable" && profile.commands.every((command) => !hasRssSample(command))) {
    errors.push("all commands are missing peak RSS samples");
  }
  return errors;
}

export async function writeRuntimeProfile(profile, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jsonPath = resolveFromRoot(rootDir, options.jsonPath ?? defaultRuntimeProfileOptions.jsonPath);
  const markdownPath = resolveFromRoot(rootDir, options.markdownPath ?? defaultRuntimeProfileOptions.markdownPath);
  return writeJsonMarkdownArtifacts({
    jsonPath,
    markdownPath,
    json: profile,
    markdown: renderRuntimeProfileMarkdown(profile, options),
    check: options.check,
  });
}

export function renderRuntimeProfileMarkdown(profile, options = {}) {
  const title = options.title ?? options.reportTitle ?? defaultRuntimeProfileOptions.reportTitle;
  return [
    `# ${title}`,
    "",
    `Generated: ${profile.generatedAt}`,
    `Samples per command: ${profile.runs}`,
    "",
    "## Summary",
    "",
    markdownTable(
      [
        ["Commands", profile.summary.commandCount],
        ["P50 wall time", `${profile.summary.p50WallMs} ms`],
        ["Command P95 wall time", `${profile.summary.p95WallMs} ms`],
        ["Wall time basis", profile.summary.wallTimeBasis ?? "command-median-p95"],
        ["Profile samples", profile.summary.sampleCount ?? sampleCount(profile.commands)],
        ["RSS samples", profile.summary.rssSampleCount ?? rssSampleCount(profile.commands)],
        ["CPU samples", profile.summary.cpuSampleCount ?? cpuSampleCount(profile.commands)],
        ["Max peak RSS", formatSampledMetric(profile.summary.maxPeakRssMb, profile.summary.rssSampleCount ?? rssSampleCount(profile.commands))],
        ["Max RSS delta", formatSampledMetric(profile.summary.maxRssDeltaMb, profile.summary.rssSampleCount ?? rssSampleCount(profile.commands))],
        [
          "Max CPU estimate",
          formatSampledMetric(profile.summary.maxCpuMsEstimate, profile.summary.cpuSampleCount ?? cpuSampleCount(profile.commands), "ms"),
        ],
        ["Max harness heap delta", `${profile.summary.maxHarnessHeapDeltaMb} MB`],
      ],
      ["Metric", "Value"],
    ),
    "",
    "## Target OpenClaw Registry Surface",
    "",
    markdownTable(
      Object.entries(profile.targetOpenClaw).map(([key, value]) => [key, value ?? "-"]),
      ["Metric", "Value"],
    ),
    "",
    "## Plugin Fixture Surface",
    "",
    markdownTable(
      Object.entries(profile.fixtureInventory).map(([key, value]) => [key, value]),
      ["Metric", "Value"],
    ),
    "",
    "## Boot And Memory Samples",
    "",
    markdownTable(
      profile.commands.map((command) => [
        command.id,
        command.label,
        `${command.wallMs.median} ms`,
        `${command.wallMs.max} ms`,
        formatSampledMetric(command.peakRssMb.max, command.rssSampleCount),
        formatSampledMetric(command.rssDeltaMb.max, command.rssSampleCount),
        formatSampledMetric(command.cpuMsEstimate.max, command.cpuSampleCount, "ms"),
        `${command.harnessHeapDeltaMb.max} MB`,
        `${command.rssSampleCount ?? 0}/${command.cpuSampleCount ?? 0}`,
        command.exitCodes.join(", "),
      ]),
      ["ID", "Label", "Median wall", "Max wall", "Max peak RSS", "Max RSS delta", "CPU estimate", "Heap delta", "RSS/CPU samples", "Exit codes"],
    ),
    "",
    "## Category Rollups",
    "",
    markdownTable(
      (profile.groups ?? []).map((group) => [
        group.category,
        group.commandCount,
        `${group.p50WallMs} ms`,
        `${group.p95WallMs} ms`,
        formatSampledMetric(group.maxPeakRssMb, group.rssSampleCount),
        formatSampledMetric(group.maxCpuMsEstimate, group.cpuSampleCount, "ms"),
        `${group.rssSampleCount ?? 0}/${group.cpuSampleCount ?? 0}`,
        group.commands.join(", "),
      ]),
      ["Category", "Commands", "P50 wall", "P95 wall", "Max peak RSS", "CPU estimate", "RSS/CPU samples", "Command IDs"],
    ),
  ].join("\n");
}

function summarizeTargetOpenClaw(targetOpenClaw = {}) {
  return {
    status: targetOpenClaw.status ?? "unknown",
    configuredPath: targetOpenClaw.configuredPath ?? null,
    compatRecords: targetOpenClaw.compatRecordCount ?? 0,
    hookNames: targetOpenClaw.hookNameCount ?? 0,
    apiRegistrars: targetOpenClaw.apiRegistrarCount ?? 0,
    capturedRegistrars: targetOpenClaw.capturedRegistrarCount ?? 0,
    sdkExports: targetOpenClaw.sdkExportCount ?? 0,
    manifestFields: targetOpenClaw.manifestFieldCount ?? 0,
    manifestContractFields: targetOpenClaw.manifestContractFieldCount ?? 0,
  };
}

function summarizeFixtureInventory(report = {}, inspection = {}) {
  const fixtures = report.fixtures ?? [];
  const inspections = inspection.inspections ?? [];
  return {
    fixtures: fixtures.length,
    sourceFiles: inspections.reduce((sum, item) => sum + item.sourceFiles.length, 0),
    observedHooks: fixtures.reduce((sum, item) => sum + item.hooks.length, 0),
    observedRegistrations: fixtures.reduce((sum, item) => sum + item.registrations.length, 0),
    observedSdkImports: fixtures.reduce((sum, item) => sum + item.sdkImports.length, 0),
    contractProbes: report.summary?.contractProbeCount ?? 0,
    issueFindings: report.summary?.issueCount ?? 0,
  };
}

function summarizeProfile(commands) {
  const wallTimes = commands.map((command) => command.wallMs.median).sort((left, right) => left - right);
  const maxPeakRssMb = Math.max(0, ...commands.map((command) => command.peakRssMb.max));
  const maxRssDeltaMb = Math.max(0, ...commands.map((command) => command.rssDeltaMb.max));
  const maxCpuMsEstimate = Math.max(0, ...commands.map((command) => command.cpuMsEstimate.max));
  const maxHarnessHeapDeltaMb = Math.max(0, ...commands.map((command) => command.harnessHeapDeltaMb.max));
  const totalSampleCount = sampleCount(commands);
  const totalRssSampleCount = rssSampleCount(commands);
  const totalCpuSampleCount = cpuSampleCount(commands);
  return {
    commandCount: commands.length,
    sampleCount: totalSampleCount,
    rssSampleCount: totalRssSampleCount,
    cpuSampleCount: totalCpuSampleCount,
    wallTimeBasis: "command-median-p95",
    p50WallMs: percentile(wallTimes, 0.5),
    p95WallMs: percentile(wallTimes, 0.95),
    maxPeakRssMb,
    maxRssDeltaMb,
    maxCpuMsEstimate,
    maxHarnessHeapDeltaMb,
  };
}

function summarizeCommand(command, samples) {
  const wallMs = samples.map((sample) => sample.wallMs).sort((left, right) => left - right);
  const peakRssMb = samples.map((sample) => sample.peakRssMb).sort((left, right) => left - right);
  const rssDeltaMb = samples.map((sample) => sample.rssDeltaMb).sort((left, right) => left - right);
  const peakCpuPercent = samples.map((sample) => sample.peakCpuPercent).sort((left, right) => left - right);
  const cpuMsEstimate = samples.map((sample) => sample.cpuMsEstimate).sort((left, right) => left - right);
  const statSampleCount = samples.reduce((sum, sample) => sum + (sample.statSampleCount ?? 0), 0);
  const rssSampleTotal = samples.reduce(
    (sum, sample) => sum + (sample.rssSampleCount ?? (sample.peakRssMb > 0 ? 1 : 0)),
    0,
  );
  const cpuSampleTotal = samples.reduce((sum, sample) => sum + (sample.cpuSampleCount ?? 0), 0);
  const harnessHeapDeltaMb = samples
    .map((sample) => sample.harnessHeapDeltaMb)
    .sort((left, right) => left - right);
  const commandName = command.command ?? process.execPath;
  return {
    id: command.id,
    label: command.label,
    category: command.category,
    command: [commandName, ...(command.args ?? [])].join(" "),
    samples,
    wallMs: summarizeNumbers(wallMs),
    peakRssMb: summarizeNumbers(peakRssMb),
    rssDeltaMb: summarizeNumbers(rssDeltaMb),
    peakCpuPercent: summarizeNumbers(peakCpuPercent),
    cpuMsEstimate: summarizeNumbers(cpuMsEstimate),
    harnessHeapDeltaMb: summarizeNumbers(harnessHeapDeltaMb),
    statSampleCount,
    rssSampleCount: rssSampleTotal,
    cpuSampleCount: cpuSampleTotal,
    exitCodes: [...new Set(samples.map((sample) => sample.exitCode))].sort(),
  };
}

function summarizeCommandGroups(commands) {
  const groups = new Map();
  for (const command of commands) {
    const category = command.category ?? "uncategorized";
    const existing = groups.get(category) ?? [];
    existing.push(command);
    groups.set(category, existing);
  }
  return [...groups.entries()].map(([category, categoryCommands]) => {
    const wallTimes = categoryCommands
      .flatMap((command) => command.samples.map((sample) => sample.wallMs))
      .sort((left, right) => left - right);
    const peakRss = categoryCommands
      .flatMap((command) => command.samples.map((sample) => sample.peakRssMb))
      .sort((left, right) => left - right);
    const cpuMs = categoryCommands
      .flatMap((command) => command.samples.map((sample) => sample.cpuMsEstimate))
      .sort((left, right) => left - right);
    const groupRssSampleCount = rssSampleCount(categoryCommands);
    const groupCpuSampleCount = cpuSampleCount(categoryCommands);
    return {
      category,
      commandCount: categoryCommands.length,
      p50WallMs: percentile(wallTimes, 0.5),
      p95WallMs: percentile(wallTimes, 0.95),
      maxPeakRssMb: peakRss.at(-1) ?? 0,
      maxCpuMsEstimate: cpuMs.at(-1) ?? 0,
      rssSampleCount: groupRssSampleCount,
      cpuSampleCount: groupCpuSampleCount,
      commands: categoryCommands.map((command) => command.id),
    };
  });
}

function hasRssSample(command) {
  return (command.rssSampleCount ?? (command.peakRssMb?.max > 0 ? 1 : 0)) > 0;
}

function sampleCount(commands) {
  return commands.reduce((sum, command) => sum + (command.samples?.length ?? 0), 0);
}

function rssSampleCount(commands) {
  return commands.reduce((sum, command) => sum + (command.rssSampleCount ?? (command.peakRssMb?.max > 0 ? 1 : 0)), 0);
}

function cpuSampleCount(commands) {
  return commands.reduce((sum, command) => sum + (command.cpuSampleCount ?? 0), 0);
}

function formatSampledMetric(value, count, unit = "MB") {
  if ((count ?? 0) <= 0) {
    return "n/a";
  }
  return `${value} ${unit}`;
}

function summarizeNumbers(values) {
  return {
    min: values[0],
    median: percentile(values, 0.5),
    max: values.at(-1),
  };
}

async function profileCommand(command, options) {
  const args = [...(command.args ?? [])];
  if (command.openclaw) {
    if (options.openclawPath === false) {
      args.push("--no-openclaw");
    } else if (options.openclawPath) {
      args.push("--openclaw", options.openclawPath);
    }
  }

  return runProfiledProcess({
    command: command.command ?? process.execPath,
    args,
    cwd: command.cwd ?? options.rootDir,
    env: { ...process.env, ...options.env, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
    roundAverageCpuPercent: true,
  });
}

function markdownTable(rows, headers) {
  return renderPaddedMarkdownTable(rows, headers);
}
