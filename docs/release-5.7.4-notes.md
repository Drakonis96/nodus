# Nodus 5.7.4

## New features

- PDF Presenter lets you control a presentation with the iPhone/iPad app by scanning a QR code on macOS, Windows and Linux. The app receives slides and notes and lets you navigate, use the pointer and control the timer and videos. On Windows and Linux, both devices must be on the same local network. Browser control remains available.

- Text extraction can simplify reaction schemes and figure fragments in new PDFs while preserving body text, captions and references. The option is enabled by default in Settings, Text extraction. Previously processed documents keep their existing extraction.

## Enhancements

- PDF Presenter organizes presentations in folders and subfolders. Search them, move them with the menu or drag them, and choose whether to keep their copies when deleting a folder. Existing tags become folders without losing notes or videos. In presenter mode, you can resize the slide previews and notes area.

- Library orientation summaries are generated with reasoning turned off to avoid extra usage on models that support disabling it.

## Fixes

- Nodus retries once when a response loses its connection before delivering text. Research Chat also retries once when a response reaches the output limit during reasoning.

- Immersion can read pages of originals available in Zotero and include citations that open them. Research Chat distinguishes local sources from actual Zotero MCP queries and reports connection failures or queries that return no readable pages.

- In Study and Teaching calendars, day numbers no longer overlap events in the month view.

- The macOS volume control follows system changes and keeps the latest value when you adjust it rapidly. Browser controls identify the active player more accurately to pause and resume readers with custom audio.

- The Documentary Index waits for pending passage indexing of the same work to finish so its result is not discarded. While text is being prepared, progress shows “Preparing…” instead of “passage 1/0”.
