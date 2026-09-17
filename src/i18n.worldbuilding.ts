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
  'zh-CN': map({ protagonists: '主角', alive: '在世' }),
  'zh-TW': map({ protagonists: '主角', alive: '在世' }),
  ko: map({
    protagonists: "주인공",
    alive: "살아 있는",
  }),
  ja: map({
    protagonists: "主人公",
    alive: "生きている",
  }),
} as const;
