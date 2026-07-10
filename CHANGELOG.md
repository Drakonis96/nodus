# Changelog

## 1.4.3 — 2026-07-10

### Added

- New "Image design" dialog for Inmersión and Deep Research: preview the image,
  switch style, edit the scene description, and regenerate or delete it in one place.
- Five photographic and realistic decorative styles — realistic photograph,
  vintage photograph, black & white, cinematic, and oil painting (twelve in total).
- An editable scene description that rebuilds the prompt for the chosen style while
  preserving the "no text" safeguards.

### Changed

- Decorative images now render larger and more polished. The inline action buttons
  are replaced by a single unobtrusive "Design" pill that opens the design dialog,
  keeping the Inmersión and Deep Research views uncluttered.
- The "immersion ready" screen is now part of the main immersion view instead of a
  separate standalone page.

## 1.4.2 — 2026-07-10

### Added

- Optional single decorative images for Inmersión and Deep Research, generated
  only after the main content has been saved.
- Seven centralized styles, optimized reusable images and lazy list thumbnails.
- Independent image-provider/model settings for Google, the official OpenAI
  Images API, and live image-output OpenRouter models.
- Published input/output/per-generation pricing, unavailable-price states,
  real-time search, and provider-safe sorting.
- Persistent image audit/status metadata with manual retry, delete, and confirmed
  regeneration controls.
- A common full-detail modal for every textual and semantic search result type.

### Changed

- Search results no longer navigate to the graph automatically; graph/location
  actions are secondary modal actions.
- The search disclosure chevron rotates without simultaneous vertical movement.
- Full encrypted backups now include decorative image records and BLOBs.

### Reliability

- Image errors, timeouts, missing credit, or provider failures never roll back or
  block an Inmersión or Deep Research report.
- No automatic image retries or duplicate generation of an existing ready image.
- Stale and deleted in-flight attempts cannot overwrite the current image state.
- Existing saved content without images remains fully compatible.

### Known limitations

- Google-generated images include mandatory SynthID provenance.
- OpenAI GPT Image access can require organization verification.
- OpenRouter pricing units vary by endpoint, so price ordering is scoped within
  provider groups and unavailable values are not estimated.
- Decorative image BLOBs are included in full backups but not the lightweight
  cross-vault sync package.
