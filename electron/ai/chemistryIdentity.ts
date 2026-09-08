import type { ChemistryIntent, ChemistryReference, ChemistryResolution, ChemistryValidationRequest, ChemistryValidationResult } from '@shared/chemistryDocument';
import { reactionSmilesSpecies } from '@shared/chemistryReaction';

export interface ChemistryIdentityDependencies {
  fetch: typeof fetch;
  validate: (request: ChemistryValidationRequest, signal?: AbortSignal) => Promise<ChemistryValidationResult>;
}

/** No model-generated structures, status, captions, URLs or projection arrays. */
export function parseChemistryIntent(source: string, question: string): ChemistryIntent {
  if (source.length > 8000) throw new Error('Chemical intent is too large.');
  if (/\b(sawhorse|nitration|nitraci[oó]n|chair|silla|dehydration|deshidrataci[oó]n|lone pairs?|pares? libres?|explicit hydrogens?|hidrógenos? explícitos?)\b/i.test(question)
    || /wedge[\s\S]{0,40}(?:dash|hash)|solid wedge[\s\S]{0,60}hashed/i.test(question)) {
    throw new Error('The requested specialized depiction is outside the current verified scope; a skeletal drawing will not be substituted.');
  }
  let raw = JSON.parse(source);
  if (raw?.kind === 'reaction' && /\b(equilibrium|equilibrio|reversible)\b|⇌|↔|<=>/.test(question.toLowerCase())) throw new Error('Only forward reaction schemes are supported; an equilibrium or reversible arrow will not be substituted.');
  const reactionTokens = question.split(/\s|`/).filter(token => token.split('>').length >= 3);
  if (raw?.kind === 'reaction' && reactionTokens.length && (reactionTokens.length !== 1 || raw.reactionSmiles !== reactionTokens[0])) {
    throw new Error('Use the complete single reaction SMILES, including all species and agents; do not replace it with a partial species list.');
  }
  if (raw?.kind === 'reaction' && raw.reactionSmiles != null) {
    if (raw.version !== 2 || raw.depiction !== 'skeletal' || Object.keys(raw).some(k => !['version', 'kind', 'depiction', 'reactionSmiles'].includes(k))
      || typeof raw.reactionSmiles !== 'string' || !question.includes(raw.reactionSmiles)) throw new Error('Reaction SMILES must be copied completely from the current request.');
    const value = raw.reactionSmiles;
    // A substring must not discard reactants, agents or products at either end.
    if (!question.split(/\s|`/).includes(value)) throw new Error('Provide the complete reaction SMILES on its own line or in a code fence.');
    raw = { version: 2, kind: 'reaction', depiction: 'skeletal', species: reactionSmilesSpecies(value) };
  }
  if (!raw || raw.version !== 2 || !['structure', 'comparison', 'mechanism', 'reaction'].includes(raw.kind) || !['skeletal', 'fischer', 'haworth', 'newman'].includes(raw.depiction)) {
    throw new Error('Use a version-2 identity intent with a supported structure, projection or mechanism rule.');
  }
  if (/\bfischer\b/i.test(question) && raw.depiction !== 'fischer' || /\bhaworth\b/i.test(question) && raw.depiction !== 'haworth' || /\bnewman\b/i.test(question) && raw.depiction !== 'newman') throw new Error('The requested specialized depiction must not be replaced with another projection.');
  if (/\b(mechanism|mecanismo|resonance|resonancia)\b/i.test(question) && raw.kind !== 'mechanism') throw new Error('The requested mechanism must not be replaced with an isolated structure.');
  const rules: Record<string, RegExp> = { sn2: /\bSN2\b/i, e2: /\bE2\b/i, aldol: /\baldol\w*\b/i, 'diels-alder': /\bdiels.alder\b/i, 'amide-resonance': /\b(resonance|resonancia)\b/i };
  if (raw.kind === 'mechanism' ? raw.depiction !== 'skeletal' || !rules[raw.rule]?.test(question) : raw.rule != null) throw new Error('The mechanism rule must be explicitly requested and supported.');
  for (const [rule, pattern] of Object.entries(rules)) if (pattern.test(question) && raw.rule !== rule) throw new Error('The requested reaction rule must not be substituted.');
  const conformationWords: Record<string, RegExp> = { anti: /\banti\b/i, gauche: /\bgauche\b/i, eclipsed: /\b(?:eclipsed|eclipsad[ao])\b/i, staggered: /\b(?:staggered|alternad[ao]|escalonad[ao])\b/i };
  const conformations = Object.keys(conformationWords).filter(c => conformationWords[c].test(question));
  // Complete only unambiguous selectors grounded in the current user text.
  // An omitted model field must not force another paid inference; conflicting
  // fields still fail instead of silently changing the requested geometry.
  if (raw.depiction === 'newman' && raw.conformation == null && conformations.length === 1) raw.conformation = conformations[0];
  if (raw.conformation != null && (raw.depiction !== 'newman' || !conformations.includes(raw.conformation))) throw new Error('Newman conformation must be copied from the request.');
  if (raw.depiction === 'newman' && (conformations.length > 1 || conformations.length === 1 && raw.conformation !== conformations[0])) throw new Error('Specify one Newman conformation per request; do not replace the requested torsion.');
  if (raw.depiction === 'newman' && /-?\d+(?:\.\d+)?\s*(?:°|degrees|grados)/i.test(question)) throw new Error('Numeric Newman torsions are not accepted yet; specify anti, gauche, eclipsed or staggered explicitly.');
  const approaches = ['endo', 'exo'].filter(c => new RegExp(`\\b${c}\\b`, 'i').test(question));
  if (raw.rule === 'diels-alder' && raw.approach == null && approaches.length === 1) raw.approach = approaches[0];
  if (raw.approach != null && (raw.rule !== 'diels-alder' || !approaches.includes(raw.approach))) throw new Error('Endo/exo approach must be explicitly requested for Diels–Alder.');
  if (approaches.length && (raw.rule !== 'diels-alder' || approaches.length === 1 && raw.approach !== approaches[0] || approaches.length === 2 && raw.approach != null)) throw new Error('Preserve the requested endo/exo alternatives.');
  const exactKeys = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
  if (!exactKeys(raw, ['version', 'kind', 'depiction', 'species', 'rule', 'conformation', 'approach']) || !Array.isArray(raw.species)
    || raw.species.length < 1 || raw.species.length > (raw.kind === 'reaction' ? 12 : 4) || (raw.kind === 'structure' && raw.species.length !== 1)
    || (raw.kind === 'comparison' && raw.species.length < 2)
    || (raw.kind === 'mechanism' && raw.species.length !== (raw.rule === 'amide-resonance' ? 1 : raw.rule === 'aldol' ? 3 : 2))) throw new Error('Invalid chemical intent schema.');
  const ids = new Set<string>();
  for (const item of raw.species) {
    if (!item || typeof item !== 'object' || !exactKeys(item, raw.kind === 'reaction' ? ['id', 'input', 'role', 'coefficient'] : ['id', 'input']) || typeof item.id !== 'string'
      || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate species ID.');
    ids.add(item.id);
    if (raw.kind === 'reaction' && (raw.depiction !== 'skeletal' || !['reactant', 'product', 'agent'].includes(item.role)
      || !Number.isInteger(item.coefficient) || item.coefficient < 1 || item.coefficient > 12)) throw new Error('A reaction requires explicit roles and positive integer coefficients (1–12).');
    const input = item.input;
    if (!input || typeof input !== 'object' || !exactKeys(input, ['kind', 'value']) || !['name', 'pubchem-cid', 'smiles'].includes(input.kind)
      || typeof input.value !== 'string' || !input.value || input.value !== input.value.trim() || input.value.length > (input.kind === 'smiles' ? 2000 : 200)) throw new Error('Invalid chemical identity input.');
    // Only explicit input from this user turn may leave the device. Retrieved
    // embeddings/model guesses cannot become either identity or network query.
    let start = question.indexOf(input.value);
    while (start >= 0) {
      const before = start > 0 ? question[start - 1] : '', after = question[start + input.value.length] ?? '';
      if (!/[\p{L}\p{N}(+−-]/u.test(before) && !/[\p{L}\p{N}+−-]/u.test(after)) break;
      start = question.indexOf(input.value, start + 1);
    }
    if (start < 0) throw new Error('The identity must be quoted exactly from your request; please supply the full name, CID or isomeric SMILES.');
    if (input.kind === 'pubchem-cid' && (!/^[1-9]\d{0,9}$/.test(input.value)
      || !/\b(?:pubchem(?:\s+cid)?|cid)\s*[:#]?\s*$/i.test(question.slice(Math.max(0, start - 30), start)))) throw new Error('Provide an explicitly labelled PubChem CID.');
    if (input.kind === 'name' && (!/\p{L}/u.test(input.value) || !/^[\p{L}\p{N}\s()[\]{},.'′’+−–-]+$/u.test(input.value))) throw new Error('Unsupported chemical name syntax.');
  }
  if (raw.kind === 'reaction' && (!raw.species.some((s: ChemistryIntent['species'][number]) => s.role === 'reactant') || !raw.species.some((s: ChemistryIntent['species'][number]) => s.role === 'product'))) throw new Error('Both reaction sides are required; supply products rather than guessing them.');
  return raw as ChemistryIntent;
}

async function readJSON(url: string, deps: ChemistryIdentityDependencies, signal?: AbortSignal): Promise<any | null> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Chemical reference timed out.')), 10_000);
  try {
    const response = await deps.fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Chemical reference unavailable (HTTP ${response.status}).`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty chemical reference response.');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256_000) throw new Error('Chemical reference response is too large.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function references(input: ChemistryIntent['species'][number]['input'], deps: ChemistryIdentityDependencies, signal?: AbortSignal): Promise<ChemistryReference[]> {
  const retrievedAt = new Date().toISOString();
  if (input.kind === 'smiles') return [{ provider: 'user', query: input.value, smiles: input.value, retrievedAt }];
  const found: ChemistryReference[] = [];
  if (input.kind === 'name') {
    const url = `https://www.ebi.ac.uk/opsin/ws/${encodeURIComponent(input.value)}.json`;
    const record = await readJSON(url, deps, signal);
    if (record?.status === 'WARNING' || record?.warnings?.length) throw new Error('OPSIN reports an ambiguous or partially interpreted name; provide an exact identifier.');
    if (record?.status === 'SUCCESS' && typeof record.smiles === 'string') found.push({ provider: 'opsin', query: input.value, smiles: record.smiles, retrievedAt, url });
  }
  let cid = input.value;
  if (input.kind === 'name') {
    const matches = await readJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(input.value)}/cids/JSON?name_type=complete`, deps, signal);
    const cids = matches?.IdentifierList?.CID;
    if (cids && (!Array.isArray(cids) || cids.length !== 1 || !Number.isSafeInteger(cids[0]) || cids[0] <= 0)) throw new Error('PubChem returned an ambiguous identity; provide a specific CID or isomeric SMILES.');
    if (!cids) return found;
    cid = String(cids[0]);
  }
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/IsomericSMILES/JSON`;
  const record = await readJSON(url, deps, signal);
  const rows = record?.PropertyTable?.Properties;
  if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0].CID) !== cid) {
    if (input.kind === 'pubchem-cid' || record) throw new Error('The PubChem identity could not be resolved exactly.');
    return found;
  }
  const smiles = rows[0].SMILES ?? rows[0].IsomericSMILES;
  if (typeof smiles !== 'string') throw new Error('PubChem omitted isomeric SMILES.');
  found.push({ provider: 'pubchem', query: input.value, smiles, retrievedAt, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` });
  return found;
}

export async function resolveChemistryIntent(source: string, question: string, deps: ChemistryIdentityDependencies, signal?: AbortSignal): Promise<ChemistryResolution> {
  let intent: ChemistryIntent;
  try { intent = parseChemistryIntent(source, question); }
  catch (error) { return { version: 2, status: 'unsupported', reason: error instanceof Error ? error.message : 'Invalid chemical intent.' }; }
  try {
    const species = [];
    let engineVersion = '';
    for (const item of intent.species) {
      signal?.throwIfAborted();
      const evidence = await references(item.input, deps, signal);
      if (!evidence.length) throw new Error('No exact chemical reference was found; provide an isomeric SMILES or PubChem CID.');
      const result = await deps.validate({ references: evidence.map(ref => ref.smiles), depiction: intent.depiction, conformation: intent.conformation, exportChemfig: intent.kind !== 'mechanism' && intent.kind !== 'reaction' }, signal);
      const axis = /\bC([1-6])\s*(?:[-–→]|to|a)\s*C([1-6])\b/i.exec(question);
      if (intent.depiction === 'newman' && axis && result.projection?.axis.join('-') !== `C${axis[1]}-C${axis[2]}`) throw new Error('That Newman viewing axis is outside the supported convention; use the displayed canonical chain axis.');
      engineVersion = result.engineVersion;
      species.push({ ...item, references: evidence, graph: result.graph, svg: result.svg, depiction: intent.depiction, chemfig: result.chemfig, ...(result.projection ? { projection: result.projection } : {}) });
    }
    const mechanism = intent.kind === 'mechanism' ? (await deps.validate({ references: [species[0].graph.canonicalSmiles], mechanism: { rule: intent.rule!, inputs: species.map(s => s.graph.canonicalSmiles), approach: intent.approach } }, signal)).mechanism : undefined;
    if (intent.kind === 'mechanism' && !mechanism) throw new Error('The mechanism worker returned no checked rule result.');
    const reaction = intent.kind === 'reaction' ? (await deps.validate({ references: [species[0].graph.canonicalSmiles], reaction: species.map(s => ({ id: s.id, smiles: s.graph.canonicalSmiles, role: s.role!, coefficient: s.coefficient! })) }, signal)).reaction : undefined;
    if (intent.kind === 'reaction' && !reaction) throw new Error('The worker returned no balanced reaction scheme.');
    return { version: 2, status: 'verified', scope: 'reference-graph-and-molfile-roundtrip', engine: { name: 'RDKit', version: engineVersion }, species, ...(mechanism ? { mechanism } : {}), ...(reaction ? { reaction } : {}),
      limitations: ['Verification covers reference graphs and the stated projection/rule, not all visual layout defects or experimental product dominance.', 'User SMILES certify only the supplied graph, not a compound name.', 'Projection and mechanism coverage is bounded; new aldol stereocentres are not assigned an arbitrary configuration, and alternative reaction products are not ranked.'] };
  } catch (error) {
    signal?.throwIfAborted();
    return { version: 2, status: 'needs-clarification', reason: error instanceof Error ? error.message : 'Chemical identity could not be established.' };
  }
}
