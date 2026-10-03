# Nodus Scriptor: flujo académico y entrega

## Resultado

Scriptor conecta las fuentes de la biblioteca y las ideas del análisis con un documento editable, un manuscrito compuesto y una entrega académica. Mantiene el lienzo blanco, el ancho de lectura, la cabecera estable y los paneles locales plegables. Las funciones académicas aparecen en «…», en el menú de bloques y en el inspector; no añaden una barra permanente ni modifican el sidebar principal.

Los enlaces `[[` sirven para navegar a ideas, autores, obras y documentos. Las citas académicas son elementos distintos, con datos bibliográficos y localizadores, procesados mediante CSL. Esta separación permite conservar los enlaces de investigación y producir una bibliografía formal.

## Funciones

- Citas de una o varias fuentes de la bóveda o de la biblioteca global, con datos estructurados, localizador, prefijo, sufijo y omisión del autor. Los datos quedan incluidos en la cita para que su lectura no dependa de que otro usuario posea la fuente.
- APA, Vancouver, Harvard, Chicago autor-fecha y Chicago notas; importación de un estilo CSL independiente de revista. Un único procesador formatea el manuscrito completo, incluidos sus capítulos y notas, con desambiguación y deduplicación por DOI.
- Notas al pie y al final con contenido enriquecido y citas. Su edición conserva un borrador hasta pulsar Guardar; cerrar el diálogo lo descarta. Actualizar una fuente conserva los identificadores y sincroniza sus citas dentro del documento y sus notas. Si distintos capítulos tienen datos contradictorios de una fuente, la preparación lo señala para resolverlo explícitamente.
- Pies de figura, títulos de tabla y referencias cruzadas a secciones, figuras y tablas, también entre los documentos incluidos en un manuscrito. Los destinos usan identificadores de bloque y documento; la numeración de la entrega se calcula sobre el conjunto ordenado.
- Marcas de evidencia vinculadas a ideas, pasajes u obras, con página impresa y página física independientes. «Comprobado por mí» registra la comprobación del investigador y se invalida si cambia el texto, el destino o la página. Las comprobaciones técnicas no sustituyen esa revisión de las fuentes.
- Manuscritos de artículo, capítulo o tesis: autoría, resumen, palabras clave, índice, A4/Letter y márgenes. Los capítulos son referencias a los documentos originales, no copias divergentes; se pueden ordenar, incluir o excluir. El texto del documento principal también se incluye cuando existe.
- Preparar entrega guarda primero, comprueba el conjunto de capítulos y genera una vista previa. Los errores bloquean la entrega; las advertencias requieren aceptación explícita. Cambiar el formato retira la vista previa y la descarga anteriores.
- Word con estructura nativa, notas, tablas, imágenes, fórmulas OMML, marcadores, índice y números de página; PDF paginado con notas al pie e índice; paquete LaTeX para LuaLaTeX con capítulos, recursos, citas ya formateadas por CSL y bibliografía BibTeX reutilizable.

No se incorpora un flujo de revisores externos ni de correcciones de terceros, conforme al alcance acordado.

## Datos y compatibilidad

El JSON de BlockNote sigue siendo la fuente de verdad. `shared/academicDocument.ts` define un esquema académico separado, con versión propia. Los identificadores, el contenido enriquecido, las citas y sus datos se guardan junto a los metadatos académicos y las versiones:

- Notas: estado persistido Yjs de su página, snapshots e historial; actualización compatible del caché de notas y de los bloques universales.
- Estudio y Docencia: documento y versiones mediante una migración aditiva.
- Web: metadatos del artefacto privado, revisión esperada e historial de versiones.

El Markdown contiene una proyección legible de las citas, notas y bibliografía, con marcadores de compatibilidad que conservan los elementos nativos. Los consumidores anteriores pueden editar el texto ordinario. Una modificación que elimine accidentalmente elementos académicos o altere la sección generada se rechaza y conserva el borrador; no se descarta silenciosamente información. Los documentos anteriores se convierten en memoria al abrirlos y no se normalizan en disco hasta que existe una edición. También se conserva la proyección Markdown ya establecida de las notas que tenían JSON nativo antes de esta integración académica; la nueva proyección se activa al editarlas, evitando cambios de espaciado al abrir.

