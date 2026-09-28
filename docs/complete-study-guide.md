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

- `shared/completeGuide/` — pure contracts and algorithms (config, selection
  expansion, reading snapshot, composer tree, estimate; later: items, plan, render,
  reference sections, print HTML).
- `electron/ai/completeGuide/` — vault access and the pass orchestrator (injected
  dependencies, testable with a fake model).
- Routed from `generateDeepResearchReportWithVisualPlan` in
  `electron/ai/deepResearch.ts`. Until the engine lands, a request carrying
  `completeGuide` fails closed instead of falling through to the vault-wide study report.

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
6. [ ] Exports: PDF with math and callouts in the Deep Research design, DOCX with
   native tables and equations, Markdown, separate review sheet, batch archive.
7. [ ] Figures from materials, optional web text and images.
8. [ ] Live campaign with DeepSeek `deepseek-flash` and OpenRouter `baai/bge-m3`
   under a USD 5 ledger ceiling.

## Validation

`node --test scripts/test-complete-guide-ui.mjs` renders callouts through the real
remark pipeline and checks the reader/composer wiring. `node scripts/e2e-complete-guide.mjs`
operates the production composer panel in Chromium (tick a unit, estimate, multi-subject
warning, unreadable source), checks callouts, KaTeX and `\ce{}` and writes
`docs/verification/complete-guide-{dark,light}.png`.

`scripts/test-complete-guide-engine.mjs` runs the whole orchestrator with a fake
model (full single reading per pass, anchoring, coverage, provenance, KaTeX,
audit/repair, cache reuse, resume, failed windows). `scripts/test-complete-guide-content.mjs`
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
