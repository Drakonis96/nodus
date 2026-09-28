# Complete study guide (Study vault Deep Research mode)

Tracks item 4 of [issue #779](https://github.com/Drakonis96/nodus/issues/779):
generate a study report / review sheet from selected Materials, grounded in them,
separating AI-written explanation from source content, exportable to MD, PDF and DOCX.

## Product contract

- A new mode of the existing Study Deep Research modal, **Guía de estudio completa**.
  The retrieval-based *Investigación de estudio* is unchanged.
- The student picks sources in a hierarchical tree (course → subject → folder →
  unit/subunit → material, note or recording). One subject or unit is recommended;
  larger selections are warned about, never silently trimmed.
- Every selected source is read **in full** (the vault's extracted text with its
  `[[p. N]]` / `[[slide. N]]` markers, note Markdown, transcript segments) in several
  passes: reconnaissance map → unit coverage → exhaustive extraction → plan →
  section writing → verification → report-level synthesis.
- One chapter per unit, adapted to the subject: explanations, definitions, formulas
  with conditions (LaTeX), rules, procedures, worked examples from the materials,
  labelled AI examples/analogies (on by default, can be disabled), common mistakes,
  summary tables, points to memorize, self-check questions and "where to read more".
  Glossary, formula sheet and timeline are rendered from verified items. The last
  chapter is the **Ficha de repaso** (review sheet), also exportable on its own.
- Every statement from the materials cites material + page, slide, heading or minute.
  Labels and links are produced by code from provenance data, never by the model.
- Web text and web images are optional, off by default, and always labelled with
  their URL; they are never attributed to the student's materials.
- Free instructions, model, reasoning level, output language and approved document
  skills reuse the existing modal controls.

## Architecture

- `shared/completeGuide/` — pure contracts and algorithms: config, selection
  expansion, reading snapshot, composer tree, estimate, items and anchoring, plans,
  blocks and rendering, reference sections, figure and web-image selection, print HTML
  and the report input.
- `electron/ai/completeGuide/` — vault access, the pass orchestrator (injected
  dependencies, testable with a fake model), figure extraction and web images.
- Routed from `generateDeepResearchReportWithVisualPlan` in
  `electron/ai/deepResearch.ts` when the request carries `completeGuide` in the Study
  vault; other Deep Research modes are unchanged.

### Selection and snapshot (milestone 1)

- `resolveCompleteGuideSelection` expands course/subject/folder/unit nodes over the
  same organization data the tree shows: folders include subfolders and the units
  filed in them, units include subunits, legacy topic-only placements resolve to
  their subject/course. Exclusions always win. Unreadable sources are reported;
  only one transcript per recording is read (corrected, else literal, else notes).
- `buildCompleteGuideSnapshot` reads source text directly rather than the search
  index (which overlaps chunks and repeats them per placement): non-overlapping
  passages of at most 3,600 characters, split at paragraph/sentence ends, each with
  an exact locator (page, slide, heading offset, or ≤180 s lecture window).
  Sources are ordered by the user's organization positions (course → subject →
  folders → units), aliased `A#` (materials), `D#` (notes), `G#` (recordings).
  Repeated text across sources is marked as a duplicate and read once. Pages with no
  text are reported per source.
- `estimateCompleteGuide` gives calls, tokens, a USD range (only for models with a
  known list price, e.g. DeepSeek Flash) and minutes per stage, plus warnings.
- IPC: `research:completeGuide:catalog`, `research:completeGuide:preview`.

### Engine (milestones 3–4)

`electron/ai/completeGuide/core.ts` is a pure orchestrator with injected model,
cache, checkpoint and audit dependencies; `index.ts` binds it to the vault.

1. **Reconnaissance** — every readable passage is read in context-sized windows
   and mapped per source (topics with passage ranges, key terms). Cached.
2. **Chapters** — one chapter per unit (topic, else folder, else subject) in the
   user's organization order.
3. **Extraction** — every passage is read again in smaller windows guided by the
   source map. Items (definition, concept, formula with LaTeX/variables/conditions,
   rule, procedure, worked example, mistake, event, fact, figure) must carry a quote
   that code anchors in the named passage or a neighbour (exact or fuzzy after
   normalizing ligatures, hyphenation, quotes and case); unanchored items are
   discarded, damaged formulas are kept and flagged. Dense passages that yielded
   nothing get a second focused read. Exact and semantic (bge-m3) duplicates merge.
   Oversized windows are split, never truncated; failed windows are reported as
   unread parts, and more than 10 % failed windows fail the job (resumable).
4. **Plan** — per chapter; code assigns every item to exactly one section, drops
   invented ids and splits sections above 36 items.
