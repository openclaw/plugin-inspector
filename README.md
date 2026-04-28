# OpenClaw Plugin Inspector

`@openclaw/plugin-inspector` checks an OpenClaw plugin package before it reaches
users. It is meant to answer practical compatibility questions:

- Can OpenClaw discover this plugin package and manifest?
- Which SDK imports, hooks, and registration calls does the plugin use?
- Will the plugin still load in clean CI without local OpenClaw internals?
- What report artifacts should CI upload when compatibility breaks?

The default check is static, offline, and credential-free. Runtime capture is
available, but it is always explicit because it imports plugin code.

## When To Use It

Use the plugin-root workflow for normal plugin repositories:

```bash
npx @openclaw/plugin-inspector inspect --no-openclaw
```

Use fixture suites only when one repository is intentionally checking many
plugins, such as Crabpot:

```bash
plugin-inspector report --config crabpot.config.json --out reports
```

Most plugin authors should start with `inspect --no-openclaw`, then add
`init --ci --scripts` once the local check makes sense.

## Requirements

- Node.js 22 or newer.
- A plugin package root with `package.json`.
- An `openclaw.plugin.json` manifest when the plugin uses the manifest contract.

OpenClaw itself is optional. Pass `--no-openclaw` when CI should not compare
against a local OpenClaw checkout.

## First Check

From a plugin package directory:

```bash
npx @openclaw/plugin-inspector inspect --no-openclaw
```

Equivalent one-off runners:

```bash
pnpm dlx @openclaw/plugin-inspector inspect --no-openclaw
yarn dlx @openclaw/plugin-inspector inspect --no-openclaw
bunx @openclaw/plugin-inspector inspect --no-openclaw
```

The command writes:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`

It exits non-zero when compatibility breakages are found. Warnings and
suggestions stay visible in the reports without necessarily failing the command.

## Add It To A Plugin Repo

Install the package when you want local scripts and repeatable CI:

```bash
npm install --save-dev @openclaw/plugin-inspector
```

Add scripts:

```json
{
  "scripts": {
    "plugin:check": "plugin-inspector inspect --no-openclaw",
    "plugin:ci": "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute"
  }
}
```

Then run:

```bash
npm run plugin:check
```

Or let the inspector write the starting config, package scripts, and GitHub
Actions workflow:

```bash
npx @openclaw/plugin-inspector init --ci --scripts --dry-run
npx @openclaw/plugin-inspector init --ci --scripts
```

`init` detects `packageManager` and common lockfiles. Override that detection
with `--package-manager npm`, `pnpm`, `yarn`, or `bun`.

## Configuration

Small plugin repos can keep configuration in `package.json`:

```json
{
  "scripts": {
    "plugin:check": "plugin-inspector inspect --no-openclaw"
  },
  "pluginInspector": {
    "version": 1,
    "plugin": {
      "id": "weather",
      "priority": "high",
      "seams": ["dynamic-tool"],
      "sourceRoot": "src"
    },
    "capture": {
      "mockSdk": true
    }
  }
}
```

Use `plugin-inspector.config.json` when you want a standalone config file:

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

Check what the inspector resolved before wiring CI:

```bash
plugin-inspector config --json
```

Copy-ready config examples live in:

- `examples/plugin-inspector.config.json`
- `examples/package-json-plugin-inspector.json`

## CI Setup

`plugin-inspector ci` writes the normal compatibility report plus CI-native
summary, SARIF, and JUnit artifacts.

Minimal GitHub Actions workflow:

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
      - run: npx @openclaw/plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
```

