# Review of the 5.8.0 release notes

Reviewed range: `v5.7.4..df6834e185f693916d656e139024049b809700a1`.
Release date: 2026-10-03. Tracked in issue #1060.

The modal contains eleven final user-visible changes in all twelve interface
languages, grouped into New features, Enhancements and Fixes. Nodus Scriptor
appears once as a new feature with its final editing and academic export behavior.
Corrections made before its first release are included in that description.
The chemistry changes in #1046 and #1058 are also described together, without
listing their intermediate implementation corrections.

## Displayed order and evidence

| Section | Order | Final outcome | Scope | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | Nodus Scriptor in Tools on Desktop and Server web, rich documents, research links, citations, bibliography, notes, chapters, academic exports, versions and cancellable AI improvements | Toolkit | #1056, `docs/scriptor-academic-workflow-2026-10-02.md` |
| Enhancements | 2 | Focus works across all nine vaults without interrupting the timer, retaining previous histories and per-vault attribution and shortcuts | Toolkit | #1050 |
| Enhancements | 3 | Optional alternative native mobile connection on macOS with more responsive pointer, highlighting and drawing | Toolkit | #1055, `electron/toolkit/presenter/native.ts` |
| Enhancements | 4 | Chemistry synthesis evidence includes recorded conditions, textbook schemes, reagent-aware routes, imported stock availability and functional-group compatibility | AI | #1046, #1058, `electron/capabilities/bootstrap.json` |
| Enhancements | 5 | Faster idea searches for large Research Chat source selections, preserving their scope | Academic | #1045 |
| Enhancements | 6 | External AppImageUpdate support with update metadata and zsync, preserving the integrated updater and download aliases | General | #1039, `docs/appimage-updates.md` |
| Fixes | 7 | Long presentation names fit the PDF Presenter sidebar and leave the options button accessible | Toolkit | #1041 |
| Fixes | 8 | Browser pages remain visible behind menus and resize without overlapping navigation | Browser | #1043 |
| Fixes | 9 | Completed extraction and retrieval results survive clean background-process exit under concurrent CPU load | Library | #1044 |
| Fixes | 10 | Reasoning opt-out follows each model's supported setting or mandatory minimum, preserving enabled user choices | AI | #1057 |
| Fixes | 11 | A single update banner stays visible during backup and installation, including postponed updates started in Settings | General | #1048 |

The writing survey announcement (#1037) already reaches installed apps through
the remote feed and is not a new writing feature. Repository-identity maintenance
(#1052), historical CLA acceptance compatibility (#1059) and CI maintenance are
not presented as new application functions.

## Version and publication metadata

Desktop package and lockfile, Server package and runtime version, Zotero and
Chrome manifests, container build arguments and labels, immutable source URLs,
source offers, notice headings, Maps request identification, citation metadata
and generated website metadata use 5.8.0. Historical release notes, historical
audit dates and the AppImage upgrade fixture retain their original versions.
The local origin now uses the canonical `jorgepb96/nodus` repository.

`docs/release-5.8.0-notes.md` is generated from the exact English modal text and
displayed order. The changelog uses the same entries. Stable release publication regenerates that body from its tag.

## Translation and visual verification

The languages are checked against the interface's `AppLanguage` union:
Spanish, English, French, German, European Portuguese, Brazilian Portuguese,
Italian, Turkish, Simplified Chinese, Traditional Chinese, Japanese and Korean.
All 132 highlight translations are present, distinct from English where
applicable, and use literal sentences without semicolons or em dashes.
The six companion translation maps register the new version explicitly.

The actual modal passed `scripts/verify-release-notes-ui.mjs` in all twelve
languages and both themes. The check verifies exact text, section order, scope
icons, previous-release selection, historical v5 sections, the unchanged v4
layout and scrolling on an 800 × 650 window. Light, dark and small-window
captures are saved in `docs/verification/release-5.8.0/` and were inspected.

## Local validation

- Release sections and translation coverage, version agreement, AGPL metadata,
  artifact names, update channels and citation checks: 29 tests passed.
- Website, interface translation coverage and duplicate-key checks: 147 tests
  passed.
- Release history, source-offer preparation, citation synchronization and the
  saved English description comparison passed.
- Full ESLint and renderer/Electron TypeScript checks passed with the locked
  dependencies under Node 22.23.2.
- `npm run build` and `npm run build:server-web` passed.
- `git diff --check` passed. Complete repository and platform checks run in PR CI
  before merge and stable publication.

## Feature availability

Chemistry tools require Chemistry Studio 2.5.8 and the corresponding local
indexes or user-imported stock lists. That signed plugin version is already
pinned in the bootstrap. No private textbook or stock data is distributed.
The optional Mac Presenter connection requires explicit activation, which the
notes state. They do not claim router-free operation or publication of the
separate mobile application. Historical Scriptor route aliases are preserved.
