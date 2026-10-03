# Nodus Scriptor · Acciones y selección · 3 de octubre de 2026

La barra compacta situada bajo las pestañas mantiene visibles deshacer, rehacer, enlaces de Nodus, citas bibliográficas, prompts de mejora, comentarios y búsqueda. Los botones tienen etiquetas accesibles, tooltips y los atajos existentes. La navegación con flechas, Inicio y Fin recorre los controles disponibles. El formato de texto sigue en la barra contextual de BlockNote.

El menú agrupa documento, escritura académica, voz, vistas, inserción y gestión. Cada acción adicional admite una chincheta, salvo cerrar y papelera. Fijar o retirar un botón mantiene abierto el menú; la acción sigue disponible en ambas ubicaciones. Los accesos principales mantienen su posición y las preferencias se guardan por bóveda y, en web, por usuario. La interfaz comparte los componentes de escritorio, Estudio/Docencia y web; sólo presenta las capacidades disponibles de cada entorno.

Antes de usar la cabecera o la barra se captura la selección nativa de ProseMirror. Se restaura mediante un bookmark únicamente si el editor y el documento siguen correspondiendo al punto guardado, sin añadir pasos al historial. El modo Markdown conserva los offsets de su textarea. La mejora consulta la selección actual y guarda su rango antes de abrir los prompts. Los comentarios conservan la aparición exacta y el anclaje de bloque, incluso cuando la frase se repite. Se elimina la selección global de otros elementos como sustituto del rango del editor.

Los estilos quedan limitados a Scriptor. Se conserva la superficie blanca, los acentos violetas discretos y el equivalente oscuro. La barra se adapta al espacio disponible; no altera las pestañas ni el sidebar principal. Los botones fijados pueden pasar a otra fila en ventanas estrechas. El menú conserva scroll vertical, divisores finos y una columna fija para las chinchetas.

## Verificación

- `node scripts/e2e-scriptor-actions.mjs`: acciones principales, comentarios y evidencia sobre la segunda aparición de una frase, interacción con teclado, formato desde el menú, selección exacta en Markdown, prompts, streaming controlado y deshacer en una operación. Conserva IDs, propiedades propias y formato. La prueba de IA reemplaza sólo el transporte, sin solicitudes a proveedores.
- Chinchetas: fijar, retirar y persistir después de recargar; controles principales accesibles, tooltips y navegación del teclado. Se comprueba la separación de usuario y bóveda mediante el sistema de snapshots.
- Capturas en 1280×800, 1440×900, 1920×1080, 900×700 y 600×800, en claro y oscuro. Revisión visual de distribución, espacios, cabecera, adaptación de la barra, menú y tooltip. Comparación con el lienzo editorial original, teniendo en cuenta la nueva barra solicitada por el usuario.
- `node scripts/e2e-scriptor-polish.mjs`: navegación, pestañas, contexto, vínculos, prompts, streaming, cancelación, deshacer y foco.
- `node scripts/e2e-academic-server-web.mjs`: barra compartida, chinchetas tras recargar el navegador, citas, notas al pie, manuscrito y exportaciones reales Word/PDF/LaTeX.
- 81 pruebas de snapshots, Study y workspace; typecheck y builds de escritorio/web.

[Galería](../output/qa/scriptor-actions/index.html) y [resultados](../output/qa/scriptor-actions/results.json). La aplicación de prueba se actualiza conservando el documento real, sus versiones, los prompts y el estado de los paneles.

[Captura del editor real](../output/qa/scriptor-actions/user-editor.png), [menú con chinchetas](../output/qa/scriptor-actions/user-menu.png) y [comprobación del perfil](../output/qa/scriptor-actions/user-preview-check.json): 31 bloques nativos, revisión 36 y 20 prompts conservados, con la misma preferencia del sidebar. La ventana queda abierta para probar la nueva barra.
