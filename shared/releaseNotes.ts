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
    version: '2.0.1',
    date: '2026-07-12',
    highlights: [
      {
        es: 'El selector de bóvedas muestra ahora una etiqueta con el tipo de cada bóveda (Académico, Genealogía…), y el rótulo «Activa» y el botón «Cargar» comparten por fin la misma tipografía.',
        en: 'The vault switcher now shows a badge with each vault’s type (Academic, Genealogy…), and the “Active” label and the “Load” button finally share the same typography.',
      },
      {
        es: 'En las fichas de persona, los botones de editar y eliminar de las relaciones sociales pasan a ser iconos, y el panel de «Ajustar encuadre» del retrato se cierra al hacer clic fuera y ya no queda descuadrado.',
        en: 'In the person dossier, the edit and delete buttons of social relations are now icons, and the portrait “Adjust framing” panel closes on an outside click and is no longer misaligned.',
      },
      {
        es: 'Corregida la ventana de novedades: ahora aparece correctamente al actualizar y recupera los cambios de la versión 2.0.0 si te los perdiste.',
        en: 'Fixed the what’s-new window: it now appears correctly after updating and recovers the 2.0.0 changes if you missed them.',
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-07-12',
    highlights: [
      {
        es: 'Nodus estrena tipos de bóveda: cada bóveda tiene ahora un modo que adapta las secciones visibles y la personalidad del asistente de IA. Esta versión trae dos modos, «Académico» y «Genealogía», y anuncia los que llegarán después: Estudio, Fuentes primarias y Bases de datos.',
        en: 'Nodus introduces vault types: each vault now has a mode that tailors which sections are shown and the AI assistant’s persona. This release ships two modes, “Academic” and “Genealogy”, and previews the ones coming next: Study, Primary Sources and Databases.',
      },
      {
        es: 'Nuevo modo Genealogía: reconstruye historia familiar a partir de fuentes primarias con fichas de persona, árbol genealógico, cronología, archivo de evidencia y un mapa real. El asistente actúa como genealogista y propone parentescos a partir de la evidencia, siguiendo el estándar de prueba genealógico.',
        en: 'New Genealogy mode: reconstruct family history from primary sources with person dossiers, a family tree, a timeline, an evidence archive and a real map. The assistant acts as a genealogist and proposes kinship from the evidence, following the genealogical proof standard.',
      },
      {
        es: 'Relaciones sociales: una segunda red, independiente del parentesco, para amistades, patronazgo, empleo, rivalidades y correspondencia — el material del historiador social y prosopográfico.',
        en: 'Social relations: a second network, independent from kinship, for friendships, patronage, employment, rivalries and correspondence — the material of the social and prosopographical historian.',
      },
      {
        es: 'Deep Research aprende genealogía: compone un informe de historia familiar sobre el archivo indexado por embeddings y la biblioteca. La cabecera muestra ahora el modo de la bóveda activa en su color de acento.',
        en: 'Deep Research learns genealogy: it composes a family-history report over the embedding-indexed archive and library. The header now shows the active vault’s mode in its accent colour.',
      },
      {
        es: 'Copias de seguridad multi-bóveda: el sistema de respaldos automáticos cifrados abarca ahora todas tus bóvedas con rotación por generaciones.',
        en: 'Multi-vault backups: the automatic encrypted backup system now covers all your vaults with generational rotation.',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-11',
    highlights: [
      {
        es: 'Nuevo copiloto de escritura para LibreOffice Writer (Linux, macOS y Windows): instala la macro desde Ajustes → Copiloto de escritura (LibreOffice), ejecútala en Writer y el panel del copiloto sigue tu cursor para analizar el párrafo e insertar texto citado con IA. La conexión se configura sola.',
        en: 'New writing copilot for LibreOffice Writer (Linux, macOS and Windows): install the macro from Settings → Writing copilot (LibreOffice), run it in Writer, and the copilot pane follows your cursor to analyze the paragraph and insert AI-drafted cited text. The connection configures itself.',
      },
      {
        es: 'Nodus llega a Linux: cada release publica ahora instaladores .deb y AppImage, y la app hereda el tema del cursor del sistema en Wayland.',
        en: 'Nodus lands on Linux: every release now ships .deb and AppImage installers, and the app inherits the system cursor theme on Wayland.',
      },
      {
        es: 'Los idiomas de los prompts suman francés y turco: las ideas, los informes de Deep Research y los borradores del taller pueden generarse también en esos idiomas. Las citas literales siempre conservan el idioma original.',
        en: 'Prompt languages now include French and Turkish: ideas, Deep Research reports and workshop drafts can also be generated in those languages. Verbatim quotes always keep the source language.',
      },
      {
        es: 'Corregido: los PDFs locales añadidos después del primer análisis vuelven a detectarse al sincronizar, en lugar de quedarse marcados como «sin texto» para siempre.',
        en: 'Fixed: local PDFs attached after a first scan are picked up again on sync instead of staying flagged as “no text” forever.',
      },
      {
        es: 'Esta versión incluye la primera contribución externa al proyecto: el copiloto de LibreOffice, los paquetes de Linux y los nuevos idiomas nacen del trabajo de Oğuz Karayemiş (@oguzkarayemis). ¡Gracias!',
        en: 'This version includes the project’s first external contribution: the LibreOffice copilot, the Linux packages and the new languages grew from the work of Oğuz Karayemiş (@oguzkarayemis). Thank you!',
      },
    ],
  },
  {
    version: '1.7.5',
    date: '2026-07-11',
    highlights: [
      {
        es: 'Los modelos locales (LM Studio / Ollama) con ventana de contexto pequeña ya no fallan en el asistente de investigación: la app ajusta automáticamente el contexto a la ventana del modelo para que siempre pueda responder.',
        en: 'Local models (LM Studio / Ollama) with a small context window no longer fail in the research assistant: the app now fits the context to the model’s window so it can always answer.',
      },
      {
        es: 'Las citas de los modelos locales se muestran correctamente como «Autor, Año» en lugar del identificador interno de la idea.',
        en: 'Citations from local models now render properly as “Author, Year” instead of the internal idea id.',
      },
      {
        es: 'El asistente de configuración muestra las colecciones como un árbol desplegable, para vigilar subcolecciones concretas cuando una colección es muy grande.',
        en: 'The setup wizard now shows collections as an expandable tree, so you can monitor specific subcollections when a collection is very large.',
      },
    ],
  },
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
