# Security Policy

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories for
this repository. If GHSA is unavailable to you, email security@openclaw.ai.

Do not open public issues for vulnerabilities or include secrets, private plugin
artifacts, credentials, or exploit details in public reports.

## Scope

In scope:

- plugin-inspector CLI, package exports, and compatibility report generation
- isolated runtime execution, mock SDK behavior, and package integrity checks
- release workflows that publish the npm package
- dependency or workflow behavior that can affect downstream Crabpot findings

Out of scope:

- vulnerabilities in inspected third-party plugins unless plugin-inspector
  executes or reports them unsafely
- upstream OpenClaw behavior outside the inspector contract
- compromise of a trusted local account, shell, filesystem, or maintainer device
- scanner-only findings without a reachable exploit path in supported usage

## Expectations

We prioritize reachable issues that affect package integrity, report integrity,
plugin fixture execution, or safe release behavior. Include the affected commit,
minimal reproduction steps, and sanitized impact details.
