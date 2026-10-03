# Auditoría de diseño de Nodus Scriptor · 2 de octubre de 2026

## Criterio y alcance

La escritura debe cerrar el recorrido biblioteca → investigación → análisis → documento, con una superficie blanca, tipografía legible y controles que aparecen cuando se necesitan. Se han abierto las seis maquetas originales y la captura aportada por el usuario. La comparación se centra en el área de contenido; el sidebar principal conserva los componentes y estilos de Nodus.

## Hallazgos y decisiones

| Hallazgo | Cambio | Criterio de verificación |
| --- | --- | --- |
| El streaming ocupaba una franja violeta a todo lo ancho y desplazaba el contenido. | Tarjeta temporal blanca dentro de la columna de escritura, con borde tenue, texto acotado y Cancelar. Deshacer queda en el mismo lugar al terminar. | Fondo blanco, altura acotada, sin desplazamiento de cabecera o pestañas; cancelación y deshacer conservan el JSON. |
| El inspector podía cubrir las opciones del documento. | Corregir el orden de las capas del encabezado y los menús. | La opción visible recibe el clic real con el inspector abierto; no hay scroll horizontal. |
| El menú repetía foco/pantalla completa y distribuía modelos y prompts en una lista excesiva. | Separadores entre grupos y un único control Foco en la cabecera. Modelo y prompts rápidos en Asistente; gestor de prompts accesible en «…» y selección. | Funciones accesibles, acciones separadas, tamaños y espacios estables. |
| Había enlaces wiki antiguos, pero faltaba un selector de entidades. | `[[` abre un menú contextual con título, tipo y descripción breve. Búsqueda sin distinción de acentos, teclado, scroll y acceso a todo el catálogo. | Ideas, autores, obras, notas, documentos y materiales; más de 50 resultados; Enter/Escape y estados vacíos. |
| Una idea manual también podía aparecer como su nota propietaria. | Deduplicar la representación documental de las ideas manuales visibles. | Una idea aparece una vez y conserva su destino en el grafo. |
| BlockNote filtraba el protocolo interno. | Configurar `links.isValidLink` mediante su API pública, manteniendo los protocolos habituales, rechazando esquemas ejecutables y permitiendo `nodus://`. | Enlace nativo, destino visible, reapertura, proyección y navegación real. |
| Las referencias del texto no estaban reunidas en el contexto. | Lista discreta «Referencias del texto» dentro de Fuentes, deduplicada por destino y accesible con teclado. | Incluye enlaces en bloques anidados y tablas; abre el destino tras completar el guardado. |
| El foco dibujaba un marco turquesa alrededor de todo el canvas. | El texto se edita con su cursor; los botones, enlaces y menús conservan indicadores de foco. | El canvas no tiene un contorno global; navegación por teclado y selector verificados. |
| Un borrador recuperado se presentaba como error y deshacer podía dejar «Sin guardar» al volver al documento persistido. | Aviso informativo neutro, errores reales con contraste en ambos temas y reconciliación del estado al volver al JSON ya guardado. | La IA se puede deshacer y el estado vuelve a Guardado; los conflictos siguen conservando el borrador. |

## Referencias y datos

El selector enlaza entidades existentes; no inventa una fuente, una cita literal o una página. Un enlace nuevo se almacena como contenido inline `link` nativo de BlockNote, con `href` estable basado en ID y texto visible editable. El formato Markdown usa enlaces estándar y escapa los corchetes del título. Los `nodusWiki` anteriores siguen disponibles y se resuelven sin convertir automáticamente el documento al abrirlo.

El catálogo de escritorio se construye sobre la base activa, respeta las ideas visibles en modo manual y excluye papelera, archivados y huérfanos. Sólo cruza IPC información breve de identificación: no documentos completos, blobs o embeddings. La consulta se reutiliza durante 30 segundos dentro de la instancia del editor y se invalida al recibir cambios de datos. Se presentan inicialmente 50 filas y se amplían al desplazar o navegar con teclado, sin limitar las ideas disponibles.

