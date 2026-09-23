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

### Bounded document reads and completed regression inventory

The public research coordinator now supports scoped searches inside one work,
physical-page ranges (at most four pages), adjacent passage context and reference
candidates. These operations share a run's evidence/round budget and reject foreign
works, attachments and passage identifiers. Reference candidates are explicitly
marked as requiring source review; they are not a parsed bibliography graph.
Physical and printed page labels remain separate.

The independent Zotero/Electron integration at
`/private/tmp/nodus-research-A6TNm0` passed actual second-attachment preparation,
page reading, immutable citation lookup and UI navigation. Its second PDF contains
SOUTH41 rather than the primary PDF's NORTH23. `attachment-reads.json` records the
exact identities and `attachment-citation.png` shows the correct PDF/page. No paid
provider was used. Notebook UI checks at `/private/tmp/nodus-research-12R4NY`
passed light/dark themes at 1280×800 and 800×640, accessible name lookup and 16-step
keyboard focus containment. Screenshots were visually inspected; the editor scrolls
inside its bounded dialog. These are targeted checks, not a complete accessibility
audit.

All 682 regression scripts ran in four isolated, two-worker shards: 164/171,
168/171, 168/170 and 169/170 initially passed. All 13 initial failures were corrected
and passed the 17-script follow-up at `/private/tmp/nodus-research-BYiuxh`, including
real offline OCR with provisioned language assets, Server Web, headless browser UI,
legacy attachments, sync and bounded documentary reads. Five additional notebook,
run and Deep Research regressions passed at `/private/tmp/nodus-research-TfI3nI`.
These runs span incremental source snapshots and are not described as one full
final-head suite pass. Full lint and application build passed
(`research-policy-lint.log`, `research-evidence-policy-build.log`).

General academic chat retains explicitly supplied conversation attachments;
notebooks still require explicit source promotion. General attachment identities
and revisions now participate in backend scope/history authorization. Academic
Deep Research no longer offers catalog-only work titles as factual citation
sources. All 15 writing languages instruct the writer to distinguish missing data
from negative findings, avoid inventing methods/causes or independent corroboration,
and ground each factual claim in its own passage. A paid rerun is required before
claiming these policies improve report quality.

### Matched baseline and extension comparison

Baseline `/private/tmp/nodus-research-8mDpAT` and extension
`/private/tmp/nodus-research-Cq5QqL` used byte-identical synthetic PDFs, verified by
`scripts/build-research-comparison.mjs`. Both passed four chat known-answer,
retrieval-marker and citation-existence checks and completed four Deep Research
routes. The generated comparison includes latency, process CPU/memory samples,
coverage, provider calls, tokens and cost. Its local artifacts are
`artifacts/research-comparison/comparison.json` and `comparison.md`.

This is one descriptive run per engine on three documents, with host contention;
no statistically meaningful speed or quality advantage is claimed. Baseline v1
comparative received a structural `strong` grade but falsely attributed both field
measurements to all three sources. Thus a quality grade or existing citation alone
is not factual acceptance. The extension's four reports were graded `weak` and
still contained unsupported inferences. The shared campaign ledger after the
matched comparison recorded 482 calls, a $0.85002289 accounted upper bound and no
unresolved reservations, below the $5 total ceiling.

Native CI run 35848154546 passed all four targets: Windows x64, Linux x64,
macOS ARM64 and macOS x64. It validates the private runtime, build and focused
native tests, with isolated Electron checks on macOS. Signing, notarization and
disposable native installation/update/uninstallation remain unverified.

### Last valid document publication

A profile-local `documentary_publications` table now atomically switches the set
of prepared attachments for a document after every lexical part is available,
before optional embeddings. Failed or incomplete replacements retain the previous
publication. New backend scopes explicitly pin its indexed revision and keys,
include them in their fingerprint and label returned evidence
`previous_indexed_revision`; the notebook UI translates its previous-revision
availability state in all 11 locales. Stale revisions do not mix with mutable
legacy passage/Idea/graph retrieval. Permission changes or removal of a contributing
attachment still prohibit access. Existing immutable citation identities remain
compatible.

Five isolated scripts passed at `/private/tmp/nodus-research-34oGrl`, including
new-run fallback, incomplete publication rejection, unchanged scope during a
partial rebuild, exact historical citation reads and revocation. Type checking
and full lint passed. The complete application build and new real-app publication
check are pending; the current paid campaign deliberately retains the prior build.

### Complete request envelope and repeated real campaign

