/**
 * Records-lens extraction core. Where the deep scan pulls arguable *ideas* from a
 * work, this pulls factual *entities* — persons, places, events — from a primary
 * source (census page, parish register, record dump). Pure and dependency-free:
 * the prompt, the output guard, and the cross-chunk merge/de-duplication live here
 * and are unit-tested without any AI call; the electron orchestrator supplies the
 * model and the persistence.
 *
 * The model refers to persons and places by NAME (it has no ids); the persistence
 * step resolves those names to entity ids, creating records as needed. Every fact
 * carries a verbatim quote + page location so the record layer stays citable.
 */

import type { HistoricalEventType, ParticipantRole, PersonSex } from './types';

export const RECORDS_EXTRACTION_PROMPT = `Eres un archivero experto en fuentes primarias y genealogía. Recibes un fragmento de un documento (censo, padrón, partida parroquial, acta, registro, diario, carta, memorias). Extrae ÚNICAMENTE los hechos explícitos en el texto: personas, lugares, eventos y los parentescos que el texto AFIRME. No inventes datos, no deduzcas parentescos que el texto no afirme, no completes fechas que no aparezcan.

REGLA DE ORO: la mera aparición de dos nombres en el mismo texto NO implica ningún parentesco entre ellos. Nunca conviertas una co-aparición en una relación familiar. Solo registra un parentesco cuando el texto lo enuncie de forma explícita (p. ej. "Juan, padre de Ana"; "María, su esposa"; "hijo de Pedro").

Devuelve SOLO un objeto JSON con esta forma:
{
  "persons": [
    { "name": "nombre tal como aparece", "sex": "male|female|unknown", "birth": "fecha de nacimiento si consta, tal como aparece", "death": "fecha de defunción si consta", "quote": "cita literal de la fuente", "location": "p. N si hay marcador" }
  ],
  "places": [ { "name": "nombre del lugar", "kind": "parish|municipality|province|country|other" } ],
  "events": [
    { "type": "birth|baptism|marriage|death|burial|census|residence|migration|occupation|other",
      "date": "fecha tal como aparece",
      "place": "nombre del lugar del evento",
      "label": "descripción breve opcional",
      "participants": [ { "name": "nombre de la persona", "role": "principal|spouse|father|mother|child|witness|officiant|other" } ],
      "quote": "cita literal", "location": "p. N" }
  ],
  "relations": [
    { "subject": "nombre de una persona nombrada", "relation": "father|mother|parent|son|daughter|child|husband|wife|spouse", "object": "nombre de la otra persona nombrada", "quote": "cita literal que afirma el parentesco", "location": "p. N" }
  ]
}

Reglas:
- Copia "quote" EXACTAMENTE como está en la fuente, en su idioma original. Nunca la traduzcas ni la parafrasees.
- Usa los marcadores [[p. N]] del texto para "location". Si no hay marcador, deja "location" vacío; no inventes páginas.
- Las fechas se copian tal como aparecen (p. ej. "hacia 1850", "2 de marzo de 1875"); no las normalices.
- Si un dato no consta, omite el campo (no pongas null ni cadenas inventadas).
- Cada persona que participe en un evento debe aparecer también con su "name" en "participants".
- En "relations", "subject" es <relation> de "object" (p. ej. relation="father" significa que subject es el padre de object). Ambos deben ser personas NOMBRADAS en el texto; no uses la primera persona ("mi padre") salvo que el narrador esté nombrado. Si el texto no afirma ningún parentesco, deja "relations" vacío.`;

export interface RawEvidence {
  quote?: string;
  location?: string;
}

export interface RawPerson extends RawEvidence {
  name?: string;
  sex?: string;
  birth?: string;
  death?: string;
}

export interface RawPlace {
  name?: string;
  kind?: string;
}

export interface RawParticipant {
  name?: string;
  role?: string;
}

export interface RawEvent extends RawEvidence {
  type?: string;
  date?: string;
  place?: string;
  label?: string;
  participants?: RawParticipant[];
}

export interface RawRelation extends RawEvidence {
  subject?: string;
  relation?: string;
  object?: string;
}

export interface RecordsChunkResult {
  persons?: RawPerson[];
  places?: RawPlace[];
  events?: RawEvent[];
  relations?: RawRelation[];
}

/** Lenient shape guard: an object whose persons/places/events/relations, when present, are arrays. */
export function isRecordsChunkResult(v: unknown): v is RecordsChunkResult {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const okArr = (x: unknown) => x === undefined || Array.isArray(x);
  return okArr(o.persons) && okArr(o.places) && okArr(o.events) && okArr(o.relations);
}

/** Input payload for one chunk (stringified as the user message). */
export function buildRecordsInput(chunkText: string, index: number, total: number) {
  return {
    task: 'extract_records',
    chunk: { index, total, text: chunkText },
  };
}

const EVENT_TYPES = new Set<HistoricalEventType>([
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'census',
  'residence',
  'migration',
  'occupation',
  'other',
]);
const ROLES = new Set<ParticipantRole>([
  'principal',
  'spouse',
  'father',
  'mother',
  'child',
  'witness',
  'officiant',
  'other',
]);

