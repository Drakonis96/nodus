# Scheme scan

Reads the reaction schemes in textbooks with a vision model and turns them into checked reaction
records, then into a known-reactions index in the ORD index format (so the Chemistry Studio
worker's `known-reactions` and `propose-disconnections` read it unchanged).

```
scan.py add <zotero key> <pdf> --title T       detect schemes (free): layout classifier crops + whole raster pages
scan.py add-epub <zotero key> <epub> --title T  one item per embedded image
scan.py supplement [titles]                     extra crops for drawing clusters with few text labels
scan.py read --cap 150 --workers 16             Gemini Flash (thinking low), stops at the $ cap
scan.py recheck --thinking medium --tag v2-med --books k1,k2 --cap N   second opinion on flagged crops
scan.py recheck --thinking low --tag v3 --every --books k                 re-read a whole book with prompt v3 (arrow type)
scan.py check [--redo]                          SMILES vs formula vs name (OPSIN, PubChem); merges second opinions
scan.py status
templates.py export                             generic + verified reactions to atom-map (generic R -> CH3 model reactions)
<rxnmapper venv>/python templates.py map        RXNMapper atom maps, checkpointed (tools/.venv-rxnmapper)
templates.py extract                            RDChiral retro templates; R atoms -> [*] unless R is in the reaction centre or leaves
build_index.py [--out DIR]                      confirmed + repaired records, retro templates and their sources -> <userData>/chemistry-schemes/index
```

Everything is checkpointed in `<userData>/chemistry-schemes/scan.sqlite`: every detected item, every
model reply (as it arrives), every name lookup and every record. A stopped run resumes; nothing
already read is sent again. The Gemini key comes from `GEMINI_API_KEY` (or `GEMINI_KEYS_FILE`, a JSON file with a `gemini` entry).

Record status: `confirmed` (the SMILES matches the structure its name resolves to), `repaired` (name
and formula agree on another structure, which replaces the SMILES in the index), `generic` (R groups),
`flagged` (unverified; not indexed), `superseded` (replaced by a verified second-opinion reading),
`retro` (a retrosynthesis arrow, target => precursors: reported by prompt v3 or labelled as a
disconnection such as "C–N" or "FGI"; never indexed, since read forwards it is reversed).

Prompt v3 adds the arrow type; where a v3 reading exists (Warren, a retrosynthesis book) it is the
item's primary reading. The index also holds `retro-templates.tsv.zst` (read by
`propose-disconnections`) and `template-sources.json` (template -> the schemes it came from, for
citations). All of it is derived from the user's own books and stays local; only the code is shared.
