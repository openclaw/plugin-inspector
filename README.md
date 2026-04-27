<img src="docs/plugin-inspector-banner.jpg" alt="openclaw plugin inspector banner"/>

# OpenClaw Plugin Inspector

`plugin-inspector` is the offline compatibility check for OpenClaw plugins. Run
it from a plugin root to inspect package metadata, `openclaw.plugin.json`, SDK
imports, `api.on(...)`, `api.register*`, and optional runtime registration
capture.

## Quick Start

From a plugin package directory:

```bash
npx @openclaw/plugin-inspector
```

That runs `check`, writes report artifacts to `reports/`, and exits non-zero
when compatibility breakages are found.

Add a local config and GitHub Actions workflow:

```bash
npx @openclaw/plugin-inspector init --ci
```

Or install it as a dev dependency:

```bash
npm install --save-dev @openclaw/plugin-inspector
npx plugin-inspector check
```

## Commands

```bash
npx @openclaw/plugin-inspector check
npx @openclaw/plugin-inspector check --plugin-root ./plugins/weather
npx @openclaw/plugin-inspector init --ci --package-manager pnpm
```

`check` reads the current directory as one plugin unless `--plugin-root` is set.
It writes:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`

Use `--no-openclaw` when CI should not compare against a local OpenClaw
checkout:

```bash
plugin-inspector check --no-openclaw
```

Use `plugin-inspector.config.json` when CI needs stable fixture metadata,
expected seams, or runtime capture defaults:

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
  "capture": {
    "mockSdk": true
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

`init --ci` writes this shape for you, plus
`.github/workflows/plugin-inspector.yml`. Copy-ready examples also live in
`examples/plugin-inspector.config.json` and
`examples/github-actions-plugin-inspector.yml`.

## Runtime Capture

Runtime capture imports plugin entrypoints in an isolated subprocess and records
the registrations made during `register(api)`. It is opt-in because it executes
plugin code:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 npx @openclaw/plugin-inspector check --runtime --mock-sdk
```

By default, runtime capture uses a generated mock for `openclaw/plugin-sdk` and
common external packages so plugin code can load in clean CI without OpenClaw
installed. Use `--real-sdk` only when the plugin workspace already has real SDK
dependencies installed and you intentionally want to test that path.

Runtime capture writes:

- `reports/plugin-inspector-runtime-capture.json`
- `reports/plugin-inspector-runtime-capture.md`

You can also capture one entrypoint directly:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector capture ./dist/index.js --mock-sdk
```

## CI

Minimal package scripts:

```json
{
  "scripts": {
    "plugin:check": "plugin-inspector check --no-openclaw",
    "plugin:check:runtime": "PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector check --no-openclaw --runtime --mock-sdk"
  }
}
```

GitHub Actions without a local dev dependency:

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
      - run: npx @openclaw/plugin-inspector check --no-openclaw
      - run: PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 npx @openclaw/plugin-inspector check --no-openclaw --runtime --mock-sdk
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
```

## Fixture Suites

Fixture-set configs are still supported for crabpot-style compatibility suites:

```bash
plugin-inspector report --config crabpot.config.json --out reports
```

Use fixture suites when one repo wants to inspect many plugins. Use plugin-root
`check` for normal plugin CI.

## Mocking Model

Default inspection is static, offline, and credential-free. Runtime capture is
the only mode that imports plugin code.

When `--mock-sdk` is enabled, the inspector generates temporary modules for
`openclaw/plugin-sdk` subpaths and unresolved external packages discovered in
the plugin import graph. The mock SDK captures registrations; it does not call
network services, launch OpenClaw, run provider SDKs, or emulate service
lifecycle side effects.

Use the mock lane for plugin compatibility CI. Keep live provider/service tests
in the plugin repo behind their own credentials and explicit opt-in flags.

## Scope

Default inspection is offline and credential-free. It reads manifests, package
metadata, and source files, then reports observed `api.on(...)`,
`api.register*`, `define*`, SDK imports, and manifest contracts.
OpenClaw target checkout parsing is limited to public compatibility registries,
SDK package exports, manifest types, hooks, and captured registrar metadata.

Cold import capture, synthetic contract probes, and runtime capture are explicit
opt-in modes. Live lanes stay credential-gated and must never run in default CI.
