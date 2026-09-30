# Toolkit, Presenter and App Studio decisions

Status: implemented architecture, checked on 2026-09-30. This replaces the original
Toolkit/Presenter plans and the completed App Studio prompt evaluation. Current
tools and navigation are defined in
[toolkitPages.ts](../../shared/toolkitPages.ts) and
[ToolkitView.tsx](../../src/views/ToolkitView.tsx).

## File processing

Convert's operation registry lives in
[convert/index.ts](../../electron/toolkit/convert/index.ts), with pure contracts in
[toolkitTypes.ts](../../shared/toolkitTypes.ts). The Electron-free
[job engine](../../electron/toolkit/toolkitJobs.ts) owns batch progress,
cooperative cancellation, error isolation and output naming. The
[IPC boundary](../../electron/ipc/toolkit.ts) and
[preload](../../electron/preload/toolkit.ts) expose typed operations and dialogs.

Original inputs are preserved. Output collisions receive incremental suffixes;
temporary writes are committed atomically, and cancellation must not leave a
partial output. Test these invariants independently of each conversion engine in
[test-toolkit-jobs.mjs](../../scripts/test-toolkit-jobs.mjs), then exercise real
document/image/PDF processing in the corresponding `test-toolkit-*.mjs` suites.
Convert's local operations and OCR Workspace's model-backed processing have
different requirements; the old claim that every Toolkit tool is entirely
offline does not describe the expanded Toolkit.

Protect's reference parity matrix and reproducible scenarios are retained in
[toolkit-protect-parity.md](toolkit-protect-parity.md). They remain useful
acceptance evidence rather than an implementation roadmap.

## PDF Presenter

Presenter has a global presentation library, conversion pipeline, audience and
presenter windows, slide/annotation state and a mobile controller. Shared state
and contracts live in [presenterState.ts](../../shared/presenterState.ts) and
[presenterTypes.ts](../../shared/presenterTypes.ts); the Desktop implementation is
under [electron/toolkit/presenter/](../../electron/toolkit/presenter/) and the
window/controller renderers under [src/presenter/](../../src/presenter/).

Preserve a single presentation-state model across these surfaces. Keep library
storage/conversion separate from window lifecycle and the controller server's
authentication boundary. Notes parsing and state transformations are testable
without launching a live presentation. See
[library tests](../../scripts/test-presenter-library.mjs),
[state tests](../../scripts/test-presenter-state.mjs),
[server tests](../../scripts/test-presenter-server.mjs) and
[performance tests](../../scripts/test-presenter-perf.mjs).

## App Studio

Generated mini-apps use a validated `nodus-app/v2` manifest with explicit storage
and multiplayer capabilities. Validation and prompts live in
[toolkitApps.ts](../../shared/toolkitApps.ts) and
[the generation pipeline](../../electron/ai/toolkitApps.ts).
Model output is untrusted: deterministic package validation must succeed before
the app reaches the user. Historical success rates or a model recommendation
from one July evaluation do not change that requirement.

[toolkitAppRuntime.ts](../../shared/toolkitAppRuntime.ts) builds a constrained
document; the host mounts it in an iframe allowing scripts/forms without shared
origin privileges. CSP blocks direct network access, external form submission,
workers, nested frames and objects. Storage/session access goes through the
scoped host bridge, with capability and message-source/token checks. Keep the
host's network channel outside the generated app's sandbox.

The participant server is in
[apps/server.ts](../../electron/toolkit/apps/server.ts). Offline ZIP export keeps
the manifest and separate source files through
[apps/export.ts](../../electron/toolkit/apps/export.ts); shared sessions still
require a running Nodus host. The
[App Studio tests](../../scripts/test-toolkit-apps.mjs) exercise package validation,
prompt constraints and the bundled app contract.
