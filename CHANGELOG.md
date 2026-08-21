# Changelog

## 4.2.2 — 2026-08-21

- Added in-page search to Nodus Browser with Cmd/Ctrl+F, a toolbar search button, match navigation and case-sensitive search.
- Fixed Browser tab recovery so closing the last tab restores exactly one home tab, and fixed vault-switcher and Browser-to-Settings overlay flashes.
- Fixed the Deep Research and Immersion source modal: scrolling works, its size stays stable across tabs, and light mode has its own palette.
- Improved Google compatibility in Nodus Browser by matching Chromium client hints to the real engine version. Third-party Google authentication now completes in the same Nodus Browser session, while Nodus OAuth can return through the `nodus://` protocol.
- Added the fixes and Browser strings to the What's New modal in all eight interface languages.

## 4.2.1 — 2026-08-20

- Fixed Deep Research typography controls freezing the interface, detaching persistent
  highlights and comments, and preventing the selection ribbon from opening.
- Font-size changes now preserve the visible reading position and reuse the 4.2.0 What's
  New presentation.

## 4.2.0 — 2026-08-20

Nodus 4.2 introduces an integrated research browser and a global research radar, brings
databases much closer to Notion-scale workflows, and expands how research reports are
planned, read, annotated and connected back to the Library.

- Nodus Browser provides secure multi-tab browsing, downloads, media controls, local
  bookmarks and history, Research Atlas, Nodi page actions and direct Connector capture
  into the Library.
- Nodus Radar follows topics, searches, authors, journals, papers, RSS feeds and websites,
  checks them on a schedule and gathers updates in a global inbox with notifications and
  Library actions.
- Databases add universal pages and blocks, advanced properties, formulas, rollups,
  relations, templates, tasks, automations, forms, comments, history, permissions and
  virtualized large-data views, together with more faithful Notion imports.
- Deep Research adds seven research approaches that adapt retrieval, planning and writing,
  and records the chosen approach and model with each report.
- Deep Research and Immersion share persistent highlights, comments and bookmarks, while
  the source workspace opens ideas, authors and works in state-preserving tabs with Zotero
  and Nodus Library actions.
- Authors, ideas and argument maps can remain open in independent tabs for comparison, and
  nullable metadata no longer breaks affected searches.
- Global Library record actions move to the detail header, metadata editing is clearer and
  revealing attachments in Finder is reliable from both entry points.
- Nodi's original 100% size is now the maximum, with seven presets down to 40%, and streamed
  answers no longer force the chat viewport to the bottom.
- Large encrypted backups restore with bounded memory and real progress through decryption,
  verification, extraction and finalization while preserving safety snapshots and rollback.
- The What's New modal presents this release in all eight interface languages, with dedicated
  Browser and Radar icons.

## 4.1.6 — 2026-08-18

Nodus 4.1.6 repairs the Zotero import of the Global Library, which catalogued documents
without ever copying an attachment and then refused to run a second time, and keeps the
two reading galleries from forgetting how they were set or flashing on the way back in.

- The Zotero import bundles turndown and its HTML parser as external CommonJS, so loading
  it in the main process no longer throws before the attachment loop and both notes and
  attachments are copied again. A failed import reports the first failure's own message
  instead of always claiming that Zotero is unavailable.
- A 404 from Zotero's `/deleted` endpoint, which the local API does not implement, is read
  as "no tombstones reported" rather than as a missing library, so the second and later
  syncs no longer abort before reading an item. Deletions made in Zotero are not mirrored
  incrementally until a full refresh, which the release notes state.
- The resumable-session banner follows the newest session by `updatedAt` alone, so an old
  failure no longer presents a later clean import as interrupted.
- Ordering, the read filter and grid-versus-list are written to a small per-vault store on
  disk and seed the snapshot Deep Research, the study and teaching unit galleries and
  Inmersión mount with. The search box, the open report and the place in a list stay in
  memory. Deleting a vault takes its stored preferences with it.
- Deep Research and Inmersión hold a quiet pane while the report or session they are
  returning to is read back, showing a spinner only after 250ms, so neither section paints
  its gallery on the way in. A session that no longer exists lands on the gallery.
- The study and teaching organization heading goes through `t()` for its three interface
  fallbacks, which were bare Spanish literals rendered raw, with a regression test.
- The What's New modal presents this release in all eight interface languages.

## 4.1.5 — 2026-08-17

Nodus 4.1.5 puts the floating selection ribbon where the hand that made the selection
left it, and removes the last two places where a search stopped the whole window while
it thought.

- The reader's selection ribbon and the workspace, study and teaching note toolbars wait
  for the pointer to be released and are placed above it, or above the caret when the
  selection was made with the keyboard.
- Clicking a stored highlight reopens the full ribbon with colours, comment, copy,
  bookmark and Nodi quote, with its current colour marked and deletion at the end, so a
  highlight can be recoloured instead of only deleted.
- The research chat and Nodi's active-vault context use the paged vector scans, so asking
  a question no longer blocks the main process, and a new Nodi chat starts with the
  current vault selected.
- `nodus_search_ideas` and `nodus_search_passages` use the paged vector scans too, so an
  MCP client searching from another application no longer freezes the Nodus window behind
  it. `test-mcp.mjs` now refuses the blocking call sites outright.
- The What's New modal presents this release in all eight interface languages.

## 4.1.4 — 2026-08-16

Nodus 4.1.4 keeps the desktop responsive during automatic backups and connected-vault
publication, fixes the first administrator setup in production Cloudflare deployments,
and introduces the project’s new public home at nodusresearch.com.

- Automatic backups and connected-vault publication now run outside the main process with
  bounded memory, hard process deadlines, retry backoff and unchanged-data shortcuts.
- Nodus Cloud can initialise its first administrator on Cloudflare Workers and surfaces the
  server’s real error when deployment setup fails.
- The notification centre reports the outcome of a manual refresh and preserves its last
  valid snapshot when the remote feed is unavailable.
- The redesigned website brings together the wiki, manuals, interactive demos, FAQ, blog
  and contribution paths at nodusresearch.com.
- The What’s New modal presents this release in all eight interface languages.

## 4.1.3 — 2026-08-15

Nodus 4.1.3 extends the section snapshots of 4.1.2 to the three places a reader stays inside the
longest, and remembers how far into a report the reading had got.

### Added

- Deep Research, Immersion and the Library's tab strip restore the item that was open, not only the
  state of their list. A report is found again in the gallery the section already reads, an
  immersion is fetched by id and lands on the step its own progress records, and a Library tab
  reopens with the reference it was opened with.
- A Deep Research report reopens at the block that was under the top edge, counted over the
  paragraphs, headings, quotes and tables of the rendering on screen, so window width, font size and
  a cover image that had not loaded yet no longer move the place. The place is reapplied while the
  report is still growing and yields as soon as the reader scrolls or types. A place counted in one
  rendering is dropped rather than approximated when an applied translation changes the block count.

### Changed

- The composer, the scope screen and an applied translation are deliberately not restored: they are
  work in progress rather than a place in a document.

## 4.1.2 — 2026-08-15

Nodus 4.1.2 orders the author dossier by works before ideas, fixes its modals and connections list,
lets every section remember where you left it, and finishes translating the Cloudflare deployment
flow into all eight interface languages.

### Added

