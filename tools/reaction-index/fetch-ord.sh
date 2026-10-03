#!/usr/bin/env bash
# Fetch the pinned Open Reaction Database snapshot used to build the reaction index.
# Usage: ./fetch-ord.sh [dest-dir]   (default ./ord-data)
set -euo pipefail

REV="${ORD_REVISION:-93475c46949f9218e1dfb6624096025135db2add}"
DEST="${1:-./ord-data}"

if command -v hf >/dev/null 2>&1; then
  CLI=hf
elif command -v huggingface-cli >/dev/null 2>&1; then
  CLI=huggingface-cli
else
  echo "Need the Hugging Face CLI:  uv pip install 'huggingface_hub[cli]'" >&2
  exit 1
fi

echo "Downloading open-reaction-database/ord-data @ $REV -> $DEST"
"$CLI" download open-reaction-database/ord-data --repo-type dataset --revision "$REV" --local-dir "$DEST"

python3 - "$DEST" <<'PY'
import glob, os, sys
files = glob.glob(os.path.join(sys.argv[1], 'data', '*', '*.parquet'))
total = sum(os.path.getsize(f) for f in files)
exp = 1_256_526_213
print(f'parquet files: {len(files)}  total bytes: {total}')
print('OK' if total == exp else f'WARNING: expected {exp} bytes — snapshot may have moved')
PY
