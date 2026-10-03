# Nodus Scriptor verification

These captures come from the compiled application running with isolated, synthetic test fixtures. They do not contain the maintainer’s preview vault or saved personal prompts.

- [Catalogue](catalog-list.png): list view, nested collections, search, tags, and the Tools shortcut.
- [Insertion before the menu fixes](insert-before.png) and [current searchable insertion](insert-search.png): the visible search field, compact menu, and icon-only Context/Focus controls.
- [Dark menu at its last item](insert-dark-last-item.png): footer and final action remain fully visible.
- [Academic delivery](academic-delivery.png): preflight warnings and an actual generated manuscript preview. This earlier academic audit capture predates the final icon-only header change.

## Storage, compatibility, and delivery

BlockNote 0.55.0 native JSON is stored alongside separate schema/revision metadata. Additive migrations 198 and 199 extend Study/Teaching documents, versions, and comment anchors. Notes keep the native document in their page’s Yjs state; web artifacts retain owner isolation, expected revisions, native snapshots, and Markdown projections. Opening a legacy document converts it in memory without writing it until an edit occurs. Unknown blocks remain recoverable compatibility blocks.

Academic references, CSL citation formatting, footnotes/endnotes, cross-references, evidence marks, manuscript chapters, preflight, and DOCX/PDF/LaTeX exports are documented in [the academic workflow report](../../scriptor-academic-workflow-2026-10-02.md). Export snapshots do not alter the original documents. Resource/preflight limitations and manual evidence checks are described there.

## Reproduction

```sh
npm run lint
npm run typecheck
npm run build
npm run build:server-web
npm run licenses:verify
node --test scripts/test-blocknote-storage.mjs scripts/test-academic-scriptor.mjs scripts/test-editor-references.mjs scripts/test-scriptor-navigation.mjs
node --test server/test/blockNoteArtifacts.test.mjs server/test/academicExport.test.mjs server/test/userProfilePreferences.integration.test.mjs
node --test scripts/test-i18n-coverage.mjs scripts/test-i18n-no-duplicate-keys.mjs scripts/test-server-generated.mjs
node scripts/e2e-editorial-workspace.mjs
node scripts/e2e-editorial-server-web.mjs
node scripts/e2e-academic-scriptor.mjs
node scripts/e2e-academic-server-web.mjs
node scripts/e2e-scriptor-actions.mjs
node scripts/e2e-scriptor-block-controls.mjs
node scripts/e2e-scriptor-insert.mjs --desktop --skip-stress
node scripts/e2e-scriptor-insert.mjs --web
node scripts/e2e-scriptor-insert.mjs --desktop --stress-only
npm run test:e2e
```

The completed insertion campaigns exercised all 30 options and their native JSON/academic metadata after saving and reopening: 52 desktop checks, 51 web checks, and one independent performance campaign. A follow-up web search campaign passed 15 checks. The post-main-integration desktop search/layout campaign passed 16 checks. Native block controls passed 224 geometry/behavior checks, with a maximum first-line alignment deviation of 0.5 px.

Eight openings with 300 paragraphs, 100 citations, and context open produced the first visible menu frame in 35.3–41.3 ms after the click. Maximum observed event-loop intervals were 63.8 ms in Electron’s main process and 64.3 ms in the renderer; the longest renderer task was 59 ms. Opening/filtering/closing without choosing preserved the native document and revision. These measurements describe the tested machine and fixture.

The final visual campaign covered desktop and web, light/dark themes, list/cards, editor, context, navigator, focus, academic dialogs, and export previews at 1280×800, 1440×900, and 1920×1080, with additional narrow-window menu checks. The audited galleries and detailed reports remain reproducible through the scripts; generated runtime output and profiles are intentionally excluded from Git.

The AI streaming regression controls only the provider transport; real UI, selections, persistence, cancellation, and one-step undo are exercised without sending test content to an external AI provider. Voice panels were visually audited at rest; the general smoke suite uses a fake microphone for capture/privacy checks. This work does not provide external peer review, automated grading, or remote-media fetching beyond existing policies.

## Pull-request integration checks

After merging current main, 133 focused checks and 50 translation/Focus/security checks passed. The final general `npm run test:e2e` completed successfully through the real Electron app, including Scriptor/Study writing, prompts, selection, native persistence, voice, Primary Sources, Worldbuilding, and Genealogy; it reported no renderer page errors and schema v199. Lint, both typechecks, Desktop/Server Web builds, and license verification also passed locally. The complete repository test inventory remains a separate CI requirement.

Follow-up fixes ensure Escape closes the foreground synonyms panel before the native formatting popover handles it, and the production Server image includes the portable sidebar migration dependency. The Server image health check and cross-repository capability verification passed on Linux, macOS, and Windows on the preceding code commit.
