"""Multi-step: does the hybrid search complete a route from the case's starting materials, and how
many of the reference steps does its best route contain?"""
import os
import json, sys, time
sys.path.insert(0, os.environ.get('CHEMISTRY_STUDIO_PYTHON', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'nodus-research-skill-marketplace', 'plugins', 'chemistry-studio', 'python')))
import reactions_worker as W
from rdkit import RDLogger
RDLogger.DisableLog('rdApp.*')
cases = json.load(open('benchmarks/route_scouting_cases.json'))['cases']
complete = matched_total = ref_total = 0
t0 = time.time()
for c in cases:
    t = time.time()
    budget = max(len(c['steps']) + 1, 2)
    res = W._search_routes('index-v3', c['target'], c.get('starts', []), max_steps=budget)
    ref = {(W._canon(s['product']), frozenset(W._canon(m) for m in s['precursors'] if W._is_organic(m))) for s in c['steps']}
    best = res['routes'][0] if res['routes'] else None
    got = 0
    if best:
        complete += 1
        steps = {(s['product'], frozenset(s['precursors'])) for s in best['steps']}
        got = sum(1 for p, pre in ref if any(p == q and pre <= qs for q, qs in steps))
    matched_total += got; ref_total += len(ref)
    route = ' | '.join(f"{'.'.join(s['precursors'])[:40]}>>{s['product'][:24]} [{s['kind'][0]}]" for s in best['steps']) if best else '-'
    print(f"#{c['item']:>2} {c['name'][:22]:22s} {'ROUTE' if best else 'none '} {got}/{len(ref)} ref steps, {res['expanded']:>2} exp, {time.time()-t:5.1f}s  {route[:170]}", flush=True)
print(f"\ncomplete routes from the given starting materials: {complete}/{len(cases)}; reference steps recovered: {matched_total}/{ref_total}; {time.time()-t0:.0f}s total")
