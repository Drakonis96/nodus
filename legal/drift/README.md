# Nodus Drift: audio provenance and licensing

Nodus Drift mixes ambient sounds offline. Its audio comes from exactly two kinds of source,
and the difference between them is the whole of this folder.

| Kind | Where it comes from | Files | Status |
| --- | --- | --- | --- |
| **Generators** | Nodus's own code (`src/components/drift/audio/`): white, pink and brown noise, and five binaural presets | none, they are computed on the machine | first-party (`AGPL-3.0-only`), available |
| **Recordings** | Files catalogued from the active catalogue of [Moodist](https://github.com/remvze/moodist) | one MP3 each (81) | bundled unmodified, under the licenses Moodist declares; distribution approved by the maintainer (`REVIEW.md#recordings`) |

## The licenses of the recordings

The recordings are third-party material. Their licenses are **the ones the Moodist repository
declares for its audio**, which its
[README](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/README.md#license)
states like this (section "License", subsection "Third-Party Assets"):

> Some sounds used in this project are sourced from third-party providers and **are subject to different licenses**:
>
> - Sounds licensed under the **Pixabay Content License**: [Pixabay Content License](https://pixabay.com/service/license-summary/)
> - Sounds licensed under **CC0**: [Creative Commons Zero License](https://creativecommons.org/publicdomain/zero/1.0/)

Two licenses, then: the Pixabay Content License and CC0 1.0. Moodist does not say which one
applies to which file, and Nodus has not verified it: this folder does not choose between them and
does not treat them as interchangeable. Moodist's own license file is its
[`LICENSE`](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/LICENSE)
(MIT, copyright (c) 2023 MAZE, covering Moodist's **code**); its text is kept here as
`MOODIST_LICENSE.txt`. The notice shown to users is in `THIRD_PARTY_NOTICES.md` at the root of the
repository.

Because Moodist only declares, and nobody traced each file to its original page, the catalogue
records the recordings as `licenseStatus: 'declared'`, not `'verified'`, with the identifier
`LicenseRef-Moodist-declared-Pixabay-or-CC0`.

## The rule

A recording is played only if the catalogue (`shared/driftCatalog.ts`) says **both**:

1. `licenseStatus` is `'verified'` (the evidence identifies the license) or `'declared'` (it is the
   license the upstream project declares), with the `licenseId` and the `evidenceRefs` that support it; and
2. `distributionReview: 'approved'`, with the `reviewRef` that records the decision.

Everything else is `unresolved` / `pending`. Such a recording is **listed** in Nodus Tools so the
catalogue is honest about what exists, but it is never bundled, never read by the main process
(`drift:read-audio` refuses it before it touches the disk), never played, and never offered for
download. Nothing in the app exports, saves or shares audio.

Approval is a person's decision and is written in `REVIEW.md`; the code only checks that it is
there. Approving the recordings does not assume that keeping a file inside an installer makes its
distribution authorised: ASAR packaging and private paths are packaging details, not DRM and not
legal evidence. The recordings are never published as independent files (see below).

## What is in this folder

| File | Purpose |
| --- | --- |
| `README.md` | this policy |
| `PROVENANCE.md` | the pinned upstream commit, Moodist's declaration as it states it, what was and was not reused, how each technical field was measured, and the per-file table (upstream path, bytes, SHA-256, duration, crossfade, status) |
| `REVIEW.md` | the decision log: what was decided, on what basis, by whom. Also records why the generators need no third-party review |
| `MOODIST_LICENSE.txt` | the MIT license of Moodist, kept because the catalogue's identifiers, labels and paths were read from its data files. No Moodist source code is used |

The whole folder is copied into every installer (`extraResources: legal`), so the record of what is
bundled and on what basis travels with the app.

## Adding or withdrawing a recording

- **Adding.** Record the decision in `REVIEW.md` (who, when, on what basis, what it covers). Then, in
  `shared/driftCatalog.ts`, set `licenseStatus`, `licenseId`, `evidenceRefs`,
  `distributionReview: 'approved'` and `reviewRef` for that entry, and nothing else.
  `node scripts/prepare-drift-assets.mjs --list` then shows it as approved.
- **Withdrawing.** Set the entry back to `unresolved` / `pending` and add a row to `REVIEW.md`
  saying why. The next build stops shipping it and the interface lists it as pending review.

`scripts/test-drift-catalog.mjs` checks that every approval cites a record that exists in this folder.

## Reproducing a build

```sh
node scripts/prepare-drift-assets.mjs --list              # what is approved, what is pending
node scripts/prepare-drift-assets.mjs                     # put the approved recordings in electron/assets/drift/audio/
#   --source <dir>  read them from a local copy laid out like Moodist's public/sounds
#                   (default: the pinned upstream commit, never `main`)
#   --only <id>     prepare one; a pending id is refused
node scripts/verify-drift-assets.mjs                      # nothing undeclared, uncleared or altered
npm run dist:mac                                          # or dist:win / dist:linux
node scripts/verify-drift-assets.mjs --asar release/mac-arm64/Nodus.app --require-all
```

The packaging hooks do the same on their own: `build/beforePack.cjs` runs the prepare step (so
every installer, including the release builds, carries the recordings) and `build/afterPack.cjs`
runs the verification with `--require-all`, so an app that lost any of them does not become an
installer. Each file is checked against the catalogued size and SHA-256 when it is fetched from the
pinned upstream commit, and again inside the packaged `app.asar`; a file already in place and intact
is kept without being fetched again. `electron/assets/**/*` is already part of the packaged files,
so no packaging configuration is needed.

The audio directory is ignored by Git and only its README is versioned. That is on purpose: the
recordings are fetched at build time from their pinned commit and travel only inside the app. They
are not committed, not a CI artifact and not a release asset of their own.

## Not part of Drift

No remote catalogue, no download for the user, no marketplace, no import of sounds, no export
of audio, no account, no telemetry, and no separate sound repository. Drift's audio is
described neutrally: it makes no therapeutic, medical or cognitive claim.
