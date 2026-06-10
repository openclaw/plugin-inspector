<img src="docs/plugin-inspector-banner.jpg" alt="OpenClaw Plugin Inspector banner">

# OpenClaw Plugin Inspector

`@openclaw/plugin-inspector` is the offline compatibility checker for OpenClaw
plugin packages and plugin fixture suites.

It answers the questions that matter before a plugin reaches users:

- can OpenClaw discover the package metadata and `openclaw.plugin.json`
  manifest?
- which hooks, registration calls, manifest contracts, and SDK imports does the
  plugin use?
- does the plugin still look compatible without local OpenClaw internals?
- if CI finds a breakage, which JSON, Markdown, SARIF, JUnit, and summary
  artifacts should downstream automation read?
- when a fixture-suite harness such as Crabpot runs many plugins, which findings
  are hard breakages, known warnings, live issues, deprecations, or inspector
  proof gaps?

The default path is static, offline, and credential-free. Runtime capture exists,
but it is opt-in because it imports plugin code.

## Requirements

- Node.js 22 or newer.
- A plugin package root with `package.json`.
- `openclaw.plugin.json` when the plugin uses the OpenClaw manifest contract.
- No OpenClaw checkout, credentials, network service, or live provider access for
  default inspection.

Pass `--no-openclaw` when CI should not compare against a local OpenClaw
checkout. If an OpenClaw checkout is supplied with `--openclaw <path>`, the
inspector only reads public compatibility surfaces such as compat records, SDK
exports, hook names, manifest fields, and registrar metadata.

## Quick Start

Run this from a plugin package root:

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

It exits non-zero when hard compatibility breakages are found. Warnings,
suggestions, issue classifications, and logs stay visible in the report without
necessarily failing the command.

## Install In A Plugin Repo

Install the package when you want repeatable local scripts and CI:

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

The initializer can write the starter config, package scripts, and GitHub
Actions workflow:

```bash
npx @openclaw/plugin-inspector init --ci --scripts --dry-run
npx @openclaw/plugin-inspector init --ci --scripts
```

`init` detects `packageManager` and common lockfiles. Override that with
`--package-manager npm`, `--package-manager pnpm`, `--package-manager yarn`, or
`--package-manager bun`. Existing files are protected unless you pass `--force`.

## Configuration

Small plugin repos can keep configuration in `package.json`:

```json
{
  "scripts": {
    "plugin:check": "plugin-inspector inspect --no-openclaw",
    "plugin:ci": "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute"
  },
  "pluginInspector": {
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
    }
  }
}
```

Use `plugin-inspector.config.json` for a standalone config file:

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

Inspect the resolved config before wiring CI:

```bash
plugin-inspector config --json
```

Copy-ready examples live in:

- `examples/plugin-inspector.config.json`
- `examples/package-json-plugin-inspector.json`

## Commands

| Command | Purpose |
| --- | --- |
| `plugin-inspector` | Default alias for `check`. |
| `plugin-inspector check` | Script-friendly plugin-root check. |
| `plugin-inspector inspect` | Plugin-root check unless `--config` is supplied; with `--config`, runs a fixture report. |
| `plugin-inspector ci` | Compatibility report plus CI summary, SARIF, and JUnit outputs. |
| `plugin-inspector config` | Print resolved plugin-root config as text or JSON. |
| `plugin-inspector init` | Write starter config, scripts, and optional GitHub Actions workflow. |
| `plugin-inspector report` | Run a fixture-suite config with many plugins. |
| `plugin-inspector batch` | Discover plugin roots under a folder and write one aggregate impact report. |
| `plugin-inspector capture` | Runtime-capture one entrypoint directly. |

Common options:

| Option | Meaning |
| --- | --- |
| `--plugin-root <path>` / `--root <path>` | Check a plugin somewhere other than the current directory. |
| `--config <path>` | Read a standalone config file. Required for fixture-suite `report`. |
| `--out <dir>` | Write reports somewhere other than `reports/`. |
| `--openclaw <path>` | Compare against a local OpenClaw checkout. |
| `--no-openclaw` | Disable OpenClaw checkout comparison. |
| `--runtime` / `--capture` | Add opt-in runtime registration capture. |
| `--no-runtime` / `--no-capture` | Disable runtime capture even when config enables it. |
| `--mock-sdk` / `--sdk mock` | Use generated SDK and external-package mocks for runtime capture. |
| `--real-sdk` / `--sdk real` | Use installed real SDK dependencies instead of mocks. |
| `--allow-execute` | Permit commands that import plugin code. |
| `--author-facing` | Limit `check`, `ci`, and `batch` reports to findings with `authorRemediation` guidance. |
| `--json` | Print machine-readable JSON to stdout. |
| `--sarif [path]` | Write SARIF from `check` or `inspect`; `ci` enables this by default. |
| `--junit [path]` | Write JUnit XML from `check` or `inspect`; `ci` enables this by default. |
| `--no-sarif` / `--no-junit` | Disable default `ci` outputs. |

