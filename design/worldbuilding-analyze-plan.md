# Worldbuilding — the group ‘Analyze’ (migration 99)

> ** Status: the "Analyze" group is COMPLETE — A0–A10 implemented and verified**
> (2026-07-28). `SCHEMA_VERSION = 99`, 1160/1160 tests, Lint 0 errors, typecheck,
> `npm run build`and`npm run test:e2e`The only thing A10 deliberately left behind
> outside is the history of conversations: I would have asked for a migration that the plan does not
> contemplate, and the chat lives in the session.
>
> Plan produced by a workflow of 12 agents (5 designs + 5 reviews «from the table of a
> novelist» + synthesis. This document is the executable summary; the encyclopedia (v98) goes
> in the relevant section of the history.

---

## 1. The thesis (do not discuss it again)

The five sections of "Analyze" ** are not five reports**: they are five readings of a single
statement that the vault could not keep — **"in this scene, this moves like this"**. A tested rule, a
advancing conflict and a rotating arc **are the same row**.

That's why the heart is a board,`world_beats`, and **a strip on the scene sheet**
(`SceneThreadsPanel` + `RulesInPlay`) that fills it with a click, with the rows already
prepopulated. The author **never visits five sections to feed them**: it feeds the scene that he is
writing and the five are filled alone. The views of the menu are **read reports**, not forms.

Corollary that decides the architecture: **The AI does not calculate anything**. Every diagnosis is
pure arithmetic about what the author typed. Only two uses of model survive, by element and under
button, in quarantine (§A9).

---

## 2. What is already done

| Phase | What did he deliver? |
|---|---|
| **A0** | Migration **99** with 8 tables:`world_scene_days`, `world_threads`, `thread_parties`, `world_beats`, `world_rules`, `world_questions`, `world_question_options`, `world_notice_mutes`. Types`shared/types.ts`, high in group`worldbuilding`of`syncTables.ts`. |
| **A1** | The **day chain**:`shared/worldSceneDays.ts`, `recomputeSceneDays()`/`reorderScene()`in`worldStoryRepo.ts`, `SceneDayChain`on the scene sheet. Precondition of media Continuity. |
| **A2** | **Threads and beats**:`shared/worldThreads.ts` + `electron/db/worldThreadsRepo.ts` + `SceneThreadsPanel`No new view on the menu. |
| **A3** | **Continued as badge**:`shared/worldFindings.ts`, `shared/worldContinuity.ts`, `electron/db/worldContinuityRepo.ts`, `ContinuityBadge`/`ContinuityProvider`on five chips. |
| **A4** | **The Continuity View**:`src/views/ContinuityView.tsx`, canned silences, accepted exceptions, empty state with real counts. «Consistency» → **«Continuousness»**. |
| **A5** | **Conflicts**`src/views/ConflictsView.tsx`(table first),`CharacterThreadsSection`, cross loyalties,`conflict`like 7.a`WorldEntryKind`, `checkThreads`In Continuity. |
| **A6** | **Arcos**:`src/views/ArcsView.tsx`, read-only SVG lanes, density strip, inert sections, closing order, milestone sheet. |
| **A10** | **Chat of the world**:`shared/worldChatContext.ts` + `electron/ai/worldChat.ts` + `WorldChatView`Nodus calculates the five readings and the model writes; quotations are validated against actual entries. |
| **A9** | **The two uses of AI**:`shared/worldRuleContext.ts` + `electron/ai/worldRules.ts`(drafting the wording of a law)`shared/worldQuestionContext.ts` + `electron/ai/worldQuestionOptions.ts`(propose three answers).Nothing else: AI still doesn't calculate anything. |
| **A8** | **Open questions**:`shared/worldQuestions.ts`, `electron/db/worldQuestionsRepo.ts`, `QuestionsView`, capture from any prose field (`questionCapture.tsx` + `anchorOf`in the shell) and stripe`SceneQuestionBand`at the scene. |
| **A7** | **Rules**:`shared/worldRules.ts`, `electron/db/worldRulesRepo.ts`, `RulesView`, `RulesInPlay`at the scene,`rule`as 8.a`WorldEntryKind`, ‘to become law’,`checkRules`In Continuity. |

---

## 3. A8 — Open Questions (minimum, by the way) — **DONE**

The tables already existed (`world_questions`, `world_question_options`, migration 99); this phase
built everything else ** without touching the schema**. What follows is the design as implemented,
plus the deviations at the end of the section.

### Cut-off range

Of the **seven** referral rules requested by the original design, **two** remain:**

- `author`— which the author types.
- `placeholder` — `???`, `TBD`, `XXX`, `[…]`found in the prose you already wrote.

The other five ** belong to another section** and would return to its owner with a button "to become
an open question": red links and undeveloped entries → Encyclopedia (which already
has`world_entry_proposals`with his own book of discards; a second book about the same facts is a
discard that is still alive in the other site), arc holes → Arcos, contradictions → Continuity,
scenes without date → Scenes, revelations → Secrets.