- Every section that renders through the shared list registry (Ideas, Authors, the Global Library,
  the Argument Map, the Library, and the Workspace) restores its filters, sort order, active tab and
  scroll anchor when you return to it, scoped to the active vault.

### Changed

- The author dossier lists an author's works before their ideas.
- The connected authors list on an author dossier shows the five strongest relations and opens the
  full list in a separate modal.

### Fixed

- Modals opened from an author dossier render into `document.body` so a parent `space-y-*` stack can
  no longer give their backdrop a stray top margin.
- The connected authors list and the reader's text-selection ribbon now use the correct surface and
  hover colours in light mode.
- The Cloudflare deployment wizard is now fully translated in all eight interface languages instead
  of English only.

## 4.1.1 — 2026-08-14

Nodus 4.1.1 adds a Cloudflare deployment owned entirely by the person who runs it, publishes the
complete Nodus Wiki and vault manuals, and corrects Global Library file handling, Coverage question
loading, the Contradictions graph and several editor and modal details.

### Added

- Direct user-owned Cloudflare deployment through the official Deploy to Cloudflare wizard, which
  creates D1 and R2 in the owner's own account and publishes a free workers.dev address. Nodus
  receives no Cloudflare credentials or permissions.
- Global Library settings for attachment naming, with three author, year and title formats, per
  file-type selection, name synchronisation and an automatic reading-preparation switch.
- The complete Nodus Wiki and per-vault manuals on the website, with mobile navigation and
  downloadable PDF manuals.

### Changed

- The Contradictions graph preset is routed through the bounded semantic atlas and preserves both
  sides of every retained debate.
- Coverage questions are processed through a serial queue, so several can be launched in a row.

### Fixed

- Saved Coverage questions are reloaded for the active vault, and destructive deletion of a question
  or a Library note is confirmed first.
- Internal protected-span markers no longer leak into text-improvement previews or document content,
  and the synonyms action no longer keeps a persistent outline.
- Nodi renders immediately in update-related modals, and idea type markers stay circular inside flex
  layouts.
- Nodus Server image publication installs workflow dependencies before the server tests and reruns
  when dependency manifests change.

## 4.1.0 — 2026-08-13

Nodus 4.1 aligns its research views, workspaces, server and mobile reader around the same
library-oriented workflow. It also tightens responsive navigation, notification handling,
Word and Chrome integrations, and the visual consistency of Toolkit and the website.

### Added

- Library-style Authors, Ideas and Argument Map views, plus the unified Coverage, Debates and
  Gaps workspace under State of the Question.
- Tags, tag filters, multi-selection, context actions and Trash for workspace notes and ideas.
- Published Library packages with hierarchical collections, metadata, clean Markdown, figures
  and offline document management in Nodus Mobile.
- Multi-vault account permissions, editable access, protected email changes, renameable spaces,
  copyable identifiers and URLs, and canonical vault colours in Nodus Server.
- Chrome Web Store installation as the recommended connector path while retaining the manual ZIP.

### Changed

- Desktop and mobile editors share professional selection tools and searchable model picking.
- Compact sidebars keep the Nodus mark centred, use the vault accent for scrolling, and remain
  usable at narrow window widths.
- Notifications from one document or report are grouped, and update checks can be requested from
  the header or Nodi.
- Update and what’s-new modals retain their presentation with less rendering and memory work.
- Toolkit applications and website demos share their respective product headers and visual system.

### Fixed

- Dark-mode, passage encoding and live citation-style selection in the Word copilot.
- Search-field icon overlap, hidden narrow-window controls, clipped notification badges and theme
  colours that leaked between light and dark surfaces.
- Chrome connector regressions are prevented while Spanish localization and store installation
  are added on top of automatic pairing and scholarly full-text resolution.

## 4.0.1 — 2026-08-12

The Chrome connector now completes its local pairing automatically after it is enabled in Nodus.
It also follows extensionless scholarly full-text links through publisher landing pages, verifies
the real PDF bytes, and prepares clean Markdown from that paper instead of an HTML snapshot.

### Fixed

- **Chrome pairing asked twice for the same consent.** Enabling the connector in Nodus is now the
  authorization step. Opening the extension obtains or renews its loopback token without a native
  dialog, while the extension-origin and bearer-token protections remain in place.
- **Dialnet and similar catalogue links saved the landing page instead of the paper.** Full-text
  labels are detected even when their URL has no extension. Nodus follows guarded public redirects,
  reads publisher PDF declarations such as `citation_pdf_url`, and accepts the result only after
  checking the PDF signature.
- **HTML could be prepared as if it were a PDF.** Both desktop downloads and browser-assisted
  uploads reject HTML or other bytes labelled as PDF before they can become the primary attachment.

## 3.2.6 — 2026-08-09

Nodi becomes a real report reader, authors gain a persistent shelf, and MCP
clients can finally read the same vault content that Nodus itself can see. The
release also makes model reasoning honest and stops two startup modals from
spending resources after they have finished presenting themselves.

### Added

- **Full report context and selection actions for Nodi.** With Current view
  enabled, complete Deep Research reports and Immersion sessions now take
  priority in Nodi's context. Selecting text opens actions to copy it, keep one
  persistent reading bookmark per document, or quote it into Nodi. The same flow
  works in the embedded companion and the always-on-top window.
- **A Saved workspace for authors.** Authors can be saved from cards and dossiers
  and remain saved across rescans through their canonical identity. The saved
  view reuses search, sorting, synthesis filters, pagination, export, dossiers
  and graph navigation, with bulk export scoped to the saved selection.
- **Persistent Deep Research retrieval through MCP.** Dedicated list and detail
  tools expose the saved report gallery independently of the temporary generation
  queue. Catalogues are compact, searchable and paginated, while an individual
  report returns its complete Markdown, evidence selection, traceability matrix
  and bibliography.

### Changed

- **The reasoning level is per job, not per model.** Raising Immersion to High no
  longer raises Deep Research, the writing workshop and every other job pointed
  at the same model. Each job keeps its own level, while Providers retains the
  per-model default used when a job stays on Default.
- **Every MCP read remains available across vault switches.** Clients that cache
  an older tool catalogue can still retrieve ideas, works, passages, notes,
  authors and every other read-only layer from the vault Nodus is serving.
  Mutating and action tools remain restricted to compatible vault types.
- **What’s New and the startup updater settle after their active moment.** Nodi's
  SVG animation and the decorative aurora and confetti now stop, updater progress
  is throttled, and closing the updater detaches its listener and unmounts the
  modal. The one-off 3.2.4 mobile preview also stays retired in later versions.

### Fixed

- **Reasoning levels did not reach scans.** Extraction, summaries, fusion,
  Immersion generation and other structured calls ignored the selected level.
  An explicit level now applies, while leaving it unset keeps the previous fast
  no-reasoning behavior. Returning to Basic mode also clears any hidden per-job
  level that the single picker cannot show.
- **Ideas could reopen with a stale total after a background scan.** The first
  request of every visit now bypasses the vault query cache, while pagination and
  sorting inside the mounted view retain the existing cache.
- **Clearing notifications left announcements behind.** Clear now behaves the
  same in Nodi and in the header, asks for confirmation, removes recent activity
  and persistently dismisses only the announcements currently visible. Future
  announcements remain eligible to arrive.
