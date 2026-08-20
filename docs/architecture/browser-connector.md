# Browser connector architecture

Nodus Connector is a user-initiated bibliographic capture path for Chrome. It follows the useful
separation found in Zotero Connector—page detection in the browser and durable library operations in
the desktop application—without copying Zotero code or requiring the Zotero client.

The extension's injected collector gathers bounded metadata standards and candidate links. A pure
detector normalizes them to Nodus' Zotero-compatible item types. The popup is the review boundary:
no item is created until the user confirms the type, collection, tags, files, and optional snapshot.

The desktop application listens only on `127.0.0.1`. Browser endpoints accept Chrome or Firefox
extension origins, require a dedicated constant-time-checked bearer token after pairing, reject
other origins, and never expose the Zotero plugin token. Initial pairing raises a native Nodus dialog.
Revocation rotates the secret and disconnects all paired browser profiles.

Nodus first attempts to retrieve public attachment URLs itself, with DNS and redirect checks that
block private-network requests and a 64 MiB limit. If a publisher requires the current browser
session, the extension may request optional permission for that exact origin and upload the selected
file to the loopback endpoint. All files enter the existing attachment service, which preserves the
original and queues clean-reader extraction. HTML snapshots are bounded and stripped of scripts,
frames, embedded objects, forms, inline event handlers, and `srcdoc` before transfer.

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
