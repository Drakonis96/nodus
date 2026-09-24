# Acceptance evidence and limits

Implementation: `codex/agentic-corpus-notebooks`, starting from `f54995e7`.
[Draft PR #932](https://github.com/Drakonis96/nodus/pull/932) is the live validation
record. This table maps evidence to requirements; a passing row does not imply
exhaustive acceptance of every related combination.

| Area | Evidence | Limits |
| --- | --- | --- |
| Isolation | `test-research-isolation.mjs`; inherited write denials and actual external/unlisted-loopback denials before app launch; `2026-09-23-isolation.json` | Earlier combined network filter was insufficient; corrective record discloses two diagnostic TCP connects with no application bytes |
| Canonical identity and additive migration | `test-research-canonical-inventory.mjs`, `test-research-notebooks.mjs`, synthetic database migration fixtures | No production database migration was performed |
| Queue and shared indexes | `test-documentary-store.mjs`, `test-documentary-requests.mjs`, `test-documentary-writers.mjs`; real SIGKILL recovery `2026-09-24-queue-recovery.json` | Simulated clocks exercise leases; real SQLITE_FULL exercises rollback; the real kill covers text preparation only |
| Revisions and vector spaces | Same scripts; independent attachment heads, stale writer fencing, compatible vector adoption, dimension mismatch, atomic publications and retained old revision | Not an exhaustive combination of every document format and embedding provider |
| Scope | `test-research-corpus-run.mjs`, `test-research-notebooks.mjs`, `test-research-source-filters.mjs`, real adversarial campaign | Fixed/linked selection, explicit empty scopes, separable composite Ideas, permission changes, forged history/IDs and cancellation covered |
| Retrieval and citations | Lexical-only/store tests; real exact, comparison, multilingual and no-answer chat checks; independent-attachment page navigation | Citation existence is distinct from claim support; reference reads return candidates, not a complete bibliography graph |
| Whole-request budgets | `test-research-request-budget.mjs`; pre-dispatch reservation across instructions, history, tools, evidence and output | Presets are initial values, not calibrated benchmark results |
| Background execution | `test-research-background-process.mjs`; real `/private/tmp/nodus-research-w0c0lu`; `2026-09-23-background-processes.json` | Distinct OS PIDs and closure verified; extraction uses a Node thread inside its owned utility process for PDF.js compatibility |
| Managed/external MCP | `verify-managed-zotero-mcp.mjs`, `verify-independent-zotero.mjs`, real product harness | Managed stdio and selected external Streamable HTTP; SSE is not a tested product connection |
| Coexistence | `verify-research-runtime-lifecycle.mjs`; two disposable profiles, foreign executable fixture, immutable payload inventory and owned-process closure | No normal Zotero collection or external production MCP process was modified |
| Research Chat live activity | `test-research-activity.mjs`, corpus/worker/Concilium regressions; isolated `--activity` UI fixture | Actual backend operations are tested separately from synthetic UI/IPC events; no new live model campaign; Deep Research does not publish activity |
| UI and compatibility | Isolated notebook E2E; light/dark 1280×800 and 800×640 screenshots, keyboard focus, translated strings; full CI includes other vault engines | Not a complete screen-reader or assistive-technology audit |
| Installers | Four-target actual upgrade from published v5.6.0 to private `5.6.1-research.11` at `91a82aa0` (`2026-09-24-installers.json`); earlier same-version runs in `2026-09-23-installers.json`; macOS signed and notarized | Windows/Linux use disposable hosted runners rather than macOS Seatbelt; one upgrade path (v5.6.0) and small profiles |
| Baseline comparison | `2026-09-23-comparison.json` and `.md`, identical three-PDF hashes and exact providers; grounding reruns in `2026-09-24-grounding-campaigns.json` | One run per engine; no performance/quality advantage established. Final manual review in `2026-09-24-factual-review.json` found no unsupported retained claim, with listed wording defects and high run-to-run variance |
| Cost | Shared campaign `/private/tmp/nodus-research-iAyBHl/artifacts/cost-ledger.json` | 1,757 calls, USD 3.821334595 accounted upper bound including five unresolved maximum reservations; never reset |

## Verification checkpoints

- `736823e0`: [general CI](https://github.com/Drakonis96/nodus/actions/runs/35862272044)
  passed 3,814 tests, zero failures and two explicit skips; all application E2Es and
  cross-repository targets passed. Skips concern standalone Electron ABI and the
  unavailable sibling marketplace checkout.
- Same code: [native matrix](https://github.com/Drakonis96/nodus/actions/runs/35862271958)
  and [installer matrix](https://github.com/Drakonis96/nodus/actions/runs/35862266301)
  passed all four targets.
- `e7cea9f8`: local build/types/lint and real Electron/Zotero passed; four focused
  scripts passed in `/private/tmp/nodus-research-W8Ei0H`. The process change's
  [installer matrix](https://github.com/Drakonis96/nodus/actions/runs/35876799855)
  adds actual packaged PDF extraction and first-page source evidence. Consult the
  draft PR checks for its result and subsequent documentation-only revisions.

## Remaining acceptance work

Manually validate and improve factual grounding across all four long-report
engines before treating generated reports as accepted evidence. Verify an actual
upgrade between different released versions in disposable hosts. Expand the
robustness matrix, especially OCR-pending combinations, all malformed document
formats and combinations of simultaneous revision, permission and process changes.
No automated test count or citation-support score closes these gaps by itself.

## Closure implementation checkpoint (23 September, before final verification)

The user explicitly deferred OCR and paused final verification while the welcome
was redesigned. Scanned documents now remain recoverably blocked with
`documentary_ocr_deferred`; this route never starts OCR. The remaining acceptance
matrix must not be inferred from this implementation checkpoint.

Work completed before that pause:

- Build, both TypeScript targets and lint passed before the cinematic UI change.
- Twelve targeted isolated suites passed in `/private/tmp/nodus-research-i1JZj9`;
  nine additional suites already running when the pause arrived finished with
  nine passes in `/private/tmp/nodus-research-TeRGME` (two workers each).
- Queue/log browser fixtures passed in `/private/tmp/nodus-research-aCnaFC`.
  The Logs fixture supplies the new preparation snapshot, addressing the old
  general CI renderer timeout.
- The no-paid real Zotero run in `/private/tmp/nodus-research-jHLxyh` **failed**.
  Automatic original reading without manual connection or indexing returned the
  expected first-page evidence (saved in `nodus-automatic-original.json`), but a
  subsequent manual metadata call failed. Its adapter supplied an attachment
  argument to the metadata-only tool. The adapter now sends operation-specific
  arguments; rerunning that fix remains pending.
- The private runtime was rebuilt (5,816 inventoried files). No paid calls were
  made and the shared cost ledger was not reset.

Screenshot-only run `/private/tmp/nodus-research-crYtxW` rendered the new welcome
and decline confirmation in real Electron, with synthetic metadata and a dummy
embedding credential. Actual write/descendant/network denials were checked before
launch. No indexing or inference was started. `welcome-cinematic.png` and
`welcome-confirmation.png` are presentation evidence, not acceptance tests.

Still pending: final-head CI/native/installer runs, the newly implemented actual
v5.6.0-to-private-higher-version upgrade harness, final UI behavior and accessibility
checks, the rerun of real Zotero integration, live grounded-report review and the
same-corpus comparison. Keep the PR draft and acceptance open. Final verification was subsequently authorized by the user; results are recorded below.

### Academic-only Library follow-up

The proposed extension to other vault types was explicitly withdrawn before commit.
No Study/Teaching retrieval or indexing changes are included. New isolated tests
cover automatic academic additions, old-inventory baselining, preserved refusal,
opt-out, multi-source campaigns, shared-index retention, removal of published and
working vectors, stale-writer fencing, direct-citation revocation and re-import.

Focused runs (not the final acceptance campaign):

- `/private/tmp/nodus-research-NMIsHZ`: lifecycle and campaign suites passed.
- `/private/tmp/nodus-research-hjGogm`: lifecycle, cinematic welcome browser fixture
  and Library help/translation suites passed (three scripts, eight assertions/tests
  reported by their runners). Browser fixture covers No confirmation, explicit
  selection, configuration, local-only preparation and narrow-window layout.
- `/private/tmp/nodus-research-xZx6xf`: both lifecycle and campaign suites passed again,
  including the legacy-policy migration and preserved refusal.
- TypeScript (renderer and backend) and lint for changed implementation files passed.
- Earlier fixture failures were corrected: the publication fixture must temporarily
  unpause its own store before claiming a synthetic job, and policy expectations
  must reflect the newly authorized automatic-future default.

Final native/app/MCP/model/installer validation remains pending. The local focused
runs use inherited OS write/network denials and at most two workers. No production
source or credential was used and no paid call was made.


## Final verification in progress (23 September)

The user authorized the final campaign. Scope remains academic only; OCR remains
explicitly deferred. The acceptance decision is still open while live report review
and final-commit platform/upgrade jobs run.

- Production build and both TypeScript targets passed after the evidence-free
  report contract fix (`7a43eac4`).
- 37 distinct focused scripts passed after targeted reruns, plus the standalone
  OS-isolation suite. The complete run history, including initial failures, is
  retained in `2026-09-23-final-regressions.json`. Initial failures exposed missing
  abstention metadata, a fixture without simulated credentials, and loopback
  fixture ports denied by Seatbelt. Fixture-specific permitted ports now preserve
  external-network and unrelated-loopback denials.
- `/private/tmp/nodus-research-NR89Lv`: private MCP 0.13.0+nodus.1 over stdio
  passed with a synthetic HTTP endpoint; unauthorized item/library/attachment
  identities and changed revisions were rejected before returning evidence.
- `/private/tmp/nodus-research-bS1yLv`: real Zotero 10.0.3 with explicit disposable
  profile/data/endpoint and three identical-corpus PDFs passed. Actual Electron
  verified automatic original reading without indexing or manual connection,
  distinct attachments, citations, selection revocation, managed stdio and explicit
  external Streamable HTTP. All recorded owned workers closed. Zero model calls.
- `/private/tmp/nodus-research-cvBDDL`: actual Electron passed notebooks, welcome,
  text-only preparation through Queue, PDF citations and original reads. Keyboard
  focus and bounds were checked at 1280 and 800 pixels in both themes. Activity
  events are explicitly a deterministic IPC fixture, not live agent behavior.
  The combined fixture now compares campaign IDs before/after Later, preserving
  earlier notebook preparation rather than incorrectly expecting an empty queue.
- Each local app run first passed actual inside-write, outside-write, descendant,
  external-network and forbidden-loopback probes. Paths and process ownership are
  retained in the respective artifacts. This is stronger evidence than an absence
  of application errors, but not a claim about exhaustive OS auditing.

Paid evaluation continues the original ledger and isolated secret copies. Before
this rerun it contained 646 calls, USD 1.17735043 accounted including conservative
reservations, and two unresolved calls. The USD 5 cap has not been reset.

### Live campaign and remaining blockers

- `/private/tmp/nodus-research-QVEGmv`: all four Chat checks and all four academic
  Deep Research routes completed using `deepseek-flash` and `baai/bge-m3`. The
  identical-PDF comparison, latency, Electron CPU/memory samples, token/call/cost
  summaries and coverage are in `final-comparison/`.
- **Factual acceptance failed.** Manual review found unsupported independence and
  common-protocol premises surviving V2's semantic verifier. One verifier reason
  contradicts its own supported boolean. V2 comparative contains contradictory
  statements about whether missing temporal series can be established. Exact
  examples are preserved in `2026-09-23-factual-review.json`. Literal citation
  existence and automatic grades must not be used to close this failure.
- `/private/tmp/nodus-research-t4JQKj`: live adversarial history, foreign-ID,
  hostile-document instructions, cancellation on selection change and empty-scope
  cases passed. The injected URL was not followed; app networking remained bound
  to explicitly allowed local endpoints and the budgeted provider gate.
- `/private/tmp/nodus-research-qxurjO` and `...-DGahLS`: two private-runtime profiles,
  same-version directory replacement, owned child shutdown and unrelated resource
  preservation passed (5,817 files). This is not a native installer/upgrade test.
- Final local production build and changed implementation lint passed on
  `07f0e8bb`. That commit repairs empty citation parentheses; the live reports
  retain their original pre-fix formatting as evidence.
- Campaign total after adversarial checks: **854 calls, USD 1.566778505** accounted
  including unresolved reservations; **three unresolved** (including the cancelled
  request) retain their conservative upper bounds. Limit remains USD 5.

Final code-commit jobs: CI `35911521709`, native matrix `35911521693`, disposable
installer/actual v5.6.0 upgrade `35911650545`. At this checkpoint the final native
macOS ARM64 job passed; the other native jobs and general CI are still running.
The installer run is queued behind an obsolete run for which cancellation was
requested. No pending platform, signing/notarization or actual-version-upgrade
criterion is accepted. The PR remains draft and overall acceptance stays open.

## Closure campaign (24 September)

Commits `27fe5ad0`…`91a82aa0` (application code) plus documentation. Scope remains
academic Research only; OCR remains deferred; no web search.

### Deep Research factual grounding

Root cause of the 23 September rejection: the prose audit accepted the judge's
`supported` boolean even when its reason admitted a missing premise, never checked
presupposed premises separately, let the same proposition receive opposite verdicts
in different parts of one report, and had no report-level consistency check. The
rebuilt audit derives acceptance from atomic premises, carries rejections across
all parts, reconciles the whole report and records removed conflict pairs (details
in `../agentic-corpus-notebooks.md#grounding-closure-2026-09-24`).

Six paid campaigns on the identical three-PDF corpus (`2026-09-24-grounding-campaigns.json`):

| Build | Root | Outcome |
| --- | --- | --- |
| `b2d8174c` | `nodus-research-Ia0opa` | Independence premises removed; valid inferences over-removed, whole batches unverified |
| `d289bcc0` | `nodus-research-NOguMC` | **Main process froze** (exponential regex); fixed in `3f9265c0` |
| `3f9265c0` | `nodus-research-WiLeVl` | Aborted after chat to save budget (newer fixes committed) |
| `28c2743a` | `nodus-research-AgEtMO` | Self-denied conflict pair, orphan anaphora, `(])` debris; fixed in `73c21c3a` |
| `73c21c3a` | `nodus-research-ZRFQnB` | Orphaned-reference rule removed cited facts; withdrawn in `2a407f0e` |
| `2a407f0e` | `nodus-research-g3vRMS` | Final review below |

Manual review of the final run (`2026-09-24-factual-review.json`): no retained
factual claim without source support in V1/V2 general or V1/V2 comparative
(12, 9, 7 and 9 retained factual claims). Residual defects: two paraphrase
intensifications of supported attributions ("refutación" for *contradicts*,
"sin controles registrados" for *missing controls*), redundancy, and two dangling
anaphoric references. Variance between runs is high (V2 comparative kept 7, 0 and
9 factual claims in the last three runs). This is one run per route on a synthetic
corpus and not a guarantee; reports are shorter partial answers by design when
support is missing. Latency rose (188–334 s per route) and cost per campaign rose
to about USD 0.57.

### Remaining matrix: fixture versus real integration

| Criterion | Fixture evidence | Real integration evidence | Still open |
| --- | --- | --- | --- |
| Queue persistence and recovery | Store/requests: restart fencing, crashed owner keeps its failure allowance, lease expiry | **New** `verify-research-queue-recovery.mjs`: SIGKILL of real Electron with 1 running/3 queued, no orphaned processes, automatic completion after relaunch, one published revision per document, no live leases or duplicate ordinals (`2026-09-24-queue-recovery.json`) | Production single-instance lock after a crash (QA profile uses its own lock) |
| Page locators | Chunker/store tests for page-crossing passages | Same harness: final-page marker cited as "pp. 249–250" after fix `45665d23` | Other formats' locator semantics |
| Vault changes | `test-documentary-vault-ownership` (two owning vaults, UI switch across an extraction await), scope revalidation | Selection-change cancellation in the adversarial campaign; **real vault switch** during chat, Deep Research and preparation (`2026-09-24-robustness-scenarios.json`) | Deep Research is protected by refusing the switch, not by aborting |
| Batches and shared jobs | Persistent embedding batches, multi-source campaigns, shared lease retained by another campaign, withdrawal fencing | Real `bge-m3` preparation of three PDFs in every campaign; **two real vaults** preparing one document concurrently with a withdrawal | Removal of a document from one vault (no unlink API) |
| Provider failures | Missing key never switches provider, recoverable blocks are not failures, proxy/cost ledger tests | Real app against a **simulated** upstream behind the real proxy: 429, 500, malformed bodies, connection resets and persistent outages | Faults are simulated; real provider behaviour may differ |
| Revisions | Stale writer fencing, attachment heads, failed rebuild keeps previous revision | **Real Zotero 10.0.3** attachment bytes replaced after import; Global Library attachment replaced mid-extraction | Replacement exactly between pin and read inside one Deep Research run |
| Permissions | Notebook scopes, receipt revocation, forged IDs, promoted notes | Selection revocation in real Zotero; foreign IDs/history in the adversarial campaign | — |
| Migrations | Synthetic migration fixtures, legacy policy migration | v5.6.0 profile with a legacy note preserved across the actual upgrade | Large production-sized vaults (deliberately not used) |
| Accessibility | Preparation welcome browser fixture (now also on CI's macOS runner) | Keyboard focus containment and bounds; **axe-core** WCAG A/AA audit of six Research surfaces in both themes, 0 violations after fixes | Screen-reader test with a person |
| Other engines | Full CI suite, including other vault engines | CI real-app smoke plus Stellar, graph-tab and argument-map E2Es | — |

### CI, platforms and distribution at `91a82aa0`

- Earlier failure at `07f0e8bb`: general CI [35911521709](https://github.com/Drakonis96/nodus/actions/runs/35911521709)
  failed because the new cinematic welcome intercepted clicks in the Stellar
  demonstration E2E. Fixed in `b2d8174c` (the demonstration profiles record the
  welcome's Later decision); at that SHA CI passed with a third skip, the
  preparation welcome browser fixture, which looked for Chrome only at Linux paths.
  Fixed in `7628f15c`.
- General CI [35961146567](https://github.com/Drakonis96/nodus/actions/runs/35961146567):
  3,831 tests, 3,829 passed, 0 failed, 2 skipped (standalone Electron ABI suite and
  the absent sibling marketplace checkout); real-app smoke, Stellar, graph-tab and
  argument-map E2Es and three cross-repository targets passed.
- Native integration [35961146556](https://github.com/Drakonis96/nodus/actions/runs/35961146556):
  macOS ARM64, macOS x64, Windows x64 and Linux x64 passed (hash-locked private
  runtime, license inventory, managed stdio, two-profile lifecycle, focused suites).
- Disposable installers [35961146159](https://github.com/Drakonis96/nodus/actions/runs/35961146159):
  actual upgrade from the published v5.6.0 installer (hash-verified release asset)
  to the private test version `5.6.1-research.11`, launch of both versions,
  preservation of a legacy note, the profile and foreign resources, then native
  removal. All four targets passed (`2026-09-24-installers.json`). macOS x64 first
  failed before installation because the release-asset download returned HTTP 500;
  only that job was re-run on the same commit and passed. macOS packages were
  signed, notarized and verified before installation. The public version remains
  5.6.0 and nothing is published (`--publish never`).
- Local on the same application code: 39/39 focused isolated scripts and the 6/6
  standalone OS-isolation suite (`2026-09-24-final-regressions.json`); the real
  queue-recovery harness; each app run first proved inside-write, outside-write,
  descendant-write, external-network and forbidden-loopback denials.

### Cost

Same ledger, never reset: 1,757 calls, USD 3.821334595 accounted including five
unresolved reservations retained at their maximum (three from 23 September, one
from the aborted campaign, one failed call). Limit USD 5; about USD 1.18 unspent.


### Robustness scenarios (24 September, application build `2c7f1c4a`)

Eight real-Electron scenarios (`2026-09-24-robustness-scenarios.json`), each after
the five OS-boundary proofs, no paid calls. Where marked, the provider answer is
simulated behind the real proxy; the app, queue, databases and proxy are real.

- **Vault switch:** a Research Chat in flight is rejected with
  `research_scope_changed`; a Deep Research in flight refuses the switch; a
  preparation owned by vault A completes while the UI is in vault B, and B acquires
  no links or works (Global Library items are visible in every academic vault by design).
- **Provider outages (simulated):** during embeddings text stays searchable, states
  read queued/running while retrying and failed/`provider_failed` at the end, calls
  stop, no other provider is used and an explicit retry recovers; each chat fault
  is retried into a cited answer, a persistent outage returns an explicit error, and
  Deep Research fails closed with an abstention.
- **Attachment replacement:** in real Zotero, replaced bytes are refused with
  `research_source_revision_changed` by automatic and manual reads and never
  returned; restoring them restores access. In the Global Library, a replacement
  during extraction never publishes the old text as current, the document reads as
  not yet prepared, and re-preparing makes only the new text current.
- **Two vaults, one index:** concurrent requests share the same text and vector
  identities; a withdrawal keeps the other vault's interest alive; no passage is
  embedded twice and search never repeats a passage.
- **Kill during embeddings:** after SIGKILL and relaunch all vectors complete
  without user action; only the batch outstanding at the kill is re-sent, and it
  stays recorded as unknown (possible double charge).
- **Kill during text preparation:** rerun of the 250-page recovery harness.
- **Accessibility:** axe-core 4.13 found three pre-existing contrast failures; after
  `b5dc96a7`, 0 violations on all 12 surface/theme combinations. Not a screen-reader
  test with a person.

Defects fixed by these scenarios: `1d35b7a0` (retry and provider states in the
inventory), `ab322ae4` (a replaced source treated as unauthorized and shown as an
extraction failure), `b5dc96a7` (contrast). Local on the same code: 40/40 focused
isolated suites and the 6/6 OS-isolation suite; lint of every changed file.

**Platforms at `2c7f1c4a`:** general CI [35979349389](https://github.com/Drakonis96/nodus/actions/runs/35979349389)
(dispatched): the test job passed 3,830 tests with 0 failures and 2 skips, and all
E2Es passed; the three cross-repository jobs failed on "chemistry-studio: the pinned
version is the one the marketplace publishes" because the external marketplace now
publishes 2.5.6 while both this branch and `main` pin 2.5.1 (the latest `main` CI,
[35974026979](https://github.com/Drakonis96/nodus/actions/runs/35974026979), fails the
same three jobs). Native matrix [35979358827](https://github.com/Drakonis96/nodus/actions/runs/35979358827)
passed four targets. Installers [35979124961](https://github.com/Drakonis96/nodus/actions/runs/35979124961):
actual v5.6.0 → `5.6.1-research.12` upgrade, preservation and removal passed on all four
targets (`2026-09-24-installers-2c7f1c4a.json`); macOS x64 was re-run once after an HTTP 500
from a release asset during capability bootstrap.

**Branch state:** after these commits the PR conflicts with `main` (17 new commits;
one conflict in `electron/ai/researchAssistant.ts`), so pull-request workflows no
longer start. CI and the native matrix were dispatched manually on `2c7f1c4a`; the
conflict is left unresolved pending the owner's decision.
