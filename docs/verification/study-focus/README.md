# Nodus Focus · herramienta transversal

Verificación en macOS de la herramienta de escritorio compartida entre las nueve clases de bóveda. Las capturas usan datos de ejemplo en un perfil temporal; no contienen datos personales del usuario.

## Capturas

- `01-empty-light.png`: primera sesión y meta opcional.
- `02-dashboard-light.png`: temporizador, hoy, objetivo y evolución.
- `03-history-light.png`: calendario de 12 semanas y sesiones recientes.
- `04-header-panel.png`: panel compacto y configuración.
- `05-editor-focus.png`: modo concentración con un apunte abierto desde el panel lateral.
- `06-dashboard-dark.png`: tema oscuro y sesión pausada.
- `07-narrow-dark.png`: disposición en ventana estrecha.
- `08-focus-rail-notes.png`: el panel de concentración lleva a Notas (espacio de trabajo) sin salir del modo.
- `09-focus-browser-media.png`: navegador abierto desde el panel y controles de medios en la cabecera.
- `10-narrow-rail-dark.png`: en ventana estrecha el panel se pliega a iconos.
- `11-focus-layout-dialog.png`: ajustes del modo concentración (qué bloques, secciones y elementos de cabecera se ven).
- `12-focus-exit-question.png`: al salir del modo, el bloque queda en pausa y se pregunta si finalizar la sesión.
- `13-header-focus-panel.png`: el botón de concentración de la cabecera abre el panel del temporizador, con la casilla del modo y sus ajustes dentro.

El recorrido `transverse.json` registra una misma sesión en marcha al atravesar los nueve tipos. Sus capturas muestran las secciones y colores propios de cada bóveda:

| Bóveda | Captura |
| --- | --- |
| Estudio | [Panel con asignatura y apuntes](transverse-estudio-light.png) |
| Académica | [Panel de investigación](transverse-academic-light.png) |
| Fuentes primarias | [Panel documental](transverse-primary_sources-light.png) |
| Genealogía | [Panel genealógico](transverse-genealogy-light.png) |
| Prosopografía | [Panel de población y fuentes](transverse-prosopography-light.png) |
| Bases de datos | [Panel con creación y apertura de bases](transverse-databases-light.png) |
| Testimonios | [Panel de entrevistas](transverse-testimonios-light.png) |
| Worldbuilding | [Panel de creación de mundos](transverse-worldbuilding-light.png) |
| Docencia | [Panel de organización y evaluación](transverse-docencia-light.png) |

[El catálogo](transverse-catalog.png) muestra Nodus Focus fijado por defecto. Se comprobó que desfijarlo elimina su único atajo y que la tarjeta sigue abriendo la herramienta.

[La personalización académica](transverse-layout-academic.png) muestra una configuración propia que oculta Biblioteca, Browser y el control de tema, y añade Nodus Tools. El recorrido guarda una selección distinta en cada tipo, vuelve a todas las bóvedas y verifica las casillas, los bloques y la cabecera. Dos bóvedas de Estudio conservan elecciones independientes. El diálogo abierto se adapta al cambiar de contexto.

## Resultado

Verificado el 3 de octubre de 2026: comprobación de tipos, ESLint del repositorio, compilación completa, 20 casos de integración con SQLite real, copia y restauración del perfil Focus, 132 pruebas relacionadas de regresión, editor y cobertura de idiomas y la prueba general de extremo a extremo (`npm run test:e2e`). Todas pasaron. El recorrido general tampoco registró errores del renderer.

El recorrido de Electron terminó correctamente: una sesión conserva identidad, fase, duración, objetivo y estado en marcha entre los nueve tipos. El desglose por bóveda suma exactamente el tiempo de la sesión. También se comprobaron el cambio fallido, la desactivación manual entre bóvedas, la ventana del temporizador abierta durante el cambio, la pausa persistida al cerrar y la recuperación tras SIGKILL. Las capturas se revisaron visualmente. Axe no encontró incidencias en el panel en claro ni en oscuro.

## Verificación reproducible

