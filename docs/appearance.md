# Appearance and themes

Nodus has two independent appearance choices:

- **Colour mode** — **Light**, **Dark**, or **System**. System follows the
  operating system's light/dark preference.
- **Colour theme** — the palette family used by the interface. A theme has a
  light and a dark variant, so changing the palette never changes the selected
  mode.

The theme system is runtime-based. Nodus derives CSS tokens when a palette is
selected and applies them immediately; it does not generate a stylesheet or
require a rebuild. The same theme definition can therefore be used by the
Desktop renderer and Server Web.

## Choosing a theme

Open **Settings → Appearance**. The **Colour theme** row shows the available
themes as swatches. Selecting a swatch applies it immediately and persists the
choice across restarts. The same selection is available from the command
palette (`Ctrl+K` / `Cmd+K`).

The colour mode is controlled separately in **Settings → Appearance**. Changing
mode keeps the selected palette and switches its mode-specific ramps, text,
borders, and app background together.

When a portable profile is shared with Nodus Server, its custom theme
definitions and selected theme are available there as well. Themes are local
profile settings; selecting one does not send vault content anywhere.

## Theme definition

Every built-in or custom theme contains these values:

| Value | Purpose |
| --- | --- |
| **Accent** | Primary brand colour for buttons, links, active states, focus rings, and selected controls. |
| **Deep surface** | Darkest palette anchor used to derive dark neutral surfaces. |
| **Pale surface** | Lightest palette anchor used to derive light neutral surfaces. |
| **Light-mode text** | Explicit foreground colour used while the interface is in light mode. |
| **Dark-mode text** | Explicit foreground colour used while the interface is in dark mode. |
| **Light app background** | Persistent light-mode canvas for the application chrome, title bar, sidebar, and other areas outside a workspace surface. |
| **Dark app background** | Persistent dark-mode canvas for the same application chrome and outer canvas. |
| **Tint** | Amount of the accent mixed into the derived neutral ramp, from `0` to `1`. |

The app background is intentionally separate from the pale/deep workspace
surfaces. This lets each theme have a recognisable outer canvas while keeping
cards, panels, toolbars, and workspace content legible. Text is also explicit
per mode: dark-mode text is never inferred from a light-mode colour, and vice
versa.

## Creating and editing a custom theme

Open **Settings → Appearance → Create theme**. Enter a name and a full
six-digit hexadecimal value for each colour, for example `#6366f1`:

1. Accent
2. Deep surface
3. Pale surface
4. Light-mode text
5. Dark-mode text
6. Light app background
7. Dark app background
8. Tint amount

The editor previews the theme before saving. Nodus derives the neutral and
accent ramps, validates the light and dark foreground/surface combinations,
and rejects incomplete or invalid values. Saved themes can be edited or
removed from the same Appearance section. Custom themes work in the Desktop
app and Server Web without generating code or rebuilding the application.

The colour controls show the selected value directly. Clicking the small
circular swatch with a border opens a Nodus popover containing the system colour
picker and an exact six-digit hexadecimal field. This makes it possible to paste
an exact colour even when the operating system picker exposes RGB controls
instead. Very light colours remain identifiable against the editor surface
because the swatch has its own border.

## Runtime token model

For a non-default theme, the renderer derives and installs these token groups
on the document root:

- `--n-50` through `--n-950`: the theme's neutral surface ramp
- `--a-50` through `--a-950`: the active mode's accent ramp
- `--a-light-*` and `--a-dark-*`: both accent ramps, retained so mode changes
  can switch aliases without recalculating the theme
- `--theme-text-light` and `--theme-text-dark`: the explicit mode foregrounds
- `--app-background-light` and `--app-background-dark`: the outer app canvas

Static CSS maps the existing Tailwind-style neutral and indigo utilities to
these variables when `html.theme-active` is present. The default theme does not
activate that marker and keeps the original Tailwind palette, preserving the
pre-theme appearance.

The last selected theme and sanitized custom definitions are cached locally so
the correct palette can be painted before asynchronous profile settings load.
If a stored custom definition is invalid or missing, Nodus safely uses the
default palette instead of applying partial tokens.

## Contrast and semantic components

Custom theme validation checks the important mode-specific combinations before
allowing a theme to be saved. The runtime and automated tests enforce these
minimums:

- Body text on its primary background: **4.5:1**
- Muted text on a card: **3:1**
- White text on accent controls: **4.5:1** at the darker button ramp and
  **3.8:1** at the lower solid accent ramp

Derived semantic foreground tokens are used for muted text, subtle text,
borders, icons, controls, and overlays. Component-specific selectors handle
surfaces that cannot be safely corrected by utility remapping alone. For
example, theme labels in **Ideas** and tag pills in **Authors** use an
accent-tinted surface, a mode-aware foreground, and a visible semantic border;
they do not rely on a hard-coded muted neutral colour that could disappear in
a custom palette.

Dark-mode accent utilities are role-shifted where necessary: accent text and
icons use lighter accent shades, while solid fills, borders, and focus rings
retain their role-appropriate shades. Native select option lists are also
styled per mode and theme.

## Contributor guidance

The theme implementation is split into a shared definition layer and static
renderer styles:

- `shared/types.ts` defines `CustomAppTheme` and its persisted shape.
- `shared/appThemes.ts` sanitizes custom definitions at profile boundaries.
- `src/theme/themes.mjs` owns built-in anchors and runtime ramp derivation.
- `src/theme/themeBoot.ts` applies the selected definition before first paint.
- `src/theme/tokens.css` declares the token defaults and mode aliases.
- `src/theme/runtime-utilities.css` maps generated utility classes to tokens.
- `src/theme/theme-components.css` contains semantic component exceptions.

When adding UI that should follow a theme:

1. Prefer existing semantic tokens or established themed components.
2. Use neutral/accent utility classes so the runtime utility mapping can retint
   them.
3. Add a narrowly scoped component selector in `theme-components.css` when a
   utility cannot express the required contrast or surface relationship.
4. Avoid hard-coded colour values for text, icons, borders, controls, and
   surfaces that should respond to the selected theme.
5. Add or update focused runtime-theme tests for new token behavior.
6. Add every new static UI string to all `src/i18n.*.ts` translation tables,
   following the repository's Spanish-source convention.

Keep the default-theme path unchanged where possible. Theme-specific overrides
should be scoped to `html.theme-active` so the existing default palette remains
the baseline and high-contrast mode is not weakened.

## Current boundaries

The token layer covers the main Desktop and Server Web application surfaces,
shared controls, overlays, workspace canvases, and the semantic exceptions
called out above. Some deliberately separate surfaces—such as embedded browser
pages and the Nodi overlay—may use their own native or isolated theme path.
When extending one of those surfaces, document the boundary and preserve its
contrast independently rather than relying on renderer CSS to cross the
boundary.
