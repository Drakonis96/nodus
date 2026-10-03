#!/usr/bin/env python3
"""Reproducible structural coverage of reaction-types.json by local templates and exact records.

  gaps.py --templates /path/to/templates.json [--json report.json]
  gaps.py --index /path/to/index [--templates alternative.json] [--json report.json]

Coverage requires recovering the complete organic reactant multiset for a type's model product.
This measures transformations, not proof of a named mechanism or generality on all substrates.
"""
import argparse
import json
from pathlib import Path

from rdkit import Chem, RDLogger
from template_validation import components, outcomes

HERE = Path(__file__).resolve().parent


def organic_components(smiles):
    return tuple(s for s in components(smiles)
                 if any(a.GetAtomicNum() == 6 for a in Chem.MolFromSmiles(s).GetAtoms()))


def coverage(types, templates, records=()):
    exact = set()
    for record in records:
        left, sep, right = record.get('reaction', '').partition('>>')
        if sep:
            exact.add((components(right), organic_components(left)))
    report = []
    for reaction in types:
        product = reaction['product']
        expected = organic_components('.'.join(reaction['reactants']))
        record_hit = (components(product), expected) in exact
        hit = None
        for template in templates:
            try:
                if any(organic_components('.'.join(predicted)) == expected for predicted in outcomes(template, product)):
                    hit = template; break
            except Exception:
                continue  # a template for another reaction, or one an older index cannot apply
        report.append({'type': reaction['type'], 'class': reaction['class'], 'covered': record_hit or hit is not None,
                       'record': record_hit, 'template': hit})
    return {'total': len(report), 'covered': sum(r['covered'] for r in report),
            'templateCovered': sum(r['template'] is not None for r in report),
            'recordCovered': sum(r['record'] for r in report), 'types': report}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--templates', type=Path)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--types', type=Path, default=HERE / 'reaction-types.json')
    parser.add_argument('--json', type=Path, help='save the full per-type report')
    args = parser.parse_args()
    if not args.templates and not args.index:
        parser.error('provide --templates or --index')
    RDLogger.DisableLog('rdApp.*')
    templates_path = args.templates or args.index / 'template-sources.json'
    try:
        templates = json.loads(templates_path.read_text())
        if not isinstance(templates, dict):
            raise ValueError('templates must be a SMARTS-keyed JSON object')
        records_json = json.loads((args.index / 'records.json').read_text()) if args.index else {}
        if not isinstance(records_json, dict):
            raise ValueError('records must be an ID-keyed JSON object')
        records = records_json.values()
        types = json.loads(args.types.read_text())['types']
        for reaction in types:
            if not organic_components('.'.join(reaction['reactants'])) or not components(reaction['product']):
                raise ValueError(f'invalid model reaction: {reaction["type"]}')
        report = coverage(types, templates, records)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{report["covered"]}/{report["total"]} types covered '
          f'({report["templateCovered"]} by templates, {report["recordCovered"]} by records)')
    for row in report['types']:
        if not row['covered']:
            print(f'GAP\t{row["class"]}\t{row["type"]}')


if __name__ == '__main__':
    main()
