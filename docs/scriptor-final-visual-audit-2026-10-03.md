# Auditoría visual final de Nodus Scriptor · 3 de octubre de 2026

## Criterio de diseño

Se comparó el área de contenido real con las seis maquetas originales de `output/design/writing-workspace-2026-10-02`, respetando las decisiones posteriores: fondo blanco, nombre Nodus Scriptor y acceso desde Herramientas. El sidebar principal conserva sus componentes y estilos. El modo Foco oculta temporalmente la navegación y permite recuperarla.

La revisión comprueba jerarquía editorial, legibilidad, espacios, densidad, orden de acciones y estabilidad de la cabecera. Las funciones académicas permanecen en el menú del documento, en controles contextuales o en el inspector. No se añade una barra permanente de herramientas.

## Defectos encontrados y corregidos

| Hallazgo | Corrección y comprobación |
| --- | --- |
| Acciones de diálogos largos fuera de la vista | Pie fijo independiente del cuerpo desplazable; acciones visibles y comprobadas mediante el elemento que recibe el clic. |
| Selectores con flechas repetidas en web | Estilos acotados al diálogo académico con una única flecha nativa; comprobación del estilo calculado y nueva captura. |
| Tarjetas desproporcionadas con títulos largos | Contenido alineado arriba, título limitado a tres líneas y fragmento ajustado al ancho. |
| Datos internos de las citas visibles en fragmentos web | Se retiran los comentarios de compatibilidad y las definiciones de notas de los fragmentos del catálogo, conservando el documento original. |
| Menú del documento tapando la vista recién abierta | Las acciones cierran el menú antes de abrir búsqueda, voz u otras vistas. |
| Escape descartando el borrador de una nota al cerrar `/` | Se respeta el evento consumido por BlockNote; el menú se cierra y la nota continúa abierta. |
| Campos de manuscrito con etiquetas ambiguas al reabrir | Etiquetas accesibles explícitas; autoría, resumen y palabras clave se localizan con valores persistidos. |
| Vistas secundarias del inspector sin estado claro | Dos filas discretas, estado seleccionado y subrayado del destino activo. |
| Comentarios y referencias cruzadas vacíos sin explicación | Mensajes breves con el siguiente paso; comentarios ofrece una acción directa. |
| Texto secundario demasiado tenue y controles de voz con fondos ajenos al lienzo | Contraste mejorado y colores acotados al editor, con equivalencia oscura. |
| Prompts nuevos mostrando una advertencia antes de escribir | La advertencia se muestra cuando existe texto; el control de favorito permanece secundario. |
| Numeración conjunta de figuras y tablas en el inspector | Contadores independientes por tipo, como en la entrega. |

## Superficies revisadas

- Escritorio Electron y web servida por un servidor real, en 1280×800, 1440×900 y 1920×1080; comprobación adicional a 1000 px para paneles superpuestos.
- Catálogo en lista y tarjetas: títulos largos, colecciones anidadas, crear, filtros, etiquetas, selección múltiple, menú cerca del borde y estados vacíos.
- Lienzo editorial, pestañas múltiples, navegador, inspector y Foco; cabecera de 56 px sin cambios de posición ni desplazamiento horizontal. Paneles locales de 300/320 px, adaptados al ancho disponible.
- Fuentes, comentarios, detalles, estructura, comprobaciones, esquema, historial y asistente. Temas claro y oscuro, bibliografía, evidencia pendiente y comentario real anclado a un bloque.
- Citas con datos bibliográficos expandidos, notas al pie con formato y menú `/`, referencias cruzadas, evidencia, manuscrito y preparación de entrega. Botones primarios pequeños, pie visible y teclado contenido dentro del diálogo.
- Búsqueda y reemplazo con cierre directo, Markdown, vista dividida, dictado y lectura en reposo, biblioteca de prompts y creación de prompts.
- Selección de texto, prompts guardados, corrección en streaming, cancelación y deshacer. El transporte de IA se controla en las pruebas; no se llama a un proveedor externo.
- Manuscrito con fuente CSL, figura, tabla, fórmula, nota, referencia cruzada y capítulo original. Vista previa real y entregas Word/PDF/LaTeX. Error de importación CSL mostrado sin alterar el estilo válido.
- Matriz de bóvedas, ideas manuales, documentos de Estudio/Docencia, contenido publicado de sólo lectura y conflictos entre sesiones.