5. **Writing** — typed blocks with `itemIds`. Material blocks without items are
   dropped; AI examples/analogies and AI-suggested mistakes are labelled from data
   and never link to materials; up to two continuation rounds cover missing items
   and anything left becomes a cited "Detalles adicionales" table.
6. **Verification** — KaTeX (with mhchem) validation and one repair call per
   section, otherwise code spans; numbers absent from the evidence (or every block
   in exhaustive mode) trigger the premise audit (`auditResearchProse`), with a
   rewrite from the evidence before any sentence is removed.
7. **Report level** — syllabus map, glossary, formula sheet, timeline (≥3 dated
   events), cross-source discrepancies (`findResearchConflicts`), review sheet
   (model only picks item ids and ≤20-word phrasings checked against the item),
   coverage per source and source index.

Reading passes are cached by `sha256(stage, prompt version, model, language,
passage hashes)`, so another version or a restart re-reads nothing unchanged;
plans, sections and final parts are checkpointed per run. Citation links carry the
locator and item id (`nodus://study/material/<id>?page=12&e=K0012`); the local
evidence sidecar answers the reader's exact-quote popover.

### Figures and the optional web (milestone 7)

- **Figures from the materials.** No model sees images (DeepSeek Flash has no vision).
  Extracted items of type `figure` (a caption or an explicit "Figura 3.2") name their
  page or slide; at most three per chapter and 24 per guide, one per page. PDF pages
  give crops of the images placed on them (`extractPdfPageFigures`, rendered at 2×),
  or the whole page when the art is vector-only; PPTX slides give their biggest
  picture, skipping template art repeated across the deck; image materials are used
  as they are. After saving, the figures are seeded as ready figures of the guide's
  document-visual manifest (`nodus.material-figure`), right after the block that
  cites their item, so the reader, PDF, Word and Markdown show them through the
  existing figure path. Their source opens the material at that page or slide.
- **Web text** (`webText`, off by default). One fast web step per chapter
  (`ResearchWebGrant`, intent `expand`) from the chapter title, sections and core
  items; passages are recorded as `web:<sha>`. The writer may add `web` blocks only
  with recorded passage ids; they are always audited against those passages,
  labelled "Fuente web: no procede de tus materiales", cited as `W1 · site`
  (`nodus://passage/web:<sha>`) and never cite materials. A final **Fuentes web**
  section lists the pages. A search outage only adds a warning.
- **Web images** (`webImages`, off by default). At most one per chapter (six in total),
  only for a core concept without a figure from the materials. SearXNG's `images`
  category searches `wikicommons.images` (name verified at the pinned upstream
  commit); the Commons API then confirms licence and author, and only CC0, public
  domain, CC BY and CC BY-SA files that share a term with the concept are kept.
  Commons' raster rendering is downloaded through the public-only guard (5 MB cap, no
  SVG ever parsed), re-encoded with sharp and seeded as `nodus.web-image` with a
  caption carrying title, author, licence and site; it is also listed under Fuentes
  web. Openverse stays off: SearXNG's result omits the licence.

## Milestones

1. [x] Foundations: types, fail-closed routing guard, selection, snapshot, tree,
   estimate, catalog/preview IPC.
2. [x] Infrastructure: run/cache/artifact tables (migration 194, local, not synced),
   usage meter, job-scoped output language (every Deep Research job now honours the
   language chosen in the form).
3. [x] Passes 1–3: reconnaissance, chapters from the user's units, anchored extraction.
4. [x] Passes 4–7: plan with code-checked coverage, block writer, verification
   (KaTeX, numbers, premise audit with repair), reference sections, review sheet.
5. [x] UI: mode selector, source tree, toggles, estimate, gallery chip/filter,
   callouts, locator links, exact-quote dialog, coverage panel, entry from Materials,
   translations in the 11 interface languages.
6. [x] Exports: PDF in the Deep Research design (cover, contents, numbered parts,
   chapters on new pages) with callout cards, tables and MathML formulas; Word with
   native tables, callout boxes, editable OMML equations (LaTeX source when a structure
   cannot be converted) and an updatable table of contents; Markdown with callouts and
   LaTeX; the review sheet on its own (two-column PDF, Word, Markdown); batch archives
   optionally include each guide's review sheet.
