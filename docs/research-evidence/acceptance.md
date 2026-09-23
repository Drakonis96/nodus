# Acceptance evidence and limits

Implementation: `codex/agentic-corpus-notebooks`, starting from `f54995e7`.
[Draft PR #932](https://github.com/Drakonis96/nodus/pull/932) is the live validation
record. This table maps evidence to requirements; a passing row does not imply
exhaustive acceptance of every related combination.

| Area | Evidence | Limits |
| --- | --- | --- |
| Isolation | `test-research-isolation.mjs`; inherited write denials and actual external/unlisted-loopback denials before app launch; `2026-09-23-isolation.json` | Earlier combined network filter was insufficient; corrective record discloses two diagnostic TCP connects with no application bytes |
| Canonical identity and additive migration | `test-research-canonical-inventory.mjs`, `test-research-notebooks.mjs`, synthetic database migration fixtures | No production database migration was performed |
| Queue and shared indexes | `test-documentary-store.mjs`, `test-documentary-requests.mjs`, `test-documentary-writers.mjs` | Simulated clocks and separate database connections exercise leases; real SQLITE_FULL exercises rollback |
| Revisions and vector spaces | Same scripts; independent attachment heads, stale writer fencing, compatible vector adoption, dimension mismatch, atomic publications and retained old revision | Not an exhaustive combination of every document format and embedding provider |
| Scope | `test-research-corpus-run.mjs`, `test-research-notebooks.mjs`, `test-research-source-filters.mjs`, real adversarial campaign | Fixed/linked selection, explicit empty scopes, separable composite Ideas, permission changes, forged history/IDs and cancellation covered |
| Retrieval and citations | Lexical-only/store tests; real exact, comparison, multilingual and no-answer chat checks; independent-attachment page navigation | Citation existence is distinct from claim support; reference reads return candidates, not a complete bibliography graph |
| Whole-request budgets | `test-research-request-budget.mjs`; pre-dispatch reservation across instructions, history, tools, evidence and output | Presets are initial values, not calibrated benchmark results |
| Background execution | `test-research-background-process.mjs`; real `/private/tmp/nodus-research-w0c0lu`; `2026-09-23-background-processes.json` | Distinct OS PIDs and closure verified; extraction uses a Node thread inside its owned utility process for PDF.js compatibility |
| Managed/external MCP | `verify-managed-zotero-mcp.mjs`, `verify-independent-zotero.mjs`, real product harness | Managed stdio and selected external Streamable HTTP; SSE is not a tested product connection |
| Coexistence | `verify-research-runtime-lifecycle.mjs`; two disposable profiles, foreign executable fixture, immutable payload inventory and owned-process closure | No normal Zotero collection or external production MCP process was modified |
| Research Chat live activity | `test-research-activity.mjs`, corpus/worker/Concilium regressions; isolated `--activity` UI fixture | Actual backend operations are tested separately from synthetic UI/IPC events; no new live model campaign; Deep Research does not publish activity |
| UI and compatibility | Isolated notebook E2E; light/dark 1280×800 and 800×640 screenshots, keyboard focus, translated strings; full CI includes other vault engines | Not a complete screen-reader or assistive-technology audit |
| Installers | Four successful native installer runs at `736823e0`, hashes and roots in `2026-09-23-installers.json`; macOS signed and notarized | Actual native install, same-version reinstall and removal; a different-version upgrade remains untested. Windows/Linux use disposable hosted runners rather than macOS Seatbelt |
| Baseline comparison | `2026-09-23-comparison.json` and `.md`, identical three-PDF hashes and exact providers | One run per engine; no performance/quality advantage established. Long-report factual grounding remains unaccepted |
| Cost | Shared campaign `/private/tmp/nodus-research-iAyBHl/artifacts/cost-ledger.json` | 646 calls, $1.17735043 accounted upper bound including two unresolved maximum reservations; never reset during the campaign |

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
