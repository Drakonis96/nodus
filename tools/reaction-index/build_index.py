"""Build a compact known-reactions index from an ORD Parquet snapshot.

Per reaction:
  * exact key      — unmapped, canonical, order-independent (sorted reactants > sorted products), hashed
  * retro template — reaction-center SMARTS, where the source is atom-mapped: RDChiral for reactions at
                     or below --template-threshold atoms, the fast centre extractor above (per-row
                     rdchiral/fast provenance is recorded)
  * reaction DRFP  — differential reaction fingerprint for similarity search
  * product key    — canonical product, for a product -> reactions reverse map

Checkpointed per row group under <out>/parts, so a re-run skips finished work.
Progress prints every few seconds and mirrors to <out>/progress.json.

Artifacts (in --out):
  exact.tsv.zst          "<hash>\t<count>\t<sample ids>"
  templates.tsv.zst      "<count>\t<rdchiral>\t<fast>\t<sample ids>\t<retro_smarts>"
  products.tsv.zst       "<product_key>\t<count>\t<sample reaction hashes>"
  reactions.faiss.zst    faiss binary flat (exact) index over reaction DRFPs (Hamming)
  reaction-keys.txt.zst  row -> exact hash, aligned with the faiss index
  reaction-smiles.tsv.zst "<hash>\t<canonical reactants>><canonical products>" (one representative
                         per exact hash, so a looked-up or similar reaction can be drawn)
  retro-templates.tsv.zst "<count>\t<rdchiral count>\t<retro SMARTS>": the RDChiral templates seen at
                         least RETRO_MIN_COUNT times, small enough to load per lookup
  molecules.tsv.zst      "<canonical molecule>\t<times a reactant>\t<times a product>\t<reaction hashes>":
                         per molecule (salts and co-products split), how common it is as a starting
                         material and which recorded reactions make it

Reactions whose DRFP is empty (salt formations, recrystallisations, hydrates: no structural change
between the sides) keep their exact/product entries but are left out of the similarity index. An
empty vector is equidistant to every query of the same popcount, and ~5k identical ones swamp the
nearest-neighbour results. The index is exact rather than HNSW: HNSW recall on these sparse,
heavily duplicated fingerprints was poor (a reaction's own vector was often not returned), while
brute-force Hamming search is ~6 ms per query at this size.
  manifest.json          source revision, licence, counts, sizes, sha256
"""

import argparse, atexit, contextlib, glob, hashlib, io, json, os, re, sys, time
from collections import Counter, defaultdict

import multiprocessing as mp

from rdkit import Chem, RDLogger

RDLogger.DisableLog('rdApp.*')

SAMPLE_PER_TEMPLATE = 5
SAMPLE_PER_EXACT = 3
SAMPLE_KEYS_PER_PRODUCT = 20
# Retro templates shipped for one-step disconnections: RDChiral-extracted and seen this often.
RETRO_MIN_COUNT = 5
# Reactions kept per molecule for "recorded ways to make it".
MOLECULE_SAMPLE_KEYS = 50
REACTION_SMILES = 2
REACTION_CXSMILES = 6
ID_SMILES = 2
ID_CXSMILES = 10
ROLE_REACTANT = 1
ROLE_REAGENT = 2
ROLE_SOLVENT = 3
ROLE_CATALYST = 4
ATOM_MAP = re.compile(r'\[\w+:\d+\]')
DRFP_BITS = 1024
DRFP_BYTES = DRFP_BITS // 8

_PARTS_DIR = None
_TEMPLATE_THRESHOLD = 150  # <= this many atoms: RDChiral; above: the fast centre extractor


def _strip_and_canon(smiles):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, 0
    n = mol.GetNumAtoms()
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(mol), n


def _side_key_atoms(side):
    """Canonical key and heavy-atom count of one side, parsing each fragment once."""
    cans = []
    atoms = 0
    for frag in side.split('.'):
        if not frag:
            continue
        c, n = _strip_and_canon(frag)
        if c is None:
            return None, atoms
        atoms += n
        if c in ('[H]', '[H+]'):
            continue
        cans.append(c)
    return ('.'.join(sorted(cans)) if cans else None), atoms


