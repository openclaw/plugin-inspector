# plugin-inspector

`plugin-inspector` is the reusable OpenClaw plugin compatibility inspector. It
wraps the static inspection, registration capture, and report model prototyped
in crabpot into an npm-publishable package.

No npm package has been published yet.

## Install

During development, use a local checkout or packed tarball:

```bash
npm install --save-dev ../plugin-inspector
```

Future package name:

```bash
npm install --save-dev @openclaw/plugin-inspector
```

## CLI

Inspect a crabpot-compatible fixture config:

```bash
plugin-inspector report --config crabpot.config.json --out reports
```

Fail if expected hooks, registrations, or manifest contracts are missing:

```bash
plugin-inspector ci --config crabpot.config.json --out reports --check
```

Capture a plugin entrypoint in an explicitly isolated execution lane:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector capture ./dist/index.js
```

## API

```js
import {
  buildCiSummary,
  buildColdImportReadiness,
  buildContractCapture,
  buildExecutionResultsReport,
  buildImportLoopProfile,
  buildPlatformProbes,
  buildProfileDiff,
  buildRuntimeProfile,
  buildWorkspacePlan,
  createCaptureApi,
  inspectFixtureSet,
  loadInspectorConfig,
  readOpenClawTargetSurface,
  renderColdImportReadinessMarkdown,
  renderContractCaptureMarkdown,
  renderExecutionResultsMarkdown,
  renderImportLoopProfileMarkdown,
  renderPlatformProbesMarkdown,
  renderProfileDiffMarkdown,
  renderRuntimeProfileMarkdown,
  renderWorkspacePlanMarkdown,
  renderMarkdownReport,
  validateContractCoverage,
  validateRuntimeProfile,
  writeCiSummary,
  writeColdImportReadiness,
  writeContractCapture,
  writeExecutionResultsReport,
  writeImportLoopProfile,
  writePlatformProbes,
  writeProfileDiff,
  writeRuntimeProfile,
  writeWorkspacePlan,
  writeReport,
} from "@openclaw/plugin-inspector";

const config = await loadInspectorConfig("crabpot.config.json");
const report = await inspectFixtureSet(config);
await writeReport(report, { outDir: "reports" });

const summary = await buildCiSummary({ reportsDir: "reports" });
await writeCiSummary(summary);

const capture = buildContractCapture({ report });
await writeContractCapture(capture);
const coverageErrors = validateContractCoverage(report);

const readiness = buildColdImportReadiness({ report });
await writeColdImportReadiness(readiness);

const target = await readOpenClawTargetSurface({ manifest: config });

const workspacePlan = await buildWorkspacePlan({ report, readiness });
await writeWorkspacePlan(workspacePlan);

const platformProbes = buildPlatformProbes({ plan: workspacePlan });
await writePlatformProbes(platformProbes);

const executionResults = await buildExecutionResultsReport({ resultsDir: ".plugin-inspector/results" });
await writeExecutionResultsReport(executionResults);

const importLoop = await buildImportLoopProfile({ entrypoint: "dist/index.js", runs: 3 });
await writeImportLoopProfile(importLoop);

const runtimeProfile = await buildRuntimeProfile({ report, inspection, runs: 1 });
await writeRuntimeProfile(runtimeProfile);

const profileDiff = await buildProfileDiff({ current, baseline, policy });
await writeProfileDiff(profileDiff);
```

## Scope

Default inspection is offline and credential-free. It reads manifests, package
metadata, and source files, then reports observed `api.on(...)`,
`api.register*`, `define*`, SDK imports, and manifest contracts.
OpenClaw target checkout parsing is limited to public compatibility registries,
SDK package exports, manifest types, hooks, and captured registrar metadata.

Cold import capture and synthetic contract probes are explicit opt-in modes.
Live lanes will stay credential-gated and must never run in default CI.
