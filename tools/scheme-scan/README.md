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
scan.py check [--redo]                          SMILES vs formula vs name (OPSIN, PubChem); merges second opinions
scan.py status
build_index.py [--out DIR]                      confirmed + repaired records -> <userData>/chemistry-schemes/index
```

Everything is checkpointed in `<userData>/chemistry-schemes/scan.sqlite`: every detected item, every
model reply (as it arrives), every name lookup and every record. A stopped run resumes; nothing
already read is sent again. The Gemini key comes from `~/.config/nodus-harness/keys.json`.

Record status: `confirmed` (the SMILES matches the structure its name resolves to), `repaired` (name
and formula agree on another structure, which replaces the SMILES in the index), `generic` (R groups),
`flagged` (unverified; not indexed), `superseded` (replaced by a verified second-opinion reading).
