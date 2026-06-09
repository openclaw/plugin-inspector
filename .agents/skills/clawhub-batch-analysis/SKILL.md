---
name: clawhub-batch-analysis
description: Use when analyzing how Plugin Inspector rule, warning, deprecation, or compatibility changes affect the ClawHub plugin corpus. Guides agents to export plugins from ClawHub, run `plugin-inspector batch`, and summarize affected plugins and finding frequency.
---

# ClawHub Batch Analysis

Use this skill when a maintainer working on `@openclaw/plugin-inspector` wants to answer:

- "If we deprecate this API, how many ClawHub plugins are affected?"
- "Which plugins would receive this new warning/error?"
- "What are the most common Plugin Inspector findings across exported ClawHub plugins?"

## Workflow

1. **Confirm the ClawHub export route**
   - In the ClawHub repo, verify the current `/api/v1/plugins/export` contract before using it.
   - Prefer a local or staging ClawHub target unless the user explicitly asks for production.
   - Check auth requirements and pagination headers such as `X-Next-Cursor` in the current ClawHub code.

2. **Export the plugin corpus**
   - Request ZIP exports from `/api/v1/plugins/export`.
   - Include both plugin families unless the user requests a narrower slice:
     - `family=code-plugin`
     - `family=bundle-plugin`
   - If the endpoint is paginated, follow `X-Next-Cursor` until exhausted.
   - Store raw export ZIPs and an export manifest in a temp or ignored working directory.

3. **Unpack safely**
   - Unpack into a fresh directory.
   - Do not execute plugin code during unpacking.
   - Keep any ClawHub export metadata near the unpacked corpus so plugin names/owners can be traced.

4. **Run Plugin Inspector batch**
   - From the `plugin-inspector` repo:

```bash
plugin-inspector batch /path/to/unpacked-clawhub-export \
  --no-openclaw \
  --out reports/clawhub-batch-analysis \
  --concurrency 8 \
  --json
```

   - Use `--openclaw <path>` instead of `--no-openclaw` when validating against a local OpenClaw checkout or a branch with new compatibility metadata.
   - Add `--keep-plugin-reports` only when per-plugin artifacts are needed; large exports can produce many files.

5. **Summarize impact**
   - Lead with:
     - total plugins scanned
     - plugins with errors
     - plugins with warnings
     - top finding codes by affected plugin count
   - Include affected plugin/version rows for the specific finding under investigation.
   - Link or point to:
     - `plugin-inspector-batch-report.json`
     - `plugin-inspector-batch-report.md`

## Safety Notes

- Treat exported plugins as untrusted source. Do not pass `--runtime`, `--mock-sdk`, or `--allow-execute` unless the user explicitly requests runtime capture in an isolated workspace.
- Keep production exports and reports out of git unless the user explicitly asks to publish a sanitized artifact.
- If export counts or endpoint behavior matter, verify against live ClawHub instead of relying on memory.
