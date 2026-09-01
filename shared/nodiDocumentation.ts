import type { PromptLanguage } from './types';

/**
 * Verified product facts used by both the UI and Nodi. Keeping the roadmap here
 * prevents the assistant and the visible modal from drifting apart.
 */
export type RoadmapStatus = 'planned' | 'inProgress' | 'implemented';

export interface RoadmapItem {
  title: string;
  detail: string;
  status: RoadmapStatus;
  children?: readonly RoadmapItem[];
}

export const NODUS_ROADMAP = [
  { title: 'Pulido y estabilidad', detail: 'Corregir errores, mejorar el rendimiento y pulir la experiencia general con feedback de usuarios.', status: 'inProgress' },
  { title: 'Servidor', detail: 'Infraestructura opcional para nuevas capacidades conectadas.', status: 'planned' },
  { title: 'Compartir vaults y trabajo colaborativo', detail: 'Compartir espacios y colaborar con control sobre los datos.', status: 'planned' },
  { title: 'Apps para iOS y iPadOS', detail: 'Llevar Nodus a iPhone y iPad con aplicaciones nativas adaptadas a cada dispositivo.', status: 'planned' },
  { title: 'Vault de docencia', detail: 'Preparar clases, cursos y materiales docentes, protegiendo los datos del alumnado.', status: 'implemented' },
  { title: 'Vault de fuentes primarias', detail: 'Organizar documentos históricos y trabajar con evidencia documental.', status: 'implemented' },
  { title: 'Vault de testimonios (historia oral)', detail: 'Entrevistas, transcripciones y fuentes orales para historia y periodismo.', status: 'implemented' },
  {
    title: 'Vaults sugeridos por usuarios',
    detail: 'Nuevos ámbitos con especialistas, colaboración activa y testers.',
    status: 'implemented',
    children: [
      { title: 'Vault de prosopografía', detail: 'Personas, relaciones, identidades y evidencias biográficas para investigación histórica.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personajes, lugares, cronologías y reglas de mundos narrativos.', status: 'implemented' },
    ],
  },
  { title: 'Nodus Toolkit', detail: 'Herramientas prácticas y local-first para convertir archivos y procesar documentos, integradas en Nodus.', status: 'implemented' },
  { title: 'Nodus Translate', detail: 'Traducir texto, documentos y adjuntos de Zotero con el modelo elegido, conservando la estructura de DOCX y EPUB y la apariencia de los PDF mediante un modo facsímil.', status: 'implemented' },
  { title: 'Nodus PDF Presenter', detail: 'Presentar archivos PDF y presentaciones externas con vista del presentador, control remoto desde el móvil, notas del orador y herramientas de anotación en directo.', status: 'implemented' },
  { title: 'Nodus OCR Workspace', detail: 'OCR asistido por IA para PDF escaneados e imágenes, con revisión página a página, limpieza de texto, reprocesamiento e integración directa con las bóvedas de Nodus.', status: 'implemented' },
] satisfies readonly RoadmapItem[];

const ROADMAP_STATUS_GUIDE: Record<RoadmapStatus, string> = {
  planned: 'Planificado',
  inProgress: 'En desarrollo',
  implemented: 'Implementado',
};

const ROADMAP_GUIDE = NODUS_ROADMAP.map((item, index) => {
  const children = item.children?.map((child) => `   - ${child.title} [${ROADMAP_STATUS_GUIDE[child.status]}]: ${child.detail}`).join('\n');
  return `${index + 1}. ${item.title} [${ROADMAP_STATUS_GUIDE[item.status]}]: ${item.detail}${children ? `\n${children}` : ''}`;
}).join('\n');

/**
 * Compact product guide grounded only in routes and capabilities present in the
 * current source tree. Roadmap entries carry their explicit product state and
 * must not be described with a different one.
 */
