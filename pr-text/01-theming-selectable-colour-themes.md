## Summary

Introduce a CSS design-token layer on top of the existing light/dark modes so the app supports an extensible set of colour themes (the 10 ColorHunt palettes shipped are examples â€” additional themes can be added by dropping a JSON palette file into `res/themes/`; regeneration is automatic). Each theme defines 3 anchor colours (accent + deep surface + pale surface) expanded to full `--n-*` (neutral) and `--a-*` (accent) CSS ramps via a build script (`scripts/gen-theme-utilities.mjs`). The script generates `tokens.generated.css` + `utilities.generated.css` with `html.theme-<id>` scoped rules that win the cascade only when a non-default theme is active. A Vite plugin runs the generator on every `npm run dev` / `npm run build` and re-runs it live when a palette file changes, so there is no manual step in the common case; `npm run gen:theme` remains as a standalone entry point. Light mode retints surfaces and accent utilities; dark mode role-shifts accent so text/icons remain readable. WCAG contrast floors are enforced in CI.

Native `<select>` option lists are also themed via `html:not(.theme-default).<mode>` overrides. The feature is wired to `settings.appTheme` with pre-paint application (no flash on launch), a Settings swatch picker, a command-palette action, and Nodus Server portable-profile sync.

### What was done

- **Token infrastructure**: `scripts/gen-theme-utilities.mjs` reads theme palette files from `res/themes/` (one JSON per palette) and emits `tokens.generated.css` + `utilities.generated.css`. Each palette defines `accent`, `deep`, and `pale` base colours; the script expands them into full `--n-*` neutral and `--a-*` accent ramps.
- **Automatic regeneration**: a Vite plugin (`vite.config.ts`) runs the generator on `buildStart` for both `npm run dev` and `npm run build`, and watches `src/theme/themes.mjs` during dev so an edit regenerates and hot-reloads the CSS without a restart. `npm run gen:theme` still works as a manual entry point; the generated files stay committed and `scripts/test-theme-utilities-fresh.mjs` fails CI if they drift.
- **Scope mechanism**: `html.theme-<id>` selectors ensure non-default themes only activate when explicitly set, so the default theme behaves identically to before.
- **Dark mode**: accent utilities are role-shifted (lightened/darkened) so they remain readable against dark surfaces without clashing with text.
- **Native `<select>`**: option list background and text are overridden per theme via `html:not(.theme-default) select option` rules, keeping dropdowns consistent with the chosen palette.
- **Pre-paint application**: the theme class is applied before first paint to eliminate the flash-on-launch issue that plagues naive theme-switching implementations.
- **Persistence**: theme preference stored in `settings.appTheme`, synced across devices via Nodus Server portable-profile.
- **WCAG enforcement**: contrast ratio floors are tested in CI (`test-theme-contrast`).
- **Accent consistency for library controls**: the Library header's scope switcher and help button were using hardcoded colours; they now use `--a-*` theme accent variables and automatically follow the selected theme palette.

## Related issue

<!-- Closes #<issue> -->

## Type of change

- [ ] Bug fix
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

- [ ] Delete `src/theme/*.generated.css`, run `npm run dev` (or `npm run build`); verify the Vite plugin regenerates them with no diff against the committed files
- [ ] Open Settings â†’ Appearance; try each of the 10 themes in light and dark mode; verify no flash on switch
- [ ] Open Library, Ideas, and table-heavy pages under each non-default theme; verify no invisible text
- [ ] Open a native `<select>` dropdown under a non-default theme; verify option list matches the field
- [ ] WCAG contrast test passes: `npm test` (test-theme-contrast)

## Screenshots

![Gallery grid — each theme in dark mode](pr-text/images/Theming%201.png)
![Same gallery, light mode](pr-text/images/Theming%202.png)
![Light mode before/after — accent-only tint vs full surface retint](pr-text/images/Theming%203.png)
![Unreadable accent button in light mode, before vs after](pr-text/images/Theming%204.png)

## Privacy and data review

- [x] No secrets, credentials, private vault content, personal data, student data, or confidential documents are included.
- [x] New network access is explicit, documented, and initiated by the user.
- [x] The change does not send rosters, grades, student answers, or other protected data to AI providers.
- [x] The change does not use AI to grade, rank, profile, or evaluate students.
- [x] Database, backup, synchronization, and migration effects are documented and tested.

## Contributor checklist

- [ ] I added or updated focused tests.
- [x] I updated documentation where behavior changed.
- [x] I updated every language table for new static UI text.
- [x] I preserved local-first behavior and existing privacy boundaries.
- [x] I have read and followed `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## Notes

Deferred: folding per-vault indigo remaps (~900 lines in index.css) and hand-written `.light` utility remaps onto the token layer. The Nodi overlay window is not themed.
