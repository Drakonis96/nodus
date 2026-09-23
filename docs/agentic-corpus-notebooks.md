# Layered documentary research and notebooks

## Development contract

This work extends academic Research Chat and Deep Research. Other vault engines
retain their contracts. Documents and compatible passage indexes are shared;
ideas, profiles and notebooks retain their vault ownership. Internet discovery
is outside this implementation.

The implementation starts from `f54995e7` on a dedicated branch. The pull request
must remain draft, with incremental verified commits and pushes. No release,
tag, merge or rewrite of published history is part of this work.

## Audit findings

- Library v2 already provides immutable canonical IDs, source identities and
  aliases. Zotero identity includes library type, library ID and item key.
- `hierarchicalRetrieval` already combines independent lexical/vector lanes and
  rank fusion. Some lower-level repositories still interpret an empty ID list
  as unscoped; those boundaries must fail closed.
- The passage embedding pipeline keeps its queue in memory. Documentary Index
  independently prepares passages and publishes them with the profile. Basic
  preparation must become durable and independent of enriched analysis.
- Research Chat has saved conversations and source filters; Deep Research also
  retrieves through writing-workshop snapshots. Both paths need the same scope.
- Nodus exposes an MCP server; consuming Zotero MCP requires a separate client.
- The old startup registered `nodus://` before its profile override. A bootstrap
  now applies the isolated profile before loading the application graph.

## Isolation

`NODUS_ISOLATED_ROOT` requires a canonical root and matching `isolation.json`.
The bootstrap configures Electron storage and private temporary directories
before dynamically loading the application. Isolated startup skips protocol
registration, automatic integrations, credential recovery, updates and deferred
plugin migration. The operating-system harness separately restricts writes for
the process tree; setting environment variables alone is not sufficient.

`scripts/research-isolation.mjs` creates only fresh synthetic profiles. Its macOS
sandbox test performs a real denied write against a disposable sentinel, never
against production. Production Nodus, Zotero and MCP directories are denied.
Application testing must not begin until this check succeeds.

On macOS, Chromium cannot install a nested Seatbelt sandbox. The isolated E2E
launcher therefore uses the already-inherited OS policy for the entire process
tree (`--no-sandbox` only in that launcher), retaining context isolation and the
restricted preload. Chromium's singleton also creates sockets outside its
configured temp directory; isolated runs use an exclusive profile-local lock,
while ordinary application startup retains Electron's singleton behavior.

### Verified startup, 2026-09-23

- Four isolation tests passed, including actual denied writes and duplicate
  profile ownership.
- Full production build and Electron TypeScript checks passed.
- A fresh Electron 43.4.0 instance reached the onboarding interface under the
  OS write boundary. Its native title and visible development badge were checked.
- All six audited database opens were inside the new profile. `userData`,
  `sessionData`, temporary storage, application data and downloads resolved below
  `/private/tmp/nodus-research-fk0o3o`.
- No model calls, production fixtures or real Zotero connection were involved.
  Startup screenshot and machine-readable report remain in that test root.

Only encrypted DeepSeek and OpenRouter credentials may be copied by a separate,
read-only fixture helper, following the user's explicit authorization. Never
load the production vault registry, preferences, databases or document corpus.
Real-model tests are limited to `deepseek-flash` and `baai/bge-m3` and a combined
USD 5 ceiling. No paid inference has been performed at this stage.

## Delivery checklist

- [ ] Isolated Electron and synthetic Zotero fixtures verified
- [ ] Managed Zotero MCP packaging and third-party notices
- [ ] Identity, source scope, evidence and preparation contracts
- [ ] Durable preparation and compatible shared indexes
- [ ] Shared retrieval and strict source boundaries
- [ ] Read-only scoped MCP integration and coexistence
- [ ] Academic notebooks and persistent source selections
- [ ] Presets, UI states and all translations
- [ ] Migrations, real Electron regression and provider evaluation

Checked items must describe executable, tested functionality, not designs.

### Incremental integration evidence, 2026-09-23

