# Nodus Drift: audio provenance and licensing

Nodus Drift mixes ambient sounds offline. Its audio comes from exactly two kinds of source,
and the difference between them is the whole of this folder.

| Kind | Where it comes from | Files | Status today |
| --- | --- | --- | --- |
| **Generators** | Nodus's own code (`src/components/drift/audio/`): white, pink and brown noise, and five binaural presets | none, they are computed on the machine | first-party, available |
| **Recordings** | Files catalogued from the active catalogue of [Moodist](https://github.com/remvze/moodist) | one MP3 each (81) | **pending review: none is bundled** |

## The rule

A recording is played only if the catalogue (`shared/driftCatalog.ts`) says **both**:

1. `licenseStatus: 'verified'`, with the `licenseId` and the `evidenceRefs` that support it; and
2. `distributionReview: 'approved'`, with the `reviewRef` that records the decision.

Everything else is `unresolved` / `pending`. An unresolved recording is **listed** in Nodus
Tools so the catalogue is honest about what exists, but it is never bundled, never read by
the main process (`drift:read-audio` refuses it before it touches the disk), never played,
and never offered for download. Nothing in the app exports, saves or shares audio.

The evidence has to come from the file, not from the repository around it. Moodist's code is
MIT, but its README says that its audio comes from third-party providers under **different**
licenses (it names the Pixabay Content License and CC0) without saying which applies to which
file. That is not enough to mark any single recording `verified`, so none is. This folder does
not declare a choice between those licenses, does not treat them as interchangeable, and does
not assume that keeping a file inside an installer or hiding an export button makes its
distribution authorised: ASAR packaging and private paths are packaging details, not DRM and
not legal evidence.

## What is in this folder

| File | Purpose |
| --- | --- |
| `README.md` | this policy |
| `PROVENANCE.md` | the pinned upstream commit, what was and was not reused, how each technical field was measured, and the per-file table (upstream path, bytes, SHA-256, duration, crossfade, status) |
| `REVIEW.md` | the decision log: what was reviewed, on what evidence, by whom. Also records why the generators need no third-party review |
| `MOODIST_LICENSE.txt` | the MIT license of Moodist, kept because the catalogue's identifiers, labels and paths were read from its data files. No Moodist source code is used |

The whole folder is copied into every installer (`extraResources: legal`), so the record of
why a recording is or is not there travels with the app.

## Adding a recording

1. Establish, for that file, its source, its author and its license, and keep the evidence.
2. Record the decision in `REVIEW.md` (who, when, on what evidence, what it covers).
3. In `shared/driftCatalog.ts` set `licenseStatus: 'verified'`, `licenseId`, `evidenceRefs`,
   `distributionReview: 'approved'` and `reviewRef` for that entry, and nothing else.
4. `node scripts/prepare-drift-assets.mjs --list` now shows it as approved.

`node scripts/test-drift-catalog.mjs` will need its "no recording is cleared" expectations
updated in the same change: that test failing is the intended prompt to look at the record
again.

## Reproducing a build from cleared assets

```sh
node scripts/prepare-drift-assets.mjs --list              # what is cleared, what is pending
node scripts/prepare-drift-assets.mjs                     # copy the cleared ones into electron/assets/drift/audio/
#   --source <dir>  read them from a local copy laid out like Moodist's public/sounds
#                   (default: the pinned upstream commit, never `main`)
#   --only <id>     prepare one; a pending id is refused
node scripts/verify-drift-assets.mjs                      # nothing undeclared, uncleared or altered
npm run dist:mac                                          # or dist:win / dist:linux
node scripts/verify-drift-assets.mjs --asar release/mac-arm64/Nodus.app
```

Each file is checked against the catalogued size and SHA-256 before it is written, and again
inside the packaged `app.asar`. `electron/assets/**/*` is already part of the packaged files,
so no packaging configuration is needed. The audio directory is ignored by Git; only its
README is versioned. **The release workflows do not run the prepare step today** because no
recording is cleared: the day the first one is, the release job must run it before packaging,
or that build will (correctly) ship without it.

## Not part of Drift

No remote catalogue, no download for the user, no marketplace, no import of sounds, no export
of audio, no account, no telemetry, and no separate sound repository. Drift's audio is
described neutrally: it makes no therapeutic, medical or cognitive claim.
