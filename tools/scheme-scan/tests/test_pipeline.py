import contextlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import gaps
import reagents
import scan
import templates as t
from template_validation import components, outcomes, round_trip

CYANIDE = 'Br[CH2:2][CH3:1].[C-:3]#[N:4].[Na+]>>[CH3:1][CH2:2][C:3]#[N:4]'
CYANIDE_OLD = 'Br[CH2:2][CH3:1]>>[CH3:1][CH2:2][C:3]#[N:4]'
ETHER = 'Br[CH2:2][CH3:1].[O-:3][CH2:4][CH3:5].[Na+]>>[CH3:1][CH2:2][O:3][CH2:4][CH3:5]'
BROMINATION = '[Br:1][Br:8].[CH:2]1=[CH:7][CH2:6][CH2:5][CH2:4][CH2:3]1>>[Br:1][CH:2]1[CH2:3][CH2:4][CH2:5][CH2:6][CH:7]1[Br:8]'
BROMINATION_OLD = BROMINATION.split('.', 1)[1]
EPOXIDATION = '[CH2:1]1[CH2:2][CH2:3][CH:4]=[CH:6][CH2:7]1.O=C(O[OH:5])c1cccc(Cl)c1>>[CH2:1]1[CH2:2][CH2:3][CH:4]2[O:5][CH:6]2[CH2:7]1'
PINACOL = 'O[C:4]([C:2]([CH3:1])([OH:3])[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1)([CH3:5])[c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1>>[CH3:1][C:2](=[O:3])[C:4]([CH3:5])([c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1)[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1'
ESTER = 'CC[O:3][C:2](=[O:1])[c:4]1[cH:5][cH:6][cH:7][cH:8][cH:9]1>>[O:1]=[C:2]([OH:3])[c:4]1[cH:5][cH:6][cH:7][cH:8][cH:9]1'
ESTER_WATER = 'CCO[C:2](=[O:1])[c:4]1[cH:5][cH:6][cH:7][cH:8][cH:9]1.[OH2:3]>>[O:1]=[C:2]([OH:3])[c:4]1[cH:5][cH:6][cH:7][cH:8][cH:9]1'


def row(mapped, reagents=(), conditions='', rid='1:0:v2', base=None):
    left, _, right = mapped.partition('>>')
    rxn = '.'.join(components(left)) + '>>' + '.'.join(components(right))
    return {'id': rid, 'rxn': rxn, 'baseReaction': base or rxn, 'generic': False,
            'reagentSmiles': list(reagents), 'reagents': conditions, 'book': 'fixture', 'page': 1}


