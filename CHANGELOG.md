# Changelog

## 2.2.0 — 2026-07-13

### Added

- **Nodi, the Nodus mascot.** A small node-of-light companion floats at the
  bottom right of the window. It can be dragged around, follows the corner when
  the window is resized or maximized, and is toggled from Settings → Interface.
- **Nodi companion menu.** Clicking Nodi opens a radial menu: a streaming chat
  with an AI that is given a compact, Nodus-aware system prompt (active vault,
  models, language) with an optional cross-vault mode; a notification center
  (app-wide store; unread items are flagged with a red badge and Nodi raising an
  arm until read); and a quick help bubble.
- **Per-vault look.** Nodi wears a small accessory that matches the vault mode
  (academic cap, genealogy sprout, study glasses), with a brief animation when
  the vault changes. This can be disabled to show the plain Nodi everywhere.
- **Always-on-top desktop mode.** Optionally, Nodi lives in a transparent,
  click-through desktop window that stays above other applications — including
  apps in macOS fullscreen (via a non-activating panel window).

## 2.1.1 — 2026-07-13

### Changed

- **AI model configuration is now shared across vaults.** API keys were already
  global; the models you select — favorites per provider, every workload/feature
  selector, local-provider base URLs and the image model — now travel with them,
  so configuring a provider once makes it usable in every vault. The shared store
  is seeded only from a vault that actually configured a value, so opening an
  unconfigured vault first can never overwrite a configured one.
- **Removed the "load API keys from another vault" prompt.** Keys and models are
  already shared between vaults, so the importer block in Settings → Providers is
  no longer necessary and has been retired.

### Notes

- No database migration; settings persistence only. The shared model
  configuration lives in `userData/app-prefs.json` alongside theme/language.

## 1.7.2 — 2026-07-11

### Changed

- **AI model dropdowns are now sorted.** Every model selector (feature pickers,
  the research assistant, and the tutor) lists models alphabetically by provider
  and then by model name, so the same option always sits in the same place.
- **Search results reuse each section's own detail view.** Clicking an idea in
  global search opens the same idea detail modal as the Ideas section, and
  clicking a work opens the same modal as the Library; other result kinds jump
  straight to their home view. The generic preview modal has been removed.
- The Argument Map header no longer shows the redundant back-to-graph arrow;
  navigation happens from the sidebar like every other section.

### Notes

- No database migration; the schema stays at v31.

## 1.7.0 — 2026-07-11

### Added

- **Word writing copilot, official beta.** The add-in is now installable from
  the packaged app — no development tooling required. Nodus generates its own
  local CA (10 years, trusted once per machine via the system dialog) and a
  localhost certificate (1 year) that is silently re-issued before expiry, with
  no new trust prompt. Machines that already trusted the old dev certificate
  keep working unchanged.
- The task pane follows the Nodus interface language (Spanish/English), and its
  status chip doubles as a retry button when Nodus is unreachable. The Settings
  section shows the three setup steps and is labeled as beta.

### Changed

- The test suite now runs under Node's built-in test runner: `npm test`
  discovers `scripts/test-*.mjs` and runs the 32 scripts in parallel (seconds
  instead of a serial chain), with unified reporting. Each script remains
  runnable on its own (`node scripts/test-<name>.mjs`); the e2e smoke stays a
  separate `npm run test:e2e`.
- Dependency swap: `office-addin-dev-certs` (CLI, unusable from a packaged app)
  replaced by `mkcert` (pure JS, bundled into the main process).

### Notes

- No database migration; the schema stays at v31.

## 1.6.0 — 2026-07-11

Consolidation release: no new features. Provider configuration that had been
copied across the app now lives in one shared registry, and two real bugs that
drift had already caused are fixed.

### Fixed

- Encrypted exports created with "include secrets" now also carry the optional
  access tokens for local providers (Ollama, LM Studio). They were silently
  skipped on export and left untouched on restore, because the export code kept
  its own — outdated — provider list.
