"""Recall vs template-set size: load templates.tsv at lower cutoffs (no rebuild) and re-run the benchmark."""
import json, sys, time, subprocess
sys.path.insert(0, '/Users/avijit/Code/NodusResearch/marketplace/plugins/chemistry-studio/python')
import reactions_worker as W
from rdkit import Chem, RDLogger
RDLogger.DisableLog('rdApp.*')
import os
os.environ.setdefault('PYTHONWARNINGS', 'ignore')

def load(min_count, min_count_fast):
    rows = []
    for line in W._zst_lines('index-v3/templates.tsv.zst'):
        count, rd, fast, ids, smarts = line.split('\t', 4)
        count, rd, fast = int(count), int(rd), int(fast)
        if (rd > 0 and count >= min_count) or (fast > 0 and rd == 0 and count >= min_count_fast):
            q = Chem.MolFromSmarts(smarts.split('>>')[0])
            if q is not None:
                rows.append((count, rd, smarts, q))
    rows.sort(key=lambda r: -r[0])
    return rows

cases = json.load(open('benchmarks/route_scouting_cases.json'))['cases']
organic = lambda smiles: {W._canon(m) for m in smiles if W._is_organic(m)}
for min_count, min_fast in [(5, 10**9), (2, 10**9), (1, 10**9), (2, 20), (2, 5)]:
    W._retro_cache['index-v3'] = load(min_count, min_fast)
    n_t = len(W._retro_cache['index-v3'])
    t = time.time(); hit10 = hit_any = n = either = 0
    for c in cases:
        res = {r['target']: r for r in W._disconnect('index-v3', sorted({W._canon(s['product']) for s in c['steps']}), 50, c.get('starts', []))}
        for s in c['steps']:
            n += 1
            r = res[W._canon(s['product'])]; want = organic(s['precursors'])
            rank = next((i + 1 for i, p in enumerate(r['proposals']) if want <= set(p['precursors'].split('.'))), None)
            rec = any(want <= set((x['reaction'] or '').split('>>')[0].split('.')) for x in (r['madeBy'] or {}).get('reactions', []))
            hit10 += bool(rank and rank <= 10); hit_any += bool(rank); either += bool((rank and rank <= 10) or rec)
    dt = time.time() - t
    print(f'RDChiral count>={min_count}, fast count>={min_fast if min_fast < 10**9 else "off"}: {n_t:>6} templates | top-10 {hit10}/{n}  any-rank {hit_any}/{n}  either {either}/{n} | {dt/n*1000:.0f} ms/step', flush=True)
