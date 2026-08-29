# Paridad Desktop ↔ Nodus Server Web

## Contrato

La paridad 1:1 se evalúa por **capacidad publicada**, no por parecido general. Una vista pasa únicamente si conserva:

1. la misma jerarquía visual (cabecera, barra lateral, grupos, densidad y espaciado);
2. el mismo patrón de interacción (tabla, pestañas internas, dossier, lector o grafo);
3. la misma semántica de datos y estados vacío/error/carga;
4. el mismo comportamiento en tema claro y oscuro;
5. navegación profunda recargable y compatible con atrás/adelante;
6. ausencia de controles que el Server no pueda ejecutar con seguridad.

La URL canónica de la aplicación es `/`. `/app` se mantiene solo como compatibilidad para enlaces antiguos. La administración completa vive en `Ajustes → Servidor`; `/admin` redirige allí.

## Fuente de verdad

| Superficie | Referencia Desktop | Adaptador Server Web | Contrato de datos |
| --- | --- | --- | --- |
| Shell y navegación | `src/App.tsx`, `src/navigation.ts` | `src/serverWeb/App.tsx` | `/api/v1/web/me`, resumen del espacio |
| Biblioteca y lector | `src/views/Library.tsx`, `src/views/LibraryDocumentReader.tsx` | `LibraryView`, `LibraryDetail` | biblioteca publicada y paquetes de lectura |
| Ideas | `src/views/IdeasView.tsx` | `advanced/AdvancedWorkspace.tsx` | colección de ideas y dossier |
| Autores | `src/views/AuthorsView.tsx` | `advanced/AdvancedWorkspace.tsx` | colección de autores y síntesis publicada |
| Grafo | `src/views/GraphView.tsx`, `src/views/graph/SigmaGraph.tsx` | `GraphServerView` | `/graph` y subgrafo de idea |
| Mapa/colecciones | `src/views/ArgumentMapView.tsx` y vistas de cada vault | `AcademicToolsServerView`, `VaultSurfaceView` y adaptadores especializados | colecciones REST publicadas |
| Deep Research | `src/views/DeepResearchView.tsx` | `DeepResearchServerView` | informe, imagen, traducciones publicadas y documento maquetado imprimible |
| Ajustes | `src/views/Settings.tsx`, `src/views/ProvidersSettings.tsx` | `ServerSettingsView` + administración nativa integrada | perfil portable, proveedores, modelos favoritos y administración |

## Plan y estado

### P0 — superficies denunciadas

- [x] Servir la aplicación autenticada desde `/` y normalizar las rutas profundas sin prefijo `/app`.
- [x] Integrar toda la administración del servidor de forma nativa en la pestaña `Servidor` de Ajustes, sin iframe ni puerto auxiliar.
- [x] Sustituir los formularios de modelo por selectores desplegables con catálogo por proveedor.
- [x] Eliminar el panel/modal privado de borrador de síntesis de autor; solo se muestra la síntesis publicada del corpus.
- [x] Convertir Ideas, Autores, Mapa de argumentos y colecciones equivalentes en tablas densas con búsqueda, pestañas internas y dossier.
- [x] Convertir Biblioteca en tabla y conservar el lector de documento, anotaciones privadas y apertura/descarga del original.
- [x] Dibujar primero los temas en el grafo completo y añadir navegación tema → ideas → vecindad → temas.
- [x] Renderizar Deep Research con portada, imagen, informe profesional embebido, traducciones publicadas y enlace de nueva pestaña/impresión.
- [x] Añadir remapeo explícito de superficies Server para tema claro y sincronizar el tema con el panel administrativo.

### P1 — endurecimiento de paridad

- [x] Mantener atrás/adelante y recarga directa en `/view/*`, `/detail/*` y `/library/*`.
- [x] Conservar `/app/*` como alias temporal sin usarlo en enlaces ni pruebas nuevas.
- [x] Validar CSP, `frame-ancestors`, `X-Frame-Options`, privacidad de anotaciones y separación de credenciales.
- [x] Fijar pruebas de que los selectores son `select`, el modal privado no existe y la administración se abre desde Ajustes.
- [x] Añadir una fixture reproducible con temas, relaciones, informe e imagen para QA visual.

### P2 — capacidades nativas

Browser, Radar, Compass y Toolkit dependen de navegación embebida, procesos locales o acceso al sistema operativo. No forman parte de la barra lateral Server y no deben simularse con datos falsos ni aparecer como controles desactivados. Una futura exposición web exigiría puertos de datos remotos y contratos de seguridad propios.

Las operaciones de edición del vault siguen siendo de Desktop. Server conserva consulta de contenido publicado y overlays privados del usuario; ampliar este límite exige autorización y un contrato de concurrencia/permisos, no cambios visuales.

## Matriz de verificación

| Caso | Oscuro | Claro | Interacción | Prueba automática |
| --- | --- | --- | --- | --- |
| Raíz y rutas profundas | Sí | Sí | recarga/atrás/adelante | `test-server-web-security.mjs` |
| Ajustes → Servidor | Sí | Sí | administración nativa completa | seguridad + E2E |
| Selector de modelos | Sí | Sí | desplegable por proveedor | E2E |
| Ideas y Autores | Sí | Sí | tabla → pestaña → dossier | E2E |
| Colecciones publicadas | Sí | Sí | tabla → pestaña → detalle | API + E2E |
| Biblioteca | Sí | Sí | tabla → lector/anotación/original | E2E |
| Grafo | Sí | Sí | temas → tema → idea → reset | API + QA visual |
| Deep Research | Sí | Sí | portada → lector → nueva pestaña | API + QA visual |

## Puertas de aceptación

Antes de fusionar cambios de paridad deben pasar:

```text
npm run typecheck
npm run build:server-web
npm run test:server-web-security
npm run test:ai-parity:strict
node --test scripts/test-nodus-server-api.mjs
```

La revisión visual se realiza a 1280×720 o superior y en móvil, en ambos temas, contra las vistas Desktop de referencia. Debe comprobar texto legible, fondos, bordes, estados activos, dropdowns, tablas, pestañas, imágenes, ausencia de iframes, desbordamiento horizontal y errores de consola.