- **Citation previews in floating Nodi could remain on Loading.** The restricted
  preload now exposes citation previews, and synchronous bridge failures can no
  longer strand the hover card.

## 3.2.5 — 2026-08-07

A corpus that had quietly stopped growing a month ago, the blindfold that kept it
quiet, and the setting that decides how long a scan takes finally sitting where a
model is chosen.

### Added

- **The reasoning level beside the model, in Settings › Models.** Every picker
  that assigns a model to a job now carries its level: the general text model,
  the five shared advanced roles, the per-vault overrides, and the study vault's
  primary and fallback columns. It appears only for models that publish levels,
  which today is Codex and nothing else, so every other row is unchanged.
- **One level per model, shared by both screens.** The level belongs to the model
  rather than to the role using it, and Models and Providers now write it through
  a single function, so setting it in either place sets it for every job running
  that model. Left on «Default» it stores nothing, which keeps it following the
  model's own recommendation when Codex changes it.

### Fixed

- **Deep scans could no longer create ideas once a vault passed 9,999 of them.**
  The id counter was read as text, and the four-digit zero padding keeps a text
  sort honest only up to `g-9999`: past it `'g-9999'` sorts above `'g-10000'`, so
  the allocator kept proposing an id that already existed and every scan with a
  genuinely new idea to record died on `UNIQUE constraint failed: ideas.global_id`.
  It failed at the very end, after the whole extraction had been paid for, and a
  work whose ideas all fused into existing ones still went through, so it read as
  intermittent rather than total. The counter is now read as a number. No
  migration: ids keep their padding and grow to five digits on their own.
- **A failed scan said only "Failed".** The queue has always carried the reason
  and never rendered it, leaving it in the developer console. The state label now
  carries the message on hover.

## 3.2.4 — 2026-08-06

The header stops being a shelf, and Nodus gains a way to say something between
releases. Around that: the project's own accounts, a first look at Nodus on a
phone, and an academic vault that opens with fewer sections than it can fill.

### Added

- **A notification centre button in the header**, immediately left of Settings.
  It shows the same two lists Nodi shows — the announcements published by Nodus
  and what the app has been doing — which matters because Nodi is optional: with
  the mascot disabled the centre was unreachable entirely.
- **An announcements channel.** Nodus can now say something between one release
  and the next: a survey, a known problem, an important change. Notices carry
  their own copy per language, may carry an https link, expire on their own and
  can target a version range. Reading is per notice. The whole thing switches off
  in Settings, and off means no request at all.
- **Links to the project's accounts** from the release modal and from Settings ›
  About Nodus: Reddit, YouTube and X, each with its own mark. The links open in
  your browser and nothing is sent to those networks.
- **A first look at Nodus on a phone**, shown once on this release: nine screens
  of the mobile app, what it does and what it does not do yet, and a short survey
  about whether anybody wants it. The screenshots and the form are English only,
  and the gallery around them says so in all eight languages.
- **On the phone, ask a report about the words you have selected.** The passage
  travels into that report's conversation as a quotation, and the question is
  already about something. Bookmark and Ask now sit at the front of the selection
  menu, ahead of Copy.

### Changed

- **Three icons leave the right rail.** Vaults goes because the centred badge
  opens the same panel, and that badge is now shown at every window width.
  Collections was already in the command palette; Roadmap gains a card in
  Settings › About Nodus.
- **The inbox is conditional on having entries**, since it is per vault and means
  nothing on a local install, and Refresh stops showing in primary-sources
  vaults, which do not sync with Zotero.
- **An academic vault opens with fewer sections.** Gaps becomes a tab inside
  Coverage, because a gap only means something against what your own question is
  missing. Hypotheses and Reading path start hidden, since on a freshly synced
  corpus they answered with noise. Both come back from Settings.

### Fixed

- **The local AI engine answered at the wrong address once it was already
  running.** The request that started the server reached the OpenAI-compatible
  interface, the ones that found it running reached the native one, and that is
  where empty embedding vectors came from, silently. Both exits now derive the
  URL from the same field, with a test that reproduces the difference against a
  stand-in for llama-server.
- **Buttons that laid out without their icon.** A name the icon set does not have
  draws nothing at all, so the control still laid out and still clicked while
  showing a gap — as Next did in Gaps, beside a Previous that had its arrow.
  Twelve names across twenty-six call sites are named again, and a test now walks
  every `<Icon>` tag to keep them that way.
- **On the phone, a citation stopped opening** when the reading bookmark shipped,
  because the two tap recognizers competed. A source now opens the instant it is
  pressed rather than after UIKit has ruled out a double tap, and reading a
  report no longer re-parses its prose every time something on the page changes.

## 3.2.3 — 2026-08-05

Reading, rather than finding. A report can be marked as read, a passage on the
phone can be kept as the place you stopped, and a work on the phone leads back to
its item in Zotero. Search on a connected phone also answers at all again.

### Added

- **A Deep Research report can be marked as read**, on the desktop and on the
  phone. The gallery says so at a glance — a badge over the cover, a lighter
  title — so the question a list of twenty reports raises is answered by
  scanning rather than by opening each one. On the desktop the mark travels
  between your own machines in a sync package; it is deliberately not an edit of
  the report, so it never goes back on the wire to a connected vault.
- **A reading bookmark on the phone.** Select a passage in a report and keep it.
  There is one per report, it is marked in the text itself, reopening the report
  goes straight to it, and tapping the marked words offers to remove it.
- **A work on the phone opens in Zotero.** The Zotero key stops being a dead line
  of the record and becomes the way back to the PDF, the notes and the
  annotations that live in the other app.

### Fixed

- **Search on a connected phone answers again** when what you are looking for
  appears in a theme, a character or a scene. One such match was enough for the
  app to be unable to read the answer, so it showed no results at all.

## 3.2.0 — 2026-08-04

Work that arrives from another device has somewhere to land, and the two places
Nodus used to stop responding — the window while a report is written, the server
while somebody searches by meaning — keep answering instead.

### Added

- **An Inbox in the header.** What another device sends now lands in a record of
  arrivals rather than only where you happened to be looking: the chip says what
  arrived and not just how many, a report can appear while you are elsewhere in
  the app, and an idle desktop still receives because the ledger is drained on a
  timer instead of on the next thing you click.
- **The Deep Research queue says where it stands.** The report being generated
  carries a bar with its real percentage and the ones waiting say how many are
  ahead of them, in place of an icon that spun the same way for a report that had
  just started and one about to finish.

### Changed

- **A semantic search on Nodus Server runs off the event loop.** Working out one
  search used to hold every other request behind it; the arithmetic now runs on
  worker threads and the server keeps replying while it happens. The pool also
  drops a dead thread that was idle, which it previously kept.
- **The snapshot cache is bounded by what it weighs, not by how many vaults it
  holds.** Three published vaults of any size went past a gigabyte for a large
  corpus. The ceiling is memory now, and an administrator can raise it.
- **The desktop, Nodus Server and the mobile app all state 3.2.0.**

### Fixed

- **Generating a report no longer freezes the window.** Nodus goes through the
  whole corpus several times per report, and each of those searches blocked the
  app for as long as it took. They run in parts and hand control back between
  them. The last two that still blocked are paged as well, and the pass that kept
  a hundred ideas stopped looking up the works behind all ten thousand.
