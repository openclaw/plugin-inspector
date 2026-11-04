# Test cleanup ledger

| Scope | Evidence and decision | Validation |
| --- | --- | --- |
| CLI skill-document test | Removed phrase matching against SKILL.md. It never invokes the CLI; batch CLI tests already exercise scanning, reports, and author-facing filtering. | Pending full check. |
| Static sample plugin | Retained: inspector, report, and public API tests load its config and assert behavior. | Active consumers confirmed. |

Remaining audit: review the behavior and assertions in every test suite, consolidate duplicated scenarios, clean temporary fixtures, and check feature/mapping gaps. Mock capture tests establish synthetic behavior only; they do not prove compatibility with a live OpenClaw host.
