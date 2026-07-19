# Auditoría de copias de seguridad y recuperación

Fecha: 2026-07-19 · Rama base: `claude/backup-recovery-audit-9727f4` · Esquema: v87

> **Estado: CORREGIDO.** Los tres bloques se han implementado y verificado
> (531/531 tests, build y smoke e2e con la app real sobre esquema v87). Cada
> corrección se comprobó además *neutralizándola temporalmente* para confirmar que su
> test la detecta; el detalle está en «Verificación» al final. El diagnóstico original
> se conserva íntegro porque explica por qué el código es como es ahora.

Alcance: `.nodus` (copia cifrada automática y manual), la restauración, el ciclo de
vida de las credenciales, y `.nodussync` (traspaso entre equipos). Pregunta rectora:
**¿puede una bóveda quedar irrecuperable, y qué falla al cambiar de dispositivo?**

---

## Resumen ejecutivo

El diseño criptográfico y el modelo de datos son sólidos. Los fallos no están en el
cifrado: están en **la atomicidad de la restauración**, en **el silencio ante fallos**
y, sobre todo, en que **`.nodussync` promete un traspaso entre equipos que no cumple**.

Tres conclusiones:

1. Existen dos rutas por las que una bóveda queda **destruida sin posibilidad de vuelta atrás**.
2. Hay al menos cinco rutas por las que **las copias dejan de hacerse en silencio**,
   mientras la interfaz sigue mostrando el último estado correcto. Es el peor fallo
   posible en un sistema de copias: falsa seguridad.
3. `.nodussync` **no transporta las notas del profesorado, el taller de escritura ni
   toda la capa genealógica**, y puede quedar roto de forma permanente por un choque de
   nombres de curso académico que la app invita a provocar.

---

## Lo que está bien (no tocar)

- **Cripto**: AES-256-GCM + scrypt (N=32768, 64 MB), IV y sal aleatorios por copia,
  hash SHA-256 del texto claro y del cifrado verificados en la restauración
  (`backupCrypto.ts:88-108`).
- **Clave de recuperación independiente** (formato v6): la carga útil se cifra con una
  clave estable y esa clave se envuelve con la contraseña. Cambiar la contraseña no
  invalida las copias antiguas, porque la clave de recuperación sigue abriendo la carga
  útil directamente (`exportImport.ts:405-425`). Buen diseño.
- **Kit de recuperación reexportable** desde Ajustes con ambas credenciales
  (`ipc.ts:3227-3262`), no solo una vez en el asistente.
- **Restauración multi-bóveda «merge-safe»**: valida todo en temporales antes de tocar
  nada, y nunca borra bóvedas locales ausentes del archivo (`exportImport.ts:511-556`).
- **Adjuntos como BLOB en SQLite**, no como rutas: evidencias, retratos, materiales,
  grabaciones y adjuntos de bases de datos viajan en la copia. Decisión deliberada y
  correcta (`migrations.ts:1100-1103`).
- **El merge de `.nodussync` es atómico**: una sola transacción, WAL. Matar la app a
  mitad revierte limpiamente. No hay corrupción posible por ahí.

---

## A. Rutas por las que una bóveda queda irrecuperable

### A1 · La restauración borra la base de datos antes de copiar la nueva — CRÍTICO

`vaultRegistry.ts:272-273`:

```ts
removeSqliteDatabaseFiles(record.path);   // borra .sqlite, -wal, -shm
fs.copyFileSync(sourceFile, record.path); // y AHORA copia
```

Entre esas dos líneas la bóveda no existe. Si `copyFileSync` falla a media escritura
(disco lleno, volumen desmontado, corte de luz), queda un fichero truncado donde había
una bóveda.

La red de seguridad no cubre este caso. `restoreBackupArchiveSafely` hace una copia
previa y, si algo falla, revierte — pero **la reversión usa exactamente la misma ruta
no atómica** (`exportImport.ts:352`), y la copia de seguridad previa se escribe en
`userData/restore-safety/`, **en el mismo disco que está fallando**
(`exportImport.ts:332`). Ante un `ENOSPC`, el rescate falla por la misma causa que el
accidente. Con varias bóvedas, las ya restauradas quedan bien y la que falló se pierde.

- **Arreglo**: copiar a `<destino>.tmp` en el mismo directorio y `rename()` encima.
  El rename es atómico en el mismo sistema de ficheros y elimina la ventana entera.
- **Cobertura de test**: ninguna. `test-backup-vaults.mjs` solo prueba el camino feliz y
  la contraseña incorrecta; `restoreBackupArchiveSafely` no se ejerce nunca.

