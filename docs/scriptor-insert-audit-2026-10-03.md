# Auditoría del botón «+» de Nodus Scriptor — 3 de octubre de 2026

## Alcance

Aplicación real de escritorio en macOS y Nodus Server web, usando perfiles y bóvedas de prueba aislados. El sidebar principal no se modifica. Las pruebas ejercitan el menú, sus acciones y el documento persistido; las capturas proceden de la aplicación compilada.

## Correcciones

- El «+» responde en toda su superficie y con Enter. El control original vinculaba la acción al SVG, sin activación correcta desde el botón con teclado.
- Los controles desaparecen inmediatamente al cerrarse. Se evita la copia de HTML inerte que BlockNote conservaba durante la transición, que parecía clicable al desplazar el documento.
- El menú tiene cabecera y pie fijos, resultados con desplazamiento vertical y margen inferior. El último botón permanece completamente visible. La navegación por teclado desplaza los resultados sin desplazar el documento.
- Los márgenes del lienzo reservan espacio para ambos controles en ventanas estrechas. Se conserva la alineación con la primera línea y el sidebar principal real.
- El catálogo y su función de búsqueda tienen identidades estables. No se reconstruyen al actualizar el documento ni al abrir el menú. Buscar ignora mayúsculas y tildes.
- La conversión inicial del documento se memoriza. Las citas y la bibliografía reutilizan su formato CSL mientras la secuencia, fuentes, localizadores, estilo e idioma permanezcan iguales. Insertar un párrafo no vuelve a crear motores CSL.
- El formato CSL tiene una caché semántica acotada también en almacenamiento y exportación. Sus resultados se copian para que un consumidor no pueda alterar la siguiente lectura. Los cambios de fuentes, localizadores, citas, estilo e idioma invalidan el resultado.
- El guardado reutiliza el documento Yjs cargado en la transacción para el historial y la respuesta. Las proyecciones compatibles escriben solamente los rangos, propiedades y textos modificados; no reemplazan todos los bloques con cada edición. Se conservan ambas representaciones para clientes anteriores.
- Las fórmulas insertadas se pueden editar, confirmar con Enter y cancelar con Escape.
- Los adjuntos locales se descargan como archivos desde sus bytes, sin abrir URL `data:` en una ventana de Electron ni usar `fetch(data:)`, bloqueado por la política de conexiones.
- Server permite reproducir audio y vídeo propios, `data:` y `blob:`. Conserva sus restricciones de conexiones, scripts y recursos externos.
- El panel de adjuntos utiliza los mismos colores, tipografía y espaciado del editor. Los errores de subida se conservan hasta reintentar. Una URL multimedia bloqueada por la política de Nodus muestra una explicación sin sustituir el contenido por una vista rota.

## Catálogo completo

Se conservan las 23 entradas de los paquetes base de BlockNote 0.55.0: encabezados 1–6, encabezados plegables 1–3, párrafo, cita, lista plegable, lista numerada, lista con viñetas, lista de tareas, bloque de código, separador, tabla, imagen, vídeo, audio, archivo y emoji.

Nodus añade fórmula en línea, código en línea, plantilla editable de pregunta de test, enlace a Nodus (`[[`), cita bibliográfica, nota al pie y referencia cruzada. Las opciones académicas se ofrecen según las capacidades del canvas; una nota al pie no ofrece la creación de notas anidadas. La pregunta de test es una plantilla editable, sin presentar funciones de evaluación que no existen en el editor.

## Verificación

El script reproducible es `scripts/e2e-scriptor-insert.mjs`. Cada inserción utiliza un documento independiente; compara el JSON nativo, contenido enriquecido, propiedades, jerarquía y metadatos académicos al guardar y reabrir. Incluye edición de tablas, tareas, fórmulas y código, subida y reproducción de medios, descarga con comprobación de bytes, enlaces, citas, notas y referencias cruzadas. También comprueba búsqueda, Escape, deshacer, inserción tras un bloque con texto, errores recuperables e inserción anidada.

La matriz visual usa 1280×800, 1440×900, 1920×1080, 900×700 y 600×500, en claro y oscuro, tanto en escritorio como en web. Las comprobaciones geométricas verifican el último elemento mediante hit testing, los límites del menú y la ausencia de desplazamiento horizontal.