- `scripts/e2e-research-isolated.mjs --notebooks` passed in
  `/private/tmp/nodus-research-66KJg2`: three synthetic collections and sources,
  fixed membership with an exclusion, lexical publication without a provider,
  scoped evidence search, notebook editor and Escape focus handling. The report
  records actual OS write denial, private Electron paths and zero model calls.
- `scripts/verify-independent-zotero.mjs` passed in
  `/private/tmp/nodus-research-9DvBFN`: Zotero 10.0.3 with explicit private profile
  and data directory, synthetic PDF imports using Zotero's supported APIs, an
  independent local endpoint, and the private MCP runtime over stdio. It read
  physical page 1 containing NORTH23 and rejected an unselected item.
- `scripts/verify-managed-zotero-mcp.mjs` passed against a synthetic HTTP fixture
  in `/private/tmp/nodus-research-AUH7n3`, including the local server identity
  header, four read-only tools, revision checks and rejected identifiers.
- Six focused regression tests passed (notebooks, durable store, hierarchical
  retrieval and source filters). Renderer and Electron type checks and targeted
  lint passed. These are local macOS ARM64 results, not native cross-platform
  installation or external HTTP integration results.

The UI and basic shared retrieval are implemented incrementally. Deep Research,
all legacy writers, scoped citation navigation, managed connector settings,
packaging/signing across platforms and the paid comparison remain unfinished.
The two credential helpers exist but have not read production secrets. No paid
inference has been performed.

### Scoped execution and recovery milestone

Academic Deep Research now binds its four engine/approach routes to a backend
scope and a single evidence budget across discovery and sections. The profile
preparation barrier is removed from those routes. Scoped Ideas, gaps, themes,
contradictions and independent documentary evidence feed the existing writer
and citation-support auditor. Other vault engines retain their dispatch paths.

Shared passage citations include a persisted scope identifier. Direct reads
revalidate membership, source permissions and revision; the UI distinguishes
abstract evidence from full text. `/private/tmp/nodus-research-6ts8sn` passed the
real Electron citation lookup, fabricated-scope rejection and exclusion-after-
publication checks, with seven audited private database opens and zero calls.

Migration 180 adds backend-owned conversation provenance. Historical messages
stay visible, while only matching, server-recorded turns can re-enter a notebook
prompt. Deleting a notebook also removes its conversation selection metadata.

Source discovery now has transactional leases before the text fingerprint is
known, with restart recovery, fencing, pause, cancellation and bounded retries.
Traditional extraction stages files through the existing document worker without
creating Global Library records. Source maps are accepted only for matching
reader bytes; basic extraction explicitly disables remote OCR. Chunking retains
the 280/60 starting policy and adds a 4096-byte UTF-8 bound, versioned separately.

Three additional regression scripts pass for scope/history/budget enforcement,
source-job recovery and notebook persistence. The traditional native PDF worker
path, full report generation, platform packaging and provider comparison still
need integration evidence. No claim of full acceptance is made at this milestone.

### Managed and external Zotero connector milestone

The private runtime is now included in packaging resources. Its build verifies
both runtime archives and installed bytes, inventories Python native-library
licenses and every installed distribution, and removes build-only packages.
Two wheel license omissions and one missing upstream zlib-ng license are filled
from pinned source artifacts; their origins and hashes are recorded. The native
CI matrix builds each platform separately. These workflows do not constitute
completed signing, notarization or installer/uninstaller acceptance.

The notebook editor exposes managed stdio and explicit external Streamable HTTP.
Only the backend constructs a manifest from authorized source revisions. Both
transports must declare the exact scope fingerprint and the four expected read
operations. Closing a managed connection removes its private configuration;
closing an external connection does not own or terminate its server.

`verify-independent-zotero.mjs --nodus` passed in
`/private/tmp/nodus-research-K1kvIv`: Zotero 10.0.3 with separate profile and data,
three synthetic collections and PDFs, real Nodus import, managed MCP metadata
and full-text reads, lexical PDF retrieval with physical page 1, excluded-source
rejection, and connection revocation after a manual selection change. The same
run passed external Streamable HTTP, rejected a mismatched server scope, and
verified that disconnect and rejection preserved the external fixture process.
The fixture owner subsequently stopped that process. The OS write-boundary
negative probe passed before either application started. No paid models were
called. Short single-sentence PDFs in an earlier fixture correctly fell back to
abstracts after the existing extraction-quality threshold rejected them; the
full-text acceptance fixture now contains a complete synthetic paragraph.

