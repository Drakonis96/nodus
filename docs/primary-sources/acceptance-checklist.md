# Criterios de aceptación

Estado final de los 36 criterios del plan. “Verificado” significa que existe una
prueba automatizada que recorre el comportamiento o su contrato persistente, no
solo que la interfaz contiene un control.

| # | Criterio | Estado | Evidencia principal |
|---:|---|---|---|
| 1 | Crear y abrir `primary_sources` con navegación propia | Verificado | `test-vault-types`, `test-primary-sources-shell` |
| 2 | Diez secciones por defecto | Verificado | `test-primary-sources-shell` |
| 3 | Archivo como entidad central | Verificado | shell, home y repositorio archivístico |
| 4 | Importar archivos y crear referencias sin archivo | Verificado | `test-primary-sources-archive` |
| 5 | Lote con contexto y orden | Verificado | `test-primary-sources-archive`, sesión de captura |
| 6 | Jerarquía separada de colecciones | Verificado | dominio, Archivo y demo |
| 7 | Procedencia, referencia y nivel estructurados | Verificado | migraciones y repositorios |
| 8 | Original no sobrescribible por flujo ordinario | Verificado | triggers y `test-primary-sources-files-viewer` |
| 9 | Derivado con padre, transformación y hash | Verificado | `test-primary-sources-files-viewer` |
| 10 | Varios archivos/páginas por fuente | Verificado | visor y demo de tres páginas |
| 11 | OCR/transcripción versionados | Verificado | `test-primary-sources-text-criticism` |
| 12 | Automático distinguible de revisado | Verificado | estados de versión y corpus demo |
| 13 | Fragmento con cita y localizador | Verificado | `test-primary-sources-text-criticism` |
| 14 | Análisis crítico dentro del dossier | Verificado | dossier y prueba de crítica |
| 15 | IA solo crea propuestas | Verificado | `test-primary-sources-proposals-evidence` |
| 16 | Aceptación deja evidencia y auditoría | Verificado | aceptación transaccional |
| 17 | Personas conserva variantes y menciones | Verificado | `test-primary-sources-persons` |
| 18 | Identidad provisional no se fusiona sola | Verificado | personas y corpus demo |
| 19 | Cronología conserva incertidumbre y contradicción | Verificado | `test-primary-sources-derived-views` |
| 20 | Mapa conserva topónimo y ambigüedad | Verificado | vista derivada y gazetteer offline |
| 21 | Relación confirmada muestra evidencia | Verificado | repositorio exige evidencia y dossier de arista |
| 22 | Notas separadas del contenido documental | Verificado | `test-primary-sources-research-workspace` |
| 23 | Búsqueda etiqueta la capa | Verificado | búsqueda multicapa |
| 24 | Resultado abre página/fragmento exacto | Verificado | deep links y offsets estables |
| 25 | Inicio muestra tareas operativas | Verificado | dashboard con colas de atención |
| 26 | Toolkit respeta restricciones | Verificado | matriz backend de gobernanza |
| 27 | Citas incluyen repositorio, referencia y localizador | Verificado | constructor y evaluación de preparación |
| 28 | Exportaciones aplican políticas | Verificado | `test-primary-sources-governance-export` |
| 29 | Backup incluye tablas y archivos | Verificado | inventario, backup y sync |
| 30 | Restauración probada | Verificado | paquete alterado/válido y restauración como nuevo |
| 31 | Sync conserva versiones y jerarquía | Verificado | `test-sync-package` con esquema real |
| 32 | Genealogía y Archivo heredado sin regresiones | Verificado | suite global y pruebas dirigidas |
| 33 | Demo enseña flujo completo | Verificado | `test-primary-sources-release` |
| 34 | Interfaz en español e inglés | Verificado | cobertura completa en ocho idiomas |
| 35 | Mapa y grafo con alternativa tabular | Verificado | vistas derivadas y teclado |
| 36 | Rendimiento del corpus medio | Verificado | `test-primary-sources-performance` |

## Validación transversal

- TypeScript renderer y Electron: correcto.
- ESLint: cero errores; permanecen cinco avisos históricos fuera de Fuentes
  primarias.
- Privacidad: nueve de nueve pruebas.
- Suite global: 1.288 de 1.288 pruebas.
- Build Vite/Electron de producción: correcto.
- SQLite de corpus, exportación y demo: claves externas y `quick_check`
  correctos.
- i18n: mismas claves, placeholders íntegros y ninguna cadena vacía en español,
  inglés, francés, alemán, portugués europeo, portugués brasileño, italiano y
  turco.
