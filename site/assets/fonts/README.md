# Self-hosted typefaces

The promotional site serves its two typefaces from this directory rather than
from Google Fonts, so that the critical path holds no blocking stylesheet on a
third-party origin and no handshake with a second one before the first word can
be drawn. The bytes are identical: these are the same `latin` variable subsets
the browser used to fetch from `fonts.gstatic.com`.

| File | Family | Axes | Upstream |
| --- | --- | --- | --- |
| `inter-latin.woff2` | Inter | `wght` 400–800 | https://github.com/rsms/inter |
| `fraunces-latin.woff2` | Fraunces | `wght` 600–700, `opsz` 9–144 | https://github.com/undercasetype/Fraunces |

Both are licensed under the SIL Open Font License 1.1; the upstream texts are
`Inter-OFL.txt` and `Fraunces-OFL.txt`. The `@font-face` rules that point here
live in `site/assets/css/nodus.css` and `site/site-header.css`, and every page
preloads the subsets it uses.

To refresh a subset, request the variable family from the Google Fonts CSS API
with a modern browser user agent, take the `latin` block, and save the `woff2`
it points at under the same file name.
