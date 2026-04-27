# Changelog

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