That's why they disappear.`WorldQuestionWorld`(which was the entire Vault by IPC at each
opening),`deriveQuestions`and`WorldDependencyIndex`.

### `shared/worldQuestions.ts`(pure)

```ts
export const WORLD_QUESTION_STATUS_LABEL, WORLD_QUESTION_ORIGIN_LABEL, WORLD_APPLY_MODE_LABEL;
export function questionOriginKey(origin, ...parts): string;   // 'ph:character:prs_7:backstory'
/** ???, TBD, XXX, [...] — aware of code blocks; reuse the encyclopedia path. */
export function findPlaceholders(texts: WorldTextRef[]): PlaceholderHit[];
export function mergeQuestionFeed(stored, derived, options): WorldQuestionFeedItem[];
export function nextBlockedScene(anchor, scenes): { sceneId; title; narrativeOrder } | null;
export function questionUrgency(item): WorldQuestionUrgency;
export function rankQuestionFeed(items): WorldQuestionFeedItem[];
export function planApply(option, anchor, anchorField, currentText):
  { field; nextText; replacedText } | { create: 'article'; title; summary } | null;
/** Undoing is only safe if the field continues to contain what was applied. */
export function canUndo(option, currentText): boolean;
```

### The screen

Reuse the shell with`presentation: 'list'`. `idOf`returns`questionId`o`originKey`.