The shared cost ledger additionally has regression coverage for durable unknown
usage, the strict combined five-dollar boundary, invalid numbers, corrupt state
and idempotent settlement. It is not yet wired to a live inference campaign.

### Shared writers and retrieval controls milestone

The passage embedding pipeline and Documentary Index now call the shared
preparation service. Text is published lexically before embeddings. Persistent
embedding-operation leases are acquired before provider dispatch, compatible
vectors are reused, and migration 181 adds a vault publication token so a slower
legacy writer cannot replace newer passages. Explicit preparation can retry a
failed stage; cancellation revokes leases without deleting published evidence.

General academic chat now resolves an explicit active-vault scope as well as
notebook chat. Both exclude inseparable mixed-source Ideas and unproven historical
turns; external skills are disabled on these academic routes. Specialized Deep
Research probe planning receives an authorized snapshot and extends it using the
same execution budget. Other vault engine dispatch remains separate.

Notebook controls include validated custom budgets, a manual cosine threshold
bound to a fingerprint of the complete embedding configuration, linked collection
change counts, and cancellation. New strings cover all eleven translated locales.
Five focused scripts passed under the verified OS boundary in
`/private/tmp/nodus-research-W8lYxw`, including actual SQLite writer fencing and
pre-dispatch exclusion with a deterministic provider double. Real paid provider
inference remains unperformed.

The initial native CI exposed packaging/test-harness defects: Windows CRLF in tar
listings, parallel lazy extraction of Electron, and the absence of cryptography
50 wheels for Intel macOS. Fixes normalize listings, materialize Electron before
parallel workers, and build current cryptography against pinned static OpenSSL
on Intel. Native CI must pass before those targets are described as verified.

### Regression and native follow-up

The first full Seatbelt run (`/private/tmp/nodus-research-UcLH7R`) completed 3,561 checks: 3,466 passed, 94 failed and one skipped. This is diagnostic evidence, not an acceptance pass. It exposed the schema constant still set to 180 after migration 181, old source-shape assertions, and established tests writing build files into the original checkout. The schema and assertions are corrected; `--all` now uses an APFS-cloned disposable checkout inside the allowed root. The isolation test runs its own negative probes before the inherited sandbox because Seatbelt cannot be nested. Production Zotero-copy tests receive an explicit absent synthetic path and must not fall back to the user's library.

Native CI at `19d51185` built the ARM runtime and application and passed the four focused native suites, then timed out capturing an Electron screenshot. The harness now uses software rendering. Windows detected checkout line-ending changes in pinned supplemental licenses; those files are now byte-preserved by Git attributes. Intel OpenSSL `install_sw -j2` ran duplicate compilation targets; compilation and serial installation are now separate. These fixes require another native run. The runtime is not yet claimed to pass all platforms.

Focused writer/schema and research-language checks passed under the OS boundary at `/private/tmp/nodus-research-vZ7BDy`. The provider gate's offline dispatcher test passed at `/private/tmp/nodus-research-tHAyvv`; no secrets were imported and no paid calls were made in those checks.

### First real-provider campaign (2026-09-23)

The authorized encrypted DeepSeek and OpenRouter files were imported read-only into `/private/tmp/nodus-research-CrhnDJ/profile/secrets`. No other production credential or configuration was imported. Electron and Zotero retained the inherited offline/write-confined OS policy. A separate loopback gate alone dispatched exact `deepseek-flash` and `baai/bge-m3` requests, reserving a conservative bound before every call in the **single campaign ledger** `/private/tmp/nodus-research-iAyBHl/artifacts/cost-ledger.json`. Reuse this campaign root for every subsequent paid run; never reset the ledger to gain another budget.

The real Zotero 10.0.3 import, managed stdio and external Streamable HTTP scope handshakes passed. All three synthetic PDFs acquired 1,024-dimensional embeddings. Four chat cases passed their known-answer and citation-existence checks: exact quote (6.09 s), comparison (6.93 s), French query (3.65 s), and absent east-field measurement (5.85 s). The notebook search control missed the comparative known marker because its IPC still used lexical-only retrieval; chat's hybrid path did find it. This discrepancy is a pending fix, not a retrieval pass.

