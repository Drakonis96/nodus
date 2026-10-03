# Workspace editorial: implementación y validación

Fecha: 2 de octubre de 2026. Revisión realizada en el checkout `a6d1/nodus`, con perfiles y servidores de prueba aislados.

Nodus Scriptor sustituye a la superficie anterior y forma parte de Nodus Tools. BlockNote 0.55.0 es el editor de notas, ideas manuales y documentos de Estudio y Docencia. El catálogo, la cabecera, las filas, las tarjetas, el navegador y el contenedor de contexto se comparten entre escritorio y web; sus adaptadores conservan los servicios y permisos de cada entorno.

## Interfaz y alcance

El modo inicial es editorial, con lista de documentos y contexto cerrado. El fondo del catálogo y el documento es blanco (#ffffff), con paneles en gris neutro; el tema oscuro conserva su equivalente. El documento tiene título editable, serif de sistema, tamaño inicial de 18 px, interlineado 1,75 y ancho máximo de 820 px. Los estilos ya guardados siguen cargándose. El formato aparece sobre la selección; la inserción utiliza `/` y el control del bloque activo. Las operaciones anteriores se conservan en el menú del documento, el panel de contexto y sus atajos.

El catálogo conserva colecciones anidadas, búsqueda, tipos, etiquetas, ordenación, selección múltiple, movimientos, acciones masivas, «Sin colección» y papelera. La vista de tarjetas muestra tres documentos recientes y coloca los restantes en la lista, sin repetirlos. El navegador mide 300 px y el inspector 320 px. Los paneles responden al ancho del área de trabajo: contexto superpuesto bajo 1100 px y navegación local desplegable bajo 900 px. Foco entra en pantalla completa y oculta temporalmente la cabecera y la navegación principal, además de los paneles locales. Los controles del editor permiten volver a abrir la navegación y el contexto; al salir se conservan las preferencias originales del sidebar.

Las preferencias se guardan mediante snapshots, con almacenamiento duradero de distribución, catálogo y contexto. La pantalla completa es temporal y no se reactiva sin una acción explícita del usuario. En web, la clave incluye usuario y bóveda; en escritorio, la bóveda dentro del perfil local del usuario. Las rutas `workspace`, `notes`, `writing` y `projects` conservan sus alias.

El ajuste posterior solicitado por el usuario renombra el producto a **Nodus Scriptor** y mueve su acceso al grupo Herramientas y al catálogo de **Nodus Tools**. Ya no tiene una sección independiente «Escribir»; las entradas especializadas de Docencia y Worldbuilding permanecen en Crear. Las rutas y snapshots `workspace` y `notes` conservan sus identificadores, y el catálogo de herramientas elige la ruta adecuada a cada bóveda.

La migración `scriptorSidebarVersion: 1` hace visible Scriptor una vez en esta actualización, incluso en perfiles que tenían oculta su entrada anterior. Conserva las demás preferencias. Después, desfijarlo desde Nodus Tools u ocultarlo en Ajustes permanece efectivo al recargar o abrir otra vez la bóveda. Se incorpora la misma versión al perfil portable web. El servidor ofrece el catálogo con Scriptor, conforme a sus capacidades reales.

Se mantienen las dimensiones, componentes de presentación y estilos del sidebar principal. Los cambios en las listas de navegación retiran las entradas duplicadas de los sidebars especializados. En `src/serverWeb/App.tsx` se protege también la navegación mientras guarda el editor. Los cambios globales de CSS retiran las reglas de Milkdown; el fondo blanco y los nuevos estilos pertenecen únicamente a la superficie editorial.

| Bóveda | Workspace en Electron | Workspace web privado | Comprobación adicional |
| --- | --- | --- | --- |
| Académica | Guardado y reapertura nativa | Guardado y reapertura nativa | Idea manual sincronizada con el grafo; conflictos y recuperación |
| Estudio | Guardado nativo | Guardado nativo | Documento del curso editado con el mismo canvas en Electron |
| Docencia | Guardado nativo | Guardado nativo | Documento docente editado con el mismo canvas en Electron |
| Genealogía | Guardado nativo | Guardado nativo | Navegación y guardado antes de salir |
| Prosopografía | Guardado nativo | Guardado nativo | Navegación y guardado antes de salir |
| Bases de datos | Guardado nativo | Guardado nativo | Navegación y guardado antes de salir |
| Testimonios | Guardado nativo | Guardado nativo | Navegación y guardado antes de salir |
| Worldbuilding | Guardado nativo | Guardado nativo | Navegación y guardado antes de salir |

Las superficies especializadas que no utilizaban este workspace conservan su organización. Los documentos de Estudio y Docencia publicados en el servidor siguen siendo lectores, conforme a sus permisos.

## Documento nativo, versiones y compatibilidad

El array JSON nativo es la representación principal, siguiendo la [recomendación de formatos de BlockNote](https://www.blocknotejs.org/docs/foundations/supported-formats). Markdown y los bloques universales son proyecciones. La reconstrucción de un documento nativo utiliza su JSON directamente.

- Las notas guardan el JSON y la versión del esquema en el documento Yjs de su página existente. Los snapshots y el historial de página conservan ambas representaciones.
- Los documentos de Estudio y Docencia tienen columnas aditivas para JSON, esquema y revisión. Sus versiones incluyen el JSON.
- Los artefactos web privados guardan JSON, esquema y versiones en metadatos, junto con `content` como proyección Markdown, dentro de la misma escritura atómica.
- Los cambios de formato crean versiones aunque el Markdown permanezca igual. Las restauraciones recuperan también el JSON y sus identificadores.
- Un documento antiguo se convierte en memoria al abrirlo. Las pruebas verifican que abrir, navegar y cerrar sin editar no persiste el JSON ni normaliza su contenido.
- Las escrituras de consumidores antiguos de Markdown o bloques se reconcilian con el documento previo. Los bloques no modificados mantienen identificadores, propiedades y contenido enriquecido, incluso si el cliente antiguo omite los metadatos auxiliares.
- Los tipos y formatos futuros se muestran mediante bloques de compatibilidad reversibles. El JSON original se conserva mientras el usuario no sustituya expresamente ese bloque.

La migración 198 es aditiva. Las pruebas de almacenamiento comparan el JSON completo al guardar, cerrar, reabrir y restaurar. Cubren listas anidadas, encabezados hasta nivel seis, tablas, fórmulas, enlaces `nodus://`, subrayado, colores, bloques desconocidos, actualizaciones Yjs y comentarios después de mover bloques.

## Guardado y protección de borradores

El autoguardado espera 800 ms y las operaciones se serializan por editor. Cada escritura incluye la revisión esperada. La revisión que devuelve el guardado se obtiene dentro de su operación, evitando sustituirla por una revisión concurrente leída después.

Antes de cambiar de documento, cerrar una pestaña, cambiar de bóveda o cerrar la ventana de Electron se completa el guardado. En web, la navegación del sidebar, el selector de bóveda y los cambios de historial dentro de la aplicación esperan al editor. Si el usuario escribe mientras una operación está en vuelo, el cierre espera también esa edición posterior. Un conflicto mantiene el editor y ofrece recuperar el borrador o cargar el documento actual.

Los borradores locales conservan texto y JSON para recuperarlos después de recargar. Cerrar o recargar completamente una página web no permite esperar una petición asíncrona como en Electron; el borrador local permite recuperar esa edición en la siguiente apertura. La recuperación tras recarga con un conflicto real está probada.

Los comentarios incorporan identificadores de bloque y mantienen texto y posiciones anteriores como compatibilidad. Los anclajes ambiguos o ausentes se señalan. Los fragmentos bloqueados se comprueban en su bloque original. Las mejoras de IA conservan la operación de deshacer agrupada y no guardan resultados parciales del streaming.

## Revisión de las seis maquetas

Se abrieron las seis imágenes originales y se comparó el área de contenido con las capturas reales. Se mantuvo el sidebar principal de la aplicación, tal como exige el plan. La cabecera del catálogo se hizo compacta; no se reproduce el título promocional grande de algunas alternativas. El contenido y las etiquetas proceden de datos reales de prueba, no de una imagen superpuesta.

| Maqueta original | Captura final de referencia | Resultado de la comparación |
| --- | --- | --- |
| `01-lienzo-editorial-editor.png` | `desktop-editor-1440.png`, `desktop-selection-format-1280.png` | Fondo blanco (ajuste posterior solicitado), título dentro del documento, serif, ancho de lectura y formato contextual |
| `02-lienzo-editorial-organizacion.png` | `desktop-list-1440.png` | Catálogo con título, fragmento, colección, etiquetas y modificación; acciones de documento al pasar el cursor o recibir foco |
| `03-estudio-contextual-editor.png` | `desktop-context-1920.png`, `desktop-slash-menu-1920.png` | Un inspector con fuentes, comentarios y detalles; inserción junto al bloque; esquema, historial y asistente dentro del contexto |
| `04-estudio-contextual-organizacion.png` | `desktop-cards-1440.png`, `web-cards-1440.png` | Tres tarjetas recientes y lista de los documentos restantes; jerarquía y colecciones conservadas |
| `05-navegador-editor.png` | `desktop-navigator-1920.png`, `web-navigator-1920.png` | Navegador continuo de 300 px, búsqueda y filtro de colección; lienzo y contexto independientes |
| `06-navegador-organizacion.png` | `desktop-collections-overlay-1000.png`, `desktop-options-1000.png` | Colecciones desplegables en área estrecha, selección y menú próximos al borde dentro de la ventana |

La revisión cubre 1280×800, 1440×900 y 1920×1080. Añade ventanas de 1000 px para probar paneles superpuestos, títulos largos, estados vacíos y teclado. Se revisaron tema claro y oscuro, listas, tarjetas, editor, contexto, navegador, foco, menú `/`, selección, compatibilidad y errores de guardado.

Tras la revisión original, el usuario pidió un fondo blanco en lugar del papel cálido de las maquetas y el nombre Nodus Scriptor dentro de Nodus Tools. Se repitieron las capturas con estos ajustes.

Durante la revisión se corrigieron el fondo y la disposición de las colecciones web, el alcance de los estilos editoriales, los encabezados excesivos, la altura del título, el comportamiento de la selección, el margen del formato flotante junto al borde, una traducción de tarjetas que reutilizaba «Flashcards» y el renderizado de colores CSS personalizados. Se repitieron las capturas después de las correcciones. Las pruebas comprueban los colores calculados en el DOM y que la barra de selección conserva margen en 1280 px.

La entrega actual contiene **59 capturas**, incluidas `desktop-scriptor-tools-1440.png` y `web-scriptor-tools-1440.png`. Los E2E comprueban el color calculado #ffffff en el catálogo y el documento, así como desfijar, recargar y volver a fijar Scriptor.

Las imágenes están en `output/qa/editorial-workspace/`; `index.html` reúne las capturas y las comparaciones con las maquetas. Los resultados estructurados son `desktop-results.json` y `web-results.json`.

## Comprobaciones ejecutadas

| Comprobación | Resultado | Registro conservado en `output/qa/editorial-workspace/checks/` |
| --- | --- | --- |
| Build de escritorio, renderer, Electron y preload | Correcto | `desktop-build.log` |
| Build web | Correcto | `web-build.log` |
| Typecheck de renderer y Electron | Correcto | `typecheck.log` |
| Batería base de workspace, editor, JSON, snapshots, traducciones y módulos del servidor | 123/123 | `workspace-regression.log` |
| Ajuste Scriptor: catálogo, navegación, ocho bóvedas, preferencias, migración, ayuda y traducciones | 79/79 | `scriptor-regression.log` |
| Páginas, historial, ACL, migración de workspace, IA, streaming y dictado | 10/10 | `functional-regression.log` |
| Repositorios de workspace, editor y organización de Estudio; contratos web y persistencia | 76/76 | `repository-regression.log` |
| JSON nativo y artefactos privados del servidor | 5/5 | `native-storage-server.log` |
| Privacidad, redacción y aislamiento de artefactos del servidor | 4/4 | `server-privacy.log` |
| Servicios de ideas manuales, grafo, índice, escrituras obsoletas y aislamiento de bóveda | Correcto | `manual-ideas.log` |
| Electron real, ocho bóvedas y cierre con una edición pendiente | Correcto, sin errores de renderer | `desktop-visual.log` |
| Chrome con servidor real, ocho bóvedas, conflictos y edición durante guardado de navegación | Correcto, sin errores de página | `web-visual.log` |
| Inventario y avisos de licencias | Correcto | `licenses.log`, `web-notices.log` |
| `git diff --check` | Correcto | `diff-check.log` |

Las baterías anteriores comparten algunas pruebas; los recuentos describen cada ejecución y no deben sumarse como pruebas distintas.

Reproducción de las baterías y las capturas:

```sh
npm run build
npm run build:server-web
npm run typecheck
node --test scripts/test-blocknote-storage.mjs scripts/test-study-ui.mjs scripts/test-workspace-ui.mjs scripts/test-server-web-workspace-parity.mjs scripts/test-server-generated.mjs scripts/test-i18n-coverage.mjs scripts/test-view-snapshots.mjs
node --test scripts/test-scriptor-navigation.mjs scripts/test-toolkit-ui.mjs scripts/test-workspace-navigation-consolidation.mjs scripts/test-sidebar-vault-filtering.mjs scripts/test-teaching-sidebar.mjs scripts/test-compact-vault-sidebar.mjs scripts/test-server-web-global-navigation-contract.mjs scripts/test-workspace-ui.mjs scripts/test-i18n-coverage.mjs scripts/test-toolkit-docs.mjs server/test/userProfilePreferences.integration.test.mjs
node scripts/e2e-editorial-workspace.mjs
node scripts/e2e-editorial-server-web.mjs
npm run licenses:verify
```

Los E2E utilizan Electron instalado y Google Chrome en `/Applications/Google Chrome.app`, crean datos temporales y los eliminan al terminar. Las capturas permanecen para la revisión.

## Licencias y límites de la comprobación

Se fijan `@blocknote/core`, `@blocknote/react` y `@blocknote/ariakit` a **0.55.0**, manteniendo React 18 y Tailwind 3. Milkdown se ha retirado de las dependencias y del editor. Los avisos raíz y servidor incluyen paquetes, versión, autoría, fuente y MPL-2.0. `legal/generated/MPL-2.0.txt` contiene el texto completo, verificado con la huella de su fuente fijada a la versión. El inventario generado recoge 655 paquetes de producción, 348 grupos de avisos y 83 documentos de origen fijados. El build del servidor genera los avisos y su Dockerfile los copia a la distribución. No se utilizan paquetes BlockNote XL.

Se comprobaron permisos e independencia de usuarios con peticiones HTTP reales. Las publicaciones actuales excluyen las notas privadas, incluso al activar contenido de usuario. Para comprobar la interfaz antigua de una nota publicada de solo lectura, el E2E suministra una respuesta de colección de un servidor anterior; no se habilitó la publicación de notas privadas ni se presenta esa respuesta como una publicación actual.

Las pruebas de IA y voz cubren servicios, adaptadores, streaming, cancelación y controles con proveedores de prueba. No se hizo una sesión con un proveedor externo de IA ni una grabación física con micrófono/altavoces. Se comprobaron los builds y la generación y copia de avisos del servidor; no se construyó ni desplegó una imagen Docker. Los avisos del bundler sobre tamaño de chunks siguen visibles en los registros.


## Pulido posterior a la prueba del usuario

La cabecera mantiene 56 px de altura y las pestañas viven en la misma posición al abrir documentos, cambiar entre catálogo y editor, o mostrar navegador y contexto. El navegador se integra en el cuerpo del editor, bajo la cabecera, y no ocupa el área del sidebar principal. La tira desplaza sólo su contenido horizontal; evita `scrollIntoView`, que movía también los contenedores exteriores. La web utiliza la misma tira compartida. Se retira «Índice local» de la superficie de escritura.

El menú de opciones tiene una única columna, scroll exclusivamente vertical y límites del área visible. El formato de selección reúne las acciones habituales en una fila compacta y conserva las opciones adicionales en «…». El gestor de prompts se abre fuera de los contenedores con contención CSS, admite teclado y permite aplicar cualquier prompt guardado. Las mejoras explícitas están disponibles también en modo manual.

La selección se captura como un rango nativo de ProseMirror, por lo que texto en negrita o con color no depende de encontrar una cadena idéntica en Markdown. La corrección se muestra en una vista de streaming con Cancelar; el documento nativo permanece intacto hasta finalizar. La aplicación sustituye sólo el rango seleccionado como una operación deshacible. La cancelación mantiene el JSON original y los guardados/cambios de documento se bloquean mientras la petición sigue activa. Los bloques ajenos a la selección conservan sus identificadores, colores y propiedades propias.

Los siete prompts personalizados no eliminados siguen intactos en la bóveda Principal del perfil habitual. Se han copiado, mediante la API de estilos, al perfil aislado de prueba para poder probarlos sin modificar los originales. Sus versiones originales permanecen en su almacén habitual.

Validación adicional: typecheck y builds de escritorio/web; 84 pruebas pertinentes; `scripts/e2e-scriptor-polish.mjs` en Electron real con transporte de IA controlado; comparación de geometría a 1280×800, 1440×900 y 1920×1080; ocho documentos abiertos; JSON antes/después de cancelación; deshacer de selección enriquecida; fullscreen nativo y reapertura de sidebars sin cambiar sus preferencias; tema oscuro. Galería: `output/qa/scriptor-polish/index.html`.

La auditoría posterior incorpora referencias con `[[`, contexto de enlaces, menús agrupados y feedback de IA compacto. También corrige la validación del protocolo `nodus://` y el estado de guardado al deshacer. Hallazgos, decisiones y nuevas pruebas: [auditoría de diseño](scriptor-design-audit-2026-10-02.md).
