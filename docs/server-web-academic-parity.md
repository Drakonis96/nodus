# Matriz de paridad Academic: Desktop ↔ Server Web

Auditoría de las superficies que aparecen en `src/navigation.ts` y de sus
equivalentes en `src/serverWeb`. «Lectura pública» significa que el Server Web
reproduce la estructura, los datos publicados y los estados de lectura sin
convertirse en un cliente de escritura del vault.

| Superficie Desktop | Componente Desktop | Renderer Server | Datos/ruta Server | Estado 1:1 y límites explícitos |
|---|---|---|---|---|
| Inicio | `src/views/HomeView.tsx` | `src/serverWeb/App.tsx` (`Home`) | `GET /api/v1/spaces/:id` | **Paridad adaptada al navegador**: resumen, bóveda activa y contadores; las bóvedas nativas del servidor permiten autoría mediante su contrato propio. No se muestran paneles privados que no existan en Desktop. |
| Buscar | `src/views/SearchView.tsx` | `src/serverWeb/academic/SearchServerView.tsx` | `GET /api/v1/spaces/:id/search`, `/passages/:id`, `/themes/:id`, `/gaps/:id` | **Parcial, seguro**: tabla agrupada, filtros, búsquedas guardadas, pestañas de idea/obra/autor y detalle dedicado publicado para pasajes/temas/huecos. Semántica depende de embeddings publicados; no debe presentarse como disponible si la respuesta es lexical. |
| Biblioteca | `src/views/Library.tsx` | `src/serverWeb/LibraryServerView.tsx` (`PublishedLibraryView`) | `/library/documents`, `/library/collections` | **Parcial, seguro**: tabla de proyección publicada con búsqueda, colección, paginación, refresco, apertura recargable y enlace en nueva pestaña; el pipeline Zotero/sincronización local sigue siendo Desktop-only. |
| Lector | `src/views/LibraryDocumentReader.tsx` | `src/serverWeb/LibraryServerView.tsx` (`LibraryDetail`) | `/library/documents/:id`, `/content`, `/original`, `/download.zip`, `/personal-annotations` | **Parcial, seguro**: cinta con índice/progreso/versión, original/descarga/impresión, Markdown con imágenes, selección/subrayado/comentario privado, marcadores y chat opcional mediante job privado; el estado leído/no leído se persiste como anotación account-scoped (`reading-state-<id>`). Si el paquete publica un original, el lector lo abre primero; Markdown permanece disponible mediante el selector (y la preferencia “limpio” se respeta). La publicación actual sólo admite un original y figuras referenciadas por el paquete: adjuntos independientes de Zotero requieren ampliar el contrato de publicación/API. OCR, anotaciones ancladas por offset y gestión local de Zotero siguen siendo Desktop-only. |
| Grafo | `src/views/GraphView.tsx` | `src/serverWeb/advanced/AdvancedWorkspace.tsx` (`GraphServerView`) | `/graph`, `/ideas/:id/graph` | **Paridad segura ampliada**: atlas tema→idea, semilla→vecindad, lentes Ideas/Autores, presets de lectura/huecos/contradicciones y filtros de lectura/confianza/búsqueda, sin paneles privados inventados. El tutor IA completo de Desktop sigue dependiendo del asistente conversacional. |
| Mapa de argumentos | `src/views/ArgumentMapView.tsx` | `src/serverWeb/AcademicToolsServerView.tsx` (`ArgumentView`) | `/ideas/routes`, `/ideas/:id/graph`, `/api/v2/me/artifacts`, `/api/v2/vaults/:id/ai/content-query` | **Paridad segura ampliada**: catálogo de rutas y detalle de vecindad con estructura publicada; el mapa generado se puede crear/editar/borrar como artefacto privado con contexto publicado. No se presenta como `ArgumentMap` persistente ni se modifica el snapshot. |
| Ideas | `src/views/IdeasView.tsx` | `src/serverWeb/advanced/AdvancedWorkspace.tsx` (`IdeasServerView`, `AcademicDetailExplorer`) | `/ideas`, `/ideas/:id`, `/ideas/:id/graph` | **Paridad segura ampliada**: tabla, filtros, detalle, relaciones y evidencia, con navegación a las obras vinculadas y su lector publicado, sin paneles privados inventados. El snapshot sigue siendo inmutable y el asistente completo se abre como conversación. |
| Autores | `src/views/AuthorsView.tsx` | `src/serverWeb/advanced/AdvancedWorkspace.tsx` (`AuthorsServerView`, `AcademicDetailExplorer`) | `/authors`, `/authors/:id/dossier`, `/authors/matrix` | **Paridad segura ampliada**: autores, dossier, relaciones publicadas y volúmenes editados diferenciados de la autoría, con acceso al lector publicado. No hay paneles privados inventados; la matriz/síntesis IA publicada no se inventa ni se escribe en el vault. |
| Diccionario | `src/views/DictionaryView.tsx` | `src/serverWeb/PersonalViews.tsx` (`DictionaryServerView`) | `/dictionary`, `/api/v2/me/artifacts`, `/dictionary/:id`, jobs AI | **Paridad segura ampliada**: catálogo en tabla, pestañas y dossier publicado con definición, evidencia, relaciones y versiones; entradas privadas con creación manual/IA, edición Markdown, vista previa y borrado. Las entradas privadas nunca mutan el snapshot. La generación avanzada y la publicación siguen siendo Desktop. |
| Inmersión | `src/views/ImmersionView.tsx` | `src/serverWeb/AcademicToolsServerView.tsx` (`ImmersionView`, `ImmersionPlan`) | `/immersion`, `/immersion/:id`, `/api/v2/me/artifacts`, `/api/v2/vaults/:id/ai/content-query` | **Paridad segura ampliada**: sesiones y plan estructurado, además de composer/generación/edición/borrado privado en Markdown. El progreso, audio, respuestas y exportación siguen siendo locales de Desktop. |
| Estado triple | `src/views/CoverageWorkspace.tsx`, `ResearchMapView.tsx`, `DebateView.tsx`, `GapsView.tsx` | `src/serverWeb/StateOfArtServerView.tsx` | `/state-of-art` | **Paridad de lectura**: cobertura, debate y huecos conservan las tres pestañas, filtros, salto al grafo y búsqueda de fuentes. No añade preguntas, análisis ni paneles privados inexistentes en la superficie Desktop vigente. |
| Hipótesis | `src/views/HypothesisLabView.tsx` | `src/serverWeb/AcademicToolsServerView.tsx` (`HypothesisView`) | `/gaps`, `/api/v2/me/artifacts`, `/api/v2/vaults/:id/ai/content-query` | **Paridad segura ampliada**: huecos publicados con detalle y composer para generar, editar y borrar candidatas privadas usando solo contexto publicado; no se exponen PII ni se escriben candidatos en el vault. |
| Ruta de lectura | `src/views/ReadingPathView.tsx` | `src/serverWeb/AcademicToolsServerView.tsx` (`ReadingView`) | `/reading-path`, `/api/v1/spaces/:id/personal-annotations`, `/view/assistant` | **Paridad segura ampliada**: ranking/ruta publicada con briefing, las seis estrategias Desktop, límite, inclusión de leídas, estadísticas, fases y tarjetas con estados/metadatos; el estado personal puede superponerse mediante anotaciones privadas y cada obra ofrece salto al grafo, lector y asistente. Zotero sigue siendo una capacidad local. |
| Deep Research | `src/views/DeepResearchView.tsx` | `src/serverWeb/PersonalViews.tsx` (`DeepResearchServerView`) + `src/serverWeb/ServerCitationModal.tsx` | `/deep-research`, `/deep-research/:id`, `/api/v2/me/jobs`, `/api/v2/me/artifacts` | **Paridad segura ampliada**: galería, informe, imagen, Markdown, cinta de opciones, selección, anotaciones, bookmark, navegación por informe, composer privado, historial/cancelación/reintento, traducciones publicadas y privadas, HTML imprimible y PDF binario. Las citas académicas abren el workspace modal embebido con pestañas cerrables sin abandonar el informe; los enlaces World conservan su navegación segura. Todas las mutaciones privadas quedan aisladas de la publicación. |
| Workspace | `src/views/WorkspaceView.tsx` | `src/serverWeb/PersonalViews.tsx` (`PrivateNotesServerView`) | `/notes`, artifacts | **Paridad segura ampliada**: tabla publicada de solo lectura y espacio privado con colecciones jerárquicas, pestañas, búsqueda, etiquetas, mover, selección masiva, papelera/restauración/borrado definitivo y editor Markdown con vista previa; las publicaciones nunca se mutan. Enlaces locales de Electron no se exponen sin contrato web seguro. |
| Settings | `src/views/Settings.tsx` | `src/serverWeb/settings/ServerSettingsView.tsx` | `/api/v2/me/preferences`, admin APIs | **Parcial**: navegación, perfil, tema, cuenta y administración nativa del servidor; sin integraciones Electron. |
| Providers | `src/views/ProvidersSettings.tsx` | `ServerSettingsView` | `/api/v2/me/ai/providers`, credentials/preferences | **Parcial, seguro**: providers, modelos, credenciales y preferencias vía servidor; capacidades locales de Desktop no se publican. |
| Models | `src/views/ProvidersSettings.tsx` | `ServerSettingsView` | catálogo vivo para proveedores ejecutables, fallback integrado para runtimes Desktop, favoritos por cuenta y selectores por tarea | **Adaptado**: Server consulta `/models` con la credencial cifrada y la réplica aplica cambios Web→Desktop; Codex/Copilot/Ollama/LM Studio siguen requiriendo el runtime Desktop y se muestran sin fingir ejecución remota. |
| Account | `src/views/Settings.tsx` | `ServerSettingsView` | `/api/v1/web/me`, `/api/v1/web/account/password`, `POST /logout` | **Parcial, seguro**: perfil, rol, cambio de contraseña y cierre de sesión CSRF-protegido según rol; no controles del host local ni gestión de sesiones del sistema. |
| Themes | `src/views/Settings.tsx` | `src/serverWeb/App.tsx` + `ServerSettingsView` | `localStorage` + preferencia de perfil | **Implementado**: tema claro/oscuro, toggle de cabecera y persistencia local; el tema no altera el perímetro de publicación. |

