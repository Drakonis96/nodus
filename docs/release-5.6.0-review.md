# Review of the 5.6.0 release notes

Prepared from local `main` at `a1fc8459`, in a new worktree on `codex/release-5.6.0`.
The reviewed range is `v5.5.0..a1fc8459`. The release date is 2026-09-20.

The modal contains twelve entries in all twelve interface languages: Spanish,
English, French, German, Portuguese, Brazilian Portuguese, Italian, Turkish,
Simplified Chinese, Traditional Chinese, Japanese and Korean. The notes describe
implemented behavior in literal language. The introductory sentence also uses
literal language. Published historical release notes retain their original text.

## Scope and order

The existing modal groups entries by area, largest group first, with stable ties.
The new array follows that order directly. The UI check compares every rendered
entry, its translation and its scope against the array in every language.

| Order | Reviewed change | Implementation evidence |
| --- | --- | --- |
| 1–2 | Auto/Manual choice, authored ideas and local indexing | #912, `docs/verification/academic-manual/REVIEW.md` |
| 3 | New Concilium feature in Research Chat with two to five models and saved individual responses | #900, `docs/research-concilium.md` |
| 4 | Independent graph theme tabs, scope and connection controls | #906, `docs/graph-theme-navigation.md` |
| 5 | Startup updates in the header notice | #902, `src/components/UpdateReadyNotice.tsx` |
| 6 | Missing AI model warning in Notifications | #908, `src/components/NotificationsPanel.tsx` |
| 7 | Research Chat header layout and duplicate actions | #916, `src/views/ResearchAssistantModal.tsx` |
| 8–9 | Study/Teaching source selection and moves preserving data | #904, #918, `docs/research-chat-views.md`, `docs/verification/study-moves/README.md` |
| 10 | Retrieved product documentation and Skills overflow fix | #893, `ecdc1b59`, `f9abd8af`, `electron/ai/nodi.ts` |
| 11 | Searchable tool catalogue and individual sidebar pins | #899, `src/views/ToolkitView.tsx` |
| 12 | Zotero database shutdown independent of the sidebar | #914, issue #909, `zotero-plugin/` |

Repository, build and website-only changes are not presented as new app features.
The preparation updates active release references in the desktop and server
packages, lockfile root records, both extension manifests, source-offer links,
Docker/Compose/Portainer configuration, server image workflow, map request user
agent, citation and generated website metadata. Historical entries, historical
test fixtures and dependency version ranges are not release references.

## Verification

- `npm run typecheck`: passed for renderer and Electron.
- Focused release suite: **246 tests passed**, zero failures or skips. Includes
  release notes, i18n coverage/duplicates/resource regressions, version agreement,
  AGPL/source metadata, release readiness and artifact names, Zotero packaging,
  server deployment, modal support links and all `test-site-*` checks.
- After clarifying that Concilium is a new Research Chat feature in every language,
  the release-note and i18n coverage tests passed again (35 tests), followed by
  the complete modal UI verification and refreshed screenshots.
- `node scripts/verify-release-notes-ui.mjs`: passed in all twelve languages,
  both light and dark. Checks the active v5.6.0, exact text/order/scope, previous
  v5.5.0 in the picker, absence of unpublished v5.3.2 and no renderer errors.
- `node scripts/sync-citation.mjs --check`, source-offer contract and
  `git diff --check`: passed. Site metadata and sitemap were regenerated.
- Screenshots were visually inspected in both themes. Full screenshots lift the
  scroll cap to show every entry. Normal screenshots preserve the modal viewport.
- A dedicated renderer-only Vite configuration limits dependency scanning to the
  release-notes harness and deduplicates React. This avoids duplicate React
  instances while rendering the production modal without a user profile.

No production installer or Docker image was built, and no release was published.
Translations were checked for coverage and rendered text, not by native reviewers.

## Reproduce the screenshots

```sh
npx vite --config visual-tests/vite.release-notes.config.mjs
node scripts/verify-release-notes-ui.mjs
```

For a different port, pass `--port 5199` to Vite and set
`NODUS_RELEASE_NOTES_URL=http://127.0.0.1:5199` for the verification command.
The script writes captures and the ordered Spanish text under
`artifacts/release-5.6.0/`. Reviewed copies are in
[`verification/release-5.6.0/`](verification/release-5.6.0/table-es.md).