### A2 · No hay bloqueo de instancia única — CRÍTICO

`grep -rn "requestSingleInstanceLock" electron/` no devuelve nada.

Dos instancias de Nodus abiertas sobre la misma bóveda es un escenario que la app no
impide. Si una restaura mientras la otra tiene la BD abierta, la primera borra el
fichero y la segunda sigue escribiendo sobre un inodo ya desenlazado: sus cambios se
pierden y el WAL puede quedar desincronizado del fichero nuevo. Las dos instancias
también pueden lanzar copias automáticas simultáneas sobre las mismas bóvedas.

Esto ya aparecía en auditorías anteriores (genealogía, MCP). Aquí es más grave porque la
operación en juego es destructiva por diseño.

### A3 · `.nodussync` reemplaza bases de datos enteras — CRÍTICO

`databasesRepo.ts:1088-1091`:

```ts
db.prepare('DELETE FROM db_databases WHERE id = ?').run(unit.database.id); // cascades all children
```

La unidad de conflicto es **la base de datos entera**; la unidad de edición es **una
celda**. `updated_at` se toca en cualquier mutación (`databasesRepo.ts:462-463`, 12
llamantes). Consecuencia:

> El equipo A añade una fila a las 10:00. El equipo B había añadido cincuenta a las
> 09:00. Se importa el paquete de A en B → gana A → **las cincuenta filas de B, sus
> celdas y sus adjuntos se borran**. El resumen informa `databases: {updated: 1}`.

El test lo da por bueno explícitamente (`test-sync-package.mjs:216`,
`'stale B row replaced away'`). No es un caso límite: es el uso normal en dos equipos.

---

## B. Copias que se detienen en silencio

Este bloque es, en conjunto, más peligroso que el A: el usuario cree estar protegido.

### B1 · Si la contraseña maestra no se puede leer, no se registra ningún error

`autoBackup.ts:225-226`:

```ts
if (!settings.autoBackupFolder || !getBackupPassword()) return null;
```

`getBackupPassword()` devuelve `null` también cuando el fichero existe pero `safeStorage`
no lo puede descifrar (`secretStore.ts:70-81`): cambio de contraseña de sesión,
migración con Migration Assistant, llavero recreado. En ese caso `maybeRunAutoBackup`
sale por `return null` **sin escribir `lastAutoBackupStatus`**.

Resultado: `lastAutoBackupAt` y `lastAutoBackupStatus` se quedan congelados en el último
éxito. La interfaz sigue mostrando *«12/01/2026 · ok: Copia guardada en…»* durante meses
mientras no se hace ni una sola copia.

### B2 · Una clave API ilegible aborta todas las copias

`exportImport.ts:215-218`: si `lockedApiKeyProviders()` no está vacío,
`createBackupArchive` lanza. Es decir, un blob de clave API que el llavero ya no puede
descifrar **bloquea la copia de la biblioteca entera**. La intención (no perder claves
silenciosamente) es razonable, pero el precio es desproporcionado: se sacrifica la copia
de todo el corpus para proteger una credencial que el usuario puede volver a pegar en
treinta segundos. Debería avisar y continuar sin esa clave.

### B3 · Nunca se comprueba que una copia escrita se pueda descifrar, y se podan las anteriores

`runAutoBackupNow` escribe el archivo y acto seguido llama a `pruneBackups`
(`autoBackup.ts:208-210`). No hay ninguna verificación de que el `.nodus` recién escrito
se pueda abrir con la credencial que el usuario tiene. Si la contraseña del llavero se
rota o se corrompe, las copias nuevas se cifran con algo que el usuario no conoce y la
poda va borrando las antiguas, que sí eran recuperables.

La verificación del asistente inicial (`recoveryManager.ts:194`) solo lee el manifiesto
en claro; **no descifra nada**.

- **Arreglo mínimo**: tras escribir, reabrir el archivo y descifrar únicamente
  `payload-manifest.json`. Es barato y convierte la copia en verificada.
  Y podar solo si esa verificación pasa.

### B4 · La salud de las copias no se muestra en ninguna parte visible

El único indicador de todo el sistema es un `<span>` truncado, en gris `neutral-500`,
dentro de una sección plegable de Ajustes (`Settings.tsx:1199-1204`). No hay:

- aviso de antigüedad («tu última copia tiene 47 días»),
- aviso cuando `recoveryStatus.folder.kind === 'missing'` — se calcula
  (`recoveryManager.ts:138`) y **no se usa para nada** salvo abrir el asistente,
- notificación al fallar: `main.ts:458` solo hace `console.log`.