- The MCP model override now accepts every provider the app supports. Xiaomi
  MiMo, Ollama and LM Studio were rejected by an out-of-date provider list in
  the MCP tool schema, so MCP clients could not route writing or deep-research
  jobs through those providers.

### Changed

- Provider identity, display labels, local-server base URLs, the embedding
  provider list and the default embedding model per provider are now defined
  once in a shared registry used by both the main process and the renderer.
  Six independently maintained copies were removed; adding a provider now
  requires touching one file (plus the type union, which enforces the rest at
  compile time).

### Notes

- No database migration; the schema stays at v31. Settings and stored keys are
  untouched.

## 1.5.3 — 2026-07-11

### Added

- Local AI providers: Ollama and LM Studio can now be configured in Settings →
  Providers, alongside the cloud providers. Set the server address (IP and port),
  test the connection, and load the models installed on your machine.
- Loaded models list their metadata inline — parameter size, quantization,
  context length and on-disk size — and LM Studio marks which models are already
  loaded in memory.
- An optional access token per local provider, for instances secured behind one,
  stored encrypted at rest like every other key. Neither provider requires a key
  by default.
- Local models can be starred as favorites and used anywhere a cloud model can be
  used — chat, summaries, deep research, immersion, writing, and more — once
  marked. They also appear as an embeddings provider (e.g. Ollama's
  `nomic-embed-text`); switching embedding model re-embeds the corpus offline.

### Notes

- Ollama runs on `http://localhost:11434` and LM Studio on `http://localhost:1234`
  by default; both addresses are editable, including a LAN IP for a remote host.
- Small local models may produce lower-quality structured output during deep
  scans; Nodus already repairs and retries, so scans degrade gracefully.

## 1.5.2 — 2026-07-11

### Added

