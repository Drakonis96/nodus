# PDF Presenter — implementation plan (faithful replication + improvement)

> Status: **plan for revision**, no code yet.
> Objective agreed with the user (2026-07-20): **port the reference app
> `~/Documents/GitHub/pdfpresenter`more or less accurately**, verify each
> function one by one, cover with tests, and **adapt/improve design** for
> integrate it into Nodus (centralised icons, clear/dark themes, rhythm of
> spaced, i18n). The presentations live in a **global library of the
> Toolkit** (agnostic vault, such as Convert/Protect).

---

## 1. What is the reference app (full inventory)

App Electron with **three windows + a mobile web**, coordinated by a local Express + WebSocket
server. The whole state lives in a`currentState`which is broadcast by WS to customers and by IPC to
windows.

### 1.1 Main Window — Library (`src/js/renderer.js`)
- Import PDF (copy to`userData/presentations/<id>.pdf`+ entry into`meta.json`).
- List with **search**, **sorting** (recently added/recently opened/name ↑↓) and selection.
- ** Folders**: create, delete (move your content to root), move presentation, breadcrumb, counters,
  filter.
- **Rename** online (sidebar) and from the detail title.
- **Delete** with confirmation modal.
- ** Miniature grid** with lazy load (`IntersectionObserver`, limited attendance, off-screen
  release) and **badges** per slide (notes/has video); quick buttons "present" / "presenter mode"
  from a specific slide.
- **Import notes .pptx** (validates that the number of slides matches the PDF).
- **Full-screen notes viewer**: slide canvas + textarea, thumbnail sidebar, **undo/redo** (⌘Z /
  ⌘⇧Z), autosave, keyboard navigation, resizable notes panel.
- **Video editor** per slide: YouTube URL + position (x,y,width,high in %) with dragable/resizeable
  overlay and preview thumbnail.
- **Edit slides** (screw to jump to the video editor).
- **QR**, **Adjustments** (language), **detail info** (no pages, notes, videos).

### 1.2 Audience window (`src/presentation.html`)
Slide render to canvas (adjustment, DPR, cancellation of render in race), tool overlays (ilterna,
drawing, pointer, magnifying magnifying magnifier), **overlay video YouTube** + seek synchrony,
**black screen**, **slidezoom** (=rueda/pinch), auto-ocultable toolbar (colors, sizes, slider, QR,
cast, fullscreen), keyboard shortcuts, wheel size, size indicator, and status emission to the server
and presenter.

### 1.3 Presenter window (`src/presenter.html`)
Top bar (name, ‹ counter ›, **timer** play/pause/reset, black screen, QR, cast, **system clock**,
finish), current slide
+ same tools (colours, size, magnifying magnifier buttons), **previsualization of the following**,
  **host notes** (with font size control), **miniature carousel**, resizeable dividers (vertical and
  horizontal), shortcuts, slide zoom, video controls + seek, timer synchrony to the server, and
  monitor mirror to the audience.

### 1.4 Mobile (`src/mobile/`)
Displays connect / wait / command + reconnect toast. WS with **PIN**, preview canvas, notes (source
size), ** slide points** (sliding window), prev/next, **swipe**, **carousel**, **local view mode**
(advance in notes without moving the audience), touch tools (→ audience + echo in preview), **size
popup** (per tool
+ magnifying of magnifying glass + **system volume** + mute), **pinch-zoom** on/off, black screen,
  alternate video, timer (touch to pause / reset), and **pinch-zoom mode/complete screen** with its
  own lower bar.

### 1.5 Main process (`main.js` / `server.js`)
Data directory +`meta.json`; import/delete/read PDF; open/close windows with **external screen
detection**; **power-save blocker**; User-Agent cleaning (so YouTube does not block Electron); dock
icon; **cast selector** (script, macOS); **volume**get/set (script, macOS);
**bridge**`setElectronCallback`which translates WS ↔ IPC; **PIN**; **QR**; served as PDF with
anti-traversal guard.

---

## 2. How it fits in Nodus (which is reused)