Run the built-in help for the exact CLI surface:

```bash
plugin-inspector --help
```

## Runtime Capture

Runtime capture imports plugin entrypoints in an isolated subprocess and records
what `register(api)` does. Use it when static inspection cannot prove the actual
registrations made at runtime.

```bash
plugin-inspector inspect --no-openclaw --runtime --mock-sdk --allow-execute
```

`--allow-execute` is the deliberate safety switch. Without it, modes that import
plugin code fail closed. The older environment guard still works for custom
harnesses:

```bash
PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector inspect --no-openclaw --runtime --mock-sdk
```

By default, runtime capture uses generated mocks for `openclaw/plugin-sdk`
subpaths and unresolved external packages discovered in the plugin import graph.
That keeps compatibility CI offline and credential-free. It does not call live
services, launch OpenClaw, run provider SDKs, or emulate service lifecycle side
effects.

Use `--real-sdk` only when the plugin workspace already has real SDK
dependencies installed and you intentionally want that path.

Runtime capture writes:

- `reports/plugin-inspector-runtime-capture.json`
- `reports/plugin-inspector-runtime-capture.md`

Capture one entrypoint directly:

```bash
plugin-inspector capture ./dist/index.js --mock-sdk --allow-execute
```

## CI

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

Generated `ci` artifacts:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`
- `reports/plugin-inspector-ci-summary.json`
- `reports/plugin-inspector-ci-summary.md`
- `reports/plugin-inspector.sarif`
- `reports/plugin-inspector.junit.xml`

CI examples:

- `examples/github-actions-plugin-inspector.yml`
- `examples/github-actions-code-scanning.yml`
- `examples/gitlab-ci-plugin-inspector.yml`
- `examples/circleci-plugin-inspector.yml`

## Report Surfaces

The compatibility report is the primary contract. Preserve field names and
finding codes because downstream CI and Crabpot reports may consume them.

Important report sections:

| Field | Meaning |
| --- | --- |
| `status` | `pass` unless hard breakages exist. |
| `summary` | Counts for fixtures, breakages, warnings, suggestions, issues, issue classes, and contract probes. |
| `targetOpenClaw` | Status and public compatibility data read from the optional OpenClaw checkout. |
| `fixtures` | Per-plugin metadata, hooks, registrations, manifest contracts, package data, and SDK imports. |
| `breakages` | Blocking compatibility failures. |
| `warnings` / `suggestions` | Non-blocking compatibility findings. |
| `issues` | Normalized issue rows with severity and class. |
| `contractProbes` | Suggested synthetic probes derived from observed contracts. |
| `logs` | Informational inventory and coverage rows. |
| `decisions` | Maintainer-facing follow-up or compatibility-policy decisions. |

Default `check`, `ci`, and `batch` reports include both author-facing and
internal findings. Pass `--author-facing` when producing plugin-author output;
that filtered view includes only findings with `authorRemediation.summary` and
`authorRemediation.docsUrl`.

## CI Policy And Shared Reporting Primitives

`plugin-inspector` owns the shared CI policy and report rendering primitives.
Fixture-suite harnesses such as Crabpot should call these exports instead of
reimplementing scoring, summaries, Markdown, SARIF, or JUnit handling.

The root API exposes grouped helpers:

```js
import { ci } from "@openclaw/plugin-inspector";

const policyReport = ci.buildPolicyReport({
  policy,
  compatibilityReport,
  executionResults,
  strict: false,
});

