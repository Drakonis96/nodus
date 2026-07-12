/**
 * Assemble the evidence a person's AI biography is written from — kinship, life
 * events, linked documents and cited evidence — into a compact, source-faithful
 * context. Pure so it is unit-tested without the DB; the electron side gathers the
 * data and runs the model. The biography is factual and only as rich as the sources.
 */

const EVENT_LABEL: Record<string, string> = {
  birth: 'nacimiento',
  baptism: 'bautismo',
  marriage: 'matrimonio',
  death: 'defunción',
  burial: 'entierro',
  census: 'censo',
  residence: 'residencia',
  migration: 'migración',
  occupation: 'ocupación',
  other: 'evento',
};

export interface BiographySources {
  name: string;
  sex: string;
  birthDate: string | null;
  deathDate: string | null;
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
  events: { type: string; date: string | null; place: string | null }[];
  documents: { title: string; docType: string | null; text: string | null }[];
  evidence: { quote: string | null; location: string | null }[];
}

export const BIOGRAPHY_SYSTEM = `Eres un genealogista que redacta una biografía breve y FACTUAL de una persona basándote ÚNICAMENTE en la evidencia proporcionada (parentescos, eventos, documentos y citas). Reglas estrictas:
- No inventes datos, fechas, lugares ni parentescos que no consten en la evidencia.
- Escribe en prosa continua, en pasado, de 120 a 220 palabras aproximadamente.
- Respeta las fechas tal como se dan (incluidas las inciertas como "hacia 1850"); no las normalices.
- Si la evidencia es escasa, dilo con naturalidad en lugar de rellenar con conjeturas.
- No incluyas encabezados, viñetas ni notas: solo el texto de la biografía.`;

function list(label: string, items: string[]): string {
  const clean = items.map((x) => x.trim()).filter(Boolean);
  return clean.length ? `${label}: ${clean.join(', ')}.` : '';
}

/** Build the user message: a structured, deduplicated digest of the person's sources. */
export function composeBiographyContext(s: BiographySources): string {
  const lines: string[] = [];
  lines.push(`Persona: ${s.name}${s.sex && s.sex !== 'unknown' ? ` (${s.sex === 'male' ? 'hombre' : 'mujer'})` : ''}.`);
  if (s.birthDate) lines.push(`Nacimiento: ${s.birthDate}.`);
  if (s.deathDate) lines.push(`Defunción: ${s.deathDate}.`);
  const kin = [list('Padres', s.parents), list('Cónyuges', s.spouses), list('Hijos', s.children), list('Hermanos', s.siblings)].filter(Boolean);
  if (kin.length) lines.push(kin.join(' '));

  if (s.events.length) {
    lines.push('Eventos:');
    for (const e of s.events.slice(0, 40)) {
      const parts = [EVENT_LABEL[e.type] ?? e.type];
      if (e.date) parts.push(e.date);
      if (e.place) parts.push(`en ${e.place}`);
      lines.push(`- ${parts.join(', ')}.`);
    }
  }

  const docs = s.documents.filter((d) => d.title || d.text);
  if (docs.length) {
    lines.push('Documentos vinculados:');
    for (const d of docs.slice(0, 12)) {
      const snippet = (d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- ${d.title}${d.docType ? ` [${d.docType}]` : ''}${snippet ? `: ${snippet}` : ''}`);
    }
  }

  const quotes = s.evidence.filter((e) => e.quote);
  if (quotes.length) {
    lines.push('Citas de evidencia:');
    for (const q of quotes.slice(0, 12)) {
      lines.push(`- "${(q.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"${q.location ? ` (${q.location})` : ''}`);
    }
  }

  lines.push('\nRedacta la biografía factual a partir de lo anterior.');
  return lines.join('\n');
}

/** True when there is enough to write anything at all. */
export function hasBiographyEvidence(s: BiographySources): boolean {
  return Boolean(
    s.birthDate ||
      s.deathDate ||
      s.events.length ||
      s.documents.some((d) => d.title || d.text) ||
      s.evidence.some((e) => e.quote) ||
      s.parents.length ||
      s.spouses.length ||
      s.children.length
  );
}