| Need | In Nodus |
|---|---|
| Render PDF **offline** | `pdfjs-dist@4.8.69`**bundled** + local worker (`src/components/materials/PdfViewer.tsx`, `src/lib/protect/engine.ts`). The reference uses pdf.js by CDN — we delete it. |
| Card + Navigation | `src/navigation.ts`already declares`presenter` (`state:'soon'`). It is moved to`'wip'`and the sidebar/hub paint it alone. |
| View pattern with "come back" | `ToolkitConvertView.tsx`, `ToolkitProtectView.tsx`. |
| Secondary window | `electron/mascotWindow.ts`(create/manage life cycle of a`BrowserWindow`). |
| Multi-entry Vite | `vite.config.ts`You're building.`main` + `mascot`; we will add the audience/presenter/command entries. |
| IPC + Toolkit preload | `electron/ipc.ts` (`h('toolkit:…')`), `electron/preload.ts` (`runToolkitJob`, `pickToolkitFiles`, …). |
| Centralised icons | `src/components/ui.tsx` (`ICON_PATHS` + `<Icon>`) Replaces the online SVGs from the reference. |
| Zip (for .pptx) | `adm-zip`already (+`@types/adm-zip`). **No`jszip`/`xml2js`.** |
| IDs | `uuid`That's it. |
| Jobs in 2nd plane, i18n (8 languages), clear/dark theme | They already exist. |

**New (minimum) dependencies:**`ws`(WebSocket server, standard and small) and`qrcode`(QR
generation). Both are purely local. *(Alternative evaluated: implement handshake WS by hand
on`http`native — discarded by fragile; own QR without dependence — possible but`qrcode`is more
reliable.)*

---

## 3. Architecture decisions

1. **Management = React view within Nodus.**`ToolkitPresenterView`(+ subcomponents) following the
   Convert/Protect pattern. The card is flipped to`state:'wip'`.

2. **Audience and presenter =`BrowserWindow`own, dedicated Vite tickets** (`presenterAudience.html`,
   `presenterView.html`), which **reusing preload`preload.cjs`** and talk to`main`by **IPC** (not
   the server). They load pdfjs bundled and Nodus theme/i18n, but **do not** mount the complete app
   or touch the database (performance: "basic presentations that do not
   collapse").`mascotWindow.ts`.

3. **Mobile command = entrance Vite`presenterRemote.html`** constructed to`dist/`, **served by the
   local server** to the phone browser. It does not use preload; it speaks only by **WebSocket +
   fetch**. pdfjs it is **served from the local server** (from`node_modules/pdfjs-dist`) → 100%
   offline.

4. **`main`is the hub.** Translates WS controls (telephone) ↔ IPC (windows), just like
   the`setElectronCallback`The canonical state lives in a reducer **Electron-free**
   (`presenterState.ts`) in order to test it.

5. **Overall storage of Toolkit.**`app.getPath('userData')/toolkit/presenter/`: Internal PDFs
   as`<id>.pdf` + `library.json` (`{ presentations, folders }`). External presentation formats are
   converted locally using an installed suite, after warning of loss of animations. **Electron-free
   module**`presenterLibrary.ts`(pure CRUD given a path) + IPC wrapper. Never touch the original: it
   is **copy** when importing (Golden rule of the Toolkit).

6. **The server only exists while it is presented.** It starts when the presentation starts and is
   turned off when it is finished.`0.0.0.0`(required for phone) with **6-digit PIN** required for
   non-loopback connections. The app warns that the controller is accessible on the local network
   for the duration.

### 3.1 New IPC area (`presenter:*`)
Mirror of the`preload`/`ipc`Toolkit, e.g.:`presenter:library:get|save`,
`presenter:import:pick|file`, `presenter:import:pptxNotes`, `presenter:pdf:getData`,
`presenter:delete`, `presenter:start` / `presenter:startPresenterMode` / `presenter:stop`,
`presenter:server:info`, `presenter:control`(audience-presenter~server),`presenter:state:update`,
`presenter:timer:sync`, `presenter:cast:show`, `presenter:volume:get|set`.

---

## 4. Design / "improve" (which is NOT literal copy)

- **Icons:** replace the online SVG of the reference
  with`<Icon>`Centralized.`presentation`and`scanText`already exist; add to`ICON_PATHS`(feather
  stroke, unique, validated by the catalog test):`flashlight`, `pencil`/`draw`, `pointer`,
  `magnifier`/`zoom`, `timer`, `monitor`/`cast`, `qr`, `blackScreen`, `nextSlide`etc.
- **Section accent:** amber/bronze Toolkit in the management chrome (coherent with
  Convert/Protect).The audience/presenter windows use a neutral dark theme (convention of
  presentations) but consistent with the Nodus palette.
- **Clear/dark themes:**any new utility used only in dark needs its remap`.light
  .<utility>`in`index.css`(light theme utility test).
- **Space rhythm** and language as i18n keys (Spanish first) as well as other views. Coverage in all
  8 languages.
- **Dropdowns** inside containers`overflow-hidden`→ portal to`body`(landmine de Databases/Convert).
- **Landmine de spinners:** never`animate-spin`in the same element as a`-translate-y-1/2`(center
  goes in a wrapper).

---

## 5. Phases (each: works in the real app + pure logic test)

> **DoD per phase:** the function is verified **in the real app** (not just test) and its
> Electron-free logic has a test that asserts **real content** (not mere)
> file existence), in the style of`scripts/test-toolkit-*.mjs`.

