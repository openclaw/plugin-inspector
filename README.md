<img src="docs/plugin-inspector-banner.jpg" alt="openclaw plugin inspector banner"/>

# 💊 OpenClaw Plugin Inspector

`plugin-inspector` is the reusable OpenClaw plugin compatibility inspector. It
wraps the static inspection, registration capture, and report model prototyped
in crabpot into an npm-publishable package.

## Install

Install it as a dev dependency in a plugin repo:

```bash
npm install --save-dev @openclaw/plugin-inspector
```

Then run it from the plugin root:

```bash
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

## Scope

Default inspection is offline and credential-free. It reads manifests, package
metadata, and source files, then reports observed `api.on(...)`,
`api.register*`, `define*`, SDK imports, and manifest contracts.
OpenClaw target checkout parsing is limited to public compatibility registries,
SDK package exports, manifest types, hooks, and captured registrar metadata.

Cold import capture and synthetic contract probes are explicit opt-in modes.
Live lanes will stay credential-gated and must never run in default CI.
