# Appearance and themes

Nodus ships with two colour modes — **light** and **dark** — and a layer of **selectable colour themes** on top. A theme retints the neutral and accent ramps without replacing the mode, so dark mode stays dark and light mode stays light; only the palette changes.

---

## Choosing a theme

Open **Settings → Appearance**. The **Colour theme** row shows a grid of swatches — click any one to apply it immediately. The change is pre-painted (no flash on switch) and persists across restarts.

You can also pick a theme from the **command palette** (`Ctrl+K` / `Cmd+K`).

Themes are synced to Nodus Server via the portable profile, so Desktop and Server stay in step.

---

## How it works

Every theme defines three anchor colours:

- **Accent** — the primary brand colour (used for buttons, links, active states, focus rings)
- **Deep surface** — the darker tinted background
- **Pale surface** — the lighter tinted background

A build script (`npm run gen:theme`) reads each palette file from `res/themes/` and expands those three anchors into full `--n-*` (neutral) and `--a-*` (accent) CSS custom-property ramps. The generated output is committed to the repo.

When you select a theme, Nodus applies an `html.theme-<id>` class. Generated CSS rules scoped to that class retint every `neutral-*` and `indigo-*` utility the app uses, in both light and dark modes. The default theme carries no rules, so the app behaves exactly as it did before the feature was added.

### Dark mode accent handling

Accent utilities are **role-shifted** in dark mode so text and icons stay readable:

- Accent text and icons map to `--a-300` / `--a-400` (light shades that read clearly on dark surfaces)
- Pale accent fills become a faint tint
- Solid fills, borders and rings keep the straight shade

This prevents the common dark-mode problem where `text-indigo-500` icons vanish and `bg-indigo-100` chips flash white.

### Accent consistency

After picking a non-default theme, most of the app follows the new accent. The **"This vault / Global" switcher** in the library header and the **"?" help button** next to it previously used hardcoded per-vault-type hexes, ignoring the theme entirely. Both now use `--a-*` tokens (`--a-600` for the active pill, `--a-400` for the focus ring, `--a-500` for the help button), so they re-accent with any selected theme. The default theme renders identically to before.

### WCAG contrast

All shipped themes pass WCAG contrast floors in both modes:

- Body text on background: ≥ 4.5:1
- Muted text on card: ≥ 3:1
- White label on accent button: ≥ 4.5:1 at `--a-700`, ≥ 3.8:1 at `--a-600`

A CI test (`npm test`, `test-theme-contrast`) verifies every theme × mode combination automatically.

### Native `<select>` dropdowns

Platform-native `<select>` dropdowns are also themed. The option list background and text are overridden per theme via CSS, so dropdowns match the chosen palette even though the browser controls them.

---

## Adding a new theme

1. Create a JSON palette file in `res/themes/`:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "accent": "#6366f1",
  "deep": "#1e1b4b",
  "pale": "#e0e7ff"
}
```

2. Run `npm run gen:theme` to regenerate `tokens.generated.css` and `utilities.generated.css`.

3. The new swatch appears automatically in Settings → Appearance and in the command palette.

---

## Extending the token system

The token layer does not yet cover:

- Per-vault indigo → hue remaps (~900 lines in `index.css`)
- Hand-written `.light` neutral utility remaps

Both still work alongside the token layer. The Nodi overlay window is also not yet included in the theming system.

For contributors: when adding new Tailwind utilities, use the `--n-*` and `--a-*` ramps via `@apply` so new components inherit the theme automatically. Avoid hardcoding hex values for colours that should follow the theme.
