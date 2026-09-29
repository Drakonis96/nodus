# Nodus Drift: bundled recordings

This directory is where cleared recordings are prepared before packaging. It is **empty
in Git on purpose**: no audio file is versioned here, and none is published on its own
(not in Git, not as a CI artifact, not in a release outside the installer).

A recording may be placed here only when `shared/driftCatalog.ts` marks it `verified` **and**
its distribution review is `approved`, with the record in `legal/drift/REVIEW.md`. Today no
recording is cleared, so a build ships none of them.

```sh
node scripts/prepare-drift-assets.mjs --list          # what is cleared and what is pending
node scripts/prepare-drift-assets.mjs                 # prepare the cleared ones (checks size and SHA-256)
node scripts/verify-drift-assets.mjs                  # nothing undeclared, uncleared or altered
node scripts/verify-drift-assets.mjs --asar release/mac-arm64/Nodus.app   # the same, on a packaged build
```

See `legal/drift/README.md` for how to reproduce a build from cleared assets.