- **A finished report appears in the gallery by itself.** With several queued,
  all but the last stayed out of it until you left the section and came back. A
  report that generates but cannot be saved now says so instead of disappearing
  without a trace.
- **The Inbox chips are legible in the light theme.**
- **The ledger stopped reissuing sequence numbers it had already handed out.**

## 3.1.0 — 2026-08-03

Nodus Server stops being a read-only shop window. A vault can now live on a
server and be replicated whole onto a machine, an account's access level in a
space decides where that person's work ends up, and the computer in front of
you can be the server without Docker or a domain.

### Added

- **Connected vaults.** Creating a vault offers a second origin: enter a Nodus
  Server address and your credentials, pick from the spaces the account can
  reach, and pull down a complete replica. It is a real SQLite database on
  disk, not a remote viewer, so the graph, debates, argument map, Deep Research
  and immersions work offline exactly as a local vault does, and a background
  service refreshes it. Losing access leaves the vault whole and merely stops
  the sync, with a plain notice saying so.
- **Per-space access levels, enforced by the replica's own schema.** A reader's
  notes, reports and immersions have no route out of their machine, rather than
  an interface that declines to offer one; a writer's travel to the main vault
  the next time its owner connects, and the screen states how many changes are
  waiting. An administrator assigns several spaces at once, each at its own
  level, and changes a level without revoking and re-granting.
- **Genealogy, teaching, study and database vaults publish too**, not only
  academic ones.
- **Basic server mode.** Settings → Nodus Server runs the identical
  `server/server.mjs` as a child of the desktop, with no Docker, no domain and
  no port forwarding (`electron/localServer/`). The card states who can reach
  it at any moment — this computer only, the local network, or a tailnet — and
  there is deliberately no option to serve the network over plain HTTP. A
  network change that breaks a bound address relaunches the listener, and
  keeping the lid open asks for the administrator password through the OS, not
  through Nodus.
- **The report layout became shared code.** `shared/professionalReport.ts` and
  `shared/deepResearchReport.ts` compile into `server/lib/core/generated/` via
  `npm run build:server-shared`, so a replica or a phone prints the document the
  desktop prints instead of an approximation of it.

### Changed

- **The privacy policy told the truth about embeddings.** It claimed vectors are
  never uploaded, which shared semantic search had made false: idea vectors do
  travel, so a replica or a phone can search by meaning. The document now says
  so and says that it changed, and a new "Include semantic vectors" switch
  really stops it. Passage vectors stay tied to the passages switch.
- **The Deep Research reader header is a rail of icons** that open their labels
  on hover or keyboard focus, the same treatment the titlebar uses, and the
  permanently disabled "Guardado" button is gone — the reader auto-saves, so it
  could never do anything.
- **The add-vault dialog keeps one size** whichever origin is selected, instead
  of collapsing to a third of its height and back.
- **The desktop, Nodus Server and the mobile app share one version number.**
  `scripts/test-version-agreement.mjs` holds `package.json`,
  `server/package.json` and `server/lib/version.mjs` together.

### Fixed

- **A shared study or teaching vault was publishing class recordings, attempt
  records and grading runs.** It no longer does. Report illustrations and
  people's portraits, which a replica used to lose, now arrive complete.
- **Pairing codes contained characters nobody could transcribe.** They were
  built from uppercased base64url, so 22% carried a `-` or `_` inside a group,
  next to the group separator, and the fold of `a` onto `A` made a letter twice
  as likely as a digit. `pairingCode()` now draws from a fixed 32-symbol
  alphabet with no I, O, 0 or 1, five bits per symbol and no modulo bias. The
  endpoint test only failed on an unlucky draw, so the generator has a
  ten-thousand-draw test of its own.
- **An owner membership could not be changed while another owner remained.**
- **The connected password field can be revealed** before it is sent, since
  signing in is one shot and a typo comes back only as "wrong credentials".

## 3.0.4 — 2026-08-01

Deep Research becomes something an MCP client can queue instead of wait on, and
two surfaces stop repeating themselves: a retry that always returned to the
engine that had just refused, and an argument map that redrew every hub as a
star.

### Added

- **Deep Research reports can be queued over MCP.** `nodus_generate_deep_research`
  holds the call open for the whole generation — minutes during which a client can
  time out — and it competed with whatever the window was already generating. A
  single generation lane (`electron/ai/deepResearchQueue.ts`) is now shared by the
  app and MCP clients, and four tools let a client enqueue and poll instead of
  wait: `nodus_enqueue_deep_research`, `nodus_list_deep_research_jobs`,
  `nodus_get_deep_research_job`, `nodus_cancel_deep_research_job`. Each job is
  bound to the vault active when it was queued — checked again before it starts
  and once more before its draft is saved — and switching vault cancels anything
  still waiting for a different one. MCP-originated reports appear in the app's
  queue strip with an MCP badge and raise a Nodi notification when they finish,
  since the client that asked for them may have disconnected by then.
- **The image engine is choosable per image.** The design modal gains a model
  picker listing the whole catalogue with its per-image price; the footer states
  what the button is about to use rather than what last ran.

### Fixed

- **A failed image was retried on the engine that had just refused it.** The retry
  read the provider and model off the failed record, so a report stuck on "the
  image could not be generated" reproduced the identical failure on every attempt,
  and changing the image provider in Settings did nothing for it. The engine now
  comes from the request or from Settings: a failed image opens on the current
  default, a ready one keeps its own, and what a retry repeats is the request, its
  prompt and its style — not the engine.
- **Image failure reasons leaked Spanish or were flattened into a generic
  message.** These reasons are stored and read back later, unlike every other
  runtime error, and reached the renderer two ways that disagreed:
  `localizeIpcPayload` collapsed most of them into "the operation could not be
  completed", the ones its Spanish detector missed leaked verbatim, and the
  `images:changed` event bypassed localization entirely. They are now registered
  as renderer-translated, translated in all seven languages, and every
  `images:changed` broadcast is localized like an IPC result. The modal leads with
  the reason; the reassurance about the report is a footnote. Four reasons that
  interpolated a model or provider name became fixed sentences so they can have a
  translation key at all.
- **The argument map collapsed hub ideas into a flat star.** The local-subgraph
  walk capped the idea budget in row order before ranking by relevance, so a
  well-connected idea silently lost some of its strongest debates; and it kept only
  the edges the walk itself crossed, which for any hub meant no neighbour-to-
  neighbour edge survived — every branch was forced to be a leaf regardless of the
  configured tree depth — while the header quoted the post-cap counts instead of
  the idea's real connectivity. It now expands strongest-link-first, keeps the full
  induced subgraph so branches can ramify, grows the structural tree level by level
  with branches split across debates/support/other instead of ranking alone (which
  handed every slot to debates), and reports real graph-wide connection counts plus
  how many links were left undrawn. Pinned by
  `scripts/test-argument-map-graph.mjs`. Closes #329.

### Changed

- **The website's live demos are usable on a phone.** All six demo vaults ship a
  mobile layout (`site/demo/mobile.css`, `site/demo/mobile.js`) instead of a
  desktop shell squeezed into a narrow viewport.

## 3.0.3 — 2026-07-31

Getting reports out of Deep Research, and a Cancel button that left the job
running. Both the archive and the cancellation are covered by tests that were
watched failing before the fix.

### Added

