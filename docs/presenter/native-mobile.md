# Native Presenter companion

The iOS/iPadOS companion is maintained in the owner's private `nodus-presenter-mobile` repository. Nodus remains independent of that private repository: the native helper and its complete Swift protocol source are included here.

The presenter QR panel offers **Web browser** (existing HTTP/WebSocket, PIN flow unchanged) and **iPhone–iPad app** (macOS Network.framework helper with peer-to-peer enabled). A single main-process reducer owns presentation state; the main process also owns the timer, including audience-only mode. Native commands pass `nativeAction` validation and bounded duplicate rejection before reaching that reducer. The peer receives authoritative state after authentication and a bounded replay of the current slide's overlay on reconnect.

The native QR contains a fresh 256-bit session PSK. It is returned only through the existing privileged presenter IPC, never a LAN endpoint, process argument or log. The QR does not contain a Wi-Fi password or change network configuration. Both devices need Wi-Fi enabled and local network permission; the OS can use Apple peer-to-peer Wi-Fi when infrastructure disappears. `includePeerToPeer` enables the route; it does not prove which route is currently active. Internet-hosted video remains dependent on internet connectivity.

The helper runs only during a presentation. It advertises `_nodus-presenter._tcp`, accepts TLS-PSK AES-GCM connections for control/assets, frames JSON with a bounded 32-bit length, serves only the current PDF, sends preview JPEGs and streams the PDF in 64 KiB chunks with resume offsets and SHA-256 verification. At most 16 peers and 12 pending previews are accepted. Terminating the presentation rotates away the key, stops the advertisement and closes the helper. A missing/failed helper does not interrupt the audience or web remote.

## Build and verify

`npm run build:presenter-native` builds and ad-hoc signs the local helper on macOS. Development/build hooks invoke it; packaging builds the selected arm64/x64 slice, carries it as an extra resource and verifies its architecture before release signing. The source uses macOS 11 APIs and no downloaded Swift libraries. Windows/Linux omit the helper and retain the web remote.

- `node scripts/test-presenter-native.mjs`: bounded commands, duplicate rejection and actual loopback TLS authentication, wrong-key rejection, preview and complete PDF/SHA-256.
- `node scripts/test-presenter-hub.mjs`: native/web/window fanout, authoritative timer in audience-only mode, stop and QR choices.
- `node scripts/test-presenter-state.mjs`: shared reducer.
- `node scripts/test-presenter-server.mjs`: unchanged browser PIN and path guards.
- `npm run typecheck:ci`: renderer and Electron types.

The native test disables Bonjour advertising by setting `NODUS_PRESENTER_TEST_LOOPBACK=1` on its child helper. It verifies the transport without granting local-network discovery permission and **does not validate AWDL, an iPhone session, router-off recovery or radio coexistence**. Those require a Mac and physical iPhone/iPad, with the integrated Nodus build.

Before release, pair via QR on devices, turn the room router off while keeping device Wi-Fi on, navigate/paint during the change, verify accurate green/red state, confirm PDF/notes remain readable, background/foreground the phone, repeat with browser and native controls together, and stop/restart Presenter to ensure the old QR no longer authenticates. These physical checks remain pending until hardware is available.
