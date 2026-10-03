#!/usr/bin/env python3
"""Retro templates from textbook schemes, for the textbook index's retro-templates.tsv.zst.

  templates.py export [--reagents]  reactions to map -> <scan db dir>/templates/to-map.jsonl; --reagents adds the
                                 reagent structures the conditions text names (reagents.py), so additions
                                 whose atoms come from a reagent get templates too
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
# A side work directory (SCHEME_TEMPLATES_WORK) builds an alternative template set without touching
# the one the index was built from.
WORK = os.environ.get('SCHEME_TEMPLATES_WORK') or os.path.join(os.path.dirname(DB), 'templates')
TO_MAP, MAPPED, OUT = (os.path.join(WORK, n) for n in ('to-map.jsonl', 'mapped.jsonl', 'templates.json'))
MAX_TOKENS = 500         # RXNMapper's encoder takes 512 tokens; a reaction over it loses reagents first
MAX_ATOMS = 220          # a backstop before tokenising
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


# RXNMapper's SMILES tokeniser (the rxnfp pattern), plus its two special tokens.
SMILES_TOKEN = re.compile(r"(\[[^\]]+]|Br?|Cl?|N|O|S|P|F|I|b|c|n|o|s|p|\(|\)|\.|=|#|-|\+|\\|/|:|~|@|\?|>|\*|\$|%[0-9]{2}|[0-9])")


def reaction_tokens(rxn):
    return len(SMILES_TOKEN.findall(rxn)) + 2


def reagent_lookup(rows):
    """Name -> SMILES for every reagent mention the dictionary does not cover, resolved once with
    OPSIN / PubChem and cached in the work directory (never in scan.sqlite)."""
    import sqlite3
    import reagents
    import scan
    cache = sqlite3.connect(os.path.join(WORK, 'reagent-names.sqlite'))
    cache.execute('CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, smiles TEXT, source TEXT)')
    wanted = sorted({t for row in rows if isinstance(row, str) for t in reagents.candidates(row)})
    print(f'{len(wanted)} distinct reagent names to resolve (cached ones are skipped)', flush=True)
    scan.resolve_names(cache, wanted)
    # A name Gemini classified as a solvent, catalyst or word is '' (known, not a reagent); unknown is None.
    known = {n: (smiles if smiles else ('' if (source or '').startswith(('llm', 'gemini')) else None)) for n, smiles, source in cache.execute('SELECT name, smiles, source FROM names')}
    return known.get


def export(with_reagents=False):
    import scan
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    os.makedirs(WORK, exist_ok=True)
    con = scan.connect()
    rows = con.execute("""SELECT x.item_id, x.n, x.source, x.status, x.reactants, x.products, x.reagents, x.checks, b.title, b.nodus_id, i.page, i.kind
      FROM records x JOIN items i ON i.id = x.item_id JOIN books b ON b.book_key = i.book_key
      WHERE x.status IN ('generic', 'confirmed', 'repaired')""").fetchall()  # 'retro' records are excluded
    if with_reagents:
        import reagents as reagent_text
        lookup = reagent_lookup([row[6] for row in rows])
    seen, out = set(), []
    resolved_rows = 0
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
        # Reagents go on the reactant side so RXNMapper can map the product atoms they supply (the OH
        # of a hydroboration, the Br of a bromination). Over the encoder's limit, the largest go first.
        extra, unresolved = [], []
        if with_reagents and isinstance(reagents, str):
            found, unresolved = reagent_text.reagent_report(reagents, lookup)
            extra = sorted((s for s in found if s not in model_r), key=len)
        rxn = f"{'.'.join(model_r + extra)}>>{'.'.join(model_p)}"
        while extra and reaction_tokens(rxn) > MAX_TOKENS:
            extra.pop()
            rxn = f"{'.'.join(model_r + extra)}>>{'.'.join(model_p)}"
        atoms = sum(Chem.MolFromSmiles(s).GetNumAtoms() for s in model_r + extra + model_p)
        if atoms > MAX_ATOMS or reaction_tokens(rxn) > MAX_TOKENS or rxn in seen:
            continue
        seen.add(rxn)
        resolved_rows += bool(extra)
        out.append({'id': f'{item_id}:{n}:{source}', 'rxn': rxn, 'generic': generic, 'genericReactants': r if generic else None,
                    'genericProducts': p if generic else None, 'book': title, 'nodusId': nodus_id, 'page': page, 'kind': kind,
                    'reagents': reagents if isinstance(reagents, str) else None, 'reagentSmiles': extra,
                    'unresolvedReagents': unresolved, 'status': status})
    with open(TO_MAP, 'w') as fh:
        for row in out:
            fh.write(json.dumps(row) + '\n')
    print(f'{len(out)} distinct reactions to map ({sum(r["generic"] for r in out)} generic, {resolved_rows} with reagent structures) -> {TO_MAP}')


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

AUDIT = os.path.join(WORK, 'audit.json')
# merge(): one mapping per reaction from a reagent run and a reagent-free fallback run.
MERGED, MERGED_ROWS = os.path.join(WORK, 'merged.jsonl'), os.path.join(WORK, 'merged-to-map.jsonl')
# A map in which reagent atoms reach the product is kept down to this confidence: the extra molecules
# lower RXNMapper's score even when the map is right, and the audit screens impossible bond edits.
REAGENT_MIN_CONFIDENCE = 0.3


def mapping_inputs():
    """(mapped file, rows file): the merged set when merge() has run, else this run's own."""
    return (MERGED, MERGED_ROWS) if os.path.exists(MERGED) else (MAPPED, TO_MAP)