def _split_cxsmiles(cx):
    parts = cx.split('>')
    if len(parts) == 2:
        return parts[0], '', parts[1]
    if len(parts) >= 3:
        return parts[0], parts[1], '>'.join(parts[2:])
    return None, None, None


def _reaction_level_smiles(rxn):
    candidates = []
    for ident in rxn.identifiers:
        value = ident.value or ''
        if '>>' not in value:
            continue
        mapped = bool(ident.is_mapped) or bool(ATOM_MAP.search(value))
        rank = 0 if ident.type == REACTION_CXSMILES else (1 if ident.type == REACTION_SMILES else 2)
        candidates.append((0 if mapped else 1, rank, value, mapped))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0], c[1]))
    _, _, value, mapped = candidates[0]
    r, a, p = _split_cxsmiles(value)
    if not r or not p:
        return None
    return r, a, p, mapped


def _component_smiles(component):
    for wanted in (ID_CXSMILES, ID_SMILES):
        for ident in component.identifiers:
            if ident.type == wanted and ident.value:
                return ident.value
    return None


def _from_components(rxn):
    reactants, agents, products = [], [], []
    for inp in rxn.inputs.values():
        for c in inp.components:
            smi = _component_smiles(c)
            if not smi:
                continue
            if c.reaction_role == ROLE_REACTANT:
                reactants.append(smi)
            elif c.reaction_role in (ROLE_REAGENT, ROLE_SOLVENT, ROLE_CATALYST):
                agents.append(smi)
    if rxn.outcomes:
        for c in rxn.outcomes[0].products:
            smi = _component_smiles(c)
            if smi:
                products.append(smi)
    if not reactants or not products:
        return None
    return '.'.join(reactants), '.'.join(agents), '.'.join(products), False


def _template(reactants, agents, products, rid):
    from rdchiral.template_extractor import extract_from_reaction
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            out = extract_from_reaction({'_id': rid, '_smiles': f'{reactants}>>{products}',
                                         'reactants': reactants, 'reagents': agents, 'products': products})
    except Exception:
        return None
    return (out or {}).get('reaction_smarts') or None


def _template_for(reactants, agents, products, rid, n_atoms, force_fast=False):
    """RDChiral for small/moderate reactions, the fast centre extractor above the threshold.
    `n_atoms` (reactant+product heavy atoms) is computed during the canonicalisation pass so we
    never parse the sides twice. `force_fast` (used by the watchdog retry) bypasses RDChiral.
    Returns (template_or_None, 'rdchiral'|'fast')."""
    if not force_fast and n_atoms <= _TEMPLATE_THRESHOLD:
        return _template(reactants, agents, products, rid), 'rdchiral'
    from template_fast import extract_template
    return extract_template(reactants, products), 'fast'


# A row group's checkpoint is named by the CONTENT of its file (sha256), not its path: a
# dataset corrected upstream under the same id then gets re-extracted instead of silently
# reusing the old checkpoint. The digests are computed once in the main process and handed
# to the workers (hashing the 1.1 GB USPTO file per row group would dominate the scan).
_FILE_DIGESTS = {}


def file_digest(path):
    if path not in _FILE_DIGESTS:
        h = hashlib.sha256()
        with open(path, 'rb') as fh:
            for block in iter(lambda: fh.read(1 << 22), b''):
                h.update(block)
        _FILE_DIGESTS[path] = h.hexdigest()
    return _FILE_DIGESTS[path]


def part_name(path, group):
    return hashlib.sha1(f'{file_digest(path)}::{group}'.encode()).hexdigest()[:24]


def legacy_part_name(path, group):
    """The name checkpoints had before content addressing (path-based)."""
    return hashlib.sha1(f'{path}::{group}'.encode()).hexdigest()[:24]


