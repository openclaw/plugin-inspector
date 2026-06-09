# Author-Audience Plugin Inspector Findings

## Goal

Plugin Inspector should keep reporting the full compatibility and scanner picture, but ClawHub author-facing surfaces should show only findings a plugin/package author can actually fix.

The immediate target surfaces are:

- `clawhub package validate <path>`
- ClawHub plugin validation UI
- Plugin Inspector findings email

## Problem

Plugin Inspector produces different kinds of findings today:

- real plugin/package defects or migration work, such as missing package metadata, stale manifest versions, legacy imports, or deprecated hooks;
- OpenClaw compatibility work, where the right fix may be to preserve or document an OpenClaw API seam;
- Plugin Inspector coverage gaps, such as runtime capture work needed before the tool can make a reliable author-facing claim.

These are all useful in full reports, but they are not all useful to plugin authors. Findings like `runtime-tool-capture` or other `inspector-gap` results should not appear in `clawhub package validate` as if the author has something concrete to fix.

## Decision

Use remediation audience as the author-facing contract.

`remediation.audience` has two allowed values:

- `author`: the plugin/package author can take the next step.
- `internal`: the finding is useful to OpenClaw or Plugin Inspector maintainers, but should be hidden from author-facing ClawHub output.

Keep the more specific maintainer routing in existing fields:

- `owner`: for example `plugin`, `core`, or `inspector`.
- `decision`: for example `plugin-upstream-fix`, `core-compat-adapter`, or `inspector-follow-up`.

This avoids maintaining separate public audience buckets for OpenClaw maintainers and Plugin Inspector maintainers while still preserving internal triage detail.

## CLI Behavior

Default Plugin Inspector output remains complete:

```bash
plugin-inspector check
plugin-inspector ci
plugin-inspector batch <folder>
```

With no audience filter, reports include author and internal findings.

Author-facing output uses an audience filter:

```bash
plugin-inspector check --audience author
plugin-inspector ci --audience author
plugin-inspector batch <folder> --audience author
```

When `--audience author` is set:

- report artifacts include only findings whose `remediation.audience` is `author`;
- summaries/counts reflect the filtered report;
- breakage behavior is based on the filtered report for that command invocation.

The recent `--include-inspector-gaps` flag should be removed or deprecated in favor of `--audience author`. The replacement model is more general: default all findings, filter only when a consumer asks for a specific audience.

## ClawHub Behavior

ClawHub should request or apply the author audience filter for all author-facing validation surfaces.

`clawhub package validate <path>` should run bundled Plugin Inspector with the author audience filter, then print remediation guidance from author findings.

Publish-time warnings persisted by ClawHub should be author findings only. Internal findings must not trigger author emails or plugin validation UI rows.

Hard publish-blocking errors should still block immediately when they are author-facing breakages. Internal findings should remain available in full inspector reports, not as ClawHub author-blocking feedback.

## Finding Metadata Requirements

Every known Plugin Inspector issue code must have remediation metadata:

```js
remediation: {
  audience: "author" | "internal",
  actionability: "direct-fix" | "migration" | "internal-follow-up" | "compat-maintenance",
  summary: string,
  steps?: string[],
  example?: string,
  docsUrl?: string
}
```

For author findings, remediation should be written as direct user guidance: what to change, where to change it, and how to rerun validation.

For internal findings, remediation should explain why the finding is internal and what maintainer work would make it actionable later.

Tests should fail when a known issue code lacks remediation or uses an unknown audience.

## Initial Thematic Buckets

Author findings include:

- package metadata fixes: `package-plugin-api-compat-missing`, `package-json-missing`, `package-openclaw-metadata-missing`, `package-install-metadata-incomplete`;
- manifest/package drift: `manifest-name-missing`, `package-manifest-version-drift`, unsupported manifest/package metadata;
- author migrations: `legacy-root-sdk-import`, `legacy-before-agent-start`, `provider-auth-env-vars`, `channel-env-vars`;
- artifact/package publish fixes: npm pack unavailable, missing packed entrypoints, missing packed metadata.

Internal findings include:

- scanner/probe gaps: `runtime-tool-capture`, `registration-capture-gap`, `before-tool-call-probe`, package cold-import build/dependency gaps;
- OpenClaw compatibility maintenance: missing compat records or public seams that need core compatibility decisions;
- fixture/scanner regressions: `missing-expected-seam` when the tool or fixture may be stale.

## Testing

Plugin Inspector tests:

- all known issue codes have remediation;
- allowed audiences are only `author` and `internal`;
- default reports include both author and internal findings;
- `--audience author` excludes internal findings from JSON, Markdown, CI outputs, and batch summaries;
- invalid audience values fail with a clear CLI error;
- remediation renders in Markdown issue reports.

ClawHub tests:

- `clawhub package validate` invokes Plugin Inspector in author-audience mode or applies the equivalent filter;
- validation output includes remediation for author findings;
- validation output omits internal findings;
- publish-time warning persistence, UI, and emails ignore internal findings;
- hard author breakages still block publish.

## Non-Goals

- Do not remove internal findings from Plugin Inspector.
- Do not make `author` the default Plugin Inspector audience.
- Do not create separate `openclaw-maintainer` and `inspector-maintainer` audience values yet.
- Do not invent ClawHub-only remediation text when Plugin Inspector already owns finding metadata.
