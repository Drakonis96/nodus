#!/usr/bin/env python3
"""Retro templates from textbook schemes, for the textbook index's retro-templates.tsv.zst.

  templates.py export            reactions to map -> <scan db dir>/templates/to-map.jsonl
  <rxnmapper python> templates.py map      atom-map them (RXNMapper; checkpointed in mapped.jsonl)
  templates.py extract           RDChiral retro templates -> templates/templates.json (read by build_index.py)

Sources: generic records (R, Ar, X... drawn as [*]) and verified real reactions (confirmed, repaired).
A generic scheme is mapped as a model reaction with every R as CH3. After extraction, every template
atom that came from an R (found by aligning the generic structure onto the mapped one) becomes [*],
so the template does not demand a methyl where the book drew R. Each template keeps the records it
came from (book, page, reagents) for citation.

RXNMapper needs its own environment (torch, transformers): tools/.venv-rxnmapper. The other stages
run in the reaction-index environment (RDKit, RDChiral).
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
DB = os.environ.get('SCHEME_SCAN_DB') or os.path.expanduser('~/Library/Application Support/Nodus/chemistry-schemes/scan.sqlite')
WORK = os.path.join(os.path.dirname(DB), 'templates')
TO_MAP, MAPPED, OUT = (os.path.join(WORK, n) for n in ('to-map.jsonl', 'mapped.jsonl', 'templates.json'))
MAX_ATOMS = 120          # RXNMapper's 512-token limit; textbook schemes are far below it
MIN_CONFIDENCE = 0.5     # atom maps below this are left out


def methylated(smiles):
    """The structure with every wildcard as carbon (a model compound), or None."""
    from rdkit import Chem
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    rw = Chem.RWMol(mol)
    for atom in rw.GetAtoms():
        if atom.GetAtomicNum() == 0:
            atom.SetAtomicNum(6); atom.SetIsotope(0); atom.SetFormalCharge(0); atom.SetNoImplicit(False); atom.SetNumExplicitHs(0)
    try:
        Chem.SanitizeMol(rw)
    except Exception:
        return None
    return Chem.MolToSmiles(rw)


def export():
    import scan
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    os.makedirs(WORK, exist_ok=True)
    con = scan.connect()
    rows = con.execute("""SELECT x.item_id, x.n, x.source, x.status, x.reactants, x.products, x.reagents, x.checks, b.title, b.nodus_id, i.page, i.kind
      FROM records x JOIN items i ON i.id = x.item_id JOIN books b ON b.book_key = i.book_key
      WHERE x.status IN ('generic', 'confirmed', 'repaired')""").fetchall()  # 'retro' records are excluded
    seen, out = set(), []
    for item_id, n, source, status, reactants, products, reagents, checks, title, nodus_id, page, kind in rows:
        fix = {c['smiles']: c['suggested'] for c in json.loads(checks) if c.get('suggested')}
        sides = []
        for side in (reactants, products):
            smiles = [fix.get(scan.generic_to_wildcard(s), scan.generic_to_wildcard(s)) for s in json.loads(side) if isinstance(s, str) and s.strip()]
            sides.append(smiles)
        r, p = sides
        if not r or not p or any(Chem.MolFromSmiles(s) is None for s in r + p):
            continue
        generic = any('*' in s for s in r + p)
        model_r = [methylated(s) for s in r] if generic else r
        model_p = [methylated(s) for s in p] if generic else p
        if None in model_r or None in model_p:
            continue
        rxn = f"{'.'.join(model_r)}>>{'.'.join(model_p)}"
        atoms = sum(Chem.MolFromSmiles(s).GetNumAtoms() for s in model_r + model_p)
        if atoms > MAX_ATOMS or rxn in seen:
            continue
        seen.add(rxn)
        out.append({'id': f'{item_id}:{n}:{source}', 'rxn': rxn, 'generic': generic, 'genericReactants': r if generic else None,
                    'genericProducts': p if generic else None, 'book': title, 'nodusId': nodus_id, 'page': page, 'kind': kind,
                    'reagents': reagents if isinstance(reagents, str) else None, 'status': status})
    with open(TO_MAP, 'w') as fh:
        for row in out:
            fh.write(json.dumps(row) + '\n')
    print(f'{len(out)} distinct reactions to map ({sum(r["generic"] for r in out)} generic) -> {TO_MAP}')


def map_reactions(batch=32):
    """Runs under the RXNMapper environment. Appends to mapped.jsonl; a re-run skips mapped ids."""
    from rxnmapper import RXNMapper
    done = set()
    if os.path.exists(MAPPED):
        done = {json.loads(line)['id'] for line in open(MAPPED)}
    todo = [json.loads(line) for line in open(TO_MAP)]
    todo = [r for r in todo if r['id'] not in done]
    mapper = RXNMapper()
    with open(MAPPED, 'a') as fh:
        for start in range(0, len(todo), batch):
            chunk = todo[start:start + batch]
            try:
                results = mapper.get_attention_guided_atom_maps([r['rxn'] for r in chunk])
            except Exception:
                results = []
                for r in chunk:  # one bad reaction should not lose the batch
                    try:
                        results.append(mapper.get_attention_guided_atom_maps([r['rxn']])[0])
                    except Exception as error:
                        results.append({'mapped_rxn': None, 'confidence': 0, 'error': str(error)[:200]})
            for r, res in zip(chunk, results):
                fh.write(json.dumps({'id': r['id'], 'mapped': res.get('mapped_rxn'), 'confidence': res.get('confidence', 0)}) + '\n')
            fh.flush()
            if (start // batch) % 20 == 0:
                print(f'mapped {len(done) + start + len(chunk)}/{len(done) + len(todo)}', flush=True)
    print('mapping done')


def r_map_numbers(generic_side, mapped_side):
    """Map numbers of the atoms that stand for R in a generic side, by aligning each generic structure
    (wildcards as 'any atom') onto the mapped model structures."""
    from rdkit import Chem
    params = Chem.AdjustQueryParameters(); params.makeDummiesQueries = True
    mapped = [Chem.MolFromSmiles(s) for s in mapped_side.split('.')]
    numbers, used = set(), set()
    for s in generic_side:
        query = Chem.AdjustQueryProperties(Chem.MolFromSmiles(s), params)
        for k, mol in enumerate(mapped):
            if k in used or mol is None or mol.GetNumAtoms() != query.GetNumAtoms():
                continue
            match = mol.GetSubstructMatch(query)
            if match:
                used.add(k)
                for q_idx, m_idx in enumerate(match):
                    if query.GetAtomWithIdx(q_idx).GetAtomicNum() == 0:
                        numbers.add(mol.GetAtomWithIdx(m_idx).GetAtomMapNum())
                break
    return numbers  # 0 in it: an R atom the mapper left unmapped, i.e. one that leaves


def changed_atoms(reactants, products):
    """Map numbers of atoms whose bonded partners, bond orders, charge or H count differ between the
    sides of a mapped reaction (the reaction centre), plus mapped atoms present on one side only."""
    from rdkit import Chem

    def env(side):
        out = {}
        for frag in side.split('.'):
            mol = Chem.MolFromSmiles(frag)
            if mol is None:
                continue
            for atom in mol.GetAtoms():
                n = atom.GetAtomMapNum()
                if n:
                    bonds = frozenset((b.GetOtherAtom(atom).GetAtomMapNum() or -b.GetOtherAtom(atom).GetAtomicNum(), b.GetBondTypeAsDouble())
                                      for b in atom.GetBonds())
                    out[n] = (bonds, atom.GetFormalCharge(), atom.GetTotalNumHs())
        return out

    left, right = env(reactants), env(products)
    return {n for n in set(left) | set(right) if left.get(n) != right.get(n)}


ATOM = re.compile(r'\[[^\]]*?:(\d+)\]')


def extract():
    sys.path.insert(0, os.path.join(HERE, '..', 'reaction-index'))
    import build_index as ord_builder
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    source = {json.loads(line)['id']: json.loads(line) for line in open(TO_MAP)}
    templates, stats = {}, {'mapped': 0, 'low confidence': 0, 'no template': 0, 'generic': 0, 'real': 0}
    for line in open(MAPPED):
        m = json.loads(line)
        row = source.get(m['id'])
        if not row or not m.get('mapped'):
            continue
        stats['mapped'] += 1
        if m['confidence'] < MIN_CONFIDENCE:
            stats['low confidence'] += 1; continue
        reactants, _, products = m['mapped'].partition('>>')
        smarts = ord_builder._template(reactants, '', products, m['id'])
        if not smarts:
            stats['no template'] += 1; continue
        if row['generic']:
            # The template is retro (products>>reactants); R atoms keep their map numbers on both sides.
            r_numbers = r_map_numbers(row['genericProducts'], products) | r_map_numbers(row['genericReactants'], reactants)
            # An R that is itself in the reaction centre, or leaves (unmapped: the book's R was really a
            # leaving or protecting group), cannot become 'any atom': the template would be nonsense. Drop it.
            if 0 in r_numbers or r_numbers & changed_atoms(reactants, products):
                stats['R in reaction centre'] = stats.get('R in reaction centre', 0) + 1; continue
            if r_numbers:
                smarts = ATOM.sub(lambda a: f'[*:{a.group(1)}]' if int(a.group(1)) in r_numbers else a.group(0), smarts)
            stats['generic'] += 1
        else:
            stats['real'] += 1
        if Chem.MolFromSmarts(smarts.split('>>')[0]) is None:
            stats['no template'] += 1; continue
        entry = templates.setdefault(smarts, {'count': 0, 'generic': 0, 'sources': []})
        entry['count'] += 1
        entry['generic'] += row['generic']
        if len(entry['sources']) < 5:
            entry['sources'].append({k: row.get(k) for k in ('book', 'nodusId', 'page', 'kind', 'reagents', 'status')} | {'generic': row['generic']})
    with open(OUT, 'w') as fh:
        json.dump(templates, fh)
    print(f'{len(templates)} distinct templates from {stats} -> {OUT}')


if __name__ == '__main__':
    {'export': export, 'map': map_reactions, 'extract': extract}[sys.argv[1]]()