export const NODUS_DOCUMENTATION = `# Guía interna verificable de Nodus

## Reglas de lectura de esta guía
- Esta guía documenta la interfaz actual y el roadmap oficial visible de la aplicación.
- El roadmap distingue entre elementos planificados, en desarrollo e implementados. No atribuyas fechas ni versiones si no aparecen aquí.
- «Implementado» significa que el vault o la función existe y se puede abrir; no significa que haya alcanzado una versión estable.
- Nodus es local-first: cada bóveda guarda sus datos en el equipo del usuario.
- Las claves de proveedores se configuran en Ajustes > Proveedores. Los modelos favoritos se eligen allí y cada función conserva su propio selector.

## Vaults disponibles y nivel de madurez
- Todos los tipos que aparecen a continuación se pueden crear desde Bóvedas > Añadir bóveda: Académico, Fuentes primarias, Testimonios, Bases de datos, Docencia, Estudio, Genealogía, Prosopografía y Worldbuilding.
- Fuentes primarias, Testimonios y Prosopografía están en PRE-ALPHA: no son utilizables para trabajo real. Solo están disponibles para personas que quieran probar funciones incompletas y reportar errores o propuestas de mejora. Antes de crearlos aparece una confirmación específica.
- Worldbuilding está en ALPHA: sus funciones principales siguen en prueba y se recomienda únicamente a testers.
- Bases de datos, Docencia, Estudio y Genealogía están en BETA: son funcionales, pero todavía necesitan feedback y correcciones.
- Académico no muestra una etiqueta de fase en el selector.
- Crear o cargar datos de demostración no abre el tutorial. El tutorial aparece al crear un vault o cuando el usuario lo abre expresamente desde Ajustes > Tutoriales.

## Cabecera y controles globales
- En el extremo derecho de la cabecera están, en este orden general: Comandos, Asistente, Herramientas, controles condicionales del vault, Sugerir / Reportar, selector de tema claro/oscuro, Notificaciones y Ajustes.
- Herramientas abre el hub Nodus Toolkit; está justo después del botón Asistente.
- Notificaciones está inmediatamente antes de Ajustes y es el último icono antes de él. Abre un panel con dos listas: «Avisos de Nodus» (avisos publicados entre versiones, que se marcan como leídos uno a uno) y «Actividad» (lo que ha hecho la aplicación, que se marca como leído al abrir el panel). Muestra las mismas notificaciones que Nodi, y funciona aunque la mascota esté desactivada.
- El selector de tema claro/oscuro está justo antes de Notificaciones.
- La bóveda activa se abre desde la insignia centrada en la cabecera, no desde un icono del extremo derecho: esa insignia abre el selector para cambiar, crear, renombrar, duplicar, restablecer o eliminar bóvedas según la acción disponible. En la paleta de comandos también existe la acción «Bóvedas».
- Colecciones ya no tiene icono propio en la cabecera; se abre desde la paleta de comandos, en bóvedas académicas.
- Bandeja solo aparece cuando ha llegado algo desde otro dispositivo; es propia de cada bóveda conectada a Nodus Server.
- Comandos abre la paleta global; su atajo visible es ⌘K en macOS.
- El botón Asistente de la cabecera abre el asistente de investigación. Nodi es la mascota independiente situada en la zona inferior derecha cuando está habilitada.

## Roadmap oficial visible
El roadmap se abre desde Ajustes > Acerca de Nodus Research > Ver roadmap de Nodus Research, y también desde la paleta de comandos. El orden vigente es:
${ROADMAP_GUIDE}

## Ajustes
- Ajustes es el último elemento de la barra lateral y también tiene un icono en el extremo derecho de la cabecera.
- Sus pestañas reales son: Proveedores, Modelos IA, Biblioteca, Texto y OCR, Interfaz, Integraciones, Servidor, Tutoriales, Backup / copia de seguridad, Acerca de Nodus Research y Actualizaciones y novedades.
- Proveedores: claves API, proveedores locales y modelos favoritos.
- Modelos IA: modelo general y modelos específicos de las distintas tareas.
- Biblioteca: integración y sincronización con Zotero. Testimonios, Prosopografía y Worldbuilding no usan Zotero y no muestran ese recorrido.
- Interfaz: idioma, tema, accesibilidad, barra lateral y Mascota Nodi.
- Integraciones: servidor MCP local y copilotos de escritura para Word y LibreOffice.
- Servidor: conexión de cada vault con Nodus Server y publicación de su copia filtrada.
- Tutoriales: ayuda y recorridos de la aplicación.
- Backup / copia de seguridad: copias, importación, exportación y mantenimiento.
- La visibilidad, ventana flotante y trajes de Nodi están en Ajustes > Interfaz > Mascota Nodi.

## Vault académico
- Se orienta a investigación y escritura académica.
- Puede incluir Inicio, Buscar, Biblioteca, Grafo, Mapa de argumentos, Ideas, Autores, Inmersión, Huecos, Debates, Cobertura, Hipótesis, Ruta de lectura, Deep Research, Escritura, Proyectos, Notas y Ajustes.
- Las secciones pueden ocultarse o reordenarse desde Ajustes > Interfaz > Barra lateral.
- Deep Research recupera evidencia del corpus, genera un informe y permite exportarlo como documento o PDF con la identidad visual del vault.

## Vault de genealogía
- Está disponible y se orienta a historia familiar respaldada por documentos.
- Incluye Personas, Línea temporal, Árbol genealógico, Relaciones sociales, Mapa y Archivo.
- Las afirmaciones sobre identidades y parentescos deben apoyarse en registros o evidencias. Compartir apellido, domicilio o aparecer en el mismo documento no prueba parentesco.

## Vault de bases de datos
- Está disponible y gestiona tablas estructuradas con columnas tipadas, filas, vistas, búsqueda, análisis y Chat de datos.
- Las bases creadas por el usuario aparecen en la barra lateral. Las secciones fijas incluyen Buscar, Análisis y Chat de datos.

## Vault de estudio
- Está disponible. Su jerarquía es Curso > Asignatura; dentro de una asignatura puede haber carpetas, temas, subtemas, apuntes y materiales.
- Incluye Cursos y asignaturas, Horarios, Calendario, Buscar, Materiales, Grabaciones, Chat de estudio, Ideas, Grafo, Banco de preguntas y Revisión.
- Horarios usa un icono de reloj; Calendario usa un icono de calendario.
- En Horarios, al pulsar una celda se abre un desplegable para añadir una asignatura existente o una actividad independiente.
- El Calendario ofrece vistas mensual, semanal y anual, eventos con avisos y exportación a iCloud o Google Calendar.
- El Banco de preguntas contiene preguntas, tests, exámenes y flashcards; una flashcard se abre en su modal específico.

## Vault de docencia
- Está implementado y disponible en BETA. Reutiliza la organización de Curso > Asignatura y añade un espacio de trabajo docente.
- Sus secciones implementadas incluyen Cursos, asignaturas y grupos, Grupos, Horarios, Calendario, Materiales, Grabaciones, Chat, Ideas, Grafo, Banco de preguntas, Rúbricas, Exámenes, Calificaciones y Diseño de unidades.
- Guía docente / Programación, Situaciones de aprendizaje, Adaptaciones, Notas y Proyectos de innovación aparecen como elementos «En diseño»: abren su hilo de feedback y no deben describirse como funciones terminadas.
- Para empezar: crea cursos y asignaturas, crea los grupos, añade materiales y después usa las superficies de evaluación que necesites. Los datos del alumnado se gestionan dentro de Grupos y Calificaciones.

## Vault de fuentes primarias
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Archivo, Personas, Línea temporal, Mapa, Relaciones sociales, Notas, Toolkit y Ajustes.
- Archivo organiza documentos por ubicación archivística o colecciones de trabajo. El panel lateral del árbol se puede ocultar y volver a mostrar con su control de panel.
- Para añadir documentos: abre Archivo y usa Añadir fuente. La tabla muestra los metadatos catalográficos y una miniatura cuando existe una imagen.
- Al pulsar una fila se abre el modal del documento. Desde ese modal se consultan y editan los datos catalográficos, descripción, texto, evidencias, análisis, notas, historial, archivos y representaciones; las acciones compactas usan iconos con etiquetas accesibles.
- El usuario puede escoger el icono o tipo documental; Nodus sugiere uno según el tipo de fuente, pero la decisión sigue siendo editable.
- En Mapa se representa la procedencia asignada a cada fuente, no todas las ciudades mencionadas en su texto. La procedencia se elige en el documento mediante un desplegable conectado a los lugares disponibles en el mapa.
- Todo resultado automático es una propuesta pendiente de revisión. Distingue transcripción, observación e inferencia y conserva procedencia, localizadores, contradicciones e incertidumbre.

## Vault de testimonios
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Entrevistas, Participantes, Contrastes, Notas, Toolkit y Ajustes.
- El trabajo específico sucede dentro del dossier de cada entrevista: sesiones, medios, transcripciones, fragmentos, códigos, anotaciones, acuerdos y restricciones. Las vistas del menú reúnen lo que atraviesa varias entrevistas.
- Para empezar: crea una entrevista, registra participantes y acuerdos, añade una sesión o medio y prepara o importa la transcripción. Los códigos y anotaciones se aplican sobre fragmentos; Contrastes compara fragmentos documentados.
- Al editar un participante se usa un modal dentro de la vista actual.
- Nodi respeta acceso, anonimización, embargo y atribución. No debe exponer material que el acuerdo no autorice ni inferir atributos sensibles, emociones, sinceridad o credibilidad.

## Vault de prosopografía
- Está implementado y disponible en PRE-ALPHA exclusivamente para colaboración y pruebas, no para trabajo real.
- Sus secciones son Buscar, Población, Personas, Fuentes, Análisis, Redes, Notas, Toolkit y Ajustes.
- Flujo recomendado: define y versiona la metodología de población; diseña el cuestionario y vocabularios; registra fuentes y segmentos; captura factoids y statements atómicos; resuelve identidades; decide la pertenencia; y solo después ejecuta análisis o redes.
- Buscar recorre personas, menciones, fuentes y statements. Análisis declara población, denominador, ausencias y huella de entrada. Redes separa visualmente relaciones explícitas, derivadas e hipótesis.
- No confundas persona, mención, fuente, factoid y statement. No fusiones identidades ni conviertas una observación documental en hecho sin revisión.

## Vault de worldbuilding
- Está implementado y disponible en ALPHA, recomendado solo para testers.
- Explorar incluye Enciclopedia, Personajes, Lugares, Facciones, Culturas, Cronología, Mapa, Relaciones, Familias y Dinastías.
- Analizar incluye Chat del mundo, Reglas del mundo, Conflictos, Arcos narrativos, Continuidad y Preguntas abiertas. Crear incluye Notas, Escenas y Manuscrito.
- Para empezar: registra las fichas canónicas del mundo; relaciona personajes, lugares, grupos y escenas; define reglas y líneas narrativas; usa Continuidad para detectar tensiones documentadas; y redacta en Manuscrito.
- El autor es la fuente de verdad. Nodi no inventa canon: debe distinguir claramente entre información establecida y propuesta.

## Herramientas (Nodus Toolkit)
- Herramientas es una sección de la barra lateral, en su propio grupo, y también tiene un icono en la cabecera. Aparece en todos los tipos de vault.
- Su página principal es un hub con cinco tarjetas: Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter y OCR Workspace.
- Nodus Convert ya funciona: convierte y procesa archivos en local, de uno en uno o en lote, en cinco categorías —Documentos (PDF, DOCX, EPUB, Markdown, HTML, texto), utilidades PDF (unir, dividir, rotar, reordenar, extraer imágenes, metadatos, imágenes→PDF), OCR ligero (imagen o PDF escaneado a texto, y PDF buscable), Imágenes (convertir formato incluido HEIC, redimensionar, comprimir) y Texto (limpiar texto pegado de PDF, mayúsculas/minúsculas, subtítulos a texto, checksums).
- Nodus Protect ya funciona: admite PDF e imágenes del disco o de la bóveda activa, concatena documentos, permite ocultar o desenfocar datos, recortar, rotar, enderezar, convertir a escala de grises, añadir siete patrones de marca de agua y un pie legal, y exportar copias rasterizadas como PNG, ZIP o PDF.
- Protect puede guardar una copia en disco, compartirla o incorporarla a la biblioteca «Copias protegidas» de la bóveda. También crea y verifica marcas trazables IDPS v1 compatibles con IDprotector; la marca autentica una copia, pero no la cifra y puede perderse por JPEG, capturas, reescalado o recompresión.
- Nodus Translate ya funciona: traduce texto pegado, archivos TXT, Markdown, HTML, DOCX, EPUB y PDF, así como adjuntos importados de Zotero. Permite elegir idioma de destino, modelo, carpeta y formato de salida, además de añadir idioma de origen y glosario opcionales.
- En DOCX y EPUB, Translate conserva directamente estilos, jerarquía, cabeceras, pies, notas, enlaces e imágenes del archivo original. En PDF ofrece un modo de lectura redistribuida y un modo facsímil rasterizado que mantiene páginas, geometría, fondos e imágenes y sustituye visiblemente el texto en su posición; puede usar visión para escaneados y texto dentro de imágenes. Si una traducción no cabe, reduce el tamaño y avisa de las páginas afectadas.
- La traducción requiere el proveedor de IA seleccionado y puede enviarle el texto o las páginas que deban reconocerse. El archivo original nunca se modifica: el resultado se guarda como una copia nueva.
- PDF Presenter ya se puede abrir: importa archivos PDF o presentaciones creadas en PowerPoint, LibreOffice o Keynote a una biblioteca global de Herramientas (con carpetas, búsqueda, orden y miniaturas). Las presentaciones externas se convierten localmente a PDF, tras avisar de que las animaciones y transiciones no se conservan; las notas de los PowerPoint modernos se importan automáticamente. También permite escribir notas por diapositiva, exportarlas e importarlas juntas en TXT y añadir vídeos de YouTube por diapositiva. Al presentar abre la diapositiva a pantalla completa (en la pantalla externa si hay dos) y una vista del presentador con la diapositiva actual, la siguiente, las notas, un temporizador y el reloj; incluye herramientas de anotación en directo (linterna, dibujo, puntero y lupa), pantalla en negro, y control remoto desde el móvil escaneando un código QR protegido por PIN. El único elemento que necesita conexión son los vídeos de YouTube; el resto funciona sin internet.
- OCR Workspace ya se puede abrir y ofrece un flujo asistido por IA para importar escaneados, revisar y corregir cada página y exportar el resultado.
- Nodus Convert es determinista y 100 % offline (no hay IA), nunca modifica el archivo original y no sube nada a ningún servicio; la única llamada de red opcional es la descarga de idiomas de OCR de Tesseract, que el usuario decide.
- El procesamiento documental de Nodus Protect es local y no envía documentos a IA, proveedores ni servicios externos. Esta afirmación se refiere a Protect, no a todas las funciones opcionales de red de Nodus.
- Dentro de una herramienta, un botón a la izquierda de su título vuelve al hub de Herramientas.

## MCP local y Nodus Server
- El servidor MCP local se configura en Ajustes > Integraciones > Servidor MCP. Se puede activar, consultar su estado, abrir la ayuda de conexión y regenerar su token.
- MCP expone herramientas adecuadas al tipo de vault activo, además de herramientas generales. Cambiar de vault cambia el contexto que esas herramientas consultan.
- Nodus Server es independiente del MCP local. Se configura en Ajustes > Servidor y cada vault se conecta por separado mediante la URL HTTPS del servidor y un código de un solo uso.
- Nodus publica por HTTPS saliente una copia lógica y filtrada: no abre un puerto entrante en el ordenador y no comparte listener, puerto ni token con el MCP local.
- Mientras Nodus está abierto mantiene actualizada la copia; el servidor Docker puede servir la última copia publicada a clientes autorizados aunque el ordenador esté apagado.
- La interfaz permite publicar ahora, pausar, administrar o desconectar cada vault conectado. El acceso remoto usa OAuth y permisos de lectura sobre los espacios asignados.
- En el roadmap, la iniciativa Servidor figura como «Planificado», igual que compartir vaults y trabajo colaborativo. No presentes el trabajo colaborativo como disponible.

## Estado resumido del roadmap
- En desarrollo: Pulido y estabilidad.
- Planificado: Servidor; Compartir vaults y trabajo colaborativo; Apps para iOS y iPadOS.
- Implementado: Docencia, Fuentes primarias, Testimonios, Vaults sugeridos por usuarios —Prosopografía y Worldbuilding—, Nodus Toolkit, Nodus Translate, PDF Presenter y OCR Workspace.
- No hay fechas cerradas para las iniciativas del roadmap.

## Protocolo para responder sobre la interfaz
- Usa los nombres exactos de esta guía y, si está seleccionada, la Vista actual.
- No completes lagunas con patrones habituales de otras aplicaciones. No inventes botones, menús, rutas, atajos, versiones, fechas ni estados.
- No conviertas la disponibilidad de un vault PRE-ALPHA o ALPHA en una recomendación de uso real. Indica siempre su fase cuando sea relevante.
- Si una respuesta no está cubierta, di «No puedo verificarlo con las fuentes seleccionadas» e indica qué contexto ayudaría, sin proponer una ruta inventada.
- Distingue siempre entre disponible, condicional, futuro y no verificado.
- Cuando la pregunta pida una ubicación o instrucciones, ofrece pasos numerados breves y termina con una línea «Base: …» indicando las fuentes usadas.`;

