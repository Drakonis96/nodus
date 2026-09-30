# Nodus Drift: bundled recordings

This directory is where the recordings are prepared before packaging. It is **empty in Git on
purpose**: no audio file is versioned here, and none is published on its own (not in Git, not as
a CI artifact, not as a release asset outside the installer). They travel only inside the app.

`node scripts/prepare-drift-assets.mjs` puts the 81 recordings here. Each is fetched from its
pinned upstream commit (Moodist, `11c0be2200116a3635880d600fd6953899cc51a3`) and checked against its
catalogued size and SHA-256 before it is written; a file already here and intact is kept. The
packaging hook (`build/beforePack.cjs`) runs the same script, so an installer always has them.

A recording is prepared only when `shared/driftCatalog.ts` says its license is `verified` or
`declared` **and** its distribution review is `approved`, with the record in
`legal/drift/REVIEW.md`. Their licenses are the ones the Moodist repository declares for its audio
(the Pixabay Content License and CC0); see `THIRD_PARTY_NOTICES.md` and `legal/drift/README.md`.

```sh
node scripts/prepare-drift-assets.mjs --list          # what is approved and what is pending
node scripts/prepare-drift-assets.mjs                 # prepare the approved ones (checks size and SHA-256)
node scripts/verify-drift-assets.mjs                  # nothing undeclared, uncleared or altered
node scripts/verify-drift-assets.mjs --asar release/mac-arm64/Nodus.app --require-all   # the same, on a packaged build
```

Without this step Nodus Drift still runs: the generators need no files, and a recording whose file
is missing is listed as unavailable.