- **Reports leave Deep Research in bulk, and by the card.** Everything the
  gallery produced left one report at a time through the reader: thirty reports
  meant thirty save dialogs, and a card could not be downloaded without opening
  it. A Download button in the header turns the existing selection mode into a
  bulk export — select-all included, Markdown / PDF / both — and returns one ZIP;
  every card and list row also gains a download icon. Reports are rendered one at
  a time because a PDF is printed by a real Chromium window whose deferred
  teardown only holds if the next print starts after the previous one let go,
  hence the progress bar: a serial pass can run for a minute, and a silent minute
  reads as a hang. Two things `scripts/test-deep-research-archive.mjs` pins that
  a naive archive gets wrong — a zip entry overwrites its namesake, so reports
  sharing a title get distinct names; and each report's files are staged before
  being added, so a report whose PDF fails leaves nothing behind instead of an
  orphan Markdown.
- **"Suggest with AI" in the image design modal.** It streams a scene description
  written from the report's own summary into the prompt box — what the generator
  would have written for itself, which was only ever invisible. Nothing is
  persisted until the user generates with it. Closes #325.

### Fixed

- **The audio Cancel button did not cancel.** Cancelling only added the job key
  to a module-level `Set`. That notified no subscriber, so the panel never
  re-rendered and the click looked like a no-op; and the loop read the flag only
  between segments, always awaiting the synthesis in flight. A long section takes
  minutes, a dead TTS worker or a stalled cloud request never settles, and the
  job then stayed running for the rest of the session with no way to start over.
  Cancellation is now a record per key: a promise the loop races against the
  segment in flight, an `AbortSignal` handed to the synthesiser, and an immediate
  job update so the button acknowledges the click as "Cancelling…". The
  local-voice synthesiser drops the aborted request and terminates its worker
  when nothing else is using it, so a cancelled segment stops burning a core to
  finish a narration nobody will hear. Closes #323.

## 3.0.2 — 2026-07-31

The Deep Research release. The engine used to overstate itself in ways that
compounded: it reported coverage it had not achieved, published attributions its
sources did not support, and printed raw identifiers where a citation should be.
Every number below was measured on reports generated over a snapshot of a real
academic vault, not on fixtures.

### Added

- **The writer now sees the evidence it cites.** The citation menu carried
  placeholders — "an anchored research gap", "a literal passage from the full
  text" — so a report cited zero passages and argued gaps and debates from a
  label. It now carries each idea's statement, what a gap claims, what a
  contradiction opposes and who holds each side, and the literal text of a
  passage with its page. A passage whose text cannot be read is never offered.
- **Citations are checked against their sources.** Each claim is paired with the
  material cited for it and judged for entailment; what a source does not support
  is removed from the prose and from the bibliography, so a false attribution
  cannot survive anywhere in the report.
- **A support-check panel.** A third of the citations that pass verification are
  only partially supported — the source backs a weaker version of the sentence
  than the sentence claims. Those are listed beside the text of their source and
  the author-year to open, turning a manual check from hours into minutes.
- **Reading order is planned.** The planner declares each section's role and what
  it presupposes, and a stable topological sort turns that into the sequence. Two
  runs of the same objective previously produced a genealogy and a flat thematic
  list; the progression is now a property of the engine.
- **Self-contradictions are reported.** A read-only pass flags passages of the
  report that cannot both be right, quoting both sides verbatim and discarding
  any finding whose quotes are not in the text. It never rewrites: editing
  assembled prose would put every verified citation at risk.

### Fixed

- **Coverage counted the plan, not the prose.** Every idea is assigned to some
  section, and assignment counted as coverage, so the statistic read 120/120
  while 77 ideas were really cited — and the top-up that lifts a short report was
  unreachable dead code. Reports landed two pages under their minimum with no
  truncation flag. Coverage is now what the text cites.
- **Reports landed on the floor of their page range.** Sections were sized at
  1400 words on the theory that few long sections beat many short ones; measured,
  a section asked for 1575 words came back with ~1040 and stayed there even after
  being rewritten. Sizing the plan to what a section really delivers moves a
  report from 9 pages to 11–12, with 20% more citations and 22% more ideas.
- **Malformed citations printed raw identifiers.** Models emit references in
  shapes the citation pattern never matched, and those escaped both the prose and
  the accounting. References are now repaired where the label can be
  reconstructed and dropped where it cannot, and a final sweep guarantees no
  `nodus://` identifier can reach the page.
- **Gaps and debates read as debug labels.** "(hueco)" and "(contradicción)"
  appeared 50 times across three reports as visible text in academic prose. A gap
  is now cited by the work it is anchored to and a debate by whoever holds one of
  its sides. Sources whose author the corpus never captured are cited by a
  shortened title instead of "(Author)".
- **Split headings.** `Title: subtitle` headings are folded into one phrase,
  keeping the subtitle rather than truncating it.
- **The abstract and limitations appeared twice.** The reader showed the abstract
  as a subtitle and again as the first section, and the markdown export added its
  own copies on top of the ones already in the body.
- **The argument map and debates froze the window.** They painted tens of
  thousands of elements at once; they now render in chunks as you scroll, and the
  map unfolds one branch at a time instead of opening whole.
- **Image generation with Google.** It was being asked for an image format the
  API no longer accepts.
- **Interviewed characters recited their sheet.** In worldbuilding demo mode they
  answered by reading their own character sheet aloud instead of speaking.
- **The macOS update never finished installing.** Nodus ships unsigned, so it
  replaces its own bundle with an external helper rather than handing off to
  Squirrel.Mac, and the helper waits for the app to exit first. `app.quit()` is
  cooperative and did not always terminate the process — finishing a download
  makes electron-updater start a local proxy and register with Squirrel.Mac
  before it ever consults `autoInstallOnAppQuit` — so the app sat idle in its run
  loop while the helper waited on a PID that never died. Force Quit then killed
  the helper too, nothing was installed, and reopening staged another helper
  doomed the same way. Three layers, because each failed independently: the quit
  falls back to `app.exit(0)` if the process is still alive shortly after
  `app.quit()`; the helper ignores TERM/HUP/INT so it survives a force quit, and
  stops waiting after two minutes instead of forever; and startup reads the
  helper's state file — written all along, read by nobody — so a stalled install
  is reported instead of silently re-offered. Covered by
  `scripts/test-unsigned-mac-update.mjs`, which runs the real generated helper
  against fake bundles and force-quits it mid-wait.

### Changed

- **The Codex runtime bundled with Nodus can generate images**, so a connected
  ChatGPT subscription needs no extra key for illustrations.

### Measured and rejected

Kept in the code with the measurement beside it, so none is retried blind:
multi-probe retrieval (tripled unsupported citations without a relevance floor;
with one, changed 5–10% of the pool while reducing the distinct works behind it),
longer sections (the expansion pass fires on 10 of 12 sections, is accepted, and
the section still finishes at ~1040 words), and preferring literal passages over
derived ideas (verbatim quoting more than tripled, the argument leaned on a third
fewer distinct works, and unsupported citations doubled).

## 3.0.1 — 2026-07-30

A performance release, from an audit run against a real 465 MB academic vault.
No new surface; three causes behind the app feeling slow, plus the tooling that
found them so the other vault types can be measured the same way.

### Fixed

