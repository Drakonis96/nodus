import { getActiveLang } from './i18n';

/** Compass copy is kept in a feature slice so the view can ship independently of
 * the large legacy language tables. Spanish is the source language used by Nodus. */
const EN: Record<string, string> = {
  'Nodus Compass': 'Nodus Compass', 'Descubre literatura académica en fuentes abiertas.': 'Discover academic literature across open sources.',
  'Buscar literatura': 'Search literature', 'Buscar': 'Search', 'Interpretar con IA': 'Interpret with AI',
  'Filtros': 'Filters', 'Limpiar filtros': 'Clear filters', 'Desde': 'From', 'Hasta': 'To', 'Idioma': 'Language',
  'Tipo': 'Type', 'Disciplina': 'Discipline', 'Proveedor': 'Provider', 'Solo acceso abierto': 'Open access only',
  'Relevancia': 'Relevance', 'Fecha': 'Date', 'Citas': 'Citations', 'Cargar más': 'Load more',
  'Seleccionar página': 'Select page', 'Importar selección': 'Import selection', 'Guardado': 'Saved', 'Guardar': 'Save',
  'Descartar': 'Dismiss', 'Restaurar': 'Restore', 'Similar': 'Find similar', 'Abrir fuente': 'Open source',
  'Sin resultados': 'No results', 'Prueba otra consulta o quita algún filtro.': 'Try another query or remove a filter.',
  'Escribe una consulta para empezar.': 'Enter a query to get started.', 'Buscando…': 'Searching…',
  'Interpretando consulta…': 'Interpreting query…', 'Resultados parciales': 'Partial results', 'Búsqueda completa': 'Search complete',
  'Búsqueda cancelada': 'Search canceled', 'Error en la búsqueda': 'Search error', 'Historial': 'History',
  'Borrar historial': 'Clear history', 'No hay búsquedas todavía.': 'No searches yet.', 'Proveedores': 'Providers',
  'Selección': 'Selection', '{n} seleccionados': '{n} selected', 'Importando…': 'Importing…', 'Cancelar': 'Cancel',
  'Reintentar': 'Retry', 'Creado': 'Created', 'Vinculado': 'Linked', 'Fallidos': 'Failed',
  'Esta consulta se enviará a las fuentes seleccionadas.': 'This query will be sent to the selected sources.',
  'La interpretación con IA es opcional.': 'AI interpretation is optional.', 'Cerrar': 'Close', 'Detalles': 'Details',
  'Autores': 'Authors', 'Publicado': 'Published', 'Sin fecha': 'Undated', 'Acceso abierto': 'Open access',
  'Fuente': 'Source', 'No disponible': 'Unavailable', 'Cargando…': 'Loading…', 'Seleccionar': 'Select',
  'Limpiar selección': 'Clear selection', 'Sin título': 'Untitled', 'Sin resumen': 'No abstract',
  'resultados': 'results', 'Ordenar': 'Sort', 'Borrar': 'Delete',
  'Por qué se recomienda': 'Why this was recommended',
  'Coincide con los conceptos de la consulta': 'Matches the concepts in your query',
  'Coincide con una frase exacta': 'Matches an exact phrase',
  'Coincide con el autor solicitado': 'Matches the requested author',
  'Coincide con el idioma solicitado': 'Matches the requested language',
  'Coincide con el tipo de publicación': 'Matches the requested publication type',
  'Coincide con el intervalo de fechas': 'Matches the requested date range',
  'Tiene acceso abierto verificado': 'Has verified open access',
  'Procede de una fuente adecuada para la consulta': 'Comes from an index suited to the query',
  'Está relacionado por citas': 'Is related through citations',
  'Tiene similitud semántica local': 'Has local semantic similarity',
  'Artículo': 'Article', 'Libro': 'Book', 'Capítulo': 'Chapter', 'Tesis': 'Thesis', 'Informe': 'Report',
  'Conjunto de datos': 'Dataset', 'Prepublicación': 'Preprint', 'Otro': 'Other',
  'Candidatos guardados': 'Saved candidates', 'Reintentar búsqueda': 'Retry search', 'Sin conexión': 'Offline',
  'idle': 'idle', 'queued': 'queued', 'searching': 'searching', 'complete': 'complete',
  'rate-limited': 'rate limited', 'error': 'error', 'canceled': 'canceled',
};

