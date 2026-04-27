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
  createCaptureApi,
  inspectFixtureSet,
  loadInspectorConfig,
  renderMarkdownReport,
  writeCiSummary,
  writeReport,
} from "@openclaw/plugin-inspector";

const config = await loadInspectorConfig("crabpot.config.json");
const report = await inspectFixtureSet(config);
await writeReport(report, { outDir: "reports" });

const summary = await buildCiSummary({ reportsDir: "reports" });
await writeCiSummary(summary);
```

## Scope

Default inspection is offline and credential-free. It reads manifests, package
metadata, and source files, then reports observed `api.on(...)`,
`api.register*`, `define*`, SDK imports, and manifest contracts.

Cold import, SDK mocking, synthetic contract probes, and live lanes will be
added behind explicit opt-in modes. Live checks must never run in default CI.
