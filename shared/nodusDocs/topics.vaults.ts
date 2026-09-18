import type { NodusDocTopic } from './types';

/** One sheet per vault type: its sections, its phase and how work starts in it. */
export const VAULT_DOC_TOPICS: readonly NodusDocTopic[] = [
  {
    id: 'vault-academic',
    area: 'vaults',
    title: { es: 'Bóveda académica: secciones y flujo', en: 'Academic vault: sections and flow' },
    keywords: ['academico', 'academic', 'investigacion', 'zotero', 'corpus', 'barra lateral academica', 'secciones', 'investigacion academica', 'tesis', 'paper'],
    body: {
      es: `- Secciones: Inicio; Explorar (Buscar, Biblioteca, Grafo, Mapa de argumentos, Ideas, Autores); Analizar (Diccionario, Inmersión, Estado de la cuestión, Hipótesis y Ruta de lectura —estas dos ocultas de fábrica—, Deep Research); Escribir (Espacio de trabajo); Herramientas (Nodus Browser, Nodus Radar, Nodus Compass, Nodus Tools) y Ajustes.
- Diccionario y Espacio de trabajo son exclusivos de este tipo. Huecos y Debates no tienen entrada propia en el menú: son pestañas dentro de Estado de la cuestión.
- La biblioteca se alimenta de Zotero o de archivos sueltos; el análisis del corpus produce ideas, evidencias, resúmenes y pasajes citables sobre los que trabajan Grafo, Ideas, Autores y el chat de investigación.
- Flujo habitual: añadir o sincronizar obras → analizarlas (ligero o profundo) → revisar ideas y autores → explorar el grafo y el mapa de argumentos → cubrir huecos y debates → escribir en Espacio de trabajo o generar un informe con Deep Research.
- El chat de investigación (botón Asistente de la cabecera) responde con el corpus y puede guardar el resultado en el Espacio de trabajo.`,
      en: `- Sections: Home; Explore (Search, Library, Graph, Argument map, Ideas, Authors); Analyse (Dictionary, Immersion, State of the art, Hypotheses and Reading path —the last two hidden by default—, Deep Research); Write (Workspace); Tools (Nodus Browser, Nodus Radar, Nodus Compass, Nodus Tools) and Settings.
- Dictionary and Workspace are exclusive to this type. Gaps and Debates have no menu entry of their own: they are tabs inside State of the art.
- The library is fed by Zotero or loose files; corpus analysis produces ideas, evidence, summaries and citable passages that Graph, Ideas, Authors and the research chat work from.
- The usual flow: add or sync works → analyse them (light or deep) → review ideas and authors → explore the graph and the argument map → cover gaps and debates → write in the Workspace or generate a report with Deep Research.
- The research chat (header Assistant button) answers from the corpus and can save its result into the Workspace.`,
    },
    related: ['sections-library', 'sections-graph', 'sections-ideas-authors'],
  },
  {
    id: 'vault-genealogy',
    area: 'vaults',
    title: { es: 'Bóveda de genealogía: secciones y flujo', en: 'Genealogy vault: sections and flow' },
    keywords: ['genealogia', 'genealogy', 'familia', 'gedcom', 'arbol', 'ancestros', 'parentesco', 'archivo', 'historia familiar'],
    body: {
      es: `- Fase BETA. Secciones: Inicio; Buscar, Biblioteca, Personas, Línea temporal, Árbol genealógico, Relaciones sociales, Mapa, Archivo; Research chat, Deep Research; Notas; Herramientas y Ajustes.
- Regla de método: todo parentesco o identidad debe apoyarse en registros o evidencias. Compartir apellido, domicilio o aparecer en el mismo documento no prueba parentesco.
- Personas importa y exporta GEDCOM (Gramps, Ancestry) y permite revisar parentescos sugeridos por IA uno a uno o en bloque, confirmando o descartando.
- Archivo importa fotos, CSV, XLSX y escaneos, extrae texto, indexa el archivo, extrae personas y eventos y enlaza coincidencias con el árbol; se pueden sustituir adjuntos y reextraer.
- Mapa muestra los lugares de las personas con filtro por persona y deslizador cronológico; Relaciones sociales es una red independiente del árbol (amistad, patronazgo, empleo, rivalidad, correspondencia) y se lee, no se edita: las relaciones se crean desde la ficha de persona.
- El árbol se recentra con doble clic y permite buscar una persona, colorear y ocultar ramas paterna y materna.`,
      en: `- BETA phase. Sections: Home; Search, Library, People, Timeline, Family tree, Social relations, Map, Archive; Research chat, Deep Research; Notes; Tools and Settings.
- Method rule: every kinship or identity claim must rest on records or evidence. Sharing a surname, an address or appearing in the same document does not prove kinship.
- People imports and exports GEDCOM (Gramps, Ancestry) and reviews AI-suggested kinships one by one or in bulk, confirming or discarding them.
- Archive imports photos, CSV, XLSX and scans, extracts text, indexes the archive, extracts people and events and links matches to the tree; attachments can be replaced and re-extracted.
- Map shows people's places with a person filter and a timeline slider; Social relations is a network independent from the tree (friendship, patronage, employment, rivalry, correspondence) and is read-only: relations are created from a person's record.
- The tree recentres on double-click and can search a person, colour and hide the paternal and maternal branches.`,
    },
    related: ['sections-genealogy-records', 'sections-library', 'sections-deep-research'],
  },
  {
    id: 'vault-databases',
    area: 'vaults',
    title: { es: 'Bóveda de bases de datos: secciones y flujo', en: 'Databases vault: sections and flow' },
    keywords: ['bases de datos', 'databases', 'tabla', 'tablas', 'csv', 'notion', 'columnas', 'vistas', 'fila', 'base de datos'],
    body: {
      es: `- Fase BETA. La barra lateral muestra «+ Nueva base de datos», «Páginas», «Buscar», la lista de bases creadas por el usuario y, en Analizar, «Análisis», el chat de datos y Deep Research. La tabla en sí no es una entrada de menú: se entra pulsando una base de datos.
- Columnas tipadas: título, texto, número, fecha, hora, selección, selección múltiple y casilla. Cada base admite varias vistas (tabla, tablero, galería, calendario, gráfico, panel, feed, mapa, cronología y lista), relaciones y fórmulas, automatizaciones y ajustes de vista.
- Inicio ofrece «Importar CSV», «Importar desde Notion» y «Nueva base de datos», además de accesos a Análisis, Chat de datos y Deep Research.
- Análisis perfila columnas (relleno, media, distribución, rangos) con gráficos y lectura con IA. El chat de datos permite elegir una o varias bases y guarda las conversaciones.
- Con muchos archivos, importar puede tardar horas: la propia interfaz lo avisa y propone adjuntarlos ahora y procesarlos después por columnas.`,
      en: `- BETA phase. The sidebar shows "+ New database", "Pages", "Search", the list of user-created databases and, under Analyse, "Analysis", the data chat and Deep Research. The table is not a menu entry: you enter it by clicking a database.
- Typed columns: title, text, number, date, time, select, multi-select and checkbox. Each database supports several views (table, board, gallery, calendar, chart, dashboard, feed, map, timeline and list), relations and formulas, automations and view settings.
- Home offers "Import CSV", "Import from Notion" and "New database", plus shortcuts to Analysis, Data chat and Deep Research.
- Analysis profiles columns (fill, mean, distribution, ranges) with charts and an AI reading. The data chat takes one or several databases and saves its conversations.
- With many files an import can take hours: the interface warns about it and suggests attaching them now and processing them by columns later.`,
    },
    related: ['sections-databases-table', 'sections-databases-pages', 'sections-databases-analysis'],
  },
  {
    id: 'vault-estudio',
    area: 'vaults',
    title: { es: 'Bóveda de estudio: secciones y flujo', en: 'Study vault: sections and flow' },
    keywords: ['estudio', 'study', 'curso', 'asignatura', 'apuntes', 'examen', 'flashcards', 'horario', 'calendario', 'repaso', 'estudiar'],
    body: {
      es: `- Fase BETA. La jerarquía es Curso > Asignatura; dentro de una asignatura hay carpetas, temas, subtemas, apuntes y materiales.
- Secciones: Cursos y asignaturas, Horarios, Calendario, Buscar, Materiales, Grabaciones (grupo Organización); Research chat, Ideas de estudio, Grafo de estudio, Banco de preguntas, Revisión, Investigación de estudio (Analizar); Espacio de trabajo (Escribir); Herramientas y Ajustes.
- Horarios usa un icono de reloj y Calendario uno de calendario. En Horarios, al pulsar una celda se abre un desplegable para añadir una asignatura existente o una actividad independiente.
- El Calendario tiene vistas mensual, semanal y anual, eventos con avisos y exportación a iCloud o Google Calendar (archivo .ics).
- Materiales admite PDF, documentos, presentaciones y audio, con visor y notas de material. Grabaciones graba o importa audio, transcribe, diariza y genera notas.
- El Banco de preguntas reúne preguntas, tests, exámenes y flashcards (cada flashcard se abre en su modal). Revisión es un asistente de tres pasos que monta una sesión con contenido existente o generado con IA.
- Ideas y Grafo de estudio se aíslan por asignatura. Con «Modo de lectura» activo (Ajustes > Interfaz, solo en Estudio) la interfaz reduce distracciones.
- Si en Ajustes > Modelos IA se elige «Procesar automáticamente», los materiales nuevos se analizan con IA sin preguntar; por defecto Nodus pregunta cada vez.`,
      en: `- BETA phase. The hierarchy is Course > Subject; inside a subject there are folders, topics, subtopics, notes and materials.
- Sections: Courses and subjects, Schedule, Calendar, Search, Materials, Recordings (Organisation group); Research chat, Study ideas, Study graph, Question bank, Review, Study research (Analyse); Workspace (Write); Tools and Settings.
- Schedule uses a clock icon and Calendar a calendar icon. In Schedule, clicking a cell opens a dropdown to add an existing subject or a standalone activity.
- Calendar offers month, week and year views, events with reminders and export to iCloud or Google Calendar (.ics file).
- Materials accepts PDFs, documents, presentations and audio, with a viewer and material notes. Recordings records or imports audio, transcribes, diarises and generates notes.
- The Question bank gathers questions, tests, exams and flashcards (each flashcard opens in its own modal). Review is a three-step assistant that builds a session from existing or AI-generated content.
- Study ideas and Study graph are isolated per subject. With "Reading mode" enabled (Settings > Interface, Study only) the interface reduces distractions.
- If Settings > AI models is set to "Process automatically", new materials are analysed without asking; by default Nodus asks every time.`,
    },
    related: ['sections-study-organization', 'sections-study-bank-review', 'sections-study-materials-recordings'],
  },
  {
    id: 'vault-docencia',
    area: 'vaults',
    title: { es: 'Bóveda de docencia: secciones y flujo', en: 'Teaching vault: sections and flow' },
    keywords: ['docencia', 'teaching', 'profesor', 'alumnado', 'grupos', 'calificaciones', 'rubricas', 'examen', 'evaluacion', 'clase', 'unidad didactica'],
    body: {
      es: `- Fase BETA. Reutiliza la organización Curso > Asignatura de Estudio y añade el espacio de trabajo docente. Grupos pertenecen a una asignatura y a un curso académico.
- Secciones: Organización (Buscar, Cursos asignaturas y grupos, Grupos, Horarios, Calendario, Materiales, Grabaciones); Analizar (Research chat, Ideas, Grafo); Evaluación (Banco de preguntas, Rúbricas, Exámenes, Calificaciones); Crear (Diseño de unidades, Espacio de trabajo).
- Guía docente / Programación, Situaciones de aprendizaje, Adaptaciones y Proyectos de innovación están «En diseño»: abren su hilo de feedback y no deben describirse como funciones terminadas.
- Privacidad por diseño: la IA no recibe listas, notas ni respuestas del alumnado, y no existen funciones de IA para calificar, perfilar o evaluar alumnado.
- Calificaciones es un cuaderno basado en el plan de evaluación congelado al publicar; una revisión crea una versión nueva, y la nota es una proyección de valor y estado.
- Exámenes genera un documento imprimible con cabecera, logos, secciones enumeradas y exportación a DOCX o PDF. Rúbricas permite crear criterios y niveles, con pesos por criterio que suman 100 y avisos de calidad, y exportar a PDF.
- Diseño de unidades es un Deep Research con estructura fijable por el docente que cita los materiales del curso.`,
      en: `- BETA phase. It reuses Study's Course > Subject organisation and adds the teaching workspace. Groups belong to a subject and an academic year.
- Sections: Organisation (Search, Courses subjects and groups, Groups, Schedule, Calendar, Materials, Recordings); Analyse (Research chat, Ideas, Graph); Assessment (Question bank, Rubrics, Exams, Grades); Create (Unit design, Workspace).
- Teaching guide / Syllabus, Learning situations, Adaptations and Innovation projects are "In design": they open their feedback thread and must not be described as finished features.
- Privacy by design: the AI never receives student lists, notes or answers, and there are no AI features for grading, profiling or assessing students.
- Grades is a gradebook built on the assessment plan frozen when published; a revision creates a new version, and the mark is a projection of value and state.
- Exams generates a printable document with a header, logos, numbered sections and export to DOCX or PDF. Rubrics creates criteria and levels, with per-criterion weights that add up to 100, quality warnings and PDF export.
- Unit design is a Deep Research whose structure the teacher can fix, citing the course materials.`,
    },
    related: ['sections-teaching-groups-grades', 'sections-teaching-exams-rubrics', 'vault-estudio'],
  },
  {
    id: 'vault-primary-sources',
    area: 'vaults',
    title: { es: 'Bóveda de fuentes primarias: secciones y reglas', en: 'Primary sources vault: sections and rules' },
    keywords: ['fuentes primarias', 'primary sources', 'archivo historico', 'transcripcion', 'manuscrito', 'paleografia', 'dossier', 'signatura', 'procedencia', 'documento historico'],
    body: {
      es: `- Fase PRE-ALPHA, solo para pruebas y colaboración: no debe recomendarse para trabajo real.
- Secciones: Buscar, Archivo, Personas, Cronología, Mapa, Relaciones (Investigar fuentes); Research chat (Analizar); Notas (Interpretar); además Inicio, Biblioteca, Herramientas y Ajustes.
- Recorrido de método: el Archivo es el centro; se importa sin perder procedencia (repositorio, signatura, unidad padre, sesión de captura, hash del máster); se distingue jerarquía archivística de colecciones de trabajo; el máster es inmutable y se trabaja sobre derivados, OCR y transcripciones versionadas; las propuestas se aceptan antes de convertirse en hechos; y desde una conclusión se puede volver a la evidencia.
- El dossier de una fuente tiene siete pestañas: Fuente, Descripción, Texto, Evidencia, Análisis, Notas e Historial. Las acciones compactas usan iconos con etiqueta accesible.
- Archivo tiene tres modos de vista (Tabla, Galería y Jerarquía), permite crear repositorios y sesiones de captura, y muestra «Tu archivo empieza aquí» cuando está vacío.
- Mapa representa la procedencia asignada a cada fuente, no todas las ciudades mencionadas en su texto; la procedencia se elige en el documento desde un desplegable conectado a los lugares del mapa.
- Toda salida automática es una propuesta pendiente de revisión: hay que distinguir transcripción, observación e inferencia, y conservar procedencia, localizadores, contradicciones e incertidumbre.
- La política de IA de esta bóveda se configura en Ajustes > Modelos IA: confirmar cada envío externo, permitir IA externa con fuentes privadas y permitir IA local con fuentes restringidas.`,
      en: `- PRE-ALPHA phase, for testing and collaboration only: never recommend it for real work.
- Sections: Search, Archive, People, Timeline, Map, Relations (Investigate sources); Research chat (Analyse); Notes (Interpret); plus Home, Library, Tools and Settings.
- Method path: the Archive is the centre; import without losing provenance (repository, shelfmark, parent unit, capture session, master hash); archival hierarchy is distinct from working collections; the master is immutable and work happens on derivatives, OCR and versioned transcriptions; proposals are accepted before becoming facts; and any conclusion can be traced back to its evidence.
- A source dossier has seven tabs: Source, Description, Text, Evidence, Analysis, Notes and History. Compact actions use icons with accessible labels.
- Archive has three view modes (Table, Gallery and Hierarchy), lets you create repositories and capture sessions, and shows "Your archive starts here" while empty.
- Map shows the provenance assigned to each source, not every city mentioned in its text; provenance is chosen inside the document from a dropdown connected to the map's places.
- Every automatic output is a proposal awaiting review: transcription, observation and inference must be told apart, keeping provenance, locators, contradictions and uncertainty.
- This vault's AI policy lives in Settings > AI models: confirm every external submission, allow external AI with private sources, and allow local AI with restricted sources.`,
    },
    related: ['sections-primary-sources-archive', 'sections-primary-sources-dossier', 'settings-models-advanced'],
  },
  {
    id: 'vault-testimonios',
    area: 'vaults',
    title: { es: 'Bóveda de testimonios: secciones y reglas', en: 'Testimonies vault: sections and rules' },
    keywords: ['testimonios', 'testimonies', 'entrevista', 'historia oral', 'narrador', 'transcripcion', 'anonimizacion', 'embargo', 'acuerdo', 'periodismo', 'oral history'],
    body: {
      es: `- Fase PRE-ALPHA, solo para pruebas y colaboración: no debe recomendarse para trabajo real.
- Secciones: Buscar, Entrevistas, Participantes (Explorar); Research chat, Contrastes (Analizar); Notas (Registrar); además Inicio, Biblioteca, Herramientas y Ajustes. La lista es corta a propósito: grabaciones, transcripciones, códigos y acuerdos viven dentro del dossier de cada entrevista.
- Inicio es un tablero de trabajo con métricas (entrevistas, programadas, pendientes de transcripción, en revisión, completadas, horas, espacio, participantes) y «Requieren atención» con avisos como acuerdo sin documentar, copia antigua, error o transcripción pendiente, revisión del narrador, embargo, anotaciones o máster ausente.
- El dossier de una entrevista tiene pestañas Resumen, Sesiones y transcripción, Análisis, Notas y Acuerdo y acceso.
- Regla de versiones: el original no se corrige; corregir, revisar, anonimizar o traducir crea una versión nueva. Cada fragmento guarda texto, tiempo y versión.
- Entrevistas trae vistas guardadas de fábrica (Todas, Próximas, Pendientes de transcripción, En revisión, Pendientes del narrador, Completadas, Con restricciones).
- Participantes separa nombre de trabajo y nombre público, permite anonimizar y no guarda datos de contacto.
- Contrastes compara entrevistas y códigos en modo paralelo o matriz, muestra silencios y fragmentos con narrador y minuto, permite guardar el contraste y llevarlo a Notas.
- Nodi respeta acceso, anonimización, embargo y atribución: no expone material que el acuerdo no autorice ni infiere atributos sensibles, emociones, sinceridad o credibilidad.
- Los ajustes del proyecto (propósito, idioma habitual, acceso predeterminado, atribución, revisión del narrador, repositorio, conservación y plantilla de acuerdo, y si se permiten proveedores externos) están en Ajustes > Interfaz > Testimonios.`,
      en: `- PRE-ALPHA phase, for testing and collaboration only: never recommend it for real work.
- Sections: Search, Interviews, Participants (Explore); Research chat, Contrasts (Analyse); Notes (Record); plus Home, Library, Tools and Settings. The list is deliberately short: recordings, transcriptions, codes and agreements live inside each interview's dossier.
- Home is a work dashboard with metrics (interviews, scheduled, awaiting transcription, in review, completed, hours, space, participants) and "Needs attention" items such as an undocumented agreement, an old backup, an error or pending transcription, narrator review, embargo, annotations or a missing master.
- An interview dossier has the tabs Summary, Sessions and transcription, Analysis, Notes and Agreement and access.
- Version rule: the original is never corrected; correcting, reviewing, anonymising or translating creates a new version. Each excerpt keeps text, time and version.
- Interviews ships with saved views (All, Upcoming, Awaiting transcription, In review, Awaiting narrator, Completed, With restrictions).
- Participants separates working name from public name, allows anonymisation and stores no contact details.
- Contrasts compares interviews and codes in parallel or matrix mode, shows silences and excerpts with narrator and minute, and can save the contrast or send it to Notes.
- Nodi respects access, anonymisation, embargo and attribution: it never exposes material the agreement does not authorise, and never infers sensitive attributes, emotions, sincerity or credibility.
- Project settings (purpose, usual language, default access, attribution, narrator review, repository, preservation, agreement template and whether external providers are allowed) live in Settings > Interface > Testimonies.`,
    },
    related: ['sections-testimonies-interviews', 'sections-testimonies-contrasts', 'settings-interface'],
  },
  {
    id: 'vault-prosopography',
    area: 'vaults',
    title: { es: 'Bóveda de prosopografía: secciones y método', en: 'Prosopography vault: sections and method' },
    keywords: ['prosopografia', 'prosopography', 'poblacion', 'cohorte', 'factoid', 'statement', 'identidad', 'menciones', 'denominador', 'historia social'],
    body: {
      es: `- Fase PRE-ALPHA, solo para pruebas y colaboración: no debe recomendarse para trabajo real.
- Secciones: Buscar, Población, Personas, Fuentes (Explorar); Research chat, Análisis, Redes (Analizar); Notas (Registrar); además Inicio, Biblioteca, Herramientas y Ajustes.
- Flujo recomendado: definir y versionar la metodología de población; publicar el cuestionario y los vocabularios; registrar fuentes y segmentos citables; importar menciones a un área de trabajo; crear factoids y statements atómicos; resolver identidades con decisión humana; congelar cohortes; analizar con denominador y ausencias; y solo entonces dibujar redes.
- Población tiene pestañas Estudio, Criterios, Cuestionario, Vocabularios, Cohortes y Cobertura. Los criterios son de inclusión, exclusión o apoyo, con peso y marca de obligatorio, y los pesos nunca incluyen a nadie de forma automática.
- Personas insiste en que una mención no es una persona: se comparan candidatos, se documenta y se decide (vincular, dejar sin resolver o crear persona nueva). Registra nombres documentados, autoridades y organizaciones.
- Fuentes tiene Catálogo, Lotes, Plantillas y Observaciones; el dossier de una fuente declara cita, cobertura, fiabilidad y acceso, y guarda segmentos citables con localizador. La importación CSV/TSV entra en un área de trabajo donde cada fila se acepta o rechaza.
- Análisis ofrece Frecuencia, Cronología, Trayectorias y Mapa; cada resultado declara población, denominador, ausencias y huella de entrada, con panel de casos.
- Redes separa visualmente relaciones explícitas, derivadas e hipótesis, permite derivar copresencia, y muestra métricas y tabla de aristas con evidencia.
- No se deben confundir persona, mención, fuente, factoid y statement, ni fusionar identidades o convertir una observación en hecho sin revisión.`,
      en: `- PRE-ALPHA phase, for testing and collaboration only: never recommend it for real work.
- Sections: Search, Population, People, Sources (Explore); Research chat, Analysis, Networks (Analyse); Notes (Record); plus Home, Library, Tools and Settings.
- Recommended flow: define and version the population methodology; publish the questionnaire and vocabularies; register sources and citable segments; import mentions into a staging area; create factoids and atomic statements; resolve identities with a human decision; freeze cohorts; analyse with denominator and absences; and only then draw networks.
- Population has the tabs Study, Criteria, Questionnaire, Vocabularies, Cohorts and Coverage. Criteria are inclusion, exclusion or support, with weight and a mandatory flag, and weights never include anyone automatically.
- People insists that a mention is not a person: candidates are compared, documented and decided (link, leave unresolved or create a new person). It records documented names, authorities and organisations.
- Sources has Catalogue, Batches, Templates and Observations; a source dossier declares citation, coverage, reliability and access, and keeps citable segments with a locator. CSV/TSV import lands in a staging area where each row is accepted or rejected.
- Analysis offers Frequency, Chronology, Trajectories and Map; every result declares population, denominator, absences and input fingerprint, with a case panel.
- Networks visually separates explicit, derived and hypothesised relations, can derive co-presence, and shows metrics and an edge table with evidence.
- Never confuse person, mention, source, factoid and statement, never merge identities, and never turn an observation into a fact without review.`,
    },
    related: ['sections-prosop-population', 'sections-prosop-sources', 'sections-prosop-analysis'],
  },
  {
    id: 'vault-worldbuilding',
    area: 'vaults',
    title: { es: 'Bóveda de worldbuilding: secciones y reglas', en: 'Worldbuilding vault: sections and rules' },
    keywords: ['worldbuilding', 'mundo', 'canon', 'enciclopedia', 'personajes', 'lugares', 'facciones', 'culturas', 'dinastias', 'manuscrito', 'escenas', 'narrativa', 'fantasia'],
    body: {
      es: `- Fase ALPHA, recomendada solo a testers.
- Explorar: Buscar, Enciclopedia, Personajes, Lugares, Facciones, Culturas, Cronología, Mapa, Relaciones, Familias, Dinastías. Analizar: chat del mundo, Reglas del mundo, Conflictos, Arcos narrativos, Continuidad, Preguntas abiertas. Crear: Notas, Escenas, Manuscrito.
- Para empezar: registrar las fichas canónicas del mundo; relacionar personajes, lugares, grupos y escenas; definir reglas y líneas narrativas; usar Continuidad para detectar tensiones documentadas; y redactar en Manuscrito.
- El autor es la fuente de verdad: Nodi no inventa canon y debe distinguir siempre entre información establecida y propuesta.
- La Enciclopedia es el índice A-Z del mundo: artículos nativos editables más proyecciones de lectura del resto de secciones, con facetas, búsqueda global, marca de entradas «sin desarrollar», panel de entradas ausentes, exportación de la «world bible» y lector de entradas. Admite enlaces con dobles corchetes.
- La Cronología ordena por año del mundo y el Mapa dibuja mapas inventados (no usa coordenadas geográficas reales). Relaciones y Familias reutilizan las vistas de relaciones y de árbol.
- Reglas del mundo pide enunciado, precio y límites; las excepciones se convierten en reglas propias al borrarlas. Conflictos tiene tablero y filas, partes, beats, sugerencias y huecos. Arcos narrativos muestra carriles, densidad, cierres y una hoja de hitos copiable. Continuidad lista hallazgos, puntos ciegos, excepciones aceptadas y silenciadas. Preguntas abiertas agrupa opciones, bloqueos, evidencia y palanca.
- Escenas reúne reparto, resumen y escritura. Manuscrito ordena las escenas por orden de relato, con capítulos, progreso, repaso y compilación. Borrar un grupo no elimina personajes.`,
      en: `- ALPHA phase, recommended to testers only.
- Explore: Search, Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relations, Families, Dynasties. Analyse: world chat, World rules, Conflicts, Story arcs, Continuity, Open questions. Create: Notes, Scenes, Manuscript.
- To start: record the world's canonical entries; relate characters, places, groups and scenes; define rules and narrative lines; use Continuity to surface documented tensions; and write in Manuscript.
- The author is the source of truth: Nodi never invents canon and must always separate established information from proposals.
- The Encyclopedia is the world's A-Z index: native editable articles plus reading projections from the other sections, with facets, global search, an "undeveloped" mark, a missing-entries panel, world-bible export and an entry reader. It supports double-bracket links.
- Timeline orders by world year and Map draws invented maps (it uses no real geographic coordinates). Relations and Families reuse the relations and tree views.
- World rules asks for statement, price and limits; exceptions become rules of their own when deleted. Conflicts has a board and rows, sides, beats, suggestions and gaps. Story arcs shows lanes, density, closures and a copyable milestone sheet. Continuity lists findings, blind spots, accepted and silenced exceptions. Open questions groups options, blockers, evidence and leverage.
- Scenes gather cast, summary and writing. Manuscript orders scenes by narrative order, with chapters, progress, review and compilation. Deleting a group does not delete characters.`,
    },
    related: ['sections-world-encyclopedia', 'sections-world-analysis', 'sections-world-scenes-manuscript'],
  },
];
