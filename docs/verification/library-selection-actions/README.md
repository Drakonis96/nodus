# Library selection actions verification

Screenshots of the two actions the Library's selection bar gained, taken from the
production build running against a throwaway profile with four synthetic works. No
private vault content, credentials or live model responses are shown.

The fixture puts the four works in the four states the bar has to read: one analysed,
one untouched, one half-analysed and one whose light scan failed. Selecting all four is
the shape both actions are designed around — "Retry what is missing" is offered only
while some selected work still has something left, and the count is works, not steps.

- `bar-light.png` and `bar-dark.png`: the bar with the repair action ("Reintentar lo que
  falta · 4 obra(s)", in the neutral ghost style) and the destructive action ("Eliminar
  selección", solid red with white text) in both themes.
- `confirm-light.png` and `confirm-dark.png`: the confirmation. It names the works, the
  derived data that goes with them, and the data that is kept; the dialog surface is
  opaque in both themes so the list behind it cannot read through the wording of the
  action that cannot be undone.
- `window-light.png` and `window-dark.png`: the same bar in place, with the rows it acts
  on, so the position and weight of the actions can be judged in context.

Reproduce with `node scripts/verify-library-selection-actions.mjs` after a build. The
script asserts what a screenshot cannot: that neither action is offered with an empty
selection, the retry count matches the selected works, the destructive action computes to
`rgb(220, 38, 38)` in the running theme, and the confirmation names both what is removed
and what is preserved. It cancels the confirmation, so it deletes nothing.