- **Sections that blocked the whole window now open promptly.** Every read path
  runs to completion on the single main-process event loop that also answers the
  renderer, so a slow query is not slow rendering — it is a frozen application.
  The graph bound one placeholder per idea into its aggregate queries, making
  SQLite's cost grow with ideas x works (2,745 ms -> 170 ms). The argument map
  loaded 9,721 nodes and 34,531 edges to fill a picker that shows sixty and never
  reads an edge (448 ms -> 16 ms, and its IPC payload 10.0 MB -> 2.4 MB). Debates
  rebuilt each side once per edge and fetched works one at a time through a batch
  API (261 ms -> 87 ms). The reading path assembled every gap statement in the
  corpus to display three (212 ms -> 157 ms). Author dossiers ran the same theme
  query once per related author (397 ms -> 69 ms).
- **Nodi no longer animates when nothing is happening.** Its SVG repainted every
  frame forever, costing about half a core with the application idle and warming
  the machine. It now holds its pose a few seconds after the last activity and
  wakes on hover, on a state change or on a notification; the animations are
  paused, not removed, so they resume exactly where they stopped.
- **The extracted-text cache is bounded.** It was written with an upsert and never
  pruned, reaching a quarter of the vault file and entering every backup archive.
  It is capped at 64 MB, newest first; evicted text is re-extracted on demand.

### Added

- Six benchmarks under `scripts/bench-*` that measure main-process blocking, idle
  CPU per helper process, per-section render cost in the real window, and SQL
  attribution per statement. They run against a copy of a profile, never the live
  one.

## 3.0.0 — 2026-07-30

Four new vault types arrived in this cycle, which is what moves the major. A
"2.8.0" was briefly authored for the Testimony vault alone and never published;
its notes are part of this release, and no 2.8.0 exists.

### Added

- **Testimony vault, for oral history and journalism.** The unit is the whole
  interview — its preparation, participants, sessions, master files, transcripts
  and the agreement it was made under. The master file enters exactly as
  received, with its SHA-256 checksum and marked immutable; correcting,
  reviewing, approving, anonymising or translating creates a derived version that
  remembers where it came from, and quoted fragments re-anchor when they can and
  are flagged when they cannot. Agreement status, access level and workflow
  status are three independent dimensions behind one gate (`evaluateAccess`) that
  genuinely blocks exports, access packages and what the AI may see. Coding by
  selection, comparisons across interviews, notes carrying quotation and
  timecode, local Whisper transcription, speaker separation with manual naming,
  a consent-governed semantic index, and three archival export packages
  (preservation, access, review) with manifests and stated exclusions. Schema
  v105–v106; demo "Memoria del valle" with synthetic voices generated from its
  own script.
- **Worldbuilding vault.** Characters (a `persons` row plus a
  `character_profiles` overlay, so kinship, life events, places and portrait are
  inherited rather than duplicated), places as a tree of 37 kinds, factions and
  cultures, scenes with independent world-day and narrative orderings, secrets
  with their knowers, and an invented calendar. Maps with nested canvases,
  calibrated scale, pins/outlines/routes, distances and travel-time reports, and
  labels drawn by Nodus rather than the image model. An A–Z encyclopedia with
  `[[wiki-links]]` promoted to `nodus://` links on save. The Analizar layer —
  Rules, Conflicts, Arcs, Continuity and Open questions as five readings of
  `world_beats`, surfaced on the scene sheet. The manuscript as the column the
  scene was missing, with a books shelf, snapshots, typewriter mode and a
  beats-only AI reading. World chat where Nodus computes the facts and the model
  writes with them. Schema v91–v101.
- **Primary Sources vault.** Repositories and archival hierarchy, capture
  sessions, working collections, templates, files served over a restricted
  `nodus-archive:` protocol, reviewed text, excerpts, evidence links,
  proposals, citations, policies, audit records, exports and recovery, plus map,
  timeline, people, relations, notes and research. Reversible synthetic
  documentary demo corpus with generated document images and gazetteer-backed
  places.
- **Prosopography vault.** Canonical evidence-aware domain model, source capture
  and criticism, identity resolution, factoids, population/cohort/questionnaire
  workflows, layered network analysis and interchange. Interview diarization
  preserves the literal transcript, aligns to the timeline, accepts
  expected-speaker guidance and large uploads, and guarantees remote-file
  cleanup.
- **Teaching: the Analyze group and Unit design.** Chat, Ideas and Graph scoped
  to `docencia` over the same `study_*` corpus, and "Unidades didácticas" becomes
  Deep Research with a target audience — teacher lesson plan or student handout —
  threaded through the plan, write and finalize prompts in all seven languages
  (`shared/studyDeepResearchAudience.ts`).
- **Turkish.** The seventh complete interface language, kinship terminology
  included, plus full localization of every Toolkit surface.
- **Product feedback in Suggest / Report.** An optional 0–10 survey (coverage,
  usability, performance, stability, visual design) with free-text, routed to one
  permanent shared thread instead of a new issue per response, with the Nodus
  version and OS filled in. Community Standards files added alongside it.
- **Genealogy branch visibility, custom searchable fact types, configured places
  when recording a fact, and multi-day calendar event bars.**
- **Tutorial video pipeline** (`scripts/tutorial/`), which records narrated
  tutorials by driving the real application. Nothing in the app changes.

### Changed

- **The academic Library is organised around one readable status.** The five
  analysis-pipeline fields fold into one derived readiness value
  (`src/libraryStatus.ts`): twelve columns become eight, each row keeps one
  primary verb plus Zotero and an overflow menu, the four-dimension status matrix
  becomes one-click presets that filter in SQL over the whole corpus, and the
  selection bar drops from eight buttons to one verb with an explicit scope. A
  per-work breakdown retries each step on its own. The two indexes are renamed
  for what they give the reader — semantic search and citable text — replacing
  five controls that all said "Indexar".
- **First run.** The guide shows the introduction alone and says where the rest
  are; the ten published tutorials live in Settings on four shelves with tabs and
  a search box, and a vault's video is offered when that vault is created. After
  the guide, a cinematic screen names the first vault and picks its mode instead
  of handing over an academic vault called "Principal". The vault-type picker
  moved to `src/components/vaultTypeUi.tsx` so the switcher modal and the
  first-run chooser cannot drift.
- **AI setup can be postponed and model downloads cancelled.**
- **Sidebar customization is scoped per vault** instead of applying globally.
- **MCP and Nodus Server reach parity with the new vaults** in snapshots, tools,
  validation and tests; Deep Research export branding is standardized and
  vault-aware; Nodi's product knowledge now describes the implemented Toolkit,
  the available vaults, the server roadmap, collaboration and the planned
  iOS/iPadOS apps.
- **What's New badges read their vault's own glyph and accent** from
  `VAULT_TYPE_COLORS`/`vaultTypeIcon` rather than a second hardcoded copy, which
  is how `prosopography` had ended up slate here and blue everywhere else. The
  MCP scope moves to navy, since blue-600 now belongs to a vault.
- **The Zotero setup assistant names the local API correctly.** There is no
  "local Zotero 7 API"; the client talks to Zotero's local implementation of Web
  API v3. Reworded across the source and all seven translations, and the dead
  `itemsSince()` client path removed.
- **Project documentation is in English**, and the website moved under `site/`
  with its own Pages deployment workflow.

### Fixed