def _part_path(path, group):
    return os.path.join(_PARTS_DIR, f'{part_name(path, group)}.json')


def init_worker(parts_dir, threshold, digests=None):
    global _PARTS_DIR, _TEMPLATE_THRESHOLD
    _PARTS_DIR = parts_dir
    _TEMPLATE_THRESHOLD = threshold
    _FILE_DIGESTS.update(digests or {})
    # A worker the watchdog terminates mid-result prints a BrokenPipeError traceback; that is
    # expected, so send worker stderr to /dev/null to keep the run's log readable.
    try:
        sys.stderr = open(os.devnull, 'w')
    except Exception:
        pass


def process_row_group(args):
    from ord_schema.datasets import load_dataset
    path, group, force_fast = args
    out = _part_path(path, group)
    if os.path.exists(out):
        return ('skip', path, group)
    started = time.time()
    exact, templates = Counter(), Counter()
    templates_rdchiral, templates_fast = Counter(), Counter()
    exact_samples, template_samples = defaultdict(list), defaultdict(list)
    fast_templates = rdchiral_templates = 0
    # representative canonical reaction "r>>p" and product key per exact hash, for later fingerprints
    reaction_meta = {}          # key -> [reaction_smiles, product_key]
    products = {}               # product_key -> {n, s, k}
    n = 0
    view = load_dataset(path)
    for rid, rxn in view.iter_reactions(row_group=group):
        n += 1
        parsed = _reaction_level_smiles(rxn) or _from_components(rxn)
        if not parsed:
            continue
        reactants, agents, products_s, mapped = parsed
        r_key, r_atoms = _side_key_atoms(reactants)
        p_key, p_atoms = _side_key_atoms(products_s)
        if not r_key or not p_key:
            continue
        key = hashlib.sha1(f'{r_key}>>{p_key}'.encode()).hexdigest()[:32]
        exact[key] += 1
        if len(exact_samples[key]) < SAMPLE_PER_EXACT:
            exact_samples[key].append(rid)
        if key not in reaction_meta:
            reaction_meta[key] = [f'{r_key}>>{p_key}', p_key]
        entry = products.get(p_key)
        if entry is None:
            products[p_key] = {'n': 1, 's': products_s, 'k': [key]}
        else:
            entry['n'] += 1
            if len(entry['k']) < SAMPLE_KEYS_PER_PRODUCT and key not in entry['k']:
                entry['k'].append(key)
        if mapped:
            t, who = _template_for(reactants, agents, products_s, rid, r_atoms + p_atoms, force_fast)
            if who == 'fast':
                fast_templates += 1
            else:
                rdchiral_templates += 1
            if t:
                templates[t] += 1
                (templates_fast if who == 'fast' else templates_rdchiral)[t] += 1
                if len(template_samples[t]) < SAMPLE_PER_TEMPLATE:
                    template_samples[t].append(rid)
    payload = {'reactions': n, 'exact': dict(exact), 'templates': dict(templates),
               'templatesRdchiral': dict(templates_rdchiral), 'templatesFast': dict(templates_fast),
               'exactSamples': dict(exact_samples), 'templateSamples': dict(template_samples),
               'reactionMeta': reaction_meta, 'products': products,
               'fastTemplates': fast_templates, 'rdchiralTemplates': rdchiral_templates,
               'forcedFast': 1 if force_fast else 0}
    tmp = out + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(payload, fh)
    os.replace(tmp, out)
    if time.time() - started > 60:
        with open(os.path.join(os.path.dirname(out), '..', 'slow.jsonl'), 'a') as fh:
            fh.write(json.dumps({'file': os.path.basename(path), 'group': group, 'seconds': round(time.time() - started, 1)}) + '\n')
    return ('done', path, group)


