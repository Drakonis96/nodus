# Complete study guide (Study vault Deep Research mode)

Tracks item 4 of [issue #779](https://github.com/jorgepb96/nodus/issues/779):
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
- One chapter per unit, written as prose. It opens with its chronology (when the items
  carry dates), its key concepts and a cited summary; it explains the topic section by
  section, with definitions, laws and formulas (LaTeX, with their conditions) written into
  the paragraphs; a box is kept only for a worked example from the materials, a warning
  about a common mistake, at most one AI addition per section (labelled, on by default,
  can be disabled) and optional web text; and it ends with its self-check questions,
  mixed across the sections, and their answers, then "where to read more". Glossary,
  formula sheet and timeline are rendered from verified items. The last part is the
  **Ficha de repaso** (review sheet), also exportable on its own. Why the guide reads this
  way, and what was measured, is under [Report design](#report-design-prose-first).
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
5. **Writing** — one call per section returns typed blocks with `itemIds`: prose
   paragraphs (`explanation`, each cited from its own items), worked examples, mistakes,
   tables, questions and at most one AI block. Material blocks without items are
   dropped; AI examples/analogies and AI-suggested mistakes are labelled from data
   and never link to materials; the second and later AI blocks of a section (and every
   analogy or invented example in a chapter about events) are dropped; "to memorize"
   lists are dropped; up to two continuation rounds cover missing items and anything
   left becomes a cited "Detalles adicionales" table. One more call per chapter writes
   its cited summary.
6. **Verification** — KaTeX (with mhchem) validation and one repair call per
   section, otherwise code spans. Standard mode audits every explanation paragraph,
   chapter-summary paragraph and practice answer against its own evidence, as well as
   web text and other material blocks containing unsupported quantities. Exhaustive
   mode audits all material prose. The premise audit (`auditResearchProse`) attempts a
   rewrite from the evidence before removing sentences. Questions whose answers lose
   all supported content are removed; an audit outage fails the section before it is
   checkpointed, so a retry resumes rather than publishing unchecked prose.
7. **Report level** — the overview (the abstract) and the connections between topics,
   each chapter's chronology and key concepts (code, from verified items), a guide-wide
   chronology when dates span chapters, glossary, formula sheet, cross-source discrepancies
   (`findResearchConflicts`), review sheet (model only picks item ids and ≤20-word
   phrasings checked against the item), and sources with their coverage.

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
2. [x] Infrastructure: run/cache/artifact tables (migration 197, local, not synced),
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
9. [x] Report redesign after reading the first paid guide: prose first, boxes only for a
   different mode of reading, the AI notice said once, a chronology / key concepts / summary
   opening for every chapter, questions gathered at the chapter's end, a cover without the
   decorative motif (see [Report design](#report-design-prose-first)).

## Report design: prose first

The original paid report was read before redesigning the writer: 29 extracted items
became 130 callout boxes across three chapters. Definitions, laws, procedures and
repeated memory lists competed for attention; history had formula cards for political
mechanisms, date drills and no chronology. The decorative cover motif conveyed no
information. A passing mechanical campaign had not established a readable report.

### Research synthesis and design decisions

Sources were checked online on 2026-09-30. These are evidence-based design choices,
not a claim that this particular guide improves examination results. The reviews
also distinguish evidence from laboratory tasks from classroom effectiveness.

- **Retrieval and spacing.** Dunlosky et al. rate practice testing and distributed
  practice highly; passive rereading, highlighting and summarization have more limited
  utility. Agarwal, Nunes and Blunt's classroom review found benefits across subjects
  and educational levels, while noting limited geographical representation. The guide
  therefore pairs explanation with questions requiring recall, application or comparison,
  followed by answers rather than immediately revealing each answer. The usage text asks
  students to attempt questions without looking and return to them on later days. A
  printed guide supports spaced use; it does not implement an adaptive scheduling system.
  [Dunlosky et al. (2013)](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html),
  [Agarwal et al. (2021)](https://doi.org/10.1007/s10648-021-09595-9).
- **Cognitive load and signaling.** Mayer's 2021 synthesis recommends removing
  extraneous material, signaling organization and placing related representations
  together. We apply these multimedia findings cautiously to a written report: headings
  communicate the conceptual sequence, the term is bold where defined, and a formula's
  meaning, variables, units and assumptions sit beside the formula. Ordinary prose has
  no colored frame. A box signals a change of task: a worked example, a warning,
  retrieval practice, or an AI/web addition with different provenance. If every
  paragraph is boxed, the signal cannot distinguish those tasks; that last conclusion
  is our design inference, not a measured experimental effect of this CSS.
  [Mayer (2021), chapter 14](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning/F29A19FCD34C542806F736E0661C05F5).
- **Elaboration, examples and restraint.** The IES practice guide recommends linking
  abstract and concrete representations, worked examples and problems, and deep
  explanatory questions. Connections should explain the supplied evidence, not supply
  new factual background. An AI example fills a missing application; an analogy states
  both its mapping and its limit. Neither is mandatory. The seductive-details
  meta-analysis finds that interesting but irrelevant additions can impair learning.
  Code consequently allows at most one AI addition per section and, for a narrative
  chapter, only one warning across the chapter: invented scenarios and analogies are
  excluded there. It drops redundant "to memorize" lists; the review sheet supplies
  concise recall cues instead.
  [IES practice guide (2007)](https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/20072004.pdf),
  [Sundararajan and Adesope (2020)](https://doi.org/10.1007/s10648-020-09522-4).
- **What a summary should do.** A useful summary selects the main propositions and
  connects them in a short explanatory account; it is not a second list of every item
  or a substitute for reading and retrieval. Cornell's note-taking guidance separates
  notes, recall cues and summary. Text-coherence research also makes prior knowledge
  relevant: explicit connections particularly help readers unfamiliar with a topic;
  less explicit text can sometimes benefit knowledgeable readers who make their own
  inferences. Here the safe default is connected prose from simple to complex, using
  only supported relationships. A chapter opens with chronology where dates exist,
  key concepts with short descriptions, and a cited summary of about 80–300 words;
  fuller explanations follow. The overview appears once as the report abstract, and
  cross-topic connections are included only when the concepts actually support them.
  [Cornell Learning Strategies Center](https://lsc.cornell.edu/how-to-study/taking-notes/cornell-note-taking-system/),
  [McNamara et al. (1996)](https://eric.ed.gov/?id=EJ520492).
- **History needs time and mechanisms.** Chronology gives a framework for ordering
  events, but historical thinking also requires explanation. The history chapter
  begins with dated events from anchored items, sorted oldest first, then describes
  concepts and summarizes the political mechanisms in prose. Dates can be recovered
  from an item's anchored quote only when they also occur in its title or statement;
  quantities with units are excluded. A repeated dated definition is collapsed when
  an event already explains the same development. No date is supplied from general
  knowledge, and a political alternation is not turned into an equation.
  [UCLA, chronological thinking standard](https://whfua.history.ucla.edu/foundations/standard1.php).

The EEF review is a useful caution against treating these principles as universal
recipes: evidence and implementation conditions differ between approaches and
classrooms. No box ratio or word limit is itself a pedagogy result. They are observable
product constraints chosen to address this report's measured defects.
[EEF, Cognitive science approaches in the classroom (2021)](https://educationendowmentfoundation.org.uk/education-evidence/evidence-reviews/cognitive-science-approaches-in-the-classroom).

### Implementation and shared-cover scope

`COMPLETE_GUIDE_PROMPT_VERSION` moves from `cg-2` to `cg-3` because extraction now
records dates for dated knowledge of any item type. Planning prefers coherent groups
over thin sections. The writer returns cited paragraphs, with definitions and laws
inside them, and an additional call writes each chapter's summary. Provenance labels,
AI notices, source links and the chronology remain code-generated. Legacy typed
definition/formula/rule/procedure blocks render as prose too.

The full AI notice appears on the first AI block; every AI block carries the short
localized mark in its title. Questions are gathered at the end of a chapter, alternating
between sections; their answers follow. This supports practice without suggesting
that arbitrary question mixing guarantees an interleaving benefit.

The removal of `cover-motif` from `shared/professionalReport.ts` is deliberate and
user-authorized for **all** professional reports: Deep Research, exams, rubrics and
other consumers. A cover without a supplied image uses typography and whitespace;
supplied cover images and their credits remain supported. The generated server and
Cloudflare copies are rebuilt. The guide's first metric now says **topics**, matching
the chapter count, while the contents numbers every part, references included.
Migration 197 and `SCHEMA_VERSION` are unchanged by this redesign.

### Measurements and their limits

Both paid campaigns use the same seeded corpus and providers, DeepSeek `deepseek-flash`
and OpenRouter `baai/bge-m3`. Extraction is stochastic: the first guide had 29 items,
the redesigned guide 28. Both cover every readable passage and all twelve seeded
facts with the required locators. The corpus and existing checks were not weakened.

| Measure | Original paid guide | Redesigned paid guide | Final simulated guide |
| --- | ---: | ---: | ---: |
| Extracted / used items | 29 / 29 | 28 / 28 | 25 / 25 |
| Visible callout boxes | 130 | 15 | 8 |
| AI boxes | 40 | 9 | 4 |
| Full AI notices in Markdown | 40 | 1 | 1 |
| Words outside boxes | 35.1% | 78.2% | 93.1% |
| Words inside boxes | 64.9% | 21.8% | 6.9% |
| Words in AI boxes | 26.7% | 12.1% | 2.6% |
| Body words | 17,719 | 8,399 | 2,523 |
| Markdown export words, including title and abstract | 17,850 | 8,535 | 2,557 |
| PDF pages | 60 | 28 | 14 |
| Chapter summaries | 0 | 3 | 3 |
| Reading-cache reuse in second version | 100% | 100% | 100% |
| First-version cost | USD 1.0813 | USD 0.3513 | Scripted usage only |
| Both-version cost | USD 2.0035 | USD 0.5548 | Scripted usage only |

`guideShape` counts whitespace-separated Markdown tokens after stripping citation
URLs, starting at the first level-two body heading. "Words outside boxes" also
includes headings, lists and reference tables: it is an observable layout proxy,
not a pure linguistic measure of continuous prose. The paid metrics preserve their
original run values in
[`complete-guide-redesign-paid-metrics.json`](verification/complete-guide-redesign-paid-metrics.json);
[`complete-guide-redesign-simulated-metrics.json`](verification/complete-guide-redesign-simulated-metrics.json)
records the final free run. The before/after comparison uses the same counter on both bodies.
Engine blocks are data objects, not visible boxes: 160 → 59 blocks does not mean
160 → 59 cards. The visible-card change is 130 → 15.

The redesigned paid run on 2026-09-29 used a separately authorized USD 3 ceiling and
spent USD 0.5548 on both versions. All 34 checks passed (31 required, three
informative), including the estimate, chronology, source exclusion and exports.
The final simulated run also passes all 34 checks, with full reading-cache reuse,
three summaries, a history chronology and no scientific notation in that chapter.
The scripted model is a mechanics and layout test; its prose quality and its usage
are not measurements of a real provider's writing or cost.

### Paid-content review and final verification

The redesigned paid Markdown was read in full; its PDF was rasterized with
`pdfjs-dist` and `@napi-rs/canvas` and the cover, science chapter and history chapter
were inspected. It teaches through paragraphs and puts history in chronological
context, but that reading also caught residual defects the passing checks missed:
repeated history warnings, duplicate opening chronology entries, raw `\\(...\\)`
delimiters, a chemical condition asserted without support, and a practice answer
citing the notes it contradicted.

The final code caps narrative AI additions across the whole chapter, collapses
duplicate dated concepts, normalizes model math delimiters, strips redundant box-title
prefixes and repairs ordered-list and bold remnants after auditing. More importantly,
**standard verification now audits all explanation and summary paragraphs and each
practice answer**; a number-only trigger could miss an invented condition with no new
number. Answers are audited against their own item IDs, and empty answers are removed
with their questions. Provider failures do not checkpoint unchecked sections.
Regression tests cover both unsupported text without a new quantity and audit outages.
The estimate retains its measured per-audit constants but budgets a floor for prose,
answers and summaries, rather than estimating only the former selective audit.

The paid report predates these final safeguards. Its USD 0.5548 and its shape are
**not** claimed as measurements of the final audit policy. No additional paid run was
launched; validating real-model output and cost after the stronger audit remains
pending a further authorized run. The final free campaign exercises that policy
through the real premise-audit implementation, with scripted upstream answers.

Final PDF snapshots under `docs/verification/` show the actual rasterized simulated
PDF's cover, contents, science and history pages; separate `complete-guide-paid-*`
snapshots identify the redesigned paid report rather than silently replacing it with
scripted prose. The dark/light browser screenshots show the production composer and
reader components. The focused guide/audit run passes 63 tests. Typecheck, lint and the Chromium
composer/reader checks pass. The full two-file-concurrency CI suite reports
4,086 passes, zero failures and one existing native-ABI skip (CompassStore under
system Node); it ran after the production/server builds and hash-verified OCR fixture.
Deep Research and Immersion professional PDFs also pass the shared export check.
The PR's native and cross-repository jobs are monitored after push.

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
to `<root>/artifacts/complete-guide-metrics.json`. The simulated run passes every check.
The final redesign run records about USD 0.0757 of scripted usage across both versions;
this is a proxy/ledger exercise, not a real-provider cost estimate.

#### Paid run, 2026-09-28 (DeepSeek `deepseek-flash` + OpenRouter `baai/bge-m3`)

Executed on the Mac with the keys the installed app already holds
(`scripts/with-nodus-keys.cjs`), on one campaign root reused across attempts so the
USD 5 authorization stayed cumulative. **USD 4.0552 of the USD 5 was spent** and the
run stopped there: one full campaign execution (both versions) costs about USD 2.00,
so the remaining USD 0.94 could not fund another. The final recorded run is in
[`docs/verification/complete-guide-live-metrics.json`](verification/complete-guide-live-metrics.json):
The JSON records 27 checks: 25 pass, the required estimate check fails, and the
informative history-style check reports formula cards. The estimate fix arrived after
the last affordable run (see "The estimate under-promised by five").

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
  `SCHEMA_VERSION` so a bump is deliberate; the guide's migration is, and the pin moved. Main took 194–196 while this branch was in flight, so the guide's tables are 197 and every pin of the number moved with them.

Two observations from the original paid run (before the redesign above):

- the contradiction between the note ("pH 7 at any temperature") and the slides
  ("pH 7 only at 25 °C") is found and printed in "Contradicciones entre fuentes";
- the informative check "the history unit uses no scientific callouts it has no
  content for" reports two `[!formula]` cards in the history chapter: the model
  expressed the turno pacífico as an alternation and the encasillado as a relation,
  each explained in prose. This was initially left as a stylistic stretch; the report
  redesign treats it as a defect and replaces it with historical explanation. The
  original informative check remains informative; the additional design checks do
  not replace the existing corpus or its required checks.

Artifacts of the recorded run (kept out of the repository: they are 2.4 MB and carry
the whole guide): `complete-guide.md`, `complete-guide.docx`, `complete-guide.pdf`
(60 pages), `complete-guide-review-sheet.pdf`/`.png`, `complete-guide-page.png`. The
PDF embeds its fonts (54 subsets), renders formulas as MathML, keeps every AI block
labelled ("Elaborado por IA: no procede de tus materiales") and shows no stray `$`
and no truncated text; the Word file carries 317 native equations (`m:oMath`), 149
tables and an updatable `TOC \h \o "1-2"` field.

#### Web images against the live Commons (2026-09-28)

Off by default, and verified against the real world without a model (so it costs
nothing): the staged SearXNG answers the `images` category and `wikicommons.images`
returns candidates, the Commons API confirms licence and author, and the raster is
downloaded through the public-only guard and re-encoded with sharp. A real result:

```
item K0022 · 393×525 · 312 KB
  caption:  La Restauración — Manuel Ruiz Zorrilla, Cosme Algarra y Hurtado · Public domain · Wikimedia Commons
  author:   Cosme Algarra y Hurtado
  licence:  Public domain
  site:     Wikimedia Commons · https://commons.wikimedia.org/wiki/File:Manuel_Ruiz_Zorrilla_(Museo_de_Albacete).JPG
```

**Its coverage depends on the language of the query.** The concept the guide sends
is the item's title in the output language, and Commons' file search is English-biased,
so a Spanish concept often finds nothing at all (measured: `isotermas de un gas ideal
diagrama presión volumen` → 0 results; `ideal gas isotherms pressure volume diagram` →
9, four of them relevant; `escala de pH ácidos y bases` → 0 against `pH scale acids
bases` → 4). Proper nouns and historical figures work in Spanish. The feature is
best-effort by design — anything unconfirmed is skipped, never guessed, and the guide
never invents an attribution — but a Spanish guide will mostly get no web images for
scientific concepts until the query reaches Commons in English or through Commons' own
search API. Not fixed here: it is a coverage limitation in an optional, off-by-default
step, and changing the query shape without a measurement of the result would trade a
known gap for an unknown one.

#### Still open

The composer's entry point was checked **in the real application** (built `dist/`, an
isolated profile, no model call): a Study vault with the demo workspace, the tree the
modal shows, and the estimate it prints before queueing.

```
catalog: A1 Guía de laboratorio · ósmosis (material) | D1 Membrana plasmática · resumen (document) | G1 Clase · transporte a través de membrana (transcript)
selection: topic "Membrana plasmática" → 3 sources
estimate: USD 0.31–0.66, 63 calls, 9 items, 5 sections, 23–54 min  (verify: 39 calls, 228k output tokens)
```

What that leaves: the walkthrough through the app's own UI (queue with per-stage
progress, reader callouts and locator links, the exact-quote popover, the coverage
panel, the export buttons and «Crear otra versión») has not been driven by hand, and
the web *text* step (`Complementar con la web`) has never run against a real search
plus a real model — it is exercised with fake dependencies in the engine test, where
its passages, labels and `W1` citations are asserted. What stands in for the rest:
`scripts/e2e-complete-guide.mjs` drives the composer and reader components in Chromium,
the paid campaign covers the engine, the exports and the cache reuse, the figure paths
are tested against real PDFs and decks by `scripts/test-complete-guide-figures.mjs`, and
the web-image chain was verified live above. The paid campaign's budget (USD 4.0552 of
USD 5) went to the guide itself, and an app-side run spends the user's own keys.

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

`node --test scripts/test-complete-guide-infrastructure.mjs` runs migration 197 on
`node:sqlite` and covers frozen snapshots, resumable checkpoints, stale-run pruning,
the shared LRU reading cache, sidecar deletion, the job language scope and nested
usage meters.

`node --test scripts/test-complete-guide-foundations.mjs` covers config
validation, nested folder/unit expansion, legacy placements, exclusions, transcript
preference, lossless non-overlapping splitting, page/slide/offset/time locators,
ordering by organization position, duplicate passages, tree toggles and the estimate.