7. [x] Figures from materials, optional web text and images.
8. [x] Live campaign harness with DeepSeek `deepseek-flash` and OpenRouter
   `baai/bge-m3` under a USD 5 ledger ceiling, executed for real on 2026-09-28 (see
   [Live campaign](#live-campaign-scriptsverify-complete-guide-livemjs)).

## Validation

### Live campaign (`scripts/verify-complete-guide-live.mjs`)

Runs the real engine, the real premise audit and the real exports headlessly in Node
over a seeded synthetic corpus: two chemistry units (formulas with conditions,
`\ce{}`, a table, a figure caption, slides and a note that contradicts them), a
history unit (no scientific categories, a lecture transcript) and a fourth, highly
relevant material placed in a selected unit but excluded by the student. Every paid
call goes through `scripts/research-provider-proxy.mjs` and the campaign's cost
ledger, authorized for USD 5; the run stops before `--limit-usd` (default 4.8).

```sh
# Real providers (keys from the environment or from the installed app)
DEEPSEEK_API_KEY=… OPENROUTER_API_KEY=… node scripts/verify-complete-guide-live.mjs
./node_modules/.bin/electron scripts/with-nodus-keys.cjs --providers deepseek,openrouter -- node scripts/verify-complete-guide-live.mjs
# Mechanics only (scripted upstream; proxy, ledger, validators, audit and exports are real)
node scripts/verify-complete-guide-live.mjs --simulated
```

Checks: every readable passage is read; twelve seeded facts are extracted at their
exact page or slide and cited in the guide; the excluded material and its unique
fact never appear; AI blocks are labelled and never cite materials; all LaTeX
compiles; the review sheet carries the formulas; the note/slides contradiction is
reported (informative); Markdown, Word (native equations, tables), the PDF and the
review-sheet PDF are produced with PNG snapshots for visual review; a second version
reuses at least 90 % of the reading passes; the pre-run estimate covers the real
cost. Metrics per stage (calls, tokens, USD), coverage and every check are written
to `<root>/artifacts/complete-guide-metrics.json`. The simulated run passes every check
(about USD 0.02 of simulated usage).

#### Paid run, 2026-09-28 (DeepSeek `deepseek-flash` + OpenRouter `baai/bge-m3`)

Executed on the Mac with the keys the installed app already holds
(`scripts/with-nodus-keys.cjs`), on one campaign root reused across attempts so the
USD 5 authorization stayed cumulative. **USD 4.0552 of the USD 5 was spent** and the
run stopped there: one full campaign execution (both versions) costs about USD 2.00,
so the remaining USD 0.94 could not fund another. The final recorded run is in
[`docs/verification/complete-guide-live-metrics.json`](verification/complete-guide-live-metrics.json):
25 of 26 checks pass, one informative check reports what it is meant to report, and
one fails — the estimate, whose fix arrived after the last affordable run (see
"The estimate under-promised by five").

Cost of the recorded run (first version $1.0813, second $0.9222):

| stage | calls | input tokens | output tokens | USD |
| --- | --- | --- | --- | --- |
| recon | 5 | 2,493 | 4,737 | 0.0064 |
| extract | 5 | 4,250 | 8,884 | 0.0119 |
| plan | 3 | 3,338 | 2,869 | 0.0044 |
| write | 32 | 39,191 | 180,378 | 0.2282 |
| **verify (the premise audit)** | **136** | **143,680** | **645,791** | **0.8181** |
| finalize | 6 | 4,187 | 9,157 | 0.0122 |
| embed | 1 | 1,207 | 0 | 0.0000 |

What the paid run found, and what was fixed because of it:

- **The campaign did not speak to the provider the way the app does.** DeepSeek
  refuses `response_format: json_object` with a 400 when the prompt does not contain
  the word "json", and the claim audit's prompt does not; the application answers by
  replaying the request once without its optional fields
  (`aiClient`'s `optionalBody`/`replayRefusedOptionalFields`), and the harness sent it
  bare. Every audit call therefore died, the verification pass removed the whole
  block it had never audited (110 "removed" sentences in the first attempt), the
  conflict check never ran (0 conflicts) and the ledger booked the refused bounds as
  spend until the run aborted at its ceiling. The harness now mirrors the replay, and
  the scripted upstream enforces the same contract so the free run covers it.
- **The transport sent the bare output bound.** The application adds DeepSeek's
  thinking allowance before dispatch (`thinkingEffort.ts#thinkingOutputAllowance`);
  without it every audit batch hit the 6,000-token cap, and the audit answers
  truncation by bisecting, so the campaign paid several times the calls the
  application makes for the same work (149 calls truncated at exactly 6,000 tokens).
- **A refused request is not spend.** The proxy now settles a 4xx at zero — the
  reading `providerErrors.ts` already documents, "a 400/422 is a refusal, not a
  completed generation" — instead of keeping the reservation for ever.
- **The audit's citation is a URL.** The guide handed the premise audit its rendered
  Markdown link where every other caller (ideas, works, passages) passes a URL. The
  audit writes `[label](citation)` around every sentence it keeps, so the guide
  rendered a link inside a link — `[título]([A1 · p. 2](nodus://…))` — which Markdown
  refuses to parse: the reader, the PDF and Word printed the literal `[título](`
  text. 61 occurrences in the campaign's own guide, all inside audited blocks.
- **The estimate under-promised by five.** It said USD 0.11–0.23 for a run that cost
  USD 1.08, on constants nobody had measured, and modelled the premise audit — 76 %
  of a guide's cost — as a footnote of the writing. The constants now come from the
  measured run (`shared/completeGuide/estimate.ts`): one item per ~22 tokens of dense
  material, a section per ~2 items, one block in nine audited at four calls and
  ~36,000 output tokens each. For the same snapshot the estimate now returns
  USD 0.88–1.88, and
  `scripts/test-complete-guide-foundations.mjs` pins the ceiling against the measured
  USD 1.0813 so a future recalibration cannot under-promise again.
- **Four main-process errors had no translation.** The guide's "no readable text",
  "only in Study vaults", "no review sheet" and "could not read N of M parts"
  sentences reached a non-Spanish window untranslated or collapsed into the generic
  line; they are in `shared/mainProcessErrors.ts` now (the count of unread parts as a
  pattern, so the numbers survive) and `test-main-error-i18n.mjs` passes.
- **A pinned schema version.** `scripts/test-project-instructions.mjs` pins
  `SCHEMA_VERSION` so a bump is deliberate; migration 194 is, and the pin moved.

Two things the paid run reports and did not change:

- the contradiction between the note ("pH 7 at any temperature") and the slides
  ("pH 7 only at 25 °C") is found and printed in "Contradicciones entre fuentes";
- the informative check "the history unit uses no scientific callouts it has no
  content for" reports two `[!formula]` cards in the history chapter: the model
  expressed the turno pacífico as an alternation and the encasillado as a relation,
  each explained in prose. A stylistic stretch, not a defect, and the check is
  deliberately informative.

Artifacts of the recorded run (kept out of the repository: they are 2.4 MB and carry
the whole guide): `complete-guide.md`, `complete-guide.docx`, `complete-guide.pdf`
(60 pages), `complete-guide-review-sheet.pdf`/`.png`, `complete-guide-page.png`. The
PDF embeds its fonts (54 subsets), renders formulas as MathML, keeps every AI block
labelled ("Elaborado por IA: no procede de tus materiales") and shows no stray `$`
and no truncated text; the Word file carries 317 native equations (`m:oMath`), 149
tables and an updatable `TOC \h \o "1-2"` field.

### Unit, integration and browser tests

`node --test scripts/test-complete-guide-figures.mjs` covers figure selection and
placement, slide pictures without template art, real PDF crops and whole-page
fallback, and web images (licence filter, relevance, Commons titles, raster-only
downloads, attribution).

`node --test scripts/test-complete-guide-export.mjs` checks the print HTML (MathML,
callouts, tables, figures, anchors), the professional-report sections and the Word XML
(`m:oMath`, fractions, radicals, `w:tbl`, TOC field). The browser script also prints the
guide and the review sheet with JavaScript disabled and writes
`docs/verification/complete-guide-pdf-chapter.png`.

`node --test scripts/test-complete-guide-ui.mjs` renders callouts through the real
remark pipeline and checks the reader/composer wiring. `node scripts/e2e-complete-guide.mjs`
operates the production composer panel in Chromium (tick a unit, estimate, multi-subject
warning, unreadable source), checks callouts, KaTeX and `\ce{}` and writes
`docs/verification/complete-guide-{dark,light}.png`.

`scripts/test-complete-guide-engine.mjs` runs the whole orchestrator with a fake
model (full single reading per pass, anchoring, coverage, provenance, KaTeX,
audit/repair, cache reuse, resume, failed windows, and figures, web text and web
images through fake dependencies: requests, labels, audit, W citations, the Fuentes
web section, checkpoints and fail-soft outages). `scripts/test-complete-guide-content.mjs`
covers anchoring edge cases, sanitizing, provenance, plans, locators, reference
sections and the 15 label packs.

`node --test scripts/test-complete-guide-infrastructure.mjs` runs migration 194 on
`node:sqlite` and covers frozen snapshots, resumable checkpoints, stale-run pruning,
the shared LRU reading cache, sidecar deletion, the job language scope and nested
usage meters.

`node --test scripts/test-complete-guide-foundations.mjs` covers config
validation, nested folder/unit expansion, legacy placements, exclusions, transcript
preference, lossless non-overlapping splitting, page/slide/offset/time locators,
ordering by organization position, duplicate passages, tree toggles and the estimate.