En web, el endpoint `/api/v1/spaces/:id/editor-references` exige pertenencia a la bóveda y sólo lee metadatos publicados. Las notas privadas se añaden desde los artefactos ya autorizados del usuario, dentro de esa bóveda. No se utiliza Electron ni se incorporan notas privadas al snapshot publicado. Una referencia abre su destino después de vaciar el guardado pendiente; si el guardado falla, el borrador y el editor se mantienen.

## Revisión visual y funcional

La verificación usa la aplicación Electron y la aplicación web con servidor real. Las ventanas de referencia son 1280×800, 1440×900 y 1920×1080. Se evalúan cabecera, listas, tarjetas, navegador, inspector, menú, selección, foco, referencias y estados de IA, en tema claro y oscuro. Las capturas y los resultados se conservan en `output/qa/scriptor-polish` y `output/qa/editorial-workspace`.

La IA de las pruebas emite un stream controlado mediante IPC para comprobar la interacción sin llamar a un proveedor externo. Los datos, el editor, sus transacciones y el almacenamiento son reales. La previsualización abierta del usuario se conserva en su perfil aislado y no se reutiliza como fixture de las pruebas.

## Resultados finales

- Typecheck de renderer y Electron; builds de escritorio y web completados.
- 39 pruebas de workspace, editor, mejoras, contratos IPC, generación de módulos y artefactos BlockNote superadas. Pruebas adicionales de referencias y almacenamiento nativo superadas.
- E2E Electron: tres tamaños, pestañas estables, menús accesibles con inspector abierto, prompts, selección enriquecida, streaming blanco y compacto, cancelación sin mutación y deshacer conservando IDs, propiedades y formato. El estado vuelve a Guardado al deshacer al documento persistido. Foco y reapertura de paneles conservan las preferencias del sidebar.
- E2E referencias: 65 ideas manuales disponibles con teclado, sin duplicados; títulos con corchetes escapados; reapertura con JSON idéntico; enlaces visibles en ambos temas; navegación real a la ficha de autor. Menú vacío conserva la entrada literal al pulsar Enter.
- Matriz Electron de ocho bóvedas completada. En Estudio y Docencia se insertan referencias nativas a una nota, se guardan y se abre esa nota en Scriptor. Se conservan fórmulas, tablas, nivel seis, bloques desconocidos e ideas manuales sincronizadas con el grafo.
- Web con servidor real: matriz de ocho bóvedas, selector con ideas publicadas y notas propias, exclusión de notas ajenas, HTTP 403 sin pertenencia, guardado y reapertura, conflictos entre sesiones, recuperación del borrador, guardado durante navegación y lector publicado de sólo lectura. Sin errores de renderer en las tres campañas E2E.
- Licencias verificadas: 655 paquetes de producción, 348 grupos de avisos y 83 fuentes fijadas. BlockNote 0.55.0 y MPL-2.0 permanecen en los avisos de escritorio y servidor.
- Se corrigieron las desviaciones encontradas y se repitieron las capturas. La comparación con las seis maquetas conserva lienzo editorial, jerarquía, tipografía y contexto plegable, con el sidebar real de Nodus.

Galería final: [capturas de la auditoría](../output/qa/scriptor-polish/index.html). Matriz y catálogo: [escritorio y web](../output/qa/editorial-workspace/index.html). Los registros están en `output/preview/nodus-scriptor/audit-*.log`; cada campaña conserva un JSON con sus comprobaciones.

La aplicación de prueba queda abierta con el renderer actualizado. Antes de reiniciarla se completó el guardado; el JSON nativo y el Markdown del texto escrito por el usuario se compararon con los datos reabiertos y son idénticos. Se mantiene el perfil aislado, los prompts y la preferencia de navegación plegada.