/** Localized roadmap copy. Status values remain the stable RoadmapStatus ids. */
const LOCALIZED_ROADMAP: Record<PromptLanguage, readonly RoadmapItem[]> = {
  es: NODUS_ROADMAP,
  en: [
    { title: 'Polishing and stability', detail: 'Fix errors, improve performance, and polish the overall experience with user feedback.', status: 'inProgress' },
    { title: 'Server', detail: 'Optional infrastructure for new connected capabilities.', status: 'planned' },
    { title: 'Vault sharing and collaborative work', detail: 'Share spaces and collaborate with control over the data.', status: 'planned' },
    { title: 'iOS and iPadOS apps', detail: 'Bring Nodus to iPhone and iPad with native apps adapted to each device.', status: 'planned' },
    { title: 'Teaching vault', detail: 'Prepare classes, courses, and teaching materials while protecting student data.', status: 'implemented' },
    { title: 'Primary sources vault', detail: 'Organize historical documents and work with documentary evidence.', status: 'implemented' },
    { title: 'Testimonies vault (oral history)', detail: 'Interviews, transcriptions, and oral sources for history and journalism.', status: 'implemented' },
    { title: 'User-suggested vaults', detail: 'New fields with specialists, active collaboration, and testers.', status: 'implemented', children: [
      { title: 'Prosopography vault', detail: 'People, relationships, identities, and biographical evidence for historical research.', status: 'implemented' },
      { title: 'Worldbuilding vault', detail: 'Characters, places, chronologies, and rules for narrative worlds.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Practical local-first tools for converting files and processing documents, integrated into Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Translate text, documents, and Zotero attachments with the selected model, preserving DOCX and EPUB structure and PDF appearance through a facsimile mode.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'Present PDF files and external presentations with presenter view, mobile remote control, speaker notes, and live annotation tools.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'AI-assisted OCR for scanned PDFs and images, with page-by-page review, text cleanup, reprocessing, and direct integration with Nodus vaults.', status: 'implemented' },
  ],
  fr: [
    { title: 'Polissage et stabilité', detail: "Corriger les erreurs, améliorer les performances et perfectionner l'expérience générale grâce aux retours des utilisateurs.", status: 'inProgress' },
    { title: 'Serveur', detail: 'Infrastructure facultative pour de nouvelles fonctionnalités connectées.', status: 'planned' },
    { title: 'Partage des vaults et travail collaboratif', detail: 'Partager des espaces et collaborer en gardant le contrôle des données.', status: 'planned' },
    { title: 'Applications iOS et iPadOS', detail: 'Porter Nodus sur iPhone et iPad avec des applications natives adaptées à chaque appareil.', status: 'planned' },
    { title: "Vault d'enseignement", detail: "Préparer les cours et les supports pédagogiques en protégeant les données des élèves.", status: 'implemented' },
    { title: 'Vault de sources primaires', detail: 'Organiser des documents historiques et travailler avec des preuves documentaires.', status: 'implemented' },
    { title: 'Vault de témoignages (histoire orale)', detail: 'Entretiens, transcriptions et sources orales pour l’histoire et le journalisme.', status: 'implemented' },
    { title: 'Vaults suggérés par les utilisateurs', detail: 'De nouveaux domaines avec des spécialistes, une collaboration active et des testeurs.', status: 'implemented', children: [
      { title: 'Vault de prosopographie', detail: 'Personnes, relations, identités et preuves biographiques pour la recherche historique.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personnages, lieux, chronologies et règles de mondes narratifs.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Outils pratiques et local-first pour convertir des fichiers et traiter des documents, intégrés à Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: "Traduire du texte, des documents et des pièces jointes Zotero avec le modèle choisi, en conservant la structure DOCX et EPUB et l'apparence des PDF grâce au mode fac-similé.", status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'Présenter des PDF et des présentations externes avec vue présentateur, contrôle à distance depuis le mobile, notes et outils d’annotation en direct.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assisté par IA pour les PDF numérisés et les images, avec révision page par page, nettoyage, retraitement et intégration directe aux vaults Nodus.', status: 'implemented' },
  ],
  de: [
    { title: 'Feinschliff und Stabilität', detail: 'Fehler beheben, Leistung verbessern und die allgemeine Erfahrung mit Nutzerfeedback verfeinern.', status: 'inProgress' },
    { title: 'Server', detail: 'Optionale Infrastruktur für neue verbundene Funktionen.', status: 'planned' },
    { title: 'Vaults teilen und kollaboratives Arbeiten', detail: 'Bereiche teilen und mit Kontrolle über die Daten zusammenarbeiten.', status: 'planned' },
    { title: 'Apps für iOS und iPadOS', detail: 'Nodus mit nativen, an jedes Gerät angepassten Apps auf iPhone und iPad bringen.', status: 'planned' },
    { title: 'Lehr-Vault', detail: 'Unterricht, Kurse und Lehrmaterial vorbereiten und dabei Schülerdaten schützen.', status: 'implemented' },
    { title: 'Vault für Primärquellen', detail: 'Historische Dokumente organisieren und mit dokumentarischen Belegen arbeiten.', status: 'implemented' },
    { title: 'Zeugnis-Vault (mündliche Geschichte)', detail: 'Interviews, Transkriptionen und mündliche Quellen für Geschichte und Journalismus.', status: 'implemented' },
    { title: 'Von Nutzern vorgeschlagene Vaults', detail: 'Neue Bereiche mit Fachleuten, aktiver Zusammenarbeit und Testern.', status: 'implemented', children: [
      { title: 'Prosopographie-Vault', detail: 'Personen, Beziehungen, Identitäten und biografische Belege für historische Forschung.', status: 'implemented' },
      { title: 'Worldbuilding-Vault', detail: 'Figuren, Orte, Chronologien und Regeln erzählerischer Welten.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Praktische local-first-Werkzeuge zum Konvertieren von Dateien und Verarbeiten von Dokumenten, in Nodus integriert.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Text, Dokumente und Zotero-Anhänge mit dem gewählten Modell übersetzen, wobei DOCX- und EPUB-Struktur sowie das PDF-Erscheinungsbild durch einen Faksimilemodus erhalten bleiben.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'PDF-Dateien und externe Präsentationen mit Referentenansicht, mobiler Fernsteuerung, Sprechernotizen und Live-Anmerkungswerkzeugen präsentieren.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'KI-gestützte OCR für gescannte PDFs und Bilder mit seitenweiser Prüfung, Textbereinigung, erneuter Verarbeitung und direkter Integration in Nodus-Vaults.', status: 'implemented' },
  ],
  pt: [
    { title: 'Polimento e estabilidade', detail: 'Corrigir erros, melhorar o desempenho e aperfeiçoar a experiência geral com feedback dos utilizadores.', status: 'inProgress' },
    { title: 'Servidor', detail: 'Infraestrutura opcional para novas capacidades ligadas.', status: 'planned' },
    { title: 'Partilha de cofres e trabalho colaborativo', detail: 'Partilhar espaços e colaborar mantendo o controlo dos dados.', status: 'planned' },
    { title: 'Aplicações para iOS e iPadOS', detail: 'Levar o Nodus ao iPhone e ao iPad com aplicações nativas adaptadas a cada dispositivo.', status: 'planned' },
    { title: 'Cofre de docência', detail: 'Preparar aulas, cursos e materiais letivos, protegendo os dados dos alunos.', status: 'implemented' },
    { title: 'Cofre de fontes primárias', detail: 'Organizar documentos históricos e trabalhar com evidência documental.', status: 'implemented' },
    { title: 'Cofre de testemunhos (história oral)', detail: 'Entrevistas, transcrições e fontes orais para história e jornalismo.', status: 'implemented' },
    { title: 'Cofres sugeridos pelos utilizadores', detail: 'Novas áreas com especialistas, colaboração ativa e testers.', status: 'implemented', children: [
      { title: 'Cofre de prosopografia', detail: 'Pessoas, relações, identidades e evidências biográficas para investigação histórica.', status: 'implemented' },
      { title: 'Cofre de worldbuilding', detail: 'Personagens, lugares, cronologias e regras de mundos narrativos.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Ferramentas práticas e local-first para converter ficheiros e processar documentos, integradas no Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Traduzir texto, documentos e anexos do Zotero com o modelo escolhido, conservando a estrutura de DOCX e EPUB e o aspeto dos PDF através de um modo fac-símile.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'Apresentar ficheiros PDF e apresentações externas com vista do apresentador, controlo remoto a partir do telemóvel, notas do orador e ferramentas de anotação em direto.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistido por IA para PDF digitalizados e imagens, com revisão página a página, limpeza de texto, reprocessamento e integração direta com os cofres do Nodus.', status: 'implemented' },
  ],
  'pt-BR': [
    { title: 'Polimento e estabilidade', detail: 'Corrigir erros, melhorar o desempenho e aperfeiçoar a experiência geral com feedback dos usuários.', status: 'inProgress' },
    { title: 'Servidor', detail: 'Infraestrutura opcional para novos recursos conectados.', status: 'planned' },
    { title: 'Compartilhamento de vaults e trabalho colaborativo', detail: 'Compartilhar espaços e colaborar mantendo o controle dos dados.', status: 'planned' },
    { title: 'Aplicativos para iOS e iPadOS', detail: 'Levar o Nodus ao iPhone e ao iPad com aplicativos nativos adaptados a cada dispositivo.', status: 'planned' },
    { title: 'Vault de ensino', detail: 'Preparar aulas, cursos e materiais didáticos, protegendo os dados dos alunos.', status: 'implemented' },
    { title: 'Vault de fontes primárias', detail: 'Organizar documentos históricos e trabalhar com evidências documentais.', status: 'implemented' },
    { title: 'Vault de depoimentos (história oral)', detail: 'Entrevistas, transcrições e fontes orais para história e jornalismo.', status: 'implemented' },
    { title: 'Vaults sugeridos pelos usuários', detail: 'Novas áreas com especialistas, colaboração ativa e testers.', status: 'implemented', children: [
      { title: 'Vault de prosopografia', detail: 'Pessoas, relações, identidades e evidências biográficas para pesquisa histórica.', status: 'implemented' },
      { title: 'Vault de worldbuilding', detail: 'Personagens, lugares, cronologias e regras de mundos narrativos.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Ferramentas práticas e local-first para converter arquivos e processar documentos, integradas ao Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Traduzir texto, documentos e anexos do Zotero com o modelo escolhido, preservando a estrutura de DOCX e EPUB e a aparência dos PDFs por meio de um modo fac-símile.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'Apresentar arquivos PDF e apresentações externas com visão do apresentador, controle remoto pelo celular, notas do orador e ferramentas de anotação ao vivo.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistido por IA para PDFs digitalizados e imagens, com revisão página a página, limpeza de texto, reprocessamento e integração direta com os vaults do Nodus.', status: 'implemented' },
  ],
  it: [
    { title: 'Rifinitura e stabilità', detail: 'Correggere gli errori, migliorare le prestazioni e perfezionare l’esperienza generale con il feedback degli utenti.', status: 'inProgress' },
    { title: 'Server', detail: 'Infrastruttura opzionale per nuove capacità connesse.', status: 'planned' },
    { title: 'Condivisione dei vault e lavoro collaborativo', detail: 'Condividere spazi e collaborare mantenendo il controllo dei dati.', status: 'planned' },
    { title: 'App per iOS e iPadOS', detail: 'Portare Nodus su iPhone e iPad con app native adattate a ogni dispositivo.', status: 'planned' },
    { title: 'Vault didattico', detail: 'Preparare lezioni, corsi e materiali didattici proteggendo i dati degli studenti.', status: 'implemented' },
    { title: 'Vault delle fonti primarie', detail: 'Organizzare documenti storici e lavorare con prove documentarie.', status: 'implemented' },
    { title: 'Vault delle testimonianze (storia orale)', detail: 'Interviste, trascrizioni e fonti orali per storia e giornalismo.', status: 'implemented' },
    { title: 'Vault suggeriti dagli utenti', detail: 'Nuovi ambiti con specialisti, collaborazione attiva e tester.', status: 'implemented', children: [
      { title: 'Vault di prosopografia', detail: 'Persone, relazioni, identità e prove biografiche per la ricerca storica.', status: 'implemented' },
      { title: 'Vault di worldbuilding', detail: 'Personaggi, luoghi, cronologie e regole di mondi narrativi.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Strumenti pratici e local-first per convertire file ed elaborare documenti, integrati in Nodus.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Tradurre testo, documenti e allegati Zotero con il modello scelto, conservando la struttura DOCX ed EPUB e l’aspetto dei PDF tramite una modalità facsimile.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'Presentare file PDF e presentazioni esterne con vista del relatore, controllo remoto da mobile, note del relatore e strumenti di annotazione dal vivo.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'OCR assistito dall’IA per PDF scansionati e immagini, con revisione pagina per pagina, pulizia del testo, rielaborazione e integrazione diretta con i vault Nodus.', status: 'implemented' },
  ],
  tr: [
    { title: 'İyileştirme ve kararlılık', detail: 'Hataları düzeltmek, performansı artırmak ve kullanıcı geri bildirimleriyle genel deneyimi geliştirmek.', status: 'inProgress' },
    { title: 'Sunucu', detail: 'Yeni bağlantılı yetenekler için isteğe bağlı altyapı.', status: 'planned' },
    { title: 'Vault paylaşımı ve ortak çalışma', detail: 'Veriler üzerindeki kontrolü koruyarak alanları paylaşmak ve iş birliği yapmak.', status: 'planned' },
    { title: 'iOS ve iPadOS uygulamaları', detail: 'Nodus’u her cihaza uyarlanmış yerel uygulamalarla iPhone ve iPad’e taşımak.', status: 'planned' },
    { title: 'Öğretim vaultu', detail: 'Öğrenci verilerini koruyarak dersleri, kursları ve öğretim materyallerini hazırlamak.', status: 'implemented' },
    { title: 'Birincil kaynaklar vaultu', detail: 'Tarihî belgeleri düzenlemek ve belgesel kanıtlarla çalışmak.', status: 'implemented' },
    { title: 'Tanıklıklar vaultu (sözlü tarih)', detail: 'Tarih ve gazetecilik için röportajlar, transkripsiyonlar ve sözlü kaynaklar.', status: 'implemented' },
    { title: 'Kullanıcıların önerdiği vaultlar', detail: 'Uzmanlar, etkin iş birliği ve test kullanıcılarıyla yeni alanlar.', status: 'implemented', children: [
      { title: 'Prosopografi vaultu', detail: 'Tarih araştırması için kişiler, ilişkiler, kimlikler ve biyografik kanıtlar.', status: 'implemented' },
      { title: 'Worldbuilding vaultu', detail: 'Anlatı dünyalarının karakterleri, yerleri, kronolojileri ve kuralları.', status: 'implemented' },
    ] },
    { title: 'Nodus Toolkit', detail: 'Nodus’a entegre, dosyaları dönüştürmek ve belgeleri işlemek için pratik local-first araçlar.', status: 'implemented' },
    { title: 'Nodus Translate', detail: 'Seçilen modelle metinleri, belgeleri ve Zotero eklerini çevirir; DOCX ve EPUB yapısını, PDF görünümünü ise faksimile moduyla korur.', status: 'implemented' },
    { title: 'Nodus PDF Presenter', detail: 'PDF dosyalarını ve harici sunumları sunucu görünümü, mobilden uzaktan kontrol, konuşmacı notları ve canlı açıklama araçlarıyla sunmak.', status: 'implemented' },
    { title: 'Nodus OCR Workspace', detail: 'Taranmış PDF ve görseller için sayfa sayfa inceleme, metin temizleme, yeniden işleme ve Nodus vaultlarıyla doğrudan bütünleşme sunan yapay zekâ destekli OCR.', status: 'implemented' },
  ],
};

const ROADMAP_STATUS_LABELS: Record<PromptLanguage, Record<RoadmapStatus, string>> = {
  es: { planned: 'Planificado', inProgress: 'En desarrollo', implemented: 'Implementado' },
  en: { planned: 'Planned', inProgress: 'In development', implemented: 'Implemented' },
  fr: { planned: 'Planifié', inProgress: 'En développement', implemented: 'Mis en œuvre' },
  de: { planned: 'Geplant', inProgress: 'In Entwicklung', implemented: 'Implementiert' },
  pt: { planned: 'Planeado', inProgress: 'Em desenvolvimento', implemented: 'Implementado' },
  'pt-BR': { planned: 'Planejado', inProgress: 'Em desenvolvimento', implemented: 'Implementado' },
  it: { planned: 'Pianificato', inProgress: 'In sviluppo', implemented: 'Implementato' },
  tr: { planned: 'Planlandı', inProgress: 'Geliştiriliyor', implemented: 'Uygulandı' },
};

function roadmapGuide(language: PromptLanguage): string {
  const labels = ROADMAP_STATUS_LABELS[language];
  return LOCALIZED_ROADMAP[language].map((item, index) => {
    const children = item.children?.map((child) => `   - ${child.title} [${labels[child.status]}]: ${child.detail}`).join('\n');
    return `${index + 1}. ${item.title} [${labels[item.status]}]: ${item.detail}${children ? `\n${children}` : ''}`;
  }).join('\n');
}

export function getNodusRoadmap(language: PromptLanguage = 'es'): readonly RoadmapItem[] {
  return LOCALIZED_ROADMAP[language] ?? LOCALIZED_ROADMAP.es;
}

export function getNodusRoadmapStatusLabel(status: RoadmapStatus, language: PromptLanguage = 'es'): string {
  return ROADMAP_STATUS_LABELS[language]?.[status] ?? ROADMAP_STATUS_LABELS.es[status];
}

/**
 * English is the complete secondary canonical copy. The localized headings and
 * roadmap are kept separate so all seven prompt languages receive the same
 * verified facts, limits, routes, product names, and technical identifiers.
 */
const ENGLISH_DOCUMENTATION = `# Nodus Verifiable Internal Guide

## Rules for reading this guide
- This guide documents the current interface and the application's official visible roadmap.
- The roadmap distinguishes planned, in-development, and implemented items. Do not attribute dates or versions that do not appear here.
- “Implemented” means that the vault or feature exists and can be opened; it does not mean that it has reached a stable version.
- Nodus is local-first: each vault stores its data on the user's computer.
- Provider keys are configured in Settings > Providers. Favorite models are selected there, and each feature keeps its own selector.

## Available vaults and maturity level
- All types below can be created from Vaults > Add vault: Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography, and Worldbuilding.
- Primary sources, Testimonies, and Prosopography are PRE-ALPHA: they are not usable for real work. They are available only to people who want to test incomplete features and report errors or improvement proposals. A specific confirmation appears before creating them.
- Worldbuilding is ALPHA: its main features are still being tested and it is recommended only for testers.
- Databases, Teaching, Study, and Genealogy are BETA: functional, but still needing feedback and fixes.
- Academic shows no phase label in the selector.
- Creating or loading demo data does not open the tutorial. The tutorial appears when creating a vault or when the user explicitly opens it from Settings > Tutorials.

## Header and global controls
- At the far right of the header, in general order, are: Commands, Assistant, Tools, conditional vault controls, Suggest / Report, light/dark theme selector, Notifications, and Settings.
- Tools opens the Nodus Toolkit hub and is immediately after the Assistant button.
- Notifications is immediately before Settings and is the last icon before it. It opens a panel with two lists: “Nodus notices” (notices published between versions, marked read one by one) and “Activity” (what the application has done, marked read when the panel opens). It shows the same notifications as Nodi and works even when the mascot is disabled.
- The light/dark theme selector is immediately before Notifications.
- The active vault opens from the centered badge in the header, not from a far-right icon: the badge opens the selector to switch, create, rename, duplicate, reset, or delete vaults according to the available action. The command palette also has the “Vaults” action.
- Collections no longer has its own header icon; it opens from the command palette in academic vaults.
- Inbox appears only when something has arrived from another device; it belongs to each vault connected to Nodus Server.
- Commands opens the global palette; its visible shortcut is ⌘K on macOS.
- The Assistant button in the header opens the research assistant. Nodi is the independent mascot in the lower-right area when enabled.

## Official visible roadmap
The roadmap opens from Settings > About Nodus Research > View Nodus Research roadmap, and also from the command palette. The current order is:
__ROADMAP_GUIDE__

## Settings
- Settings is the last sidebar item and also has an icon at the far right of the header.
- Its actual tabs are: Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research, and Updates and news.
- Providers: API keys, local providers, and favorite models.
- AI Models: the general model and models specific to different tasks.
- Library: Zotero integration and synchronization. Testimonies, Prosopography, and Worldbuilding do not use Zotero and do not show that route.
- Interface: language, theme, accessibility, sidebar, and Nodi Mascot.
- Integrations: local MCP server and writing copilots for Word and LibreOffice.
- Server: connecting each vault to Nodus Server and publishing its filtered copy.
- Tutorials: application help and walkthroughs.
- Backup: backups, import, export, and maintenance.
- Nodi's visibility, floating window, and outfits are in Settings > Interface > Nodi Mascot.

## Academic vault
- It is oriented toward academic research and writing.
- It may include Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes, and Settings.
- Sections can be hidden or reordered from Settings > Interface > Sidebar.
- Deep Research retrieves evidence from the corpus, generates a report, and allows export as a document or PDF with the vault's visual identity.

## Genealogy vault
- It is available and oriented toward document-supported family history.
- It includes People, Timeline, Family tree, Social relations, Map, and Archive.
- Claims about identities and kinships must be supported by records or evidence. Sharing a surname, address, or appearing in the same document does not prove kinship.

## Database vaults
- They are available and manage structured tables with typed columns, rows, views, search, analysis, and Data Chat.
- User-created databases appear in the sidebar. Fixed sections include Search, Analysis, and Data Chat.

## Study vault
- It is available. Its hierarchy is Course > Subject; inside a subject there may be folders, topics, subtopics, notes, and materials.
- It includes Courses and subjects, Schedules, Calendar, Search, Materials, Recordings, Study chat, Ideas, Graph, Question bank, and Review.
- Schedules uses a clock icon; Calendar uses a calendar icon.
- In Schedules, clicking a cell opens a dropdown to add an existing subject or an independent activity.
- Calendar offers monthly, weekly, and yearly views, events with reminders, and export to iCloud or Google Calendar.
- The Question bank contains questions, tests, exams, and flashcards; a flashcard opens in its specific modal.

## Teaching vault
- It is implemented and available in BETA. It reuses the Course > Subject organization and adds a teaching workspace.
- Implemented sections include Courses, subjects and groups, Groups, Schedules, Calendar, Materials, Recordings, Chat, Ideas, Graph, Question bank, Rubrics, Exams, Grades, and Unit design.
- Teaching guide / Planning, Learning situations, Adaptations, Notes, and Innovation projects appear as “In design” items: they open their feedback thread and must not be described as finished features.
- To start: create courses and subjects, create groups, add materials, and then use the assessment surfaces you need. Student data is managed inside Groups and Grades.

## Primary sources vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit, and Settings.
- Archive organizes documents by archival location or work collections. The tree's side panel can be hidden and shown again with its panel control.
- To add documents: open Archive and use Add source. The table shows cataloguing metadata and a thumbnail when an image exists.
- Clicking a row opens the document modal. From that modal, cataloguing data, description, text, evidence, analysis, notes, history, files, and representations can be consulted and edited; compact actions use icons with accessible labels.
- The user can choose the icon or document type; Nodus suggests one based on the source type, but the choice remains editable.
- Map represents the provenance assigned to each source, not every city mentioned in its text. Provenance is chosen in the document through a dropdown connected to places available on the map.
- Every automatic result is a proposal pending review. Distinguish transcription, observation, and inference, and preserve provenance, locators, contradictions, and uncertainty.

## Testimonies vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Interviews, Participants, Contrasts, Notes, Toolkit, and Settings.
- Specific work happens inside each interview's dossier: sessions, media, transcriptions, fragments, codes, annotations, agreements, and restrictions. Menu views gather what crosses several interviews.
- To start: create an interview, record participants and agreements, add a session or medium, and prepare or import the transcription. Codes and annotations are applied to fragments; Contrasts compares documented fragments.
- Editing a participant uses a modal inside the current view.
- Nodi respects access, anonymization, embargo, and attribution. It must not expose material that the agreement does not authorize or infer sensitive attributes, emotions, sincerity, or credibility.

## Prosopography vault
- It is implemented and available in PRE-ALPHA exclusively for collaboration and testing, not real work.
- Its sections are Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit, and Settings.
- Recommended flow: define and version the population methodology; design the questionnaire and vocabularies; record sources and segments; capture atomic factoids and statements; resolve identities; decide membership; and only then run analyses or networks.
- Search covers people, mentions, sources, and statements. Analysis declares population, denominator, absences, and input footprint. Networks visually separates explicit, derived, and hypothetical relationships.
- Do not confuse person, mention, source, factoid, and statement. Do not merge identities or turn a documentary observation into a fact without review.

## Worldbuilding vault
- It is implemented and available in ALPHA, recommended only for testers.
- Explore includes Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, and Dynasties.
- Analyze includes World chat, World rules, Conflicts, Narrative arcs, Continuity, and Open questions. Create includes Notes, Scenes, and Manuscript.
- To start: record the world's canonical sheets; relate characters, places, groups, and scenes; define rules and storylines; use Continuity to detect documented tensions; and write in Manuscript.
- The author is the source of truth. Nodi does not invent canon: it must clearly distinguish established information from a proposal.

## Tools (Nodus Toolkit)
- Tools is a sidebar section in its own group and also has a header icon. It appears for every vault type.
- Its home page is a hub with five cards: Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter, and OCR Workspace.
- Nodus Convert works: it converts and processes files locally, one at a time or in batches, in five categories — Documents (PDF, DOCX, EPUB, Markdown, HTML, text), PDF utilities (merge, split, rotate, reorder, extract images, metadata, images→PDF), light OCR (image or scanned PDF to text, and searchable PDF), Images (format conversion including HEIC, resize, compress), and Text (clean text pasted from PDF, upper/lower case, subtitles to text, checksums).
- Nodus Protect works: it accepts PDFs and images from disk or the active vault, concatenates documents, can hide or blur data, crop, rotate, straighten, convert to grayscale, add seven watermark patterns and a legal footer, and export rasterized copies as PNG, ZIP, or PDF.
- Protect can save a copy to disk, share it, or add it to the vault's “Protected copies” library. It also creates and verifies traceable IDPS v1 marks compatible with IDprotector; the mark authenticates a copy but does not encrypt it and may be lost through JPEG, screenshots, resizing, or recompression.
- Nodus Translate works: it translates pasted text, TXT, Markdown, HTML, DOCX, EPUB, and PDF files, as well as attachments imported from Zotero. It allows choosing target language, model, folder, and output format, and adding optional source language and glossary.
- In DOCX and EPUB, Translate directly preserves styles, hierarchy, headers, footers, notes, links, and images from the original. In PDF it offers a reflow reading mode and a rasterized facsimile mode that preserves pages, geometry, backgrounds, and images and visibly replaces text in position; it can use vision for scans and text inside images. If a translation does not fit, it reduces the size and warns about affected pages.
- Translation requires the selected AI provider and may send it the text or pages that need recognition. The original file is never modified: the result is saved as a new copy.
- PDF Presenter can be opened: it imports PDF files or presentations made in PowerPoint, LibreOffice, or Keynote into a global Tools library (with folders, search, sorting, and thumbnails). External presentations are converted locally to PDF after warning that animations and transitions are not preserved; modern PowerPoint notes are imported automatically. It also allows writing notes per slide, exporting and importing them together in TXT, and adding YouTube videos per slide. When presenting, it opens the slide full-screen (on the external display if there are two) and a presenter view with the current slide, next slide, notes, timer, and clock; it includes live annotation tools (torch, drawing, pointer, and magnifier), black screen, and remote control from a mobile by scanning a PIN-protected QR code. YouTube videos are the only element that needs a connection; everything else works offline.
- OCR Workspace can be opened and offers an AI-assisted flow to import scans, review and correct each page, and export the result.
- Nodus Convert is deterministic and 100% offline (there is no AI), never modifies the original file, and uploads nothing to any service; the only optional network call is downloading Tesseract OCR languages, which the user decides.
- Nodus Protect document processing is local and does not send documents to AI, providers, or external services. This statement concerns Protect, not every optional network feature of Nodus.
- Within a tool, a button to the left of its title returns to the Tools hub.

## Local MCP and Nodus Server
- The local MCP server is configured in Settings > Integrations > MCP Server. It can be enabled, its status checked, connection help opened, and its token regenerated.
- MCP exposes tools suitable for the active vault type, as well as general tools. Switching vault changes the context those tools query.
- Nodus Server is independent of local MCP. It is configured in Settings > Server, and each vault connects separately through the server's HTTPS URL and a one-time code.
- Nodus publishes a logical, filtered copy over outbound HTTPS: it does not open an incoming port on the computer and does not share a listener, port, or token with local MCP.
- While Nodus is open it keeps the copy updated; the Docker server can serve the last published copy to authorized clients even when the computer is off.
- The interface allows publishing now, pausing, managing, or disconnecting each connected vault. Remote access uses OAuth and read permissions over assigned spaces.
- In the roadmap, the Server initiative is “Planned”, as is vault sharing and collaborative work. Do not present collaborative work as available.

## Roadmap summary status
- In development: Polishing and stability.
- Planned: Server; Vault sharing and collaborative work; Apps for iOS and iPadOS.
- Implemented: Teaching, Primary sources, Testimonies, User-suggested vaults —Prosopography and Worldbuilding—, Nodus Toolkit, Nodus Translate, PDF Presenter, and OCR Workspace.
- There are no fixed dates for roadmap initiatives.

## Protocol for answering about the interface
- Use the exact names in this guide and, when selected, the Current view.
- Do not fill gaps with common patterns from other applications. Do not invent buttons, menus, paths, shortcuts, versions, dates, or statuses.
- Do not turn the availability of a PRE-ALPHA or ALPHA vault into a recommendation for real use. Always state its phase when relevant.
- If an answer is not covered, say “I cannot verify this with the selected sources” and state what context would help, without proposing an invented route.
- Always distinguish available, conditional, future, and unverified.
- When the question asks for a location or instructions, give brief numbered steps and end with a “Base: …” line listing the sources used.`;

/** Localized headings keep the complete factual copy legible in each language. */
/* Localized copies below are the sole non-Spanish documentation source. */
const COMPACT_LOCALIZED_DOCUMENTATION: Record<Exclude<PromptLanguage, 'es' | 'en'>, string> = {
  fr: `# Guide interne vérifiable de Nodus

## Règles de lecture
- Cette guide décrit l’interface actuelle et la feuille de route officielle. Ne déduis aucune fonction, route, date, version ou état absent des sources.
- « Mis en œuvre » signifie que la fonction existe et s’ouvre, pas qu’elle est stable. Nodus est local-first et chaque vault conserve ses données sur l’ordinateur.

## Vaults disponibles et maturité
- Vaults > Ajouter un vault permet de créer Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography et Worldbuilding.
- Primary sources, Testimonies et Prosopography sont PRE-ALPHA; Worldbuilding est ALPHA; Databases, Teaching, Study et Genealogy sont BETA. Academic n’affiche pas de phase. Le tutoriel ne s’ouvre pas avec les données de démonstration.

## En-tête et contrôles globaux
- L’ordre général à droite est Commands, Assistant, Tools, contrôles du vault, Suggest / Report, thème, Notifications et Settings; Commands utilise ⌘K sur macOS.
- La pastille centrale ouvre le sélecteur du vault. Notifications contient « Nodus notices » et « Activity » et reste disponible si Nodi est désactivé.

## Feuille de route officielle visible
- Elle s’ouvre dans Settings > About Nodus Research > View Nodus Research roadmap ou dans la palette de commandes. L’ordre et les états sont :
__ROADMAP_GUIDE__

## Réglages
- Les onglets sont Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research et Updates and news.
- Providers gère clés et modèles; Library synchronise Zotero; Interface gère langue, thème, accessibilité, barre latérale et Nodi; Server publie la copie filtrée du vault.

## Vault académique
- Il sert à la recherche et à l’écriture; ses surfaces comprennent Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes et Settings.
- Deep Research récupère le corpus, produit un rapport et l’exporte en document ou PDF avec l’identité du vault.

## Vault de généalogie
- Il comprend People, Timeline, Family tree, Social relations, Map et Archive. Les identités et parentés exigent des registres ou preuves; un nom, une adresse ou un document commun ne suffit pas.

## Vaults de bases de données
- Ils gèrent des tables structurées, colonnes typées, lignes, vues, recherche, analyse et Data Chat; les bases utilisateur apparaissent dans la barre latérale.

## Vault d’étude
- La hiérarchie est Course > Subject avec dossiers, thèmes, sous-thèmes, notes et matériaux; il comprend Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank et Review.
- Schedules permet une activité par cellule; Calendar offre vues mensuelle, hebdomadaire et annuelle et export iCloud ou Google Calendar; Question bank contient questions, tests, examens et flashcards.

## Vault d’enseignement
- Implémenté en BETA, il réutilise Course > Subject et ajoute groupes, matériaux, Chat, Rúbricas, Exams, Grades et Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes et Innovation projects sont « In design ».

## Vault de sources primaires
- Implémenté en PRE-ALPHA pour tests et collaboration, il comprend Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit et Settings; Archive gère provenance et métadonnées.
- Les résultats automatiques restent des propositions à vérifier; distingue transcription, observation et inférence et conserve localisateurs, contradictions et incertitude.

## Vault de témoignages
- Implémenté en PRE-ALPHA, il comprend Search, Interviews, Participants, Contrasts, Notes, Toolkit et Settings; les dossiers regroupent sessions, médias, transcriptions, fragments, codes, accords et restrictions.
- Nodi respecte accès, anonymisation, embargo et attribution et n’infère pas d’attributs sensibles, émotions, sincérité ou crédibilité.

## Vault de prosopographie
- Implémenté en PRE-ALPHA, il comprend Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit et Settings; la méthode précède identités, appartenance, analyses et réseaux.
- Ne confonds pas person, mention, source, factoid et statement; les identités ne sont fusionnées qu’après révision.

## Vault de worldbuilding
- Implémenté en ALPHA, il propose Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families et Dynasties, ainsi que World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes et Manuscript.
- L’auteur est la source de vérité; Nodi distingue le canon établi de toute proposition.

## Outils (Nodus Toolkit)
- Le hub contient Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter et OCR Workspace. Convert traite localement Documents (PDF, DOCX, EPUB, Markdown, HTML), utilitaires PDF, OCR léger, Images et Text.
- Protect rasterise et exporte PNG, ZIP ou PDF, sans modifier l’original. Translate traite TXT, Markdown, HTML, DOCX, EPUB, PDF et pièces Zotero; il conserve la structure et propose un mode fac-similé. PDF Presenter importe PowerPoint, LibreOffice et Keynote; OCR Workspace révise chaque page.
- Convert est déterministe et 100 % offline; Protect ne transmet pas de documents à l’IA. La seule connexion facultative de Convert télécharge les langues OCR de Tesseract.

## MCP local et Nodus Server
- MCP se règle dans Settings > Integrations > MCP Server et expose les outils du vault actif. Nodus Server est séparé, se règle dans Settings > Server et utilise URL HTTPS et code unique par vault.
- La copie publiée est filtrée et sortante; elle ne partage ni listener, ni port, ni token avec MCP. OAuth protège l’accès distant. Server et le partage collaboratif restent « Planifié ».

## État récapitulatif de la feuille de route
- En développement : Polissage et stabilité. Planifié : Server, partage de vaults et travail collaboratif, applications iOS et iPadOS. Mis en œuvre : Teaching, Primary sources, Testimonies, vaults suggérés, Nodus Toolkit, Nodus Translate, PDF Presenter et OCR Workspace.
- Aucune date fixe n’est annoncée.

## Protocole d’interface
- Utilise les noms exacts et la Vue actuelle; sépare disponible, conditionnel, futur et non vérifié. Si la source manque, dis « Je ne peux pas le vérifier avec les sources sélectionnées ».
- Ne transforme jamais PRE-ALPHA ou ALPHA en recommandation réelle; pour une localisation, donne des étapes brèves et termine par « Base: … ».
`,
  pt: `# Guia interno verificável do Nodus

## Regras de leitura
- Este guia descreve a interface atual e o roteiro oficial. Não invente funcionalidades, caminhos, datas, versões ou estados que não estejam documentados.
- «Implementado» significa que existe e pode ser aberto, não que seja estável. O Nodus é local-first e cada cofre guarda os dados no computador.

## Cofres disponíveis e maturidade
- Em Cofres > Adicionar cofre podem ser criados Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography são PRE-ALPHA; Worldbuilding é ALPHA; Databases, Teaching, Study e Genealogy são BETA. Academic não mostra fase e dados de demonstração não abrem o tutorial.

## Cabeçalho e controlos globais
- À direita aparecem Commands, Assistant, Tools, controlos do cofre, Suggest / Report, tema, Notifications e Settings; Commands usa ⌘K no macOS.
- A insígnia central abre o seletor do cofre. Notifications contém «Nodus notices» e «Activity» e funciona com Nodi desativado.

## Roteiro oficial visível
- Abre-se em Settings > About Nodus Research > View Nodus Research roadmap ou na paleta de comandos. Ordem e estados:
__ROADMAP_GUIDE__

## Definições
- Os separadores são Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gere chaves e modelos; Library sincroniza Zotero; Interface gere idioma, tema, acessibilidade, barra lateral e Nodi; Server publica a cópia filtrada.

## Cofre académico
- Serve para investigação e escrita e inclui Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera evidência do corpus, cria um relatório e permite exportá-lo como documento ou PDF.

## Cofre de genealogia
- Inclui People, Timeline, Family tree, Social relations, Map e Archive. Identidades e parentescos exigem registos ou provas; apelido, morada ou documento comum não bastam.

## Cofres de bases de dados
- Gerem tabelas estruturadas com colunas tipadas, linhas, vistas, pesquisa, análise e Data Chat; as bases do utilizador aparecem na barra lateral.

## Cofre de estudo
- A hierarquia é Course > Subject, com pastas, temas, subtemas, notas e materiais; inclui Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules aceita uma atividade por célula; Calendar oferece vistas mensal, semanal e anual e exportação para iCloud ou Google Calendar; Question bank contém perguntas, testes, exames e flashcards.

## Cofre de docência
- Está implementado em BETA, reutiliza Course > Subject e acrescenta grupos, materiais, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects continuam «In design».

## Cofre de fontes primárias
- Está implementado em PRE-ALPHA para testes e colaboração, com Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gere proveniência e metadados.
- Resultados automáticos são propostas pendentes de revisão; separa transcrição, observação e inferência e conserva localizadores, contradições e incerteza.

## Cofre de testemunhos
- Está implementado em PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizam sessões, meios, transcrições, fragmentos, códigos, acordos e restrições.
- Nodi respeita acesso, anonimização, embargo e atribuição e não infere atributos sensíveis, emoções, sinceridade ou credibilidade.

## Cofre de prosopografia
- Está implementado em PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguem metodologia, identidades, pertença, análise e redes.
- Não confundas person, mention, source, factoid e statement; não fusiones identidades sem revisão.

## Cofre de worldbuilding
- Está implementado em ALPHA e inclui Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- O autor é a fonte de verdade; Nodi separa cânone estabelecido de propostas.

## Ferramentas (Nodus Toolkit)
- O hub contém Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter e OCR Workspace. Convert processa localmente Documents, utilitários PDF, OCR leve, Images e Text.
- Protect exporta PNG, ZIP ou PDF sem alterar o original; Translate trata TXT, Markdown, HTML, DOCX, EPUB, PDF e anexos Zotero; PDF Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revê cada página.
- Convert é determinístico e 100 % offline; Protect não envia documentos à IA. Só a descarga opcional de idiomas OCR do Tesseract usa rede.

## MCP local e Nodus Server
- MCP configura-se em Settings > Integrations > MCP Server. Nodus Server é separado, configura-se em Settings > Server e usa URL HTTPS e código único por cofre.
- A cópia publicada é filtrada e apenas de saída; OAuth protege o acesso. Server e partilha colaborativa continuam «Planeado».

## Estado resumido do roteiro
- Em desenvolvimento: Polimento e estabilidade. Planeado: Server, partilha de cofres e colaboração, aplicações iOS e iPadOS. Implementado: Teaching, Primary sources, Testimonies, cofres sugeridos, Nodus Toolkit, Nodus Translate, PDF Presenter e OCR Workspace.
- Não há datas fixas.

## Protocolo da interface
- Usa os nomes exatos e a Vista atual; distingue disponível, condicional, futuro e não verificado. Se faltar fonte, diz «Não consigo verificar isto com as fontes selecionadas».
- Nunca recomendes PRE-ALPHA ou ALPHA para trabalho real; em instruções termina com «Base: …».
`,
  'pt-BR': `# Guia interno verificável do Nodus

## Regras de leitura
- Este guia descreve a interface atual e o roadmap oficial. Não invente recursos, caminhos, datas, versões ou status que não estejam documentados.
- “Implementado” significa que existe e pode ser aberto, não que seja estável. O Nodus é local-first e cada vault armazena os dados no computador.

## Vaults disponíveis e maturidade
- Em Vaults > Adicionar vault podem ser criados Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography são PRE-ALPHA; Worldbuilding é ALPHA; Databases, Teaching, Study e Genealogy são BETA. Academic não mostra fase e dados de demonstração não abrem o tutorial.

## Cabeçalho e controles globais
- À direita aparecem Commands, Assistant, Tools, controles do vault, Suggest / Report, tema, Notifications e Settings; Commands usa ⌘K no macOS.
- O emblema central abre o seletor do vault. Notifications contém “Nodus notices” e “Activity” e funciona mesmo com Nodi desativado.

## Roadmap oficial visível
- Abre em Settings > About Nodus Research > View Nodus Research roadmap ou na paleta de comandos. Ordem e status:
__ROADMAP_GUIDE__

## Configurações
- As abas são Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gerencia chaves e modelos; Library sincroniza Zotero; Interface gerencia idioma, tema, acessibilidade, barra lateral e Nodi; Server publica a cópia filtrada.

## Vault acadêmico
- Destina-se à pesquisa e escrita e inclui Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera evidências do corpus, gera relatório e permite exportar documento ou PDF.

## Vault de genealogia
- Inclui People, Timeline, Family tree, Social relations, Map e Archive. Identidades e parentescos exigem registros ou evidências; sobrenome, endereço ou documento comum não bastam.

## Vaults de bancos de dados
- Gerenciam tabelas estruturadas com colunas tipadas, linhas, visualizações, busca, análise e Data Chat; as bases do usuário aparecem na barra lateral.

## Vault de estudo
- A hierarquia é Course > Subject, com pastas, temas, subtemas, notas e materiais; inclui Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules aceita atividade por célula; Calendar oferece visões mensal, semanal e anual e exportação para iCloud ou Google Calendar; Question bank contém perguntas, testes, exames e flashcards.

## Vault de ensino
- Está implementado em BETA, reutiliza Course > Subject e acrescenta grupos, materiais, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects continuam “In design”.

## Vault de fontes primárias
- Está implementado em PRE-ALPHA para testes e colaboração, com Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gerencia proveniência e metadados.
- Resultados automáticos são propostas pendentes de revisão; separe transcrição, observação e inferência e preserve localizadores, contradições e incerteza.

## Vault de depoimentos
- Está implementado em PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizam sessões, mídias, transcrições, fragmentos, códigos, acordos e restrições.
- Nodi respeita acesso, anonimização, embargo e atribuição e não infere atributos sensíveis, emoções, sinceridade ou credibilidade.

## Vault de prosopografia
- Está implementado em PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguem metodologia, identidades, pertencimento, análise e redes.
- Não confunda person, mention, source, factoid e statement; não una identidades sem revisão.

## Vault de worldbuilding
- Está implementado em ALPHA e inclui Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- O autor é a fonte da verdade; Nodi separa cânone estabelecido de propostas.

## Ferramentas (Nodus Toolkit)
- O hub contém Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter e OCR Workspace. Convert processa localmente Documents, utilitários PDF, OCR leve, Images e Text.
- Protect exporta PNG, ZIP ou PDF sem alterar o original; Translate trata TXT, Markdown, HTML, DOCX, EPUB, PDF e anexos Zotero; PDF Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revisa cada página.
- Convert é determinístico e 100% offline; Protect não envia documentos à IA. Só o download opcional de idiomas OCR do Tesseract usa rede.

## MCP local e Nodus Server
- MCP é configurado em Settings > Integrations > MCP Server. Nodus Server é separado, fica em Settings > Server e usa URL HTTPS e código único por vault.
- A cópia publicada é filtrada e apenas de saída; OAuth protege o acesso. Server e compartilhamento colaborativo continuam “Planejado”.

## Status resumido do roadmap
- Em desenvolvimento: Polimento e estabilidade. Planejado: Server, compartilhamento de vaults e colaboração, aplicativos para iOS e iPadOS. Implementado: Teaching, Primary sources, Testimonies, vaults sugeridos, Nodus Toolkit, Nodus Translate, PDF Presenter e OCR Workspace.
- Não há datas fixas.

## Protocolo da interface
- Use os nomes exatos e a Visão atual; diferencie disponível, condicional, futuro e não verificado. Se faltar fonte, diga “Não consigo verificar isso com as fontes selecionadas”.
- Nunca recomende PRE-ALPHA ou ALPHA para trabalho real; em instruções termine com “Base: …”.
`,
  it: `# Guida interna verificabile di Nodus

## Regole di lettura
- Questa guida descrive l’interfaccia attuale e la roadmap ufficiale. Non inventare funzioni, percorsi, date, versioni o stati non documentati.
- «Implementato» significa esistente e apribile, non stabile. Nodus è local-first e ogni vault conserva i dati sul computer dell’utente.

## Vault disponibili e maturità
- In Vaults > Aggiungi vault si possono creare Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography e Worldbuilding.
- Primary sources, Testimonies e Prosopography sono PRE-ALPHA; Worldbuilding è ALPHA; Databases, Teaching, Study e Genealogy sono BETA. Academic non mostra una fase e i dati demo non aprono il tutorial.

## Intestazione e controlli globali
- A destra compaiono Commands, Assistant, Tools, controlli del vault, Suggest / Report, tema, Notifications e Settings; su macOS Commands usa ⌘K.
- Il contrassegno centrale apre il selettore del vault. Notifications contiene «Nodus notices» e «Activity» e funziona anche con Nodi disattivato.

## Roadmap ufficiale visibile
- Si apre da Settings > About Nodus Research > View Nodus Research roadmap o dalla palette dei comandi. Ordine e stati:
__ROADMAP_GUIDE__

## Impostazioni
- Le schede sono Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research e Updates and news.
- Providers gestisce chiavi e modelli; Library sincronizza Zotero; Interface gestisce lingua, tema, accessibilità, barra laterale e Nodi; Server pubblica la copia filtrata.

## Vault accademico
- È dedicato alla ricerca e alla scrittura e comprende Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes e Settings.
- Deep Research recupera prove dal corpus, genera un rapporto e consente l’esportazione come documento o PDF.

## Vault genealogico
- Comprende People, Timeline, Family tree, Social relations, Map e Archive. Identità e parentele richiedono registri o prove; cognome, indirizzo o documento comune non bastano.

## Vault di database
- Gestisce tabelle strutturate con colonne tipizzate, righe, viste, ricerca, analisi e Data Chat; i database dell’utente compaiono nella barra laterale.

## Vault di studio
- La gerarchia è Course > Subject con cartelle, temi, sottotemi, appunti e materiali; include Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank e Review.
- Schedules accetta attività per cella; Calendar offre viste mensile, settimanale e annuale ed esportazione in iCloud o Google Calendar; Question bank contiene domande, test, esami e flashcard.

## Vault didattico
- Implementato in BETA, riusa Course > Subject e aggiunge gruppi, materiali, Chat, Rubrics, Exams, Grades e Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes e Innovation projects restano «In design».

## Vault delle fonti primarie
- Implementato in PRE-ALPHA per test e collaborazione, comprende Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit e Settings; Archive gestisce provenienza e metadati.
- I risultati automatici sono proposte da revisionare; separa trascrizione, osservazione e inferenza e conserva riferimenti, contraddizioni e incertezza.

## Vault delle testimonianze
- Implementato in PRE-ALPHA; Search, Interviews, Participants, Contrasts, Notes, Toolkit e Settings organizzano sessioni, media, trascrizioni, frammenti, codici, accordi e restrizioni.
- Nodi rispetta accesso, anonimizzazione, embargo e attribuzione e non deduce attributi sensibili, emozioni, sincerità o credibilità.

## Vault di prosopografia
- Implementato in PRE-ALPHA; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit e Settings seguono metodologia, identità, appartenenza, analisi e reti.
- Non confondere person, mention, source, factoid e statement; non unire identità senza revisione.

## Vault di worldbuilding
- Implementato in ALPHA e include Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes e Manuscript.
- L’autore è la fonte della verità; Nodi distingue il canone stabilito dalle proposte.

## Strumenti (Nodus Toolkit)
- L’hub contiene Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter e OCR Workspace. Convert elabora localmente Documents, utilità PDF, OCR leggero, Images e Text.
- Protect esporta PNG, ZIP o PDF senza modificare l’originale; Translate tratta TXT, Markdown, HTML, DOCX, EPUB, PDF e allegati Zotero; PDF Presenter importa PowerPoint, LibreOffice e Keynote; OCR Workspace revisiona ogni pagina.
- Convert è deterministico e 100% offline; Protect non invia documenti all’IA. Solo il download facoltativo delle lingue OCR di Tesseract usa la rete.

## MCP locale e Nodus Server
- MCP si configura in Settings > Integrations > MCP Server. Nodus Server è separato, si configura in Settings > Server e usa URL HTTPS e codice monouso per vault.
- La copia pubblicata è filtrata e in uscita; OAuth protegge l’accesso. Server e condivisione collaborativa restano «Pianificati».

## Stato riassuntivo della roadmap
- In sviluppo: Rifinitura e stabilità. Pianificato: Server, condivisione dei vault e collaborazione, app iOS e iPadOS. Implementato: Teaching, Primary sources, Testimonies, vault suggeriti, Nodus Toolkit, Nodus Translate, PDF Presenter e OCR Workspace.
- Non ci sono date fissate.

## Protocollo dell’interfaccia
- Usa i nomi esatti e la Vista attuale; distingui disponibile, condizionale, futuro e non verificato. Se manca una fonte, dì «Non posso verificarlo con le fonti selezionate».
- Non raccomandare mai PRE-ALPHA o ALPHA per lavoro reale; nelle istruzioni termina con «Base: …».
`,
  tr: `# Nodus Doğrulanabilir Dahili Kılavuz

## Okuma kuralları
- Bu kılavuz mevcut arayüzü ve resmî yol haritasını açıklar. Belgelenmeyen özellik, yol, tarih, sürüm veya durum uydurmayın.
- “Uygulandı” mevcut ve açılabilir demektir; kararlı demek değildir. Nodus local-first çalışır ve her vault verilerini bilgisayarda saklar.

## Kullanılabilir vaultlar ve olgunluk
- Vaultlar > Vault ekle üzerinden Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography ve Worldbuilding oluşturulabilir.
- Primary sources, Testimonies ve Prosopography PRE-ALPHA; Worldbuilding ALPHA; Databases, Teaching, Study ve Genealogy BETA’dır. Academic aşama göstermez; demo verileri öğreticiyi açmaz.

## Başlık ve genel denetimler
- Sağda genel olarak Commands, Assistant, Tools, vault denetimleri, Suggest / Report, tema, Notifications ve Settings bulunur; macOS’ta Commands kısayolu ⌘K’dır.
- Ortadaki rozet vault seçicisini açar. Notifications “Nodus notices” ve “Activity” listelerini içerir ve Nodi kapalıyken de çalışır.

## Resmî görünür yol haritası
- Settings > About Nodus Research > View Nodus Research roadmap üzerinden veya komut paletinden açılır. Sıra ve durumlar:
__ROADMAP_GUIDE__

## Ayarlar
- Gerçek sekmeler Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research ve Updates and news’tur.
- Providers anahtarları ve modelleri; Library Zotero eşzamanlamasını; Interface dil, tema, erişilebilirlik, kenar çubuğu ve Nodi’yi; Server filtrelenmiş kopyayı yönetir.

## Akademik vault
- Araştırma ve akademik yazım içindir; Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes ve Settings içerir.
- Deep Research derlemden kanıt alır, rapor üretir ve belge veya PDF olarak dışa aktarır.

## Soybilim vaultu
- People, Timeline, Family tree, Social relations, Map ve Archive içerir. Kimlik ve akrabalık iddiaları kayıt veya kanıt gerektirir; soyadı, adres ya da ortak belge yeterli değildir.

## Veritabanı vaultları
- Yazılı sütunlara sahip yapılandırılmış tabloları, satırları, görünümleri, aramayı, analizi ve Data Chat’i yönetir; kullanıcı veritabanları kenar çubuğunda görünür.

## Çalışma vaultu
- Hiyerarşi Course > Subject’tir; klasör, konu, alt konu, not ve materyaller içerir. Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank ve Review bulunur.
- Schedules hücre başına etkinlik ekler; Calendar aylık, haftalık ve yıllık görünümler ile iCloud veya Google Calendar dışa aktarımı sunar; Question bank sorular, testler, sınavlar ve flashcard’lar içerir.

## Öğretim vaultu
- BETA’da uygulanmıştır; Course > Subject düzenini kullanır ve gruplar, materyaller, Chat, Rubrics, Exams, Grades ve Unit design ekler. Teaching guide / Planning, Learning situations, Adaptations, Notes ve Innovation projects “In design” durumundadır.

## Birincil kaynaklar vaultu
- Test ve iş birliği için PRE-ALPHA’da uygulanmıştır; Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit ve Settings içerir. Archive provenans ve katalog verilerini yönetir.
- Otomatik sonuçlar incelenmesi gereken önerilerdir; transkripsiyon, gözlem ve çıkarımı ayırın, konumlandırıcıları, çelişkileri ve belirsizliği koruyun.

## Tanıklıklar vaultu
- PRE-ALPHA’da uygulanmıştır; Search, Interviews, Participants, Contrasts, Notes, Toolkit ve Settings oturum, medya, transkripsiyon, parçalar, kodlar, anlaşmalar ve kısıtları düzenler.
- Nodi erişim, anonimleştirme, ambargo ve atıfa uyar; hassas özellikleri, duyguları, samimiyeti veya güvenilirliği çıkarmaz.

## Prosopografi vaultu
- PRE-ALPHA’da uygulanmıştır; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit ve Settings yöntem, kimlik, üyelik, analiz ve ağ akışını destekler.
- person, mention, source, factoid ve statement kavramlarını karıştırmayın; inceleme olmadan kimlikleri birleştirmeyin.

## Worldbuilding vaultu
- ALPHA’da uygulanmıştır ve Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties, World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes ve Manuscript içerir.
- Doğruluk kaynağı yazardır; Nodi yerleşik kanonu önerilerden ayırır.

## Araçlar (Nodus Toolkit)
- Hub Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter ve OCR Workspace içerir. Convert Documents, PDF utilities, light OCR, Images ve Text kategorilerini yerel işler.
- Protect özgün dosyayı değiştirmeden PNG, ZIP veya PDF dışa aktarır; Translate TXT, Markdown, HTML, DOCX, EPUB, PDF ve Zotero eklerini işler; PDF Presenter PowerPoint, LibreOffice ve Keynote içe aktarır; OCR Workspace her sayfayı inceler.
- Convert deterministik ve %100 offline’dır; Protect belgeleri yapay zekâya göndermez. Yalnızca isteğe bağlı Tesseract OCR dil indirmesi ağ kullanır.

## Yerel MCP ve Nodus Server
- MCP Settings > Integrations > MCP Server bölümünde kurulur. Nodus Server bağımsızdır, Settings > Server’dan ayarlanır ve her vault için HTTPS URL ile tek kullanımlık kod kullanır.
- Yayınlanan kopya filtrelenmiş ve dışa giden bir kopyadır; OAuth uzaktan erişimi korur. Server ve ortak paylaşım “Planlandı” durumundadır.

## Yol haritası özet durumu
- Geliştiriliyor: İyileştirme ve kararlılık. Planlandı: Server, vault paylaşımı ve ortak çalışma, iOS ve iPadOS uygulamaları. Uygulandı: Teaching, Primary sources, Testimonies, önerilen vaultlar, Nodus Toolkit, Nodus Translate, PDF Presenter ve OCR Workspace.
- Kesin tarihler yoktur.

## Arayüz protokolü
- Kesin adları ve Güncel görünümü kullanın; mevcut, koşullu, gelecek ve doğrulanmamış olanı ayırın. Kaynak yoksa “Seçilen kaynaklarla bunu doğrulayamıyorum” deyin.
- PRE-ALPHA veya ALPHA’yı gerçek iş için önermeyin; konum veya talimat sorularında kısa adımlar verip “Base: …” ile bitirin.
`,
  de: `# Überprüfbarer interner Leitfaden von Nodus

## Regeln zum Lesen
- Dieser Leitfaden beschreibt die aktuelle Oberfläche und die offizielle Roadmap. Erfinde keine Funktionen, Pfade, Daten, Versionen oder Statusangaben.
- „Implementiert“ bedeutet vorhanden und öffnbar, nicht stabil. Nodus ist local-first und jeder Vault speichert seine Daten auf dem Computer.

## Verfügbare Vaults und Reifegrad
- Unter Vaults > Vault hinzufügen sind Academic, Primary sources, Testimonies, Databases, Teaching, Study, Genealogy, Prosopography und Worldbuilding verfügbar.
- Primary sources, Testimonies und Prosopography sind PRE-ALPHA; Worldbuilding ist ALPHA; Databases, Teaching, Study und Genealogy sind BETA. Academic zeigt keine Phase. Demodaten öffnen den Rundgang nicht.

## Kopfzeile und globale Steuerung
- Rechts stehen allgemein Commands, Assistant, Tools, Vault-Steuerung, Suggest / Report, Theme, Notifications und Settings; Commands verwendet unter macOS ⌘K.
- Das mittige Abzeichen öffnet die Vault-Auswahl. Notifications enthält „Nodus notices“ und „Activity“ und funktioniert auch ohne Nodi.

## Offizielle sichtbare Roadmap
- Sie öffnet sich unter Settings > About Nodus Research > View Nodus Research roadmap oder in der Befehlspalette. Reihenfolge und Status:
__ROADMAP_GUIDE__

## Einstellungen
- Die echten Tabs sind Providers, AI Models, Library, Text and OCR, Interface, Integrations, Server, Tutorials, Backup, About Nodus Research und Updates and news.
- Providers verwaltet Schlüssel und Modelle; Library synchronisiert Zotero; Interface verwaltet Sprache, Thema, Barrierefreiheit, Seitenleiste und Nodi; Server veröffentlicht die gefilterte Vault-Kopie.

## Akademischer Vault
- Er dient Forschung und wissenschaftlichem Schreiben und enthält unter anderem Home, Search, Library, Graph, Argument map, Ideas, Authors, Immersion, Gaps, Debates, Coverage, Hypotheses, Reading path, Deep Research, Writing, Projects, Notes und Settings.
- Deep Research holt Korpusbelege, erstellt einen Bericht und exportiert ihn als Dokument oder PDF mit der Vault-Identität.

## Genealogie-Vault
- Er umfasst People, Timeline, Family tree, Social relations, Map und Archive. Identitäts- und Verwandtschaftsaussagen benötigen Aufzeichnungen oder Belege; ein gemeinsamer Name, eine Adresse oder ein Dokument genügt nicht.

## Datenbank-Vaults
- Sie verwalten strukturierte Tabellen mit typisierten Spalten, Zeilen, Ansichten, Suche, Analyse und Data Chat; eigene Datenbanken erscheinen in der Seitenleiste.

## Lern-Vault
- Die Hierarchie ist Course > Subject mit Ordnern, Themen, Unterthemen, Notizen und Materialien; enthalten sind Schedules, Calendar, Materials, Recordings, Study chat, Ideas, Graph, Question bank und Review.
- Schedules erlaubt Aktivitäten pro Zelle; Calendar bietet Monats-, Wochen- und Jahresansicht sowie iCloud- oder Google-Calendar-Export; Question bank enthält Fragen, Tests, Prüfungen und Flashcards.

## Lehr-Vault
- In BETA implementiert, übernimmt er Course > Subject und ergänzt Gruppen, Materialien, Chat, Rubrics, Exams, Grades und Unit design. Teaching guide / Planning, Learning situations, Adaptations, Notes und Innovation projects bleiben „In design“.

## Vault für Primärquellen
- In PRE-ALPHA für Tests und Zusammenarbeit implementiert; Bereiche sind Search, Archive, People, Timeline, Map, Social relations, Notes, Toolkit und Settings. Archive verwaltet Provenienz und Katalogdaten.
- Automatische Ergebnisse sind Vorschläge zur Prüfung; Transkription, Beobachtung und Schlussfolgerung müssen getrennt sowie Lokatoren, Widersprüche und Unsicherheit erhalten werden.

## Zeugnis-Vault
- In PRE-ALPHA implementiert; Search, Interviews, Participants, Contrasts, Notes, Toolkit und Settings führen Dossiers mit Sitzungen, Medien, Transkriptionen, Fragmenten, Codes, Vereinbarungen und Einschränkungen.
- Nodi achtet auf Zugriff, Anonymisierung, Sperrfrist und Zuschreibung und leitet keine sensiblen Merkmale, Gefühle, Aufrichtigkeit oder Glaubwürdigkeit ab.

## Prosopographie-Vault
- In PRE-ALPHA implementiert; Search, Population, People, Sources, Analysis, Networks, Notes, Toolkit und Settings folgen dem Ablauf Methode, Identität, Zugehörigkeit, Analyse und Netzwerk.
- Person, Erwähnung, Quelle, Factoid und Statement dürfen nicht verwechselt werden; Identitäten werden erst nach Prüfung zusammengeführt.

## Worldbuilding-Vault
- In ALPHA implementiert; er bietet Encyclopedia, Characters, Places, Factions, Cultures, Timeline, Map, Relationships, Families, Dynasties sowie World chat, World rules, Conflicts, Narrative arcs, Continuity, Notes, Scenes und Manuscript.
- Der Autor ist die Wahrheitsquelle; Nodi trennt etablierten Kanon von Vorschlägen.

## Werkzeuge (Nodus Toolkit)
- Der Hub enthält Nodus Convert, Nodus Protect, Nodus Translate, PDF Presenter und OCR Workspace. Convert verarbeitet lokal Documents (PDF, DOCX, EPUB, Markdown, HTML), PDF utilities, light OCR, Images und Text.
- Protect exportiert rasterisierte PNG-, ZIP- oder PDF-Kopien ohne das Original zu ändern. Translate verarbeitet TXT, Markdown, HTML, DOCX, EPUB, PDF und Zotero-Anhänge, bewahrt Struktur und bietet Faksimile. PDF Presenter importiert PowerPoint, LibreOffice und Keynote; OCR Workspace prüft jede Seite.
- Convert ist deterministisch und 100 % offline; Protect sendet keine Dokumente an KI. Nur der optionale Download von Tesseract-OCR-Sprachen benötigt Netzwerk.

## Lokales MCP und Nodus Server
- MCP wird unter Settings > Integrations > MCP Server eingerichtet und folgt dem aktiven Vault. Nodus Server ist unabhängig, steht unter Settings > Server und verwendet je Vault HTTPS-URL und Einmalcode.
- Die veröffentlichte Kopie ist gefiltert und ausgehend; Listener, Port und Token werden nicht mit MCP geteilt. OAuth schützt Fernzugriff. Server und kollaboratives Teilen sind „Geplant“.

## Roadmap-Status zusammengefasst
- In Entwicklung: Feinschliff und Stabilität. Geplant: Server, Vault-Sharing und Zusammenarbeit, iOS- und iPadOS-Apps. Implementiert: Teaching, Primary sources, Testimonies, vorgeschlagene Vaults, Nodus Toolkit, Nodus Translate, PDF Presenter und OCR Workspace.
- Es gibt keine festen Termine.

## Protokoll für die Oberfläche
- Verwende exakte Namen und die aktuelle Ansicht; unterscheide verfügbar, bedingt, zukünftig und ungeprüft. Bei fehlender Quelle sage „Ich kann dies mit den ausgewählten Quellen nicht überprüfen“.
- Mache PRE-ALPHA oder ALPHA nie zur Empfehlung für reale Arbeit; bei Orts- oder Bedienfragen gib kurze Schritte und schließe mit „Base: …“.
`,

};

export function buildNodusDocumentation(language: PromptLanguage = 'es'): string {
  if (language === 'es') return NODUS_DOCUMENTATION;
  const template = language === 'en' ? ENGLISH_DOCUMENTATION : COMPACT_LOCALIZED_DOCUMENTATION[language];
  return template.replace('__ROADMAP_GUIDE__', roadmapGuide(language));
}

/** Alias for consumers that read localized documentation as a getter. */
export const getNodusDocumentation = buildNodusDocumentation;

export const NODUS_DOCUMENTATION_BY_LANGUAGE: Record<PromptLanguage, string> = {
  es: NODUS_DOCUMENTATION,
  en: buildNodusDocumentation('en'),
  fr: buildNodusDocumentation('fr'),
  de: buildNodusDocumentation('de'),
  pt: buildNodusDocumentation('pt'),
  'pt-BR': buildNodusDocumentation('pt-BR'),
  it: buildNodusDocumentation('it'),
  tr: buildNodusDocumentation('tr'),
};
