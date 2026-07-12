// Shared Spanish labels for genealogy records, used by the person dossier, the
// timeline and the personas list without cross-importing views.

export const EVENT_TYPE_LABEL: Record<string, string> = {
  birth: 'Nacimiento',
  baptism: 'Bautismo',
  marriage: 'Matrimonio',
  death: 'Defunción',
  burial: 'Entierro',
  census: 'Censo',
  residence: 'Residencia',
  migration: 'Migración',
  occupation: 'Ocupación',
  other: 'Otro',
};

export const ROLE_LABEL: Record<string, string> = {
  principal: 'principal',
  spouse: 'cónyuge',
  father: 'padre',
  mother: 'madre',
  child: 'hijo/a',
  witness: 'testigo',
  officiant: 'oficiante',
  other: 'otro',
};

export const FACT_LABEL: Record<string, string> = { birth: 'nacimiento', death: 'defunción' };