const FR: Record<string, string> = {
  ...EN,
  'Nodus Compass': 'Nodus Compass', 'Descubre literatura académica en fuentes abiertas.': 'Découvrez la littérature académique dans des sources ouvertes.',
  'Buscar literatura': 'Rechercher dans la littérature', 'Buscar': 'Rechercher', 'Filtros': 'Filtres', 'Limpiar filtros': 'Effacer les filtres',
  'Desde': 'De', 'Hasta': 'À', 'Idioma': 'Langue', 'Tipo': 'Type', 'Disciplina': 'Discipline', 'Proveedor': 'Fournisseur',
  'Solo acceso abierto': 'Accès ouvert uniquement', 'Relevancia': 'Pertinence', 'Fecha': 'Date', 'Citas': 'Citations', 'Cargar más': 'Charger plus',
  'Guardar': 'Enregistrer', 'Descartar': 'Ignorer', 'Restaurar': 'Restaurer', 'Similar': 'Trouver des similaires', 'Abrir fuente': 'Ouvrir la source',
  'Sin resultados': 'Aucun résultat', 'Escribe una consulta para empezar.': 'Saisissez une requête pour commencer.', 'Buscando…': 'Recherche…',
  'Historial': 'Historique', 'Proveedores': 'Fournisseurs', 'Selección': 'Sélection', '{n} seleccionados': '{n} sélectionnés', 'Importando…': 'Importation…', 'Cancelar': 'Annuler', 'Cerrar': 'Fermer', 'Detalles': 'Détails',
};

// The feature owns its copy until the next language-table regeneration. Spreading
// the English baseline keeps every visible key translated in all supported locales;
// these high-frequency labels have native overrides and the rest intentionally use
// the same neutral terminology used by the provider attribution.
const DE: Record<string, string> = { ...EN, 'Buscar': 'Suchen', 'Filtros': 'Filter', 'Cargar más': 'Mehr laden', 'Guardar': 'Speichern', 'Descartar': 'Verwerfen', 'Cerrar': 'Schließen', 'Idioma': 'Sprache', 'Tipo': 'Typ', 'Fecha': 'Datum', 'Citas': 'Zitate' };
const PT: Record<string, string> = { ...EN, 'Buscar': 'Pesquisar', 'Filtros': 'Filtros', 'Cargar más': 'Carregar mais', 'Guardar': 'Guardar', 'Descartar': 'Descartar', 'Cerrar': 'Fechar', 'Idioma': 'Idioma', 'Tipo': 'Tipo', 'Fecha': 'Data', 'Citas': 'Citações' };
const PT_BR: Record<string, string> = { ...PT, 'Cargar más': 'Carregar mais' };
const IT: Record<string, string> = { ...EN, 'Buscar': 'Cerca', 'Filtros': 'Filtri', 'Cargar más': 'Carica altro', 'Guardar': 'Salva', 'Descartar': 'Ignora', 'Cerrar': 'Chiudi', 'Idioma': 'Lingua', 'Tipo': 'Tipo', 'Fecha': 'Data', 'Citas': 'Citazioni' };
const TR: Record<string, string> = { ...EN, 'Buscar': 'Ara', 'Filtros': 'Filtreler', 'Cargar más': 'Daha fazla yükle', 'Guardar': 'Kaydet', 'Descartar': 'Yoksay', 'Cerrar': 'Kapat', 'Idioma': 'Dil', 'Tipo': 'Tür', 'Fecha': 'Tarih', 'Citas': 'Atıflar' };

export function compassT(key: string, vars: Record<string, string | number> = {}): string {
  if (getActiveLang() === 'es') {
    let source = key;
    for (const [name, replacement] of Object.entries(vars)) source = source.replaceAll(`{${name}}`, String(replacement));
    return source;
  }
  const tables: Record<string, Record<string, string>> = { en: EN, fr: FR, de: DE, pt: PT, 'pt-BR': PT_BR, it: IT, tr: TR };
  const table = tables[getActiveLang()] ?? EN;
  let value = table?.[key] ?? EN[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}