export function normalizeSex(value: unknown): PersonSex {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'male' || s === 'm' || s === 'hombre' || s === 'varón' || s === 'varon') return 'male';
  if (s === 'female' || s === 'f' || s === 'mujer') return 'female';
  return 'unknown';
}

export function normalizeEventType(value: unknown): HistoricalEventType {
  const s = String(value ?? '').trim().toLowerCase() as HistoricalEventType;
  return EVENT_TYPES.has(s) ? s : 'other';
}

export function normalizeRole(value: unknown): ParticipantRole {
  const s = String(value ?? '').trim().toLowerCase() as ParticipantRole;
  return ROLES.has(s) ? s : 'principal';
}

/** Dedupe key for a person/place name: lowercase, strip diacritics + punctuation, collapse spaces. */
export function normalizeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanEvidence(raw: RawEvidence): RawEvidence | null {
  const quote = (raw.quote ?? '').trim();
  const location = (raw.location ?? '').trim();
  if (!quote && !location) return null;
  return { quote: quote || undefined, location: location || undefined };
}

export interface MergedPerson {
  name: string;
  key: string;
  sex: PersonSex;
  birth: string | null;
  death: string | null;
  evidence: RawEvidence[];
}

export interface MergedPlace {
  name: string;
  kind: string | null;
}

export interface MergedParticipant {
  name: string;
  role: ParticipantRole;
}

export interface MergedEvent {
  type: HistoricalEventType;
  date: string | null;
  place: string | null;
  label: string | null;
  participants: MergedParticipant[];
  evidence: RawEvidence | null;
}

/** An explicit kinship claim from the text, its names left unresolved for the persist step. */
export interface MergedRelation {
  subject: string;
  relation: string;
  object: string;
  quote: string | null;
  location: string | null;
}

export interface MergedRecords {
  persons: MergedPerson[];
  places: MergedPlace[];
  events: MergedEvent[];
  relations: MergedRelation[];
}

/**
 * Merge per-chunk extractions into a de-duplicated record set: persons collapse by
 * name key (coalescing sex/birth/death and accumulating evidence), places by name,
 * events are kept per occurrence (each is a distinct fact) with normalised fields.
 */
export function mergeRecordsResults(results: RecordsChunkResult[]): MergedRecords {
  const persons = new Map<string, MergedPerson>();
  const places = new Map<string, MergedPlace>();
  const events: MergedEvent[] = [];
  const relations: MergedRelation[] = [];
  const relationSeen = new Set<string>();

  const rememberPerson = (name: string, sex?: string, birth?: string, death?: string, ev?: RawEvidence | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalizeNameKey(trimmed);
    if (!key) return;
    let person = persons.get(key);
    if (!person) {
      person = { name: trimmed, key, sex: 'unknown', birth: null, death: null, evidence: [] };
      persons.set(key, person);
    }
    if (person.sex === 'unknown' && sex) person.sex = normalizeSex(sex);
    if (!person.birth && birth && birth.trim()) person.birth = birth.trim();
    if (!person.death && death && death.trim()) person.death = death.trim();
    if (ev) person.evidence.push(ev);
  };

  const rememberPlace = (name?: string, kind?: string) => {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    const key = normalizeNameKey(trimmed);
    if (!key || places.has(key)) {
      if (key && kind && !places.get(key)?.kind) {
        const existing = places.get(key);
        if (existing && !existing.kind) existing.kind = kind.trim() || null;
      }
      return;
    }
    places.set(key, { name: trimmed, kind: (kind ?? '').trim() || null });
  };

  for (const result of results) {
    for (const p of result.persons ?? []) {
      if (!p?.name) continue;
      rememberPerson(p.name, p.sex, p.birth, p.death, cleanEvidence(p));
    }
    for (const pl of result.places ?? []) rememberPlace(pl?.name, pl?.kind);
    for (const e of result.events ?? []) {
      if (!e) continue;
      const participants: MergedParticipant[] = [];
      for (const part of e.participants ?? []) {
        const name = (part?.name ?? '').trim();
        if (!name) continue;
        participants.push({ name, role: normalizeRole(part.role) });
        // A participant is also a person; make sure it exists as one.
        rememberPerson(name);
      }
      if (e.place) rememberPlace(e.place);
      events.push({
        type: normalizeEventType(e.type),
        date: (e.date ?? '').trim() || null,
        place: (e.place ?? '').trim() || null,
        label: (e.label ?? '').trim() || null,
        participants,
        evidence: cleanEvidence(e),
      });
    }
    for (const r of result.relations ?? []) {
      const subject = (r?.subject ?? '').trim();
      const object = (r?.object ?? '').trim();
      const relation = (r?.relation ?? '').trim();
      if (!subject || !object || !relation) continue;
      // Both parties of an explicit claim are persons; make sure they exist as such.
      rememberPerson(subject);
      rememberPerson(object);
      const key = `${normalizeNameKey(subject)}|${relation.toLowerCase()}|${normalizeNameKey(object)}`;
      if (relationSeen.has(key)) continue;
      relationSeen.add(key);
      relations.push({
        subject,
        object,
        relation,
        quote: (r.quote ?? '').trim() || null,
        location: (r.location ?? '').trim() || null,
      });
    }
  }

  return { persons: [...persons.values()], places: [...places.values()], events, relations };
}