### B5 · Todo el archivo se construye en memoria

`createBackupArchive` lee cada BD entera a `Buffer`, las mete en un zip en memoria,
lo serializa a otro `Buffer` y lo cifra a un tercero. Con varias bóvedas grandes
(grabaciones, adjuntos, retratos, todo en BLOB) esto es un múltiplo del tamaño real en
RAM del proceso principal, cada 30 minutos. Pasado cierto umbral —una sola BD por encima
de 2 GB rompe `readFileSync`— **las copias dejan de funcionar para siempre** con un
error que no se muestra en ningún sitio (ver B1/B4).

---

## C. Cambio de dispositivo: qué se pierde y qué se rompe

### C1 · `nodi-notes.json` no está en la copia — PÉRDIDA REAL

`nodiNotes.ts:20` escribe hasta 500 notas Markdown del usuario en
`userData/nodi-notes.json`. La lista blanca de la copia (`exportImport.ts:99`) incluye
su fichero hermano `nodi-chat-history.json` pero **no este**. Se pierden sin aviso.

Está en tu instalación real, modificado el 18 de julio. Es una omisión, no una decisión:
los dos ficheros los escribe código casi idéntico. El arreglo es añadir el nombre a
`GLOBAL_AUXILIARY_FILES`; la restauración ya trata genéricamente cualquier nombre de esa
lista (`exportImport.ts:598-602`), así que con eso funcionan las dos direcciones.

### C2 · `zoteroStoragePath` viaja con la ruta absoluta del otro equipo — ROMPE EL CORPUS

`zoteroStoragePath` vive en la fila `settings` de la BD (`settingsRepo.ts:96`), no en
`app-prefs.json`. La fila de settings **sí** va en la copia: `scrubSettings` solo quita
`mcpToken` y `providerKeys` (`exportImport.ts:632-638`).

Al restaurar en otro Mac con otro usuario, la bóveda queda apuntando a
`/Users/nombre-antiguo/Zotero/storage`. Todo lo que resuelve PDFs por disco falla en
silencio (`textExtractor.ts:560-566`): reescaneo, OCR, extracción nueva, abrir por
página. El texto ya extraído y los embeddings sobreviven, así que **no es pérdida, es
ceguera**. El respaldo `defaultZoteroStorage()` solo actúa si la cadena está vacía: una
ruta obsoleta es peor que ninguna.

Lo llamativo es que el código **ya conoce este peligro** y lo defiende para
`app-prefs.json` (`exportImport.ts:580-585`, «Absolute folder paths … belong to this
machine»). Solo falta aplicar el mismo criterio a `zoteroStoragePath` y a
`toolkitOutputDir` en la fila de la BD.

### C3 · Otros elementos no incluidos

| Elemento | Efecto |
|---|---|
| `audio_key_*.bin` (Hume TTS) | Se pierde; hay que volver a introducirla. Omisión fácil de corregir. |
| `backup_password.bin`, `backup_recovery_key.bin` | Correcto excluirlos (van ligados a `safeStorage`), pero tras restaurar **la protección queda desactivada** sin que se avise. |
| `local-ai/`, `whisper.cpp/models/`, `tessdata/` | Descargas de varios GB a repetir. Correcto excluirlos. |
| `~/.nodus-copilot-certs/`, manifiesto de Word | Fuera de `userData`. Hay que reinstalar el complemento y volver a confiar la CA. |
| `codex-subscription/`, `github-copilot-subscription/` | Reautenticación. |

Ninguno de estos justifica cambiar el formato, pero sí **una lista de comprobación
posterior a la restauración**, que hoy no existe.

---

## D. `.nodussync`: el traspaso entre equipos no cumple lo que promete

Es la parte más débil del sistema y la que peor comunica sus límites.

### D1 · Módulos enteros que nunca se sincronizan

La cobertura es dinámica solo para `study_*` (`syncPackage.ts:193-196`, `LIKE 'study\_%'`).
Todo lo demás son listas de columnas escritas a mano. Quedan fuera:

- **Docencia completa**: `teaching_groups`, `teaching_students`,
  `teaching_assessment_plans`, `teaching_assessment_items`, `teaching_grade_entries`,
  `teaching_rubrics`, `teaching_rubric_evaluations`, `teaching_exams`,
  `teaching_exam_questions`, `teaching_logos`. (`grep -c "teaching_" syncPackage.ts` → **0**)
- **Taller de escritura**: `projects`, `project_sections`, `project_chapters`,
  `project_chapter_versions`, `project_chapter_ideas`, …
