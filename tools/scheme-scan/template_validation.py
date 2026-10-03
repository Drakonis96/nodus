"""Apply RDChiral templates and compare complete, canonical reactant multisets."""
from rdkit import Chem


def components(smiles):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError('unparsable structure')
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return tuple(sorted(Chem.MolToSmiles(frag) for frag in Chem.GetMolFrags(mol, asMols=True)))


def normalize_template(smarts):
    from rdkit.Chem import AllChem
    # RDChiral's API supplies one molecule, which can contain disconnected products.
    # Group a multi-product query into that single reactant template.
    left, _, right = smarts.partition('>>')
    reaction = AllChem.ReactionFromSmarts(smarts)
    if reaction is None or reaction.Validate()[1]:
        raise ValueError('invalid reaction SMARTS')
    if reaction.GetNumReactantTemplates() > 1:
        smarts = f'({left})>>{right}'
    return smarts


def outcomes(smarts, product):
    from rdchiral.main import rdchiralRunText
    return {components(s) for s in rdchiralRunText(normalize_template(smarts), product)}


def round_trip(smarts, mapped):
    """Recover all participating molecules, including unmapped leaving groups, without spectators."""
    reactants, _, products = mapped.partition('>>')
    rm, pm = Chem.MolFromSmiles(reactants), Chem.MolFromSmiles(products)
    product_maps = {a.GetAtomMapNum() for a in pm.GetAtoms() if a.GetAtomMapNum()}
    expected = []
    for fragment in Chem.GetMolFrags(rm, asMols=True):
        if any(a.GetAtomMapNum() in product_maps for a in fragment.GetAtoms()):
            expected.extend(components(Chem.MolToSmiles(fragment)))
    try:
        return bool(expected) and tuple(sorted(expected)) in outcomes(smarts, products)
    except Exception:
        return False
