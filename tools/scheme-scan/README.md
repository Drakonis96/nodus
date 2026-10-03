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
templates.py export --reagents                  include atom-contributing reagents from the conditions
<rxnmapper venv>/python templates.py map        RXNMapper atom maps, checkpointed (tools/.venv-rxnmapper)
templates.py merge <fallback work directory>    select usable reagent/fallback mappings after validation
templates.py audit                              current atom-map errors and chemistry review flags
templates.py extract                            RDChiral retro templates; R atoms -> [*] unless R is in the reaction centre or leaves
build_index.py [--out DIR] [--templates FILE]    records and validated templates -> known-reactions index
gaps.py --templates FILE [--json REPORT]        structural coverage of the 86 model reaction types
gaps.py --index DIR [--json REPORT]             template and exact-record coverage of an existing index
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

## Reagent-aware side build

Use two work directories to preserve a reagent-free fallback. The example below uses `python`
for the reaction-index environment and `tools/.venv-rxnmapper/bin/python` for mapping; substitute
your installed environment paths. `SCHEME_SCAN_DB` can select another scan database.

```sh
export SCHEME_TEMPLATES_WORK=/path/to/reagent-free
python tools/scheme-scan/templates.py export
tools/.venv-rxnmapper/bin/python tools/scheme-scan/templates.py map

export SCHEME_TEMPLATES_WORK=/path/to/reagent-aware
python tools/scheme-scan/templates.py export --reagents
tools/.venv-rxnmapper/bin/python tools/scheme-scan/templates.py map
python tools/scheme-scan/templates.py merge /path/to/reagent-free
python tools/scheme-scan/templates.py audit
python tools/scheme-scan/templates.py extract
python tools/scheme-scan/build_index.py --out /path/to/side-index --templates /path/to/reagent-aware/templates.json
python tools/scheme-scan/gaps.py --index /path/to/side-index --json /path/to/coverage.json
```

A reagent-aware run also works without `merge`. Atom-contributing reagents, including ionic
fragments, use a 0.3 confidence floor; other mappings use 0.5. Each selected mapping must have
valid, unique, element-consistent source maps for every product heavy atom, and its extracted
template must recover the complete participating reactant multiset from its product. If a new
mapping fails, `merge` tries the fallback. Mechanism heuristics (such as an undeclared shift)
remain review warnings rather than evidence that a reaction is impossible.
Species with no element in the product remain in the recorded conditions but are omitted from
mapping inputs, where they cannot supply product atoms. The exporter trims the largest added
reagents before enforcing both the atom and token limits.

Mapping checkpoints include a hash of the full exported record. Changing `--reagents`, the scan,
or the conditions remaps the changed records; failed mappings are retried. Existing checkpoints
without input hashes are remapped once after upgrading. Re-exporting invalidates derived files,
and merged data is used only while both work directories and the merge outputs still match its
manifest. `audit.json` and `audit.tsv` are reports; extraction validates current inputs afresh.

`gaps.py` measures whether a model product yields its complete organic reactant multiset,
including repeated reactants. It reports exact-record and template hits separately. This is
structural coverage, not proof that every substrate or named reaction mechanism is supported.
Coverage percentages must be regenerated against the user's actual local corpus.

## Optional reagent-name cross-check

`reagents.py review` resolves dictionary gaps with OPSIN/PubChem. `reagents.py crosscheck`
uses DeepSeek and Anthropic, followed by a tie-break for disagreements. These paid stages are
optional; use the same `SCHEME_TEMPLATES_WORK` as the export. Keys are read from
`REAGENT_KEYS_FILE` (JSON entries `deepseek` and `anthropic`) or the existing
`~/.config/nodus-harness/keys.json` configuration.

`reagents.py llm --provider deepseek --cap 2` runs a single-provider pass. The cap stops new batches
once recorded spend reaches that USD amount; the last batch can exceed it. `--cap 0` sends no
requests. Single-model nonparticipant classifications remain unresolved until a second model
agrees; formula-matched structures can be accepted from one source. Partial replies remain
eligible for retry. No generated data or credentials belong in this repository.

## Regression tests

```sh
python -m unittest discover -s tools/scheme-scan/tests -v
```

Tests require Python 3.12, RDKit, RDChiral and requests. They use fixed mapped structures and mock
provider responses, so they need neither RXNMapper downloads nor API keys. CI runs this suite
when the scheme-scan or reaction-index tools change.
