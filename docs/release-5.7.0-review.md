# Review of the 5.7.0 release notes

Prepared from local `main` at `6abb7fe7`, in a new worktree on `zcode/sess-37f59f04`.
The reviewed range is `v5.6.0..6abb7fe7`, which is 363 commits and 49 merged pull
requests. The release date is 2026-09-28.

The modal contains twenty-one entries in all twelve interface languages: Spanish,
English, French, German, Portuguese, Brazilian Portuguese, Italian, Turkish,
Simplified Chinese, Traditional Chinese, Japanese and Korean. The notes describe
implemented behavior in literal language. Published historical release notes
retain their original text.

## Scope and order

The existing modal groups entries by area, largest group first, with stable ties.
The new array follows that order directly. The UI check compares every rendered
entry, its translation and its scope against the array in every language.

| Order | Reviewed change | Implementation evidence |
| --- | --- | --- |
| 1 | The documentary index answers from the full text of the works, and the preparation notice separates indexing from idea extraction | #932, `docs/agentic-corpus-notebooks.md`, #972 |
| 2 | Research notebooks with a fixed selection or linked Zotero collections, per-notebook preparation and partial coverage | #932, `docs/research-chat-views.md` |
| 3 | The Context balloon's three layer switches, with a switched-off layer not consulted and the activity balloon | #932, `shared/researchContextLayers.ts`, `src/components/ResearchActivityPanel.tsx` |
| 4 | The packaged web search step, with citations that open in Nodus Browser | #932, `docs/research-evidence/web-search-acceptance.md` |
| 5 | Synthesis routes checked against the systematic IUPAC name, with guided repair and a blocking route review | #923, #930, #950, `shared/moleculeInspection.ts` |
| 6 | Dated historical maps from OpenHistoricalMap, their provenance and their named refusals | #929, `electron/capabilities/maps/openHistoricalMap.ts` |
| 7 | Graph health in Settings › Data, the repair and the corrected dormancy rule | #967, `electron/db/graphIntegrity.ts`, `electron/db/ideaDormancy.ts` |
| 8 | The thinking level remembered per model, the middle default and the Deep Research and Immersion forms | #938, #932, `shared/researchReasoning.ts` |
| 9 | Anthropic transport recovery (deprecated `temperature`, adaptive thinking, named refusals, truncated streams) | #940, `electron/ai/providers.ts`, `electron/ai/aiClient.ts` |
| 10 | Chat history replays only the model's prose (92 % of the replayed text removed on a real conversation) | #941, `chatProseForHistory` |
| 11 | Native menus (text fields and Browser) follow the interface language | #944, `shared/menuLabels.ts` |
| 12 | Desktop translations no longer replaced by the server's English, and mistranslated terms corrected | #970, `scripts/i18n-server-clobber.mjs` |
| 13 | The first-run guide offers every interface language and one term per language for vault | #980, `src/components/modelGuidanceCopy.ts` |
| 14 | Focus sessions, the Pomodoro dashboard and focus mode in Study | #960, `docs/verification/study-focus/README.md` |
| 15 | Workspace notes linked to courses, subjects, folders, topics and materials | #975, `docs/verification/study-note-links/README.md` |
| 16 | Outlook `.ics` export and one-way Apple Calendar sync | #958, `src/i18n.calendarSync.ts` |
| 17 | Research Chat's chat history organization on the databases, worldbuilding, study and teaching surfaces | #932, `scripts/lib/chatHistoryContract.mjs` |
| 18 | One app-wide tooltip layer for every `title` | #952, `src/tooltipLayer.ts` |
| 19 | Research Atlas filters holding several values, each with a checkbox | #934, #936, `src/components/browser/NodusStartPages.tsx` |
| 20 | Favicons resolved again for tabs and bookmarks | #933, `electron/browser/favicon.ts` |
| 21 | Attendance in teaching groups: marks, holidays, totals and CSV/XLSX export | #954, `docs/verification/teaching-attendance/` |

Repository, build and website-only changes are not presented as new app features.
The site work merged in the same range (#922, #925, #956, #974, #977, #978, #982)
and the shared runtime refactor (#948) are therefore absent from the modal. So are
the capability pins that only stage other work (#927, #942, #949), the
reaction-index downloader, which does not activate lookup in chat yet (#947), the
test-only repairs (#939) and the internal clock fix (#946).

The range's intermediate corrections are folded into what entered. #961–#966 were
never in a release, so entry 7 states the rule and the repair that shipped, not the
sequence of fixes and reversals behind it. #936 is part of entry 19, and the
Chemistry Studio 2.5.x pins are part of entry 5.

Two dependencies are worth stating explicitly. The dated map lane needs the
Research Visuals package, which is published separately and still declares an
earlier floor, so entry 6 describes the application side that ships here. The
reaction-precedent lookup is not active and has no entry.

The preparation updates active release references in the desktop and server
packages, lockfile root records, both extension manifests, source-offer links,
Docker/Compose/Portainer configuration, server image workflow, map request user
agent, citation and generated website metadata. Historical entries, historical test
fixtures and dependency version ranges are not release references.

## Verification

- `npm run typecheck`: the renderer project is clean. The Electron project reports
  two `TS2307` errors for `linkedom` and `@mozilla/readability` in
  `electron/websearch/webPageExtract.ts`, both declared dependencies that are
  missing from the borrowed `node_modules` of the main checkout. No changed file is
  involved, and CI installs the same lockfile.
- Focused release suite: **75 tests passed**, zero failures or skips. Includes
  release notes, i18n coverage/duplicates/resource regressions/server clobber, the
  What's New support links and the modal animation budget.
- Version and metadata suites: **30 tests passed** (version agreement, artifact
  names, both site checks, superseded versions, macOS release security).
- `scripts/test-zotero-plugin.mjs` (87), `scripts/test-nodus-server-deployment.mjs`
  (5) and `scripts/test-v4-release-readiness.mjs` pass with the new version and
  release date.
- `npm run site:verify`: 101 tests passed. `npm run site:metadata` regenerated the
  three pages and `npm run site:sitemap` wrote 25 URLs with no date change.
- `node scripts/verify-release-notes-ui.mjs`: passed in all twelve languages, both
  light and dark. Checks the active v5.7.0, the exact text, order and scope of all
  twenty-one entries, v5.6.0 present in the picker, unpublished v5.3.2 absent and no
  renderer errors.
- `npm run citation:check`, `npm run release:verify-source` and `git diff --check`:
  passed.
- Screenshots were visually inspected in both themes. Full screenshots lift the
  scroll cap to show every entry. Normal screenshots preserve the modal viewport.

No production installer or Docker image was built, and no release was published.
Translations were checked for coverage and rendered text, not by native reviewers.

## Reproduce the screenshots

```sh
npx vite --config visual-tests/vite.release-notes.config.mjs --port 5199
NODUS_RELEASE_NOTES_URL=http://127.0.0.1:5199 node scripts/verify-release-notes-ui.mjs
```

Port 5198 belongs to the other session's harness, so the 5.7.0 pass used 5199. The
script writes captures and the ordered Spanish text under `artifacts/release-5.7.0/`.
Reviewed copies are in
[`verification/release-5.7.0/`](verification/release-5.7.0/table-es.md).
