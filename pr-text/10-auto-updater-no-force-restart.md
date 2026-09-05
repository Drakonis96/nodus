## Summary

Remove the `setTimeout(() => void installDownloadedUpdate(), 1200)` call that forced the app to restart 1.2 seconds after `electron-updater` finished downloading a new version. The notification message also said "Reiniciando para instalarla…" (Restarting to install…), implying an automated restart was in progress.

The app now follows the industry-standard pattern: update downloads silently in the background, user receives a notification with the option to click "Instalar ahora" to restart on their own schedule, or the update installs on the next scheduled app quit.

## Related issue

<!-- Closes #<issue> -->

## Type of change

- [x] Bug fix
- [ ] New feature or improvement
- [ ] Documentation or translation
- [ ] Refactor or maintenance
- [ ] Database, privacy, security, or infrastructure change

## Validation

- [x] `npm run lint`
- [x] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` when relevant

<!-- List manual checks below -->

- [ ] Trigger an update download (e.g. via a test update server with a newer version)
- [ ] Verify the notification reads "Haz clic en 'Instalar ahora'…"
- [ ] Verify the app does **not** restart automatically after download completes
- [ ] Verify the "Install now" button works correctly when clicked

## Screenshots

<!-- Remove if not applicable. -->

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

- `electron/main.ts` — removed `setTimeout` auto-restart trigger; updated user-facing messages