La medición de rendimiento observa el bucle del proceso principal de Electron y el renderer con intervalos de 10 ms, además de las tareas largas del renderer, durante ocho aperturas del «+» en un documento de 300 párrafos y 100 citas con contexto abierto. Incluye las inserciones y su autoguardado. El tiempo completo de las llamadas de Playwright incluye movimiento y espera del ratón; no equivale a la latencia del clic.

### Resultados finales

- **Escritorio: 49 comprobaciones superadas. Web: 48.** Las 30 acciones se insertaron, utilizaron, guardaron y reabrieron con comparación de JSON nativo y metadatos académicos. No hubo errores del renderer en ambas rondas.
- Las 20 combinaciones de tamaño y tema muestran íntegramente el último botón y el pie del menú, sin desplazamiento horizontal. Se revisaron visualmente las capturas del catálogo, final del menú, panel de adjuntos, errores y edición de fórmulas.
- La regresión de controles junto al bloque pasó **224 comprobaciones de alineación**, con **42 capturas adicionales**, en escritorio y web, temas claro/oscuro, tipografías/tamaños y bloques simples, largos, anidados, encabezados, listas, citas, código, tablas y medios. El «+» y el menú de arrastre siguen funcionando.
- La prueba de rendimiento inicialmente reprodujo una pausa máxima de **453 ms** en el proceso principal durante el guardado. Tras las correcciones, la ronda completa dio **197 ms** en el proceso principal y **150 ms** en el renderer; la ronda independiente dio **216 ms** y **183 ms**, respectivamente. No se observaron bloqueos prolongados en las operaciones medidas. Las tareas largas del renderer duraron como máximo 70 ms.
- Compilaciones de escritorio, Server web y módulos compartidos del servidor: correctas. Typecheck de renderer y Electron: correcto.
- Pruebas de almacenamiento nativo, páginas universales, historial de páginas, flujo académico/CSL/exportaciones, catálogo de referencias y seguridad del servidor: correctas. La regresión académica real incluye citas en notas, actualización de fuentes, cancelación, PDF, DOCX, LaTeX, reapertura y temas/tamaños.
- La regresión académica utilizaba una espera de Playwright con un predicado asíncrono que se resolvía antes del autoguardado. Se sustituyó por sondeo explícito del estado persistido; la prueba final verifica conjuntamente fuente actualizada en el cuerpo y en la nota. No fue necesario cambiar la sincronización académica de la aplicación.

Los resultados consolidados están en `output/qa/scriptor-insert/audit-results.json`. Las mediciones incluyen el guardado de las inserciones, no solamente la aparición de un menú vacío.

## Límites comprobados

El menú se dibuja necesariamente en el renderer. La apertura no inicia IA, lectura del catálogo de referencias, subidas ni llamadas IPC de búsqueda de bloques. Insertar contenido sí activa el guardado habitual del documento.

La política existente de Nodus limita las URL multimedia remotas. El panel permite adjuntos locales y recursos admitidos por esa política, e indica cuándo se debe subir el archivo. No se amplía el acceso de red del resto de la aplicación. El límite existente de subida es de 2 MB por archivo.

La ausencia de bloqueos debe interpretarse para el equipo, documento y operaciones medidos; no garantiza que macOS nunca muestre la rueda de espera por otra causa.

## Evidencia

Capturas y resultados: `output/qa/scriptor-insert/`. La galería final es `index.html`; los registros de compilación, typecheck, seguridad, almacenamiento, referencias y regresión académica se guardan junto a ella.

La aplicación de prueba actualizada queda abierta. Antes de reiniciarla se guardó y leyó el estado vigente de la nota del usuario; después se compararon sus 34 bloques nativos, metadatos, estilo, enlaces, anotaciones y versiones. Se conservaron sus 20 prompts, la revisión 39 y sus preferencias de paneles. La comprobación está en `preview-verification.json` y la captura es `preview-final.png`.

## Seguimiento: apertura inmediata, búsqueda visible y tooltips

La [revisión posterior](scriptor-insert-search-2026-10-03.md) sustituye la apertura con inserción inmediata por una apertura de sólo lectura y un controlador local síncrono. Añade un buscador visible y elimina los tooltips paralelos. Las mediciones posteriores separan el clic hasta el primer frame visible de las llamadas completas de Playwright; los resultados de esta auditoría inicial se conservan como registro histórico. La evidencia vigente de este seguimiento está en `output/qa/scriptor-insert/search-audit-results.json` y `search-index.html`.
