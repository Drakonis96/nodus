## Summary

Replace the browser's native `<select>` element with a themed custom searchable dropdown for all AI model selection across the app. The `ModelPicker` component already supported a `menu` mode (custom dropdown with search), but it was only used in a few places. All other locations fell back to the native `<select>`, which ignores app theme colours and renders inconsistently across OS/browsers.

The fix adds the `menu` prop to every `ModelPicker` / `ModelWithReasoning` call across the codebase. The dropdown's CSS (`modelPicker.css`) uses `--n-*` (neutral) and `--a-*` (accent) CSS variables instead of hardcoded hexes, so the control now respects the selected theme and accent colour.

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

- [ ] Open Settings â†’ AI Models; verify the model picker renders as a themed custom dropdown with a search input
- [ ] Open Dictionary, Authors, Argument Map, Hypothesis Lab, Immersion, Deep Research, Database Deep Research, Databases, Study Chat, World Chat, Toolkit (OCR, Apps, Translate), and Writing Workshop views; verify each AI model picker uses the custom dropdown with matching theme colours in light and dark modes

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

- `src/components/modelPicker.css` â€” CSS uses `--n-*` / `--a-*` vars
- `src/components/ModelPicker.tsx` â€” forward `menu` prop through `ModelWithReasoning`
- `src/components/GeneralTextModelControl.tsx` â€” add `menu` prop
- `src/views/Settings.tsx` â€” AI Models tab + Study AI section pickers
- `src/views/DictionaryView.tsx` â€” 3 usages
- `src/views/AuthorsView.tsx`, `src/views/ArgumentMapView.tsx`, `src/views/HypothesisLabView.tsx`, `src/views/ImmersionView.tsx`, `src/views/DeepResearchView.tsx`, `src/views/DatabaseDeepResearchView.tsx`, `src/views/DatabasesView.tsx`, `src/views/StudyChatView.tsx`, `src/views/WorldChatView.tsx`, `src/views/ToolkitAiOcrView.tsx` (2 usages), `src/views/ToolkitAppsView.tsx`, `src/views/ToolkitTranslateView.tsx`, `src/views/WritingWorkshopView.tsx`

## Commit

`1309b130` fix(ui): replace native select with themed custom dropdown for all AI model pickers