Academic Deep Research v1 completed without Ideas or document profiles in 68.11 s, produced 1,017 words and cited all three sources. Its separate support audit checked 10 citations: six partial, zero unsupported. This is not a claim of full entailment for every citation. The harness requested a two-section ceiling but the existing core clamps it to three; the report recorded three sections. V2 and specialized approaches still need real-provider checks.

Thirty calls used an accounted upper bound of **$0.03684347**: OpenRouter reports actual per-request cost; DeepSeek usage is valued conservatively at peak cache-miss prices ($0.30/M input and $1.20/M output). No unresolved reservations remain. Evidence is in `artifacts/live-campaign.json`, `live-preparation.json`, `live-process-metrics.json` and `zotero-startup.json` under the fixture root; provider metrics and the durable ledger are under the campaign root. Baseline comparison and broad acceptance remain unfinished.

### Unified traversal and compatibility follow-up

Academic chat and Deep Research now share `ResearchCorpusRun`, including bounded
Auto Expand and a common execution ledger. Deep Research persists its query trail,
source counts and partial-coverage flag with the report. Notebook search now uses
the configured embeddings with a lexical fallback; the comparative live-provider
case must be repeated to verify the earlier discrepancy. Notebook conversation
overrides are validated in the backend. Historic immutable documentary citations
remain readable after a content revision while current permissions still apply;
the citation UI labels them and suppresses jumps into a newer source revision.

The application build passed. Twelve focused suites passed under Seatbelt at
`/private/tmp/nodus-research-WadGHn`, including scope/history revocation, shared
budgets, schema demotion recovery and the corrected TypeScript test loaders.
The second full-suite attempt at `/private/tmp/nodus-research-Bjhwkw` was
interrupted and is not a full pass. Existing installer simulations now respect
the disposable scratch directory; the historical helper simulation changes only
its scratch prefix, not its bundle-selection logic.

Native run 35843189094 passed Linux and macOS ARM (including real isolated
Electron on ARM). Windows installed the hash-locked runtime but failed importing
pywin32 from a `--target` directory. Intel compiled pinned OpenSSL but could not
find its installed maturin executable. Explicit private-runtime paths address
both failures; those two targets still require a successful native rerun.


### Attachment identities, explicit authored sources and report evidence

Attachments now retain independent index heads, identities and revision hashes;
lexical publication for each attachment precedes optional vectors. Citation
navigation carries the attachment identifier to the reader. Synthetic SQLite and
worker checks passed at `/private/tmp/nodus-research-Z7nqdc` and
`/private/tmp/nodus-research-Wk439K`, including two attachments and immutable
historical citation reads after content changes. Canonical inventory deduplication
preserves user/group library identity and passed at
`/private/tmp/nodus-research-ZAWeFv`.

Notes and generated reports are selectable notebook references, excluded from
general academic source discovery unless explicitly selected. Their evidence
records authored provenance and a non-primary-evidence limitation. The source
selection/trash regression passed at `/private/tmp/nodus-research-vUKw0o`.
Conversational attachment promotion remains outstanding.

The unified real campaign at `/private/tmp/nodus-research-iZ6IZk` passed all four
known-answer, known-retrieval-marker and citation-existence chat checks. All four
academic Deep Research paths completed and recorded scoped traversal. Their
quality audits still reported `needs_review`; v2 comparative reported nine
unsupported claims and three internal contradictions. These are quality failures,
not acceptance passes. Investigation found that later sections lost already-used
evidence once the shared discovery budget expired and that planners omitted
available documentary passages. Both paths now preserve and reuse authorized
evidence, and all 15 planner languages include the documentary contract. Focused
prompt, sync-policy and citation UI checks passed at
`/private/tmp/nodus-research-lpNzLL`; a fourth nonexistent test name was a harness
invocation error, now rejected before execution. The application build passed in
`artifacts/research-notes-build.log`. A new live quality campaign is pending.

