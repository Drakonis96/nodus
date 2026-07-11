// Human-facing "what's new" notes shown once after the app updates to a new
// version. Newest first. Each highlight is bilingual so the modal can follow the
// UI language. Keep these short and user-facing — they are product notes, not a
// changelog. Add a new entry at the top whenever the app version bumps.

export interface ReleaseNote {
  version: string;
  /** ISO date (YYYY-MM-DD) the version shipped. */
  date: string;
  highlights: { es: string; en: string }[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.7.4',
    date: '2026-07-11',
    highlights: [
      {
        es: 'Inmersión estrena galería con vista de mosaico y de lista, y un botón «Nueva inmersión» con su propia ventana, igual que Deep Research.',
        en: 'Immersion has a new gallery with grid and list views, plus a “New immersion” button with its own dialog — just like Deep Research.',
      },
      {
        es: 'Selección múltiple en Deep Research e Inmersión para eliminar varios elementos a la vez, con confirmación.',
        en: 'Multi-select in Deep Research and Immersion to delete several items at once, with confirmation.',
      },
      {
        es: 'Nuevo botón «Traducir»: genera con IA una traducción del informe o de la inmersión a cualquier idioma. Cada traducción se guarda para releerla, regenerarla o eliminarla.',
        en: 'New “Translate” button: generate an AI translation of a report or immersion into any language. Each translation is saved to reread, regenerate or delete.',
      },
      {
        es: 'Al actualizar la app verás esta ventana con las novedades y las correcciones.',
        en: 'After each update you’ll see this what’s-new window with the latest changes and fixes.',
      },
    ],
  },
  {
    version: '1.7.3',
    date: '2026-07-11',
    highlights: [
      {
        es: 'La interfaz ya no se congela mientras se genera el audio de narración en Deep Research e Inmersión.',
        en: 'The interface no longer freezes while narration audio is generated in Deep Research and Immersion.',
      },
      {
        es: 'Corregida la voz «Sharvard»: ahora aparece como voz masculina, que es la que el motor reproduce realmente.',
        en: 'Fixed the “Sharvard” voice: it now appears as a male voice, which is what the engine actually renders.',
      },
    ],
  },
];

/** Compare two dotted numeric versions. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Release notes strictly newer than `since` (a version string, or null for a
 *  fresh install), capped and newest-first, up to and including `current`. */
export function releaseNotesSince(since: string | null, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter(
    (note) =>
      compareVersions(note.version, current) <= 0 &&
      (since == null || compareVersions(note.version, since) > 0)
  );
}
