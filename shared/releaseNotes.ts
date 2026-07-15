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
    version: '2.3.1',
    date: '2026-07-15',
    highlights: [
      {
        es: 'Se ha solucionado un error que impedía a Nodus leer algunas claves de API de IA ya guardadas y hacía que no aparecieran en Ajustes. Las claves no se habían borrado: esta versión las recupera de forma segura, conserva sus copias cifradas anteriores y vuelve a incluirlas en la copia protegida del workspace.',
        en: 'Fixed an issue that prevented Nodus from reading some previously saved AI API keys, making them disappear from Settings. The keys had not been deleted: this version recovers them safely, preserves their previous encrypted copies and includes them again in the protected workspace backup.',
      },
      {
        es: 'En macOS puede aparecer una solicitud del Llavero durante la recuperación. Comprueba que corresponde a Nodus y selecciona «Permitir siempre»; si la cerraste, puedes repetir la recuperación desde Ajustes → Proveedores.',
        en: 'On macOS, Keychain may ask for permission during recovery. Check that the request belongs to Nodus and choose “Always Allow”; if you dismissed it, retry from Settings → Providers.',
      },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-07-15',
    highlights: [
      {
        es: 'El vault de estudio da un gran salto: cursos y asignaturas, carpetas y apuntes, materiales anotables, grabaciones con transcripción, horario, calendario, banco de preguntas, tests, tarjetas, repasos, progreso, grafo de conocimiento y chat fundamentado en tus fuentes.',
        en: 'Study vault takes a major leap forward: courses and subjects, folders and notes, annotatable materials, recordings with transcripts, timetable, calendar, question bank, tests, flashcards, reviews, progress, a knowledge graph and source-grounded chat.',
      },
      {
        es: 'Zotero se integra más a fondo: las bóvedas pueden usar bibliotecas de grupo y, desde cursos o materiales, buscar un elemento y decidir si importar su adjunto a Nodus o mantener un enlace que lo abra en Zotero.',
        en: 'Zotero integration goes deeper: vaults can use group libraries and, from courses or materials, search for an item and choose whether to import its attachment into Nodus or keep a link that opens it in Zotero.',
      },
      {
        es: 'Groq y Cerebras se incorporan como proveedores de IA, con carga de modelos cuando el proveedor la permite. La configuración básica y avanzada ahora avisa antes de cambiar de modo para evitar dejar modelos sin configurar por accidente.',
        en: 'Groq and Cerebras join the AI providers, with model discovery whenever the provider supports it. Basic and advanced setup now asks for confirmation before switching modes, preventing accidental incomplete model configurations.',
      },
      {
        es: 'Los modelos locales son más sencillos de usar: puedes descargar, seleccionar y eliminar modelos integrados para distintas tareas y, si uno necesita un motor previo, Nodus lo instala automáticamente antes de iniciar la descarga.',
        en: 'Local models are easier to use: download, select and remove integrated models for different tasks, and when a model requires an engine first, Nodus installs it automatically before starting the download.',
      },
      {
        es: 'Nueva guía esencial cinematográfica protagonizada por Nodi para entender bóvedas, proveedores, modelos, embeddings y voz. Nodi se presenta al final, permanece más tranquilo durante el recorrido y no se superpone con su versión real.',
        en: 'A new cinematic essential guide starring Nodi explains vaults, providers, models, embeddings and speech. Nodi is introduced at the end, stays calmer throughout the tour and no longer overlaps with the live companion.',
      },
      {
        es: 'Nuevo sistema de recuperación total: Nodus protege automáticamente todas tus bóvedas, documentos, ajustes, historiales, archivos y claves en snapshots cifrados dentro de una carpeta segura. Incluye clave de recuperación y un asistente de migración para instalaciones anteriores, compatible con carpetas sincronizadas por Google Drive, Dropbox, iCloud y servicios similares.',
        en: 'A new complete recovery system automatically protects every vault, document, setting, history, file and key in encrypted snapshots inside a safe folder. It includes a recovery key and a migration assistant for previous installations, compatible with folders synchronized by Google Drive, Dropbox, iCloud and similar services.',
      },
      {
        es: 'Las demos de los modos Académico, Genealogía, Bases de datos y Estudio se han ampliado para que ninguna sección empiece vacía: incluyen carpetas, notas, materiales, conversaciones, informes y ejemplos conectados que puedes explorar y eliminar después.',
        en: 'The Academic, Genealogy, Databases and Study demos have been expanded so no section starts empty: they include folders, notes, materials, conversations, reports and connected examples that you can explore and remove afterwards.',
      },
      {
        es: 'Nodi cierra correctamente su menú, chat y paneles al hacer clic fuera. También mejoran la experiencia flotante, las animaciones del tutorial y el comportamiento del icono de la app, que conserva el aspecto de la bóveda y el tema activos al cerrar.',
        en: 'Nodi now closes its menu, chat and panels correctly when you click elsewhere. The floating experience and tutorial animations are improved too, and the app icon now keeps the active vault and theme appearance after quitting.',
      },
      {
        es: 'La navegación lateral se siente más consistente: la marca de Nodus permanece centrada al redimensionar el menú y toda su cabecera permite mostrarlo u ocultarlo.',
        en: 'Sidebar navigation now feels more consistent: the Nodus brand stays centered as the menu is resized, and its entire header can show or hide it.',
      },
      {
        es: 'El panel de novedades estrena una presentación cinematográfica con Nodi celebrando, versiones y cambios claramente visibles en modo claro y oscuro, además de una sección opcional para apoyar el proyecto open source mediante PayPal.',
        en: 'The What’s New panel now has a cinematic presentation with Nodi celebrating, versions and changes clearly visible in light and dark mode, plus an optional section to support the open-source project through PayPal.',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-13',
    highlights: [
      {
        es: 'Te presentamos a Nodi, la nueva mascota de Nodus: un nodo de luz que te acompaña flotando abajo a la derecha. Puedes arrastrarlo por la ventana y activarlo o desactivarlo desde Ajustes → Interfaz.',
        en: 'Meet Nodi, Nodus’s new mascot: a little node of light that keeps you company, floating at the bottom right. Drag it around the window, and switch it on or off in Settings → Interface.',
      },
      {
        es: 'Haz clic en Nodi para abrir su menú: un chat con la IA que conoce Nodus y tu configuración, un centro de notificaciones (te avisa con un punto rojo y levantando la mano) y una ayuda rápida. Además, Nodi cambia de traje según el modo de la bóveda (académico, genealogía, bases de datos), algo que puedes desactivar si prefieres el Nodi de siempre.',
        en: 'Click Nodi to open its menu: a chat with an AI that knows Nodus and your setup, a notification center (it flags unread items with a red dot and a raised hand) and quick help. Nodi even changes outfit to match the vault mode (academic, genealogy, databases) — which you can turn off if you prefer the plain Nodi.',
      },
      {
        es: 'Si quieres, Nodi puede vivir en una pequeña ventana flotante del escritorio, siempre por encima del resto de aplicaciones —incluso a pantalla completa—, para tenerlo a mano sin cambiar de app.',
        en: 'If you like, Nodi can live in a small floating desktop window, always on top of your other apps — even in fullscreen — so it’s always within reach without switching apps.',
      },
    ],
  },
  {
    version: '2.1.1',
    date: '2026-07-13',
    highlights: [
      {
        es: 'Los modelos que eliges para cada proveedor y para cada tarea de IA ahora se comparten entre todas tus bóvedas, igual que ya ocurría con las claves de API. Configúralos una vez y estarán listos en cualquier bóveda.',
        en: 'The models you pick for each provider and for each AI task are now shared across all your vaults, just like your API keys already were. Set them up once and they’re ready in every vault.',
      },
      {
        es: 'Como las bóvedas comparten claves y modelos, hemos retirado el aviso de «cargar claves de API desde otra bóveda»: ya no hacía falta.',
        en: 'Since vaults share keys and models, we removed the “load API keys from another vault” prompt — it was no longer needed.',
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-13',
    highlights: [
      {
        es: 'Nodus estrena el modo Bases de datos: un gestor de bases de datos al estilo Notion dentro de tu bóveda. Crea tablas con columnas de muchos tipos (texto, número, selección, fecha, relación, rollup, imagen…), organiza los datos en varias vistas con filtros y ordenaciones, y edítalo todo directamente en la cuadrícula. Importa y exporta en CSV cuando lo necesites.',
        en: 'Nodus introduces Databases mode: a Notion-style database manager inside your vault. Build tables with many column types (text, number, select, date, relation, rollup, image…), organize data across several views with filters and sorting, and edit everything right in the grid. Import and export CSV whenever you need it.',
      },
      {
        es: 'Columnas con IA: deja que la IA rellene una columna entera a partir del resto de la fila, ya sea con texto (resúmenes, clasificaciones, traducciones) o con imágenes generadas. Y un chat integrado responde preguntas sobre los datos de tu tabla.',
        en: 'AI columns: let the AI fill an entire column from the rest of the row — either with text (summaries, classifications, translations) or with generated images. And a built-in chat answers questions about your table’s data.',
      },
      {
        es: 'Análisis estadístico honesto: la IA propone los análisis adecuados sobre tus columnas reales (correlaciones, chi-cuadrado, ANOVA, regresión) y la app los calcula de forma determinista, con gráficos nativos —mapas de calor, dispersión y diagramas de caja—. La IA planifica; el motor calcula, sin inventar cifras.',
        en: 'Honest statistical analysis: the AI proposes the right analyses over your real columns (correlations, chi-square, ANOVA, regression) and the app computes them deterministically, with native charts — heatmaps, scatter plots and box plots. The AI plans; the engine computes, with no made-up numbers.',
      },
      {
        es: 'El Archivo de Genealogía se reconstruye como una cuadrícula editable al estilo de las bases de datos: edita cada celda al momento, asigna documentos a varias carpetas a la vez y clasifícalos con una taxonomía de más de 190 tipos de documento patrimonial, con búsqueda inteligente y filtros por faceta.',
        en: 'The Genealogy Archive is rebuilt as an editable database-style grid: edit each cell inline, file documents into several folders at once, and classify them with a taxonomy of 190+ heritage document types, complete with smart search and facet filters.',
      },
    ],
  },
  {
    version: '2.0.2',
    date: '2026-07-12',
    highlights: [
      {
        es: 'El Archivo estrena un campo «Fuente» para cada documento: anota de dónde procede (el archivo o repositorio, una cita o una URL). Es la base de una buena cita genealógica y viaja con las copias de seguridad como el resto del documento.',
        en: 'The Archive gains a “Source” field on every document: record where it came from (the archive or repository, a citation, or a URL). It’s the backbone of a good genealogical citation, and it travels with your backups like the rest of the document.',
      },
    ],
  },
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
