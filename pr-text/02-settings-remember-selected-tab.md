## Summary

Persist the last active Settings tab in `localStorage` (`nodus.settingsTab`). When the user reopens Settings, the previously selected tab is restored instead of always resetting to `providers`. A `useEffect` writes the active tab ID to localStorage on every change; the initial state reads it back (falling back to `providers` if absent or invalid).

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

- [ ] Open Settings â†’ switch to any tab (e.g. Modelos, Privacidad) â†’ close Settings â†’ reopen; confirm the same tab is still active
- [ ] Open in a fresh browser/profile; confirm it defaults to `providers`

## Screenshots

![Settings tab state persistence](pr-text/images/Settings%20State%20Management.mp4)

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

- `src/views/Settings.tsx` â€” `SETTINGS_TAB_STORAGE_KEY`, `readRememberedSettingsTab()`, `useEffect` to persist tab; initial state now reads from localStorage
