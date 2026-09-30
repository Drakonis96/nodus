# Review of the 5.7.3 release notes

Prepared on `codex/v5.7.3-release` from `044ea310`. Reviewed range:
`v5.7.2..044ea310`, 59 commits and nine merged pull requests. Release date:
2026-09-30. The release preparation is tracked in issue #1008.

The modal has nine final user-visible changes in all twelve interface languages.
The complete study guide and Drift each appear once, including the final behaviour
of their pre-release iterations. No intermediate implementation corrections are
listed separately.

## Displayed order and evidence

| Section | Order | Final outcome | Icon | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | Offline Drift mixer with six sounds, individual volumes, named mixes, search and player | Drift headphones | #998, `shared/drift.ts`, `src/views/ToolkitDriftView.tsx`, `src/components/drift/` |
| New features | 2 | Complete study guide with cited chapters, self-check questions, review sheet, figures, optional web content, estimate and exports | Study graduation cap | #985, `docs/complete-study-guide.md`, `shared/completeGuide/`, `src/components/CompleteGuideComposer.tsx` |
| New features | 3 | Check favourites missing from provider catalogues, replace task selections or remove favourites | AI sparkles | #1001, `shared/staleModels.ts`, `src/components/FavoriteModelAvailability.tsx` |
| Enhancements | 4 | Library OCR origin, excluded page counts and documented limits | Library | #1004, `shared/textProvenance.ts`, `src/i18n.textProvenance.ts` |
| Enhancements | 5 | Faster saved citation support repair when opening a vault | Library | #1005, `electron/ai/documentSupportRepair.ts` |
| Enhancements | 6 | Faster corpus inventory, compact scope, consulted-source coverage and useful oversized-request errors | Academic network | #1003, `shared/researchCorpus.ts`, `electron/ai/researchScopePrompt.ts` |
| Fixes | 7 | Provider input/context limits and distinct reasoning/response budgets | AI sparkles | #999, `shared/providerContextWindows.ts`, `scripts/test-provider-context-integration.mjs` |
| Fixes | 8 | Active streaming responses can outlast three minutes, with idle and total bounds | AI sparkles | #1000, `electron/ai/transportDeadline.ts`, `scripts/test-transport-idle-deadline.mjs` |
| Fixes | 9 | Archive Zotero trashed, deleted or merged works while keeping notes and analysis | Zotero Z | #1002, `scripts/test-zotero-removal-reconciliation.mjs` |

## Retroactive structure and publication

All 31 previous v5 entries gain editorial categories. Their text, translations,
scopes and dates remain byte-identical after stripping the category property.
All entries before v5 remain unchanged. Scope ordering still uses descending
scope group size with stable ties, now inside each section. Empty sections retain
translated headings and a translated no-changes message.

`shared/releaseNotesPresentation.ts` owns sections, their twelve translations and
English Markdown output. `scripts/generate-release-notes.mjs` requires the current
package version, its modal entry, translations, categories and matching date.
`docs/release-5.7.3-notes.md` is its generated output. The stable/beta workflow
uses this file format at draft creation/reuse and regenerates it before publishing.
Both publication commands set the generated description in the same operation.

Updated desktop, server, browser connector and Zotero versions, Docker metadata
and source slugs, source offers, citation, third-party notice headings and generated
website metadata. Historical version references and third-party dependency versions
are preserved.

## Verification

- Release notes and modal support tests pass.
- Category, English-description, stable/beta workflow, version agreement, AGPL,
  artifact-name, update-channel, citation, SEO and sitemap checks pass (42 tests).
- Full interface translation coverage passes (35 tests).
- Full renderer and Electron TypeScript checks pass.
- Changed TypeScript files pass ESLint.
- Citation synchronization and corresponding-source preparation checks pass.
- The release workflow parses as YAML.
- Visual check passes for the current release in all twelve languages in both
  themes, each historical v5 release in every language, v4 without sections,
  and scrolling in a small window. It checks exact text, order and icon scopes.
- Light and dark normal/full captures and a small-window capture are in
  `artifacts/release-5.7.3/`. Full captures lift the scroll height only to show the
  entire modal in one image. Runtime window sizing remains unchanged.

The reviewed light and dark modal screenshots are also saved under
`docs/verification/release-5.7.3/` for review in the pull request.

## Windows packaging recovery

The first stable build failed in `afterPack` while auditing the Drift recordings
inside `app.asar`. The verifier normalized archive paths to `/` before calling
ASAR's native-path lookup, which requires `\` on Windows. It now retains the
native paths for file reads and uses normalized paths only for catalogue matching.
A regression test reads a real archive through Windows-style paths and also
checks that corrupted audio still fails its SHA-256 audit.

For the existing immutable `v5.7.3` tag only, the Windows release job checks out
the corrected verifier from the exact workflow commit before packaging. This
build-only script is outside the packaged file patterns; the tagged application,
recordings, legal notices and corresponding-source reference remain unchanged.
Later release tags include the corrected verifier directly.

## CI metadata recovery

The post-merge CI exposed two packaging assertions still expecting v5.7.2 and
a sitemap generated before the release metadata commit. The v4 compatibility
and Zotero packaging tests now compare their version, source tag and citation
date with the current package metadata instead of embedding a release number.
The sitemap is regenerated after the content commit so its four affected dates
match the source history. The focused suites pass all 93 tests.

The v5.7.3 Zotero release job also obtains the corrected test from the exact
workflow commit. Its tagged plugin code, source offer, generated XPI and update
manifest are unchanged by this test-only recovery.