def reagent_atoms_used(mapped, reagent_smiles):
    """Whether any product atom maps onto a reagent molecule (one added from the conditions text)."""
    from rdkit import Chem
    reactants, _, products = mapped.partition('>>')
    reagents = {Chem.CanonSmiles(s) for s in reagent_smiles or [] if Chem.MolFromSmiles(s)}
    product_maps = {int(x) for x in re.findall(r':(\d+)\]', products)}
    for fragment in reactants.split('.'):
        mol = Chem.MolFromSmiles(fragment)
        if mol is None:
            continue
        maps = {a.GetAtomMapNum() for a in mol.GetAtoms() if a.GetAtomMapNum()}
        for a in mol.GetAtoms():
            a.SetAtomMapNum(0)
        if Chem.MolToSmiles(mol) in reagents and maps & product_maps:
            return True
    return False


def merge(fallback):
    """Choose one mapping per reaction: the reagent run's where its reagents put atoms into the product
    (kept down to REAGENT_MIN_CONFIDENCE), otherwise the reagent-free run's (`fallback` work directory)
    — a reagent that contributes nothing only lowers the mapper's confidence."""
    from collections import Counter
    from rdkit import RDLogger
    RDLogger.DisableLog('rdApp.*')
    load = lambda path: {json.loads(line)['id']: json.loads(line) for line in open(path)}
    new_rows, new_maps = load(TO_MAP), load(MAPPED)
    old_rows, old_maps = load(os.path.join(fallback, 'to-map.jsonl')), load(os.path.join(fallback, 'mapped.jsonl'))
    tally = Counter()
    with open(MERGED, 'w') as maps_out, open(MERGED_ROWS, 'w') as rows_out:
        for rid in sorted(set(new_maps) | set(old_maps)):
            # A mapping kept from an older export whose reaction is no longer listed has no row: skip it.
            new = new_maps.get(rid) if rid in new_rows else None
            old = old_maps.get(rid) if rid in old_rows else None
            chosen = None
            if new and new.get('mapped') and reagent_atoms_used(new['mapped'], new_rows[rid].get('reagentSmiles')):
                if new['confidence'] >= REAGENT_MIN_CONFIDENCE:
                    chosen, row, floor, how = new, new_rows[rid], REAGENT_MIN_CONFIDENCE, 'reagents used'
                else:
                    tally['reagents used, too uncertain'] += 1; continue
            elif old and old.get('mapped') and old['confidence'] >= MIN_CONFIDENCE:
                chosen, row, floor, how = old, old_rows[rid], MIN_CONFIDENCE, 'reagent-free'
            elif new and new.get('mapped') and new['confidence'] >= MIN_CONFIDENCE:
                chosen, row, floor, how = new, new_rows[rid], MIN_CONFIDENCE, 'reagent run, reagents unused'
            if not chosen:
                tally['no confident mapping'] += 1; continue
            tally[how] += 1
            maps_out.write(json.dumps({**chosen, 'minConfidence': floor}) + '\n')
            rows_out.write(json.dumps(row) + '\n')
    print(dict(tally), '->', MERGED)
