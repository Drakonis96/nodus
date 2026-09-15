# Nodus 5.4.5 release modal

The real release modal rendered in the local browser harness in Spanish, in light
and dark mode. `modal-order-es.md` contains all 11 entries in the exact displayed
order, extracted from the verified release data. `modal-light-full.png` and
`modal-dark-full.png` are the same modal with the height cap lifted, so every entry
is visible at once.

Reproduce with `node scripts/verify-release-notes-ui.mjs` while the visual test
server runs on port 5198. The check compares every rendered entry in all nine
interface languages and both themes, including the version picker, and now writes
the full-height captures too, so the four screenshots and the order file come from
one run.

The release has eleven notes across four scopes. The modal clusters highlights by
scope and orders the clusters by size, so the six Library notes lead, the three
Nodus Browser notes follow, and the single Languages and General notes close the
list. Two of the Library notes ship with their own tests elsewhere:
`scripts/test-work-deletion.mjs` covers the delete with its derived data, and
`scripts/test-release-notes.mjs` pins the current-release shape, the per-language
prose rules and the `> 80` character floor that all eleven notes clear.