El lienzo claro usa `#ffffff`; los documentos nuevos mantienen serif de sistema, 18 px, interlineado 1,75 y ancho máximo de 820 px. Se respetan los estilos persistidos de cada documento. Los avisos de IA se presentan como una tarjeta blanca compacta dentro de la columna de escritura.

## Evidencia y reproducción

[Galería final](../output/qa/scriptor-final-visual/index.html), [resultados de escritorio](../output/qa/scriptor-final-visual/results.json) y [resultados web](../output/qa/scriptor-final-visual/web-results.json). Las capturas se inspeccionaron visualmente, además de verificar geometría, ausencia de desbordamientos, posición de las pestañas y accesibilidad de los botones.

- `node scripts/audit-scriptor-visual.mjs`
- `node scripts/audit-scriptor-web-visual.mjs`
- `node scripts/e2e-scriptor-polish.mjs`
- `node scripts/e2e-academic-scriptor.mjs`
- `node scripts/e2e-editorial-workspace.mjs`
- `node scripts/e2e-editorial-server-web.mjs`
- `npm run typecheck`, `npx vite build`, `npm run build:server-web`

Registros en `output/scriptor-visual-*.log`. Las galerías complementarias de [interacciones](../output/qa/scriptor-polish/index.html) y [matriz de bóvedas y conflictos](../output/qa/editorial-workspace/index.html) contienen los estados adicionales.

## Cierre

Las dos campañas visuales finales completaron 83 capturas de escritorio y 27 de web, sin errores de renderer ni desbordamientos en las superficies comprobadas. La galería reúne 146 capturas: las 110 de esta matriz, 11 de interacciones y 25 de bóvedas, documentos especializados y conflictos.

Typecheck, builds de escritorio/web, campañas académicas, prompts/streaming/deshacer y ambas matrices de bóvedas han pasado. Se volvieron a inspeccionar las capturas de los defectos corregidos, incluida la vista previa de entrega cargada y los selectores web. No quedan defectos visuales conocidos en los estados revisados.

La aplicación queda abierta con el mismo perfil y el documento del usuario. La reapertura confirmó igualdad de JSON nativo (31 bloques), Markdown, título, estilos, comentarios, enlaces, diccionario e identificadores de versiones. La comprobación de preservación se registra en `output/preview/nodus-scriptor/resume-visual-final.log`.

La auditoría se limita a los estados y tamaños comprobados en macOS/Electron y Chromium. Los controles de voz se revisaron en reposo; esta campaña visual no inició grabaciones ni servicios externos. La verificación previa del almacenamiento, permisos, exportaciones renderizadas y licencias está documentada en [el flujo académico](scriptor-academic-workflow-2026-10-02.md).

## Corrección posterior: controles de bloque al pasar el cursor

La captura del usuario reveló un desfase vertical del «+» y el tirador de seis puntos en algunos párrafos. La campaña anterior no había detectado este estado al pasar el cursor. BlockNote calculaba la posición desde el borde del bloque, sin compensar los márgenes editoriales de Nodus.

El canvas compartido ahora centra ambos controles sobre la primera línea renderizada, respetando fuente, tamaño, interlineado, espaciado, encabezados y listas anidadas. Las tablas usan la primera línea de la primera celda; los medios vacíos usan su control de inserción. Se mantienen los controles nativos y sus menús mediante la API pública de BlockNote.

`node scripts/e2e-scriptor-block-controls.mjs` pasó 224 comprobaciones en escritorio y web, con temas claro/oscuro, los tres tamaños de ventana y dos estilos de documento adicionales. Incluye párrafos cortos/largos/vacíos, cita y nota al pie, encabezados 1–6, listas, cita en bloque, código, tabla e imagen vacía. La desviación máxima medida entre los botones y el centro de la primera línea fue de 0,5 px. Se verificaron el menú del tirador, la inserción con «+», deshacer y la conservación del JSON durante la navegación por bloques. No hubo errores de renderer.

Las 42 capturas complementarias están en [la galería de controles](../output/qa/scriptor-block-controls/index.html), con [resultados de geometría](../output/qa/scriptor-block-controls/results.json). Se inspeccionaron las capturas representativas de párrafos, títulos, listas y estilos personalizados. Typecheck y ambas compilaciones volvieron a pasar.