- **The Zotero sidebar connects on its own.** It read
  `~/.nodus/zotero-bridge.json` once at boot, so starting Nodus after Zotero left
  the sidebar on "not connected" until the user opened Settings and pressed Test
  connection. A backoff loop (1.5s → 15s) re-reads the bridge file on every
  attempt and retries immediately on Zotero regaining focus, Settings opening and
  before sending a message. The probe validates the token against
  `/api/z/models`, because `/api/z/health` is deliberately tokenless and would
  report "connected" for a stale token; while the link is up, HTTP
  re-validation happens every five minutes rather than every tick. Plugin
  bumped to 3.0.0.
- **Worldbuilding AI workflows are bounded to author-provided canon.** World chat
  consumes bounded conversation history as non-evidentiary context, citations are
  restricted to the exact retrieved context with a deterministic source fallback,
  prompts are hardened against instructions embedded in vault data, embedding
  vectors are validated so partial indexing cannot be counted or persisted,
  cosine comparisons across incompatible dimensions are rejected, and archive
  embeddings persist provider/model/dimension provenance so edited or legacy
  vectors are invalidated instead of silently reused.
- **Word add-in navigation and localization.**
- **Gray bands around Deep Research PDF cover images**, caused by a blurred cover
  shadow some viewers flatten into filter bounds.
- **Full-resolution originals are preserved and downloadable**, portrait framing
  is retained after dragging, and database image assets load through the native
  cache.
- Light-theme coverage across the worldbuilding views, dropdowns kept inside the
  viewport, manuscript rail overflow, group card styling, and PDF.js font-face
  disabling.

## 2.7.0 — 2026-07-26

### Added

- **Video tutorials, in-app.** First run now asks a third question — watch the
  tutorials or read the written guide — and the video path renders the published
  catalogue as a grid inside the same cinematic chrome, with an in-app player
  (pause, seek, captions, speed, fullscreen). Watched flags are global, so a
  video watched in one vault stays watched in the others. Settings → Tutorials
  leads with the same grid above its replay buttons, and a vault tour whose
  ground a video covers opens with three ways in (watch, walk the app, not now).
  The catalogue is fetched from `site/tutorials.json` in the main process,
  validated entry by entry and cached in `userData`; the three built-in
  tutorials are always a complete fallback. The written deck remains the offline
  path. Existing installs, which were never asked the question, get a one-time
  announcement modal that embeds the same grid.

### Changed

- **The header sync button matches the rest of the rail.** The Zotero sync
  action was the only header icon rendered with `btn-primary`, permanently
  filled with the vault accent colour. It is now `btn-ghost` like its
  neighbours, keeping its spinner and pinned label while syncing.
- **Person dossier add buttons are icon-only.** The `+` actions for family and
  social relations, places, name variants and life events claimed at least 176px
  of the section header and wrapped their own label, squeezing the title and
  description into a one-word-per-line strip. They are now 32×32 icons with the
  wording in a tooltip and a specific `aria-label` per action; the biography
  action, whose label carries state, keeps the wide style.

### Fixed

- **Automatic backups no longer freeze the app.** `createBackupArchive` ran
  unattended every 30 minutes and was fully synchronous: on a 220 MB payload
  `AdmZip.toBuffer()` alone blocked the main process for 3.65 s (0.28 s now,
  async zlib), plus synchronous `scryptSync` and `readFileSync`/`writeFileSync`.
  Linear in library size, so a 1–2 GB library meant 20–45 s of freeze per
  backup. Hashing and entry addition now yield, and `serverSyncService` gzips
  asynchronously for the same reason. The archive format is unchanged.
- **Nodi stays responsive and its lists scroll.** The mascot preload used
  `ipcRenderer.sendSync` for the mouse hit-test — fired on every transition —
  which parked the overlay renderer until the main process was free without ever
  buying the ordering it was written for; the hit test is now fire-and-forget and
  the first frame's placement travels in the URL. Separately, `.nodi-note-row`
  and `.nodi-msg` were left at the default `flex-shrink: 1`, so quick notes and
  chat compressed their rows (33px instead of 60px) and clipped their own text
  instead of scrolling; `flex: 0 0 auto` restores natural heights.
- **The Word add-in installer no longer deletes files from the Office cache.**
  `installCopilotAddin` walked Office's Wef cache and unlinked anything matching
  `nodus` or the add-in GUID, including `Word.RibbonCache.<locale>`, the index
  shared by every installed add-in — which Microsoft documents as a way to make
  all add-ins stop loading. Bumping the manifest `<Version>` is the sanctioned
  way to make Office pick up a changed manifest, and it is now the only thing
  the installer does. `word-addin/README.md` documents the real install flow and
  a troubleshooting note for the unrelated Office-side failure on Word for Mac
  16.109 with work accounts.

## 2.6.3 — 2026-07-24

### Added

- **Zotero plugin self-updates.** The Nodus for Zotero add-on now keeps itself
  current: it registers with Zotero's own add-on updater and installs each new
  plugin release automatically from the latest GitHub Release (downloaded and
  sha256-verified by Zotero, applied on the next restart). This is on by default
  and can be turned off under Settings → Updates; turning it off asks for
  confirmation first. Plugin bumped to 2.7.0.

### Changed

- **Nodus Server publishes every connected vault.** A server pairing is stored
  per vault, but the desktop only published the active one, so a shared vault
  silently went stale after switching away. Every connected vault is now tracked
  and published in the background regardless of which is open, Settings lists all
  connections with their status, and each can be synced or disconnected
  individually.
- **Refined Deep Research PDF report design.** The exported report now uses the
  stylized Nodus brand mark in the header, a clean title-page cover, a centered
  executive summary, automatic section numbering (01–04) and a compact
  table-based traceability matrix; the standalone research outline section was
  removed.

### Fixed

- **Page-aware answers for long Zotero PDFs.** A document map now injects
  authoritative structural facts (total pages, current reader page, first/last
  labels and honest truncation coverage) ahead of the evidence, so page and
  length questions are answered from the map instead of guessed. Positional
  retrieval fetches "current/last/first page" and "page N" deterministically,
  embedding is bounded and non-blocking (only BM25 candidates plus the current
  page embed up front, the rest continues in the background), and full-text mode
  marks truncation honestly while always including the requested pages.
- **Audio narration lifecycle and local Whisper cancellation.** Audio synthesis
  now lives in the global background-jobs store, so generation survives leaving
  the view and the panel restores its progress on return. A Deep Research report
  no longer narrates its abstract twice, Kokoro input is chunked on sentence
  boundaries so long segments are no longer truncated mid-word, and the local
  Whisper worker is no longer terminated on view unmount so an in-flight
  transcription finishes and persists in the background.

## 2.6.2 — 2026-07-23

### Changed

- **Zotero plugin indexing overhaul.** The single index action is now split into
  a Quick index (text extraction and chunking, ready almost instantly) and a Full
  index that progressively computes embeddings in the background, keeping the
  composer responsive. OCR is now on-demand instead of always running during
  indexing, and when reading a single document whose text fits the context
  window, full-text-in-context is used directly, matching the speed of competing
  single-document reading tools.
- **Smarter Zotero retrieval.** Query-time LLM round-trips are reduced: the
  rerank call is skipped when there are few candidates, citation repair is
  configurable (off/auto/always), and agentic search rounds are now configurable
  (default 1, was hardcoded 2). OCR processing is parallelised up to 3 vision
  LLM calls at once, and the local embeddings worker prefers WebGPU with a Wasm
  fallback when WebGPU is unavailable.

