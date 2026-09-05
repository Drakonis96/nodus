## Summary

Redesign the Home dashboard to make better use of horizontal space. On wider viewports the cards now display 4 per row instead of 2, so the dashboard feels less sparse and fills the available width. Each card has been given a consistent internal structure â€” uniform padding, shared card chrome, and a clearer heading hierarchy â€” and the grid holds together at every window width from compact to wide.

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

- [ ] Open the Home dashboard at various window widths (compact, medium, wide)
- [ ] Verify cards display 4 per row on wide viewports
- [ ] Verify consistent padding, border-radius, and heading hierarchy across all cards
- [ ] Verify grid spacing is uniform and no card is cramped or has excessive margins

## Screenshots

![Home page before/after, full view](pr-text/images/Home%20Panel.png)

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

- `src/views/HomeView.tsx` â€” card redesign with consistent structure and hierarchy; 4-up grid on wider viewports
- `src/index.css` â€” spacing scale and grid refinements
