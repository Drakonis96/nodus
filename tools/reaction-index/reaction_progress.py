"""Reactions processed so far by a running build, for the to-do panel.

Every finished row group leaves <out>/parts/<part_name>.json; the Parquet footer says how many
reactions each row group holds. The name -> row count map is built once (footers only, no data
read) and cached next to this script, so each call just lists the parts directory.

    python reaction_progress.py <out-dir> [--root ord-data]  ->  "<done> <total> <groups_done>"
"""

import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.rowgroup-reactions.json')


def row_counts(root):
    if os.path.exists(CACHE):
        cached = json.load(open(CACHE))
        if cached.get('root') == root:
            return cached['counts']
    import pyarrow.parquet as pq
    from build_index import part_name
    counts = {}
    for path in sorted(glob.glob(os.path.join(root, 'data', '*', '*.parquet'))):
        meta = pq.ParquetFile(path).metadata
        for g in range(meta.num_row_groups):
            counts[part_name(path, g)] = meta.row_group(g).num_rows
    json.dump({'root': root, 'counts': counts}, open(CACHE, 'w'))
    return counts


def main():
    out = sys.argv[1]
    root = sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else os.environ.get('ORD_DATA_DIR', 'ord-data')
    counts = row_counts(root)
    finished = [name[:-5] for name in os.listdir(os.path.join(out, 'parts')) if name.endswith('.json')]
    done = sum(counts.get(name, 0) for name in finished)
    print(done, sum(counts.values()), len(finished))


if __name__ == '__main__':
    main()