def mapping(mapped, source, confidence=.9):
    return {'id': source['id'], 'inputHash': t.input_hash(source), 'mapped': mapped, 'confidence': confidence}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        paths = {'WORK': str(self.work)}
        for attr, name in [('TO_MAP', 'to-map.jsonl'), ('MAPPED', 'mapped.jsonl'), ('OUT', 'templates.json'),
                           ('AUDIT', 'audit.json'), ('MERGED', 'merged.jsonl'), ('MERGED_ROWS', 'merged-to-map.jsonl'),
                           ('MERGED_META', 'merged-inputs.json')]:
            paths[attr] = str(self.work / name)
        self.patch = patch.multiple(t, **paths)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def put(self, source, mapped, confidence=.9):
        t.write_rows(t.TO_MAP, [source])
        m = mapping(mapped, source, confidence)
        t.write_rows(t.MAPPED, [m])
        return m

    def fallback(self, source, mapped, confidence=.9):
        directory = self.work / 'fallback'
        directory.mkdir(exist_ok=True)
        t.write_rows(str(directory / 'to-map.jsonl'), [source])
        t.write_rows(str(directory / 'mapped.jsonl'), [mapping(mapped, source, confidence)])
        return str(directory)

    def test_ionic_reagent_fragments_contribute(self):
        for mapped, extra in [(CYANIDE, ['[Na+].[C-]#N']), (ETHER, ['CC[O-].[Na+]'])]:
            self.assertTrue(t.reagent_atoms_used(mapped, extra))
        self.assertFalse(t.reagent_atoms_used(CYANIDE, ['[Na+]']))

    def test_ionic_mapping_wins_and_template_recovers_reactants(self):
        base = 'CCBr>>CCC#N'
        new = row(CYANIDE, ['[Na+].[C-]#N'], 'NaCN', base=base)
        self.put(new, CYANIDE, .921)
        old = row(CYANIDE_OLD, conditions='NaCN', base=base)
        fallback = self.fallback(old, CYANIDE_OLD, .834)
        t.merge(fallback)
        self.assertEqual(t.mapping_inputs(), (t.MERGED, t.MERGED_ROWS))
        self.assertEqual(t.load_rows(t.MERGED)[new['id']]['mapped'], CYANIDE)
        t.extract()
        extracted = json.loads(Path(t.OUT).read_text())
        self.assertEqual(len(extracted), 1)
        self.assertIn(('CCBr', '[C-]#N'), outcomes(next(iter(extracted)), 'CCC#N'))

    def test_direct_reagent_extraction_uses_its_confidence_floor(self):
        for mapped, extra, confidence in [(BROMINATION, ['BrBr'], .321),
                                          (EPOXIDATION, ['O=C(OO)c1cccc(Cl)c1'], .377)]:
            source = row(mapped, extra)
            self.put(source, mapped, confidence)
            t.extract()
            self.assertEqual(len(json.loads(Path(t.OUT).read_text())), 1)

    def test_valid_rearrangement_is_soft_and_survives_extraction(self):
        source = row(PINACOL, conditions='H2SO4, heat')
        m = self.put(source, PINACOL, .772)
        hard, soft, _ = t.audit_reaction(PINACOL, 'H2SO4, heat')
        self.assertFalse(hard)
        self.assertIn('1,2-shift', soft)
        t.audit()
        t.extract()
        extracted = json.loads(Path(t.OUT).read_text())
        self.assertEqual(len(extracted), 1)
        self.assertTrue(round_trip(next(iter(extracted)), m['mapped']))

    def test_zero_and_unmatched_product_maps_are_hard_errors(self):
        hard, _, detail = t.audit_reaction(BROMINATION_OLD, 'Br2')
        self.assertIn('unmapped product atoms', hard)
        self.assertEqual(detail['unmapped'], 2)
        hard, _, _ = t.audit_reaction('[CH3:1][CH3:2]>>[CH3:1][CH2:2]O', 'H2O')
        self.assertIn('unmapped product atoms', hard)

    def test_element_and_duplicate_maps_are_rejected(self):
        self.assertIn('element mismatch', t.audit_reaction('[CH3:1][OH:2]>>[CH3:1][NH2:2]', '')[0])
        self.assertIn('duplicate atom maps', t.audit_reaction('[CH3:1][CH3:1]>>[CH3:1][CH3:2]', '')[0])

    def test_stale_audit_cannot_exclude_corrected_mapping(self):
        source = row(BROMINATION, ['BrBr'])
        self.put(source, BROMINATION, .321)
        Path(t.AUDIT).write_text(json.dumps({source['id']: {'hard': ['1,2-shift']}}))
        t.extract()
        self.assertEqual(len(json.loads(Path(t.OUT).read_text())), 1)

    def test_low_confidence_new_mapping_preserves_usable_fallback(self):
        base = 'CCOC(=O)c1ccccc1>>O=C(O)c1ccccc1'
        new = row(ESTER_WATER, ['O'], base=base)
        self.put(new, ESTER_WATER, .29)
        old = row(ESTER, base=base)
        fallback = self.fallback(old, ESTER, .938)
        t.merge(fallback)
        self.assertEqual(t.load_rows(t.MERGED)[new['id']]['mapped'], ESTER)

    def test_invalid_new_mapping_preserves_usable_fallback(self):
        base = 'CCOC(=O)c1ccccc1>>O=C(O)c1ccccc1'
        new = row(ESTER_WATER, ['O'], base=base)
        invalid = ESTER_WATER.rsplit('>>', 1)[0] + '>>[O:1]=[C:2]([OH:3])[c:4]1[cH:5][cH:6][cH:7][cH:8][cH:99]1'
        self.put(new, invalid)
        old = row(ESTER, base=base)
        fallback = self.fallback(old, ESTER)
        t.merge(fallback)
        self.assertEqual(t.load_rows(t.MERGED)[new['id']]['mapped'], ESTER)

    def test_changed_substrate_does_not_use_old_fallback(self):
        new = row(ESTER_WATER, ['O'], base='changed')
        self.put(new, ESTER_WATER, .29)
        old = row(ESTER, base='older')
        t.merge(self.fallback(old, ESTER))
        self.assertFalse(t.load_rows(t.MERGED))

    def test_changed_metadata_does_not_reuse_old_fallback(self):
        base = 'CCOC(=O)c1ccccc1>>O=C(O)c1ccccc1'
        new = row(ESTER_WATER, ['O'], base=base)
        self.put(new, ESTER_WATER, .29)
        old = dict(row(ESTER, base=base), book='outdated citation')
        t.merge(self.fallback(old, ESTER))
        self.assertFalse(t.load_rows(t.MERGED))

    def test_merge_invalidates_when_primary_or_fallback_content_changes(self):
        source = row(ESTER)
        self.put(source, ESTER)
        fallback = self.fallback(source, ESTER)
        for changed in [Path(t.TO_MAP), Path(fallback) / 'mapped.jsonl', Path(t.MERGED)]:
            t.merge(fallback)
            self.assertEqual(t.mapping_inputs(), (t.MERGED, t.MERGED_ROWS))
            changed.write_text(changed.read_text() + '\n')
            self.assertEqual(t.mapping_inputs(), (t.MAPPED, t.TO_MAP))

    def test_legacy_merge_without_manifest_is_not_reused(self):
        t.write_rows(t.MERGED, [])
        t.write_rows(t.MERGED_ROWS, [])
        self.assertEqual(t.mapping_inputs(), (t.MAPPED, t.TO_MAP))

    def test_changed_input_and_failed_or_legacy_maps_are_remapped(self):
        source = row(BROMINATION, ['BrBr'])
        calls = []
        class Mapper:
            def get_attention_guided_atom_maps(self, rxns):
                calls.extend(rxns)
                return [{'mapped_rxn': BROMINATION, 'confidence': .321} for _ in rxns]
        with patch.dict(sys.modules, {'rxnmapper': types.SimpleNamespace(RXNMapper=Mapper)}):
            t.write_rows(t.TO_MAP, [source])
            for old in [{'id': source['id'], 'mapped': BROMINATION_OLD, 'confidence': .6},
                        dict(mapping(BROMINATION, dict(source, reagents='older')), confidence=.6),
                        dict(mapping(BROMINATION, source), mapped=None)]:
                t.write_rows(t.MAPPED, [old])
                t.map_reactions()
            self.assertEqual(len(calls), 3)
            t.map_reactions()
            self.assertEqual(len(calls), 3)
            t.extract()
            self.assertEqual(next(iter(json.loads(Path(t.OUT).read_text()).values()))['count'], 1)

    def test_export_reagents_invalidates_derived_files_and_remaps(self):
        with patch.object(scan, 'DB', str(self.work / 'scan.sqlite')):
            con = scan.connect()
            con.execute('INSERT INTO books(book_key,title) VALUES(?,?)', ('fixture', 'fixture'))
            con.execute('INSERT INTO items(id,book_key,page,kind,ordinal) VALUES(?,?,?,?,?)', (1,'fixture',1,'pdf',1))
            con.execute('INSERT INTO records(item_id,n,reactants,products,reagents,status,checks,source) VALUES(?,?,?,?,?,?,?,?)',
                        (1,0,'["C1=CCCCC1"]','["BrC1CCCCC1Br"]','Br2','confirmed','[]','v2'))
            con.commit()
            t.export()
            old = next(iter(t.load_rows(t.TO_MAP).values()))
            t.write_rows(t.MAPPED, [mapping(BROMINATION_OLD, old, .515)])
            for path in [t.MERGED, t.MERGED_ROWS, t.MERGED_META, t.AUDIT, t.OUT]:
                Path(path).write_text('{}')
            t.export(with_reagents=True)
            self.assertTrue(all(not Path(path).exists() for path in [t.MERGED, t.MERGED_ROWS, t.MERGED_META, t.AUDIT, t.OUT]))
            new = next(iter(t.load_rows(t.TO_MAP).values()))
            self.assertIn('BrBr', new['rxn'])
            self.assertFalse(t.current_maps(t.MAPPED, {new['id']: new}))

    def test_broken_template_is_not_admitted(self):
        source = row(ESTER)
        m = mapping(ESTER, source)
        with patch('rdchiral.template_extractor.extract_from_reaction', return_value={'reaction_smarts': '[CH3:1]>>[CH4:1]'}):
            self.assertEqual(t.checked_template(m, source), (None, 'round trip failed'))

    def test_export_filters_impossible_atom_sources_and_trims_reagents(self):
        with patch.object(scan, 'DB', str(self.work / 'scan.sqlite')):
            con = scan.connect()
            con.execute('INSERT INTO books(book_key,title) VALUES(?,?)', ('fixture', 'fixture'))
            cases = [('C=CC', 'CCCO'), ('C' * 108 + 'O', 'C' * 108 + '=O')]
            for n, (r, p) in enumerate(cases, 1):
                con.execute('INSERT INTO items(id,book_key,page,kind,ordinal) VALUES(?,?,?,?,?)', (n,'fixture',n,'pdf',n))
                con.execute('INSERT INTO records(item_id,n,reactants,products,reagents,status,checks,source) VALUES(?,?,?,?,?,?,?,?)',
                            (n,0,json.dumps([r]),json.dumps([p]),'BH3, H2O2, NaOH','confirmed','[]','v2'))
            con.commit()
            t.export(with_reagents=True)
            rows = t.load_rows(t.TO_MAP)
            self.assertEqual(len(rows), 2)
            self.assertNotIn('B', rows['1:0:v2']['reagentSmiles'])
            self.assertIn('BH3', rows['1:0:v2']['reagents'])
            self.assertIn('OO', rows['1:0:v2']['reagentSmiles'])
            self.assertEqual(rows['2:0:v2']['reagentSmiles'], ['OO'])

    def test_round_trip_keeps_duplicate_reactants(self):
        mapped = '[CH3:1][CH:2]=[O:3].[CH3:4][CH:5]=[O:6]>>[CH3:1][CH:2]([OH:3])[CH2:4][CH:5]=[O:6]'
        source = row(mapped)
        smarts, reason = t.checked_template(mapping(mapped, source), source)
        self.assertIsNone(reason)
        self.assertIn(('CC=O', 'CC=O'), outcomes(smarts, 'CC(O)CC=O'))

    def test_generic_groups_survive_correct_template(self):
        # RXNMapper numbers can differ from RDChiral's canonical template numbers.
        mapped = '[CH3:101][C:202]([CH3:303])=[O:404]>>[CH3:101][CH:202]([CH3:303])[OH:404]'
        source = dict(row(mapped), generic=True, genericReactants=['*C(C)=O'], genericProducts=['*C(C)O'])
        smarts, reason = t.checked_template(mapping(mapped, source), source)
        self.assertIsNone(reason)
        self.assertIn('[*:', smarts)
        self.assertTrue(round_trip(smarts, mapped))
        self.assertIn(('CCC(C)=O',), outcomes(smarts, 'CCC(C)O'))

    def test_multiple_products_form_one_applicable_retro_query(self):
        mapped = '[CH3:1][CH:2]=[CH:3][CH3:4].[O:5]=[O:6]>>[CH3:1][CH:2]=[O:5].[CH:3]([CH3:4])=[O:6]'
        source = row(mapped, ['O=O'])
        m = self.put(source, mapped)
        smarts, reason = t.checked_template(m, source)
        self.assertIsNone(reason)
        self.assertTrue(round_trip(smarts, mapped))
        t.extract()
        self.assertEqual(len(json.loads(Path(t.OUT).read_text())), 1)


