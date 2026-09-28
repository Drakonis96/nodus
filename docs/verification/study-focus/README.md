# Concentración · Nodus Study

Implementación de escritorio por bóveda. Las capturas usan datos de ejemplo en un perfil temporal; no contienen datos personales del usuario.

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

## Resultado

Verificado en macOS con Electron: comprobación de tipos, compilación de Electron y renderer, 10 casos de integración del servicio con SQLite real y 30 pruebas de regresión. El recorrido de escritorio terminó correctamente, incluida la pausa persistida al cerrar la ventana y la recuperación tras SIGKILL. Axe no encontró incidencias en el panel en claro ni en oscuro.

## Verificación reproducible

```sh
npm run typecheck
npx vite build
node scripts/test-study-focus.mjs
node --test scripts/test-study-ui.mjs scripts/test-window-preloads.mjs scripts/test-study-editor.mjs scripts/test-server-web-study-parity.mjs
node scripts/verify-study-focus-ui.mjs
```

Las pruebas del servicio emplean SQLite real, un reloj monotónico controlado y fechas locales. Cubren los cuatro bloques, descanso largo, transiciones manuales, pausa y reanudación, finalización parcial, operaciones repetidas, cambios de configuración, recuperación hasta el último checkpoint, saltos del reloj, medianoche, días de 23/25 horas, asignaturas, separación por bóveda y rollback transaccional.

La prueba de escritorio utiliza Electron, IPC, SQLite y vistas reales. Comprueba navegación, minimización, el evento de suspensión, cambio de bóveda, teclado, restauración de los paneles del editor, reproducción de audio en el navegador, temas claro/oscuro, ventana estrecha, cierre de ventana y recuperación tras terminar el proceso abruptamente. El informe de axe para el panel está en `accessibility.json`.

La suspensión se prueba emitiendo el evento de Electron; no se suspende físicamente el ordenador. La lectura con un lector de pantalla real y el comportamiento del sistema operativo con notificaciones requieren revisión manual, especialmente fuera de macOS.

## Modo concentración

La casilla «Modo concentración» está marcada por defecto: iniciar o reanudar un bloque de trabajo entra en el modo, y la elección se recuerda si se desmarca. El modo sustituye la barra lateral por un panel propio en vez de esconder la navegación:

- arriba, el bloque en curso (reloj), la asignatura con su objetivo y «Nuevo apunte», y los apuntes y materiales de la asignatura (o los más recientes), con filtro cuando son muchos;
- abajo, por defecto, Cursos y asignaturas, Calendario, Buscar, Materiales, Research chat, Banco de preguntas, Investigación y Browser;
- la salida del modo. Se pliega a iconos y lo hace solo en ventanas estrechas.

Todo es configurable en «Personalizar el modo concentración» (desde el panel, desde la cabecera o desde la paleta): cada bloque superior, cualquier sección de la bóveda y los elementos que conserva la cabecera (controles de medios del navegador, paleta de comandos, tema y cola de tareas). Solo afecta al modo concentración; se guarda por bóveda con el resto de preferencias del temporizador y solo se almacenan las diferencias con los valores por defecto.

En la cabecera de una bóveda de Estudio, junto al tema claro/oscuro, hay un acceso rápido para entrar o salir del modo y otro para sus ajustes. Salir del modo lleva a la página Concentración, pausa el bloque y, si hay una sesión abierta, pregunta si finalizarla o dejarla en pausa. Todo el texto pasa por `t()`/`tx()` y está traducido a los once idiomas; la prueba de escritorio recorre también la interfaz en inglés.

## Detalles de persistencia

La migración aditiva 194 crea `study_focus_state`, `study_focus_sessions` y `study_focus_intervals`; la 195 añade `study_focus_sessions.task`, el objetivo opcional de cada bloque. La asignatura y el objetivo pasan al bloque siguiente, también a través del descanso, hasta que el estudiante los cambia. El estado y cada intervalo se escriben en una transacción. El servicio conserva el tiempo con un reloj monotónico, registra puntos de recuperación cada 15 segundos y recupera siempre en pausa. Los intervalos conservan el día local en que se registraron. Las duraciones parciales se guardan en milisegundos sin redondeo; el redondeo es solo de presentación.

Los cambios de duración afectan al siguiente tramo. Los descansos requieren inicio manual y no aportan minutos de trabajo. La reducción de distracciones tiene estado independiente y no modifica las preferencias del sidebar, los paneles del editor ni la reproducción del navegador. Las métricas no se mezclan con tests ni flashcards y la sección está excluida de la navegación web.
