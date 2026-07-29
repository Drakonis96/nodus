import type { ArchiveItemKind } from '@shared/types';
import { getArchiveDocType, type ArchiveDocCategory } from '@shared/archiveDocTypes';

const CATEGORY_ICONS: Record<ArchiveDocCategory, string> = {
  vital: 'user',
  eclesiastico: 'book',
  administrativo: 'archive',
  notarial: 'edit',
  judicial: 'scale',
  militar: 'flag',
  educativo: 'graduation',
  sanitario: 'file',
  laboral: 'tools',
  heraldico: 'shield',
  prensa: 'book',
  narrative: 'notebook',
  visual: 'image',
  data: 'grid',
  efimera: 'tag',
  monumental: 'building',
  arqueologico: 'compass',
  other: 'file',
};

const TYPE_ICONS: Record<string, string> = {
  letter: 'chat',
  acta_de_asociacion_sociedad: 'users',
  photograph: 'image',
  recorte_de_hemeroteca_noticia_de_periodi: 'book',
  map: 'map',
  administrative: 'archive',
  other_doc: 'notebook',
  carta_de_pago_recibo_de_deuda: 'file',
  notes: 'edit',
  diary: 'notebook',
  census: 'users',
  transcription: 'scanText',
  database: 'grid',
  illustration: 'image',
};

const KIND_ICONS: Record<ArchiveItemKind, string> = {
  image: 'image',
  csv: 'grid',
  xlsx: 'grid',
  pdf: 'book',
  text: 'notebook',
  other: 'file',
};

export function suggestedArchiveDocumentIcon(
  documentType: string | null | undefined,
  kind: ArchiveItemKind = 'other',
): string {
  if (documentType && TYPE_ICONS[documentType]) return TYPE_ICONS[documentType];
  const category = getArchiveDocType(documentType)?.category;
  return category ? CATEGORY_ICONS[category] : KIND_ICONS[kind];
}

export function archiveDocumentIcon(
  metadata: Record<string, unknown> | null | undefined,
  documentType: string | null | undefined,
  kind: ArchiveItemKind = 'other',
): string {
  const stored = metadata?.documentIcon;
  return typeof stored === 'string' && stored.trim()
    ? stored
    : suggestedArchiveDocumentIcon(documentType, kind);
}
