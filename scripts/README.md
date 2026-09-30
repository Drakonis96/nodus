# Repository scripts

Run these from the repository root with Node.js 22 and locked dependencies
installed (`npm ci`). [package.json](../package.json) is the command catalogue.
[Testing Nodus](../docs/TESTING.md) explains Electron/native setup, discovery and CI.

## Categories and directories

| Pattern/location | Purpose and typical effects |
| --- | --- |
| `test-*.mjs` | Default `node:test` regression inventory. Includes pure checks, database/process integration, source assertions and browser harnesses. Tests normally create temporary fixtures. |
| `e2e-*.mjs` | Desktop or Server Web interaction checks. Require the corresponding build and runtime; only explicitly wired commands run in CI. |
| `verify-*.mjs`, `smoke-*.mjs`, `run-smoke.mjs` | Focused operational validation. Requirements and data isolation vary by entry point; `live`/`realcopy` variants can contact real services or use copied/local profiles. |
| `build-*.mjs`, `build-*.cjs`, `generate-*.mjs` | Bundles, derived contracts, licenses, website pages, icons and native helpers. Can refresh tracked generated files as well as ignored outputs. |
| `prepare-*.mjs`, `sync-*.mjs` | Runtime/fixture downloads, bootstrap material and contract/metadata synchronization. Some download archives or write source snapshots. |
| `audit-*.mjs`, `evaluate-*.mjs`, `research-*.mjs`, campaign scripts | Benchmarks, provider evaluations and reports. These may use credentials, paid calls and persistent output; they are not the default test suite. |
| `capture-*.mjs`, `shot-*.mjs`, `render-*.mjs` | Screenshots, visual evidence and rendering/recording utilities; often launch the application and write media files. |
| [lib/](lib/) | Shared test/runtime helpers: TypeScript hooks, process and Server harnesses, waits, site metadata and research fixtures. Not a separate executable test inventory. |
| [fixtures/](fixtures/) | Synthetic data, reference implementations, renderer harnesses and small utility-process apps. Consult per-fixture READMEs for provenance and prerequisites. |
| [assets/](assets/) | Static assets consumed by script tooling. |
| [ai-audit/](ai-audit/) | Live AI probes and an app-driven audit runner. Inspect credentials, target profile and output paths before use. |
| [notion-parity/](notion-parity/) | The parity QA CLI, scenario loops and evidence/repair tooling. See its [CLI entry point](notion-parity/cli.mjs). |
| [tutorial/](tutorial/) | Recording, narration, subtitles, cards, decks and probes. See its [README](tutorial/README.md) and [pitfalls](tutorial/PITFALLS.md). |

Names indicate intent, not a guarantee that a script is read-only or isolated.
Read the entry point and its environment/arguments before running manual audits,
restores, signing tools or live checks. Package commands do not all share npm's
`pretest` hook.

## Twenty principal commands

For application-backed tests, first run `npx electron-builder install-app-deps`;
`node scripts/prepare-electron-tests.mjs` materializes Electron when invoking an
entry point directly. Builds run the platform-specific Apple Calendar prebuild.

| Command | Requirements | Effects/result |
| --- | --- | --- |
| `npm run dev` | Root dependencies; native modules for app features. | Starts Vite and the development Electron app; macOS predev builds the calendar helper. Uses an application profile. |
| `npm run lint` | Root dependencies. | Checks `.ts`/`.tsx` sources with ESLint; no automatic fixes. |
| `npm run typecheck` | Root dependencies. | Runs renderer/shared and Electron TypeScript checks with `--noEmit`. |
| `npm run build` | Root dependencies; native build tools on macOS. | Builds Cloudflare, typechecks and bundles Desktop into `dist/`/`dist-electron/`; refreshes generated contract sources. |
| `npm run build:server-web` | Root dependencies. | Replaces `server/dist/web/` with the Server Web SPA and assets. |
| `npm test` | Electron/native prerequisites; builds/browser fixtures when the selected suites need them. | Prepares Electron, then runs all top-level `scripts/test-*.mjs` with Node's default concurrency. |
| `npm run test:ci` | Same prerequisites as the full suite. | Prepares Electron and runs the same discovered files with concurrency limited to two. |
| `node --test scripts/test-world-map-geometry.mjs` | Root dependencies; this suite bundles pure TypeScript. | Runs a focused regression file and writes temporary bundled fixtures; no npm pretest hook. |
| `npm run test:e2e` | Electron native rebuild, GUI/display, Desktop build. | Boots the real app with a throwaway profile and checks renderer, IPC, database and core flows; builds if outputs are missing. |
| `npm run test:e2e:stellar` | Electron, GUI/display and Desktop build. | Exercises the progressive graph canvas in an isolated demonstration profile. |
| `npm run test:e2e:stellar-tabs` | Electron, GUI/display and Desktop build. | Exercises graph tabs in an isolated demonstration profile. |
| `npm run test:e2e:argument-map` | Electron, GUI/display and Desktop build. | Exercises argument map interactions in an isolated demonstration profile. |
| `npm run test:server-web-security` | Root dependencies and native/browser prerequisites for its suites. | Rebuilds Server Web and runs security, publication, boundary and private-annotation checks. |
| `npm run verify:cross-repo` | Git/network or `NODUS_MARKETPLACE_DIR` pointing at a marketplace checkout. | Builds real marketplace packages, signs with disposable test keys and checks their installation in temporary data. Missing marketplace access fails. |
| `npm run verify:capability-packages` | Electron/display; built marketplace packages from the preceding verifier. | Installs, migrates, registers and uninstalls Chemistry, Legalize, Alpha Genome and Research Visuals packages in test profiles. |
| `npm run build:server-shared` | Root dependencies. | Refreshes committed modules under `server/lib/core/generated/`; inspect the resulting source diff. |
| `npm run site:build` | Root dependencies; Git history for dates. | Refreshes metadata/blog/feed/sitemap and assembles the Pages artifact under `pages-artifact/`. |
| `npm run site:verify` | Root dependencies and existing site content/history. | Runs `scripts/test-site-*.mjs`; does not regenerate stale site content. |
| `npm run licenses:verify` | Installed root dependencies. | Regenerates license inventory/notices and checks compliance; may update tracked legal artifacts. |
| `npm run server:backup -- create --data-dir DIR --output FILE` | Existing Server data directory; appropriate keyring when applicable. | Writes a Server backup archive. `inspect --archive FILE` reads its manifest; `restore --archive FILE --target NEW_DIR` writes a new target directory. |

The capability GUI verifiers need Xvfb on headless Linux, as configured in
[CI](../.github/workflows/ci.yml). The Server CLI has its own Node/native runtime;
do not assume Electron-rebuilt root dependencies are a standalone Server install.
See [server/README.md](../server/README.md) for deployment and backup details.

Release packaging, extension archives and provider-specific live probes are
available in `package.json`, but are deliberate operations rather than a blanket
"run every script" check. Never publish/sign/deploy simply to verify documentation.
