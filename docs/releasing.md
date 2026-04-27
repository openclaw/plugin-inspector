# Releasing plugin-inspector

`plugin-inspector` publishes from a signed Git tag through the GitHub Actions
release workflow. The workflow runs the test suite, verifies the npm tarball,
publishes a GitHub release, and publishes the public npm package with
provenance.

## First-time setup

Add an npm automation token to the repository Actions secrets:

```bash
gh secret set NPM_TOKEN --app actions
```

The token must be allowed to publish `@openclaw/plugin-inspector` with public
access.

## Local verification

```bash
npm run release:local
```

This runs tests, `npm pack --dry-run`, and `npm publish --dry-run --access
public`.

## Publish

For the initial release:

```bash
git tag -a v0.1.0 -m "plugin-inspector v0.1.0"
git push origin v0.1.0
```

The same workflow can be triggered manually from GitHub Actions with
`tag_name=v0.1.0`.

## Release notes

Release Drafter keeps a draft up to date from PR labels. For this first release,
use the `CHANGELOG.md` `0.1.0` notes as the body if there is no PR history to
summarize.
