# Browser connector architecture

Nodus Connector is a user-initiated bibliographic capture path for Chrome. It follows the useful
separation found in Zotero Connector—page detection in the browser and durable library operations in
the desktop application—without copying Zotero code or requiring the Zotero client.

The extension's injected collector gathers bounded metadata standards and candidate links. A pure
detector normalizes them to Nodus' Zotero-compatible item types. The popup is the review boundary:
no item is created until the user confirms the type, collection, tags, files, and optional snapshot.

The desktop application listens only on `127.0.0.1`. Browser endpoints accept only browser
extension origins, require a dedicated constant-time-checked bearer token after pairing, reject
web origins, and never expose the Zotero plugin token. The signed Chrome Web Store build is
identified by extension id `ilcclajjhofhieoljdjmikmfopfbamej`. Pairing is still an explicit native
Nodus confirmation, including for that official id: localhost HTTP headers can be forged by a
local process, while the native confirmation binds the issued credential to the exact canonical
extension origin. This also provides the supported path for unpacked/development builds.

Nodus stores one approved extension origin alongside the connector token. Every capability
request (catalogue, capture, save, open, and attachment upload) must present both the token and
that exact origin; another installed extension cannot reuse the token or take over the pairing.
Health remains available before pairing so the extension can discover Nodus, while `/pair` is the
only route that can establish the binding. Any later caller that asks `/pair` to reveal the secret
without already proving possession of it raises native confirmation again; the compatibility
origin marker is never sufficient to recover a credential silently. Revocation rotates the secret,
clears the approved origin, and requires a fresh native confirmation.

Nodus first attempts to retrieve public attachment URLs itself, with DNS and redirect checks that
block private-network requests and a 64 MiB limit. If a publisher requires the current browser
session, the extension may request optional permission for that exact origin and upload the selected
file to the loopback endpoint. Newly granted site access is revoked after transfer; an on-demand
Manifest V3 service worker owns long transfers so popup closure does not cancel them. All files
enter the existing attachment service, which preserves the original and queues clean-reader
extraction. HTML snapshots are bounded reader-style documents built from the main article text,
without executable code, styles, forms, frames or remote media.

Server integration tests always use a temporary application profile, backup root, and synthetic
Library. The connector has no code path that writes to a Zotero database or source vault.

## Chrome and Nodus Browser parity contract

Nodus Connector has two trusted user interfaces over the same capture product:

- `browser-extension/popup.*` is the Chrome adapter. It must discover, pair and authenticate with
  the desktop application because it runs outside Nodus.
- `src/components/browser/BrowserCaptureModal.tsx` is the adapter built into Nodus Browser and is
  opened by the N icon in its trusted toolbar. It does not pair over a port and is not an extension.

Those connection mechanics are the only intended functional difference. Document-type choices,
bylines and glyphs come from `browser-extension/lib/presentation.js`; collection hierarchy/search
and tag normalization come from `browser-extension/lib/collections.js`; detection and durable
Library writes already share the detector and `electron/browser-connector/libraryCapture.ts`.

**Maintenance rule:** any Connector capability, field, state or review-flow change must be applied
to both adapters in the same pull request. Do not copy the shared behavior back into either UI.
Extend a pure shared module or the common capture pipeline first, then update the two thin adapters.
`scripts/test-browser-connector.mjs` enforces the shared imports and the integrated toolbar entry so
a future one-sided change fails CI rather than silently breaking parity.

The integrated dialog belongs to the trusted Nodus renderer. Arbitrary pages remain in their
sandboxed Browser WebContents, receive no Nodus preload API and cannot open, populate or submit the
dialog. Page metadata is still treated as hostile and passes through the same bounded sanitizer in
the main process before preview and again before saving.
