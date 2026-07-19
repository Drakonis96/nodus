# IDprotector v0.4.1 parity fixture

This directory is a test-only frozen snapshot from IDprotector commit
`9f523158de3d597bdfe6bf35a6319c5f45c5c70c` (version 0.4.1).

- `stego.js` and `watermark.js` are unmodified copies of the original modules.
- `app.js` contains only the exact GDPR URL and supervisory-authority literals
  exercised by the parity suite.
- Production code does not import these files. They exist so CI can execute the
  bidirectional compatibility and pixel-golden checks without requiring a
  sibling checkout of IDprotector.
- Set `IDPROTECTOR_ROOT` to an IDprotector checkout to run the same tests against
  that checkout instead of this snapshot.

IDprotector is MIT-licensed. Its copyright and full license text are preserved
in the repository-level `THIRD_PARTY_NOTICES.md`.
