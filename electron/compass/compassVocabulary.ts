// SPDX-License-Identifier: AGPL-3.0-only

export const COMPASS_THEME_ALIASES: Readonly<Record<string, string>> = {
  'francoist spain': 'franquismo', franquista: 'franquismo', franquisme: 'franquismo', francoism: 'franquismo',
  gender: 'género', 'gender studies': 'género', 'estudios de género': 'género', genre: 'género', gênero: 'género', genere: 'género',
  representation: 'representación', spain: 'españa', espagne: 'españa', spanien: 'españa',
  'travel writing': 'literatura de viajes', 'escritura de viajes': 'literatura de viajes', 'relatos de viaje': 'literatura de viajes',
  'relato de viaje': 'literatura de viajes', 'guías de viaje': 'literatura de viajes', viajes: 'literatura de viajes',
  'récits de voyage': 'literatura de viajes', 'récit de voyage': 'literatura de viajes', 'literatura de viagem': 'literatura de viajes',
  'reiseberichte': 'literatura de viajes', 'letteratura di viaggio': 'literatura de viajes',
  'women travellers': 'viajeras', 'british women travellers': 'viajeras', 'femmes voyageuses': 'viajeras',
  ethics: 'ética', 'ethics of travel': 'ética del viaje', 'escape from reality': 'evasión',
  'rural andalusia': 'andalucía rural', 'national identity': 'identidad nacional', identité: 'identidad', identity: 'identidad', identidade: 'identidad',
  tourism: 'turismo', tourisme: 'turismo', turismo: 'turismo', 'turismo y viajes': 'turismo', 'viajes y turismo': 'turismo',
  colonialism: 'colonialismo', colonialisme: 'colonialismo', colonialismo: 'colonialismo', kolonialismus: 'colonialismo',
  'historia contemporánea de españa': 'historia de españa', 'historia social de españa': 'historia de españa',
};

export const COMPASS_CONCEPT_GROUPS: readonly (readonly string[])[] = [
  ['franquismo', 'francoist spain', 'francoism', 'franquisme', 'españa franquista', 'regime franquista'],
  ['turismo', 'tourism', 'tourisme', 'turismo cultural', 'fremdenverkehr'],
  ['literatura de viajes', 'travel writing', 'travel literature', 'récits de voyage', 'literatura de viagem', 'reiseberichte', 'letteratura di viaggio'],
  ['género', 'gender', 'genre', 'gênero', 'genere', 'women', 'mujeres', 'femmes', 'mulheres'],
  ['identidad', 'identity', 'identité', 'identidade', 'identità'],
  ['colonialismo', 'colonialism', 'colonialisme', 'kolonialismus'],
] as const;

const FUNCTION_WORDS: Readonly<Record<string, readonly string[]>> = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'por', 'para', 'sobre', 'durante', 'entre'],
  ca: ['el', 'la', 'els', 'les', 'de', 'del', 'i', 'en', 'per', 'sobre', 'durant', 'entre'],
  pt: ['o', 'a', 'os', 'as', 'de', 'do', 'da', 'e', 'em', 'por', 'para', 'sobre', 'durante'],
  en: ['the', 'a', 'an', 'of', 'and', 'in', 'by', 'for', 'on', 'during', 'between', 'with'],
  fr: ['le', 'la', 'les', 'de', 'du', 'des', 'et', 'en', 'par', 'pour', 'sur', 'pendant', 'entre'],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'in', 'von', 'für', 'über', 'während', 'zwischen'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'e', 'in', 'per', 'su', 'durante', 'tra'],
};

// Function words alone are frequently ambiguous across Romance languages. These
// local markers deliberately favour distinctive spellings without making any
// network or model call.
const LANGUAGE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  es: ['espanol', 'espanola', 'guerra civil espanola', 'viajeras', 'siglo'],
  ca: ['espanyol', 'espanyola', 'guerra civil espanyola', 'segle', 'viatgeres'],
  pt: ['nas', 'nos', 'ditaduras', 'ibericas', 'viagem', 'mulheres'],
  en: ['travel', 'writing', 'francoist', 'british', 'century'],
  fr: ['recits', 'voyage', 'espagne', 'franquisme', 'siecle'],
  de: ['reiseberichte', 'spanien', 'jahrhundert', 'wahrend'],
  it: ['viaggio', 'spagna', 'franchismo', 'secolo'],
};

export function normalizeCompassTerm(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[“”"'.:;]+/g, '').replace(/\s+/g, ' ');
  return COMPASS_THEME_ALIASES[normalized] ?? normalized;
}

export function detectCompassLanguage(value: string): string | undefined {
  const normalized = value.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  const words: string[] = [...(normalized.match(/\p{L}+/gu) ?? [])];
  if (words.length < 2) return undefined;
  const scores = Object.entries(FUNCTION_WORDS).map(([language, profile]) => {
    const markerScore = (LANGUAGE_MARKERS[language] ?? []).reduce(
      (score, marker) => score + ((marker.includes(' ')
        ? normalized.includes(marker)
        : words.includes(marker)) ? 1 : 0),
      0,
    );
    return [language, words.reduce((score, word) => score + (profile.includes(word) ? 1 : 0), 0) + markerScore * 3] as const;
  });
  scores.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return scores[0][1] > 0 && scores[0][1] > (scores[1]?.[1] ?? -1) ? scores[0][0] : undefined;
}

export function conceptsInCompassQuery(value: string): string[][] {
  const haystack = value.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  return COMPASS_CONCEPT_GROUPS.filter((group) => group.some((variant) => haystack.includes(variant.normalize('NFKD').replace(/\p{M}/gu, '')))).map((group) => [...group]);
}
