/**
 * Document-type taxonomy for evidence-archive items, with an optional per-type
 * metadata form. This classifies PRIMARY SOURCES (a birth record, a diary, a
 * photograph…) — academic/bibliographic material is not an archive item; it belongs
 * in the library via Zotero. Pure and dependency-free so both processes share it.
 *
 * Dates are free-text fields on purpose: genealogical dates are uncertain
 * ("c. 1850", "antes de 1880") and a date picker would fight that.
 */

import { parseHistoricalDate } from './genealogyDates';

export type ArchiveDocCategory = 'vital' | 'civil' | 'narrative' | 'visual' | 'data' | 'other';

export interface DocField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'number';
  placeholder?: string;
}

export interface ArchiveDocTypeDef {
  id: string;
  label: string;
  category: ArchiveDocCategory;
  fields: DocField[];
}

export const ARCHIVE_DOC_CATEGORIES: { id: ArchiveDocCategory; label: string }[] = [
  { id: 'vital', label: 'Registros vitales' },
  { id: 'civil', label: 'Registros civiles y administrativos' },
  { id: 'narrative', label: 'Documentos personales' },
  { id: 'visual', label: 'Material visual' },
  { id: 'data', label: 'Datos y transcripciones' },
  { id: 'other', label: 'Otros' },
];

// Reused fields.
const REF: DocField = { key: 'referencia', label: 'Referencia / signatura', type: 'text', placeholder: 'Archivo, legajo, folio…' };
const PLACE: DocField = { key: 'lugar', label: 'Lugar', type: 'text' };

export const ARCHIVE_DOC_TYPES: ArchiveDocTypeDef[] = [
  // ── Vital records ──────────────────────────────────────────────────────────
  {
    id: 'birth_record',
    label: 'Partida de nacimiento',
    category: 'vital',
    fields: [
      { key: 'persona', label: 'Persona', type: 'text' },
      { key: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', placeholder: 'c. 1850' },
      PLACE,
      { key: 'padre', label: 'Padre', type: 'text' },
      { key: 'madre', label: 'Madre', type: 'text' },
      { key: 'parroquia_registro', label: 'Parroquia / registro', type: 'text' },
      REF,
    ],
  },
  {
    id: 'baptism_record',
    label: 'Partida de bautismo',
    category: 'vital',
    fields: [
      { key: 'persona', label: 'Persona', type: 'text' },
      { key: 'fecha', label: 'Fecha de bautismo', type: 'date' },
      PLACE,
      { key: 'padres', label: 'Padres', type: 'text' },
      { key: 'padrinos', label: 'Padrinos', type: 'text' },
      { key: 'parroquia_registro', label: 'Parroquia / registro', type: 'text' },
      REF,
    ],
  },
  {
    id: 'marriage_record',
    label: 'Partida de matrimonio',
    category: 'vital',
    fields: [
      { key: 'conyuge_1', label: 'Cónyuge 1', type: 'text' },
      { key: 'conyuge_2', label: 'Cónyuge 2', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      PLACE,
      { key: 'padres_conyuge_1', label: 'Padres del cónyuge 1', type: 'text' },
      { key: 'padres_conyuge_2', label: 'Padres del cónyuge 2', type: 'text' },
      { key: 'testigos', label: 'Testigos', type: 'text' },
      { key: 'parroquia_registro', label: 'Parroquia / registro', type: 'text' },
      REF,
    ],
  },
  {
    id: 'death_record',
    label: 'Partida de defunción',
    category: 'vital',
    fields: [
      { key: 'persona', label: 'Persona', type: 'text' },
      { key: 'fecha_defuncion', label: 'Fecha de defunción', type: 'date' },
      PLACE,
      { key: 'edad', label: 'Edad', type: 'text' },
      { key: 'causa', label: 'Causa', type: 'text' },
      { key: 'conyuge', label: 'Cónyuge', type: 'text' },
      { key: 'lugar_entierro', label: 'Lugar de entierro', type: 'text' },
      REF,
    ],
  },
  // ── Civil / administrative ─────────────────────────────────────────────────
  {
    id: 'census',
    label: 'Censo / Padrón',
    category: 'civil',
    fields: [
      { key: 'anio', label: 'Año', type: 'text' },
      PLACE,
      { key: 'hogar', label: 'Hogar / dirección', type: 'text' },
      { key: 'personas', label: 'Personas registradas', type: 'textarea' },
      REF,
    ],
  },
  {
    id: 'administrative',
    label: 'Trámite administrativo',
    category: 'civil',
    fields: [
      { key: 'tipo_tramite', label: 'Tipo de trámite', type: 'text' },
      { key: 'organismo', label: 'Organismo', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'personas_implicadas', label: 'Personas implicadas', type: 'text' },
      REF,
    ],
  },
  {
    id: 'military',
    label: 'Registro militar',
    category: 'civil',
    fields: [
      { key: 'persona', label: 'Persona', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'unidad_reemplazo', label: 'Unidad / reemplazo', type: 'text' },
      PLACE,
      REF,
    ],
  },
  {
    id: 'migration',
    label: 'Registro de migración',
    category: 'civil',
    fields: [
      { key: 'persona', label: 'Persona', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'origen', label: 'Origen', type: 'text' },
      { key: 'destino', label: 'Destino', type: 'text' },
      { key: 'embarcacion', label: 'Embarcación / medio', type: 'text' },
      REF,
    ],
  },
  // ── Personal / narrative ───────────────────────────────────────────────────
  {
    id: 'diary',
    label: 'Diario',
    category: 'narrative',
    fields: [
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'periodo', label: 'Periodo', type: 'text', placeholder: '1878–1902' },
      PLACE,
      { key: 'resumen', label: 'Resumen', type: 'textarea' },
    ],
  },
  {
    id: 'memoirs',
    label: 'Memorias',
    category: 'narrative',
    fields: [
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'periodo', label: 'Periodo', type: 'text' },
      PLACE,
      { key: 'resumen', label: 'Resumen', type: 'textarea' },
    ],
  },
  {
    id: 'letter',
    label: 'Correspondencia',
    category: 'narrative',
    fields: [
      { key: 'remitente', label: 'Remitente', type: 'text' },
      { key: 'destinatario', label: 'Destinatario', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      PLACE,
      { key: 'resumen', label: 'Resumen', type: 'textarea' },
    ],
  },
  {
    id: 'notes',
    label: 'Notas',
    category: 'narrative',
    fields: [
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'tema', label: 'Tema', type: 'text' },
      { key: 'contenido', label: 'Contenido', type: 'textarea' },
    ],
  },
  // ── Visual ─────────────────────────────────────────────────────────────────
  {
    id: 'photograph',
    label: 'Fotografía',
    category: 'visual',
    fields: [
      { key: 'personas', label: 'Personas', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      PLACE,
      { key: 'fotografo', label: 'Fotógrafo / estudio', type: 'text' },
      { key: 'ocasion', label: 'Ocasión', type: 'text' },
    ],
  },
  {
    id: 'illustration',
    label: 'Ilustración',
    category: 'visual',
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'tecnica', label: 'Técnica', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
    ],
  },
  {
    id: 'artwork',
    label: 'Obra',
    category: 'visual',
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'tipo', label: 'Tipo', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      PLACE,
    ],
  },
  {
    id: 'map',
    label: 'Mapa / Plano',
    category: 'visual',
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
      { key: 'autor', label: 'Autor', type: 'text' },
      { key: 'anio', label: 'Año', type: 'text' },
      PLACE,
      { key: 'escala', label: 'Escala', type: 'text' },
    ],
  },
  // ── Data ───────────────────────────────────────────────────────────────────
  {
    id: 'database',
    label: 'Base de datos',
    category: 'data',
    fields: [
      { key: 'fuente', label: 'Fuente', type: 'text' },
      { key: 'cobertura', label: 'Cobertura', type: 'text', placeholder: 'lugar y años' },
      { key: 'formato', label: 'Formato', type: 'text' },
      { key: 'num_registros', label: 'Nº de registros', type: 'number' },
      REF,
    ],
  },
  {
    id: 'transcription',
    label: 'Índice / Transcripción',
    category: 'data',
    fields: [
      { key: 'fuente_original', label: 'Fuente original', type: 'text' },
      { key: 'cobertura', label: 'Cobertura', type: 'text' },
      { key: 'transcriptor', label: 'Transcriptor', type: 'text' },
      REF,
    ],
  },
  // ── Other ──────────────────────────────────────────────────────────────────
  {
    id: 'other_doc',
    label: 'Otro documento',
    category: 'other',
    fields: [
      { key: 'descripcion', label: 'Descripción', type: 'textarea' },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      PLACE,
      REF,
    ],
  },
];