- **Genealogía y archivo**: `persons`, `person_names`, `person_portraits`, `places`,
  `events`, `relationships`, `evidence`, `archive_items`, `archive_folders`,
  `kinship_suggestions`, `social_contacts`, …
- **Mapa de investigación**, chats, traducciones, imágenes decorativas, `match_feedback`.

El caso de docencia es el más engañoso: `teaching_exams.course_id` referencia
`study_courses(id)` (`migrations.ts:2784`), que **sí** se sincroniza. Un profesor
sincroniza casa↔centro, ve `study: {inserted: 200}` y concluye que el cuaderno de
calificaciones ha viajado. Ninguna nota lo ha hecho. `SyncMergeSummary`
(`shared/types.ts:2412-2421`) ni siquiera tiene un contador de docencia donde pudiera
verse un cero.

### D2 · Un curso académico duplicado rompe la sincronización para siempre — CRÍTICO

`migrations.ts:2731`: `CREATE UNIQUE INDEX idx_study_academic_years_label ON study_academic_years(label);`

`createStudyAcademicYear` deduplica por etiqueta **solo en local** y genera un UUID
nuevo. `normalizeAcademicYearLabel` canonicaliza la cadena, así que los dos equipos
producen `"2024/2025"` byte a byte idéntico con ids distintos.

> Se crea 2024/2025 en el portátil. Se crea 2024/2025 en el sobremesa — que es lo único
> que la app permite hacer. Al sincronizar, el id es desconocido, se toma la rama
> `INSERT` (`syncPackage.ts:251-255`) y salta
> `UNIQUE constraint failed: study_academic_years.label`.

Como el merge es una sola transacción, **se revierte todo**: notas, borradores, bases de
datos, el resto de tablas de estudio. Y volverá a fallar en la misma fila en cada intento
futuro, **en las dos direcciones**. El usuario ve una cadena cruda de SQLite, sin saber
qué entidad la provoca ni que renombrar un curso lo arreglaría.

Dado que el módulo gira alrededor del curso académico, esto no es improbable: es casi
inevitable. (Variante menor con `db_databases.short_id`, 4 caracteres, comprobación de
colisión solo local: ~1 entre 400 con 50 bases por equipo.)

### D3 · No hay tombstones: lo borrado resucita

Explícito por diseño (`syncPackage.ts:16-17`). Notas y carpetas se borran en duro
(`notesRepo.ts:184`, `:242`), así que al importar cualquier paquete anterior al borrado
la rama `INSERT` las revive con sus marcas de tiempo originales — y lo seguirá haciendo
en cada sincronización. **No hay forma de borrar nada de manera definitiva entre dos
equipos.** Excepción parcial y correcta: las entidades de estudio usan borrado suave
(`studyOrgRepo.ts:661-675`), así que ahí sí se propaga.

### D4 · `schemaVersion` es decorativo

Se escribe en el manifiesto (`syncPackage.ts:123`) y **nunca se compara**: la validación
solo mira `format` y `formatVersion` (`syncPackage.ts:152-154`), un `1` fijo que jamás se
ha subido pese a haber cambiado la forma de la carga útil.

El caso peligroso es paquete nuevo → app antigua: las columnas desconocidas se filtran y
**se descartan en silencio** (`syncPackage.ts:245`); la fila truncada conserva el
`updated_at` nuevo, así que al sincronizar de vuelta **propaga la truncación al equipo
que sí estaba al día**. Destrucción de datos sin un solo error por el camino.

### D5 · El paquete no está cifrado

Zip plano con `user-layer.json` en claro: cuerpos de notas, documentos de estudio,
grabaciones y adjuntos en base64. Convive en Ajustes con la copia cifrada por contraseña
maestra, sin ninguna advertencia sobre la asimetría. Quien lo mueva por Dropbox o correo
está exponiendo toda su capa de escritura.

### D6 · El test valida un esquema que no es el que se distribuye

`test-sync-package.mjs` construye a mano un esquema sintético de 20 tablas en vez de
ejecutar `runMigrations`, y stubea `SCHEMA_VERSION = 28`. Por eso no detecta nada de lo
anterior: en su esquema no existen el índice único de curso académico, ni `teaching_*`,
ni `db_attachments.thumb`, ni `note_folders.summary`. Las aserciones son correctas; el
esquema contra el que las hace, no.

---

## Prioridades

**Ahora (destrucción o falsa seguridad)**

