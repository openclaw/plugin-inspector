# Changelog

## Unreleased

## 0.3.18 - 2026-07-21

### Highlights

- Keep compatibility capture current with OpenClaw's evolving hook, gateway, workspace-linking, blob-store, and Zod runtime surfaces.

### Fixed

- Mock the current plugin blob-store runtime so Diffs and other trusted plugins can be captured without persistent state.
- Parse OpenClaw hook names after their source declaration became private and added a TypeScript `satisfies` constraint.
- Run synthetic gateway lifecycle hooks around ordinary probes while preserving capture indexes and report order, so `gateway_stop` teardown cannot invalidate later compatibility checks.
- Link isolated plugin workspaces to the OpenClaw checkout without npm normalizing duplicated dependency and peer declarations back to registry ranges.
- Keep mocked Zod schemas chainable through unsupported methods such as `pipe()` and `catch()`.

## 0.3.17 - 2026-06-29

### Fixed

- Detect deprecated session SDK read/write, file-path, and transcript helpers across source files, packaged `dist`/`build` artifacts, runtime session APIs, and dynamic SDK imports.

## 0.3.16 - 2026-06-23

### Fixed

- Write `package.json` updates atomically for `init --scripts` and `prune-workspace-dev-deps`, including symlink-preserving target rewrites and temp-file cleanup on staging failures. Thanks @KrasimirKralev.
- Mock the Lark SDK HTTP interceptor surface during runtime capture so Feishu plugin bundles load successfully.

## 0.3.15 - 2026-06-12

### Fixed

- Detect deprecated `loadSessionStore(...)` usage when plugin code calls it through a runtime session API alias.

## 0.3.14 - 2026-06-11

### Changed

- Flag deprecated `loadSessionStore(...)` whole-store session helper usage as an author-facing deprecation warning while keeping speculative transcript-identity migration rules out of default inspection. Thanks @jalehman.

## 0.3.13 - 2026-06-09

### Changed

- Add `authorRemediation.summary` and `authorRemediation.docsUrl` guidance to author-facing compatibility issues and Markdown reports.
- Add `--author-facing` for `check`, `ci`, and `batch` reports while keeping default output complete for internal coverage findings.
- Replace the recent `--include-inspector-gaps` option with a clear error pointing to `--author-facing`.

## 0.3.12 - 2026-06-09

### Changed

- Hide maintainer-facing `inspector-gap` findings from author-facing `check`, `ci`, and `batch` output by default, with `--include-inspector-gaps` for internal coverage reports.

## 0.3.11 - 2026-05-26

### Fixed

- Classify the latest generated kitchen-sink registrars for meeting notes, node CLI features, hosted media, model catalogs, embedding providers, and session actions.
- Stop classifying package source entrypoints as missing when the published package provides built runtime entrypoints, and collapse SDK alias findings into a single compat-gap row.
- Treat compat-gap issues as reconciled contract coverage for their own compatibility record.
- Count passed synthetic hook probes as runtime coverage so conversation-access and `before_tool_call` inspector gaps close when probe artifacts prove them.
- Keep mock-SDK synthetic probes in-process so retained hook and registration handlers remain callable, and harden dynamic root SDK mock exports.
- Synthesize nested manifest config samples for optional object settings with required inner shape.
- Populate message and agent lifecycle synthetic hook payloads with the fields telemetry plugins commonly read.
- Resolve plugin manifests from parent directories when runtime capture starts from built `dist` entrypoints.
- Capture CLIs no longer treat `--output`, `--plugin-root`, or `--sdk` flag values as the positional entrypoint. Thanks @KrasimirKralev.
- Mock-SDK TypeScript capture now falls back to Node's strip-only parser on Node 26.

## 0.3.10 - 2026-05-03

### Fixed

- Accept valid mocked capture output when plugin code leaves `process.exitCode` dirty.

## 0.3.9 - 2026-05-03

### Fixed

- Follow bundled channel `loadBundledEntryExportSync` registration exports during mocked runtime capture.

## 0.3.8 - 2026-05-03

### Fixed

- Synthesize manifest config for isolated runtime capture so configured hooks can be observed without credentials.

## 0.3.7 - 2026-05-03

### Changed

- Downgrade `registration-capture-gap` to advisory severity so missing capture evidence no longer reports as a P1 plugin contract risk.

## 0.3.6 - 2026-05-03

### Changed

- Report import-loop RSS and CPU as baseline-adjusted plugin deltas alongside raw subprocess metrics so Crabpot dashboards do not treat harness import cost as plugin runtime cost.
- Include optional OpenClaw loader lifecycle timings for import and full activation when a capture runner provides them.

### Fixed

- Accept plugin install minimum-host floors as supported package metadata.
- Flag unsupported legacy OpenClaw bundle metadata and advertised npm pack blockers.
- Reconcile runtime capture evidence and harden mocked capture paths for downstream fixture reports.

## 0.3.5 - 2026-04-29

### Fixed

- Add immediate/faster subprocess RSS and CPU sampling plus explicit sample counts so short import-loop reports do not silently publish fake zero-memory metrics.
- Classify `createChatChannelPlugin` as channel factory metadata in synthetic probe plans so channel-core plugins do not fail as unknown registrars.
- Treat `createChatChannelPlugin` and `defineChannelPluginEntry` as channel registration equivalents when validating fixture expectations.
- Label runtime profile wall-time summaries as command-median p95 and render missing sampled metrics as `n/a`.

## 0.3.4 - 2026-04-29

### Fixed

- Separate executor-covered platform portability findings from residual findings so downstream structured runners can keep reports blocking only on unhandled risks.
- Sanitize absolute target OpenClaw paths from generated report artifacts and JSON CLI output.
- Normalize the dependency-install inspector finding title to use isolated-workspace wording.
- Treat `openclaw` package dependencies as host-linked workspace inputs instead of isolated dependency-install blockers.

## 0.3.3 - 2026-04-28

### Fixed

- Classify generated kitchen-sink public registrar coverage in synthetic probe plans so new API-surface fixtures do not fail as unknown execution profiles.

## 0.3.2 - 2026-04-28

### Fixed

- Preserve runtime capture bindings for callback-based registrations so captured hooks and registrations can resolve their bound callback metadata.

## 0.3.1 - 2026-04-28

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