## 2.6.1 — 2026-07-23

### Fixed

- The in-app What's New modal for 2.6.0 only surfaced three Zotero-plugin
  highlights, silently dropping every other user-facing change shipped since
  2.5.4. The 2.6.0 and 2.6.1 entries now list the complete set — Nodus Apps,
  Nodus Translate, local FLUX.2 Klein image generation, professional PDF
  exports, the experimental Nodus Server, and the rest of the Zotero add-on
  work — translated into every supported language, so the fix reaches users
  regardless of which version they're updating from.

## 2.6.0 — 2026-07-23

### Added

- **Local semantic search for Zotero.** Nodus for Zotero adds fully local
  multilingual semantic search with a quantised E5 small model: no embedding
  API setup or cost, compressed indexes and vectors persisted in the Zotero
  profile.
- **Long PDF reconstruction and retrieval.** Long PDFs are reconstructed by
  page, column and paragraph with deduplicated headers/footers and
  coordinate-preserving citations/highlights; a bounded two-round retriever
  reformulates searches, inspects page ranges and expands evidence, with OCR
  and visual analysis fallback.
- **Nodus Apps.** A new Toolkit mini-app studio: build AI-generated sandboxed
  web apps and share sessions live via QR code or PIN.
- **Nodus Translate.** Translate pasted text, files and Zotero attachments
  with a chosen AI model, preserving DOCX/EPUB structure, plus a rasterized
  PDF facsimile mode.
- **Nodus Server (experimental).** Self-hosted, Docker-based server for
  sharing a filtered, read-only vault view with a group, reachable remotely
  from ChatGPT/Claude via an OAuth-protected MCP tunnel.
- **Professional PDF exports.** Deep Research, Immersion and Writing Workshop
  now export PDFs with a cover page, table of contents, structured sections
  and metrics.
- **Zotero add-on install/update from Settings.** Nodus for Zotero can be
  installed and updated from Settings, and is also published as a
  `nodus-zotero.xpi` file with every release.
- **Richer Zotero assistant.** In-context chat in the reader popup, an
  auto-highlighter for relevant passages, and the ability to save
  conversations as Zotero notes.
- **Zotero agent mode.** Proposes notes, highlights, tags or field edits from
  the conversation, requesting per-action confirmation by default.
- **Connected workflows guide.** A new onboarding guide explains when to use
  the local MCP server, Nodus Server, the Zotero plugin, or the full
  Toolkit.

## 2.5.4 — 2026-07-22

### Added

- **Office presentation imports.** PDF Presenter can now import PowerPoint,
  OpenDocument Presentation and Keynote files in addition to PDFs. Nodus converts
  them locally through an installed PowerPoint, Keynote or LibreOffice app,
  preserves compatible speaker notes and leaves the original file untouched.

### Changed

- GitHub releases remain as drafts until the macOS, Windows and Linux installers
  and their updater manifests have all been uploaded and verified.

### Fixed

- Closing the main window on macOS and reopening Nodus now restores both the app
  window and the enabled always-on-top Nodi companion.

## 2.5.3 — 2026-07-22

### Added

- **Guided ChatGPT connection via OpenAI Secure MCP Tunnel.** Settings now walks
  non-technical users through creating a tunnel, saving a runtime key, and
  attaching it in ChatGPT. Nodus downloads the current official tunnel client,
  verifies its SHA-256 digest before installation, diagnoses permissions, and
  reconnects automatically without exposing the local MCP listener.
- Runtime credentials stay outside renderer state and process arguments, and
  users can disconnect temporarily or forget the saved connection entirely.
- **Database comparison properties.** Compare two or more source columns and
  write their unique exact majority value per row or across the whole table.
- **Per-column AI models.** Text and image AI properties can override the global
  model, while their long-running cell and column jobs retain progress across
  navigation and report failures cleanly.
- **Spanish Kokoro voices.** Local narration supports Spain and Latin American
  voices with Spanish-aware normalisation and phonemisation.
- **Presenter notes as TXT.** Speaker notes can be exported to a stable,
  slide-numbered text format and imported again after validation.

### Changed

- **Toolkit polish.** PDF Presenter has reliable live annotation tools,
  shortcuts, resizable overlays, a more robust phone remote and better
  single-display behaviour. OCR Workspace adds new/library tabs, content search,
  provider-aware concurrency, model selection when reprocessing and clearer
  progress. Nodus Protect gets consistent controls and live slider previews.
- **Safer Study deletion.** Notes and materials support multi-selection and a
  two-step choice to retain or purge their derived ideas, embeddings, evidence
  and connections. Shared ideas remain intact, late AI work cannot resurrect
  deleted content, and individual ideas can be deleted from their detail view.
- **Clearer Settings.** Legal documents open in localised in-app modals, updates
  have their own section, model selection is separated from local/audio services,
  and favourite models are shared across vaults.
- Nodi chat text is selectable, with controls to copy one answer or the complete
  conversation.
- Shared Study material-table headers are centred and aligned.
- The Teaching vault now carries a BETA badge.

### Fixed

- The Teaching gradebook empty state once again creates the first gradebook.
- The ChatGPT MCP connector is readable in light theme and its guided setup gives
  more precise permission, installation and recovery instructions.

### Notes

- ChatGPT developer-mode permission remains a separate workspace setting managed
  by the user or their ChatGPT administrator.

## 2.3.2 — 2026-07-15

### Fixed

- Restores each vault's embedding provider/model from the metadata attached to
  its existing vectors when the 2.3 migration replaced that selection with the
  OpenAI default. The repair does not delete or reindex embeddings, and future
  intentional model changes are not reverted.
- Recovers favorite models by merging the per-vault fallback copies that 2.3
  left intact, without deleting any newer favorite.
- Restores differentiated task-model choices from the retired 2.2 global fields
  when 2.3 incorrectly collapsed them into basic mode.
- Keeps the basic/advanced mode, migration version and embedding selection with
  the vault they describe. A new or basic vault can no longer overwrite another
  vault's advanced task configuration or vector-index selection.
- Includes the 2.3.1 Safe Storage repair that recovers AI API keys hidden by the
  macOS application-name migration and preserves their encrypted historical
  copies.

### Notes

- Recovery is evidence-based and one-shot. Existing vector BLOBs and user
  documents are never rewritten by this settings migration.

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

- New "Image design" dialog for Immersion and Deep Research: preview the image,
  switch style, edit the scene description, and regenerate or delete it in one place.
- Five photographic and realistic decorative styles — realistic photograph,
  vintage photograph, black & white, cinematic, and oil painting (twelve in total).
- An editable scene description that rebuilds the prompt for the chosen style while
  preserving the "no text" safeguards.

### Changed

- Decorative images now render larger and more polished. The inline action buttons
  are replaced by a single unobtrusive "Design" pill that opens the design dialog,
  keeping the Immersion and Deep Research views uncluttered.
- The "immersion ready" screen is now part of the main immersion view instead of a
  separate standalone page.

## 1.4.2 — 2026-07-10

### Added

- Optional single decorative images for Immersion and Deep Research, generated
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
  block an Immersion or Deep Research report.
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
