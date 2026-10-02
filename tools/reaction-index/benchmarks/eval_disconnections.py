"""Per-step recall of ORD-backed disconnections on the synthesis test suite.

For every reference step, the lookup for the step's product should propose a precursor set that
contains the expected organic precursors (inorganic reagents ignored), and/or the product should
have a recorded ORD reaction using them. Run: .venv/bin/python benchmarks/eval_disconnections.py
"""
import os
import json, sys, time
sys.path.insert(0, os.environ.get('CHEMISTRY_STUDIO_PYTHON', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'nodus-research-skill-marketplace', 'plugins', 'chemistry-studio', 'python')))
import reactions_worker as W
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')

INDEX = next((a for a in sys.argv[1:] if not a.startswith('--')), 'index-v3')
cases = json.load(open('benchmarks/route_scouting_cases.json'))['cases']
steps = [(c['item'], c['name'], s) for c in cases for s in c['steps']]
organic = lambda smiles: {W._canon(m) for m in smiles if W._is_organic(m)}

USE_STARTS = '--no-starts' not in sys.argv
starts_by_item = {c['item']: c.get('starts', []) for c in cases}
t = time.time()
results = {}
# One lookup per route, with that route's starting materials, as the planner would call it.
for c in cases:
    products = sorted({W._canon(s['product']) for s in c['steps']})
    for r in W._disconnect(INDEX, products, 50, starts_by_item[c['item']] if USE_STARTS else ()):
        results[(c['item'], r['target'])] = r
products = {p for p in results}
elapsed = time.time() - t

ranks, rec_hits, rows = [], 0, []
for item, name, step in steps:
    r = results[(item, W._canon(step['product']))]
    want = organic(step['precursors'])
    rank = next((i + 1 for i, p in enumerate(r['proposals']) if want <= set(p['precursors'].split('.'))), None)
    recorded = any(want <= set((x['reaction'] or '').split('>>')[0].split('.')) for x in (r['madeBy'] or {}).get('reactions', []))
    ranks.append(rank); rec_hits += recorded
    rows.append((item, name, step['product'], rank, recorded, len(r['proposals']), (r['madeBy'] or {}).get('count', 0)))

n = len(steps)
top = lambda k: sum(1 for x in ranks if x and x <= k)
either = sum(1 for (row, x) in zip(rows, ranks) if (x and x <= 10) or row[4])
print(f"[{'with' if USE_STARTS else 'without'} starting materials] ", end='')
print(f'{n} reference steps, {len(products)} distinct products, lookup {elapsed:.1f}s ({elapsed/len(products)*1000:.0f} ms/product)')
print(f'template proposals: top-1 {top(1)}/{n}  top-3 {top(3)}/{n}  top-10 {top(10)}/{n}  top-50 {top(50)}/{n}')
print(f'recorded reaction using the expected precursors: {rec_hits}/{n}')
print(f'either (top-10 proposal or recorded): {either}/{n}')
print('\nmisses (no top-10 proposal and not recorded):')
for (item, name, product, rank, recorded, nprop, made), x in zip(rows, ranks):
    if not ((x and x <= 10) or recorded):
        print(f'  #{item:>2} {name[:24]:24s} {product[:42]:42s} rank {rank} | proposals {nprop} | made in ORD {made}x')
