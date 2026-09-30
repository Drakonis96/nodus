# Nodus Drift: review record

This is the record the catalogue points at. `shared/driftCatalog.ts` cites it as
`evidenceRefs` / `reviewRef`; nothing is cleared for distribution unless it is written down
here. Decisions are made by people. An implementation, a script or a test may *check* that a
record exists; none of them makes the decision or stands in for it.

## First-party generators

Anchor: `#first-party-generators`. Cited by `white-noise`, `pink-noise`, `brown-noise` and the
five `binaural-*` presets.

- **Classification.** These eight sounds are not recordings. They are computed on the
  listener's machine from the code in `src/components/drift/audio/noise.ts` and
  `binaural.ts`, which is part of Nodus and licensed `AGPL-3.0-only` like the rest of the
  repository. No third-party audio is read, copied, resampled or imitated: Moodist's own noise
  and binaural WAV files are deliberately not used.
- **Algorithms.** White noise is a uniform pseudo-random sequence; pink noise is the
  Voss-McCartney method (a published technique, implemented here from its description, with
  16 rows); brown noise is a leaky integrator of white noise; the binaural presets are two
  sine tones. Nothing is copied from another project.
- **Why the fields read `verified` / `approved`.** The catalogue has one gate for every entry,
  and these entries pass it for a simple reason: there is no third-party right to clear. That
  classification was made by whoever implemented the generators and recorded here so it is
  visible and reversible; it is not a legal opinion about any third-party material, and the
  maintainer may revise it.
- **Wording.** Their descriptions state a physical property (the frequency difference between
  the ears, where a noise's energy sits) and make no claim about effects on the listener.

## Recordings

Anchor: `#recordings`. There are 81, all catalogued from Moodist at one pinned commit (see
`PROVENANCE.md`).

| Recording | Decision | Covers | Basis | Decided by | Date |
| --- | --- | --- | --- | --- | --- |
| All 81 recordings of the pinned catalogue | **Approved** for distribution inside Nodus, unmodified | The 81 files listed in `PROVENANCE.md`, at Moodist commit `11c0be2200116a3635880d600fd6953899cc51a3`, each checked against its SHA-256 | The licenses Moodist declares for its audio: the Pixabay Content License and CC0 (`PROVENANCE.md#upstream-declaration`). Which of the two covers which file is not stated upstream and was **not** verified | The maintainer (Drakonis96), at their explicit request | 2026-09-29 |

### What this decision is, and what it is not

- **It is the maintainer's decision**, taken and recorded here. No script or test made it, and
  none can undo it: the gate in `shared/drift.ts` only checks that the record exists and is cited.
- **It rests on Moodist's declaration.** The recordings keep the licenses Moodist declares for
  them, exactly as it declares them, and `THIRD_PARTY_NOTICES.md` says so and links Moodist's
  README and license file. Nodus adds no license and no restriction to them.
- **The status is `declared`, not `verified`.** Nobody traced each file to its original page,
  author and terms. The catalogue entries carry `licenseStatus: 'declared'` and
  `licenseId: 'LicenseRef-Moodist-declared-Pixabay-or-CC0'` so that this is visible in the data
  and not only in this file.
- **It does not choose between the two licenses**, treat them as interchangeable, or assume that
  keeping a file inside an installer makes its distribution authorised: ASAR packaging is a
  packaging detail, not DRM and not legal evidence. The Pixabay Content License is a platform
  license, not an open license, and it carries restrictions (among them on distributing content
  on its own, which is why the recordings are never published as independent files: they are
  not in Git, not a CI artifact and not a release asset, only part of the app, and the app has no
  way to export them).
- **It can be revisited per file.** If a file turns out to be under terms that do not allow this
  use, set that entry back to `unresolved` / `pending` and add a row below saying why; the
  build then stops shipping it and the interface lists it as pending review.

### Reviewing a single recording

For a recording whose license is established from the file itself, and not only from Moodist's
general declaration:

- **Where the file really comes from.** The original page, the author and the date of the terms
  that applied are what has to be found. The only per-file hint in the files themselves is the
  embedded metadata of `restaurant` (a title and an artist tag, listed in
  `PROVENANCE.md#upstream-declaration`): a lead to follow, not evidence of a license.
- **Which license applies to that file**, read from the license text and not from a summary:
  - *Pixabay Content License*: https://pixabay.com/service/license-summary/ and the full terms,
    https://pixabay.com/service/terms/. The terms in force when a file was published are what count.
  - *CC0 1.0*: https://creativecommons.org/publicdomain/zero/1.0/. A dedication by the rights
    holder; what has to be shown is that the person who dedicated the file was entitled to.
- **Whether the intended use is covered**: the file embedded in a redistributed, open-source
  desktop application (installers on GitHub Releases, updates, the corresponding source), with no
  way for the user to extract it. If the answer needs the rights holder's permission, that
  permission is the evidence.

### Recording a decision

Add a row above and keep the evidence in this folder or link to it. On the catalogue entry set
`licenseStatus` to `'verified'` (the license was identified from the evidence) or `'declared'` (it is
the one the upstream project declares), `licenseId` (an SPDX identifier, or a `LicenseRef-`),
`evidenceRefs`, `distributionReview: 'approved'` and `reviewRef` (for example
`legal/drift/REVIEW.md#recordings`). Do not change any other field of the entry.

A recording that was reviewed and **rejected** stays `unresolved` / `pending`; write the reason in
the table so the question is not asked again from the beginning.
