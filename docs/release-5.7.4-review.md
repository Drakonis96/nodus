# Review of the 5.7.4 release notes

Prepared from `f7521ffd4b364a6ff14a3f0b0a02504cbfd91e2a`. Reviewed range:
`v5.7.3..f7521ffd`, including the final merged behavior of each feature.
Release date: 2026-10-02. Tracked in issue #1034.

The modal contains nine final user-visible changes in all twelve interface
languages, grouped as New features, Enhancements and Fixes. Descriptions use
literal language. Presenter transport, PDF transfer, video readiness, pointer
color and blackout iterations are included in the final Presenter behavior,
rather than listed as separate fixes to an unreleased feature. CI maintenance
and recovery of the previous release are not presented as application features.

## Displayed order and evidence

| Section | Order | Final outcome | Scope | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | QR pairing with the native iPhone/iPad Presenter app on macOS, Windows and Linux, with local-network requirements stated | Toolkit | #1028, #1030, #1033, `docs/presenter/native-mobile.md` |
| New features | 2 | Optional simplification of reaction schemes and figure fragments in new PDFs, preserving prose, captions and references | Library | #1029, `electron/extraction/textExtractor.ts`, `electron/extraction/schemeLayout.ts` |
| Enhancements | 3 | Nested Presenter folders, search, move/delete choices, tag migration and resizable slide/notes areas | Toolkit | #1028, `docs/pdf-presenter.md` |
| Enhancements | 4 | Library orientation summaries request reasoning off where supported | Library | #1031, `electron/ai/summaryScan.ts` |
| Fixes | 5 | One retry for a dropped connection before answer text and for a Research Chat answer reaching the output limit | AI | #1014, #1015, #1016, `electron/ai/aiClient.ts`, `electron/ai/cutOffRetry.ts` |
| Fixes | 6 | Immersion original-page access through Zotero and truthful local-versus-MCP activity reporting | Academic | #1018, `docs/research-chat-views.md` |
| Fixes | 7 | Month calendar day numbers no longer overlap events | General | #1020, `src/views/StudyCalendarView.tsx` |
| Fixes | 8 | macOS volume synchronization and active custom-audio reader pause/resume | Browser | #1026, `electron/toolkit/presenter/systemVolume.ts`, `src/components/browser/useDeviceVolume.ts` |
| Fixes | 9 | Documentary Index waits for pending passage indexing and passage preparation shows a preparation label | Library | #1031, `electron/ai/passageEmbeddingActivity.ts` |

## Version and publication metadata

Updated desktop and lockfile metadata, server, Zotero plugin, browser connector,
Docker build/version labels, immutable source URLs in deployment templates,
source offers, third-party notice headings, Maps request identification, citation
and generated website metadata. The previous release's historical notes and
tag-specific packaging recovery remain unchanged.

`docs/release-5.7.4-notes.md` is generated from the modal's English text and
displayed order. The stable workflow regenerates the description from the tag
at draft creation and publication. No independent release body is maintained.

## Verification

- Section, description generation, version agreement, licensing, artifact-name,
  update-channel and citation tests pass (28 tests).
- SEO, site metadata, Zotero, v4 compatibility and server deployment tests pass
  (105 tests).
- Full translation coverage and duplicate-key checks pass (46 tests).
- Release-history and modal support checks pass.
- Renderer and Electron TypeScript checks pass.
- Changed TypeScript files pass ESLint.
- Citation synchronization, corresponding-source preparation, saved English
  description comparison and workflow YAML parsing pass.

- Visual checks pass for the current release in all twelve languages and both
  themes, all historical v5 entries in every language, the v4 layout and
  small-window scrolling. Exact text, section order and icon scopes are checked.
- Regenerated sitemap freshness after the metadata commit. Sitemap checks pass.
- Reviewed modal captures are saved in `docs/verification/release-5.7.4/`.

## Native Presenter validation limits

Existing transport CI and iOS simulator checks cover the native companion.
Physical Mac/iPhone peer-to-peer recovery and Windows/Linux/iPhone firewall and
guest-network checks remain outstanding as recorded in
`docs/presenter/native-mobile.md`. These release notes do not claim a tested
router-free connection or public App Store availability. This preparation does
not publish the separate mobile application.
