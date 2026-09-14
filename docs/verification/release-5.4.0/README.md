# Nodus 5.4.0 release modal

The real release modal rendered in the local browser harness in Spanish, in light
and dark mode. `modal-order-es.md` contains all 25 entries in the exact displayed
order, extracted from the verified release data.

Reproduce with `node scripts/verify-release-notes-ui.mjs` while the visual test
server runs on port 5198. The check compares every rendered entry in all eight
languages and both themes, including the version picker.
