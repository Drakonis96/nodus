/**
 * Verified product facts used by both the UI and Nodi. Keeping the roadmap here
 * prevents the assistant and the visible modal from drifting apart.
 */
export const NODUS_ROADMAP = [
  { title: 'Pulido y estabilidad', detail: 'Corregir errores, mejorar el rendimiento y pulir la experiencia general con feedback de usuarios.' },
  { title: 'Vault de docencia', detail: 'Preparar clases, cursos y materiales docentes, protegiendo los datos del alumnado.' },
  { title: 'Vault de fuentes primarias', detail: 'Organizar documentos históricos y trabajar con evidencia documental.' },
  { title: 'Vault de testimonios (historia oral)', detail: 'Entrevistas, transcripciones y fuentes orales para historia y periodismo.' },
  { title: 'Vault de worldbuilding', detail: 'Personajes, lugares, cronologías y reglas de mundos narrativos.' },
  { title: 'Servidor', detail: 'Infraestructura opcional para nuevas capacidades conectadas.' },
  { title: 'Compartir vaults y trabajo colaborativo', detail: 'Compartir espacios y colaborar con control sobre los datos.' },
  { title: 'Nodus PDF Presenter', detail: 'Presentar archivos PDF con vista del presentador, control remoto desde el móvil, notas del orador y herramientas de anotación en directo.' },
  { title: 'Nodus OCR Workspace', detail: 'OCR asistido por IA para PDF escaneados e imágenes, con revisión página a página, limpieza de texto, reprocesamiento e integración directa con las bóvedas de Nodus.' },
  { title: 'Otros vaults sugeridos por usuarios', detail: 'Nuevos ámbitos con especialistas, colaboración activa y testers.' },
] as const;

const ROADMAP_GUIDE = NODUS_ROADMAP.map((item, index) => `${index + 1}. ${item.title}: ${item.detail}`).join('\n');

/**
 * Compact product guide grounded only in routes and capabilities present in the
 * current source tree. Planned items live in the explicit roadmap section and
 * must never be described as already available.
 */
export const NODUS_DOCUMENTATION = `# Guía interna verificable de Nodus

## Estado de las fuentes
- Esta guía documenta la interfaz actual y el roadmap oficial visible de la aplicación.
- Un elemento del roadmap es un plan, no una función disponible. No le atribuyas fecha, versión ni estado de desarrollo si no aparece aquí.
- Nodus es local-first: cada bóveda guarda sus datos en el equipo del usuario.
- Las claves de proveedores se configuran en Ajustes > Proveedores. Los modelos favoritos se eligen allí y cada función conserva su propio selector.

## Cabecera y controles globales
- En el extremo derecho de la cabecera están, en este orden general: Bóvedas, Comandos, Asistente, Herramientas, controles condicionales del vault, Sugerir / Reportar, Roadmap, selector de tema claro/oscuro y Ajustes.
- Herramientas abre el hub Nodus Toolkit; está justo después del botón Asistente.
- Roadmap está en la parte superior derecha, antes del selector de tema y del icono de Ajustes.
- El selector de tema claro/oscuro está inmediatamente antes de Ajustes.
- Bóvedas abre el selector para cambiar, crear, renombrar, duplicar, restablecer o eliminar bóvedas según la acción disponible.
- Comandos abre la paleta global; su atajo visible es ⌘K en macOS.
- El botón Asistente de la cabecera abre el asistente de investigación. Nodi es la mascota independiente situada en la zona inferior derecha cuando está habilitada.

## Roadmap oficial visible
El botón Roadmap abre un modal. El orden vigente es:
${ROADMAP_GUIDE}

## Ajustes
- Ajustes es el último elemento de la barra lateral y también tiene un icono en el extremo derecho de la cabecera.
- Sus pestañas reales son: Proveedores, Modelos IA, Biblioteca, Texto y OCR, Interfaz, Integraciones, Sistema y Datos.
- Proveedores: claves API, proveedores locales y modelos favoritos.
- Modelos IA: modelo general y modelos específicos de las distintas tareas.
- Interfaz: idioma, tema, accesibilidad, barra lateral y Mascota Nodi.
- Integraciones: MCP y copiloto de procesadores de texto.
- Sistema: ayuda, tutoriales y actualizaciones.
- Datos: copias, importación, exportación y mantenimiento.
- La visibilidad, ventana flotante y trajes de Nodi están en Ajustes > Interfaz > Mascota Nodi.

## Vault académico
- Se orienta a investigación y escritura académica.
- Puede incluir Inicio, Buscar, Biblioteca, Grafo, Mapa de argumentos, Ideas, Autores, Inmersión, Huecos, Debates, Cobertura, Hipótesis, Ruta de lectura, Deep Research, Escritura, Proyectos, Notas y Ajustes.
- Las secciones pueden ocultarse o reordenarse desde Ajustes > Interfaz > Barra lateral.

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

## Herramientas (Nodus Toolkit)
- Herramientas es una sección de la barra lateral, en su propio grupo, y también tiene un icono en la cabecera. Aparece en todos los tipos de vault.
- Su página principal es un hub con tres tarjetas: Nodus Convert, PDF Presenter y OCR Workspace.
- Nodus Convert ya funciona: convierte y procesa archivos en local, de uno en uno o en lote, en cinco categorías —Documentos (PDF, DOCX, EPUB, Markdown, HTML, texto), utilidades PDF (unir, dividir, rotar, reordenar, extraer imágenes, metadatos, imágenes→PDF), OCR ligero (imagen o PDF escaneado a texto, y PDF buscable), Imágenes (convertir formato incluido HEIC, redimensionar, comprimir) y Texto (limpiar texto pegado de PDF, mayúsculas/minúsculas, subtítulos a texto, checksums).
- PDF Presenter y OCR Workspace son tarjetas marcadas «Próximamente» y todavía no se pueden abrir.
- Nodus Convert es determinista y 100 % offline (no hay IA), nunca modifica el archivo original y no sube nada a ningún servicio; la única llamada de red opcional es la descarga de idiomas de OCR de Tesseract, que el usuario decide.
- Dentro de una herramienta, un botón a la izquierda de su título vuelve al hub de Herramientas.

## Tipos no disponibles todavía
- Fuentes primarias, Testimonios, Worldbuilding y Docencia figuran como tipos futuros; no deben describirse como vaults seleccionables actualmente.
- El roadmap también contempla Servidor, compartir vaults y trabajo colaborativo, y otros vaults sugeridos por usuarios. Nodus Convert ya está disponible dentro de Nodus Toolkit; PDF Presenter y OCR Workspace siguen en desarrollo.

## Protocolo para responder sobre la interfaz
- Usa los nombres exactos de esta guía y, si está seleccionada, la Vista actual.
- No completes lagunas con patrones habituales de otras aplicaciones. No inventes botones, menús, rutas, atajos, versiones, fechas ni estados.
- Si una respuesta no está cubierta, di «No puedo verificarlo con las fuentes seleccionadas» e indica qué contexto ayudaría, sin proponer una ruta inventada.
- Distingue siempre entre disponible, condicional, futuro y no verificado.
- Cuando la pregunta pida una ubicación o instrucciones, ofrece pasos numerados breves y termina con una línea «Base: …» indicando las fuentes usadas.`;