```sh
npm run lint
npm run build
node scripts/test-study-focus.mjs
node scripts/test-focus-backup.mjs
node --test scripts/test-toolkit-ui.mjs scripts/test-toolkit-localization.mjs scripts/test-sidebar-vault-filtering.mjs scripts/test-vault-types.mjs scripts/test-study-ui.mjs scripts/test-server-web-study-parity.mjs scripts/test-window-preloads.mjs scripts/test-backup-vaults.mjs scripts/test-backup-file-streaming.mjs scripts/test-study-editor.mjs scripts/test-i18n-coverage.mjs scripts/test-i18n-no-duplicate-keys.mjs
node --test scripts/test-study-editor.mjs scripts/test-toolkit-docs.mjs
node scripts/verify-study-focus-ui.mjs
npm run test:e2e
```

Las pruebas del servicio emplean SQLite real, un reloj monotónico controlado y fechas locales. Cubren los cuatro bloques, descanso largo, transiciones manuales, pausa y reanudación, finalización parcial, operaciones repetidas, cambios de configuración, recuperación hasta el último checkpoint, saltos del reloj, medianoche, días de 23/25 horas y asignaturas. Añaden atribución exacta entre bóvedas, cambio durante pausa o descanso, personalización local con preferencias globales, procedencia de la asignatura, migración idempotente con identificadores coincidentes y rollback transaccional.

La prueba de escritorio utiliza Electron, IPC, SQLite y vistas reales. Comprueba navegación, minimización, el evento de suspensión, cambio de bóveda, teclado, creación de apuntes y bases de datos, restauración de los paneles del editor, reproducción de audio en el navegador, temas claro/oscuro, ventana estrecha, catálogo, cierre de ventana y recuperación tras terminar el proceso abruptamente. El informe de axe para el panel está en `accessibility.json`.

La suspensión se prueba emitiendo el evento de Electron; no se suspende físicamente el ordenador. La lectura con un lector de pantalla real y el comportamiento del sistema operativo con notificaciones requieren revisión manual, especialmente fuera de macOS.

## Modo concentración

Nodus Focus aparece en Nodus Tools y en el grupo Herramientas por defecto. La casilla «Modo concentración» está marcada por defecto: iniciar o reanudar un bloque de trabajo entra en el modo. Desmarcarla conserva la elección global hasta que se vuelva a activar.

El modo sustituye la barra lateral por un panel propio. En Estudio mantiene:

- arriba, el bloque en curso (reloj), la asignatura con su objetivo y «Nuevo apunte», y los apuntes y materiales de la asignatura (o los más recientes), con filtro cuando son muchos;
- abajo, por defecto, Cursos y asignaturas, Calendario, Buscar, Materiales, Research chat, Banco de preguntas, Investigación y Browser;
- la salida del modo. Se pliega a iconos y lo hace solo en ventanas estrechas.

En Docencia conserva asignaturas y materiales y ofrece sus secciones de organización y evaluación. En las otras bóvedas muestra el objetivo del bloque y las secciones propias del contexto, sin selectores de asignatura ni estantes de Estudio. Bases de datos mantiene la creación y apertura de tablas. La personalización y el orden de las secciones se adaptan a la nueva bóveda al cambiar, sin detener el temporizador ni salir del modo.

Los valores iniciales usan un conjunto acotado de secciones relevantes, independiente del menú normal. Todas las otras secciones permitidas se pueden añadir desde Personalizar; «Mostrar todo» y «Restablecer» funcionan sobre esta elección local.

