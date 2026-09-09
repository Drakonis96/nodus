// SPDX-License-Identifier: AGPL-3.0-only
export const ALPHAGENOME_REVISION = 'aa6fc8f6faadcb8c910fa2b85b57386fbd5c7b5d';
export const ALPHAGENOME_TERMS_VERSION = '2026-09-08';
export const ALPHAGENOME_TERMS = 'https://deepmind.google.com/science/alphagenome/terms';
export const ALPHAGENOME_OUTPUT_TERMS = 'https://deepmind.google.com/science/alphagenome/output-terms';
export const ALPHAGENOME_NOTICE = `By using this information, you agree to AlphaGenome Output Terms of Use found at ${ALPHAGENOME_OUTPUT_TERMS}`;
export const ALPHAGENOME_CITATION = 'Avsec et al. (2026). Advancing regulatory variant effect prediction with AlphaGenome. Nature 649, 1206–1218. https://doi.org/10.1038/s41586-025-10014-0';
export const GENOMICS_INSTRUCTIONS = `Use AlphaGenome only for an explicitly requested AlphaGenome regulatory variant prediction for non-commercial research. This is a research prediction, never a clinical interpretation or a diagnosis. Do not process patient records, HIPAA data, commercial work or model training requests.
Return exactly one fenced genomics-plan containing JSON: {"version":1,"assembly":"GRCh38","variant":"chr22:36201698:A:C","tissue":"UBERON:0001157","output":"RNA_SEQ"}. This is a shape example, never a default input. Copy the exact variant, assembly, tissue ontology ID and output from the CURRENT user's request. Supported outputs: RNA_SEQ, ATAC, DNASE, CAGE. Only human GRCh38 single-nucleotide substitutions are supported. Positions in variant notation are 1-based. Ask for missing fields; never infer genome coordinates, reference alleles, tissue IDs or a genome build from a gene name, paper, or memory. Users must give the exact compact variant notation chrN:position:REF:ALT and an UBERON or CL ontology identifier.
The application uses the official AlphaGenome API with the user's personal key, a 16,384-base centered context, and ALL_FOLDS. It validates the intent before sending anything. It returns up to eight tracks as 256 or fewer mean bins with original resolution, track names and source parameters. These are model signals, not probabilities of disease. Do not generate predicted values, a genomics-result, images or SVG in place of a tool call. Do not add claims about predicted effects before a tool result exists. The application renders the result and its attribution locally; results are not supplied to the chat model. Missing configuration must be fixed in this skill's configuration. Do not ask for an API key in chat.`;
export type GenomicsOutput = 'RNA_SEQ' | 'ATAC' | 'DNASE' | 'CAGE';
export interface GenomicsPlan { version: 1; assembly: 'GRCh38'; variant: string; tissue: string; output: GenomicsOutput }
export interface GenomicsStatus { hasKey: boolean; termsAccepted: boolean; runtimeReady: boolean; installing: boolean }
export interface GenomicsSettingsInput { apiKey?: string; acceptTerms: boolean }
export interface GenomicsTrack { name: string; strand: string; resolution: number; reference: number[]; alternate: number[] }
export interface GenomicsResult {
  version: 1; provider: 'Google DeepMind AlphaGenome'; plan: GenomicsPlan; createdAt: string;
  sdkRevision: string; model: 'ALL_FOLDS'; interval: { chromosome: string; start: number; end: number };
  tracks: GenomicsTrack[]; totalTracks: number; modifications: string; notice: string; citation: string;
}
export function parseGenomicsPlan(source: string, question?: string): GenomicsPlan {
  if (source.length > 2000) throw new Error('AlphaGenome: invalid request.');
  let p: GenomicsPlan;
  try { p = JSON.parse(source); } catch { throw new Error('AlphaGenome: invalid JSON request.'); }
  if (!p || Object.keys(p).sort().join(',') !== 'assembly,output,tissue,variant,version' || p.version !== 1 || p.assembly !== 'GRCh38'
    || typeof p.variant !== 'string' || !/^chr(?:[1-9]|1\d|2[0-2]|X|Y):[1-9]\d{0,8}:[ACGT]:[ACGT]$/.test(p.variant)
    || typeof p.tissue !== 'string' || !/^(?:UBERON|CL):\d{7}$/.test(p.tissue)
    || !['RNA_SEQ', 'ATAC', 'DNASE', 'CAGE'].includes(p.output)) throw new Error('AlphaGenome: provide GRCh38, chrN:position:REF:ALT, a tissue ontology ID and RNA_SEQ, ATAC, DNASE or CAGE.');
  const [, position, ref, alt] = p.variant.split(':');
  if (ref === alt || Number(position) < 8193) throw new Error('AlphaGenome: the substitution must change a base and allow a centered 16,384-base interval.');
  if (question !== undefined) {
    for (const value of [p.assembly, p.variant, p.tissue, p.output]) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?<![A-Za-z0-9_:])${escaped}(?![A-Za-z0-9_:])`).test(question)) throw new Error('AlphaGenome: copy the exact assembly, variant, tissue ID and output from your current message.');
    }
  }
  return p;
}
export function validateGenomicsResult(value: unknown): GenomicsResult {
  const r = value as GenomicsResult;
  if (!r || r.version !== 1 || r.provider !== 'Google DeepMind AlphaGenome' || r.sdkRevision !== ALPHAGENOME_REVISION || r.model !== 'ALL_FOLDS'
    || r.notice !== ALPHAGENOME_NOTICE || r.citation !== ALPHAGENOME_CITATION || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))
    || typeof r.modifications !== 'string' || r.modifications.length > 1000 || !Array.isArray(r.tracks) || !r.tracks.length || r.tracks.length > 8
    || !Number.isInteger(r.totalTracks) || r.totalTracks < r.tracks.length) throw new Error('AlphaGenome: invalid result.');
  parseGenomicsPlan(JSON.stringify(r.plan));
  const [chromosome, position] = r.plan.variant.split(':');
  const start = Number(position) - 1 - 8192;
  if (r.interval?.chromosome !== chromosome || r.interval.start !== start || r.interval.end !== start + 16384) throw new Error('AlphaGenome: unexpected genomic interval.');
  for (const t of r.tracks) {
    if (!t || typeof t.name !== 'string' || t.name.length > 300 || typeof t.strand !== 'string' || !['+', '-', '.'].includes(t.strand)
      || !Number.isInteger(t.resolution) || t.resolution < 1 || 16384 % t.resolution !== 0
      || !Array.isArray(t.reference) || !Array.isArray(t.alternate) || t.reference.length !== Math.min(256, 16384 / t.resolution)
      || t.reference.length !== t.alternate.length || [...t.reference, ...t.alternate].some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('AlphaGenome: invalid prediction tracks.');
  }
  return r;
}
// Results live only in device-local assets, never in model history. Also strip
// imported/exported result documents, including strings inside JSON chat wrappers.
export function excludeGenomicsResults(text: string): string {
  if (!/genomics-result|Google DeepMind AlphaGenome/i.test(text)) return text;
  try {
    const value = JSON.parse(text);
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') return excludeGenomicsResults(v);
      if (v && typeof v === 'object' && (v as { provider?: string }).provider === 'Google DeepMind AlphaGenome') return '[AlphaGenome result retained locally]';
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    // A JSON string that decodes to itself is impossible, so recursion progresses.
    return JSON.stringify(walk(value));
  } catch { return text.replace(/(?:`{3,}|~{3,})genomics-result\s*\n[\s\S]*?(?:(?:`{3,}|~{3,})(?=\s|$)|$)/gi, '[AlphaGenome result retained locally]'); }
}
export function genomicsTrackSvg(result: GenomicsResult, trackIndex: number): string {
  const r = validateGenomicsResult(result), track = r.tracks[trackIndex];
  if (!track) throw new Error('Invalid track.');
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
  const values = [...track.reference, ...track.alternate];
  const min = Math.min(0, ...values), max = Math.max(...values, min + 1e-12);
  const points = (data: number[]) => data.map((v, i) => `${(75 + (i + .5) * 780 / data.length).toFixed(2)},${(280 - (v - min) / (max - min) * 165).toFixed(2)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 535"><title>AlphaGenome — ${escape(r.plan.variant)}</title><desc>${escape(r.notice + '. ' + r.modifications + ' Provenance: ' + JSON.stringify({ plan: r.plan, model: r.model, sdkRevision: r.sdkRevision, createdAt: r.createdAt, citation: r.citation }))}</desc><metadata>${escape(JSON.stringify({ notice: r.notice, citation: r.citation, plan: r.plan, modifications: r.modifications, model: r.model, sdkRevision: r.sdkRevision, createdAt: r.createdAt }))}</metadata><rect width="940" height="535" fill="#ffffff"/><g font-family="sans-serif" fill="#182433"><text x="30" y="35" font-size="22">AlphaGenome · ${escape(r.plan.variant)} · ${escape(r.plan.output)}</text><text x="30" y="61" font-size="15">${escape(track.name.slice(0, 95))} (${escape(track.strand)})</text><text x="30" y="86" font-size="14">GRCh38 · ${escape(r.plan.tissue)} · ALL_FOLDS · model signal / señal del modelo</text><path d="M75 110 V280 H855" fill="none" stroke="#64748b"/><text x="12" y="122" font-size="13">${max.toPrecision(3)}</text><text x="12" y="280" font-size="13">${min.toPrecision(3)}</text><polyline points="${points(track.reference)}" stroke="#475569" fill="none" stroke-width="2"/><polyline points="${points(track.alternate)}" stroke="#c02647" fill="none" stroke-width="2"/><path d="M465 110 V280" stroke="#94a3b8" stroke-dasharray="4 4"/><text x="75" y="307" font-size="14">${r.interval.start + 1}</text><text x="855" y="307" text-anchor="end" font-size="14">${r.interval.end}</text><text x="75" y="334" font-size="15" fill="#475569">REF</text><text x="140" y="334" font-size="15" fill="#c02647">ALT</text><text x="215" y="334" font-size="14">${track.reference.length} mean bins · source resolution ${track.resolution} bp · positions 1-based</text><text x="30" y="366" font-size="14">Google DeepMind · Avsec et al., Nature (2026) · doi:10.1038/s41586-025-10014-0</text><text x="30" y="391" font-size="14">Modified by Nodus: track selection, bin averaging and visualization. Research only; no clinical use.</text><text x="30" y="416" font-size="14">By using this information, you agree to AlphaGenome Output Terms of Use found at</text><text x="30" y="441" font-size="14">${ALPHAGENOME_OUTPUT_TERMS}</text><text x="30" y="475" font-size="13">Non-commercial use restrictions apply. No endorsement by Google. ${escape(r.createdAt)}</text><text x="30" y="507" font-size="13">16 kb context only. User-supplied REF allele; not independently checked against GRCh38.</text></g></svg>`;
}
