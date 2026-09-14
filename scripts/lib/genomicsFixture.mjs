// Independently authored synthetic QA data. Never an AlphaGenome prediction.
export const genomicsPlan = { version: 1, assembly: 'GRCh38', variant: 'chr22:36201698:A:C', tissue: 'UBERON:0001157', output: 'RNA_SEQ' };
export const genomicsQuestion = 'AlphaGenome: GRCh38 chr22:36201698:A:C UBERON:0001157 RNA_SEQ';
export function genomicsFixture(shared) {
  return { version: 1, provider: 'Google DeepMind AlphaGenome', plan: genomicsPlan, createdAt: '2026-09-09T10:00:00.000Z', sdkRevision: shared.ALPHAGENOME_REVISION, model: 'ALL_FOLDS',
    interval: { chromosome: 'chr22', start: 36193505, end: 36209889 },
    tracks: [{ name: 'SYNTHETIC QA DATA — not a model prediction', strand: '+', resolution: 1, reference: Array.from({ length: 256 }, (_, i) => 1 + Math.sin(i / 10)), alternate: Array.from({ length: 256 }, (_, i) => 1 + Math.sin(i / 10) + (i > 110 && i < 140 ? .8 : 0)) }],
    totalTracks: 1, modifications: 'SYNTHETIC QA DATA — independently authored test fixture, not an AlphaGenome output.', notice: shared.ALPHAGENOME_NOTICE, citation: shared.ALPHAGENOME_CITATION };
}
