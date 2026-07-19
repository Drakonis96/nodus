# Nodus Protect — matriz de paridad con IDprotector v0.4.1

Versión de la matriz: **1.0.0 · 2026-07-19**

Referencia original: **IDprotector v0.4.1**, commit `9f523158de3d597bdfe6bf35a6319c5f45c5c70c`

Licencia: MIT; atribución íntegra en [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Esta matriz es el contrato de salida del port. `A-*` identifica una comprobación automatizada y `M-*` un escenario manual reproducible. Una fila solo puede considerarse cubierta cuando existe implementación y evidencia; no se permiten `TODO`, `skip` ni filas sin escenario.

## Evidencia ejecutable

- `A-ENG`: `node scripts/test-protect-engine.mjs` — vectores IDPS fijos, prueba cruzada contra el JavaScript original, geometría y patrones dorados.
- `A-DB`: `node scripts/test-protect-persistence.mjs` — migración v90, CRUD, SHA-256 y lápidas sin BLOB. La tabla prevista inicialmente para v88 se desplazó porque `main` ya reservaba v88–v89 para el endurecimiento de sincronización.
- `A-SYNC`: `node scripts/test-sync-package.mjs` — exportación/mezcla `.nodussync`, newest-wins y borrado lógico.
- `A-I18N`: `node scripts/test-i18n-coverage.mjs` — mismo conjunto exacto de claves en siete idiomas y sin fallback visible.
- `A-UI`: `node scripts/test-toolkit-ui.mjs` y `node scripts/e2e-smoke.mjs` — hub, navegación, estados y smoke de Electron.
- `A-IPC`: `node scripts/test-protect-ipc.mjs` — referencias, formatos, MIME/firma, artefactos y rutas no autorizadas.
- `A-BUILD`: `npm run typecheck && npm run build`.

## Integración y ciclo de sesión

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| UI-01 | Hub 2×2 con Convert y Protect en desarrollo, Presenter y OCR próximos | `ToolkitView.tsx`; A-UI | ✅ |
| UI-02 | Port React/TypeScript, sin iframe ni WebView | `ToolkitProtectView.tsx`, `src/lib/protect/*`; A-UI | ✅ |
| UI-03 | Portada con Proteger y Verificar | `ProtectHome`; A-UI | ✅ |
| UI-04 | Estilo, tema, cabeceras, atrás, carga, avisos, confirmación y acento ámbar | componentes Toolkit/`ConfirmModal`; M-UI-01 | ✅ |
| UI-05 | Idioma global sin selector duplicado | `t/tx`, `AppLanguage`; A-I18N | ✅ |
| UI-06 | Conservar flujo al salir y volver al Toolkit | singleton `protectSession`; M-UI-02 | ✅ |
| UI-07 | «Proteger más» reinicia documento/ajustes y conserva registro | `resetDocument` conserva `issuedCopies`; A-REG/M-UI-03 | ✅ |
| UI-08 | Cerrar Nodus elimina registro y frases | memoria de módulo renderer; A-REG | ✅ |

## Entrada, composición y seguridad documental

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| IN-01 | Disco y bóveda en protección y verificación | `SourcePicker`, IPC Protect; A-IPC/M-IN-01 | ✅ |
| IN-02 | Selector nativo y arrastrar/soltar | preload `webUtils.getPathForFile`; A-IPC/A-UI | ✅ |
| IN-03 | Protección múltiple ordenada; verificación única | selector, reordenación y modo discriminado; M-IN-02 | ✅ |
| IN-04 | PDF, PNG, JPEG/JPG, GIF, WebP, BMP, HEIC y HEIF | firma+MIME+extensión; fixtures A-IPC | ✅ |
| IN-05 | Mezcla concatenada y PDF predeterminado si existe alguno | `loadProtectPages`; A-UI | ✅ |
| IN-06 | PDF cifrado, dañado o vacío con error accionable | errores `PasswordException`/`InvalidPDFException`/sin páginas; A-IPC | ✅ |
| IN-07 | PDF a 1600 px e imágenes ≤2600 px | constantes del motor; A-ENG | ✅ |
| IN-08 | Decodificación diferida, LRU 3 y exportación secuencial sin límite arbitrario | `ensureProtectPage`, LRU y bucles secuenciales; A-ENG | ✅ |
| IN-09 | HEIC/HEIF consistente en el proceso principal | `normalizeHeic`, `@napi-rs/canvas`; A-IPC/M-PKG-01 | ✅ |
| IN-10 | Primer fotograma decodificable de GIF/WebP animado | `createImageBitmap`; fixture A-IPC | ✅ |
| IN-11 | Original inalterado | solo lectura, hash fixture antes/después; A-SEC | ✅ |
| IN-12 | Resultado sin texto, capas ni metadatos fuente | compositor raster + PDF nuevo; A-SEC | ✅ |

## Fuentes de la bóveda y aislamiento

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| VAULT-01 | Zotero local; nube deshabilitada y sin descarga automática | `listZoteroSources`; A-IPC/M-VLT-01 | ✅ |
| VAULT-02 | Archivo de genealogía/fuentes/testimonios | adaptador `archive_items`; A-IPC | ✅ |
| VAULT-03 | Materiales de estudio/docencia | adaptador `study_materials`; A-IPC | ✅ |
| VAULT-04 | Adjuntos de base con base, fila y campo | adaptador `db_attachments`; A-IPC | ✅ |
| VAULT-05 | Copias protegidas en cualquier bóveda | `protect_copies`; A-DB | ✅ |
| VAULT-06 | Estado vacío si no hay fuentes compatibles | `SourcePicker`; M-VLT-02 | ✅ |
| VAULT-07 | Cambio de bóveda invalida referencias y confirma descarte | `vaultId` + `onVaultChanged`; A-IPC/M-VLT-03 | ✅ |
| VAULT-08 | Renderer no accede a rutas ni IDs de otra bóveda | allowlist de disco + `ensureActiveVault`; A-IPC | ✅ |

## Editor de ocultación

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| ED-01 | Navegación multipágina | `RedactionEditor`; M-ED-01 | ✅ |
| ED-02 | Barra negra opaca, recta y en cualquier ángulo | `fillRotatedRect`; A-ENG | ✅ |
| ED-03 | Grosores 10/20/34/52/74 | control exacto; A-UI | ✅ |
| ED-04 | Desenfoque área 16–160, intensidad 2–30, inicial 52/8 | editor/UI; A-ENG | ✅ |
| ED-05 | Seleccionar, mover, extremos, borrar | `ProtectEditor`; A-ENG/M-ED-02 | ✅ |
| ED-06 | Deshacer altas, cambios y eliminaciones por página | pila discriminada; A-ENG | ✅ |
| ED-07 | Copia proporcional a todas las páginas | `cloneRedactionForPage`; A-ENG | ✅ |
| ED-08 | Pan, zoom ±, ajustar, rueda al puntero, máximo 8× y pinza | `ProtectEditor`; A-ENG/M-ED-03 | ✅ |
| ED-09 | Recorte visual, borrar y aplicar con mínimo 24 px | `MIN_PROTECT_CROP`; A-ENG | ✅ |
| ED-10 | Rotar 90° izquierda/derecha | `rotateProtectPage`; A-ENG | ✅ |
| ED-11 | Enderezado −10°…+10° en 0,5°, no destructivo | preview + consolidación; A-ENG | ✅ |
| ED-12 | Transformar marcas al recortar/rotar; crop vacía historial; rotate consolida straighten | geometría editor; A-ENG | ✅ |
| ED-13 | Escala de grises completa | compositor; A-SEC | ✅ |
| ED-14 | Controles contextuales y texto de continuación adaptado | UI por herramienta/contador; A-UI | ✅ |
| ED-15 | Supr/Retroceso salvo foco de formulario | manejador de teclado; A-ENG/M-ED-04 | ✅ |
| ED-16 | Pointer capture, ratón, trackpad y táctil | pointer events + touch-action; M-ED-05 | ✅ |

## Marca de agua y pie legal

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| WM-01 | Interruptor y texto ≤100 | modelo/UI; A-UI | ✅ |
| WM-02 | Siete algoritmos: denso, topográfico, diagonal, malla, cuadrícula, único, manual | `watermark.ts`; dorados A-ENG | ✅ |
| WM-03 | Opacidad 4–80 % (18 %) y tamaño 10–60 (22) | defaults/rangos; A-ENG | ✅ |
| WM-04 | Seis colores y selector libre | `PROTECT_SWATCHES`; dorados A-ENG | ✅ |
| WM-05 | Firma Nodus Protect con versión | copy del compositor; A-ENG | ✅ |
| WM-06 | Manual: una inicial, ilimitadas, texto, posición normalizada y ángulo ±45° | UI/modelo; A-ENG/M-WM-01 | ✅ |
| WM-07 | Arrastre, reset, añadir/eliminar sin borrar la última | `PreviewCanvas`/UI; M-WM-02 | ✅ |
| WM-08 | Variación determinista por página y preview=export | PRNG/único compositor; dorados A-ENG | ✅ |
| WM-09 | Preview viva multipágina | `PreviewCanvas`; M-WM-03 | ✅ |
| FT-01 | Pie plegable, franja blanca, ajuste, azul y mensaje destacado | compositor/UI; dorados A-ENG | ✅ |
| FT-02 | RGPD EUR-Lex localizado | mapa de siete idiomas; A-ENG | ✅ |
| FT-03 | 32 autoridades y URLs oficiales | `PROTECT_AUTHORITIES`; A-ENG | ✅ |
| FT-04 | País por idioma hasta cambio manual | `DEFAULT_AUTHORITY`; A-ENG | ✅ |
| FT-05 | Email/teléfono opcionales | modelo/UI/compositor; A-ENG | ✅ |
| FT-06 | Mensaje ≤260, idioma global hasta primera edición | `messageCustom`; A-I18N/M-FT-01 | ✅ |
| FT-07 | Continuación adaptada sin marca/pie | UI resultado; A-UI | ✅ |

## Exportación, registro y biblioteca

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| EX-01 | Preview multipágina y selector Imagen/PDF | `ResultStep`; A-UI | ✅ |
| EX-02 | Una página imagen→PNG; varias→ZIP ordenado | `buildProtectArtifact`; A-ENG | ✅ |
| EX-03 | PDF raster: JPEG 0,92 sin traza; PNG con traza | `pdf-lib` compositor; A-ENG/A-SEC | ✅ |
| EX-04 | Sufijo localizado en siete idiomas | `SUFFIX`; A-I18N | ✅ |
| EX-05 | Guardar, bóveda y compartir independientes | `ResultStep`/IPC; A-UI | ✅ |
| EX-06 | ID nuevo por acción completada; cancelación sin registro | artefacto por acción + registro tras éxito; A-REG | ✅ |
| EX-07 | ShareMenu Electron y fallback de guardado | proceso principal; M-PKG-02 | ✅ |
| EX-08 | Escritura temporal+rename y sobrescritura del sistema | `writeArtifactAtomically` + diálogo nativo; A-IPC | ✅ |
| EX-09 | CSV exacto y escapado; `nodus-protect-registro.csv` | `issuedCopiesCsv`; A-REG | ✅ |
| LIB-01 | Migración v90 con UUID, MIME, SHA, BLOB, origen, fechas y borrado | migración/repo; A-DB | ✅ |
| LIB-02 | Listar, leer, guardar, descargar, reutilizar y borrar con confirmación | IPC + listado UI; A-DB/M-LIB-01 | ✅ |
| LIB-03 | Borrado vacía BLOB y conserva lápida | repo; A-DB | ✅ |
| LIB-04 | Backup completo incluye tabla | copia integral de SQLite; A-DB | ✅ |
| LIB-05 | `.nodussync` retrocompatible, merge UUID/updated_at/tombstone y resumen | `syncPackage`; A-SYNC | ✅ |

## IDPS v1 y verificación

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| IDPS-01 | Trazabilidad apagada; etiqueta ≤120 y frase opcional | defaults/UI; A-UI | ✅ |
| IDPS-02 | Registro de 24 bytes `IDPS`, versión, flags e ID aleatorio de 8 bytes | `stego.ts`; vectores A-ENG | ✅ |
| IDPS-03 | HMAC-SHA256 truncado | Web Crypto; vectores A-ENG | ✅ |
| IDPS-04 | Abierto y PBKDF2, sal original pública, 310.000 iteraciones | byte parity A-ENG | ✅ |
| IDPS-05 | LSB RGB cíclico, mayoría y 4096 candidatos | `decodeIdps`; A-ENG | ✅ |
| IDPS-06 | PNG iTXt sin comprimir y PDF Title/Subject/Keywords | metadata port; A-ENG | ✅ |
| IDPS-07 | Claves técnicas `idprotector`, `idps1`, `copyId:<hex>`; Producer/Creator Nodus | engine; A-ENG | ✅ |
| IDPS-08 | Compatibilidad bidireccional con IDprotector v0.4.1 | JavaScript original ↔ TypeScript; A-ENG | ✅ |
| IDPS-09 | Registro solo en sesión y nunca frases | `session.ts`; A-REG | ✅ |
| IDPS-10 | Explicación: autentica, no cifra; transformaciones destruyen marca | UI localizada; A-I18N | ✅ |
| VER-01 | PDF/imagen desde disco, bóveda o biblioteca | selector común; A-UI | ✅ |
| VER-02 | Cambiar frase y reintentar sin releer | caché `verifyPayloadCache`; A-UI | ✅ |
| VER-03 | iTXt PNG y metadatos PDF | parser; A-ENG | ✅ |
| VER-04 | Primer XObject exacto; raster fallback con aviso | `exactPdfPageImageData`; A-ENG | ✅ |
| VER-05 | Todas las páginas; verificada prevalece; si no, primera no autenticada | bucle de verificación; A-ENG | ✅ |
| VER-06 | Separación píxeles/metadatos y tres estados | `VerifyStep`; A-UI | ✅ |
| VER-07 | ID, clave, concordancia, candidatos, página y registro de sesión | resultado UI; A-UI | ✅ |
| VER-08 | Nunca afirmar que no estaba protegido | copy localizada; A-I18N | ✅ |
| VER-09 | Sin Web Crypto: metadatos visibles y autenticación indisponible | rama `idpsAvailable`; A-ENG | ✅ |

## Italiano, documentación y empaquetado

| ID | Paridad exigida | Implementación/evidencia | Estado |
| --- | --- | --- | --- |
| I18N-01 | `AppLanguage=it`, normalización, ajustes, tutorial, recuperación/runtime | tablas compartidas/UI; A-I18N | ✅ |
| I18N-02 | Tabla italiana completa, exactamente mismas claves | `i18n.it.ts`; A-I18N | ✅ |
| I18N-03 | Dominio, parentesco y todas las notas históricas en italiano | módulos `.it.ts`; A-I18N | ✅ |
| I18N-04 | Protect completo en siete idiomas | `i18n.protect.ts`; A-I18N | ✅ |
| I18N-05 | `PromptLanguage` sin italiano | tipos/tutorial/Settings; A-I18N | ✅ |
| DOC-01 | Ayuda, Toolkit, novedades y privacidad precisa | README, FAQ, Nodi docs, release notes | ✅ |
| PKG-01 | macOS/Windows/Linux: worker PDF, HEIC, guardado y share fallback | M-PKG-01/M-PKG-02 por artefacto CI | ✅ escenario |
| NET-01 | Cero acceso de red durante procesamiento Protect | sin API de red en motor/servicio; A-IPC/M-NET-01 | ✅ |
| REG-01 | Cero regresiones en Nodus Convert | suite Toolkit existente + build; A-UI/A-BUILD | ✅ |

## Guiones manuales reproducibles

1. **M-UI-01…03**: abrir Protect en claro y oscuro y en cada idioma; iniciar un documento, salir a otra vista y volver; emitir una copia, pulsar «Proteger más» y comprobar que el documento se vacía pero el registro permanece.
2. **M-IN-01…02**: arrastrar una mezcla PDF/PNG/HEIC, reordenarla, comprobar la salida PDF predeterminada; en Verificar confirmar que solo se admite una fuente.
3. **M-VLT-01…03**: en cada tipo de bóveda listar su fuente; comprobar Zotero local/no local; cambiar de bóveda con cambios y aceptar/rechazar el descarte.
4. **M-ED-01…05**: recorrer un PDF de cuatro páginas con ratón, trackpad y táctil; crear/mover/redimensionar/borrar; usar rueda, zoom al puntero, pinza, pan y teclas Supr/Retroceso dentro y fuera de un input.
5. **M-WM-01…03 / M-FT-01**: crear varias marcas manuales, arrastrarlas, variar página, intentar borrar la última y comparar píxel a píxel preview/export; editar el mensaje legal y cambiar de idioma para comprobar que no se sobrescribe.
6. **M-LIB-01**: guardar una copia en la bóveda, reutilizarla, descargarla y borrarla tras confirmar; sincronizar y comprobar la lápida en el segundo dispositivo.
7. **M-PKG-01…02**: ejecutar el instalador CI de cada SO con HEIC real y PDF multipágina; guardar con sobrescritura y compartir (ShareMenu en macOS, diálogo de guardado en Windows/Linux).
8. **M-NET-01**: bloquear/registrar tráfico saliente del proceso, completar protección y verificación y comprobar cero solicitudes; otras funciones de Nodus quedan fuera de este escenario.

## Criterio de salida

La entrega se bloquea si cualquier prueba anterior falla, aparece una fila pendiente, cambia un vector IDPS, existe texto extraíble en un PDF protegido, se modifica el hash de un original, Protect realiza una solicitud de red o las tarjetas de Convert/Protect dejan de figurar como disponibles.
