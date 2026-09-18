<!--
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
# Website screenshots

The windows the home page shows in its vault scenes. They are copies of the
images the README embeds (`docs/screenshots/readme-*.jpg`), because the website
is published from `site/` alone and cannot reach the repository's documentation
folder at runtime.

Never edit these by hand. `npm run site:screenshots` regenerates every file here
from its README original, resized to the 1280x800 the frames show and encoded as
WebP. The list of sources lives in `scripts/build-site-screenshots.mjs`, and
`scripts/test-site-vault-shots.mjs` keeps the page and that list in agreement:
adding a screenshot to a vault scene means adding its source to the list and
running the script.

A screenshot that loses its entry in the list is deleted on the next run, so the
folder never accumulates images nothing points at.