- Audio voices (Settings → AI → "Audio y voz"): a search box and filters to find a
  voice quickly. Filter by language for every provider, and — for Hume — also by
  library (Hume's voices vs. your own). Hume language filtering is applied on the
  server via the voices API, and each Hume voice shows its Octave model version.

## 1.5.1 — 2026-07-11

### Changed

- Sidebar: Ideas and Autores now live under "Explorar"; Deep Research moved to
  "Analizar".
- Projects view redesigned to give the writing area more room: the project stats
  and the chapter list moved into the left sidebar (with a project search box),
  the new-project form is now a modal opened from a button, and the chapter text
  no longer splits editor/preview side by side — a single full-width view with an
  icon toggle switches between reading and editing.

### Added

- First run: the setup wizard opens in English and its first step is choosing the
  interface language (English or Spanish).
- Interface theme: a new "System" option follows the operating system's light/dark
  preference and updates live when it changes.

## 1.5.0 — 2026-07-11

### Added

- Audio narration: generate spoken audio of a Deep Research report or an
  immersion. Audio is produced section by section (or stage by stage), so you can
  start listening while the rest is still being generated. Citation buttons are
  never read aloud — only the prose.
- Three voice providers, selectable in Settings → AI → "Audio y voz":
  - **Piper** — native-sounding, offline, per-language voices including Spanish
    (Spain / Mexico); each voice downloads separately.
  - **Kokoro** — one shared, offline English model (downloaded once) with many
    high-quality US/UK voices.
  - **Hume** (Octave) — cloud studio voices using your own API key (billed to
    your account); voices are loaded from your Hume library.
- Voice manager: download/remove local voices and models, add a cloud key, load
  and pick the active voice, and set a playback speed. Local voices run fully
  offline and are cached for reuse.
- A global audio player docked at the bottom of the window: scrub through the
  clip, adjust playback speed (0.25×–2×), play/pause, skip between sections, and
  stop to close it. Playback continues while you navigate the app.
- Each report/immersion has an audio panel to generate, play (one clip or the
  whole thing in sequence), regenerate and delete its narration. Generated audio
  is stored per vault and excluded from backups and sync (regenerable on demand).

## 1.4.7 — 2026-07-10

### Added

- The image "Design" panel is now reachable inside the immersion player (on the
  panorama), not only on the setup screen and the Deep Research reader.
- Upload your own decorative image from the Design panel, in both the immersion
  and Deep Research views. Uploads are compressed automatically to keep local
  storage light.
- After regenerating an image you can go back to the previous one with a single
  click.

## 1.4.6 — 2026-07-10

### Fixed

- Search bars: the magnifying-glass icon no longer overlaps the placeholder text
  in the Settings and Deep Research search fields.

## 1.4.5 — 2026-07-10

### Added

- Find in page (Cmd/Ctrl+F) in the Deep Research reader and the immersion player:
  type to highlight every match and step through them with Enter / Shift+Enter.
- The immersion decorative image now also opens the panorama as a header.

### Changed

- Deep Research report text is now justified.
- In the Deep Research reader, the copy / save / export actions moved into the
  header next to the support-matrix toggle, for a cleaner reading column.

## 1.4.4 — 2026-07-10

### Added

- Deep Research is now a gallery of your saved reports: search across them, sort
  by date or title, and switch between a grid (mosaic) and a list view.
- A generation queue — line up several reports and Nodus generates them one after
  another in the background while you keep working.
- An immersive full-screen reader for each report, with a back button to the
  gallery and its decorative image, citations and export in one place.

### Changed

- Deeper immersions: routes now scale with the chosen depth (~6 stations for a
  quick pass, ~12 for an afternoon, ~20 for a deep dive), and the planner may use
  a coherent few more or fewer as the topic warrants.
- The immersion curriculum planner was reworked to build a progressive,
  well-sequenced route that can devote several consecutive stations to deepening a
  single rich thread instead of cramming it into one stop.
- Immersion time estimates now reflect the actual length of the planned route.

## 1.4.3 — 2026-07-10

### Added

- New "Image design" dialog for Inmersión and Deep Research: preview the image,
  switch style, edit the scene description, and regenerate or delete it in one place.
- Five photographic and realistic decorative styles — realistic photograph,
  vintage photograph, black & white, cinematic, and oil painting (twelve in total).
- An editable scene description that rebuilds the prompt for the chosen style while
  preserving the "no text" safeguards.

### Changed

- Decorative images now render larger and more polished. The inline action buttons
  are replaced by a single unobtrusive "Design" pill that opens the design dialog,
  keeping the Inmersión and Deep Research views uncluttered.
- The "immersion ready" screen is now part of the main immersion view instead of a
  separate standalone page.

## 1.4.2 — 2026-07-10

### Added

- Optional single decorative images for Inmersión and Deep Research, generated
  only after the main content has been saved.
- Seven centralized styles, optimized reusable images and lazy list thumbnails.
- Independent image-provider/model settings for Google, the official OpenAI
  Images API, and live image-output OpenRouter models.
- Published input/output/per-generation pricing, unavailable-price states,
  real-time search, and provider-safe sorting.
- Persistent image audit/status metadata with manual retry, delete, and confirmed
  regeneration controls.
- A common full-detail modal for every textual and semantic search result type.

### Changed

- Search results no longer navigate to the graph automatically; graph/location
  actions are secondary modal actions.
- The search disclosure chevron rotates without simultaneous vertical movement.
- Full encrypted backups now include decorative image records and BLOBs.

### Reliability

- Image errors, timeouts, missing credit, or provider failures never roll back or
  block an Inmersión or Deep Research report.
- No automatic image retries or duplicate generation of an existing ready image.
- Stale and deleted in-flight attempts cannot overwrite the current image state.
- Existing saved content without images remains fully compatible.

### Known limitations

- Google-generated images include mandatory SynthID provenance.
- OpenAI GPT Image access can require organization verification.
- OpenRouter pricing units vary by endpoint, so price ordering is scoped within
  provider groups and unavailable values are not estimated.
- Decorative image BLOBs are included in full backups but not the lightweight
  cross-vault sync package.
