# Aceptación de la Biblioteca transversal

Esta matriz cierra las fases 0–9 de la implementación. `Verificado` significa
que el comportamiento se ejecuta en una prueba mecánica o end-to-end; no indica
solamente que exista un botón.

| Área | Criterio | Estado | Evidencia principal |
|---|---|---|---|
| Almacenamiento | `nodus-library` se crea dentro de la carpeta de backups | Verificado | `test-library-storage`, `e2e-global-library` |
| Almacenamiento | Originales y derivados comparten carpeta e identidad estable | Verificado | `test-library-storage`, `test-global-library-reader` |
| Almacenamiento | El catálogo SQLite no entra en el backup y es reconstruible | Verificado | `test-library-storage` |
| Almacenamiento | Registros inválidos se cuentan y se excluyen | Verificado | `test-library-storage` |
| Sincronización | Ediciones divergentes se conservan y exponen como conflicto | Verificado | `test-library-storage` |
| Seguridad | Identificadores y rutas no escapan de la Biblioteca | Verificado | `test-global-library-hardening` |
| Seguridad | Enlaces simbólicos externos no se leen ni se escriben | Verificado | `test-global-library-hardening` |
| Seguridad | Sidecars nuevos se escriben de forma atómica y privada | Verificado | `test-global-library-hardening` |
| Migración | Dos vaults se migran sin duplicar el mismo ítem Zotero | Verificado | `test-library-migration` |
| Migración | Markdown y originales existentes no se sobrescriben | Verificado | `test-library-migration` |
| Zotero | Descubre bibliotecas personales y de grupo | Verificado | `test-zotero-library-import` |
| Zotero | Conserva claves, jerarquía y pertenencia sin límite de profundidad | Verificado | `test-zotero-library-import`, `test-global-library-ui` |
| Zotero | Actualiza por versión, reanuda y no duplica adjuntos | Verificado | `test-zotero-library-import` |
| Zotero | La cancelación conserva el progreso recuperado | Verificado | `test-zotero-library-import` |
| Plugin | Estado, importación y apertura del lector llegan al escritorio | Verificado | `test-global-library-ui`, suite del plugin Zotero |
| Interoperabilidad | Importa RIS, BibTeX y CSL JSON | Verificado | `test-library-metadata` |
| Interoperabilidad | Archivos locales repetidos se detectan por hash | Verificado | `test-global-library-operations` |
| Organización | Colecciones, subcolecciones y profundidad arbitraria | Verificado | `test-global-library-operations`, `test-global-library-ui` |
| Organización | Las colecciones Zotero son espejo y las de Nodus editables | Verificado | `test-global-library-operations` |
| Organización | Búsqueda, filtros, paginación y acciones por lote | Verificado | `test-global-library-ui`, `e2e-global-library` |
| Extracción | PDF con texto produce Markdown normalizado | Verificado | `test-library-extraction` |
| Extracción | Texto no conserva espacios dobles ni palabras rotas evitables | Verificado | `test-library-extraction`, prototipos de fase 0 |
| Extracción | Figuras se extraen y tablas conservan estructura | Verificado | `test-library-extraction`, `e2e-library-reader` |
| Extracción | El mapa enlaza bloques con páginas y coordenadas | Verificado | `test-library-extraction`, `test-global-library-reader` |
| Extracción | OCR local cubre páginas sin capa de texto | Verificado | `test-library-extraction` |
| Extracción | OCR remoto requiere elección explícita de modelo | Verificado | `test-library-extraction`, contrato del servicio |
| Extracción | Cola reanuda, cancela, reintenta y publica progreso | Verificado | `test-library-extraction`, `test-global-library-ui` |
| Calidad | Informe mide Unicode, espacios, guiones, vacíos y recursos | Verificado | `test-library-extraction` |
| Lector | Renderiza Markdown, imágenes y tablas | Verificado | `e2e-library-reader` |
| Lector | Abre página temporal y original completo por separado | Verificado | `test-global-library-reader`, `e2e-library-reader` |
| Lector | Subrayados, comentarios y marcador persisten | Verificado | `test-global-library-reader`, `e2e-library-reader` |
| Lector | Panel derecho ofrece metadatos, notas y chat | Verificado | `test-global-library-ui`, `e2e-library-reader` |
| Chat | Usa el motor/modelo compartido y contexto documental | Verificado | `test-global-library-ui`, `test-global-library-reader` |
| Chat | Historial persiste junto al documento y se puede vaciar | Verificado | `test-global-library-reader` |
| Metadatos | Edición local sobrevive a nuevas sincronizaciones | Verificado | `test-library-metadata`, `e2e-global-library` |
| Metadatos | DOI/ISSN consulta Crossref e ISBN consulta Open Library | Verificado | `test-library-metadata` |
| Metadatos | Candidatos requieren revisión antes de aplicarse | Verificado | `test-global-library-ui`, `e2e-global-library` |
| Duplicados | Detección y fusión explícita conservan derivados | Verificado | `test-library-metadata`, `test-global-library-ui` |
| Vaults | El enlace es idempotente y no duplica el original | Verificado | `test-global-library-vault-integration` |
| Vaults | Análisis resuelve el Markdown global limpio | Verificado | `test-global-library-vault-integration` |
| Vaults | Un vault conectado de solo lectura rechaza escrituras | Verificado | `test-global-library-vault-integration` |
| Navegación | Biblioteca es transversal y accesible en todos los sidebars | Verificado | `test-global-library-ui` |
| Accesibilidad | Controles principales tienen rol, etiqueta y navegación por teclado | Verificado | cobertura UI e i18n, E2E Electron |
| Idiomas | Toda cadena está cubierta en los ocho idiomas de interfaz | Verificado | `test-i18n-coverage` |
| Privacidad | Red, IA, backups y sidecars están documentados | Verificado | `PRIVACY.md`, `global-library.md` |
| Licencias | No se añadió un motor de extracción externo | Verificado | lockfile sin dependencias nuevas; documentación de arquitectura |

## Puerta final

La fase se acepta únicamente si pasan, sobre un árbol de trabajo limpio salvo
fixtures ajenos:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:global-library
npm run test:e2e:library-reader
```

Las dos pruebas E2E lanzan la aplicación Electron real, guardan capturas y
fallan ante errores no controlados del renderer.