Academic text requests now check their complete final system/user payload and
requested output allowance before provider dispatch, using a conservative UTF-8
upper bound plus framing reserve. Local models use their effective loaded window;
OpenRouter keeps the smaller advertised model/route context from its normal model
catalogue. The direct DeepSeek Flash contract is 1M tokens, verified against
https://api-docs.deepseek.com/quick_start/pricing/ on 2026-09-23. Unknown windows use
an explicitly conservative 32,768-token operating cap, not a claimed provider
capacity. Retrieval reserves three quarters of the envelope for instructions,
history/planning, tool framing and output; each actual call rechecks the final
payload. Async report limits do not leak into concurrent conversations. General
chat vision attachments retain the existing multimodal fit path.

Five isolated scripts passed at `/private/tmp/nodus-research-v8VlL4`, including
actual text/stream/JSON pre-dispatch rejection, UTF-8 accounting, async isolation,
provider metadata, shared run limits, Concilium and attachment compatibility.
The first attempt (`OqMp18`) exposed optional-image handling and premature model
resolution in offline previews; both were corrected. Lint passed. Build pending.

The writing-policy campaign at `/private/tmp/nodus-research-1uwhhc` used the same
PDF bytes and passed four chat known-answer/retrieval/citation-existence checks.
All Deep Research paths completed: v1 general `needs_review` (62.4), v2 general
`weak` (42.2), v1 comparative `weak` (8.4), v2 comparative `weak` (40.4). Their
citation verification counts (checked/partial/unsupported) were 21/5/0, 17/9/0,
16/11/0 and 23/14/0. Manual review still found inferences from undocumented methods
and replication details. The absence of an `unsupported` verdict is not proof that
all report prose is grounded. Quality acceptance remains open.

The durable matched comparison is in `docs/research-evidence/2026-09-23-comparison.*`.
Its corpus SHA-256 manifest, latencies, CPU/memory samples, calls, tokens, coverage,
quality and caveats are retained. The single campaign ledger now accounts for 602
calls, 1,358,970 input tokens, 620,713 output tokens, $1.14694438 upper-bound spend
and zero unresolved reservations. No further paid comparison has been started.

The complete publication/context application build subsequently passed:
`artifacts/research-context-build.log`. The current real Electron/Zotero run will
exercise that build without paid providers.

### Legacy citations, separable evidence and failure/coexistence checks

New academic runs adapt legacy passages to immutable backend receipts within the
existing profile-local scope record. Receipts require a current content-hash match
and authorized work before creation; direct foreign IDs, tampering, later notebook
restrictions and permission revocations fail closed. Rebuilding mutable legacy
rows cannot replace the cited text. Historical raw URLs remain available through
the compatibility API for old conversations.

Mixed-work Idea statements remain excluded from narrowed selections. An explicit
quotation can route to a permitted current passage only when the literal quote
exists in that passage. The adapter carries no global Idea label or synthesis;
unverifiable quotes and paraphrased/inseparable syntheses are excluded. Five
legacy/corpus scripts passed at `/private/tmp/nodus-research-I8Jlfw`; three scoped
quotation/ranking scripts passed at `/private/tmp/nodus-research-6E9Pwj`.

Two scripts passed at `/private/tmp/nodus-research-ObyFGl`, including an actual
SQLite page-limit `SQLITE_FULL` during lexical publication. The failed transaction
leaves the replacement unpublished and preserves the old manifest and searchable
text. This tests database-full rollback, not every filesystem failure mode.

The native private-runtime directory lifecycle passed at
`/private/tmp/nodus-research-qqv5cS` with a second profile at
`/private/tmp/nodus-research-62PAcM`. Both OS write boundaries were verified before
starting the clients. Two owned Python children used different explicit endpoints
and profile roots simultaneously; a third child started after same-version staged
replacement. All 5,817 runtime files/symlinks matched before and after execution.
Removing the owned runtime directory preserved both profiles and an unrelated
homonymous executable/configuration fixture. This is a real directory/runtime
integration test, **not** an OS installer, future-version migration, signing,
notarization or full Nodus uninstall test. The same check is now included in native
CI with its JSON evidence artifact.

The real publication/context Electron/Zotero build also passed at
`/private/tmp/nodus-research-QKMItM` without paid providers.

The lifecycle rerun at `/private/tmp/nodus-research-NJOjuG` (second profile
`/private/tmp/nodus-research-oJ4QLd`) additionally verified that every recorded owned
PID had exited before executable removal. Full lint and the complete updated
application build passed (`research-legacy-lint.log`, `research-legacy-build.log`).