| Tipo | Secciones iniciales |
| --- | --- |
| Académica | Buscar, Biblioteca, Grafo, Ideas, Estado de la cuestión, Research chat, Deep Research, Espacio de trabajo y Browser |
| Genealogía | Buscar, Biblioteca, Personas, Árbol, Archivo, Línea temporal, Mapa, Relaciones, Research chat, Notas y Browser |
| Fuentes primarias | Buscar, Biblioteca, Archivo, Personas, Cronología, Mapa, Relaciones, Research chat, Notas y Browser |
| Prosopografía | Biblioteca, Buscar, Población, Personas, Fuentes, Análisis, Redes, Research chat, Notas y Browser |
| Bases de datos | Biblioteca, Páginas, Buscar, Análisis, Research chat, Deep Research, Notas, Browser, creación y apertura de las bases propias |
| Testimonios | Buscar, Biblioteca, Entrevistas, Participantes, Contrastes, Research chat, Notas y Browser |
| Worldbuilding | Biblioteca, Enciclopedia, Personajes, Lugares, Cronología, Mapa, Research chat, Continuidad, Notas, Escenas, Manuscrito y Browser |
| Estudio | Cursos y asignaturas, Calendario, Buscar, Materiales, Research chat, Banco de preguntas, Investigación y Browser |
| Docencia | Biblioteca, Cursos/asignaturas/grupos, Horarios, Calendario, Materiales, Grupos, Banco de preguntas, Exámenes, Rúbricas, Diseño de unidades, Espacio de trabajo y Browser |

Todo es configurable en «Personalizar el modo concentración» (desde el panel, desde la cabecera o desde la paleta): cada bloque superior, cualquier sección de la bóveda y los elementos que conserva la cabecera (controles de medios del navegador, paleta de comandos, tema y cola de tareas). Solo afecta al modo concentración; la disposición se guarda por bóveda y solo se almacenan las diferencias con los valores por defecto. Duraciones, meta, sonido y activación automática son preferencias globales.

En la cabecera de todas las bóvedas hay un botón de concentración (resaltado mientras el modo está activo) que abre el panel del temporizador: dentro están la casilla del modo y el botón de ajustes. Salir del modo lleva a Nodus Focus, pausa el bloque y, si hay una sesión abierta, pregunta si finalizarla o dejarla en pausa. Finalizar la sesión, desde donde sea, devuelve siempre a la vista normal.

El contador solo existe mientras hay una sesión abierta. Fuera del modo aparece en la mitad izquierda de la cabecera, centrado entre el logo y el centro; dentro del modo el reloj está en el panel lateral. La parte derecha de la cabecera solo lleva el icono de concentración. Todo el texto pasa por `t()`/`tx()` y está traducido a los once idiomas; la prueba de escritorio recorre también la interfaz en inglés.

## Detalles de persistencia

El servicio único usa `userData/focus/focus.sqlite`, independiente de la conexión de la bóveda. Reutiliza las tablas `study_focus_state`, `study_focus_sessions` y `study_focus_intervals` con procedencia de bóveda, un registro de disposiciones por bóveda y claves de importación de intervalos históricos. Importa los datos de las bóvedas antiguas con conexiones de solo lectura y conserva las fuentes intactas. Los identificadores se distinguen por bóveda; reintentar la importación no duplica el historial. Solo se recupera una sesión abierta como estado global.

La asignatura conserva su procedencia durante el bloque. Al comenzar otro bloque desde otra bóveda se descarta una asignatura ajena. El objetivo sigue disponible. El historial es global y sus sesiones muestran el tiempo de cada bóveda; un bloque completado se cuenta una sola vez en la bóveda donde termina.

El estado y cada intervalo se escriben en una transacción. El servicio conserva el tiempo con un reloj monotónico, registra puntos de recuperación cada 15 segundos y recupera siempre en pausa. Los intervalos conservan el día local en que se registraron. Las duraciones parciales se guardan en milisegundos sin redondeo; el redondeo es solo de presentación.

Las copias que incluyen historiales incorporan `aux/global/focus.sqlite` mediante la API de copia de SQLite, sin pausar la sesión en curso. La restauración valida el archivo antes de sustituirlo y recupera un estado en marcha como pausado. La regresión de copias cifradas completas comprueba también preferencias y disposiciones de Focus.

El historial compartido, incluida la procedencia de las asignaturas, permanece en el perfil local. Este cambio no añade peticiones de red, envío a IA ni sincronización de datos de Focus. Las pruebas y capturas usan exclusivamente perfiles desechables y contenido sintético.

Los cambios de duración afectan al siguiente tramo. Los descansos requieren inicio manual y no aportan minutos de trabajo. La reducción de distracciones tiene estado independiente y no modifica las preferencias del sidebar, los paneles del editor ni la reproducción del navegador. Las métricas no se mezclan con tests ni flashcards y la sección está excluida de la navegación web.
