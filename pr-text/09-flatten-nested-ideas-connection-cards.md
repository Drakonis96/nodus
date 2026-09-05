## Summary

Flatten the Ideas detail page's connection entries from three visual card levels to two. Previously the page could render: connections panel â†’ connection card â†’ expanded source/occurrence card inside the connection card. Connection entries are now lightweight bordered list items rather than cards, so the maximum depth is two visual card levels (the connections panel and any occurrence cards it contains).

Audit: `NodeDetailPanel`, `IdeaDetailModal`, `WorkIdeasModal`, Home dashboard status cards and tiles â€” all already stop at two levels. No other three-level stacks were found.

**Follow-up.** The audit missed a third case with the same visual effect: `OccurrenceCard`'s AI-generated summary block (the "Resumen (orientación)" box) rendered as a full rounded/bordered/background box nested inside the already-boxed occurrence card. It reads as a card-in-a-card even though it never used the `.card` class. Flattened it to a left-border accent, matching the treatment already used for evidence quotes elsewhere in the same component. `OccurrenceCard` is shared, so this also fixes the same spot in `IdeasView`, `WorkIdeasModal`, `NodeDetailPanel`, and `IdeaDetailModal`.

## Related issue

<!-- Closes #<issue> -->

## Type of change

- [x] Bug fix
- [ ] New feature or improvement
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

- [ ] Open the Ideas detail view and expand a connection entry
- [ ] Verify no triple-nested card appearance
- [ ] Verify connection entries are visually lightweight bordered items
- [ ] Verify expanded details are still accessible and readable

## Screenshots

<!-- Add before-and-after screenshots for visible UI changes. Remove if not applicable. -->

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

- `src/views/IdeasView.tsx` â€” connection entries use lightweight list-item styling instead of nested card

## Commit

`75898874` ui: flatten nested Ideas cards
