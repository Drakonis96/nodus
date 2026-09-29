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

**No recording has been approved.** Every one is `unresolved` / `pending`.

| Recording | Decision | Covers | Evidence | Reviewer | Date |
| --- | --- | --- | --- | --- | --- |
| *(none yet)* | | | | | |

### What a review has to establish, per file

- **Where the file really comes from.** Moodist's README names two providers' licenses and
  says some sounds are under each; it does not say which file is which. The original page, the
  author and the date of the terms that applied are what has to be found. The only per-file hint
  in the files themselves is the embedded metadata of `restaurant` (a title and an artist tag,
  listed in `PROVENANCE.md#upstream-declaration`): a lead to follow, not evidence of a license.
- **Which license applies to that file**, read from the license text, not from a summary:
  - *Pixabay Content License* — https://pixabay.com/service/license-summary/ and the full
    terms, https://pixabay.com/service/terms/. It is a platform license, not an open
    license: it carries restrictions, some of them about redistributing content in a
    standalone form, and the terms in force when a file was published are what count.
  - *CC0 1.0* — https://creativecommons.org/publicdomain/zero/1.0/. A dedication by the
    rights holder; what has to be shown is that the person who dedicated the file was
    entitled to.
  These two are not interchangeable and this project does not pick between them.
- **Whether the intended use is covered**: the file embedded in a redistributed, open-source
  desktop application (installers on GitHub Releases, updates, the corresponding source), with
  no way for the user to extract it. If the answer needs the rights holder's permission, that
  permission (or the platform's written answer) is the evidence.
- **What the evidence covers.** An authorisation may cover an identified *set* of files; it
  does not need an individual sheet for each, but it must identify them.

### Recording a decision

Add a row above, keep the evidence in this folder or link to it, then set on the catalogue
entry `licenseStatus: 'verified'`, `licenseId` (an SPDX identifier, or a `LicenseRef-` for a
specific permission), `evidenceRefs`, `distributionReview: 'approved'` and `reviewRef` (for
example `legal/drift/REVIEW.md#recordings`). Do not change any other field of the entry.

A pending recording that was reviewed and **rejected** stays `unresolved` / `pending`; write
the reason in the table so the question is not asked again from the beginning.
