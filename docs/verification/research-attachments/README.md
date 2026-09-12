# Research chat attachment UI verification

Screenshots of the production React components in the renderer-only harness, with
synthetic document metadata and fixture IPC. No private vault content, credentials
or live model responses are shown.

- `files-estudio-light.png` and `files-genealogy-dark.png`: readable per-file cards,
  opaque surfaces, distinct borders and canonical vault accents in both themes.
- `drop-light.png` and `drop-dark.png`: the file-drop affordance inside Research chat.

Reproduce with `node scripts/verify-research-attachments.mjs` while the visual test
server runs on port 5198. Extraction and provider transports are verified separately
by the attachment and transport test scripts.