Generated CI artifacts include:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`
- `reports/plugin-inspector-ci-summary.json`
- `reports/plugin-inspector-ci-summary.md`
- `reports/plugin-inspector.sarif`
- `reports/plugin-inspector.junit.xml`

Use `--no-sarif` or `--no-junit` only if your CI surface cannot consume those
formats.

More examples:

- `examples/github-actions-plugin-inspector.yml`
- `examples/github-actions-code-scanning.yml`
- `examples/gitlab-ci-plugin-inspector.yml`
- `examples/circleci-plugin-inspector.yml`

## Runtime Capture

Runtime capture imports plugin entrypoints in an isolated subprocess and records
what `register(api)` does. Use it when static inspection cannot show the actual
registrations your plugin makes at runtime.

```bash
plugin-inspector inspect --no-openclaw --runtime --mock-sdk --allow-execute
```

`--allow-execute` is the deliberate safety switch. Without it, modes that import
plugin code fail closed. The older `PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1`
environment guard still works for custom harnesses.

By default, runtime capture uses generated mocks for `openclaw/plugin-sdk`
subpaths and unresolved external packages discovered in the plugin import graph.
That lets compatibility CI run without OpenClaw installed.

Use `--real-sdk` only when the plugin workspace already has real SDK
dependencies installed and you intentionally want that path.

Runtime capture writes:

- `reports/plugin-inspector-runtime-capture.json`
- `reports/plugin-inspector-runtime-capture.md`

Capture one entrypoint directly:

```bash
plugin-inspector capture ./dist/index.js --mock-sdk --allow-execute
```

## Command Reference

| Command | Use it when |
| --- | --- |
| `plugin-inspector inspect` | You are checking one plugin package. |
| `plugin-inspector check` | You need the older script-friendly alias for `inspect`. |
| `plugin-inspector ci` | You want reports plus CI summary, SARIF, and JUnit outputs. |
| `plugin-inspector config` | You want to inspect resolved config before running CI. |
| `plugin-inspector init` | You want starter config, scripts, and CI workflow files. |
| `plugin-inspector report` | You are running a fixture-suite config with many plugins. |
| `plugin-inspector capture` | You want runtime capture for one entrypoint. |

Useful options:

| Option | Meaning |
| --- | --- |
| `--plugin-root <path>` | Check a plugin somewhere other than the current directory. |
| `--config <path>` | Read a standalone config file. |
| `--out <dir>` | Write reports somewhere other than `reports/`. |
| `--no-openclaw` | Skip comparison against a local OpenClaw checkout. |
| `--runtime` | Add opt-in runtime registration capture. |
| `--mock-sdk` | Use generated SDK and external-package mocks for runtime capture. |
| `--real-sdk` | Use installed real SDK dependencies instead of mocks. |
| `--allow-execute` | Permit commands that import plugin code. |

Run the built-in help for the complete flag list:

```bash
plugin-inspector --help
```

## Embedding In A Harness

Most plugin repos should use the CLI. Test harnesses can import grouped helpers
from the root package when they need to compose inspector workflows directly:

```js
import { pluginRoot } from "@openclaw/plugin-inspector";

const { report, paths } = await pluginRoot.runCheck({
  pluginRoot: process.cwd(),
  openclawPath: false,
  outDir: "reports",
});

console.log(report.status, paths.jsonPath);
```

The root package groups stable workflows as `pluginRoot`, `fixtureSuites`,
`staticInspection`, `reports`, `contracts`, `ci`, `runtime`, and `synthetic`.
Named exports remain available for existing automation.

## What The Mock SDK Does

The mock lane is for compatibility CI, not live service testing.

When `--mock-sdk` is enabled, the inspector generates temporary modules for
`openclaw/plugin-sdk` subpaths and unresolved external packages. The mock SDK
captures registrations; it does not call network services, launch OpenClaw, run
provider SDKs, or emulate service lifecycle side effects.

Keep live provider/service tests in the plugin repository behind credentials
and explicit opt-in flags.

## Scope

Default inspection reads manifests, package metadata, and source files, then
reports observed `api.on(...)`, `api.register*`, `define*`, SDK imports, and
manifest contracts.

OpenClaw target checkout parsing is limited to public compatibility registries,
SDK package exports, manifest types, hooks, and captured registrar metadata.

Cold import capture, synthetic contract probes, runtime capture, and live lanes
are separate opt-in modes. Live lanes must stay credential-gated and should not
run in default CI.
