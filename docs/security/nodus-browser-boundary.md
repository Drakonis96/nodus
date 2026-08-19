# Nodus Browser security boundary

Last reviewed: 2026-08-19. Runtime: Electron 43.4.0 / Chromium 150.

## Threat model

Every HTTP(S) document, iframe, redirect, popup, PDF, download, authentication
page and service worker loaded by Nodus Browser is untrusted. The working
assumption is stronger than normal web isolation: an attacker may eventually
obtain arbitrary code execution in a Browser renderer. A renderer compromise
must still not provide access to the Nodus renderer, Node.js, application IPC,
vaults, databases, the Library, files, AI credentials/providers, settings,
backups, sync, updater controls or internal protocols.

The boundary is:

```text
untrusted site -> sandboxed Chromium renderer -> dedicated Browser session
                                                   X
                 trusted Nodus renderer/main process/application services
```

The review follows Electron's current [security checklist](https://www.electronjs.org/docs/latest/tutorial/security),
[sandbox guidance](https://www.electronjs.org/docs/latest/tutorial/sandbox/),
[context-isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation),
and [session permission APIs](https://www.electronjs.org/docs/latest/api/session).
Electron 43 is supported until 2027-01-05 according to the official
[release schedule](https://releases.electronjs.org/schedule).

## Enforced boundary

1. **WebPreferences.** Every tab and controlled popup is created by the same
   factory with `nodeIntegration: false`, `nodeIntegrationInWorker: false`,
   `nodeIntegrationInSubFrames: false`, `contextIsolation: true`, `sandbox:
   true`, `webSecurity: true`, `allowRunningInsecureContent: false`,
   `webviewTag: false`, `experimentalFeatures: false`, `devTools: false` and
   `navigateOnDragDrop: false`. `plugins: true` is retained only for Chromium's
   sandboxed built-in PDF viewer. Production pages cannot open DevTools.

2. **Preload and IPC.** The Browser preload exposes no `contextBridge` object.
   Its two internal collection/media channels are listeners in an isolated
   world, registered on the exact `WebContents.ipc`, and accept only the exact
   tab main frame. No generic channel name is page-controlled. All legacy Nodus
   handlers registered through the common IPC wrapper reject senders belonging
   to the Browser session before parsing their arguments. The remaining raw
   `ipcMain.on` handlers have the same rejection. Browser toolbar actions accept
   only the exact trusted Nodus main `WebContents` and its exact main frame.

3. **Session isolation.** All tabs use `persist:nodus-browser`; none uses
   `session.defaultSession`. Cookies, HTTP cache, localStorage, IndexedDB,
   CacheStorage, service workers and logins persist for Browser use but are not
   shared with the trusted application. Browser restart deliberately preserves
   this partition.

4. **URL and protocol policy.** Main-frame navigation permits HTTP, HTTPS and
   only `about:blank`; subframes additionally permit `blob:` and `data:`.
   Resource requests use an explicit HTTP/HTTPS/WS/WSS/blob/data allowlist plus
   Chromium's exact built-in PDF-viewer extension ID. `file:`, `javascript:`,
   `shell:`, unknown schemes and `nodus-image:`, `nodus-archive:` and
   `nodus-library:` fail closed at the omnibox, navigation, frame navigation,
   redirect and session request layers. The internal protocol handlers remain
   registered only on the default session. No arbitrary protocol is passed to
   `shell.openExternal()`.

5. **Windows and popups.** `setWindowOpenHandler` always returns `deny`. An
   allowed HTTP(S) target is converted to a normal Nodus Browser tab created by
   the hardened tab factory; all other targets are discarded. A website cannot
   create a `BrowserWindow` or supply WebPreferences.

6. **Permissions.** Both `setPermissionRequestHandler` and
   `setPermissionCheckHandler` are installed. Fullscreen, media key systems and
   sanitized clipboard writes are allowed. Camera/microphone (`media`) require
   a trusted Nodus prompt and may be remembered by origin. Geolocation,
   notifications, clipboard read, display capture, filesystem access, MIDI,
   USB, Serial, HID, Bluetooth, idle detection, window management, speaker
   selection and storage-access permissions are denied. Unknown names deny;
   `constructor`, `prototype` and `__proto__` cannot traverse object prototypes.
   Stored preferences cannot override a hard denial. Display capture, device
   permission, USB classes, pairing and every USB/HID/Serial/Bluetooth chooser
   have explicit refusal handlers or a disabled source provider.

7. **TLS.** Chromium owns certificate validation. Nodus never calls
   `preventDefault()` or `callback(true)` for certificate failures and presents
   no “proceed anyway” action.

8. **Downloads.** Downloads are initiated by Chromium but managed by trusted
   main-process code. Site-provided filenames are reduced to a bounded basename;
   a hard byte limit is enforced during transfer as well as from declared
   length. Files are never opened automatically. “Add to Library” is an
   explicit trusted-UI action and passes the completed trusted path to the
   existing import pipeline; the site never sees a destination or filesystem
   API.

9. **Page capture and hostile data.** Add to Library, Save page/selection and Ask
   Nodi begin only in trusted Nodus UI. Main revalidates the capture against the
   current active tab and bounds strings, creators, identifiers, tags,
   attachments, URLs, MIME/role values and snapshot size. Snapshots remove
   scripts, embedded documents, forms, inline event handlers, styles and remote
   resource attributes. Temporary capture/upload files use asynchronous I/O, so
   a pathological page cannot force large synchronous writes on Electron's main
   loop.

10. **AI and privacy.** The Browser may collect bounded local page context for
    the Nodus UI. It is not sent to OpenAI, Anthropic, Gemini, OpenRouter or any
    other provider automatically. Only the user's explicit Ask Nodi action can
    transfer bounded page text (120,000 characters) or a bounded selection
    (20,000 characters) into the chat flow.

11. **Crashes.** `render-process-gone`, `unresponsive`, `responsive`,
    `did-fail-load` and `destroyed` are handled per tab. A renderer crash clears
    pending collection/media state, hides the native view and shows trusted
    “Page crashed” UI. Reload creates a fresh renderer while the main Nodus
    renderer and application remain live. Unexpected WebContents destruction
    enters the shared tab destructor.

12. **Lifecycle and resources.** The tab factory enforces a hard tab cap (12).
    Background tabs are detached, background throttling remains enabled and
    media state has bounded lifecycle timers. Close, Browser restart, main-window
    close, normal quit, final `will-quit`, platform exit and updater shutdown all
    use the same idempotent Browser subsystem cleanup and per-tab destructor.
    It stops loads, clears listeners/collectors/media, closes every Browser
    WebContents and cancels live downloads/prompts. No vault, database, Library,
    setting or persistent Browser storage is part of this cleanup.

13. **Nodus Bookmarks.** Bookmark storage is global Nodus application data in
    `browser-bookmarks.json`, never Chromium site data. Research Atlas and Nodus
    Bookmarks are synthetic tab identifiers rendered inside the trusted Nodus
    React renderer; no custom protocol is registered and no remote document
    receives the bookmark tree. The native untrusted WebContents remains blank
    and hidden for these tabs. Create, edit, move, import, export and delete are
    exact-main-frame IPC actions. URLs are restricted to HTTP(S), favicon bytes
    are fetched by the isolated Browser session with type/time/size bounds and
    cached as raster data URLs, and imported text/hierarchy is normalized with
    count/depth/size limits. Clearing Chromium data or destroying Browser
    renderers cannot touch bookmarks. Normal Nodus backup/restore includes the
    file as a global auxiliary data file.

## Threat-to-control table

| Threat | Attack path | Mitigation | Test |
|---|---|---|---|
| Website reaches filesystem/vault | Node, `file:`, internal protocol fetch/iframe | No Node/bridge; dedicated session; scheme/resource allowlists | hostile Electron fixture; navigation/security tests |
| Website invokes Nodus IPC | Discovered channel or compromised renderer | Browser-session rejection on all privileged IPC; exact main-frame check on Browser UI IPC | IPC static boundary tests; hostile fixture proves no bridge |
| Malicious popup gets defaults | `window.open` with attacker-controlled features | Always deny native popup; rebuild allowed target with hardened tab factory | popup E2E inspects every WebPreference |
| Redirect reaches custom protocol | HTTP 302, script/meta/frame navigation | `will-navigate`, `will-frame-navigate`, `will-redirect`, request allowlist | HTTP-to-`nodus-library:` E2E; policy matrix |
| Permission-name prototype bypass | `constructor`, `prototype`, `__proto__` | own-property lookup; total policy; unknown deny | permission unit tests against Electron 43 unions |
| Hardware or screen access | permission and chooser APIs | both standard handlers plus display/device/chooser refusals | permission wiring/unit tests; hostile display-capture check |
| Browser crash takes down Nodus | renderer crash/unresponsive tab | separate sandboxed renderer; controlled crash state and recovery | forced-renderer-crash E2E with unchanged main renderer |
| Old renderers leak | close/restart/quit/updater paths | one shared destructor and lifecycle cleanup | close, repeated restart and updater-shutdown E2E |
| Huge hostile page freezes main | oversized DOM/text/metadata/attachments | bounded IPC data, validation, async temporary-file I/O | sanitizer/size assertions and capture tests |
| Browser session contaminates Nodus | shared cookies/storage/protocol registry | persistent dedicated partition, default session untouched | two-way cookie/storage isolation E2E |
| Website reads or changes bookmarks | preload/IPC/custom start-page protocol | no page bridge; exact trusted sender; start pages live only in trusted React; no registered scheme | bookmark boundary/static tests |
| Malformed bookmark import corrupts hierarchy | cycles, huge files, unsafe URLs, duplicate IDs | bounded parsing, normalization, cycle/depth checks, preview and non-overwriting merge | bookmark model/import tests |

## Remaining unavoidable risks

- Chromium/Electron sandbox escapes remain possible. This architecture limits a
  normal renderer compromise; it cannot replace timely Electron updates or OS
  sandbox/security patches. Electron 43 must be upgraded before its support
  deadline.
- HTTP remains supported for local/research systems and can be modified in
  transit. HTTPS should be used whenever available; invalid HTTPS still fails
  closed.
- Site cookies and storage intentionally persist inside the Browser partition.
  A compromised site can access data its own origin is entitled to, just as in
  other Chromium browsers, but cannot cross into the Nodus default session.
- Service-worker registrations persist with the session. Closing/restarting the
  Browser destroys all live clients; Electron exposes inspection but no
  stop-all API that preserves registrations. Clearing Browser site data remains
  the user-controlled way to remove them.
- Electron 43 does not resolve `getDisplayMedia()` cleanly when both permission
  handlers deny it and the application supplies no display source: the page's
  promise may remain pending. No stream or system picker is granted, and the
  wait is confined to the untrusted renderer, but this is a Chromium/Electron
  behavior Nodus cannot turn into a clean rejection without supplying a capture
  source (which would violate the policy).
- Chromium's PDF viewer and the tiny isolated-world Browser preload are code in
  an untrusted WebContents. Neither receives Nodus capabilities; the preload
  communicates only through exact per-WebContents, main-frame-scoped channels.
- Electron fuses are package-wide rather than Browser-only. Nodus's trusted
  renderer currently loads from `file:` and other application functionality
  still uses Electron/Node capabilities, so changing package fuses requires a
  separate main-application migration and does not substitute for this runtime
  Browser boundary.

## Proof suite

- `scripts/test-browser-security.mjs`: immutable source-level invariants.
- `scripts/test-browser-permissions.mjs`: exhaustive policy against the shipped
  Electron type unions, hostile names and stored-decision behavior.
- `scripts/test-browser-nav-policy.mjs`: navigation and resource-scheme matrix.
- `scripts/test-browser-tabs.mjs`: destructor, crash and exit-path lifecycle.
- `scripts/test-browser-downloads.mjs`: classification, byte caps and filenames.
- `scripts/e2e-browser.mjs`: real Electron hostile page, popup, redirect,
  permission, session isolation, renderer crash, close, restart and updater
  shutdown.
- `scripts/test-browser-bookmarks.mjs`: hierarchy, ordering, cycle prevention,
  duplicate handling, search, URL/favicon sanitization, JSON/HTML import/export,
  1,000-item behavior, backup inclusion and trusted-IPC boundary.
