# Nodus 5.8.0

## New features

- Nodus Scriptor, in Tools, lets you write and organize documents with rich text, tables, images and formulas. Insert sources and ideas with [[, add citations, bibliographies and notes, assemble chapters and export to Word, PDF or LaTeX. It includes version history, fullscreen writing and AI text improvements that you can cancel or undo. Available on Desktop and Server web.

## Enhancements

- Nodus Focus is available in Tools for all nine vaults. Switching vaults does not interrupt the timer. Navigation adapts to each vault and the shared history records time spent in each one. Previous histories are retained and each vault’s shortcuts can be customized.

- PDF Presenter adds an alternative native connection for the mobile app on macOS. Enable it by starting Nodus with NODUS_PRESENTER_TRANSPORT=multipeer. This connection improves the responsiveness of the pointer, highlighting and drawing.

- Synthesis queries with Chemistry Studio can use recorded reaction conditions, schemes from your books and commercial stock lists you import. The report shows sources for each step, material availability and possible incompatibilities between reagents and functional groups. Route search also considers reagents in the schemes. Requires Chemistry Studio 2.5.8 and the corresponding local indexes or lists.

- Idea search in Research Chat is faster when you select many works. It keeps the same selected-corpus boundaries and avoids checking every work separately for each idea.

- The Linux AppImage supports updating Nodus with external AppImageUpdate tools. The release includes the required metadata and a .zsync file. The built-in updater and previous download links remain available.

## Fixes

- Long presentation names no longer widen the PDF Presenter sidebar or hide the options button. Cards fit the available width and retain vertical scrolling.

- The browser keeps the page visible when you open menus and dialogs. When you resize the sidebar, the page adjusts without overlapping navigation.

- PDF extraction and source retrieval no longer lose a completed result when their background process exits. Research Chat can receive it while other intensive tasks are running.

- Turning reasoning off no longer causes errors with models that require a specific setting. Nodus uses the supported opt-out or the lowest permitted level when reasoning is mandatory. It preserves your chosen level when reasoning is enabled.

- Update status appears once in the banner below the header. The banner stays visible during backup and installation, including when you install a postponed update from Settings.