### F0 — Scaffolding + library
- `navigation.ts`: `presenter` → `state:'wip'`.
- `src/views/ToolkitPresenterView.tsx`+ subcomponents (library: import, list, search, order,
  folders, rename, move, delete, thumbnail grid with badges, detail).
- `electron/toolkit/presenter/library.ts`(**Electron-free**: CRUD of`library.json`, name collision,
  move to folder, delete).
- IPC`presenter:library:*`, `presenter:import:pick|file`, `presenter:pdf:getData`,
  `presenter:delete`+ preload.
- Thumbnails: reuse the reference sloth engine (IntersectionOsserver
  + continuance + release), ported to React with pdfjs bundled.
- **Tests:**`test-presenter-library.mjs`(create/move/delete/collision, backward-compat).
- **Check:** import a real PDF and PowerPoint, view them in the thumbnail list and check the
  conversion and notes.

### F1 — Notes by the presenter (core explicitly requested)
- Full-screen note viewer: canvas + texture per slide, miniature sidebar, **undo/round**,
  self-saved, keyboard navigation, resizeable panel.
- **Import notes .pptx**:`electron/toolkit/presenter/pptxNotes.ts`(**Electron-free**,`adm-zip`+
  extractor of`<a:t>`/`<a:br>`by regex, without`xml2js`); validates no slides.
- **Tests:**`test-presenter-notes.mjs`— parsea un`.pptx`real fixture and asserts the text of notes
  per slide (including line breaks) + the undo/round reducer.
- **Check:** type/edit/undo notes; import a`.pptx`real.

### F2 — Audience windows and presenter (without mobile phone)
- Vite Tickets`presenterAudience.html` / `presenterView.html`+ your code (React read, canvas, no
  DB).
- `electron/toolkit/presenter/windows.ts`: creation with **external screen detection**
  (`screen.getAllDisplays`), fullscreen, power-save blocker, life cycle (closing one closes the
  other), pattern`mascotWindow.ts`.
- Secure render (cancellation per generation, DPR, adjustment), next slide, **timer**, **clock**,
  **carousel**, **blackscreen**, **slidezoom**, keyboard navigation, resizeable dividers.
- `electron/toolkit/presenter/presenterState.ts`(**Electron-free**:
  navigator/timer/black-screen/zoom with clamping).
- Audience ↔ presenter IPC bridge through `main`.
- **Tests:**`test-presenter-state.mjs`(slide clamp, timer drift, transitions).
- **Check:** start presentation + presenter mode (with 1 and 2 screens if possible); navigate,
  timer, black, zoom.

### F3 — Annotation tools
- Flashlight, drawing (colors + size), pointer, magnifying magnifier, synchronized
  audience ↔ presenter via IPC. Size controlled by slider/wheel/keyboard shortcuts.
- **Check:** each tool, visually, in both windows.

### F4 — Server + mobile controller (larger new surface area)
- `electron/toolkit/presenter/server.ts`: `http`native +`ws`, `0.0.0.0`, scanned port, **PIN**,
  start/stop tied to present.`/remote`(Entrada
  Vite`presenterRemote.html`constructed),`/api/pdf/:id`(with anti-traversal guard),`/api/qr`,
  `/api/state`, and pdfjs from`node_modules`.
