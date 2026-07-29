# Worldbuilding — ‘Manuscripts’ (migration 100)

> **State: COMPLETE. M0–M9 implemented and verified** (2026-07-28).
> `SCHEMA_VERSION = 101`, 1180/1180 tests, Lint 0 errors, typecheck,`npm run build`and
> `npm run test:e2e`in green. With this **worldbuilding vault has not a single section
> Inert** and its writing section is finished.

---

## 1. The thesis (do not discuss it again)

**The manuscript is not a new document: it is the missing column of the scene.**

A novel is his scenes in order of story. This Vault already knows what they are, in what order they
go, what day they happen, who comes out, what moves in each, what laws govern them and what
decisions they block them. The only thing he doesn’t know is ** what the text says**.

Hence everything else follows, and in particular what this section **no** is: writing the novel in a
separate document would create a second source of truth about the same story — exactly the flaw that
this Vault has five sections avoiding (no table of findings, no copy of the background of a
character, the projections of the encyclopedia are calculated and not saved). A chapter that exists
as a scene at the same time and as a section of a document is desyncronized on the first day that
someone cuts a paragraph.

A corollary that defines the product: **Nodus does not compete with Scrivener or Word.** There is no
control of changes, nor comments, nor WYSIWYG, nor collaborative editing. What offers—and cannot
offer any text editor—is to write the scene **with the world ahead**: the beats you have to give,
the laws that govern it, the questions that block it and the continuity notices, all already
calculated, in the right margin while writing. That is the only reason to write here instead of
elsewhere, and therefore is the entire section.

Second corollary: **the AI does not write the novel.**Not a line. The entire vault holds that the
author is the source of truth; a section where a model writes prose that is later canon would
contradict it at its root. (What does open, and is discussed in §7, is a review that A9 rejected
**for lack of entry** and that this phase creates.)

---

## 2. What already exists, and what is missing

| That's it. | Where |
|---|---|
| The order of the story | `world_scenes.narrative_order`, dense and total;`reorderScene()`renumbered **all** |
| What's going on at the scene? | `world_scenes.summary`— plan, not text |
| When It Happens | the chain of days (`world_scene_days`) → `world_day`canonical |
| What's moving | `world_beats`+ Strip`SceneThreadsPanel` |
| What laws govern | `rulesInPlay(sceneId)` + `RulesInPlay` |
| What blocks it | `sceneQuestionLoad(sceneId)` + `SceneQuestionBand` |
| What's the matter? | `ContinuityBadge`on the snapshot of continuity |
| Links`[[…]]`to anything in the world | `promoteWorldLinks` + `world_links`+ backlinks |
| Export a Long Document | `worldBibleExport`(MD and PDF with`professionalReportPdf`) |

**There is only one thing missing: the text.** And with it, three things that only make sense when
the text exists: count words, group into chapters and compile.

---

## 3. The data model (migration 100)

Three new boards, **all CREATE-only**.`isCreateOnly()`rejects any body with`ALTER`, `DROP`,
`INSERT`, `UPDATE`, `DELETE`o`REPLACE`, and a migration that uses them loses ** both** repair paths
(`backfillMissingCreateOnly`and re-execution on a migrated basis with another numbering). That
literally means that **cannot be added a column to`world_scenes`**: nor`text`, or`chapter_id`,
or`word_count`. Everything goes on new boards with`scene_id`as a key.

