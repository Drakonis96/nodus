# Nodus 5.4.4 release modal

The real release modal rendered in the local browser harness in Spanish, in light
and dark mode. `modal-order-es.md` contains all 5 entries in the exact displayed
order, extracted from the verified release data. `modal-light-full.png` and
`modal-dark-full.png` are the same modal with the scroll cap lifted, so every entry
is visible at once.

Reproduce with `node scripts/verify-release-notes-ui.mjs` while the visual test
server runs on port 5198. The check compares every rendered entry in all nine
interface languages and both themes, including the version picker.

The Chinese text in exported PDFs is covered by `scripts/test-pdf-cjk.mjs`, which
pins the bundled font coverage, composite-font embedding and the unchanged Latin
path. The Server image boot is covered by `scripts/test-nodus-server-deployment.mjs`.
