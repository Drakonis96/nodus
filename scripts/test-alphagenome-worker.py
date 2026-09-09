"""Offline adapter checks using the installed, real AlphaGenome SDK types.

Run with the skill runtime's Python; no API key or network request is used.
All arrays below are synthetic, not AlphaGenome outputs.
"""
import contextlib
import io
import json
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from alphagenome.data import genome, track_data
from alphagenome.models import dna_client, dna_output
import alphagenome_worker as worker

PLAN = dict(version=1, assembly='GRCh38', variant='chr22:36201698:A:C', tissue='UBERON:0001157', output='RNA_SEQ')


def output(resolution=1, tracks=2):
    interval = genome.Interval('chr22', 36193505, 36209889)
    metadata = pd.DataFrame({'name': [f'SYNTHETIC {i}' for i in range(tracks)], 'strand': ['+'] * tracks})
    values = np.arange(16384 // resolution * tracks, dtype=np.float32).reshape(-1, tracks)
    ref = track_data.TrackData(values=values, metadata=metadata, resolution=resolution, interval=interval)
    alt = track_data.TrackData(values=values + 2, metadata=metadata.copy(), resolution=resolution, interval=interval)
    return dna_output.VariantOutput(reference=dna_output.Output(rna_seq=ref), alternate=dna_output.Output(rna_seq=alt))


class AdapterTests(unittest.TestCase):
    def test_means_and_track_limit(self):
        result = worker.summarize(output(tracks=10), PLAN)
        self.assertEqual(result['totalTracks'], 10)
        self.assertEqual(len(result['tracks']), 8)
        first = result['tracks'][0]
        self.assertEqual(len(first['reference']), 256)
        self.assertEqual(first['reference'][0], np.arange(0, 640, 10).mean())
        self.assertEqual(first['alternate'][0] - first['reference'][0], 2)

    def test_coarse_output_is_not_upsampled(self):
        result = worker.summarize(output(resolution=128), PLAN)
        self.assertEqual(len(result['tracks'][0]['reference']), 128)
        self.assertEqual(result['tracks'][0]['resolution'], 128)

    def test_reject_bad_metadata_and_nonfinite_values(self):
        data = output()
        data.alternate.rna_seq.metadata.loc[0, 'name'] = 'Different track'
        with self.assertRaises(ValueError):
            worker.summarize(data, PLAN)
        data = output()
        data.reference.rna_seq.values[0, 0] = np.nan
        with self.assertRaises(ValueError):
            worker.summarize(data, PLAN)

    def test_real_sdk_contract_and_stdin_only_key(self):
        class FakeClient:
            def predict_variant(self, **kwargs):
                self_outer.assertEqual(kwargs['variant'].position, 36201698)
                self_outer.assertEqual(kwargs['interval'].start, 36193505)
                self_outer.assertEqual(kwargs['interval'].width, 16384)
                self_outer.assertEqual(kwargs['organism'], dna_client.Organism.HOMO_SAPIENS)
                self_outer.assertEqual(kwargs['ontology_terms'], ['UBERON:0001157'])
                self_outer.assertEqual(kwargs['requested_outputs'], [dna_client.OutputType.RNA_SEQ])
                return output()
        self_outer = self
        sink = io.StringIO()
        with patch.object(dna_client, 'create', return_value=FakeClient()) as create, patch('sys.stdin', io.StringIO(json.dumps({'apiKey': 'SYNTHETIC_SECRET', 'plan': PLAN}))), patch('sys.argv', ['worker']), contextlib.redirect_stdout(sink):
            worker.main()
        create.assert_called_once_with('SYNTHETIC_SECRET', model_version=dna_client.ModelVersion.ALL_FOLDS, timeout=20)
        self.assertNotIn('SYNTHETIC_SECRET', sink.getvalue())
        self.assertEqual(json.loads(sink.getvalue())['interval']['end'], 36209889)


if __name__ == '__main__':
    unittest.main()
