import sys, time, glob, os
from collections import Counter
from ord_schema.datasets import load_dataset

BIG = os.path.join(os.environ.get('ORD_DATA_DIR', 'ord-data'), 'data', '11', 'ord_dataset-1158e351757f315b93cbcbe7bc55f38e.parquet')
N_GROUPS = int(sys.argv[1]) if len(sys.argv) > 1 else 10  # ~1000 reactions per row group

view = load_dataset(BIG)
print("row groups:", view.num_row_groups, "reactions:", len(view.reactions))

id_types = Counter()
mapped = 0
total = 0
sample = None
t0 = time.time()
for g in range(min(N_GROUPS, view.num_row_groups)):
    for rid, rxn in view.iter_reactions(row_group=g):
        total += 1
        cx = None
        for ident in rxn.identifiers:
            id_types[ident.type] += 1
            if ident.type in (ident.REACTION_CXSMILES, ident.REACTION_SMILES) and ident.is_mapped:
                cx = ident.value
        if cx:
            mapped += 1
            if sample is None:
                sample = (rid, cx)
        if total >= 20000:
            break
    if total >= 20000:
        break
dt = time.time() - t0
print(f"scanned {total} reactions in {dt:.1f}s ({total/max(dt,1e-9):.0f}/s)")
print("mapped REACTION_CXSMILES:", mapped, f"({100*mapped/max(total,1):.1f}%)")
print("identifier type counts:", id_types.most_common())
print("sample:", sample)

# Time RDChiral template extraction
from rdchiral.template_extractor import extract_from_reaction
import random
recs = []
for g in range(min(2, view.num_row_groups)):
    for rid, rxn in view.iter_reactions(row_group=g):
        cx = None
        for ident in rxn.identifiers:
            if ident.type in (ident.REACTION_CXSMILES, ident.REACTION_SMILES) and ident.is_mapped:
                cx = ident.value
        if not cx:
            continue
        parts = cx.split('>')
        if len(parts) == 1:  # "reactants>>products"
            reac, _, prod = cx.partition('>>')
            reag = ''
        else:
            reac, reag, prod = (parts + ['', ''])[:3]
        recs.append({'reactants': reac, 'reagents': reag, 'products': prod})
        if len(recs) >= 3000:
            break
    if len(recs) >= 3000:
        break
t0 = time.time()
ok = 0
for r in recs:
    try:
        out = extract_from_reaction(r)
        if out and out.get('reaction_smarts'):
            ok += 1
    except Exception:
        pass
dt = time.time() - t0
print(f"RDChiral: {ok}/{len(recs)} templates in {dt:.1f}s ({len(recs)/max(dt,1e-9):.0f}/s)")