# A scheme's own label or conditions that explain a skeletal shift or a bond at an unactivated carbon.
DECLARED = re.compile(r'(?i)rearrange|migrat|isomeri[sz]|wagner|meerwein|pinacol|benzilic|favorskii|wolff|cope\b|'
                      r'ring (?:expansion|contraction)|metathesis|radical|photo|h\s*ν|\bhv\b|light|norrish|NBS|AIBN|'
                      r'C[–-]H (?:activation|functionali[sz]ation|insertion|oxidation)|carbene|nitrene|insertion')
# Conditions that can create stereocentres from achiral inputs.
ASYMMETRIC = re.compile(r'(?i)asymmetric|enantio|chiral|\((?:R|S|R,R|S,S)\)|\b(?:CBS|Sharpless|AD-mix|BINAP|DIPT|DET|Evans|'
                        r'auxiliar|enzyme|lipase|proline|Corey|Noyori|Jacobsen|Shi|Ru-BINAP|Rh-DIPAMP|ee\b)')


def audit_reaction(mapped, conditions, ignore=frozenset()):
    """Flags for one atom-mapped reaction, read from its maps (so a scheme that leaves out its
    by-products is still checked). Hard flags exclude the reaction from the templates; soft ones are
    reported. Returns (hard, soft, details)."""
    from rdkit import Chem
    reactants, _, products = mapped.partition('>>')
    rm, pm = Chem.MolFromSmiles(reactants), Chem.MolFromSmiles(products)
    if rm is None or pm is None:
        return ['unparsed'], [], {}
    r_atom = {a.GetAtomMapNum(): a for a in rm.GetAtoms() if a.GetAtomMapNum()}
    p_atom = {a.GetAtomMapNum(): a for a in pm.GetAtoms() if a.GetAtomMapNum()}
    def edges(mol):
        return {frozenset((b.GetBeginAtom().GetAtomMapNum(), b.GetEndAtom().GetAtomMapNum())) for b in mol.GetBonds()
                if b.GetBeginAtom().GetAtomMapNum() and b.GetEndAtom().GetAtomMapNum()}
    rb, pb = edges(rm), edges(pm)
    # Atoms that stood for R or X in a generic scheme (`ignore`) are model methyls: an edit at one says
    # nothing about the chemistry, and extract already drops an R in the reaction centre.
    formed = [tuple(e) for e in pb - rb if all(m in r_atom for m in e) and not (set(e) & ignore)]
    broken = [tuple(e) for e in rb - pb if all(m in p_atom for m in e) and not (set(e) & ignore)]
    pi = lambda a: a.GetIsAromatic() or any(b.GetBondType() != Chem.BondType.SINGLE for b in a.GetBonds())
    def activated(m):
        a = r_atom[m]
        return (a.GetFormalCharge() != 0 or a.GetNumRadicalElectrons() > 0 or pi(a)
                or any(n.GetAtomicNum() not in (1, 6) for n in a.GetNeighbors())
                or any(n.GetAtomicNum() == 6 and pi(n) for n in a.GetNeighbors()))
    carbon = lambda m: r_atom[m].GetAtomicNum() == 6
    declared = bool(DECLARED.search(conditions or ''))
    hard, soft, details = [], [], {}
    cc_formed = [e for e in formed if carbon(e[0]) and carbon(e[1])]
    cx_formed = [e for e in formed if carbon(e[0]) != carbon(e[1])]
    cc_broken = [e for e in broken if carbon(e[0]) and carbon(e[1])]
    if any(not (activated(a) and activated(b)) for a, b in cc_formed) and not declared:
        hard.append('unactivated C–C')
    if any(not activated(a if carbon(a) else b) for a, b in cx_formed) and not declared:
        hard.append('unactivated C–X')
    r_bonded = lambda a, b: r_atom[a].GetOwningMol().GetBondBetweenAtoms(r_atom[a].GetIdx(), r_atom[b].GetIdx()) is not None
    migration = any(m in f and m in c and r_bonded(next(x for x in f if x != m), next(x for x in c if x != m))
                    for f in cc_formed for c in cc_broken for m in set(f) & set(c))
    if migration and not declared:
        hard.append('1,2-shift')
    if not migration and cc_formed and not declared:
        for a, b in cc_broken:
            path = Chem.GetShortestPath(pm, p_atom[a].GetIdx(), p_atom[b].GetIdx())
            if path:
                hard.append('reorganised skeleton'); break
    unmapped = sum(1 for a in pm.GetAtoms() if not a.GetAtomMapNum() and a.GetAtomicNum() > 1)
    if unmapped:
        soft.append('unmapped product atoms'); details['unmapped'] = unmapped
    centres = lambda mol: [c for c in Chem.FindMolChiralCenters(mol, useLegacyImplementation=False) if c[1] in ('R', 'S')]
    if centres(pm) and not centres(rm) and not ASYMMETRIC.search(conditions or ''):
        soft.append('stereo from achiral inputs'); details['stereocentres'] = len(centres(pm))
    return hard, soft, details