await ci.writePolicyReport(policyReport);
```

CI policy reports default to:

- `reports/plugin-inspector-ci-policy.json`
- `reports/plugin-inspector-ci-policy.md`

A policy must use `version: 1` and define:

- `allowedBlocked`
- `expectedWarnings`
- `thresholds`
- `fixtureSets`

Policy scoring fails hard breakages, unknown blocked synthetic probes, hard ref
diff regressions, failed execution results, strict live P0 issues, and strict
classified blockers. Non-strict mode keeps classified blocked probes and live P0
issues visible as warnings.

CI summary helpers read the known report set from `reports/` and render one
machine-readable and one Markdown rollup:

- compatibility
- runtime capture
- synthetic probes
- cold import readiness
- workspace plan
- platform probes
- import-loop profile
- execution results
- runtime profile
- ref diff
- profile diff
- CI policy

## Fixture Suites

Most plugin authors should use the plugin-root workflow. Use fixture suites when
one repository intentionally checks many plugins or packages, as Crabpot does.

```bash
plugin-inspector report --config crabpot.config.json --out reports
plugin-inspector report --config crabpot.config.json --out reports --check
plugin-inspector ci --config crabpot.config.json --out reports --no-openclaw
```

Fixture-suite configs are loaded through the explicit fixture helpers. That keeps
normal plugin-root configuration simple while still supporting bulk compatibility
harnesses.

## Public API

Prefer the CLI for normal plugin repositories. Import the public API when a test
harness needs to compose workflows directly:

```js
import { pluginRoot } from "@openclaw/plugin-inspector";

const { report, paths } = await pluginRoot.runCheck({
  pluginRoot: process.cwd(),
  openclawPath: false,
  outDir: "reports",
});

console.log(report.status, paths.jsonPath);
```

Stable grouped facades:

| Facade | Use |
| --- | --- |
| `pluginRoot` | Load config, inspect, run checks, capture entrypoints, or set up a plugin repo. |
| `fixtureSuites` | Load fixture-suite configs, run reports, and build fixture-suite readiness plans. |
| `staticInspection` | Inspect source text or fixture sets without the compatibility report layer. |
| `reports` | Render/write reports and classify issue findings. |
| `contracts` | Build, render, validate, and write contract captures and coverage. |
| `ci` | Build summaries, policy reports, execution results, SARIF, and JUnit outputs. |
| `batch` | Discover plugin roots and aggregate compatibility findings across a corpus. |
| `runtime` | Build runtime profiles, profile diffs, ref diffs, and import-loop profiles. |
| `synthetic` | Build and run synthetic probe plans. |

Named exports remain available for existing automation. Prefer the grouped
facades for new code because they show ownership and keep downstream wrappers
thin.

## Development

Repository checks are intentionally small and offline:

```bash
npm test
npm run release:contents
npm run check
```

`npm run check` runs the Node test suite and the package-contents guard. The
contents guard shells through `npm pack --dry-run --json` and verifies the npm
tarball includes package entrypoints, examples, README assets, and no private
`test/`, `scripts/`, or `.github/` paths.

Useful release-prep commands:

```bash
npm run release:local
npm run release:readiness
npm run release:notes
npm run release:plan
npm run release:crabpot -- --crabpot ../crabpot
```

`release:readiness` proves the local package and verifies Crabpot follow-through.
It does not publish.

Keep this package dependency-light. Do not add runtime dependencies unless they
remove real complexity. Default checks must stay offline and credential-free.

## Release Notes

The package publishes from annotated `v*` tags through GitHub Actions. The
release workflow runs the test suite, verifies the npm tarball, publishes the
GitHub release, and publishes the public npm package through npm trusted
publishing.

Before tagging a release:

1. Move `CHANGELOG.md` `Unreleased` notes into a versioned section.
2. Update `package.json` to the same version.
3. Update Crabpot's `pluginInspectorRef` to the release commit.
4. Run `npm run release:readiness`.
5. Run the Crabpot plugin-inspector smoke commands printed by
   `npm run release:crabpot -- --crabpot ../crabpot`.

After npm publish, update Crabpot's package pin and run:

```bash
npm run release:crabpot -- --crabpot ../crabpot --published
```

Do not publish npm packages without explicit owner approval.

## Contribution Notes

There is no `CONTRIBUTING.md` in this repository. Until one exists, use the repo
scripts above as the local contract and follow these project rules:

- preserve stable report field names and finding codes;
- prefer public OpenClaw plugin contracts over core internals;
- isolate any OpenClaw source parsing behind explicit helpers;
- keep runtime execution behind `--allow-execute` or
  `PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1`;
- when behavior, entrypoints, release metadata, or the npm package version
  change, update Crabpot's `@openclaw/plugin-inspector` pin/docs/smoke path and
  run the Crabpot plugin-inspector smoke before calling the work done.