The real baseline uses `f54995e7` plus recorded isolation/provider-gate-only
instrumentation in `/private/tmp/nodus-research-lSi4Gs/artifacts/baseline.json`.
Baseline run `/private/tmp/nodus-research-4DGqSt` imported the exact same PDF bytes,
prepared three passages, and passed all four chat known-answer/citation-existence
checks. It did not run Deep Research. At the end of those runs the one shared
campaign ledger recorded 164 calls and a $0.27879616 accounted upper bound.

Native CI run 35845344992 passed macOS ARM, macOS Intel and Linux. Windows passed
private runtime startup and the application build but its focused tests could not
spawn the npm Electron shim. Test loaders now use Electron's actual executable;
a Windows rerun is required. Signing/notarization and disposable native
installation/update/removal remain unverified. Full-suite attempts using Node's
shared runner were interrupted; the harness now owns two independent single-file
runners, retains every result and continues after failures. No interrupted run is
counted as a suite pass.


### Explicit attachment promotion and revision revocation

Conversational text/PDF attachments can now be explicitly selected in an academic
notebook without copying their original files. Selection references their owning
conversation; removing that conversation revokes access. The reader rejects
traversal, metadata identity mismatches and symlink aliases. Image-only/unsupported
attachments are not presented as extracted text. Notes and reports retain authored
provenance; note edits and notebook selection changes notify the consent-gated
preparation queue. General research does not implicitly include these sources.

Deep Research continues to use its immutable indexed revisions when a document
changes. Mutable legacy passages and graph derivatives are discarded on a revision
change instead of substituting newer material. Removing a pinned attachment or
revoking source access aborts access, including historical citations. Retrieval
rechecks permissions after its worker returns and marks candidate truncation or
missing prepared sources as partial coverage.

Six focused scripts passed at `/private/tmp/nodus-research-q1hEe5`: source selection,
history/revocation, immutable revision reads, transactional writers, Concilium,
sync compatibility and text recovery. The earlier explicit attachment tests also
passed at `/private/tmp/nodus-research-Hm3Qs5`. Full lint passed. The application
build passed before the final revision/coverage follow-up; a final build remains
necessary. Notebook definitions/associations are now classified as authored sync
rows, while permission receipts and writer fencing remain profile-local.

Full-suite shard 1 (`/private/tmp/nodus-research-6d5uzL`) completed 164/171 scripts
successfully; shard 2 (`/private/tmp/nodus-research-MWECby`) completed 168/171.
Failures exposed missing sync-table classification, the old CommonJS test loader,
a stale Concilium skill expectation, missing Server Web build assets and Chrome's
attempt to create files outside the sandbox. These have corrections or isolated
retests pending. The OCR test's four cases failed because the offline boundary
blocked its unprovisioned language-data download; its owned process group was
terminated after it failed to exit. This is recorded in `ocr-termination.json`,
not counted as a pass. The harness supports copying existing system OCR assets
with a SHA-256 manifest and uses a dedicated headless browser for UI tests.

Native run 35848154546 passed Windows and macOS ARM, including runtime startup,
application build and focused regressions. The remaining native jobs were still
running at this checkpoint. No signing/notarization or native install lifecycle
acceptance is claimed.

Real campaign `/private/tmp/nodus-research-Cq5QqL` passed four chat known-answer,
retrieval-marker and citation-existence checks and completed all four Deep Research
routes. Their report quality remained **weak**. Citation support audit totals were:
v1 general 16 checked/9 partial/0 unsupported; v2 general 15/2/0;
v1 comparative 23/17/1; v2 comparative 16/11/0. The shared ledger then recorded
288 calls and a $0.58171052 accounted upper bound, with no unresolved reservations.
The source-reuse defect is corrected; these quality scores are not acceptance.

Baseline attempt `/private/tmp/nodus-research-XMrHkl` made no paid calls: changing
Electron's HOME prevented access to the OS encryption context for the authorized
copied credentials. It is a harness failure, not a baseline capability result.
Only the browser/unit-test environment now changes HOME; Electron retains its
existing OS keychain identity while all application paths and writes remain under
the verified isolated root. A new baseline Deep Research campaign is running.