1. A1 — `rename()` atómico en `restoreVaultDatabase`. Cambio de tres líneas.
2. B1 — registrar `lastAutoBackupStatus` también cuando se sale por credencial ilegible.
3. B3 — verificar el descifrado del archivo recién escrito **antes** de podar.
4. D2 — resolver el choque de `label` por `id` en el merge (o dedupe por etiqueta) y
   aislar cada tabla para que un fallo no revierta el paquete entero.
5. C1 — añadir `nodi-notes.json` a `GLOBAL_AUXILIARY_FILES`.

**Siguiente (integridad y honestidad del sync)**

6. D1 — o se amplía la cobertura, o la interfaz declara explícitamente qué viaja.
   Lo que no se puede sostener es un resumen que no menciona lo ausente.
7. C2 — no restaurar `zoteroStoragePath` de otro equipo (mismo criterio que
   `RECOVERY_PREF_KEYS`).
8. B4 — aviso de antigüedad y de carpeta inaccesible fuera de Ajustes.
9. A2 — `requestSingleInstanceLock()`.
10. B2 — degradar el aborto por clave bloqueada a aviso.

**Deuda estructural**

11. D6 — que el test de sync corra `runMigrations` sobre el esquema real.
12. D5 — cifrar el `.nodussync` o advertir con claridad.
13. B5 — streaming en la construcción del archivo.
14. D3/D4 — tombstones y comprobación real de `schemaVersion`.

---

---

## Verificación de las correcciones

Un test que pasa no prueba nada si también pasaría sin la corrección. Cada garantía
crítica se comprobó desactivando temporalmente el arreglo y confirmando que su test
falla:

| Corrección | Al desactivarla, el test falla con |
|---|---|
| A1 · restauración atómica | `the vault database still exists after a failed restore` → **`actual: false`**: con el código antiguo la bóveda **deja de existir**. Se reproduce inyectando un `ENOSPC` en la copia (un directorio de solo lectura NO sirve: bloquea también el borrado, y la bóveda se salva por accidente). |
| C2 · rutas locales | La ruta `/Users/equipo-origen/Zotero/storage` se filtra al equipo de destino. |
| D2 · bricking por curso duplicado | Salta `UNIQUE constraint failed: study_academic_years.label` — pero **ya no aborta la fusión**: se reporta y continúa. Dos capas independientes. |
| Celdas sin marca de tiempo | `an edited cell reaches the other machine via its row timestamp`: una celda editada no viajaba. |

Tres fallos reales aparecieron *durante* la implementación, no en el diagnóstico:

1. `new AdmZip()` lanza excepción con un `.nodus` truncado en vez de devolver error —
   afectaba también a la restauración, no solo a la verificación.
2. `study_schedule_day_styles` no tiene clave primaria y su índice único es sobre una
   expresión que SQLite no sabe describir: los colores del horario no se habrían
   sincronizado nunca. De ahí `IDENTITY_OVERRIDES` y el guard `unmergeable` en el test.
3. Los veredictos de relación son sobre un par **no ordenado**; el motor genérico los
   duplicaba y las dos máquinas habrían discrepado para siempre. De ahí
   `ROW_NORMALIZERS`.

Y un riesgo que introduje yo y cerré: el barrido de claves foráneas podía borrar filas
locales preexistentes ya inconsistentes. Ahora solo puede eliminar filas que **esa misma
fusión** ha insertado, y está acotado a las tablas tocadas.

### Lo que deliberadamente NO se ha hecho

- **Tombstones.** Los borrados siguen sin propagarse: borrar una nota en un equipo y
  sincronizar desde el otro la resucita. Es el comportamiento previo, ahora extendido a
  los módulos nuevos. Requiere diseño propio (marcas de borrado con caducidad) y no
  entraba en este encargo.
- **Cifrado del `.nodussync`.** Sigue siendo un zip en claro. Ya no es un único JSON
  gigante, así que el límite de tamaño desapareció, pero el contenido no está protegido.
- **Sesgo de reloj.** El ganador sigue decidiéndose por `updated_at` de pared. Un equipo
  con el reloj atrasado sigue perdiendo siempre, aunque ahora al menos las filas no
  aplicadas se reportan.

---

## Verificado personalmente

`nodi-notes.json` fuera de la lista blanca · `zoteroStoragePath` ausente de
`GLOBAL_PREF_KEYS` · `idx_study_academic_years_label` · `teaching_` con 0 apariciones en
`syncPackage.ts` · `DELETE FROM db_databases` en el reemplazo · `schemaVersion` sin
comparar en el import · `removeSqliteDatabaseFiles` seguido de `copyFileSync` ·
`requestSingleInstanceLock` inexistente · el estado de copia como único indicador en
`Settings.tsx`.

No se ha modificado ningún fichero del código.