- Vite Entry`presenterRemote.html`+ your code: connect/waiting/command, navigation, notes, points,
  carousel, swipe, **local view mode**, touch tools, **popup sizes**, pinch-zoom, black screen,
  timer, **paisado/fullscreen mode**.
- Server ↔IPC bridge in`main`(translates phone controls to windows).
- New Deps:`ws`, `qrcode`.
- **Tests:**`test-presenter-server.mjs`(state reducer, PIN authentication, route guard`/api/pdf`) —
  Electron-free.
- **Check:** scan the QR with your phone (or open the LAN URL in another tab); browse, view notes,
  tools, timer, local mode.

### F5 — YouTube videos
- Video editor by slide (position/resize with overlay), overlay in audience, **play/pause synchrony
  and seek** between windows and mobile, User-Agent cleaning for YouTube.
- **Check:** insert a video, play/pause/seek from presenter and mobile.

### F6 — MacOS extras + polishing + integration
- **Volume** (script, macOS), **cast/AirPlay** (script, macOS) — gated a Darwin, non-op elegant in
  other OS; dock icon; size indicator; adjustments.
- **Shell integration:** i18n in the 8 languages, light theme rivets, new icons in the catalog,
  entry into`WhatsNewModal`, doc for Nodi (`shared/nodiDocumentation.ts`), commands
  in`CommandPalette`.
- **Verify:** full suite (`npm test`) and build (`test:e2e`) in green.

### F7 — Performance audit (massive PDFs)
Ensure that **ni with a PDF of hundreds of slides** the tool hangs or collapses the computer. It is
audited, measured and corrected.
- **Minatures:** confirm that grid (management), carousel (presenter) and points/carousel (mobile)
  **never render all pages at once** — lazy load by`IntersectionObserver`, limited attendance and
  **freezing of out-of-screen canvas** (out-of-view canvas are set to 0×0 to not retain memory).
  Measure memory with 300–500 slides.
- **Slide render:** cancellation per generation when sailing fast (do not accumulate pdfjs
  tasks),`page.cleanup()`after each render, and a single pdfjs document by window (destroy the
  previous one).
- **Bucle de eventos de`main`:** the server/status serialization should not block the main thread
  (Nodus historical landmine:`main`The broadcast WS and the IPC bridge must be O(no customers), not
  O(no slides).
- **Browsing with keyboard held** (right arrow held) should not glue endless renders:
  coalescence/last-gain.
- **Method of measurement:** count on work with a proxy (no released renders, live canvas,
  round-trips) ** instead of asserting milliseconds of clock** (harness-landmine: parallel tests
  make wall time lie).`scripts/test-presenter-perf.mjs`that, on a synthetic PDF of N=400 pages,
  assevere that opening the library launches ≤ concurrent renders and that navigating 50 times
  leaves ≤ K canvas alive.
- **Verify:** Open a large real PDF, scroll in depth, navigate fast and present; observe memory and
  fluidity (capture, not just numbers).

---

## 6. Known risks and landmines
- **The server exposes the LAN.** Unique surface with security implication: mandatory PIN, off at
  completion, clear warning. The rest of Nodus servers (copilot, MCP) are single-localhost by
  design; this is the exception justified by the mobile controller.
- **Return.**Reuse the cancellation of render per generation, the DPR and the lazy/lot load of the
  reference; the windows do not mount the app or DB.User objective: "don't collapse the computer".
- **Default dark theme** on windows; any dark-only utility needs its remap`.light`.
- **`test:e2e`DO NOT reconstruct** (dist obsolete lies in migrations): remember`npm run build`before
  e2e if you touch something compiled.
- **pdfjs for the phone** must be used from the local server (not CDN) to maintain the offline
  principle.
- **YouTube requires network** (it's not offline) — it's the only function that comes out on the
  Internet; the rest of the tool runs offline.

---

## 7. Deliverable from this phase
This document. Pending your approval (or order/phase range settings) before writing code.
Suggestion: start with **F0 + F1** (library
+ presenter notes, which is what matters most to you) and verify them together before continuing
  with the windows.
