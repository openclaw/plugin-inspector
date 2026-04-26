# plugin-inspector agent notes

- Keep this package publishable and dependency-light. Do not add runtime
  dependencies unless they remove real complexity.
- Default checks must stay offline and credential-free.
- Do not publish npm packages without explicit owner approval.
- Preserve stable report field names and finding codes; downstream CI and
  crabpot reports may consume them.
- Prefer public OpenClaw plugin contracts over core internals. If target
  OpenClaw source parsing is needed, isolate it behind explicit helpers.