- **Two facets**:`anchorTitle`(different) and a switch ‘blocks me’.`origin`and`status`like facets.
- File: editable question with`[[`→ verbatim evidence → leverage line and boundary scene → **options
  in columns**, each with a single button that **names the writing before doing it** ("To be written
  in Kaelen → Transfundo") and becomes "Undoing" while`replaced_text`is present and`canUndo()`be
  true → after applying, **the list of sites that still say the old text**.
- Having regard to ‘decisions taken’ (`status='answered'`) that **shows the discarded options**: the
  only memory of *why* the world is as it is.

### What makes it usable

The **capture in a key** from any prose field: select text → "turn into open question", with anchor
and field **prerellenados**.`AutoSavingField`and`WorldEntryEditor`, which are shared components — is
the expensive part of this phase.

More the band "this scene depends on N open decisions" on the scene sheet.

### Landmines own

- `planApply`/`canUndo`is ** the only thing about the whole group that writes in tabs from other
  sections** (the background of a character, an article). Undoing has to be really right:`canUndo`is
  false as soon as the field stopped containing what was applied.
- The destination is **inferred** from the anchor; it is never chosen on a three widget form.
- `apply_mode`has three values:`none | fill_field | create_article`. `none`It is a first-class
  answer: there are decisions that are made and simply remembered.
- The state`parked`absorbs what the design called`dismissed`: were two negative states
  indistinguishable in practice.

### What changed when you built it

- **`planApply`receives the whole question**, not just`(option, anchor, anchorField)`: the title of
  the article you create leaves the question (`questionTitle`), and the anchor doesn't know.
- **An answered decision does not disappear from the list**. The first version deleted it from the
  screen in the same click: without confirmation of what had been written and without the "Undoing"
  right when someone wanted it. Now it stays until the author leaves the section (a`Set`of ids in
  the view, not a state in the database).
- **`emptyLabel`cannot be a ternary.** The collector of i18n reads the literal that
  follows`emptyLabel:`So the other reading says his thing since`EmptyState`, which calls for`t()`.
- **The capture travels by context** (`WorldAnchorProvider`in`WorldWorkspace`, fed by
  a`anchorOf?`new in the section descriptor) instead of by props: they are ~20 fields in six tiles,
  and the one that would be forgotten is the one added next year.
- **`stillSaying`was resolved as`remainingHoles(optionId)`**: the mark is read from`replaced_text`of
  the option itself, so no column has to remember it and it still works after the gap it filled has
  disappeared.
- **Profiles are written with upsert.**`character_profiles`and`place_profiles`hang from their father
  by LEFT JOIN everywhere: a`UPDATE`I'd say he wrote a paragraph and he wouldn't have written
  anything.

---

## 4. A9 — The two uses of AI — **DONE**

Both **by item, under button and quarantine**. Copy the pattern
of`electron/ai/worldArticleDraft.ts`, which already works: prompt pure in`shared/`, call
in`electron/ai/`model`synthesisModel ?? extractionModel`.

1. **`draftWorldRule(ruleId)`** — `shared/worldRuleContext.ts` + `electron/ai/worldRules.ts`,
   temperature 0.8. Write in **`world_rules.proposed_text`**, never in`statement`. The screen
   already paints it and already has OK/Discard (`rules:acceptDraft` / `rules:rejectDraft`It attacks
   the blank page, which is the real problem.
2. **`proposeQuestionOptions(questionId)`** — `shared/worldQuestionContext.ts` +
   `electron/ai/worldQuestionOptions.ts`, temperature 0.9. Write **3 options** with
   your`implications`as rows`world_question_options`with`origin='ai'`Quarantine here is
   **structural**: an option is not canon until it is chosen and applied.

Accept is **always a separate call**. Empty tab →`noMaterial: true`No mistake.

**What is NOT built**, and why:`auditRuleAgainstScenes`, `conflictProposals`and his
tray,`generateArcDraft`in propose mode,`reviewWorldProse`, `world_ai_findings`with
his`material_hash`and its expiry. Its actual entry is`world_scenes.summary`, which is NULLABLE and
in a real vault is empty most of the time. **No model is paid for so a JOIN answers.**

### What changed when you built it

- **Two labeled lines (`OPTION:` / `IMPLIES:`), no JSON.** `completeJson` lowers the temperature
  until the model obeys, and this is the hottest call on the app (0.9): I would pay three shifts to
  keep the dullest of the three. In addition to the local models that a writer actually runs, most
  wrap his JSON in prose. Two prefixes survive a preamble, a numbered list, the bold Markdown and a
  farewell. Parser is in`shared/`, and **only one line continues if it is indented**: without that
  guard, the model's "hope to be served" ends up inside someone's tab.
- **`hasWorldRuleMaterial`requires the title MORE a sign** (a field with name, a line started, an
  exception, a scene that tests it, a text that mentions it). A title just produces a phrase that
  would be useful for any novel, and that is deleted once and the button is not pressed again. The
  notice says which of the five missing ones.
- **`blockedSceneFor(anchor)`** exported from`worldQuestionsRepo`so that the prompt knows which
  scene is blocking **without paying for the scan of the entire prosa of the vault** that the feed
  does.
- **There is no step of "accepting" in the options**, and it is not an oblivion: an option is a
  pending writing, so choosing it and pressing the button that names what you are going to write is
  already consent. The only "accepting" of the group is that of the law, because there the model
  does write in a field.

---

## 5. A10 — World chat — **FACT**

It is designed ** knowing that the other five exist**, and that changes what it is: **the chat does
not reason about the world — Nodus calculates and the model writes**. Same distribution as the
analysis of the database vault.

### `shared/worldChatContext.ts`(pure)

```ts
export interface WorldChatFacts {
  focus: WorldEntryRef[];                                   // resolved by the repo from the question
  prose: { ref; field; text }[];                            // entryProse() of each focus, verbatim
  computed: {                                               // CALLED BY NODUS, NOT BY THE MODEL
    effectiveRules?: { rule; ruleId; overriddenBy: string[] }[];
    presenceAt?: { personId; personName; placeName; worldDay }[];
    beatsAtScene?: { threadKind; threadTitle; mark; text }[];
    findings?: WorldFinding[];
    knowersAt?: { secretTitle; people: string[]; worldDay }[];
  };
}
export const WORLD_CHAT_SYSTEM: string;
export function composeWorldChatContext(facts: WorldChatFacts): string;
export function hasWorldChatMaterial(facts: WorldChatFacts): boolean;
```

**The *system* says three things and only three:** (1) the blocks "CALKLED" are made of Nodus and
are not discussed or recalculated; (2) every affirmation about the world must quote; (3) if the
material does not contain the answer, it is said — a plausible world is not invented.

### How to quote

With the syntax that already runs through the vault:`[Marca de sangre](nodus://world/rule/rul_7)`.
`src/components/Markdown.tsx`**and the route** (branch`onWorldEntry`, added by the encyclopedia), so
each quote is a click on the tab. The repo **validates quotations against`entryLookup()`** before
painting them and **degrades the invented ones to plain text** — the same treatment as a red link.

### What you can answer, and today is impossible

| Question | What's the answer? |
|---|---|
| "Could Kaelen invoke the Mark on the 4th day 120?" | `effectiveRules()`+ belonging to that day +`knowersAt` |
| «What has to move on scene 41?» | `beatsForScene()`on`world_beats` |
| «Who in my cast wants nothing from anyone?» | `findStakeGaps()` |
| «Where does the book sink to me?» | `findInertScenes()` + `beatDensity()` |
| "Does this contradict anything?" | `runWorldContinuity()`filtered by spotlights |
| «What do I need to decide before writing 42?» | `nextBlockedScene()`(needs A8) |

### What chat does NOT do

He does not write canon (his suggestions are copied by hand or become`world_questions`), he does not
see the whole vault (only the spotlights and their calculated facts, which is also the only way it
fits into the context).

### What changed when you built it

- **No focus is not calculated NADA**, and this was hunted by e2e:`rulesReaching`With null subject
  returns all the laws of the world—they reach everyone by definition—so a question that did not
  name anything came to the model with the legal code of the world attached and answered about it. A
  chat that cannot say what it speaks of has to say that.
- **The day is read in`shared/`, not in the model** (`readWorldDay`): All that goes after is
  arithmetic ABOUT that number, and a model that reads "day 4 120" as 4 is surely wrong in the five
  readings. Accept the Spanish thousands separator (space and point).
- **The longer focus deletes the one it contains**: "Kaelen Vor" in the question is not a mention of
  the character called "Vor", and let the two fill the focus — and the model window — with a tab
  that no one has asked for. Two names of the same length are not deleted: two things can be called
  the same.
- **The link already written is given** (Kaelen Vor →`[Kaelen Vor](nodus://…)`), rather than waiting
  for it to compose the URL. And yet`validateCitations`degrades to plain text what does not exist:
  the phrase is retained and the promise is withdrawn.
- **Transito and "before their first appearance" are said out loud.** Flattening a position to a
  place name would turn "I was on the way" into "I was in Vael", which is exactly the confident and
  false answer that all this design exists to avoid.
- **No conversation history**: I would have needed table and migration, and the A10 plan does not
  ask for it. Chat lives in the session.

---

## 6. Landmines in force for the three phases

1. **Neither a foreign key nor a foreign key`ON DELETE CASCADE`in a new
   migration.**`foreign_keys`there's ON, so a`REFERENCES`without declared action uses NO ACTION and
   **aborts the deletion of the father**; and`isCreateOnly()`rejects any body containing the
   word`DELETE`, which disqualifies the migration of its **two** repair roads. Property is imposed
   by repo transactions.
2. **All new table to the group`worldbuilding`of`syncTables.ts`**, or he doesn't travel and his
   erased ones resurrect.
3. **Cave derived from content** in any set that is rewritten by emptying and inserting, or each
   saved leaves one permanent tombstone per row.
4. **Texts arriving at`t()`per variable need key + variables**, never an interpolated phrase, and
   must be recorded in`INDIRECT_KEY_SOURCES`. A pattern there needs **two capture groups** (quote
   and content).
5. **`npm run typecheck`yes it covers`electron/`.** What I only hunt`npm run build`are the
   **duplicate i18n keys (TS1117)** — check all three form of quotation marks before adding.
6. **`npm run test:e2e`DO NOT reconstruct**:`npm run build`before, always.
7. When you graduate a section you have to **move the control of "inert section"** of the e2e to
   another that remains unbuilt; its failure means that, not a regression.
8. **Hand test with isolated profile** (`NODUS_USERDATA=/tmp/nodus-x ./node_modules/.bin/electron
   .`), **never on a real vault**: a build with different migration numbers corrupts them.