const BY_ID = new Map(ARCHIVE_DOC_TYPES.map((d) => [d.id, d]));

export function getArchiveDocType(id: string | null | undefined): ArchiveDocTypeDef | null {
  return id ? BY_ID.get(id) ?? null : null;
}

export function isArchiveDocType(id: unknown): boolean {
  return typeof id === 'string' && BY_ID.has(id);
}

export function archiveDocTypesByCategory(): { category: ArchiveDocCategory; label: string; types: ArchiveDocTypeDef[] }[] {
  return ARCHIVE_DOC_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    types: ARCHIVE_DOC_TYPES.filter((d) => d.category === c.id),
  })).filter((g) => g.types.length > 0);
}

// Fields whose type isn't 'date' but whose value is nonetheless date/year-ish
// ("Año" as free text on a census/map, "Periodo" as a year range on a diary).
const YEAR_LIKE_KEYS = new Set(['anio', 'periodo']);

/**
 * Best-effort year a document concerns, derived from its type-specific metadata
 * (the first date-like field with a parseable value, in field order). Used for the
 * archive's year filter/sort — not a property of the file, but of what it documents.
 */
export function extractItemYear(
  docType: string | null | undefined,
  metadata: Record<string, string> | null | undefined
): number | null {
  const def = getArchiveDocType(docType);
  if (!def || !metadata) return null;
  for (const field of def.fields) {
    if (field.type !== 'date' && !YEAR_LIKE_KEYS.has(field.key)) continue;
    const value = metadata[field.key];
    if (!value) continue;
    const year = parseHistoricalDate(value).year;
    if (year != null) return year;
  }
  return null;
}

/** Keep only the fields defined for the type, trimmed and non-empty. */
export function sanitizeDocMetadata(typeId: string | null | undefined, metadata: Record<string, string>): Record<string, string> {
  const def = getArchiveDocType(typeId);
  if (!def) return {};
  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const value = (metadata[field.key] ?? '').trim();
    if (value) out[field.key] = value;
  }
  return out;
}
