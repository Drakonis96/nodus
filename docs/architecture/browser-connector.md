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
