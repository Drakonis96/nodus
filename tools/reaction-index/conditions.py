"""Reaction conditions for the ORD reactions an index cites: conditions.tsv.zst beside it.

The index (build_index.py) keeps reaction keys and a few sample ORD ids per reaction, not what the
reactions were run with. This pass reads the same ORD Parquet snapshot and, for every ORD id the
index names as a sample, records the reagents, catalysts and solvents (by role, name preferred over
SMILES), temperature, time, atmosphere, yield and reference. A precedent can then be cited with its
conditions ("Pd/C, H2, EtOH, 25 °C · yield 92% · doi:…").

  conditions.py --index DIR [--root ORD_DATA] [--workers N]

Checkpointed per Parquet row group under <index>/conditions-parts (named by the file's content
digest, so a dataset corrected upstream is re-read). The table is written to a temporary file and
renamed into place, and manifest.json gains its size and sha256 (the old manifest is kept as
manifest.json.bak).

conditions.tsv.zst  "<ord id>\t<json>", sorted by id, blocked like exact.tsv.zst (<path>.blocks).
  json keys (all optional): reagents, catalysts, solvents (lists of names), temperature (text),
  time (text), atmosphere (text), yield (percent, number), ref (doi:… / patent / URL)
"""

import argparse, glob, hashlib, io, json, os, sys, time
import multiprocessing as mp

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_PER_ROLE = 4
PART_VERSION = 'v2'  # bump when _conditions changes, so old checkpoints are not reused
DATASET_DOIS = ('10.6084/m9.figshare.5104873',)  # the USPTO extraction's DOI: a dataset, not a source
MAX_NAME = 48
NAME, SMILES = 6, 2  # CompoundIdentifier types

_PARTS = None


def file_digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b''):
            h.update(chunk)
    return h.hexdigest()


def _component_name(component):
    by_type = {}
    for ident in component.identifiers:
        if ident.value and ident.type not in by_type:
            by_type[ident.type] = ident.value
    name = by_type.get(NAME) or by_type.get(SMILES)
    return name[:MAX_NAME] if name else None


def _amount_text(value, units_enum, unit_name):
    if not value:
        return None
    number = f'{value:g}'
    return f'{number} {unit_name}' if unit_name else number


def _contributors(rxn):
    """Canonical SMILES of the reactants that give atoms to a product, from the reaction's atom-mapped
    SMILES; None when the reaction has no mapped SMILES."""
    from rdkit import Chem
    for ident in rxn.identifiers:
        value = ident.value or ''
        if '>' not in value or ':' not in value:
            continue
        parts = value.split(' ')[0].split('>')
        if len(parts) < 3:
            continue
        product_maps = {int(m) for m in __import__('re').findall(r':(\d+)\]', parts[-1])}
        out = set()
        for frag in parts[0].split('.'):
            maps = {int(m) for m in __import__('re').findall(r':(\d+)\]', frag)}
            if maps & product_maps:
                mol = Chem.MolFromSmiles(frag)
                if mol is not None:
                    for atom in mol.GetAtoms():
                        atom.SetAtomMapNum(0)
                    out.add(Chem.MolToSmiles(mol))
        return out
    return None


def _canonical(component):
    from rdkit import Chem
    for ident in component.identifiers:
        if ident.type == SMILES and ident.value:
            mol = Chem.MolFromSmiles(ident.value)
            return Chem.MolToSmiles(mol) if mol is not None else None
    return None


