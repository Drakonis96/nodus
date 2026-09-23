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
