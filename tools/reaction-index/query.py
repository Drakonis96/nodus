"""Query a built reaction index: exact precedent, similar reactions, product lookup.

Prototype of what the core `nodus:reactions` service will expose. Loads the zstd +
faiss artifacts from a build directory.
"""

import glob, hashlib, json, os, sys, time
import numpy as np
import zstandard as zstd
import faiss
from rdkit import Chem, RDLogger
from drfp import DrfpEncoder

RDLogger.DisableLog('rdApp.*')


def _canon(smiles):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    for a in mol.GetAtoms():
        a.SetAtomMapNum(0)
    return Chem.MolToSmiles(mol)


def _side(side):
    cans = []
    for frag in side.split('.'):
        c = _canon(frag)
        if c and c not in ('[H]', '[H+]'):
            cans.append(c)
    return '.'.join(sorted(cans)) if cans else None


def exact_key(reaction_smiles):
    r, _, p = reaction_smiles.partition('>>')
    rk, pk = _side(r), _side(p)
    if not rk or not pk:
        return None
    return hashlib.sha1(f'{rk}>>{pk}'.encode()).hexdigest()[:32]


def load(build_dir, bits=1024):
    read = lambda p: zstd.ZstdDecompressor().stream_reader(open(p, 'rb')).read()
    exact = {}
    for line in read(os.path.join(build_dir, 'exact.tsv.zst')).decode().splitlines():
        k, c, *_ = line.split('\t')
        exact[k] = int(c)
    products = {}
    for line in read(os.path.join(build_dir, 'products.tsv.zst')).decode().splitlines():
        k, c, ids = line.split('\t')
        products[k] = {'count': int(c), 'keys': ids.split(',') if ids else []}
    keys = read(os.path.join(build_dir, 'reaction-keys.txt.zst')).decode().splitlines()
    blob = read(os.path.join(build_dir, 'reactions.faiss.zst'))
    index = faiss.deserialize_index_binary(np.frombuffer(blob, dtype=np.uint8))
    return {'exact': exact, 'products': products, 'keys': keys, 'index': index, 'bits': bits}


def exact(store, reaction_smiles):
    k = exact_key(reaction_smiles)
    return store['exact'].get(k), k


def similar(store, reaction_smiles, k=5):
    fp = DrfpEncoder.encode([reaction_smiles], n_folded_length=store['bits'])[0]
    vec = np.packbits(np.asarray(fp, dtype=np.uint8)).reshape(1, -1)
    dist, idx = store['index'].search(vec, k)
    return [(store['keys'][i], int(d)) for d, i in zip(dist[0], idx[0]) if i >= 0]


def make(store, product_smiles):
    pk = _side(product_smiles)
    return store['products'].get(pk)


if __name__ == '__main__':
    build = sys.argv[1]
    t0 = time.time()
    store = load(build)
    print(f"loaded in {time.time()-t0:.2f}s | exact={len(store['exact'])} products={len(store['products'])} keys={len(store['keys'])}")
    rxn = 'S(Cl)(Cl)=O.CCCCCCCCOc1ccc(C(=O)O)cc1>>CCCCCCCCOc1ccc(C(=O)Cl)cc1'
    t0 = time.time()
    n = 100000
    for _ in range(n):
        exact(store, rxn)
    print(f'exact: {(time.time()-t0)/n*1e6:.2f} us/query')
    t0 = time.time()
    print('similar:', similar(store, rxn, 5), f'( {(time.time()-t0)*1000:.1f} ms )')
    prod = 'CCCCCCCCOc1ccc(C(=O)Cl)cc1'
    print('make:', make(store, prod))