## Autoría académica server-native

Una bóveda académica `server_native` creada en Server puede autorizarse con el
boundary tipado (`/api/v2/vaults/:id/content-contract` y
`/api/v2/vaults/:id/content/:table[/:key]`) para las tablas canónicas `ideas`,
`works`, `authors`, `passages`, `themes`, `gaps` y sus enlaces estructurales
(`work_themes`, `work_authors`, `idea_occurrences`, `evidence`, `edges`,
`external_refs`), además de las colecciones académicas ya compartidas. La UI
`NativeContentAuthoring` ofrece el mismo editor/listado CRUD reutilizable en las
superficies Ideas, Autores, Estado de la cuestión e Hipótesis. El servidor filtra
embeddings, columnas privadas, owner/user y tablas `scope:user`; las entidades
derivadas no se fabrican ni se aceptan como sustituto de sus tablas fuente.

Cada escritura exige revisión e idempotencia y registra dominio, revisión y ledger
en una transacción. Esta capacidad sólo aplica a `server_native`; las proyecciones
`desktop_published` continúan siendo inmutables y de solo lectura.

## Invariantes de seguridad

- `teaching_groups`, grades, assessment y cualquier roster permanecen en
  `PERMANENT_PUBLICATION_DENYLIST`: las superficies pueden existir, pero sus
  datos publicados deben ser vacíos/privados.
- Los artefactos IA y anotaciones son privados del usuario; no son una ruta de
  publicación ni una fuente para el snapshot compartido.
- El Server Web no importa `window.nodus`, Electron ni el bridge privilegiado.
- Una fila publicada debe poder abrirse por su colección e id; una aproximación
  de UI no debe inventar una acción mutante para cerrar una diferencia visual.

## Verificación focal

`node --test scripts/test-server-web-academic-parity.mjs` comprueba que cada
superficie Desktop tiene el renderer y el contrato de ruta declarados, y que las
restricciones de publicación académica no se relajan accidentalmente.
