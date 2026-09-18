# Nodus 5.5.0 release modal

The real release modal rendered in the local browser harness in Spanish, in light
and dark mode. `modal-order-es.md` contains all 21 entries in the exact displayed
order, extracted from the verified release data. `modal-light-full.png` and
`modal-dark-full.png` are the same modal with the height cap lifted, so every entry
is visible at once.

Reproduce with `node scripts/verify-release-notes-ui.mjs` while the visual test
server runs on port 5198 (`npx vite --config visual-tests/vite.config.ts --port 5198`).
The check compares every rendered entry in all twelve interface languages and both
themes, including the version picker, and writes the full-height captures too, so the
four screenshots and the order file come from one run.

The release has twenty-one notes across seven scopes. The modal clusters highlights
by scope and orders the clusters by size, so the eight AI notes lead, the five
General notes follow, then the three Library notes, the two Languages notes, and the
single Connector, Estudio and Word notes close the list.

`scripts/test-release-notes.mjs` pins the current-release shape: 21 notes, the scope
order above, the ten translations that must not fall back to English, and the
`> 80` character floor in the eight languages it has checked since 5.4.2 (Spanish,
English, French, German, both Portugueses, Italian and Turkish). Every note is
checked for the two rules that apply from 3.1.0 on: no semicolons and no em dashes,
in every language.

The three notes that a reader may want to check against the app: the local engine
report lives in Settings → Integrated local models, the palettes in Settings →
Apariencia, and the red local-model warning beside every model picker, including
both wizard pickers.
