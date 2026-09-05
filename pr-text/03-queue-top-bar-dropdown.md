## Summary

Move the queue and task progress strip (scan queue, Zotero import, document indexing, embeddings) from a fixed bottom bar into a top-bar dropdown:

- A header icon with a badge counts pipelines that currently have live work â€” status is visible without opening anything.
- The dropdown embeds existing progress components unchanged (pause/resume, retry, cancel, dismiss, per-item expansion all work).
- Anchored placement, Escape/outside-click to dismiss, correct z-index layering, empty state when nothing is running.
- All new strings translated into all 8 UI languages.

## Related issue

<!-- Closes #<issue> -->

## Type of change

- [x] Bug fix
- [x] New feature or improvement
- [ ] Documentation or translation
- [ ] Refactor or maintenance
- [ ] Database, privacy, security, or infrastructure change

## Validation

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` when relevant

<!-- List manual checks below -->

- [ ] Trigger a scan or import; verify the top-bar badge appears with the correct count
- [ ] Click the badge; verify the dropdown shows live progress bars with working pause/retry/cancel
- [ ] Dismiss by pressing Escape or clicking outside; verify it closes
- [ ] Trigger multiple pipelines; verify badge counts correctly
- [ ] Complete all pipelines; verify empty state shows and badge disappears
- [ ] Test in both light and dark themes

## Screenshots

![Queue dropdown before/after](pr-text/images/Queue.png)

## Privacy and data review

- [x] No secrets, credentials, private vault content, personal data, student data, or confidential documents are included.
- [x] New network access is explicit, documented, and initiated by the user.
- [x] The change does not send rosters, grades, student answers, or other protected data to AI providers.
- [x] The change does not use AI to grade, rank, profile, or evaluate students.
- [x] Database, backup, synchronization, and migration effects are documented and tested.

## Contributor checklist

- [ ] I added or updated focused tests.
- [ ] I updated documentation where behavior changed.
- [x] I updated every language table for new static UI text.
- [x] I preserved local-first behavior and existing privacy boundaries.
- [x] I have read and followed `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## Files changed

- `src/App.tsx` â€” remove bottom queue strip; add top-bar trigger button with badge
- `src/components/QueuePanel.tsx` â€” new component: dropdown panel with embedded progress components
- `src/i18n.*.ts` â€” new strings in all 8 locales
