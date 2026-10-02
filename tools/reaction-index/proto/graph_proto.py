"""Prototype: ORD as a bipartite molecule<->reaction graph in CSR arrays, and a backward
search from a target to given starting materials over recorded reactions only."""
import os
import io, sys, time, json, collections, numpy as np, zstandard as z
sys.path.insert(0, os.environ.get('CHEMISTRY_STUDIO_PYTHON', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'nodus-research-skill-marketplace', 'plugins', 'chemistry-studio', 'python')))
import reactions_worker as W
from rdkit import Chem, RDLogger
RDLogger.DisableLog('rdApp.*')

def build(index_dir):
    t = time.time()
    mol_id, mols = {}, []
    def mid(s):
        i = mol_id.get(s)
        if i is None:
            i = mol_id[s] = len(mols); mols.append(s)
        return i
    r_react, r_prod, counts = [], [], []
    exact = {}
    with open(f'{index_dir}/exact.tsv.zst', 'rb') as fh:
        for l in io.TextIOWrapper(z.ZstdDecompressor().stream_reader(fh), encoding='utf-8'):
            k, c, *_ = l.split('\t'); exact[k] = int(c)
    with open(f'{index_dir}/reaction-smiles.tsv.zst', 'rb') as fh:
        for l in io.TextIOWrapper(z.ZstdDecompressor().stream_reader(fh), encoding='utf-8'):
            key, rx = l.rstrip('\n').split('\t', 1)
            r, _, p = rx.partition('>>')
            r_react.append([mid(m) for m in set(r.split('.')) if m])
            r_prod.append([mid(m) for m in set(p.split('.')) if m])
            counts.append(exact.get(key, 1))
    n_m, n_r = len(mols), len(r_react)
    # CSR: molecule -> reactions that produce it (in-edges), reaction -> reactants
    made_by = [[] for _ in range(n_m)]
    for ri, prods in enumerate(r_prod):
        for m in prods: made_by[m].append(ri)
    as_reactant = np.zeros(n_m, dtype=np.int64)
    for ri, reacts in enumerate(r_react):
        for m in reacts: as_reactant[m] += counts[ri]
    print(f'graph: {n_m:,} molecules, {n_r:,} reactions, {sum(map(len, r_react)) + sum(map(len, r_prod)):,} edges, built in {time.time()-t:.0f}s', flush=True)
    heavy = np.array([(Chem.MolFromSmiles(m, sanitize=False).GetNumAtoms() if Chem.MolFromSmiles(m, sanitize=False) else 99) for m in mols], dtype=np.int32)
    print(f'heavy atoms computed in {time.time()-t:.0f}s', flush=True)
    return dict(mols=mols, mol_id=mol_id, made_by=made_by, r_react=r_react, r_prod=r_prod, counts=counts, as_reactant=as_reactant, heavy=heavy)

from rdkit.Chem import AllChem, DataStructs
_fp_cache = {}
def fp(g, m):
    f = _fp_cache.get(m)
    if f is None:
        mol = Chem.MolFromSmiles(g['mols'][m])
        f = _fp_cache[m] = AllChem.GetMorganFingerprintAsBitVect(mol, 2, 2048) if mol else None
    return f

def plausible(g, r, m, resolved):
    # 1. m is one of at most two organic products (not a mixture record)
    organic_products = [x for x in g['r_prod'][r] if W._is_organic(g['mols'][x])]
    if m not in organic_products or len(organic_products) > 2: return False
    # 3. at least one organic reactant that is not a free reagent/solvent
    carriers = [x for x in g['r_react'][r] if W._is_organic(g['mols'][x]) and not resolved(x) or x in START_IDS[0]]
    carriers = [x for x in g['r_react'][r] if W._is_organic(g['mols'][x]) and g['heavy'][x] > 3]
    if not carriers: return False
    # 2. scaffold continuity: some carrier resembles the product
    fm = fp(g, m)
    return any(fp(g, x) is not None and DataStructs.TanimotoSimilarity(fm, fp(g, x)) >= 0.3 for x in carriers)