def _conditions(rxn):
    from ord_schema.proto import reaction_pb2 as pb
    roles = {'REAGENT': 'reagents', 'CATALYST': 'catalysts', 'SOLVENT': 'solvents'}
    out = {}
    contributors = None
    for inp in rxn.inputs.values():
        for c in inp.components:
            role = pb.ReactionRole.ReactionRoleType.Name(c.reaction_role)
            key = roles.get(role)
            if role == 'REACTANT':
                # USPTO labels every input a reactant: one that gives no atom to a product (by the atom
                # map; without one, a carbon-free component: base, salt, metal) is a reagent.
                if contributors is None:
                    contributors = _contributors(rxn) or False
                smiles = _canonical(c)
                if contributors:
                    key = 'reagents' if smiles and smiles not in contributors else None
                else:
                    key = 'reagents' if smiles and 'C' not in smiles.replace('Cl', '').replace('Cs', '').replace('Ca', '').replace('Cu', '').replace('Co', '').replace('Cr', '').replace('Cd', '').replace('Ce', '') and 'c' not in smiles else None
            if not key:
                continue
            name = _component_name(c)
            if name and name not in out.get(key, []) and len(out.get(key, [])) < MAX_PER_ROLE:
                out.setdefault(key, []).append(name)
    temp = rxn.conditions.temperature
    if temp.setpoint.value or temp.setpoint.units:
        unit = pb.Temperature.TemperatureUnit.Name(temp.setpoint.units)
        symbol = {'CELSIUS': '°C', 'KELVIN': 'K', 'FAHRENHEIT': '°F'}.get(unit, '')
        out['temperature'] = f'{temp.setpoint.value:g} {symbol}'.strip()
    elif temp.control.type:
        control = pb.TemperatureConditions.TemperatureControl.TemperatureControlType.Name(temp.control.type)
        if control not in ('UNSPECIFIED', 'CUSTOM'):
            out['temperature'] = control.lower().replace('_', ' ')
    atmosphere = rxn.conditions.pressure.atmosphere.type
    if atmosphere:
        name = pb.PressureConditions.Atmosphere.AtmosphereType.Name(atmosphere)
        if name not in ('UNSPECIFIED', 'CUSTOM'):
            out['atmosphere'] = name.lower().replace('_', ' ')
    for outcome in rxn.outcomes:
        t = outcome.reaction_time
        if 'time' not in out and t.value:
            unit = pb.Time.TimeUnit.Name(t.units).lower()
            out['time'] = f'{t.value:g} {({"hour": "h", "minute": "min", "second": "s", "day": "d"}).get(unit, unit)}'
        for product in outcome.products:
            for m in product.measurements:
                if m.type == pb.ProductMeasurement.ProductMeasurementType.YIELD and m.percentage.value and 'yield' not in out:
                    out['yield'] = round(m.percentage.value, 1)
    prov = rxn.provenance
    doi = prov.doi.removeprefix('https://doi.org/').removeprefix('doi:') if prov.doi else ''
    if doi and not doi.startswith(DATASET_DOIS):
        out['ref'] = 'doi:' + doi
    elif prov.patent:
        out['ref'] = prov.patent
    elif prov.publication_url:
        out['ref'] = prov.publication_url
    return out


def _init(parts_dir):
    global _PARTS
    _PARTS = parts_dir


def process(task):
    """One row group -> <parts>/<digest16>-<group>.jsonl (every reaction with any condition)."""
    from ord_schema.datasets import load_dataset
    path, digest, group = task
    out = os.path.join(_PARTS, f'{digest[:16]}-{PART_VERSION}-{group}.jsonl')
    if os.path.exists(out):
        return 'skip'
    lines = []
    for rid, rxn in load_dataset(path).iter_reactions(row_group=group):
        try:
            c = _conditions(rxn)
        except Exception:
            continue
        if c:
            lines.append(f'{rid}\t{json.dumps(c, ensure_ascii=False, separators=(",", ":"))}')
    tmp = out + '.tmp'
    with open(tmp, 'w') as fh:
        fh.write('\n'.join(lines))
    os.replace(tmp, out)
    return 'done'


