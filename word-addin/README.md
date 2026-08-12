# Nodus writing integrations for Word and LibreOffice

Nodus provides one writing assistant and reference workflow in Microsoft Word and LibreOffice Writer. The pane exposes three compact views:

- **Ideas** relates the current paragraph to the active Nodus vault.
- **Passages** searches indexed full text and inserts quotations or AI-assisted prose.
- **References** searches the Nodus global library and manages live citations and bibliographies.

The pane is a client of the local Nodus HTTPS service (`https://localhost:4320` by default). Library records, document text, and citation requests remain on the user's computer unless the user explicitly invokes a configured remote AI model.

## Reference workflow

The References view supports:

- search by title, creator, year, DOI, ISBN, ISSN, PMID, arXiv identifier, tag, or citation key;
- multiple sources in one citation, with drag-free move controls for deterministic ordering;
- a locator type and value, prefix, suffix, arbitrary text between sources, omit-author, and bibliography exclusion for every source;
- in-text citations, footnotes, and endnotes;
- document-level style, locale, placement, and automatic-update preferences;
- cited and bibliography-only sources;
- insert/update bibliography, refresh all references, and unlink to ordinary document text;
- embedded bibliographic snapshots, so a collaborator can refresh a citation even when the original Nodus item is not installed on their computer.

Nodus formats the complete document in one citeproc state. This preserves CSL sorting, disambiguation, and note-style behavior across citation clusters instead of formatting every citation independently.

### Word document model

Word citations and bibliographies are `ADDIN` fields. The user can edit a citation by placing the cursor inside its field. Refresh replaces field results without discarding the embedded source data; Unlink keeps the visible result and removes only the live field.

The installed manifest creates a persistent **Nodus** ribbon tab for every document. It contains shortcuts for the pane, Add/Edit Citation, Add/Edit Bibliography, Refresh, Preferences, and Unlink Citations. The ribbon and pane use the stylized Nodus mark from `word-addin/assets/`, not a generic letter.

### LibreOffice document model

Writer uses bookmarks plus removable document properties to represent the same live fields. Bibliographic metadata and document preferences travel with the Writer document. Citation HTML is converted to native character formatting, including emphasis, bold, superscript, and subscript. All UNO document mutations are marshalled to LibreOffice's main thread; networking remains on background threads.

## Citation styles and licensing

Nodus ships its documented offline styles and can use CSL styles imported by the user from Zotero or from local `.csl` files. A local Zotero import copies the user's installed style into `nodus-library/citation-styles`; it does not make that style part of the Nodus distribution. Nodus preserves the style's rights and license metadata and warns when a custom style does not declare a license. Official CSL project styles are distributed under their stated CC BY-SA 3.0 terms.

This allows personal styles such as institutional or journal styles to work in Word and Writer without Nodus claiming or relicensing them. Redistribution still depends on the license of each individual style.

## Installation

### Microsoft Word

1. In Nodus, open **Settings → Integrations → Writing integrations**.
2. Generate and trust the local certificate once.
3. Enable the local writing service.
4. Choose **Install/update in Word**.
5. Quit Word completely and reopen it. Word reads the sideload catalog at startup, and the **Nodus** tab remains available for subsequent documents.

The installer writes a versioned manifest atomically to Word's per-user sideload directory. It never removes individual entries from Office's shared add-in cache.

### LibreOffice Writer

1. In the same Nodus settings section, choose **Install/update for LibreOffice**.
2. Open a Writer document.
3. Run **Tools → Macros → Run Macro → My Macros → nodus_copilot → start_nodus_copilot**.
4. Keep Nodus running while using the pane.

The macro is installed in the current user's LibreOffice Python scripts directory. It reads the local bridge token and certificate from `~/.nodus-copilot-certs/bridge.json`.

## Architecture

- `manifest.xml` defines the persistent Word ribbon and task-pane commands.
- `taskpane.html`, `taskpane.css`, and `taskpane.js` provide Ideas and Passages.
- `references.js` provides the shared reference composer and Word live-field adapter.
- `scripts/nodus_copilot.py` provides the LibreOffice bridge and Writer live-field adapter.
- `electron/copilot/server.ts` serves the pane and authenticated local API.
- `electron/library/libraryCslStyles.ts` formats whole-document citations and bibliographies.

## Verification

The automated suites use disposable libraries and documents only:

```bash
node scripts/test-office-references.mjs
node scripts/test-copilot-addin.mjs
node scripts/test-libreoffice-copilot.mjs
npm run test:e2e:office-references
```

They cover CSL locators and prefixes/suffixes, multiple citations, omit-author, bibliography exclusions and extras, rich output, embedded-source fallback, library search, the Word manifest and live-field contract, the complete LibreOffice command bridge, and main-thread UNO dispatch.
