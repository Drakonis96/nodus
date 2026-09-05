## Summary

Replace the translucent `.card` class with the existing opaque `.card-modal` class for `WorkIdeasModal` and `WorkStatusModal`. When these dialogs were open, the dimmed background page bled through the panel, making it look like a rendering bug. The `.card-modal` class is already defined for exactly this case and renders a fully opaque modal surface.

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

- [ ] Open the Ideas modal and Work Status modal in Library
- [ ] Verify the panel is opaque with no background bleed-through in both light and dark themes

## Screenshots

![Library ideas modal — before translucent vs after opaque](pr-text/images/Library%20Modal.png)

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

- `src/views/WorkIdeasModal.tsx` â€” `card` â†’ `card-modal`
- `src/views/WorkStatusModal.tsx` â€” `card` â†’ `card-modal`

## Commit

`c482cd7c` fix(ui): improve modal readability with card-modal class
