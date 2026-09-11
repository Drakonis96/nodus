import type { ChemistryIntent, ChemistryPartialReason, ChemistryReference, ChemistryResolution, ChemistryValidationRequest, ChemistryValidationResult } from '@shared/chemistryDocument';
import { reactionSmilesSpecies } from '@shared/chemistryReaction';

export interface ChemistryIdentityDependencies {
  fetch: typeof fetch;
  validate: (request: ChemistryValidationRequest, signal?: AbortSignal) => Promise<ChemistryValidationResult>;
}

/** No model-generated structures, status, captions, URLs or projection arrays. */
export function parseChemistryIntent(source: string, question: string): ChemistryIntent {
  if (source.length > 8000) throw new Error('Chemical intent is too large.');
  if (/\b(sawhorse|nitration|nitraci[oó]n|chair|silla|dehydration|deshidrataci[oó]n)\b/i.test(question)
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
  if (!raw || raw.version !== 2 || !['structure', 'comparison', 'mechanism', 'reaction', 'resonance'].includes(raw.kind) || !['skeletal', 'fischer', 'haworth', 'newman'].includes(raw.depiction)) {
    throw new Error('Use a version-2 identity intent with a supported structure, projection, mechanism or resonance kind.');
  }
  // Declared curved arrows are checked by applying them, so they do not need a rule
  // written in advance. That is what lets a mechanism outside the bounded rule
  // library be drawn at all instead of refused for having no rule.
  const declaredFlow = Array.isArray(raw.electronFlow) && raw.electronFlow.length > 0;
  // Lone pairs and explicit hydrogens used to be refused outright. Both are now part of
  // how an electron-flow mechanism is expressed — a proton cannot be moved if it is not
  // an addressable atom — so the refusal only stands where no arrows were declared.
  if (!declaredFlow && /\b(lone pairs?|pares? libres?|explicit hydrogens?|hidrógenos? explícitos?)\b/i.test(question)) {
    throw new Error('Lone pairs and explicit hydrogens are drawn as part of a declared electron-flow mechanism; add "electronFlow" describing the arrows, or ask for the structure without them.');
  }
  if (/\bfischer\b/i.test(question) && raw.depiction !== 'fischer' || /\bhaworth\b/i.test(question) && raw.depiction !== 'haworth' || /\bnewman\b/i.test(question) && raw.depiction !== 'newman') throw new Error('The requested specialized depiction must not be replaced with another projection.');
  if (/\b(mechanism|mecanismo|resonance|resonancia)\b/i.test(question) && !['mechanism', 'resonance'].includes(raw.kind)) throw new Error('The requested mechanism must not be replaced with an isolated structure.');
  const rules: Record<string, RegExp> = { sn2: /\bSN2\b/i, e2: /\bE2\b/i, aldol: /\baldol\w*\b/i, 'diels-alder': /\bdiels.alder\b/i, 'amide-resonance': /\b(resonance|resonancia)\b/i };
  if (declaredFlow) {
    if (!['mechanism', 'resonance'].includes(raw.kind)) throw new Error('"electronFlow" belongs to a "mechanism" or "resonance" intent.');
    if (raw.depiction !== 'skeletal') throw new Error('An electron-flow mechanism must use depiction "skeletal".');
    if (raw.rule != null) throw new Error('Do not set "rule" alongside "electronFlow"; the arrows themselves define the mechanism.');
  } else {
    if (raw.kind === 'resonance') throw new Error('A "resonance" intent needs "electronFlow" describing the arrows between contributors.');
    if (raw.kind === 'mechanism' ? raw.depiction !== 'skeletal' || !rules[raw.rule]?.test(question) : raw.rule != null) throw new Error('The mechanism rule must be explicitly requested and supported, or declare "electronFlow" instead.');
    for (const [rule, pattern] of Object.entries(rules)) if (pattern.test(question) && raw.rule !== rule) throw new Error('The requested reaction rule must not be substituted.');
  }
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
  // Say which field is wrong and what was expected. A schema failure reported in
  // chemical vocabulary sends the model looking for a chemistry mistake it did not
  // make, and it will keep rewriting the chemistry instead of the JSON.
  const allowed = ['version', 'kind', 'depiction', 'species', 'rule', 'conformation', 'approach', 'electronFlow'];
  const unexpected = Object.keys(raw).filter(key => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unexpected field(s) ${unexpected.join(', ')} in the intent. Allowed fields are ${allowed.join(', ')}; the application supplies everything else.`);
  if (!Array.isArray(raw.species)) throw new Error('The intent needs a "species" array, one entry per chemical identity.');
  // An electron-flow mechanism takes as many species as the arrows involve; a bounded
  // rule takes exactly the number its own definition fixes.
  const expectedCount = raw.kind === 'structure' ? '1'
    : raw.kind === 'comparison' ? '2 to 4'
      : raw.kind === 'resonance' ? '1'
        : declaredFlow ? '1 to 4'
          : raw.kind === 'mechanism' ? String(raw.rule === 'amide-resonance' ? 1 : raw.rule === 'aldol' ? 3 : 2)
            : '1 to 12';
  if (raw.species.length < 1 || raw.species.length > (raw.kind === 'reaction' ? 12 : 4) || (raw.kind === 'structure' && raw.species.length !== 1)
    || (raw.kind === 'resonance' && raw.species.length !== 1)
    || (raw.kind === 'comparison' && raw.species.length < 2)
    || (!declaredFlow && raw.kind === 'mechanism' && raw.species.length !== (raw.rule === 'amide-resonance' ? 1 : raw.rule === 'aldol' ? 3 : 2))) {
    throw new Error(`A "${raw.kind}" intent${raw.rule ? ` using rule "${raw.rule}"` : ''} needs ${expectedCount} species, but ${raw.species.length} were supplied.`);
  }
  const ids = new Set<string>();
  for (const [position, item] of raw.species.entries()) {
    const at = `species[${position}]`;
    const speciesKeys = raw.kind === 'reaction' ? ['id', 'input', 'role', 'coefficient'] : ['id', 'input'];
    if (!item || typeof item !== 'object') throw new Error(`${at} must be an object with ${speciesKeys.join(' and ')}.`);
    const extra = Object.keys(item).filter(key => !speciesKeys.includes(key));
    if (extra.length) throw new Error(`${at} has unexpected field(s) ${extra.join(', ')}. A ${raw.kind} species carries only ${speciesKeys.join(', ')}.`);
    if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id)) throw new Error(`${at}.id must be lower-case kebab-case starting with a letter, for example "substrate".`);
    if (ids.has(item.id)) throw new Error(`${at}.id "${item.id}" is already used by an earlier species; give each one a distinct id.`);
    ids.add(item.id);
    if (raw.kind === 'reaction' && raw.depiction !== 'skeletal') throw new Error('A reaction scheme must use depiction "skeletal".');
    if (raw.kind === 'reaction' && !['reactant', 'product', 'agent'].includes(item.role)) throw new Error(`${at}.role must be "reactant", "product" or "agent".`);
    if (raw.kind === 'reaction' && (!Number.isInteger(item.coefficient) || item.coefficient < 1 || item.coefficient > 12)) throw new Error(`${at}.coefficient must be a whole number from 1 to 12.`);
    const input = item.input;
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['kind', 'value'].includes(key))) throw new Error(`${at}.input must be an object with exactly "kind" and "value".`);
    if (!['name', 'pubchem-cid', 'smiles'].includes(input.kind)) throw new Error(`${at}.input.kind must be "name", "pubchem-cid" or "smiles".`);
    if (typeof input.value !== 'string' || !input.value || input.value !== input.value.trim() || input.value.length > (input.kind === 'smiles' ? 2000 : 200)) {
      throw new Error(`${at}.input.value must be a non-empty string with no leading or trailing spaces, at most ${input.kind === 'smiles' ? 2000 : 200} characters.`);
    }
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
  if (declaredFlow) validateElectronFlowShape(raw.electronFlow, ids);
  return raw as ChemistryIntent;
}

/**
 * Check only the shape of the declared arrows. Whether they describe real electron
 * movement is settled later by applying them to the resolved structures, which is a
 * question no amount of JSON validation could answer.
 */
function validateElectronFlowShape(flows: unknown, ids: Set<string>): void {
  if (!Array.isArray(flows) || flows.length > 12) throw new Error('"electronFlow" must be an array of one to twelve curved arrows.');
  const selector = (value: unknown, label: string): void => {
    if (!value || typeof value !== 'object') throw new Error(`${label} must be an object such as {"element":"O"}.`);
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['element', 'index'].includes(key))) throw new Error(`${label} accepts only "element" and "index".`);
    if (typeof entry.element !== 'string' || !/^[A-Z][a-z]?$/.test(entry.element)) throw new Error(`${label}.element must be an element symbol such as "O" or "Cl".`);
    if (entry.index != null && (!Number.isInteger(entry.index) || (entry.index as number) < 1)) throw new Error(`${label}.index must be a whole number of at least 1.`);
  };
  flows.forEach((flow, position) => {
    const at = `electronFlow[${position}]`;
    if (!flow || typeof flow !== 'object') throw new Error(`${at} must be an object with "from" and "to".`);
    const entry = flow as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['from', 'to', 'kind'].includes(key))) throw new Error(`${at} accepts only "from", "to" and "kind".`);
    if (entry.kind != null && !['pair', 'single'].includes(entry.kind as string)) throw new Error(`${at}.kind must be "pair" or "single".`);
    for (const side of ['from', 'to'] as const) {
      const value = entry[side] as Record<string, unknown> | undefined;
      if (!value || typeof value !== 'object') throw new Error(`${at}.${side} must be an object naming a species and an atom or bond.`);
      if (Object.keys(value).some(key => !['species', 'atom', 'bond'].includes(key))) throw new Error(`${at}.${side} accepts only "species", "atom" and "bond".`);
      if (typeof value.species !== 'string' || !ids.has(value.species)) throw new Error(`${at}.${side}.species must be one of the species ids in this intent (${[...ids].join(', ')}).`);
      if ((value.atom == null) === (value.bond == null)) throw new Error(`${at}.${side} needs exactly one of "atom" or "bond".`);
      if (value.atom != null) selector(value.atom, `${at}.${side}.atom`);
      if (value.bond != null) {
        const pair = Array.isArray(value.bond) ? value.bond : (value.bond as Record<string, unknown>).between;
        if (!Array.isArray(value.bond) && typeof value.bond === 'object') {
          const entry = value.bond as Record<string, unknown>;
          if (Object.keys(entry).some(key => !['between', 'order', 'index'].includes(key))) throw new Error(`${at}.${side}.bond accepts only "between", "order" and "index".`);
          if (entry.order != null && ![1, 2, 3].includes(entry.order as number)) throw new Error(`${at}.${side}.bond.order must be 1, 2 or 3.`);
          if (entry.index != null && (!Number.isInteger(entry.index) || (entry.index as number) < 1)) throw new Error(`${at}.${side}.bond.index must be a whole number of at least 1.`);
        }
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string' || !/^[A-Z][a-z]?$/.test(item))) {
          throw new Error(`${at}.${side}.bond must be two element symbols, for example ["H","Cl"], or {"between":["N","O"],"order":2}.`);
        }
      }
    }
  });
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

/** States exactly what was not checked, so a partial drawing is never mistaken for a verified one. */
function describePartial(reasons: ChemistryPartialReason[]): string {
  const text: Record<ChemistryPartialReason, string> = {
    'element-outside-cip-scope': 'the structure contains an element outside the organic set, so stereochemical labelling and implicit valences were not certified',
    'stereochemistry-not-assignable': 'a stereochemical relationship could not be assigned from the reference',
    'layout-roundtrip-changed-geometry': 'the primary layout engine altered the geometry, so an alternative layout was drawn instead',
    'structure-above-validated-size': 'the structure is larger than the fully validated size',
    'arrow-geometry-heuristic': 'curved-arrow placement is heuristic, though the electron movement itself was checked',
  };
  return `The graph and balance were checked, but ${reasons.map(reason => text[reason]).join('; ')}.`;
}

export async function resolveChemistryIntent(source: string, question: string, deps: ChemistryIdentityDependencies, signal?: AbortSignal): Promise<ChemistryResolution> {
  let intent: ChemistryIntent;
  try { intent = parseChemistryIntent(source, question); }
  catch (error) { return { version: 2, status: 'unsupported', reason: error instanceof Error ? error.message : 'Invalid chemical intent.' }; }
  try {
    const species = [];
    let engineVersion = '';
    const partialReasons = new Set<ChemistryPartialReason>();
    const assumed: string[] = [];
    for (const item of intent.species) {
      signal?.throwIfAborted();
      const evidence = await references(item.input, deps, signal);
      if (!evidence.length) throw new Error('No exact chemical reference was found; provide an isomeric SMILES or PubChem CID.');
      const result = await deps.validate({ references: evidence.map(ref => ref.smiles), depiction: intent.depiction, conformation: intent.conformation, exportChemfig: intent.kind !== 'mechanism' && intent.kind !== 'reaction' }, signal);
      const axis = /\bC([1-6])\s*(?:[-–→]|to|a)\s*C([1-6])\b/i.exec(question);
      if (intent.depiction === 'newman' && axis && result.projection?.axis.join('-') !== `C${axis[1]}-C${axis[2]}`) throw new Error('That Newman viewing axis is outside the supported convention; use the displayed canonical chain axis.');
      engineVersion = result.engineVersion;
      for (const reason of result.partialReasons ?? []) partialReasons.add(reason);
      // The user asked for a name; a specific isomer was chosen for them. Say which,
      // and say where it came from, so the choice is auditable rather than silent.
      if (result.reconciledStereochemistry) {
        const curated = evidence.find(ref => ref.smiles === result.graph.canonicalSmiles) ?? evidence.find(ref => ref.provider === 'pubchem');
        assumed.push(`“${item.input.value}” did not specify stereochemistry, so the curated ${curated?.provider ?? 'reference'} form was used${curated?.url ? ` (${curated.url})` : ''}.`);
      }
      species.push({ ...item, references: evidence, graph: result.graph, svg: result.svg, depiction: intent.depiction, chemfig: result.chemfig, ...(result.projection ? { projection: result.projection } : {}) });
    }
    // Resonance is drawn by the same machinery as a mechanism: the arrows are applied
    // and the contributors they produce are checked, rather than looked up in a rule.
    const wantsMechanism = intent.kind === 'mechanism' || intent.kind === 'resonance';
    const mechanism = wantsMechanism ? (await deps.validate({
      references: [species[0].graph.canonicalSmiles],
      mechanism: intent.electronFlow
        ? { rule: 'electron-flow', inputs: species.map(s => s.graph.canonicalSmiles), electronFlow: intent.electronFlow, order: species.map(s => s.id), resonance: intent.kind === 'resonance' }
        : { rule: intent.rule!, inputs: species.map(s => s.graph.canonicalSmiles), approach: intent.approach },
    }, signal)).mechanism : undefined;
    if (wantsMechanism && !mechanism) throw new Error('The mechanism worker returned no checked rule result.');
    const reaction = intent.kind === 'reaction' ? (await deps.validate({ references: [species[0].graph.canonicalSmiles], reaction: species.map(s => ({ id: s.id, smiles: s.graph.canonicalSmiles, role: s.role!, coefficient: s.coefficient! })) }, signal)).reaction : undefined;
    if (intent.kind === 'reaction' && !reaction) throw new Error('The worker returned no balanced reaction scheme.');
    // A scope limit is this build's boundary, not the user's mistake: the drawing is
    // still produced, and only the trust level it carries is reduced.
    const partial = partialReasons.size > 0;
    return { version: 2,
      status: partial ? 'partial' : 'verified',
      scope: partial ? 'graph-valid-validation-incomplete' : 'reference-graph-and-molfile-roundtrip',
      engine: { name: 'RDKit', version: engineVersion }, species, ...(mechanism ? { mechanism } : {}), ...(reaction ? { reaction } : {}),
      ...(partial ? { partialReasons: [...partialReasons], reason: describePartial([...partialReasons]) } : {}),
      ...(assumed.length ? { assumedIdentity: assumed.join(' ') } : {}),
      limitations: ['Verification covers reference graphs and the stated projection/rule, not all visual layout defects or experimental product dominance.', 'User SMILES certify only the supplied graph, not a compound name.', 'Projection and mechanism coverage is bounded; new aldol stereocentres are not assigned an arbitrary configuration, and alternative reaction products are not ranked.'] };
  } catch (error) {
    signal?.throwIfAborted();
    return { version: 2, status: 'needs-clarification', reason: error instanceof Error ? error.message : 'Chemical identity could not be established.' };
  }
}
