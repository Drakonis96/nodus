# Native Presenter companion

The iOS/iPadOS companion is maintained in the owner's private `nodus-presenter-mobile` repository. Nodus remains independent of that private repository: the native helper and its complete Swift protocol source are included here.

The presenter QR panel offers **Web browser** (existing HTTP/WebSocket, PIN flow unchanged) and **iPhone–iPad app**. macOS retains its existing Network.framework helper with peer-to-peer enabled. Windows/Linux use a separate native-controller LAN listener. A single main-process reducer owns presentation state; the main process also owns the timer, including audience-only mode. Native commands pass `nativeAction` validation and bounded duplicate rejection before reaching that reducer. The peer receives authoritative state after authentication and a bounded replay of the current slide's overlay on reconnect.

The Mac native QR contains a fresh 256-bit session PSK. It is returned only through the existing privileged presenter IPC, never a LAN endpoint, process argument or log. The QR does not contain a Wi-Fi password or change network configuration. Both devices need Wi-Fi enabled and local network permission; the OS can use Apple peer-to-peer Wi-Fi when infrastructure disappears. `includePeerToPeer` enables the route; it does not prove which route is currently active. Internet-hosted video remains dependent on internet connectivity.

The helper runs only during a presentation. It advertises `_nodus-presenter._tcp`, accepts TLS-PSK AES-GCM connections for control/assets, frames JSON with a bounded 32-bit length, serves only the current PDF, sends preview JPEGs and streams the PDF in 64 KiB chunks with resume offsets and SHA-256 verification. At most 16 peers and 12 pending previews are accepted. Terminating the presentation rotates away the key, stops the advertisement and closes the helper. A missing/failed helper does not interrupt the audience or web remote.

The native app's video playback and Mac-volume controls appear only on the projected slide when it has a video; private reading and slides without video hide them, including in the app's settings. Demo playback is simulated. In real sessions the audience owns the YouTube player and the volume command adjusts macOS output volume. The player establishes the YouTube widget channel before sending commands, retains the latest playback/seek intent during loading, and discards it when leaving the slide. Messages are restricted to the active YouTube frame and origin. A single Electron request-header listener preserves both YouTube embedding identification and OpenStreetMap identification.

## Build and verify

`npm run build:presenter-native` builds and ad-hoc signs the local helper on macOS. Development/build hooks invoke it; packaging builds the selected arm64/x64 slice, carries it as an extra resource and verifies its architecture before release signing. The source uses macOS 11 APIs and no downloaded Swift libraries. Windows/Linux omit the Mac helper, start the separate native-controller LAN listener and retain the web remote.

- `node scripts/test-presenter-native.mjs`: bounded commands, duplicate rejection and actual loopback TLS authentication, wrong-key rejection, preview and complete PDF/SHA-256.
- `node scripts/test-presenter-hub.mjs`: native/web/window fanout, authoritative timer in audience-only mode, stop and QR choices.
- `node scripts/test-presenter-state.mjs`: shared reducer.
- `node scripts/test-presenter-server.mjs`: unchanged browser PIN and path guards.
- `node --test scripts/test-presenter-youtube.mjs scripts/test-tutorial-videos.mjs`: video readiness, queued playback/seek, slide-change cleanup and the combined media request-header rules.
- `npm run typecheck:ci`: renderer and Electron types.

The native test disables Bonjour advertising by setting `NODUS_PRESENTER_TEST_LOOPBACK=1` on its child helper. It verifies the transport without granting local-network discovery permission and **does not validate AWDL, an iPhone session, router-off recovery or radio coexistence**. Those require a Mac and physical iPhone/iPad, with the integrated Nodus build.

Before release, pair via QR on devices, turn the room router off while keeping device Wi-Fi on, navigate/paint during the change, verify accurate green/red state, confirm PDF/notes remain readable, background/foreground the phone, repeat with browser and native controls together, and stop/restart Presenter to ensure the old QR no longer authenticates. These physical checks remain pending until hardware is available.

## Windows and Linux

`lan.ts` runs only on Windows/Linux, only while presenting. The iOS app selects it automatically from a version-2 QR; it remains a SwiftUI/PDFKit controller with the same interface and commands. Both devices must be reachable on the same local network. Internet is unnecessary for PDF, notes and controls; external video still needs its provider. A PC can use Ethernet while the phone uses Wi-Fi on that network. Firewalls or isolated guest Wi-Fi can prevent pairing; no firewall settings or network configuration are changed automatically.

The QR includes up to eight IPv4 endpoints, an ephemeral 256-bit authentication key, the session ID and the SHA-256 fingerprint of a fresh P-256 certificate. TLS 1.3 verifies that exact certificate before either channel sends its `hello` key. There is no global certificate exception, HTTP token endpoint or persisted production certificate/key. The app races authenticated endpoints so a stale VPN address cannot delay the physical interface. Reconnection reuses the QR while the presentation is active; ending it closes the listener and starting another rotates certificate, session and key.

Control/assets keep the existing bounded framed JSON protocol, separate channels, command validation/deduplication, authoritative state, heartbeat and overlay replay. PDF transfer resumes in 64 KiB chunks and verifies SHA-256. PDF.js and the already-shipped native canvas generate JPEG previews lazily, with bounded dimensions, a serial render queue and an eight-entry cache. Only the current presentation file is accessible. TLS/hello deadlines and connection/frame/preview bounds apply before clients can supply commands.

Windows/Linux volume adjusts the audience’s YouTube player, retaining the latest value during loading and after changing slides. The iOS label is **Video volume**. macOS retains **Mac volume** and its existing system-volume bridge. Playback/volume remain hidden without a video or during private reading. The browser remains available alongside the app.

The Mac helper, its TLS-PSK parameters, version-1 QR and Bonjour discovery are unchanged. The new listener is never started on Mac. Electron/BoringSSL does not expose the AES-GCM PSK suite used by the Mac helper, so the additional transport uses pinned TLS 1.3 instead.

### Verification

- `npm run test:presenter-lan`: real TLS 1.3 in Electron; wrong key and oversized frame rejection; state/tools/timer/video/volume; overlay replay; JPEG rendering; complete/resumed PDF with SHA-256; end-of-session and rotated credentials.
- `node scripts/test-presenter-hub.mjs`: Mac/Windows/Linux routing, shared reducer, web/native fanout, timer, volume, lifecycle and QR choices.
- `.github/workflows/presenter-lan.yml`: runs the same Electron TLS/native-canvas suite on Windows and Ubuntu. This is separate from the full existing Mac CI.
- Existing Mac helper test still checks real TLS-PSK, wrong-key rejection, JPEG and PDF/SHA-256.

For connected iOS QA, run the local-only `scripts/fixtures/presenter-lan-server.mjs` under Electron-as-Node, passing an ignored private output directory. It writes test QR credentials to `pairing.txt` (0600), never stdout. The Debug Simulator app accepts `--simulator-pair-file <path>`; this flag is absent from device/Release builds. The fixture includes an unreachable first address to exercise authenticated endpoint racing, and writes a credential-free `state.json` for verifying audience state against private phone navigation.

Real Windows/Linux machine and physical iPhone LAN/firewall/guest-network testing is still required in addition to CI and Simulator checks. The direct Mac route’s existing physical AWDL checks remain pending independently.
