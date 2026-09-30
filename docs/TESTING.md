# Testing Nodus

Run commands from the repository root. [package.json](../package.json) defines the
public commands; [CI](../.github/workflows/ci.yml) defines the required checks.
See the [script catalogue](../scripts/README.md) for utilities and their effects.

## Runner and test categories

The regression suite uses Node's built-in `node:test` runner and
`node:assert/strict`. `npm test` discovers the top-level `scripts/test-*.mjs`
files. Some files register named `test()` cases; others use plain assertions or
launch a subprocess whose exit status represents the result. Fixtures and nested
test files are included by their owning suites, rather than by recursive discovery.

| Category | What it exercises | Examples |
| --- | --- | --- |
| Pure logic | Shared contracts, transformations and domain invariants; TypeScript is commonly bundled with esbuild into a temporary module. | [world map geometry](../scripts/test-world-map-geometry.mjs), [HLC](../scripts/test-sync-hlc.mjs) |
| Repository and integration | Real SQLite migrations, persistence, imports, backups, HTTP services and process boundaries, using temporary data. | [backup vaults](../scripts/test-backup-vaults.mjs), [sync packages](../scripts/test-sync-package.mjs) |
| Source and contract checks | IPC/preload coverage, privacy boundaries, translations, generated assets and website consistency. | [IPC channels](../scripts/test-ipc-contract.mjs), [sitemap](../scripts/test-site-sitemap.mjs) |
| Browser and renderer checks | Components or the compiled Server Web app driven by Chromium/Playwright, sometimes from a `test-*.mjs` suite. | [Server Web security](../scripts/test-server-web-security.mjs), [capability layout](../scripts/test-capability-view-layout.mjs) |
| Desktop E2E | The built Electron application, real windows, preload, IPC and user interactions. | [app smoke](../scripts/e2e-smoke.mjs), [argument map](../scripts/e2e-argument-map-canvas.mjs) |
| Cross-repository capability checks | Marketplace contracts, signed package installation, workers and migrations on each supported platform. | [cross-repo verifier](../scripts/verify-cross-repo.mjs) |
| Manual/live verification | Real provider calls, installed companion apps, recordings or operator-selected data. These are separate from the default regression command. | `verify:*`, `audit:*`, `capture:*` commands in [package.json](../package.json) |

## Prerequisites

Use Node.js 22, matching CI, and install the locked dependencies:

```sh
npm ci
npx electron-builder install-app-deps
```

`better-sqlite3` must match Electron's ABI for application-backed tests. Those
scripts re-execute under Electron with `ELECTRON_RUN_AS_NODE=1`; rebuilding only
for system Node can cause an ABI error. After reinstalling dependencies, repeat
the native rebuild. [prepare-electron-tests.mjs](../scripts/prepare-electron-tests.mjs)
resolves, downloads if needed, and checks the Electron executable before parallel
workers start. npm invokes it automatically through `pretest` and `pretest:ci`.
Direct `node --test` invocations do not run npm lifecycle hooks.

GUI checks need a working desktop/display and Electron's platform libraries.
macOS is the main CI platform. Linux capability jobs use `xvfb-run` and configure
Electron's sandbox helper as shown in the workflow. Browser-driven suites need a
Chrome/Chromium executable supported by that suite's harness; `playwright-core`
does not install a browser for you. Inspect skipped tests: missing prerequisites
can leave a local run without the intended coverage.

Build both applications before suites that drive compiled code:

```sh
npm run build
npm run build:server-web
node scripts/prepare-research-ocr-fixture.mjs
```

The Desktop build includes both TypeScript checks and builds Cloudflare outputs;
it writes `dist/` and `dist-electron/` and refreshes generated contracts.
Server Web writes `server/dist/web/`. The OCR preparation downloads a
hash-verified test resource when it is absent. On macOS the build lifecycle also
compiles the native Apple Calendar helper. Do not bypass a failed prerequisite.

## Common commands

```sh
# Complete discovered regression suite; default runner concurrency.
npm test

# Same inventory, capped at two concurrent test files as on CI.
npm run test:ci

# A focused suite; explicitly prepare Electron when its dependencies need it.
node scripts/prepare-electron-tests.mjs
node --test scripts/test-world-map-geometry.mjs scripts/test-world-presence.mjs

# Static checks and complete production builds.
npm run lint
npm run typecheck
npm run build
npm run build:server-web

# Four real-app checks executed by CI; prepare the build/native modules first.
npm run test:e2e
npm run test:e2e:stellar
npm run test:e2e:stellar-tabs
npm run test:e2e:argument-map

# Focused Server Web security coverage; rebuilds that bundle itself.
npm run test:server-web-security
```

The CI E2E scripts use disposable profiles. Other `e2e-*`, `verify-*`, audits and
smoke scripts have their own setup and effects: read their entry point before
running them. Some contact paid providers or installed apps and modify profiles.
Use synthetic fixtures or throwaway vaults for development.

## What CI checks

On pull requests, pushes to `main`, and manual dispatch, the main quality workflow
checks citation metadata, installs locked dependencies, rebuilds Electron native
modules, lints, runs both TypeScript checks, builds Desktop/Cloudflare and Server
Web, prepares the OCR resource, and executes the entire `scripts/test-*.mjs`
inventory with two-file concurrency per runner. It also runs all four Desktop
E2E commands above. Full Git history is required for source-derived sitemap dates.

The Linux, macOS and Windows capability matrix additionally checks the application
against a real marketplace checkout, builds/signs test packages, exercises their
installation and migration, and validates the packaged Python runtime. A
`.github/marketplace-ref` pairing is only valid on a PR and must be removed before
merge. See [ADR-006](architecture/adr-006-capability-api-v2.md) for the contract.

The [CLA](../.github/workflows/cla.yml) and
[Server image workflow](../.github/workflows/nodus-server-image.yml) are separate checks.
Release and Pages workflows have their own gates; `npm test` alone does not
package installers, publish images, deploy the website or execute every live audit.

## Adding a test

1. Add `scripts/test-<feature>.mjs` for default regression coverage. A new nested
   fixture or `e2e-*.mjs` entry point is not automatically part of `npm test`.
2. Follow a nearby suite's TypeScript bundling and Electron bootstrap pattern.
   Exercise real persistence or process boundaries when those are the behavior
   under test; keep pure helpers independent of Electron where possible.
3. Use a temporary directory/profile, an isolated HTTP port and deterministic
   fixtures. Release processes, servers, databases and temporary files in cleanup
   handlers. Keep mutable state independent of test-file execution order.
4. Assert observable behavior and failure paths. A rejected operation must fail
   the test process; do not replace an unavailable dependency with a silent pass.
   Keep provider calls and personal data out of default regression fixtures.
5. Run the focused file, the relevant lint/typechecks, and affected integration or
   E2E checks. For a new E2E that must block merges, explicitly wire its command
   into CI; naming the file is insufficient.

For a minimal pure test:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('describes an observable invariant', () => {
  assert.equal(2 + 2, 4);
});
```

Use existing esbuild fixture patterns to import TypeScript with aliases. Do not
depend on Node directly loading the application's `.ts`/`.tsx` files.
