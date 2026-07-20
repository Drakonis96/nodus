# Legal bundle

`PRIVACY.md` at the repository root is the product privacy policy.
`RGPD_DEPLOYMENT_CHECKLIST.md` records the controller-side actions that a local
application cannot perform on behalf of a user, school or institution. The privacy
policy is copied into the packaged app as `legal/PRIVACY.md`.

`THIRD_PARTY_NOTICES.md` at the repository root contains the human-readable
attributions. `LGPL_COMPLIANCE.md` documents the replace/rebuild path and exact
source references for LGPL libraries.

Immediately before electron-builder packages Nodus,
`scripts/generate-third-party-licenses.mjs`:

1. inventories installed production packages from `package-lock.json`;
2. aggregates their distributed LICENSE/COPYING/NOTICE files;
3. obtains large upstream notices listed in `remote-notices.json`;
4. verifies every remote byte against its pinned SHA-256 digest; and
5. copies Electron's MIT license and Chromium notice collection.

The result is written to the ignored `legal/generated/` directory and copied
unchanged into every installer. Generation fails closed if a package lacks a
usable license or a remote notice does not match its expected digest.

Run:

```sh
npm run licenses:verify
```

Do not hand-edit `legal/generated/`; update the lockfile, the manifest or an
upstream override and regenerate it.
