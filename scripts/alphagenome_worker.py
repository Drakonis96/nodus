# SPDX-License-Identifier: AGPL-3.0-only
"""Nodus adapter to the unmodified Apache-2.0 AlphaGenome SDK.

No Google source is copied. See THIRD_PARTY_NOTICES.md and legal/ALPHAGENOME.md.
Reads one bounded request from stdin and emits only reduced prediction data.
"""
import json
import sys


def summarize(output, plan):
    import numpy as np
    name = plan['output'].lower()
    ref, alt = getattr(output.reference, name), getattr(output.alternate, name)
    if ref is None or alt is None or ref.values.shape != alt.values.shape:
        raise ValueError('Missing matching tracks')
    if not ref.metadata.equals(alt.metadata) or ref.interval != alt.interval or ref.resolution != alt.resolution:
        raise ValueError('Mismatched metadata')
    if ref.values.ndim != 2 or not 1 <= ref.values.shape[1] or ref.values.shape[0] * ref.resolution != 16384:
        raise ValueError('Unexpected dimensions')
    bins = min(256, ref.values.shape[0])
    if ref.values.shape[0] % bins:
        raise ValueError('Unexpected resolution')
    tracks = []
    for i in range(min(8, ref.values.shape[1])):
        metadata = ref.metadata.iloc[i]
        track = {'name': str(metadata.get('name', f'Track {i + 1}'))[:300],
                 'strand': str(metadata.get('strand', '.')), 'resolution': int(ref.resolution)}
        for key, data in [('reference', ref), ('alternate', alt)]:
            values = np.asarray(data.values[:, i], dtype=np.float64)
            if not np.isfinite(values).all():
                raise ValueError('Nonfinite output')
            track[key] = values.reshape(bins, -1).mean(axis=1).tolist()
        tracks.append(track)
    return {'interval': {'chromosome': ref.interval.chromosome, 'start': ref.interval.start, 'end': ref.interval.end},
            'tracks': tracks, 'totalTracks': int(ref.values.shape[1]),
            'modifications': 'Nodus selected the first eight tracks at most and averaged contiguous bins to at most 256 values per track. REF and ALT use the same bins. Original per-base values are not retained. Plots are Nodus visualizations of these reduced predictions; values are model signals, not clinical probabilities. Only a 16,384-base context is used; the user-supplied REF allele is not independently checked against GRCh38.'}


def main():
    from alphagenome.models import dna_client
    from alphagenome.data import genome
    if sys.argv[1:] == ['--check']:
        import numpy
        assert callable(dna_client.create) and hasattr(dna_client.ModelVersion, 'ALL_FOLDS')
        print(json.dumps({'ready': True}))
        return
    request = json.loads(sys.stdin.read(4096))
    plan = request['plan']
    chromosome, position, ref, alt = plan['variant'].split(':')
    position = int(position)
    if plan['assembly'] != 'GRCh38' or plan['output'] not in ('RNA_SEQ', 'ATAC', 'DNASE', 'CAGE') or len(ref) != 1 or len(alt) != 1:
        raise ValueError('Unsupported plan')
    interval = genome.Interval(chromosome=chromosome, start=position - 1 - 8192, end=position - 1 + 8192)
    variant = genome.Variant(chromosome=chromosome, position=position, reference_bases=ref, alternate_bases=alt)
    model = dna_client.create(request['apiKey'], model_version=dna_client.ModelVersion.ALL_FOLDS, timeout=20)
    output = model.predict_variant(interval=interval, variant=variant, organism=dna_client.Organism.HOMO_SAPIENS,
                                   ontology_terms=[plan['tissue']], requested_outputs=[getattr(dna_client.OutputType, plan['output'])])
    print(json.dumps(summarize(output, plan), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No traceback, credentials, submitted sequences or server diagnostics.
        sys.exit(1)
