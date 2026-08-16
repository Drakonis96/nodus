<!--
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only
-->
# Blog images

Cover images and in-post images live here. A post references them relatively
from `site/blog/`, so a file called `example.png` in this folder is written
`media/example.png` in `posts.json` (`cover`) or in the Markdown body
(`![Alt text](media/example.png)`).

Covers are shown cropped to 16:9 as the card thumbnail on the blog index, and
uncropped above the post itself, so a wide landscape image works best.