def audit():
    """Check every mapped reaction before it becomes a template: unresolved reagents, product atoms
    from no listed species, a bond at an unactivated carbon, an undeclared 1,2-shift or skeletal
    reorganisation, stereocentres drawn from achiral inputs. Writes audit.json (read by extract) and
    audit.tsv (for review)."""
    from collections import Counter
    from rdkit import RDLogger
    RDLogger.DisableLog('rdApp.*')
    mapped_path, rows_path = mapping_inputs()
    source = {json.loads(line)['id']: json.loads(line) for line in open(rows_path)}
    results, tally = {}, Counter()
    for line in open(mapped_path):
        m = json.loads(line)
        row = source.get(m['id'])
        if not row or not m.get('mapped') or m['confidence'] < m.get('minConfidence', MIN_CONFIDENCE):
            continue
        ignore = frozenset()
        if row['generic']:
            reactants_m, _, products_m = m['mapped'].partition('>>')
            ignore = frozenset(r_map_numbers(row['genericProducts'], products_m) | r_map_numbers(row['genericReactants'], reactants_m)) - {0}
        hard, soft, details = audit_reaction(m['mapped'], row.get('reagents'), ignore)
        if row.get('unresolvedReagents'):
            soft.append('unresolved reagents'); details['unresolved'] = row['unresolvedReagents']
        results[m['id']] = {'hard': hard, 'soft': soft, **details}
        tally['checked'] += 1
        tally.update(hard + soft)
        tally['clean'] += not hard and not soft
    json.dump(results, open(AUDIT, 'w'))
    with open(os.path.join(WORK, 'audit.tsv'), 'w') as fh:
        fh.write('id\tbook\tpage\thard\tsoft\tdetails\tconditions\n')
        for rid, res in results.items():
            if res['hard'] or res['soft']:
                row = source[rid]
                extra = {k: v for k, v in res.items() if k not in ('hard', 'soft')}
                fh.write(f"{rid}\t{row.get('book') or ''}\t{row.get('page') or ''}\t{','.join(res['hard'])}\t{','.join(res['soft'])}\t"
                         f"{json.dumps(extra)}\t{(row.get('reagents') or '').replace(chr(10), ' | ')[:160]}\n")
    print(dict(tally), '->', AUDIT)


def extract():
    sys.path.insert(0, os.path.join(HERE, '..', 'reaction-index'))
    import build_index as ord_builder
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog('rdApp.*')
    mapped_path, rows_path = mapping_inputs()
    source = {json.loads(line)['id']: json.loads(line) for line in open(rows_path)}
    audited = json.load(open(AUDIT)) if os.path.exists(AUDIT) else {}
    templates, stats = {}, {'mapped': 0, 'low confidence': 0, 'no template': 0, 'generic': 0, 'real': 0, 'audit excluded': 0}
    for line in open(mapped_path):
        m = json.loads(line)
        row = source.get(m['id'])
        if not row or not m.get('mapped'):
            continue
        stats['mapped'] += 1
        if m['confidence'] < m.get('minConfidence', MIN_CONFIDENCE):
            stats['low confidence'] += 1; continue
        if audited.get(m['id'], {}).get('hard'):
            stats['audit excluded'] += 1; continue  # an impossible bond edit: not a reaction to learn from
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
    if sys.argv[1] == 'export':
        export(with_reagents='--reagents' in sys.argv)
    else:
        if sys.argv[1] == 'merge':
            merge(sys.argv[2])
        else:
            {'map': map_reactions, 'audit': audit, 'extract': extract}[sys.argv[1]]()
