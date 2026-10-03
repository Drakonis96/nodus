# Scriptor · Apertura de «+», búsqueda y tooltips

## Cambio

El botón «+» abre un catálogo local ya preparado. La apertura no inserta párrafos, no calcula proyecciones del documento y no inicia guardado, IA, subida ni búsquedas por IPC. El párrafo de destino se crea sólo cuando se elige una acción. Cerrar el menú sin elegir una opción conserva el documento y su revisión, incluso sobre un bloque con texto, tabla o imagen.

La barra de búsqueda permanece visible entre la cabecera y los resultados. Filtra títulos y alias, ignora mayúsculas y tildes, permite borrar la consulta y muestra un estado vacío. Su texto no forma parte del documento. Las flechas, PageUp/PageDown para saltar al principio/final de la lista, Enter y Escape permiten operar el menú sin desplazar el lienzo. La escritura con `/` sigue usando la detección y los rangos de BlockNote; al elegir una opción se elimina únicamente su consulta.

Se mantienen las 23 entradas originales de BlockNote y las 7 acciones de Nodus. La cabecera, búsqueda y pie quedan fuera del scroll de resultados. El menú conserva los límites del viewport y el último botón completo en ambos temas.

La barra de acciones utiliza una sola vía de tooltips, mediante el `title` que ya gestiona Nodus. Se elimina el portal paralelo que mostraba otro tooltip para el mismo botón. Los controles de formato de BlockNote conservan su tooltip Ariakit; los controles propios y las chinchetas usan el tooltip habitual de la aplicación. Se mantienen nombres accesibles, atajos y conservación de selección.

## Verificación reproducible

- `node scripts/e2e-scriptor-insert.mjs --desktop --skip-stress`
- `node scripts/e2e-scriptor-insert.mjs --desktop --stress-only`
- `node scripts/e2e-scriptor-insert.mjs --web`
- `node scripts/e2e-scriptor-insert.mjs --web --search-only`
- `node scripts/e2e-scriptor-actions.mjs`
- `node --test scripts/test-tooltip-layer.mjs scripts/test-topbar-native-tooltips.mjs scripts/test-workspace-ui.mjs scripts/test-study-improve-ui.mjs`
- Typecheck del renderer y compilaciones de escritorio y Server web.

La prueba del menú compara JSON nativo y metadatos después de guardar y reabrir cada opción. Comprueba búsqueda visible, alias con tildes, foco, borrado, estado sin resultados, cancelación sin guardado, consulta nativa `/`, inserción tras bloques con texto y bloques no textuales, jerarquía, deshacer y errores recuperables de adjuntos.

La medición de escritorio registra ocho clics en un documento de 300 párrafos y 100 citas con el contexto abierto. Mide el primer frame en que el menú tiene dimensiones y visibilidad, los intervalos de ambos bucles de eventos y las tareas largas del renderer. El tiempo total de las llamadas Playwright incluye movimiento del ratón y esperas de automatización; se registra aparte.

Las capturas usan 1280×800, 1440×900, 1920×1080, 900×700 y 600×500, en claro y oscuro. Se comprueban límites, ausencia de scroll horizontal y visibilidad/clicabilidad completa del último elemento. La revisión visual incluye búsqueda normal, consulta sin resultados, ambos temas, controles fijados y tooltip único.

## Resultados

- **52 comprobaciones de escritorio, 51 de web y una prueba de rendimiento:** 104 comprobaciones superadas, sin errores del renderer. Las 30 acciones se insertaron, utilizaron, guardaron y reabrieron con comparación de JSON nativo y metadatos académicos.
- **15 comprobaciones adicionales de búsqueda y límites en web**, después de corregir el foco del campo para evitar dos bordes superpuestos.
- **18 pruebas unitarias y de contratos de interfaz** superadas. Typecheck del renderer y compilaciones finales del renderer de escritorio y Server web correctos.
- La regresión de acciones y selección comprueba un único tooltip al pasar el cursor por los controles de formato, las acciones esenciales, las chinchetas y los botones fijados. Incluye foco por teclado, selección exacta, streaming controlado, deshacer en una operación, persistencia de chinchetas y límites visuales en cinco tamaños y ambos temas.
- En ocho aperturas sobre **300 párrafos y 100 citas**, el primer frame visible aparece entre **35,3 y 41,3 ms** después del clic. El intervalo máximo observado del proceso principal es **63,8 ms** y el del renderer **64,3 ms**; la tarea larga mayor dura 59 ms. Abrir y cerrar el menú no cambia el JSON ni la revisión. Estas cifras corresponden al documento y equipo medidos.
- Revisión visual final del campo de búsqueda, estado vacío, límites y último botón, tema oscuro, acciones esenciales y formato contextual. Se amplía el límite de la barra contextual de 780 a 820 px para evitar que su último control quede aislado en otra fila a 1440 px; sigue adaptándose a ventanas estrechas.
- La ventana de prueba del usuario se actualizó mediante recarga del renderer y queda abierta. Se compararon sus **34 bloques, revisión 39, versiones, metadatos, estilos, anotaciones, enlaces y 20 prompts** antes y después. La apertura, búsqueda, selección y tooltips de la revisión final no modificaron el documento ni sus preferencias del sidebar.

## Evidencia

[Galería final de inserción y búsqueda](../output/qa/scriptor-insert/search-index.html). [Galería de acciones y selección](../output/qa/scriptor-actions/index.html). Los logs, resultados y mediciones están junto a las capturas.

Resultados consolidados: `output/qa/scriptor-insert/search-audit-results.json`. Comprobación de la ventana conservada: `preview-search-verification.json`.
