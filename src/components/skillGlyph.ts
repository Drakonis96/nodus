/** A stable icon and accent colour for a skill, in both the library and the marketplace.
 *
 *  Two properties matter, and they pull in opposite directions. A skill must look the same
 *  wherever it appears — the card you install in the marketplace is the card you later find
 *  in your library, and a skill whose icon changed between the two would read as a
 *  different thing. And skills must look different from each other, because a column of
 *  identical sparkles is a column you have to read word by word.
 *
 *  So: the skills we actually publish get an icon chosen for them, anything recognisable
 *  gets one from its own words, and everything else gets one derived from its identifier —
 *  never from its position in a list, which would change as the list does. */

/** The catalogue's own rule for turning a name into a package identifier, repeated rather
 *  than imported: this module is used on both sides of the marketplace boundary. */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'my-skill';

/** Same string, same number, on every platform and every run. */
function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

/** The published catalogue, named one by one: a chosen icon beats a derived one. */
const PUBLISHED: Record<string, string> = {
  'action-planner': 'route',
  alphagenome: 'network',
  'brainstorm-studio': 'bulb',
  'chemistry-studio': 'flask',
  'compare-choose': 'swap',
  'constructive-critic': 'highlighter',
  'descriptive-statistics': 'chartBar',
  'image-atelier': 'image',
  legalize: 'scale',
  'make-it-simple': 'minimize',
  'perspective-switcher': 'eye',
  'socratic-tutor': 'graduation',
  'svg-studio': 'palette',
  'thought-partner': 'chat',
  'writing-partner': 'edit',
};

/** The three built-ins with a subject of their own. `general` is deliberately absent: it
 *  marks a skill as included in the build, which says nothing about what it does, and
 *  answering it here would give every seeded skill the same icon. */
const BUILTIN: Record<string, string> = { svg: 'palette', image: 'image', socratic: 'graduation' };

/** Read from the skill's own words. Ordered: the first match wins, so put the specific
 *  subjects before the general verbs. */
const WORDS: Array<[RegExp, string]> = [
  [/chem|molecul|reacti|químic/i, 'flask'],
  [/genom|dna|protein|biolog|life scien/i, 'network'],
  [/law|legal|court|statut|jurisprud|derecho/i, 'scale'],
  [/\b3d\b|model|anatom|artefact|artifact/i, 'cube'],
  [/map|geogra|spatial|atlas/i, 'map'],
  // `\bgraph` rather than `graph`, which claimed palaeography.
  [/statistic|data|dataset|chart|\bgraph|estadíst/i, 'chartBar'],
  // Not `transcri`: transcribing a manuscript is the commoner sense in this application,
  // and it belongs with the archival work rather than with sound.
  [/audio|voice|podcast|recording|sound/i, 'audio'],
  [/video|film|cinema/i, 'video'],
  [/translat|language|idioma/i, 'languages'],
  [/cite|citation|bibliog|referenc|source/i, 'quote'],
  [/teach|learn|tutor|course|student|lesson|docen/i, 'graduation'],
  [/quiz|exam|test|assess/i, 'quiz'],
  [/slide|present|deck|talk/i, 'presentation'],
  [/code|program|script|software/i, 'code'],
  [/draw|svg|vector|diagram|illustrat|design|visual/i, 'palette'],
  [/photo|picture|image|imagen/i, 'image'],
  [/plan|task|schedul|agenda|productiv/i, 'route'],
  [/decide|decision|compare|choos|trade-?off/i, 'swap'],
  [/critique|criticis|review|feedback|edit/i, 'highlighter'],
  [/idea|brainstorm|creativ|invent/i, 'bulb'],
  [/interview|dialog|conversa|question/i, 'chat'],
  [/summar|simplif|shorten|concise/i, 'minimize'],
  [/research|investig|discover|explor/i, 'telescope'],
  [/writ|prose|essay|draft|narrat|redact/i, 'edit'],
  [/histor|archiv|palaeog|paleog|timeline|chronolog/i, 'clock'],
  [/people|person|biograph|prosopog/i, 'users'],
  [/think|reason|logic|perspectiv|argument/i, 'compass'],
];

/** Everything else, by identifier. Twenty distinguishable shapes: with a hue alongside
 *  them, two skills sitting next to each other looking alike is remote. */
const POOL = ['sparkles', 'compass', 'telescope', 'puzzle', 'layers', 'target', 'radar', 'tree', 'globe', 'flask',
  'tools', 'bookOpen', 'notebook', 'wand', 'key', 'cube', 'network', 'grid', 'quote', 'bulb'];

export interface SkillGlyph {
  /** An `Icon` name. */
  icon: string;
  /** A hue in degrees, for the tinted plate the icon sits on. */
  hue: number;
}

export function skillGlyph(input: {
  /** The package identifier where there is one: it is the same in both views. */
  packageId?: string;
  /** The library's own identifier, used only when there is nothing steadier. */
  id?: string;
  name: string;
  description?: string;
  category?: string;
  builtin?: string;
}): SkillGlyph {
  // A skill's identity is its package, not the row it was installed into: a library copy
  // and its catalogue entry must come out the same, and the library's own identifier is a
  // fresh id per profile. A skill that arrived with the build has no origin at all, so the
  // name is slugged the same way the catalogue slugs it.
  const identity = input.packageId ?? slug(input.name);
  const hue = (hash(identity) % 12) * 30 + 12;

  const named = PUBLISHED[identity] ?? (input.builtin && BUILTIN[input.builtin]) ?? (input.id && PUBLISHED[input.id]);
  if (named) return { icon: named, hue };

  const words = `${input.name} ${input.category ?? ''} ${input.description ?? ''}`;
  for (const [pattern, icon] of WORDS) if (pattern.test(words)) return { icon, hue };

  return { icon: POOL[hash(identity) % POOL.length], hue };
}

/** Alphabetical by name, in the reader's own language: `localeCompare` puts Á next to A
 *  and á next to Á, which a code-point sort does not. */
export const byName = <T extends { name: string }>(locale: string) => (a: T, b: T) =>
  a.name.localeCompare(b.name, locale, { sensitivity: 'base', numeric: true });
