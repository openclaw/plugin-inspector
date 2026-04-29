# plugin-inspector agent notes

- Keep this package publishable and dependency-light. Do not add runtime
  dependencies unless they remove real complexity.
- Default checks must stay offline and credential-free.
- Do not publish npm packages without explicit owner approval.
- Preserve stable report field names and finding codes; downstream CI and
  crabpot reports may consume them.
- Treat a package dependency named `openclaw` as a host-linked workspace input,
  not an isolated dependency-install blocker. Keep third-party runtime
  dependencies classified as install/audit blockers.
- When changing plugin-inspector behavior, CLI/package entrypoints, release
  metadata, or the npm package version, update crabpot's
  `@openclaw/plugin-inspector` pin/docs/smoke path as needed and run the
  crabpot plugin-inspector smoke before calling the work done.
- Prefer public OpenClaw plugin contracts over core internals. If target
  OpenClaw source parsing is needed, isolate it behind explicit helpers.
