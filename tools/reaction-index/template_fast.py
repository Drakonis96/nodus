"""Fast, size-independent reaction-center template extraction.

Replaces RDChiral for building the index. RDChiral canonicalizes the *whole* mapped
molecule (which blows up on large peptides); this works only on the reacting atoms and
their first shell, so cost is O(centre), not O(molecule).

Given an atom-mapped `reactants>>products`, it finds the atoms and bonds that change,
expands them by `radius`, renders each side's centre as SMARTS (atom maps preserved) and
returns the retro template `product_smarts >> reactant_smarts`, appliable with
RDKit's `ReactionFromSmarts(...).RunReactants((product,))`.
"""

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem

RDLogger.DisableLog('rdApp.*')

AROMATIC = 'ar'


def _mol(side):
    return Chem.MolFromSmiles(side)


def _bond_kind(mol, i, j):
    b = mol.GetBondBetweenAtoms(i, j)
    if b is None:
        return None
    return AROMATIC if b.GetIsAromatic() else round(b.GetBondTypeAsDouble(), 1)


def _signal(mol, idx):
    a = mol.GetAtomWithIdx(idx)
    heavy = sum(1 for n in a.GetNeighbors() if n.GetAtomicNum() > 1)
    return (a.GetFormalCharge(), a.GetTotalNumHs(), heavy, a.GetIsAromatic(), a.GetAtomicNum())


def _center(R, P, mr, mp):
    matched = set(mr) & set(mp)
    cr, cp = set(), set()
    for m in matched:
        iR, iP = mr[m], mp[m]
        if _signal(R, iR) != _signal(P, iP):
            cr.add(iR)
            cp.add(iP)
        nR = {R.GetAtomWithIdx(n.GetIdx()).GetAtomMapNum() for n in R.GetAtomWithIdx(iR).GetNeighbors()}
        nP = {P.GetAtomWithIdx(n.GetIdx()).GetAtomMapNum() for n in P.GetAtomWithIdx(iP).GetNeighbors()}
        if nR != nP:
            cr.add(iR)
            cp.add(iP)
        for m2 in (nR & nP) - {0}:
            if _bond_kind(R, iR, mr[m2]) != _bond_kind(P, iP, mp[m2]):
                cr.update({iR, mr[m2]})
                cp.update({iP, mp[m2]})
    for m in set(mr) - set(mp):
        cr.add(mr[m])
    for m in set(mp) - set(mr):
        cp.add(mp[m])
    return cr, cp


WHOLE_MOL_MAX = 30  # fragments this small are kept entire, so small reagents survive


def _keep_for_side(mol, center, radius):
    keep = set()
    frags = Chem.GetMolFrags(mol)
    for frag in frags:
        fset = set(frag)
        hit = fset.intersection(center)
        if not hit:
            continue
        if len(fset) <= WHOLE_MOL_MAX:
            keep |= fset
            continue
        local = set(hit)
        frontier = set(hit)
        for _ in range(radius):
            nxt = set()
            for i in frontier:
                nxt.update(n.GetIdx() for n in mol.GetAtomWithIdx(i).GetNeighbors())
            frontier = (nxt - local)
            local |= nxt
        keep |= local
    # close any ring a kept atom belongs to, so aromaticity survives the submolecule
    for ring in mol.GetRingInfo().AtomRings():
        if keep.intersection(ring):
            keep.update(ring)
    return keep


def _submol_smarts(mol, keep, with_h=False):
    rw = Chem.RWMol()
    idx = {}
    for i in sorted(keep):
        a = mol.GetAtomWithIdx(i)
        na = Chem.Atom(a.GetAtomicNum())
        na.SetFormalCharge(a.GetFormalCharge())
        na.SetIsAromatic(a.GetIsAromatic())
        na.SetAtomMapNum(a.GetAtomMapNum())
        # On the *generated* side keep each atom's hydrogen count (so it produces [OH] not [O]);
        # on the *matched* side leave H free, or the query stops matching the target.
        if with_h:
            na.SetNumExplicitHs(a.GetTotalNumHs())
            na.SetNoImplicit(True)
        idx[i] = rw.AddAtom(na)
    for b in mol.GetBonds():
        i, j = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        if i in idx and j in idx:
            rw.AddBond(idx[i], idx[j], b.GetBondType())
    m = rw.GetMol()
    try:
        Chem.SanitizeMol(m)
    except Exception:
        return None
    return Chem.MolToSmarts(m)


def extract_template(reactants, products, radius=1):
    R, P = _mol(reactants), _mol(products)
    if R is None or P is None:
        return None
    mr = {a.GetAtomMapNum(): a.GetIdx() for a in R.GetAtoms() if a.GetAtomMapNum() > 0}
    mp = {a.GetAtomMapNum(): a.GetIdx() for a in P.GetAtoms() if a.GetAtomMapNum() > 0}
    if not mr or not mp:
        return None
    # a side with a duplicated map number cannot form a clean template
    if sum(1 for a in R.GetAtoms() if a.GetAtomMapNum() > 0) != len(mr):
        return None
    if sum(1 for a in P.GetAtoms() if a.GetAtomMapNum() > 0) != len(mp):
        return None
    cr, cp = _center(R, P, mr, mp)
    if not cr or not cp:
        return None
    # retro: the product side is matched against the target (loose), the reactant side is
    # generated (exact H counts), so the regenerated reactants have the right protons.
    pr = _submol_smarts(R, _keep_for_side(R, cr, radius))
    pp = _submol_smarts(P, _keep_for_side(P, cp, radius))
    if not pr or not pp:
        return None
    return f'{pp}>>{pr}'  # retro: product >> reactants


def _nomap_canon(mol, isomeric=False):
    m = Chem.Mol(mol)
    for a in m.GetAtoms():
        a.SetAtomMapNum(0)
    try:
        Chem.SanitizeMol(m)
    except Exception:
        pass
    return Chem.MolToSmiles(Chem.RemoveHs(m), isomericSmiles=isomeric)


def _side_set(side):
    """Canonical set of the *mapped* components only — solvents/agents the template does not
    claim are excluded, matching what a retro template can regenerate."""
    mol = _mol(side)
    if mol is None:
        return None
    out = []
    for frag in Chem.GetMolFrags(mol, asMols=True):
        if any(a.GetAtomMapNum() > 0 for a in frag.GetAtoms()):
            out.append(_nomap_canon(frag))
    return tuple(sorted(out))


def apply_retro(template, product_smiles, max_sets=50):
    """Reactant sets the retro template predicts for a product, as canonical tuples."""
    mol = _mol(product_smiles)
    if mol is None:
        return []
    out = []
    try:
        rxn = AllChem.ReactionFromSmarts(template)
        combos = list(rxn.RunReactants((mol,)))
    except Exception:
        return []
    for combo in combos[:max_sets]:
        try:
            out.append(tuple(sorted(_nomap_canon(p) for p in combo)))
        except Exception:
            continue
    return out


def round_trip_ok(reactants, products, radius=1):
    t = extract_template(reactants, products, radius)
    if not t:
        return None
    actual = _side_set(reactants)
    if actual is None:
        return None
    return actual in apply_retro(t, products)
