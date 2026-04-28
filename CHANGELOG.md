# Changelog

## Unreleased

### Added

- Add grouped root facades: `pluginRoot`, `fixtureSuites`, `staticInspection`, `reports`, `contracts`, `ci`, `runtime`, and `synthetic`.
- Expose contract capture, contract coverage, CI rollup, runtime profile, ref/profile diff, import-loop, and synthetic probe helpers from the root package API.
- Add a release follow-through guard that fails when Crabpot scripts regress to the legacy `advanced.js` bundle.
- Add a package-contents release guard for npm tarball entrypoints, examples, and README assets.

### Changed

- Move Crabpot integration scripts to the root public API while keeping Crabpot as the fixture corpus and report consumer.
- Keep generic artifact writing out of the root API; Crabpot-owned runner scripts write their own JSON outputs.
- Ship the README banner asset in the npm package so the published README does not reference a missing local image.
- Document the grouped root import path for embedding harnesses without turning the README into a full API dump.

## 0.3.0 - 2026-04-27

### Added

- Add `--allow-execute` as a cross-platform runtime capture opt-in flag.
- Add `plugin-inspector init --dry-run` for setup previews.
- Add `plugin-inspector init --json` for machine-readable setup summaries.
- Add `plugin-inspector init --scripts` for `plugin:check` and `plugin:ci` package scripts.
- Add public fixture-set report helpers and synthetic probe suite helpers for Crabpot and downstream compatibility suites.
- Add a Crabpot follow-through release checklist for source refs, package pins, and smoke commands.

### Changed

- Make generated runtime CI commands use `--allow-execute` instead of shell-specific inline environment syntax.
- Make `plugin-inspector init --ci` detect `packageManager` and common lockfiles before generating CI install/run commands.
- Make `plugin-inspector init` output repo-relative file paths and preflight generated files before writing.
- Make `plugin-inspector init` infer `sourceRoot: "src"` from package export maps like `"./src/index.js"`.
- Improve CLI failure summaries with report artifact paths and top blocking findings.
- Harden mock SDK capture by keeping generated loader fixtures available until subprocess exit.

## 0.2.0 - 2026-04-27

### Added

- Add package.json `pluginInspector` config discovery for plugin-root checks.
- Add `plugin-inspector config` for resolved plugin-root config summaries.
- Add author-facing `plugin-inspector inspect` plugin-root flow.
- Add CI-native SARIF and JUnit outputs; `plugin-inspector ci` writes them by default.

### Changed

- Make generated CI workflows use one `plugin-inspector ci --no-openclaw --runtime --mock-sdk` command.
- Harden runtime capture for string handler registrations, parse-capable config schema helpers, and provider auth/catalog SDK mocks.

## 0.1.3 - 2026-04-27

### Added

- Add reserved bundled-plugin SDK import detection so external plugins get explicit compatibility findings for private OpenClaw SDK shims.
- Add packaged workspace capture and synthetic-probe helper CLIs for generated isolated workspace plans.

### Changed

- Make `plugin-inspector ci` write compatibility-backed CI summary artifacts instead of the legacy inventory report.
- Default packaged helper captures to the mocked OpenClaw SDK while preserving `--real-sdk` opt-in behavior.
- Detect the default runtime capture artifact at `reports/plugin-inspector-runtime-capture.json`.
- Report the actual log count in CLI text summaries.

## 0.1.2 - 2026-04-27

### Added

- Add public SDK subpath mocks, registrar return profiles, richer lifecycle capture probes, and plugin-root `init`/`--plugin-root` CLI flows.

### Changed

- Harden runtime capture for TypeScript entrypoints, extensionless local imports, mocked external packages, namespace imports, async output capture, and explicit mock/real SDK lanes.
- Refresh README and CI examples around `npx @openclaw/plugin-inspector check --no-openclaw` and opt-in runtime capture.

## 0.1.1 - 2026-04-27

### Changed

- Refresh npm package docs with the simplified CLI-first README and public API surface cleanup.

## 0.1.0 - 2026-04-27

Initial public package release for `@openclaw/plugin-inspector`.

### Added

- Plugin-root `plugin-inspector check` command with optional `plugin-inspector.config.json`.
- Static OpenClaw plugin compatibility reports, issue reports, and CI policy summaries.
- Crabpot-compatible fixture-set inspection and report assembly APIs.
- Target OpenClaw surface parsing for compat registry records, hook names, registrar names, SDK exports, and manifest type fields.
- Package metadata, manifest, SDK import, hook, registration, runtime-capture, cold-import, synthetic-probe, runtime-profile, ref-diff, and profile-diff report helpers.
- Optional `PLUGIN_INSPECTOR_EXECUTE_ISOLATED=1 plugin-inspector check --capture` runtime registration capture using a temporary mocked `openclaw/plugin-sdk`.
- Copy-ready config and GitHub Actions examples under `examples/`.
