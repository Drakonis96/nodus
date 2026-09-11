# Releasing Nodus with capability packages

The three disciplines that used to live in the application are published as signed packages
from the marketplace, and a Nodus release carries them so an upgrade from 5.3.1 works with
no network. That makes the order below a dependency, not a preference: **a Nodus release
cannot be built until the packages it bundles exist.** `npm run capabilities:bootstrap`
runs with `NODUS_REQUIRE_BOOTSTRAP=1` in the release build, so a build that cannot migrate
offline fails instead of shipping.

## 0. The signing key

The private half lives in exactly one place: the `CAPABILITY_SIGNING_KEY` secret of the
marketplace's protected `capability-signing` environment. Its public half and `keyId` are
committed to `electron/capabilities/trustedKeys.json` here and to `trusted-keys.json`
there, and `npm run verify:cross-repo` fails if the two ever stop matching.

Generate one with `npm run capabilities:keygen -- <key-id>`. It writes the private half to
a gitignored file; move it into the environment secret and delete the file. Rotation is
described in the marketplace's `CONTRIBUTING.md`, including why the old key is retired
rather than deleted once anything has been signed with it.

## 1. Publish each package

In the marketplace, with the package's changes merged to `main`, run **Release capability
package** once per package and approve the protected environment each time. The workflow
builds every declared target on its own platform, assembles them in a job that builds
nothing, signs the whole manifest once, verifies it the way Nodus will, and publishes all
the assets in a single release.

It then uploads the catalog with the exact published sizes, read back through the
signature. Commit `catalog-v2.json` and the package's `catalog.json` from that artifact.

## 2. Pin the releases here

Fill `electron/capabilities/bootstrap.json` with what was published: the release URL, and
for each target the asset name, its exact size and its SHA-256. Take these from the signed
`release-manifest.json`, not from a local build — the point of pinning them is that the
application refuses anything else.

```bash
npm run capabilities:bootstrap          # assembles build/capability-bootstrap
NODUS_MARKETPLACE_DIR=… npm run verify:capability-migration
```

The second command is the one that matters: it upgrades synthetic 5.3.1 profiles from the
bundled packages, with no network, and checks what happens when a package is missing,
signed by the wrong key, tampered with or corrupt.

## 3. Release Nodus

The usual release flow. The build now includes a step that assembles the bootstrap before
packaging and requires it to succeed.

## What each check is for

| Command | What it would catch |
| --- | --- |
| `npm run verify:cross-repo` | the two repositories disagreeing: a contract regenerated on one side, a public key that stopped matching, a catalog naming a package that is not there |
| `npm run verify:capability-packages` | a package that installs but does not run: a bad signature, an archive that does not match it, a worker that will not start, a permission that is not enforced |
| `npm run verify:capability-migration` | an upgrade from 5.3.1 that loses a skill, half-installs a package, or cannot be retried |
| `NODUS_LIVE_CAPABILITY=1` on the first of those | a package that works against fixtures and not against the services it declares |

The first three run in CI on Linux, macOS and Windows, against a marketplace checkout that
is part of the job. The fourth is off by default because it depends on somebody else's
uptime.

## If a release turns out to be wrong

A published release is immutable and recovery is forward. The marketplace's
`CONTRIBUTING.md` describes the cases: a broken package is replaced by a new version, one
that must not be installed at all is deleted from the release and the catalog, and a key
believed to be compromised is rotated with the old one retired from a timestamp that makes
every release after it stop verifying. None of these uninstall anything from a device that
already has the package; say so plainly rather than implying a remote removal.
