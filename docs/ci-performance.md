# CI execution and measurement

CI builds each commit once on `macos-latest`. Three independent macOS jobs run
every `scripts/test-*.mjs` file, with the same Node 22 runtime, Electron native
module checks, full Git history, and at most two-file process concurrency.
Files with a static Playwright import run in a first phase at concurrency one;
other files run afterward at concurrency two, retaining process isolation.
This reduces competing browser processes on the 7 GB hosted runners. The
classification changes scheduling only: both phases together execute every
assigned file, and summaries add the real counts while retaining any failure,
cancellation or skip from either phase. Browser durations receive twice the
placement weight to account for their sequential execution. The four existing
Electron E2E scripts run after the smaller third group,
against the same build. Cross-repository capability checks retain all three platforms.

`scripts/ci-test-shards.mjs plan` discovers the complete test inventory. Historical
durations in `scripts/ci-test-durations.json` balance placement, never inclusion:
new files without hints also run. Each group runs longer files first and reports
the runner's actual file-process completions, durations, result counts and skips.
The third group reserves five minutes of E2E work in its placement weights;
this changes assignment, never test inclusion. Every group is seeded with at least
one file. Three downstream macOS runners replace four, leaving room for the two
concurrent macOS Research native jobs within the standard five-job allowance.
The `e2e` check verifies the matrix result: failure/cancellation in any group or
real-app step fails it. Existing E2E assertions and individual timeouts remain.

The final `test` check requires successful build, all groups, E2E and capability
jobs, and checks that every discovered file completed exactly once. Missing,
duplicate, cancelled, failed or stale reports fail the gate. New skipped tests
also fail; only the two exact skip names/reasons present in the baseline run are
accepted. Existing assertions and E2E timeouts are unchanged.

Build outputs and the contract sources generated during preparation travel in a
tar archive to retain native helper permissions. Source-driven tests therefore
see the same generated files as the original single job. The
manifest verifies their SHA-256 hashes and the exact checked-out commit before
tests start. Artifacts are scoped to the current workflow run. A failed-job rerun
reuses the successful build's artifact ID and replaces only retried group reports;
successful groups remain valid for the same commit. Builds are not restored from
another commit. TypeScript incremental state and ESLint's
content cache accelerate checks, but both tools still run against current sources
on every build; cache misses perform full checks.

The builder also shares its rebuilt native binaries and Electron rebuild metadata
in a small, separate archive. Consumers install the locked dependencies with
`npm ci`, verify the exact commit, lockfile hash, OS, architecture, Node version,
Electron version, ABI and every transferred file hash, and open a real in-memory
SQLite database under Electron. They still run `electron-builder install-app-deps`
to check all current native dependencies; valid rebuild metadata avoids repeating
the same compilation. Runtime mismatches or missing/corrupt binaries fail the job.
The native archive is never restored from a cross-run dependency cache.

The builder compiles the component fixtures' stylesheet with the same Tailwind
command, once from the current checkout. It includes the CSS in the commit-bound
build hash manifest. Consumers use that verified file and fail if it is missing
or empty, avoiding duplicate compilation at parallel test startup. All browser
assertions still inspect the real generated stylesheet. Local tests retain their
existing stylesheet preparation unless the CI artifact path is explicitly set.
The group assigned the Drift audio fixture verifies working `ffmpeg` and `ffprobe` binaries, installing or
repairing the Homebrew formula only when necessary. This keeps the Drift audio
fixture's duration, channels, sample rate and loop-seam assertions active; a
missing tool is not accepted as an additional skip.

The attachment integration fixture intercepts structured planner inference as well
as text/stream inference. It retains the literal planning fallback and all format,
engine and provider assertions, while avoiding subscription CLI processes after
the checks finish. The planner and transports retain their dedicated test suites.

## Validate on a pull request

1. Compare with baseline run
   [36668262640](https://github.com/Drakonis96/nodus/actions/runs/36668262640):
   main job 32m16s, unit/integration step 19m18s, main build 5m25s, E2E steps
   approximately 4 minutes. The original runner reported 4,027 tests, 4,025
   passed, zero failures, and the two documented skips. Added orchestration
   regression tests increase the new total.
2. Confirm all build, group, E2E and capability jobs pass. Read the final `test`
   job summary and download the `ci-tests-*` JSON reports. Their combined file
   inventory must match discovery; result counts alone are not sufficient.
3. Measure elapsed feedback from workflow creation to the final successful gate.
   For each job record creation/start/completion timestamps to separate queue
   time from execution. Sum execution durations across **all** jobs to measure
   total runner consumption; faster feedback does not imply fewer runner minutes.
4. A first execution measures a cold check cache. A later commit with small changes
   can measure restored incremental caches; do not combine the two benchmarks.
5. Aim for 14–16 minutes and compare measured results before
   claiming an improvement. Three downstream macOS jobs can compete with other PRs
   for the account's macOS concurrency allowance. Queue time is not guaranteed.

Application code and the local `npm test`, `npm run test:ci`, `npm run build`,
`npm run lint` and `npm run typecheck` commands retain their original behavior.
For local orchestration verification use:

```sh
node --test scripts/test-ci-quality-gate.mjs
npx electron-builder install-app-deps
node scripts/ci-native-artifact.mjs pack
node scripts/ci-native-artifact.mjs verify
node scripts/lib/component-test-styles.mjs prepare-ci
npm run build:ci
npm run build:server-web
node scripts/ci-test-shards.mjs plan
node scripts/ci-build-artifact.mjs pack
node scripts/ci-build-artifact.mjs verify
npm run test:ci:shard -- 1
npm run test:ci:shard -- 2
npm run test:ci:shard -- 3
node scripts/ci-test-shards.mjs verify
```
