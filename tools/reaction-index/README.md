# Reaction index tools

Builds and updates the local Open Reaction Database (ORD) index that Chemistry Studio reads for
known-reaction precedent, similar reactions and retro disconnections. The app reads the index
directory named by `NODUS_REACTION_INDEX_DIR`; nothing here runs inside the app.

The data is ORD's (`open-reaction-database/ord-data`, CC BY-SA 4.0; Kearnes et al., JACS 2021,
doi:10.1021/jacs.1c09820). The index (≈2 GB) and the data (≈1.2 GB) are not kept in git.

## Setup

    uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt

## Build from scratch (~3.5 h)

    ./fetch-ord.sh ord-data                       # the pinned snapshot from Hugging Face
    .venv/bin/python build_index.py --root ord-data --out index-v3

Extraction checkpoints are content-addressed (file SHA-256 + row group), so a rebuild re-extracts
only new data. `progress.py` / `reaction_progress.py` report a running build.

## Keep it current

    .venv/bin/python update_ord.py --check        # exit 0 current, 10 update available
    .venv/bin/python update_ord.py --apply        # close Nodus first
    .venv/bin/python update_ord.py --rollback     # restore the previous index

`--check` compares the latest Hugging Face revision's parquet files (LFS SHA-256) with the local
copy, and notes when ORD's GitHub `main` (what the website shows) has data newer than the Hugging
Face copy. `--apply` downloads only new and changed files, rebuilds into a clone of the current
index (reusing every checkpoint), checks the new manifest and swaps it in, keeping `<index>.prev`.
`--apply --force` rebuilds even when nothing changed (after an extractor change).
Paths: `--index` / `NODUS_REACTION_INDEX_DIR`, `--data` / `ORD_DATA_DIR`.

## Other files

- `template_fast.py` — reaction-template extraction used by the builder; `validate_templates.py` checks it.
- `query.py`, `probe.py` — ad-hoc lookups against an index or the raw data.
- `benchmarks/` — disconnection, route and three-source evaluations; `proto/` — an early graph prototype.
