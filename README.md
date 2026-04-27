<img src="docs/plugin-inspector-banner.jpg" alt="openclaw plugin inspector banner"/>

# 💊 OpenClaw Plugin Inspector

`plugin-inspector` is the reusable OpenClaw plugin compatibility inspector. It
wraps the static inspection, registration capture, and report model prototyped
in crabpot into an npm-publishable package.

No npm package has been published yet.

## Install

During development, use a local checkout or packed tarball:

```bash
npm install --save-dev ../plugin-inspector
npx plugin-inspector check --no-openclaw
```

After the package is published, plugin repos should install it as a dev
dependency and run it from the plugin root:

```bash
npm install --save-dev @openclaw/plugin-inspector
npx @openclaw/plugin-inspector check
```

## CLI

Run the default plugin-root check from a plugin package directory:

```bash
plugin-inspector check
```

That command reads the current directory as one plugin, inspects package
metadata, `openclaw.plugin.json`, source imports, `api.on(...)`,
`api.register*`, and writes:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`

Use `--no-openclaw` when CI should not compare against a local OpenClaw
checkout:

```bash
plugin-inspector check --no-openclaw
```

Use a simple plugin-root config when you want stable fixture metadata or
expected seams:

```json
{
  "version": 1,
  "plugin": {
    "id": "weather",
    "priority": "high",
    "seams": ["dynamic-tool"],
    "sourceRoot": "src",
    "expect": {
      "registrations": ["registerTool"]
    }
  },
  "openclaw": {
    "defaultCheckoutPath": "../openclaw"
  }
}
```

Then run:

```bash
plugin-inspector check --config plugin-inspector.config.json
```

Copy-ready examples live in `examples/plugin-inspector.config.json` and
`examples/github-actions-plugin-inspector.yml`.

Fixture-set configs are still supported for crabpot-style compatibility suites:

```bash
plugin-inspector report --config crabpot.config.json --out reports
```

Capture a plugin entrypoint in an explicitly isolated execution lane:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector capture ./dist/index.js --mock-sdk
```

Run the optional runtime capture smoke during `check`:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector check --no-openclaw --capture
```

Runtime capture creates a temporary mock `openclaw/plugin-sdk` package, imports
declared OpenClaw package entrypoints, calls their `register(api)` function with
the capture API, and writes:

- `reports/plugin-inspector-runtime-capture.json`
- `reports/plugin-inspector-runtime-capture.md`

### CI

With a dev dependency:

```json
{
  "scripts": {
    "plugin:check": "plugin-inspector check --no-openclaw",
    "plugin:check:runtime": "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector check --no-openclaw --capture"
  }
}
```

GitHub Actions:

```yaml
name: plugin-inspector

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run plugin:check
      - run: npm run plugin:check:runtime
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
```

## API

```js
import {
  buildCiSummary,
  buildCiPolicyReport,
  buildColdImportReadiness,
  buildContractCapture,
  buildExecutionResultsReport,
  buildImportLoopProfile,
  buildPlatformProbes,
  buildProfileDiff,
  buildRefDiff,
  buildRuntimeProfile,
  buildRuntimeCaptureReport,
  buildWorkspacePlan,
  createCaptureApi,
  inspectFixtureSet,
  loadInspectorConfig,
  readOpenClawTargetSurface,
  renderCiPolicyMarkdown,
  renderColdImportReadinessMarkdown,
  renderContractCaptureMarkdown,
  renderExecutionResultsMarkdown,
  renderImportLoopProfileMarkdown,
  renderPlatformProbesMarkdown,
  renderProfileDiffMarkdown,
  renderRefDiffMarkdown,
  renderRuntimeProfileMarkdown,
  renderRuntimeCaptureMarkdown,
  renderWorkspacePlanMarkdown,
  renderMarkdownReport,
  validateCiPolicyReport,
  validateContractCoverage,
  writeCiSummary,
  writeCiPolicyReport,
  writeColdImportReadiness,
  writeContractCapture,
  writeExecutionResultsReport,
  writeImportLoopProfile,
  writePlatformProbes,
  writeProfileDiff,
  writeRefDiff,
  writeRuntimeProfile,
  writeRuntimeCaptureReport,
  writeWorkspacePlan,
  writeReport,
} from "@openclaw/plugin-inspector";

const config = await loadInspectorConfig("crabpot.config.json");
const report = await inspectFixtureSet(config);
await writeReport(report, { outDir: "reports" });

const summary = await buildCiSummary({ reportsDir: "reports" });
await writeCiSummary(summary);

const policyReport = buildCiPolicyReport({ policy, compatibilityReport: report });
await writeCiPolicyReport(policyReport);

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

const runtimeProfile = await buildRuntimeProfile({
  commands: [{ id: "node-boot", label: "Node boot", category: "baseline", args: ["-e", "0"] }],
});
await writeRuntimeProfile(runtimeProfile);

const runtimeCapture = await buildRuntimeCaptureReport({ report, rootDir: process.cwd() });
await writeRuntimeCaptureReport(runtimeCapture);

const refDiff = await buildRefDiff({ baseReport, headReport });
await writeRefDiff(refDiff);

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
