# Test cleanup ledger

| Scope | Evidence and decision | Validation |
| --- | --- | --- |
| CLI skill-document test | Removed phrase matching against SKILL.md. It never invokes the CLI; batch CLI tests already exercise scanning, reports, and author-facing filtering. | `npm run check`: 847 passed; package contents passed (AWS Crabbox `cbx_cdf75fdcc3e8`). |
| CLI temporary fixtures | Register teardown immediately after allocation, including batch corpus roots and helper-created plugins. Cleanup runs on test failure too. | [Check workflow](https://github.com/openclaw/plugin-inspector/actions/runs/41811933209) passed: Node 22 full check and Windows SDK entrypoints. |
| Profile API duplication | Removed the repeated four-report API scenario and its two private fixtures. Dedicated profile suites now exercise the public root exports; moved the unique profile-diff writer assertion there. | Focused API/profile coverage verified on Node 26 (41 tests, including the corrected profile-diff rerun); full Check workflow required before merge. |
| Remaining static fixtures | Retained the runtime-import fixture invoked by Check and all 74 benchmark files: 69 plugin audits plus five manifest/contract documents consumed by the explicit benchmark command. | All 73 frozen content hashes match; no unlisted benchmark files. This is fixture integrity, not a benchmark execution against OpenClaw. |
| Static sample plugin | Retained: inspector, report, and public API tests load its config and assert behavior. | Active consumers confirmed. |

Remaining audit: review the behavior and assertions in every test suite, consolidate duplicated scenarios, clean temporary fixtures, and check feature/mapping gaps. Mock capture tests establish synthetic behavior only; they do not prove compatibility with a live OpenClaw host.