Las exportaciones capturan un snapshot de los documentos originales con sus revisiones y no los modifican. El paquete LaTeX incluye un manifiesto y el JSON nativo utilizado. Las fórmulas se renderizan sin recursos de red; la exportación PDF utiliza una ventana aislada en escritorio y Chromium en servidor.

## Permisos y recursos

En web, las fuentes disponibles proceden del corpus publicado autorizado. Los capítulos privados se resuelven por propietario y bóveda; no se incorporan al catálogo publicado. La entrega exige sesión, CSRF y revisión válida. El contenido publicado mantiene lectura exclusiva y no ofrece acciones de edición académica ni llamadas a Electron.

La entrega comprueba que los recursos pueden incorporarse. Se verifican imágenes PNG/JPEG embebidas y blobs locales de Nodus. Los recursos remotos o no disponibles y los bloques de compatibilidad que aún no pueden exportarse provocan una incidencia explícita; siguen conservados en el documento. Word actualiza los campos de índice al abrir el archivo. LaTeX requiere LuaLaTeX y dos pasadas; no se necesita BibTeX para reproducir el formato CSL, aunque el archivo `.bib` permite reutilizar los datos.

## Verificación

Los registros de esta implementación están en `output/academic-*.log`. Las capturas y los archivos realmente renderizados están en `output/qa/academic-scriptor`; la matriz de bóvedas, catálogo, foco y conflictos en `output/qa/editorial-workspace`, y la revisión de prompts, selección, streaming y deshacer en `output/qa/scriptor-polish`.

Las pruebas pertinentes cubren persistencia y restauración de JSON/metadatos, cambios sólo de formato, proyección compatible, citas CSL, identificación de evidencia, clonación, Word/OMML y notas, LaTeX/BibTeX, revisión esperada, aislamiento de usuarios y capítulos entre bóvedas. Las campañas E2E utilizan Electron y un servidor real con Chromium. El stream de IA se controla en las pruebas para comprobar cancelación y deshacer sin llamar a un proveedor externo.

La revisión visual compara las seis maquetas originales con el área de contenido implementada. Se respetan la decisión posterior de fondo blanco y el sidebar real de Nodus. Incluye 1280×800, 1440×900 y 1920×1080, temas claro y oscuro, catálogo en lista/tarjetas, contexto, navegador, foco, menús y nuevos diálogos. Word se renderiza mediante LibreOffice y LaTeX se compila realmente mediante un toolchain aislado de QA; ese toolchain no forma parte de la aplicación distribuida.

BlockNote 0.55.0 y las dependencias de exportación están incorporados a `THIRD_PARTY_NOTICES.md`, al inventario completo de licencias y a los avisos del servidor. La verificación registra 689 paquetes de producción, 368 grupos de avisos y 83 fuentes upstream fijadas, además de los avisos de Electron/Chromium.

Galerías: [flujo académico](../output/qa/academic-scriptor/index.html), [catálogo y matriz](../output/qa/editorial-workspace/index.html), [pulido del editor](../output/qa/scriptor-polish/index.html).

## Cierre de la verificación

- Typecheck y builds de escritorio/web completados. Las pruebas nativas, de referencias, de Office y del servidor han pasado.
- Campañas académicas Electron/web completadas: insertar y editar citas y notas, cancelar borradores de notas, importar CSL, reunir capítulos originales, preparar entregas reales y reabrir con JSON/metadatos idénticos. Cambiar el formato retira la entrega anterior.
- Matrices de ocho bóvedas de escritorio y web completadas; prompts, streaming, cancelación, deshacer, foco, permisos, conflictos y lectores publicados comprobados.
- Capturas académicas del renderer real con viewport comprobado de 1280×800, 1440×900 y 1920×1080. Revisados ambos temas, inspector, diálogos y los archivos Word/PDF/LaTeX renderizados. Se corrigieron la duplicación del índice PDF, sus páginas y la herencia de negrita de los encabezados Word.
- La reapertura del documento del usuario detectó una normalización de espaciado al leer notas nativas anteriores. Se corrigió el adaptador y se añadió una prueba de regresión. La aplicación queda abierta con el JSON nativo, Markdown, título, estilos, comentarios, enlaces, diccionario e identificadores de versiones originales verificados sin cambios.

Auditoría visual final ampliada: [informe del 3 de octubre](scriptor-final-visual-audit-2026-10-03.md), con correcciones verificadas y 146 capturas en escritorio y web.
