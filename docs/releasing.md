# Releasing plugin-inspector

`plugin-inspector` publishes from an annotated Git tag through the GitHub Actions
release workflow. The workflow runs the test suite, verifies the npm tarball,
publishes a GitHub release, and publishes the public npm package through npm
trusted publishing.

## First-time setup

Important: npm trusted publishing cannot create the initial package record. The
package must already exist on npm before a trusted publisher can be configured.

To preserve OIDC provenance for `0.1.0`, publish a temporary `0.0.0` bootstrap
package with owner npm credentials, then configure trusted publishing and rerun
the release workflow for `v0.1.0`.

The `@openclaw` npm scope must exist and the publishing account must have write
access to it. If that scope is not available, rename the package before the
first publish.

One safe bootstrap shape:

```bash
BOOTSTRAP_DIR="$(mktemp -d)"
printf '{"name":"@openclaw/plugin-inspector","version":"0.0.0","description":"OpenClaw plugin inspector bootstrap placeholder","license":"MIT"}\n' > "${BOOTSTRAP_DIR}/package.json"
printf '# @openclaw/plugin-inspector\n\nBootstrap placeholder. Use 0.1.0 or newer.\n' > "${BOOTSTRAP_DIR}/README.md"
npm publish "${BOOTSTRAP_DIR}" --access public --tag bootstrap
npm deprecate @openclaw/plugin-inspector@0.0.0 "Bootstrap placeholder; use 0.1.0 or newer."
```

Configure npm trusted publishing for `@openclaw/plugin-inspector`:

- provider: GitHub Actions
- organization/user: `openclaw`
- repository: `plugin-inspector`
- workflow filename: `release.yml`
- environment: blank

The package `repository.url` must continue to match
`git+https://github.com/openclaw/plugin-inspector.git`.

npm trusted publishing uses GitHub Actions OIDC and does not use an `NPM_TOKEN`
secret. npm automatically creates provenance attestations for trusted publishes
from a public GitHub repository.

The equivalent CLI setup after the package exists is:

```bash
npm trust github @openclaw/plugin-inspector --repo openclaw/plugin-inspector --file release.yml
```

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

If npm publish fails with `ENEEDAUTH` or a misleading package-not-found error,
check that the npm trusted publisher configuration exactly matches the GitHub
repository and `.github/workflows/release.yml`.

## Release notes

Release Drafter keeps a draft up to date from PR labels. For this first release,
use the `CHANGELOG.md` `0.1.0` notes as the body if there is no PR history to
summarize.