def sample_ids(index_dir):
    """Every ORD id the index names as a sample (exact matches; templates' sample ids too)."""
    import zstandard as zstd
    ids = set()
    for name, column in (('exact.tsv.zst', 2), ('templates.tsv.zst', 3)):
        path = os.path.join(index_dir, name)
        if not os.path.exists(path):
            continue
        with open(path, 'rb') as fh:
            reader = io.TextIOWrapper(zstd.ZstdDecompressor().stream_reader(fh), encoding='utf-8')
            for line in reader:
                cols = line.rstrip('\n').split('\t')
                if len(cols) > column and cols[column]:
                    ids.update(x for x in cols[column].split(',') if x.startswith('ord-'))
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--index', required=True)
    ap.add_argument('--root', default=os.environ.get('ORD_DATA_DIR') or os.path.join(HERE, '..', '..', '..', 'ord-data'))
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()
    from ord_schema.datasets import load_dataset
    import zstandard as zstd

    started = time.time()
    parts = os.path.join(args.index, 'conditions-parts')
    os.makedirs(parts, exist_ok=True)
    files = sorted(glob.glob(os.path.join(os.path.abspath(args.root), 'data', '*', '*.parquet')))
    if not files:
        raise SystemExit(f'no ORD Parquet files under {args.root}/data')
    tasks = []
    for path in files:
        digest = file_digest(path)
        tasks += [(path, digest, g) for g in range(load_dataset(path).num_row_groups)]
    print(f'{len(files)} files, {len(tasks)} row groups, {args.workers} workers', flush=True)
    done = 0
    with mp.Pool(args.workers, initializer=_init, initargs=(parts,)) as pool:
        for _ in pool.imap_unordered(process, tasks, chunksize=4):
            done += 1
            if done % 100 == 0 or done == len(tasks):
                rate = done / max(time.time() - started, 1e-6)
                print(f'  [{done}/{len(tasks)}] {rate:.1f} grp/s, ETA {(len(tasks) - done) / max(rate, 1e-6) / 60:.1f} min', flush=True)

    wanted = sample_ids(args.index)
    expected = {f'{d[:16]}-{PART_VERSION}-{g}.jsonl' for _, d, g in tasks}
    rows = {}
    for name in expected:
        with open(os.path.join(parts, name)) as fh:
            for line in fh:
                rid, _, payload = line.rstrip('\n').partition('\t')
                if rid in wanted:
                    rows[rid] = payload
    lines = [f'{rid}\t{rows[rid]}' for rid in sorted(rows)]
    with_yield = sum(1 for rid in rows if '"yield"' in rows[rid])

    cctx = zstd.ZstdCompressor(level=14)
    final = os.path.join(args.index, 'conditions.tsv.zst')
    tmp = final + '.tmp'
    index = []
    with open(tmp, 'wb') as fh:
        for start in range(0, len(lines), 2048):
            chunk = lines[start:start + 2048]
            frame = cctx.compress(('\n'.join(chunk) + '\n').encode())
            index.append(f'{chunk[0].split(chr(9), 1)[0]}\t{fh.tell()}\t{len(frame)}')
            fh.write(frame)
    with open(tmp + '.blocks', 'w') as fh:
        fh.write('\n'.join(index))
    os.replace(tmp + '.blocks', final + '.blocks')
    os.replace(tmp, final)

    manifest_path = os.path.join(args.index, 'manifest.json')
    if os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            manifest = json.load(fh)
        with open(manifest_path + '.bak', 'w') as fh:
            json.dump(manifest, fh, indent=2)
        digest = lambda p: file_digest(p)
        for name in ('conditions.tsv.zst', 'conditions.tsv.zst.blocks'):
            p = os.path.join(args.index, name)
            manifest.setdefault('files', {})[name] = {'bytes': os.path.getsize(p), 'sha256': digest(p)}
        manifest['conditions'] = {'samples': len(wanted), 'withConditions': len(rows), 'withYield': with_yield,
                                  'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        with open(manifest_path + '.tmp', 'w') as fh:
            json.dump(manifest, fh, indent=2)
        os.replace(manifest_path + '.tmp', manifest_path)
    print(f'conditions: {len(rows)}/{len(wanted)} sample ids ({len(rows) / max(len(wanted), 1):.0%}) have conditions, '
          f'{with_yield} ({with_yield / max(len(wanted), 1):.0%}) a yield; {os.path.getsize(final) / 1e6:.1f} MB; '
          f'{(time.time() - started) / 60:.1f} min', flush=True)


if __name__ == '__main__':
    main()
