const keys = {
  protagonists: 'Protagonistas',
  alive: 'Con vida',
} as const;

type Values = Record<(typeof keys)[keyof typeof keys], string>;
const map = (values: Record<keyof typeof keys, string>): Values =>
  Object.fromEntries(Object.entries(keys).map(([name, source]) => [source, values[name as keyof typeof keys]])) as Values;

export const WORLDBUILDING_TRANSLATIONS = {
  en: map({ protagonists: 'Protagonists', alive: 'Alive' }),
  fr: map({ protagonists: 'Protagonistes', alive: 'En vie' }),
  de: map({ protagonists: 'Hauptfiguren', alive: 'Lebend' }),
  pt: map({ protagonists: 'Protagonistas', alive: 'Vivos' }),
  ptBR: map({ protagonists: 'Protagonistas', alive: 'Vivos' }),
  it: map({ protagonists: 'Protagonisti', alive: 'In vita' }),
  tr: map({ protagonists: 'Başkahramanlar', alive: 'Hayatta' }),
} as const;
