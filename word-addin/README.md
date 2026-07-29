# Nodus Copilot — Word writing plugin (beta)

> **Official bet since v1.7.0**: installed directly from the packaged app
> (Adjustments → Integrations), without development tools. The panel follows the
> Nodus interface language (English/Spanish).

A Microsoft Word add-on (task pane) that, while you write, shows in the side panel how the current
**paragraph** relates to your Nodus library, allows you to search for ideas/authors/works **and
quotationable passages from the full text**, see each idea with its connections and ask the IA
configured in Nodus to insert a paraphrased idea with author-year quote. On the **selection** can
also **rewrite**, **enlarge** or write a **contraargument** cited, and insert any result **in the
body or as a footnote**.

It doesn't reimplement anything from Nodus' brain: the add-in is just a second face. The analysis
(embeddings + typical relationships) is done by your Nodus app, which serves the add-in and a small
JSON API ** at the same local HTTPS source** (`https://localhost:4320`), so there are no CORS or
mixed content problems.

## How it works
- `taskpane.html/.js/.css` — Side panel in flat JS (Office.js from CDN).
  - When you move the cursor (selection event, with *debounce*) you read the current paragraph, send
    it to `POST /api/relations` and paint the typical relationships. Cache per paragraph and cancel
    obsolete requests (win the last).
  - **Insert (Author, year)** → insert the author-year into the cursor.
  - **Cite in Zotero** → opens Zotero with the selected item (`zotero://select`, released by Nodus)
    and copies a precise search string to the clipboard to paste into Zotero's "Add Citation" (where
    you post pages/prefixes/suffixes).
- `manifest.xml` — points to `https://localhost:4320/addin/taskpane.html`.
- The server lives in `electron/copilot/` within Nodus.

## Start-up (once)
1. **Certified**: in Nodus → Settings → "Write Copilot (Word)" press *Certified Generate*. Nodus
   generates its own local CA (10 years) and a certificate sheet for `https://localhost` (1 year,
   renewed silently before expiry), and trust the CA for your user with a system dialog (`security`
   in macOS, `Import-Certificate` on Windows). Only once per computer; if you already had the
   `office-addin-dev-certs` certificate for a development installation, it is reused as it is.
2. **Activate** the toggle "Activate copilot for Word". You'll see `Activo:
   https://localhost:4320/addin/taskpane.html`.
3. Press **Install/update in Word**. Nodus copies a manifest with the current port to the Word local
   catalog (`…/com.microsoft.Word/Data/Documents/wef` in macOS) and updates its version, which is
   the supported way for Office to collect a changed manifest. **Nodus does not touch the Office**
   plugin cache: deleting loose files from it is documented as something that can stop loading *
   all* plugins.
4. Close Word at all (`Cmd+Q`) and open it again — Word only reads that catalog when booting. Plugin
   appears in **Start → Add-ons**; when opening the first time it adds its own tab **Nodus** with
   the **Nodus Copilot** button.

> **If it does not appear in the plugin list**: it is not the manifest. Office for
> Mac drags a web plugin regression from version 16.100, and there is a
> open ([office-js#6597](https://github.com/OfficeDev/office-js/issues/6597))
> which affects ** only work accounts/studies**: the catalogue is left empty and
> does not record any plugins, either local folder or store.
> recognize that there are no store accessories that you did have either.
> Complete cache emptying documented by Microsoft does not solve it; try with
> a personal account does distinguish the case.

## Daily use
- Open Nodus (with copilot enabled) and Word. In the **Nodus** tab, open the **Nodus Copilot**
  panel.
- Write. When paused, the panel displays the related ideas of the paragraph.
- Use the search engine to filter by idea, author, or indexed work. With the **Ideas / Passages**
  switch to the semantic search on the **full text**: each passage brings its quote and a **Insert
  quote** button (sticks it in quotes with the author-year).
- Opens **Details** to see sources and connections; **Opens in Nodus** opens the full development of
  the idea in section **Ideas**; ** Inserting with AI** adds a quoted paraphrase to the text.
- With selected text, the **Selection** row offers **Rewrite** (replaces selection), **Enlarge**
  (continues text) and **Rebate** (reforms a counterargument cited from ideas that contradict or
  nuance it).
- The selector ** Insert into** sends the inserts and counterarguments to the **body** or to a
  **footnote** (requires Word with WordApi 1.5; if not, the option is disabled). *Rewrite* always
  works on the body.

## Requirements
- Nodus running with a **embeddings** provider configured (the library must be indexed). Without
  embeddings the panel indicates it.
- Desktop Word, Zotero and Zotero plugin for Word.

## Notes/limits
- Office has no "key" event: the trigger is the **change of cursor** (paragraph level) + button
  *Analyze paragraph*.
- No Better BibTeX by default, so the bridge to Zotero uses `zotero://select`
  + search string to clipboard (the actual quote is put in the dialogue of Zotero, which preserves
    the living fields of Zotero — the right thing for a thesis).
