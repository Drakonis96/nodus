# UI polish — feedback & suggestions (7 areas, PRs incoming)

Thank you for the work you have done building the app. I see a lot of potential. What I noticed from the start was a need for UI polish, consistent design refinements, and a few minor tweaks. I have cloned the repository and started experimenting with improvements using agents. I'd like to share feedback and suggestions across seven areas:

1. Theming — selectable colour themes + light-mode contrast fixes + accent consistency
2. Settings state management — remember the selected settings tab
3. Queue dropdown — move bottom progress strips into the top bar
4. Home page polish — dashboard card redesign and spacing
5. Modal readability — opaque panel for the library ideas dialog
6. Card hierarchy — avoid more than two nested card levels
7. Auto-update restart — stop auto-restarting after download

For each one I'll open a separate PR as draft, treat them as starting points for discussion rather than finished proposals. Feedback on any of them is welcome before (or instead of) merging. An additional fix for the auto-update restart behaviour is also tracked here.

Each section below describes the problem as I experienced it, the suggestion, and roughly what a patch would touch. Below these I provide some comments and suggestions on the repository as a whole.

## 1. Theming

**Observation.** The app only offers light/dark. I did not like how dark mode looked initially — the colour combination made it hard to read some elements — and there is no way to pick a different palette.

**Suggestion.** A small set of curated colour themes (I prototyped ten, anchored on popular ColorHunt palettes) as a **design-token layer on top of** light/dark — not a replacement. Light and dark stay the modes; a theme just retints the ramp. `default` carries no rules at all, so the whole feature is inert until a theme is picked.

**How it works.**