```sql
-- The prose. APART table and not a column of world_scenes, for two different reasons and
-- migration cannot make ALTER, and — more importantly — a novel by
-- 120 000 words are ~700 KB that`listScenes()`I'd drag in EVERY read, and that list
-- the view of scenes, the feed of questions, the arches and the chain of days.
-- rule that already follows world_maps with its bytes: the body NEVER travels with the list.
CREATE TABLE world_scene_text (
  scene_id     TEXT PRIMARY KEY,      -- without REFERENCES: foreign_keys is ON and NO ACTION
  text         TEXT,                  --   I'd abort "cut this scene."
  -- Denormalized on purpose: it's the only thing that thorn, target and counter of the day
  -- They need to, and calculate it requires reading the entire text of all scenes.
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- A chapter is WHERE A chapter starts. There is no chapter table with its own order:
-- that would be a second axis of ordination together with narrative_order, and the two would disagree on
-- first day someone moves a scene (the chain of days and lanes of arches already
-- depend on that order being dense and total.) Here the chapter moves its
-- scenes, which is what an author does anyway.
CREATE TABLE world_chapter_breaks (
  scene_id  TEXT PRIMARY KEY,
  title     TEXT,
  epigraph  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- How many words were there at the close of every day. The delta is calculated against the day before and
-- CAN BE NEGATIVE: a day of pruning is a day of work, and an accountant who only knows
-- Adding turns cutting into punishment.
CREATE TABLE world_word_days (
  day          TEXT PRIMARY KEY,      -- 'YYYY-MM-DD' local
  total_words  INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

All three to the group.`worldbuilding`of`syncTables.ts`The property is imposed by the repo
transactions:`deleteScene()`deletes your text row and your chapter mark, as you already erase your
heartbeat.

### One manuscript per vault (for now)

`narrative_order`It is global. A trilogy in the same world would need an order per manuscript, and
that touches the axis from which the chain of days, the lanes of the arches and the "inert line"
hang. **Phase 1 = a manuscript**, and the label of the sidebar moves from "Manuscripts" to
"Manuscript" (same previous as "Consistence" → "Continuity"). Several manuscripts is M7, designed
below and explicitly not now.

---

## 4. The phases

### M0 — The prose has room

Migration 100, rates`shared/types.ts`, high`syncTables.ts`, `electron/db/worldManuscriptRepo.ts`
(`getSceneText`, `saveSceneText`, `setChapterBreak`, `manuscriptSpine`), IPC`manuscript:*`and
preload. **No UI yet**, except the "Write" button on the scene sheet.

`saveSceneText`does three things besides saving: promotes the`[[…]]`to resolved links
(`promoteWorldLinks`), reindexes the links of the scene, and
recalculates`word_count`with`countWords()` (§6).

Test: that`listScenes()`Still don't bring a single word of prose.

### M1 — The Writing Desktop

`src/views/ManuscriptView.tsx`, three columns:

- **The spine** (left): chapters and scenes in order of story, with their count and a state point
  (draft · written). It is the table of contents and the browser.
- **The text** (center): the editor. Comfortable measure (~65ch), serif, generous interline — this
  is not decoration, it is the difference between writing here and not doing it. Self-saved when
  leaving the field and changing the scene, never with debounce (a paused writing in a
  sentence).`⌘↑`/`⌘↓`They jump from the scene without dropping the keyboard.
- **What this scene has to do** (right, foldable): the declared beats, the laws at stake, the open
  questions blocking it and the continuity badge. All already calculated by "Analyze"; here it is
  only shown.

The Auto Completion of`[[`**extracted** from`WorldEntryEditor`to a shared hook
(`useWorldLinkAutocomplete`) and the manuscript editor is built on it.`WorldEntryEditor`: its
Save/Cancel buttons are those of an article, and a self-saved manuscript.

### M2 — Chapters

Marking a scene as "here begins a chapter", with optional title and heading. Spina groups. Moving or
renaming a chapter is moving or renaming its scenes: **a single ordination axis, forever**. A sketch
scene serves as a chapter marker to be written, which is what an author already does.

### M3 — The honest accountant

Words by scene, by chapter and by manuscript; optional target; advance bar by status (draw/write,
with the actual account of each, never a projection). And the **delta of the day**
from`world_word_days`, with its sign: a day of pruning appears in negative and with those words. The
state of the scene is still put by the author: it is not derived "written" from a threshold of words
— nothing that the author declares is recalculated behind his back.

### M4 — Prosa enters the world

The phase that justifies the entire design, and the one of greater radius of action. With the text
in a table of the vault, **all the existing machinery is applied alone**:

- **Retrolinks**:`[[Kaelen]]`in chapter 12 it appears on Kaelen's file.
- **Full text search**:`searchWorldBodies`wins the column of the scene.
- **Woes**: a`???`in the manuscript is an unmade decision, and appears in Open Questions without a
  new code line.
- **Chat of the world**: you can quote the text instead of just the summary.
- **Continuity** wins a pure and new check: *"appears in the text and is not in the cast"* — the
  resolved link says which characters are mentioned; the cast says which were declared. Arithmetic,
  without model.

**The delicate point**:`entryProse()`You must NOT return the manuscript. That function also feeds
the reading panel of the encyclopedia and the **export of the world Bible**, and putting the prose
there would make the Bible into the entire novel. A separate function is added
—`entryIndexableProse()`— which is`entryProse()`**more** the text, and only the indexers use it
(links, search, gaps).The two old consumers remain intact by construction, not by remembering.

### M5 — Compile

Export the manuscript as a single file, reusing`markdownRender` + `professionalReportPdf`:

- **What is included**: all, or only written; with or without summaries of unwritten scenes as
  bookmarks (`[por escribir: …]`), which is how you send a partial draft.
- **Format**: cover, chapters with their heading, separator between scenes, numbering.
- **Central Landmine**: Saved prose contains solved links
  (`[Kaelen](nodus://world/character/prs_7)`). A manuscript that is sent to someone ** cannot carry
  them**: the compilation degrades them to their label. It is the reverse operation
  of`toRenderableBody()`and you have to write it and prove it explicitly.

### M6 — Verification and graduation

Pure tests (`countWords`, the spine, the degradation of links, the casting test), repo tests against
a migrated vault, i18n in seven languages, and e2e.

**Landmine of graduation**: «Manuscripts» is the **ultimate** inert item of the sidebar. The
assertion of the e2e that says «an unbuilt section must not be able to be pulsated» is left without
subject: it must be replaced**, not moved, on the contrary — that all items of the sidebar
sail.`test-vault-types.mjs`passes to eighteen wired views.

---

## 5. What is NOT built, and why

- **Controlling changes and comments.** They are from a workflow with external editor, not the one
  of writing. Those who need them export and use Word, which is where their publisher is already.
- **WYSIWYG.** Markdown, like the rest of the vault. A second text format in the same database is a
  second set of escape rules and a permanent source of "this looks different here".
- **Instant / scene versions.** Valiosas, but they are another table and another screen; and the
  studio editor already has versioned that could be reused. → M8.
- **Several manuscripts.** → M7.
- **Daily goals with streaks and reminders.**Gamification; the honest delta of the day already gives
  90% of the value without turning writing into an obligation with punishment.
- ** May the AI write prose.** Never. See §1.

---

## 5 bis. What changed when you built it

- **The meta-test of the catalog is disarmed only when you graduate a check to another
  file.**`test-world-analyze.mjs`the functions of`shared/worldContinuity.ts`looking for
  every`id`of`CONTINUITY_CHECKS`; `manuscript.uncastMention`lives in`shared/worldManuscript.ts`So
  the guardian would have gone green on a catalog that promises something that no one implements.
  Now it runs through the two modules.
- **`WorldEntryEditor`it was rewritten on the shared hook**, it was not copied: the difficulty of
  autocompletion is not the drop-down, it is that the trigger is sought back ** from the cursor**,
  which is what keeps it right when the author returns to a half-write link. A second copy of that
  derives, and the drift comes out in the editor that that week no one was testing.
- **One door to the same text**: "Write" on the scene sheet **naviga** to the manuscript positioned
  in that scene (`localStorage`), instead of opening a second editor. By the way, the manuscript
  reopens where you left it.
- **`loadedFor`saves the only dangerous case of the self-saved**: write the text of the previous
  scene within which you have just selected. Without that guardian, change the scene quickly steps
  one chapter with another.
- **The link is called`sourceField`, no`field`It costs a red e2e to find out.

## 6. Landmines known before you start

1. **Migration CREATE-only or no repair.**`ALTER`: prose, chapter and counter go on new boards, not
   columns of`world_scenes`.
2. **Neither a foreign key with declared action.**`foreign_keys`is ON: a`REFERENCES`without action
   uses NO ACTION and **aborts** the deletion of the father. "Cut this scene" would become a
   database error. Property is imposed by repo transactions.
3. **The text never travels with the list of scenes.** It is the rule that maps already follow with
   their bytes, and here it is violated by four different consumers if neglected.
4. ** Counting words is a pure function and it is NOT`split(' ')`.** Text has solved links:
   count`nodus://world/character/prs_7`like words inflates every count and the entire
   target.`countWords()`first remove the URLs from the links (preserving the tag), Markdown
   bookmarks and code blocks.
5. **`entryProse()`cannot grow.** Feeds the Bible of the world; the manuscript enters
   by`entryIndexableProse()`Without that separation, export the Bible exports the novel.
6. **Scanning holes will now read the whole novel.**`questionFeed()`Go on.`allWorldBodies()`at each
   opening; and`sceneQuestionLoad()`Once per scene sheet. With 700 KB of prose you have to **measure
   it** before deciding anything; if it hurts, the output is scanning when saving, not a cache of
   findings (which would be the second usual truth).
7. **A chapter is not an ordination axis.** If at any time it is added`sort_order`to the chapters,
   there will be two orders that differ, and the day of the scene will become dependent on which one
   is read first.
8. **The autosave goes out of the field, not with debounce.** A debounce writes once per pause in a
   sentence; over an entire chapter that is hundreds of scriptures and a useless synchronization
   history.
9. **`test:e2e`does not reconstruct.**`npm run build`before, always.
10. **When graduating the last section, the assertion of 'inert section' is left without subject.**
    It was replaced by the opposite — no sidebar button is disabled — both in the e2e and in
    the`test-vault-types.mjs`, which now states that **no item is sightless**.
11. **Hand test with isolated profile** (`NODUS_USERDATA=/tmp/nodus-x`), never on a real vault: a
    build with different migration numbers corrupts them.

---

## 7. M7, M8 and M9 — **DONE** (migration 101)

- **M7 — The shelf.** The design above —`world_manuscripts`+ belonging to the scene
  +`narrative_order`by manuscript— ** was discarded when building it**, and the reason is the same
  as the chapters had already decided: it would be a second axis of ordination next to the story,
  from which hang the chain of days, the lanes of the arches and the boundary scene of the open
  questions. **A book is WHERE a book begins**:`world_manuscript_starts`, the same way
  that`world_chapter_breaks`. Zero changes in order, zero migration of data, zero risk. The price —
  books are adjacent sections of the order — is exactly what a shelf is. The chain of days remains
  global on purpose: in a trilogy of the same world the day 4120 is the day 4120, and a book that
  opens another was anchoring its first scene.
- **M8 — Instant.**`world_scene_snapshots`, by hand and **automatic when the text is reduced to less
  than half** — the moment no one remembers to press anything (one pasted on the selected chapter).
  Restore saves before there is, because a undo that cannot be undone is a trap, and passes
  by`saveSceneText`So a restored chapter is not second-rate: you are promoted and indexed the same
  links. Top 20 per scene, and it comes out the oldest.
- **M9 —`reviewWorldProse`.** The revision that A9 rejected for lack of entry. Under button, by
  scene, temperature 0.2: of the beats that the author declared, which are on the page. **Does not
  think about prose, does not rewrite, does not suggest phrases.** A heartbeat without response
  returns as`present: null`— tell the author that something is written when no one has proved it is
  just the error that this check exists not to commit.

### What he taught to build them

- **`\b`is ASCII, and that erases the Spanish.** The parser considered not read ALL the "yes":
  behind`í`in front of`:`there is no word frontier for JS. The correct condition is "no other letter
  follows", with`(?![\p{L}\p{N}])`and the flag`u`.
- **Two sites that know what owns a scene is an extra site.**`deleteScene()`He repeated the list of
  tables of the manuscript, and as he grew up with two more of v101 he became old: the snapshots
  survived the erasure of his scene.`deleteManuscriptFor()`.
- **An absent mark is not a null mark.**`scene.book !== null`converts a`undefined`—of any caller who
  omits the field — in ‘here begins a book’: each scene opened his own.`Boolean(...)`.

## 8. Typewriter mode — **FACT**

The line that is written stays at the height of the eyes (band at 42 %, slightly above the center:
precise centered leaves half a screen of text already written occupying the site of what is coming).
Outside the spine and the right margin;`Esc`returns the entire screen.

Three things that decided on implementation:

- **A`<textarea>`doesn't know what pixel his cursor is in.** Da`selectionStart`The only way to find
  out is to paint the same text until the cursor in a`div`Invisible with EXACTLY the same styles
  that decide where a line is broken, paste a mark on it and ask the brand. The list of styles is
  the weak point: if the mirror differs in a single one, the text is split by another site and the
  error **grows line by line** — in the middle of a chapter the measurement points to another
  paragraph.`contenteditable`would give the exact position with`Range.getClientRects()`but it would
  cost the auto-completion of`[[`(lives from`selectionStart`), the native undo stack and the IME;
  you don't pay that to place a line.
- **Without lower filling the mode dies right where the author is always.** At the end of the
  writing there is nothing below to push, so the last line cannot climb into the band and the effect
  disappears precisely while it is written.`viewportHeight * (1 - band)`filler.
- **No dead zone the TIME text under your hands**: each pulsation corrects one or two pixels. Four
  pixels of tolerance and is over.

And a limitation assumed: ** the paragraphs are not attenuated one by one**, because
a`<textarea>`You can’t style parts of your own text and a fake editor on top would be another
product. What’s honest — and does the same job — is to watch what’s far from the band with a
gradient, which also doesn’t cost a pulsation calculation because the line is always in the same
place.

## 9. After (not thoroughly designed)

- **`reviewWorldProse`in batch**, to read an entire chapter at once.