START_IDS = [set()]
def search(g, target, starts, max_depth=5, hub=500):
    """Best-first backward search over recorded reactions: expand the target's producing
    reactions; a route is complete when every organic reactant is a starting material or a
    hub (very common reagent). Returns the shortest complete route found."""
    canon = lambda s: W._canon(s)
    tid = g['mol_id'].get(canon(target))
    start_ids = {g['mol_id'].get(canon(s)) for s in starts} - {None}
    if tid is None: return None, 'target not in ORD'
    organic = lambda m: W._is_organic(g['mols'][m])
    # Free: a starting material, anything inorganic, or a small common reagent (Ac2O, EtOH, MeI…).
    def resolved(m): return m in start_ids or not organic(m) or (g['heavy'][m] <= 6 and g['as_reactant'][m] >= hub)
    frontier = [(tid,)]  # a partial route is a tuple of molecules still to be made; BFS by depth
    best = {tid: []}
    queue = collections.deque([(tid, 0)])
    parent = {}
    while queue:
        m, d = queue.popleft()
        if d >= max_depth: continue
        # rank the ways to make m: most recorded first
        # A reaction whose reactants already contain m (a salt formation, a purification) does not make it.
        rxs = sorted((r for r in g['made_by'][m] if m not in g['r_react'][r] and plausible(g, r, m, resolved)), key=lambda r: -g['counts'][r])[:30]
        for r in rxs:
            reacts = list(g['r_react'][r])
            todo = [x for x in reacts if not resolved(x)]
            parent.setdefault(m, []).append((r, todo))
            if not todo:
                pass
            for x in todo:
                if x not in best:
                    best[x] = None; queue.append((x, d + 1))
    # solve: can m be made from starting materials? memoised DFS over parent links
    memo = {}
    def solve(m, depth=0, seen=frozenset()):
        if resolved(m) and m != tid: return []
        if depth > max_depth or m in seen: return None
        if m in memo: return memo[m]
        best_route = None
        for r, todo in parent.get(m, []):
            parts = []; ok = True
            for x in todo:
                sub = solve(x, depth + 1, seen | {m})
                if sub is None: ok = False; break
                parts += sub
            if ok:
                route = parts + [r]
                if best_route is None or len(route) < len(best_route) or (len(route) == len(best_route) and g['counts'][r] > g['counts'][best_route[-1]]):
                    best_route = route
        memo[m] = best_route
        return best_route
    route = solve(tid)
    return route, None

if __name__ == '__main__':
    g = build('index-v3')
    cases = json.load(open('benchmarks/route_scouting_cases.json'))['cases']
    STARTS = {1: ['C#C', 'CCBr'], 2: ['c1ccccc1'], 3: ['Oc1ccccc1', 'CC(=O)OC(C)=O'], 4: ['CCOC(=O)CC(=O)OCC', 'CI', 'CCBr'],
              5: ['c1ccccc1'], 6: ['c1ccccc1'], 7: ['CC(C)Cc1ccccc1'], 8: ['COC1CCC(OC)O1', 'OC(=O)CC(O)(CC(=O)O)C(=O)O', 'CN'],
              11: ['Cc1ccccc1'], 12: ['Cc1ccc([N+](=O)[O-])cc1'], 13: ['BrCc1ccccc1', 'O=Cc1ccccc1'], 14: ['O=Cc1ccccc1'],
              15: ['CCOC(=O)CC(C)=O', 'CCCBr'], 16: ['Oc1ccccc1'], 17: ['OC1CCCCC1'], 18: ['c1ccccc1'], 19: ['Cc1ccccc1'],
              20: ['CCOC(=O)CC(=O)OCC', 'BrCCCBr'], 21: ['C=CC=C', 'O=C1OC(=O)C=C1'], 22: ['CCOC(=O)CC(=O)OCC', 'CCBr', 'NC(N)=O'],
              23: ['Cc1ccc([N+](=O)[O-])cc1', 'CCN(CC)CCO'], 24: ['CC(=O)NC(C(=O)OCC)C(=O)OCC', 'ClCc1ccccc1'],
              25: ['CC1(C)C2CCC(C2)C1=C'], 26: ['CC1C(=O)CCCC1=O', 'CC(=O)C=C'], 27: ['C1C=CC=C1']}
    found = 0
    for c in cases:
        t = time.time()
        route, err = search(g, c['target'], STARTS.get(c['item'], []))
        dt = time.time() - t
        if route:
            found += 1
            steps = ' | '.join('.'.join(g['mols'][x] for x in g['r_react'][r] if W._is_organic(g['mols'][x]))[:50] + ' >> ' + '.'.join(g['mols'][x] for x in g['r_prod'][r] if W._is_organic(g['mols'][x]))[:40] + f' ({g["counts"][r]}x)' for r in route)
            print(f"#{c['item']:>2} {c['name'][:28]:28s} ROUTE {len(route)} step(s) {dt*1000:.0f} ms: {steps}")
        else:
            print(f"#{c['item']:>2} {c['name'][:28]:28s} none ({err or 'no recorded path from the starting materials'}) {dt*1000:.0f} ms")
    print(f'\nrecorded-only routes found for {found}/{len(cases)} targets')