- **Token layer + generator.** Each theme is 3 anchor colours (accent + a deep and a pale surface) expanded to `--n-50…950` (neutral) and `--a-50…950` (accent) ramps. A build script (`scripts/gen-theme-utilities.mjs`) scans the source for every `neutral-*` / `indigo-*` Tailwind utility the app uses and emits `html.theme-<id>.<mode> .<util>` rules that point them at the tokens, scoped tightly enough to win the cascade and *only* for non-default themes. The two generated stylesheets are committed; a freshness test fails CI if they drift.
- **Wired into the build, not a step you run yourself.** A Vite plugin calls the generator on `buildStart` for both `npm run dev` and `npm run build`, and watches `themes.mjs` during dev so editing a palette regenerates and hot-reloads the CSS without a restart. `npm run gen:theme` is kept as a standalone escape hatch, but nothing about the day-to-day loop depends on remembering to run it.
- **`@apply` does most of the component work.** `body`, `.card`, `.input`, `.btn-*` bake their colours in via `@apply` in index.css — Tailwind grafts the generated `html.theme-<id> .<util>` rules onto those host selectors automatically, in both modes, so the hand-written override sheet stays nearly empty.
- **Light mode retints surfaces, not just the accent.** The generator reads index.css's own `.light .<util>` rules, takes each target colour's luminance, and maps it to the nearest shade of the theme's ramp — so a light theme retints exactly the surfaces/borders/text `.light` already restyles (deep panel → pale tinted panel, neutral border → soft tinted border) and leaves the rest on the default light system. Accent utilities are role-shifted the way `.light` does it (dark accent text, pale accent borders).
- **Dark mode role-shifts the accent too.** `--a-500…700` are darkened to clear white-on-colour, so mapping accent utilities straight would hide `text-indigo-500` icons and flash `bg-indigo-100` chips near-white. Accent text/icons map to `--a-300`/`--a-400` (light, always readable on dark); pale accent fills become a faint tint; solid fills, tinted backgrounds, borders and rings keep the straight shade.
- **`dark:` variants beat their bare counterpart.** Generated rules are ordered so `html.theme-x.dark .dark\:hover\:bg-neutral-900/55` wins the specificity tie against `html.theme-x.dark .hover\:bg-neutral-50` — otherwise the light-mode fallback flashed white on table-row hover and `text-neutral-900 dark:text-neutral-200` titles rendered with the deep bare shade and vanished (Ideas table, Argument Map).
- **Native `<select>` option lists** are themed too (index.css hard-codes `select.input option` to `#171717`/`#fff`, which `@apply` can't reach). Custom dropdown menus already follow through their `.card` / `dark:bg-neutral-*` utilities.
- **WCAG floors on the accent ramp:** ≥ 3.5:1 white-on-`--a-500`, ≥ 4.6:1 on `--a-600`, rising through `--a-950`, plus accent-text-on-white in light mode — raw palette hues are usually too light for button backgrounds. A contrast test covers every theme × mode combination so new palettes can't silently regress.
- **Wiring:** `settings.appTheme` (a global pref, no DB migration), applied pre-paint via a small module (CSP blocks an inline bootstrap script) so there's no flash on launch; a swatch picker in Settings next to the renamed "Colour mode" selector; a command-palette action; and the same field on the Nodus Server portable profile so Desktop ↔ Server stay in sync.

**Accent consistency** — **fixed as part of §1.** The "This vault / Global" switcher and the "?" help button in the library header now use `--a-*` theme tokens instead of hardcoded per-vault hexes, so they re-accent with any selected theme.

> 📷 **[SCREENSHOT: gallery grid — each theme in dark mode](pr-text/images/Theming%201.png)**
> 📷 **[SCREENSHOT: same gallery, light mode](pr-text/images/Theming%202.png)**
> 📷 **[SCREENSHOT: before/after of a light-mode screen — accent-only tint vs full surface retint](pr-text/images/Theming%203.png)**
> 📷 **[SCREENSHOT: close-up of an unreadable accent button in light mode, before vs after](pr-text/images/Theming%204.png)**

**PR:** `_unvetted_` — theming: selectable colour themes + light/dark contrast fixes.

## 2. Settings state management

**Observation.** The Settings view always opens on the first tab. After adjusting something on a another tab (models, privacy, sync) and switching away to a different part of the app makes it so that on reopen the Settings view drops back to the first tab.

**Suggestion.** Remember the last active tab and restore it on reopen — a small state-management change, but it removes an anyance I quickly got when uting the app.

> 🎥 **[VIDEO: Settings tab state persistence](pr-text/images/Settings%20State%20Management.mp4)**

**PR:** `_unvetted_` — settings: remember selected tab.

## 3. Queue dropdown

**Observation.** Queue and task progress currently render as a strip docked to the bottom of the window (scan queue plus Zotero import, document indexing, embeddings and passage-embedding progress). It takes permanent vertical space, sits far from where the eye already looks for status, and overlaps content at small window sizes.

**Suggestion.** Move the strip into a top-bar dropdown, mirroring the notification centre:

- One dropdown embeds the existing progress components unchanged (controls like pause/resume, retry, cancel, dismiss and per-item expansion stay intact).
- The trigger is a header icon with a badge counting pipelines that currently have live work, so progress is visible without opening anything.
- Keep parity with the notifications panel: anchored placement, Escape/outside-click to dismiss, correct layering over the native browser view, an empty state when nothing is running.
- The guided tour should keep targeting the queue (the `data-tour` anchor moves to the trigger button).
- All new strings need translations in every UI language.

> 📷 **[SCREENSHOT: Queue dropdown before/after](pr-text/images/Queue.png)**

A further improvement could be to add notifications for completed tasks, so users are informed when a pipeline finishes without having to keep the dropdown open. We could also have 2 lane notification system, real notifcitation as there is now and these kind of ping notificaitons.

**PR:** `_unvetted_` — ui: queue/progress dropdown in the top bar.

## 4. Home page polish

**Observation.** The home dashboard's cards each have slightly different padding, hierarchy and chrome, so the page reads as separate widgets rather than one grid; spacing also drifts at in-between window widths. Also the cards where in rows of 3 by default and this meant that on regular monitor widths there was often excessive empty space next to the cards. I made the default 4 cards wide.

**Suggestion.**

- Redesign the dashboard cards for a consistent internal structure: clearer heading hierarchy, uniform padding and shared card chrome.
- Refine the spacing rhythm (gaps, section margins, card min-heights) against a single scale so the grid holds together at every width.

> 📷 **[SCREENSHOT: Home page before/after, full view](pr-text/images/Home%20Panel.png)**

**PR:** `_unvetted_` — ui: home dashboard card redesign + spacing.

## 5. Modal readability

**Observation.** In the library, clicking an item to see its ideas/themes (the "Ideas · {title}" dialog) opens a translucent dialog: the dimmed page bleeds through the panel, which reads like a rendering bug. This glass effect makes it hard to focus on the modal content and seemed unnecessary to me.

**Suggestion.** Dialog panels floated over a scrim should use the opaque modal surface (`.card-modal`) instead of the translucent `.card` — the codebase already defines it for exactly this case and other dialogs follow it.

> 📷 **[SCREENSHOT: the ideas/themes modal with the library bleeding through the panel, vs the opaque panel](pr-text/images/Library%20Modal.png)**

**PR:** `_unvetted_` — ui: opaque modal panel for the library ideas dialog.

## 6. Card hierarchy

**Observation.** The Ideas detail page could render a connections panel, a connection card, and expanded source/occurrence cards inside that connection card. The resulting three visual card levels made the content feel boxed-in and obscured the relationship between the idea, its connection, and its evidence.

**Change.** Connection entries are now lightweight bordered list items rather than cards. Their expanded details remain inline, so the containing connections panel and any occurrence cards are the maximum two visual card levels.

**Audit.** The other shared idea-detail surfaces (`NodeDetailPanel`, `IdeaDetailModal`, and `WorkIdeasModal`) already stop at two levels. The Home dashboard's status cards and dashboard tiles also stop at two levels; no additional three-level card stacks were found in the audited UI.

**Follow-up.** The audit missed one: `OccurrenceCard`'s AI summary block ("Resumen (orientación)") was a full rounded/bordered/background box nested inside the occurrence card — a card-in-a-card in effect, even without the `.card` class. Flattened to a left-border accent, matching the evidence-quote treatment already used in the same component. Fixed once in `NodeDetailPanel.tsx`, since `OccurrenceCard` is shared across `IdeasView`, `WorkIdeasModal`, `NodeDetailPanel`, and `IdeaDetailModal`.

**PR:** `_unvetted_` — ui: flatten nested Ideas connection cards.

---

## 7. Auto-update restart behaviour

**Observation.** When a new version was released the app would automatically restart to install it ~1.2 seconds after downloading — without asking the user or giving them control over timing.

**Change.** Removed the `setTimeout(() => void installDownloadedUpdate(), 1200)` call that forced immediate restart on download. The app now follows industry-standard pattern: update is downloaded silently in the background, user receives a notification with the option to click "Instalar ahora" to restart on their own schedule, or the update installs on the next scheduled app quit.

**Files touched:** `electron/main.ts` (removed auto-restart trigger; updated user-facing messages).

**PR:** `_unvetted_` — updates: remove auto-restart on download, require user-initiated install.

---

## Repo maintenance concerns

The following issues were noticed during the work and are worth discussing as a separate cleanup effort:

**Testing strategy.** The test strategy is not clearly documented or standardized. I see that Node.js test runners are used, and playwright is employed for end-to-end testing, but there is no central guide explaining how to run tests, what each test covers, or how to add new tests. This makes it harder for new contributors to understand and maintain the test suite. Especially since the tests are located all in the `scripts/` directory, where also custom verification scripts seem to be present. I am wondering why you choose for node:test instead of a more conventional setup like Vitest or Jest.

**The scripts directory is large and undifferentiated.** `scripts/` has 400+ files across 8 subdirectories (`ai-audit/`, `notion-parity/`, `fixtures/`, `lib/`, `tutorial/`, `assets/`, `.cache/`). For many scripts, their purpose is not obvious from the name alone. Some are one-liners, some are aliases, some invoke build pipelines. A pass to document the most important ones (or group them under a `dev:` namespace) would help contributors. There is no clear convention for naming: `audit-deep-research-quality.mjs` and `audit-deep-research-retrieval.mjs` are hard to distinguish at a glance, and the three test categories (`smoke:*`, `test:*`, `verify:*`) have no documented distinction. Smoke tests appear to be quick checks (author roles, live citations), verify scripts run live against real endpoints, and test scripts are unit/integration — but this convention is only inferrable from the files themselves. A README or naming guide at the top of `scripts/` would help enormously. The `scripts/tutorial/` subdirectory also functions as an agent skill (it contains `probes/`, `cards-examples/`, `decks/`, `engine/`, `music/` alongside `PITFALLS.md` and `README.md`) and it is unclear whether its structure and content are current.

**Dev docs are missing or incomplete.** Several `docs/` files are either absent or contain placeholder text. The architecture docs that exist are good, but there are gaps around how to set up a dev environment, how to run the full test suite, and how the Electron + web app relate to each other.

**Old planning files in the repo.** `design/` contains files that appear to be working notes or spike artifacts. Specific candidates for review:
  - `design/pdf-presenter-plan.md`
  - `design/prosopography-domain-adr.md`
  - `design/sync-hardening-phase2.md`
  - `design/worldbuilding-analyze-plan.md`
  - `design/worldbuilding-characters-plan.md`
  - `design/worldbuilding-collections-plan.md`
  - `design/worldbuilding-families-plan.md`
  - `design/worldbuilding-manuscript-plan.md`
  - `design/worldbuilding-maps-plan.md`
  These should either be moved elsewhere, converted into proper ADRs, or removed if they are no longer relevant.

**Files with unclear purpose.** Root-level spike files that are experimental one-offs and have no clear status:
  - `spike-capture.mjs` — one-off speaker diarization script using HuggingFace pyannote model; writes output to `scripts/fixtures/testimony-diarization-spans.json`.
  - `spike-diarize.mjs` — similar one-off with a hardcoded path to a different repo worktree (`/Users/jorgepb96/Documents/GitHub/nodus/.claude/worktrees/navigation-evaluation-fa0128`).
  These should either be removed or moved into `scripts/` with a clear README if they represent a workflow worth preserving.

**The repo has become a monorepo without the setup.** It now contains `electron/`, `server/`, `browser-extension/`, `zotero-plugin/`, `word-addin/`, `cloudflare/`, `site/`, and `scripts/` — all quite different in nature, with different tooling, different release cadences, and different dependency needs. They share a root `package.json` but there is no workspace configuration. Consider whether a proper monorepo setup (npm workspaces, Turborepo, or similar) would help keep concerns properly separated.

**`IMAGE_GENERATION.md` is outside `docs/`**. It lives at the repo root alongside `README.md`, `CONTRIBUTING.md`, etc. rather than in `docs/`. Either it belongs in `docs/` alongside similar feature documentation, or it belongs somewhere else if it is not user-facing.

**Fallow**: I would suggest using Fallow (https://github.com/fallow-rs/fallow), which is a cli tool for codebase intelligence for TypeScript and JavaScript. It can help analyze dependencies, track usage patterns, and provide insights into the structure and health of the codebase, which could be useful for maintaining a large monorepo like this one. It allows finding unused code, detecting dependency issues, complexity hotspots, boundary violations, and design-system styling drift.