def compute_reaction_fps(items):
    from drfp import DrfpEncoder
    import numpy as np
    keys, smiles = zip(*items) if items else ((), ())
    fps = DrfpEncoder.encode(list(smiles), n_folded_length=DRFP_BITS)
    packed = [np.packbits(np.asarray(fp, dtype=np.uint8)).tobytes() for fp in fps]
    return list(zip(keys, packed))


def list_tasks(root, files, limit):
    from ord_schema.datasets import load_dataset
    paths = files or sorted(glob.glob(os.path.join(root, 'data', '*', '*.parquet')))
    tasks = []
    for path in paths:
        try:
            view = load_dataset(path)
            for g in range(view.num_row_groups):
                tasks.append((path, g))
        except Exception as e:
            print(f'  skip {path}: {e}', file=sys.stderr, flush=True)
    tasks.sort(key=lambda t: -os.path.getsize(t[0]))
    return tasks[:limit] if limit else tasks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('ORD_DATA_DIR', 'ord-data'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--files', nargs='*')
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 4) - 2),
                    help='worker processes (default leaves two logical CPUs free so the machine stays usable; '
                         'override with --workers N)')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--interval', type=float, default=5.0)
    ap.add_argument('--no-fp', action='store_true', help='skip the DRFP/faiss step (exact+templates+products only)')
    ap.add_argument('--reuse-fp', action='store_true',
                    help='skip the DRFP/faiss computation and re-record the existing reactions.faiss.zst and '
                         'reaction-keys.txt.zst. Exact keys are deterministic, so re-merging over the same '
                         'checkpoints leaves the similarity index valid; use after re-extracting a few parts')
    ap.add_argument('--template-threshold', type=int, default=150,
                    help='<= this many atoms: RDChiral; above: the fast centre extractor (no cap on data)')
    ap.add_argument('--task-timeout', type=float, default=1800.0,
                    help='seconds a group may run before the watchdog requeues it with the fast extractor. '
                         'Deliberately generous (30 min): a merely slow-but-finishing group keeps RDChiral '
                         'quality, and only a genuine hang reaches the swap. Use --force-fast for datasets '
                         'known to hang so they never wait for the timeout at all.')
    ap.add_argument('--force-fast', nargs='*', default=[],
                    help='filename substrings whose row groups skip RDChiral and use the fast centre extractor '
                         '(for datasets with pathological RDChiral inputs, e.g. e7830cd6). Matching existing '
                         'checkpoints are discarded so the file is rebuilt uniformly fast.')
    ap.add_argument('--fresh', action='store_true', help='delete existing checkpoints and rebuild from scratch')
    ap.add_argument('--revision', default='93475c46949f9218e1dfb6624096025135db2add')
    args = ap.parse_args()

    parts_dir = os.path.join(args.out, 'parts')
    if args.fresh and os.path.isdir(parts_dir):
        import shutil
        shutil.rmtree(parts_dir)
    os.makedirs(parts_dir, exist_ok=True)
    progress_path = os.path.join(args.out, 'progress.json')

    # A pid file so progress.py can tell a live build from a finished one.
    pid_path = os.path.join(args.out, 'build.pid')
    with open(pid_path, 'w') as fh:
        fh.write(str(os.getpid()))

    def _clear_pid():
        try:
            os.remove(pid_path)
        except OSError:
            pass

    atexit.register(_clear_pid)

    tasks = list_tasks(args.root, args.files, args.limit)
    total_tasks = len(tasks)
    for path in sorted({t[0] for t in tasks}):
        file_digest(path)
    # One-time move from path-named checkpoints: a legacy part was built from the file now at
    # that path only if the file is unchanged, which the manifest's recorded source revision
    # vouches for; --fresh remains the way to discard them.
    migrated = 0
    for (path, group, *_rest) in tasks:
        old_part = os.path.join(parts_dir, f'{legacy_part_name(path, group)}.json')
        new_part = os.path.join(parts_dir, f'{part_name(path, group)}.json')
        if os.path.exists(old_part) and not os.path.exists(new_part):
            os.replace(old_part, new_part)
            migrated += 1
    if migrated:
        print(f'checkpoints: {migrated} path-named checkpoint(s) renamed to content-addressed names', flush=True)
    print(f'tasks: {total_tasks} row groups | workers={args.workers} | out={args.out}', flush=True)

    done = skipped = 0
    last = 0.0
    t0 = time.time()

    def report(final=False):
        elapsed = time.time() - t0
        rate = done / elapsed if elapsed else 0
        eta = (total_tasks - done) / rate if rate else 0
        snap = {'phase': 'scan', 'done': done, 'total': total_tasks, 'skipped': skipped,
                'elapsedMin': round(elapsed / 60, 1), 'etaMin': round(eta / 60, 1), 'finished': final}
        tmp = progress_path + '.tmp'
        with open(tmp, 'w') as fh:
            json.dump(snap, fh)
        os.replace(tmp, progress_path)
        print(f"  [{done}/{total_tasks}] {rate:.1f} grp/s elapsed {elapsed/60:.1f}m ETA {eta/60:.1f}m"
              f"{'  DONE' if final else ''}", flush=True)

    # Sliding-window scan with a watchdog. The pool is kept continuously busy (no batch barrier,
    # so a single slow task can't stall the others). Each in-flight task is timestamped: if one
    # has run longer than `task_timeout` — a worker stuck inside RDChiral, a C++ call a signal
    # cannot interrupt — the pool is terminated, that group is requeued once forcing the fast
    # centre extractor, and the run continues. Nothing is dropped.
    fast_sub = tuple(args.force_fast)
    tasks = [(p, g, any(s in p for s in fast_sub)) for (p, g) in tasks]
    if fast_sub:
        removed = 0
        for (p, g, ff) in tasks:
            if ff:
                pf = os.path.join(parts_dir, f'{part_name(p, g)}.json')
                if os.path.exists(pf):
                    os.remove(pf)
                    removed += 1
        print(f'force-fast {args.force_fast}: {sum(1 for t in tasks if t[2])} groups, '
              f'{removed} checkpoints discarded', flush=True)
    remaining = list(tasks)
    requeued = set()
    forced_fast = 0
    timed_out = 0
    window = args.workers + 2

    def new_pool():
        return mp.Pool(args.workers, initializer=init_worker, initargs=(parts_dir, args.template_threshold, dict(_FILE_DIGESTS)))

    pool = new_pool()
    inflight = {}  # AsyncResult -> [task, submit_time]
    try:
        while remaining or inflight:
            while remaining and len(inflight) < window:
                t = remaining.pop(0)
                inflight[pool.apply_async(process_row_group, (t,))] = [t, time.time()]
            progressed = False
            for ar in list(inflight):
                if ar.ready():
                    t = inflight.pop(ar)[0]
                    try:
                        if ar.get()[0] == 'skip':
                            skipped += 1
                    except Exception as e:
                        print(f'  task error {t[:2]}: {e}', flush=True)
                    done += 1
                    progressed = True
            now = time.time()
            stuck = [ar for ar, (t, st) in inflight.items() if now - st > args.task_timeout]
            if stuck:
                # Killing the pool aborts every in-flight result, so requeue them all — dropping the
                # non-stuck ones would silently lose their row groups. The one(s) that actually hit the
                # timeout are downgraded to the fast extractor; the rest keep their previous mode.
                inflight_tasks = [inflight[ar][0] for ar in list(inflight)]
                stuck_keys = {(inflight[ar][0][0], inflight[ar][0][1]) for ar in stuck}
                pool.terminate()
                pool.join()
                pool = new_pool()
                inflight.clear()
                for t in inflight_tasks:
                    key = (t[0], t[1])
                    if key in stuck_keys:
                        print(f'  WATCHDOG: group {key} stuck >{args.task_timeout}s', flush=True)
                        if key in requeued:
                            timed_out += 1
                            done += 1
                        else:
                            requeued.add(key)
                            forced_fast += 1
                            remaining.insert(0, (key[0], key[1], True))
                    else:
                        remaining.insert(0, (t[0], t[1], t[2]))
                progressed = True
            if time.time() - last >= args.interval:
                last = time.time()
                report(final=(not remaining and not inflight))
            if not progressed:
                time.sleep(0.05)
        # The timed report above can miss the end (a cached re-run finishes between ticks), so the
        # scan's last state is always written once it is over.
        report(final=True)
    finally:
        pool.terminate()
        pool.join()

    print(f'scan done: forced-fast retries={forced_fast} timed-out-and-skipped={timed_out}', flush=True)
    expected = {part_name(p, g) for (p, g, _) in tasks}
    present = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(parts_dir, '*.json'))}
    missing = expected - present
    if missing:
        print(f'WARNING: {len(missing)}/{len(expected)} groups have no checkpoint '
              f'(e.g. {sorted(missing)[:5]}); the index is INCOMPLETE', flush=True)
    else:
        print(f'completeness OK: {len(expected & present)}/{len(expected)} checkpoints', flush=True)
    print('merging checkpoints...', flush=True)
    exact, templates = Counter(), Counter()
    templates_r, templates_f = Counter(), Counter()
    exact_samples, template_samples = {}, {}
    reaction_meta, products = {}, {}
    fast_templates = rdchiral_templates = forced_fast_parts = 0
    # Merge exactly this scan's row groups: a checkpoint left by a dataset since removed or
    # retired upstream, or by a file since replaced, is not part of the index.
    stray = present - expected
    if stray:
        print(f'checkpoints: {len(stray)} not in this scan (removed, retired or replaced data) are left out of the merge', flush=True)
    for part in sorted(os.path.join(parts_dir, f'{name}.json') for name in expected & present):
        with open(part) as fh:
            p = json.load(fh)
        if 'templatesRdchiral' not in p or 'templatesFast' not in p:
            raise SystemExit(f'checkpoint {os.path.basename(part)} predates per-template provenance; '
                             f'delete it and re-run so its row group is re-extracted')
        forced_fast_parts += p.get('forcedFast', 0)
        exact.update(p['exact'])
        templates.update(p['templates'])
        templates_r.update(p['templatesRdchiral'])
        templates_f.update(p['templatesFast'])
        fast_templates += p.get('fastTemplates', 0)
        rdchiral_templates += p.get('rdchiralTemplates', 0)
        for k, v in p['exactSamples'].items():
            if k not in exact_samples:
                exact_samples[k] = v[:SAMPLE_PER_EXACT]
        for k, v in p['templateSamples'].items():
            if k not in template_samples:
                template_samples[k] = v[:SAMPLE_PER_TEMPLATE]
        for k, v in p['reactionMeta'].items():
            reaction_meta.setdefault(k, v)
        for k, v in p['products'].items():
            e = products.get(k)
            if e is None:
                products[k] = {'n': v['n'], 's': v['s'], 'k': list(v['k'])}
            else:
                e['n'] += v['n']
                for key in v['k']:
                    if key not in e['k'] and len(e['k']) < SAMPLE_KEYS_PER_PRODUCT:
                        e['k'].append(key)
    print(f'merged: {len(exact)} exact keys, {len(templates)} templates, {len(products)} products', flush=True)

    import zstandard as zstd
    cctx = zstd.ZstdCompressor(level=14)

    def write_zst(path, text):
        with open(path, 'wb') as fh:
            with cctx.stream_writer(fh) as w:
                w.write(text.encode())

    def write_zst_blocked(path, lines, block=2048):
        """A sorted table as independent zstd frames of `block` lines. Concatenated frames are one
        valid zstd stream, so streaming readers are unchanged; `<path>.blocks` lists each frame's
        first key, offset and length, so a lookup decompresses one small frame instead of the file."""
        index = []
        with open(path, 'wb') as fh:
            for start in range(0, len(lines), block):
                chunk = lines[start:start + block]
                frame = cctx.compress(('\n'.join(chunk) + '\n').encode())
                index.append(f'{chunk[0].split(chr(9), 1)[0]}\t{fh.tell()}\t{len(frame)}')
                fh.write(frame)
        with open(path + '.blocks', 'w') as fh:
            fh.write('\n'.join(index))

    write_zst_blocked(os.path.join(args.out, 'exact.tsv.zst'),
                      [f'{k}\t{exact[k]}\t{",".join(exact_samples.get(k, []))}' for k in sorted(exact)])
    write_zst(os.path.join(args.out, 'templates.tsv.zst'),
              '\n'.join(f'{templates[t]}\t{templates_r.get(t, 0)}\t{templates_f.get(t, 0)}\t'
                        f'{",".join(template_samples.get(t, []))}\t{t}' for t in sorted(templates)))
    write_zst(os.path.join(args.out, 'products.tsv.zst'),
              '\n'.join(f'{k}\t{products[k]["n"]}\t{",".join(products[k]["k"])}' for k in sorted(products)))
    write_zst_blocked(os.path.join(args.out, 'reaction-smiles.tsv.zst'),
                      [f'{k}\t{reaction_meta[k][0]}' for k in sorted(reaction_meta)])
    retro = sorted((t for t in templates if templates[t] >= RETRO_MIN_COUNT and templates_r.get(t, 0) > 0),
                   key=lambda t: (-templates[t], t))
    write_zst(os.path.join(args.out, 'retro-templates.tsv.zst'),
              '\n'.join(f'{templates[t]}\t{templates_r.get(t, 0)}\t{t}' for t in retro))
    # Per molecule: occurrences as a reactant and as a product, weighted by how often each exact
    # reaction was recorded, and a few reactions that make it (most recorded first).
    as_reactant, as_product, makes = Counter(), Counter(), defaultdict(list)
    for key, (smiles, _p) in reaction_meta.items():
        weight = exact.get(key, 1)
        reactants_side, _, products_side = smiles.partition('>>')
        for molecule in set(filter(None, reactants_side.split('.'))):
            as_reactant[molecule] += weight
        for molecule in set(filter(None, products_side.split('.'))):
            as_product[molecule] += weight
            makes[molecule].append((weight, key))
    molecule_rows = []
    for molecule in sorted(set(as_reactant) | set(as_product)):
        keys = [key for _w, key in sorted(makes.get(molecule, []), key=lambda wk: (-wk[0], wk[1]))[:MOLECULE_SAMPLE_KEYS]]
        molecule_rows.append(f'{molecule}\t{as_reactant.get(molecule, 0)}\t{as_product.get(molecule, 0)}\t{",".join(keys)}')
    write_zst_blocked(os.path.join(args.out, 'molecules.tsv.zst'), molecule_rows)
    print(f'retro templates: {len(retro)}; molecules: {len(molecule_rows)}', flush=True)

    files_meta = {}

    def record(name, path):
        files_meta[name] = {'bytes': os.path.getsize(path), 'sha256': digest(path)}

    def digest(path):
        h = hashlib.sha256()
        with open(path, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''):
                h.update(chunk)
        return h.hexdigest()

    for name in ('exact.tsv.zst', 'templates.tsv.zst', 'products.tsv.zst', 'reaction-smiles.tsv.zst',
                 'retro-templates.tsv.zst', 'molecules.tsv.zst', 'exact.tsv.zst.blocks',
                 'reaction-smiles.tsv.zst.blocks', 'molecules.tsv.zst.blocks'):
        record(name, os.path.join(args.out, name))

    fp_vectors = empty_fps = None
    if args.reuse_fp:
        for name in ('reactions.faiss.zst', 'reaction-keys.txt.zst'):
            path = os.path.join(args.out, name)
            if not os.path.exists(path):
                raise SystemExit(f'--reuse-fp: {name} not found in {args.out}')
            record(name, path)
        print(f'reusing existing faiss index ({files_meta["reactions.faiss.zst"]["bytes"]} bytes)', flush=True)
    elif not args.no_fp:
        print('computing reaction fingerprints (DRFP)...', flush=True)
        items = sorted((k, reaction_meta[k][0]) for k in reaction_meta)
        chunk = max(1, len(items) // (args.workers * 4))
        batches = [items[i:i + chunk] for i in range(0, len(items), chunk)]
        t1 = time.time()
        with mp.Pool(args.workers, initializer=init_worker, initargs=(parts_dir, args.template_threshold, dict(_FILE_DIGESTS))) as pool:
            results = []
            for i, part in enumerate(pool.imap_unordered(compute_reaction_fps, batches)):
                results.append(part)
                if i % 5 == 0 or i == len(batches) - 1:
                    with open(progress_path + '.tmp', 'w') as fh:
                        json.dump({'phase': 'fingerprints', 'batches': i + 1, 'totalBatches': len(batches)}, fh)
                    os.replace(progress_path + '.tmp', progress_path)
                    print(f'  fp batches {i+1}/{len(batches)}', flush=True)
        fps = {k: b for part in results for k, b in part}
        empty = bytes(DRFP_BYTES)
        empty_fps = sum(1 for k, _ in items if fps[k] == empty)
        keys = [k for k, _ in items if fps[k] != empty]
        fp_vectors = len(keys)
        import numpy as np
        import faiss
        matrix = np.frombuffer(b''.join(fps[k] for k in keys), dtype=np.uint8).reshape(len(keys), DRFP_BYTES)
        index = faiss.IndexBinaryFlat(DRFP_BITS)
        index.add(matrix)
        print(f'faiss index: {empty_fps} reactions with an empty fingerprint left out', flush=True)
        fp_path = os.path.join(args.out, 'reactions.faiss.zst')
        with open(fp_path, 'wb') as fh:
            with cctx.stream_writer(fh) as w:
                w.write(faiss.serialize_index_binary(index))
        write_zst(os.path.join(args.out, 'reaction-keys.txt.zst'), '\n'.join(keys))
        record('reactions.faiss.zst', fp_path)
        record('reaction-keys.txt.zst', os.path.join(args.out, 'reaction-keys.txt.zst'))
        print(f'faiss index: {len(keys)} vectors in {time.time()-t1:.1f}s', flush=True)

    manifest = {
        'format': 'nodus.reaction-index',
        'version': 4,
        'templatesColumns': ['count', 'rdchiral', 'fast', 'sampleIds', 'smarts'],
        'source': 'open-reaction-database/ord-data',
        'revision': args.revision,
        'licence': 'CC-BY-SA-4.0',
        'citation': 'Kearnes et al., JACS 2021, doi:10.1021/jacs.1c09820',
        'fingerprint': {'kind': 'drfp', 'bits': DRFP_BITS, 'space': 'hamming', 'index': 'flat',
                        'vectors': fp_vectors, 'emptyExcluded': empty_fps},
        'templateExtractor': {'thresholdAtoms': args.template_threshold,
                              'rdchiral': rdchiral_templates, 'fast': fast_templates,
                              'watchdogForcedFast': forced_fast, 'watchdogSkipped': timed_out,
                              'forcedFastParts': forced_fast_parts},
        'exactKeys': len(exact),
        'templates': len(templates),
        'products': len(products),
        'files': files_meta,
        'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    with open(os.path.join(args.out, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)
    # The whole build is done only now; progress.json says so, for the to-do panel and progress.py.
    with open(progress_path + '.tmp', 'w') as fh:
        json.dump({'phase': 'done', 'done': total_tasks, 'total': total_tasks, 'finished': True,
                   'elapsedMin': round((time.time() - t0) / 60, 1)}, fh)
    os.replace(progress_path + '.tmp', progress_path)
    print('DONE', json.dumps({k: v['bytes'] for k, v in files_meta.items()}), flush=True)


if __name__ == '__main__':
    main()