class ReagentTests(unittest.TestCase):
    def test_stereochemical_and_salt_smiles_are_preserved(self):
        for text in ['C/C=C/C', 'C/C=C\\C', 'COC(=O)/C=C/C(=O)OC', 'CC[O-].[Na+]']:
            with self.subTest(text=text):
                self.assertEqual(reagents.tokens(text), [text])
                self.assertEqual(tuple(reagents.reagent_smiles(text, lambda _: None)), ('.'.join(components(text)),))
                self.assertFalse(reagents.candidates(text))

    def test_text_separators_and_unicode_formulas(self):
        for text, expected in [('H2/Pt', ['[H][H]']), ('H₂O₂, NaOH', ['OO', '[Na+].[OH-]']),
                               ('1) BH3, THF; 2) H2O2, NaOH', ['B','OO','[Na+].[OH-]'])]:
            self.assertEqual(reagents.reagent_smiles(text, lambda _:None), expected)

    def test_nonparticipants_and_generic_labels_are_ignored(self):
        self.assertFalse(reagents.reagent_smiles('THF, Pd/C, RCO3H', lambda _: None))

    def test_formula_consistency_is_required(self):
        self.assertTrue(reagents.consistent('(CH3)2CHCH2Li', 'CC(C)C[Li]'))
        self.assertFalse(reagents.consistent('C7H7SO2Cl', 'CC(=O)Cl'))

    def cache(self):
        cache = sqlite3.connect(':memory:', check_same_thread=False)
        cache.execute('CREATE TABLE names(name TEXT PRIMARY KEY, smiles TEXT, source TEXT)')
        cache.execute('CREATE TABLE answers(name TEXT, provider TEXT, role TEXT, smiles TEXT, PRIMARY KEY(name,provider))')
        self.addCleanup(cache.close)
        return cache

    def test_nonparticipant_decision_requires_two_models(self):
        cache = self.cache()
        cache.execute('INSERT INTO answers VALUES(?,?,?,?)', ('unknown','deepseek','other',None))
        self.assertTrue(reagents.decide(cache)[1])
        cache.execute('INSERT INTO answers VALUES(?,?,?,?)', ('unknown','anthropic','other',None))
        self.assertFalse(reagents.decide(cache)[1])

    def test_capped_provider_pass_and_partial_replies(self):
        cache = self.cache()
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp) / 'keys.json'
            keys.write_text('{}')
            with patch.dict('os.environ', {'REAGENT_KEYS_FILE': str(keys)}), \
                 patch.object(reagents, '_ask', return_value=('{"items":[{"name":"one","role":"other"}]}', (1000000, 0))) as ask, \
                 contextlib.redirect_stdout(io.StringIO()):
                reagents.collect('deepseek', ['one','two'], {}, cache, batch=1, cap=.01)
                self.assertEqual(ask.call_count, 1)
                self.assertEqual(cache.execute('SELECT name FROM answers').fetchall(), [('one',)])
                reagents.collect('deepseek', ['two'], {}, cache, cap=0)
                self.assertEqual(ask.call_count, 1)

    def test_llm_zero_cap_cli_needs_no_keys_or_network(self):
        result = subprocess.run([sys.executable, str(HERE/'reagents.py'), 'llm', '--cap', '0'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('no requests sent', result.stdout)

    def test_malformed_and_missing_llm_items_can_be_retried(self):
        import threading
        cache = self.cache()
        with contextlib.redirect_stdout(io.StringIO()):
            for text in ['not json', '{"items":null}', '{"items":[{"name":"one","role":"reagent","smiles":42}]}']:
                reagents.save_reply(['one','two'], (text,(0,0)), cache, threading.Lock(), 'deepseek', (0,0), 0, 0, 1)
        self.assertEqual(cache.execute('SELECT name,smiles FROM answers').fetchall(), [('one',None)])
        self.assertTrue(reagents.decide(cache)[1])


class GapTests(unittest.TestCase):
    def test_only_complete_matching_reactant_multisets_cover_a_type(self):
        mapped = '[CH3:1][CH:2]=[O:3].[CH3:4][CH:5]=[O:6]>>[CH3:1][CH:2]([OH:3])[CH2:4][CH:5]=[O:6]'
        source = row(mapped)
        smarts, _ = t.checked_template(mapping(mapped, source), source)
        types = [{'type':'aldol','class':'C-C','reactants':['CC=O','CC=O'],'product':'CC(O)CC=O'},
                 {'type':'wrong precursor','class':'C-C','reactants':['CCC=O'],'product':'CC(O)CC=O'}]
        report = gaps.coverage(types, [smarts])
        self.assertEqual(report['covered'], 1)
        self.assertTrue(report['types'][0]['covered'])
        self.assertFalse(report['types'][1]['covered'])

    def test_exact_records_and_inorganic_reagents(self):
        types = [{'type':'hydrogenation','class':'reduction','reactants':['C=C','[H][H]'],'product':'CC'}]
        report = gaps.coverage(types, [], [{'reaction':'C=C>>CC'}])
        self.assertEqual(report['recordCovered'], 1)

    def test_catalogue_and_gap_cli(self):
        from rdkit import Chem
        catalogue = json.loads((HERE/'reaction-types.json').read_text())['types']
        self.assertEqual(len(catalogue), 86)
        self.assertTrue(all(Chem.MolFromSmiles(s) is not None for r in catalogue for s in r['reactants']+[r['product']]))
        with tempfile.TemporaryDirectory() as tmp:
            templates = Path(tmp) / 'templates.json'
            report = Path(tmp) / 'gaps.json'
            templates.write_text('{}')
            result = subprocess.run([sys.executable,str(HERE/'gaps.py'),'--templates',str(templates),'--json',str(report)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(report.read_text())['covered'], 0)
            self.assertIn('0/86', result.stdout)


if __name__ == '__main__':
    unittest.main()
