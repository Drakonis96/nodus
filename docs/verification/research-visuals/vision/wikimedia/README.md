# Live Wikimedia daguerreotype test

Real Commons Action API search, five real thumbnails, production restricted intake, real Gemini 3.1 Flash-Lite selected from the local chat setting. One paid review, 6,191 input tokens and 227 output tokens reported by the provider. All five candidates were relevant; the framed portrait ranked first. No mocked scores.

This test exposed and fixed two integration gaps: missing identifying User-Agent on public image downloads, and missing documented vision support for Gemini 3.1 Flash-Lite (still requires its exact live catalog entry).

Open index.html for the gallery, review.json for the receipt and search.json for the original API response. Duplicate views of Boulevard du Temple remain relevant but should be deduplicated by a future source Skill. Visual review cannot authenticate an object's photographic process or prove restoration history.

The opt-in scripts/verify-vision-wikimedia.mjs uses only the configured chat provider's encrypted credential in an isolated temporary profile; no credential is printed or retained in these artifacts. No Wikimedia Marketplace Skill was installed or created.
