# Changelog

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
