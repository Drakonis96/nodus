# Nodus Toolkit — Plan de implementación

> Estado: **aprobado para planificación** (2026-07-17). Alcance de este plan: la sección
> Herramientas (hub) completa + la primera herramienta, **Nodus Convert**. Las otras dos
> herramientas (PDF Presenter, AI OCR) aparecen en el hub como "Próximamente" y se
> diseñarán en planes posteriores.

---

## 1. Visión y nombres

**Nodus Toolkit** es una nueva sección de primer nivel ("Herramientas" en el sidebar)
que centraliza utilidades de proceso de archivos para investigación, docencia y estudio,
al estilo ConvertX pero con los formatos del ámbito académico. Contendrá tres
herramientas, cada una con su propia página:

| Herramienta | id interno | Estado v1 | Descripción de tarjeta (ES) |
|---|---|---|---|
| **Nodus Convert** | `convert` | ✅ se implementa ahora | Convierte documentos, PDFs e imágenes; OCR ligero y utilidades de texto, individual o en bulk. |
| **PDF Presenter** | `presenter` | 🔜 Próximamente | Presenta PDFs como diapositivas para clase. |
| **OCR Workspace** | `aiOcr` | 🔜 Próximamente | Transcripción de documentos difíciles con modelos de visión. |

Decisiones de nombre:
- La sección del sidebar se llama **"Herramientas"** (clave i18n en español, como todo).
  El nombre de marca para release notes / web es **"Nodus Toolkit"**.
- El conversor se llama **"Nodus Convert"** — encaja con el trío de nombres en inglés de
  marca y con precedentes como Deep Research. En la tarjeta el subtítulo en ES lo hace
  autoexplicativo.
- ⚠️ La tercera herramienta se implementó como **"OCR Workspace"**, no como "AI OCR"
  (el nombre que usó el usuario al encargarlo): el roadmap ya visible en la app la
  anuncia como *Nodus OCR Workspace*, y estrenar la tarjeta con otro nombre haría que
  la app se contradijera consigo misma. **Decisión reversible**: si el usuario prefiere
  "AI OCR", hay que cambiarlo en `ToolkitView.tsx`, en `NODUS_ROADMAP` y en el test.

**Principio rector**: el Toolkit es **determinista y 100 % offline** (salvo la descarga
opt-in de idiomas de Tesseract, ver §7). Nada de IA en Nodus Convert: la IA vive en la
futura herramienta AI OCR. Ninguna operación toca jamás el archivo original.

**Hallazgo clave**: casi toda la maquinaria ya está en `package.json` — `pdf-lib`,
`pdfjs-dist`, `tesseract.js`, `mammoth`, `docx`, `turndown`, `adm-zip`,
`@napi-rs/canvas`, `diff` — e incluso hay OCR funcionando en
`electron/extraction/ocr.ts` (imagen y PDF→PNG→Tesseract). El coste en bundle es ~0;
la única dependencia nueva prevista es `heic-decode` (WASM pequeño) en la fase de
imágenes.

---

## 2. Navegación e integración en el shell

### 2.1 Sidebar
- `src/navigation.ts`: añadir `'toolkit'` a la union `View` y a `NAV_ITEMS`.
- Nuevo grupo de navegación `tools` (`NavGroupId`), label **"Herramientas"**, renderizado
  tras `create` ("Escribir"). Un grupo de un solo ítem es válido (`groupedNav` ya
  tolera grupos de tamaño arbitrario y descarta los vacíos).
- Icono nuevo y único: `tools` (llave inglesa estilo feather). Recordar que
  `test-icons.mjs` valida el catálogo.
- **Vista universal**: no se añade a `VAULT_TYPE_SCOPED_VIEWS` (aparece en todos los
  tipos de vault) ni a ningún `defaultHiddenViews`. Limitación conocida: los tipos
  preview (`docencia`, `worldbuilding`) solo permiten `home`; el Toolkit no estará ahí
  hasta que dejen de ser preview — aceptado para v1.

### 2.2 Header
- Añadir un `HeaderAction` (icono `tools`) en la fila de acciones del top bar de
  `App.tsx` que navega a la vista `toolkit` desde cualquier sitio. Mismo patrón
  `h-9 min-h-9 px-2.5` que el resto de acciones del header.

### 2.3 Otras superficies
- `CommandPalette`: comando "Ir a Herramientas" (+ "Abrir Nodus Convert").
- `shared/nodiDocumentation.ts` (`NODUS_ROADMAP`): al lanzar, mover el ítem del Toolkit
  a "hecho" o retirarlo, y documentar la sección para que Nodi sepa explicarla.
- `WhatsNewModal`: entrada de novedades en el release que lo estrene.

### 2.4 Navegación interna del Toolkit
`ToolkitView.tsx` gestiona un sub-estado propio (no se añaden más ids a `View`):

```
type ToolkitPage = 'home' | 'convert' | 'presenter' | 'aiOcr'
```

- `home` = hub con las 3 tarjetas.
- Cada herramienta renderiza una cabecera con **botón volver** (`chevronLeft` +
  "Herramientas") y el título/icono de la herramienta — breadcrumb estilo
  "Herramientas / Nodus Convert".
- El sub-estado se conserva al cambiar de vista y volver (state en el componente App o
  módulo de estado ligero, como hace Study con `StudyNavigationTarget`).
- `presenter` y `aiOcr` en v1: tarjeta deshabilitada (badge "Próximamente", opacidad
  reducida, sin onClick). No hay página placeholder navegable — menos superficie que
  testear y ningún callejón sin salida.

---

## 3. Diseño del hub (página principal de Herramientas)

Requisitos de diseño explícitos del usuario, que se convierten en checklist de PR:

- [ ] Márgenes y ritmo de espaciado idénticos al resto de vistas (contenedor
      `px-6 py-6`, `gap-3/gap-4` de la escala existente; comparar lado a lado con
      Deep Research y Home).
- [ ] Las 3 tarjetas del hub tienen **exactamente el mismo tamaño** (grid
      `sm:grid-cols-2 lg:grid-cols-3` con `h-full` en la tarjeta; el contenido no
      puede desalinear alturas).
- [ ] Botones hermanos con la misma altura (`btn` + `h-9 min-h-9`); nunca mezclar
      alturas en una misma fila.
- [ ] Iconos **perfectamente centrados**: el icono de cada tarjeta va en una "loseta"
      cuadrada fija (`h-12 w-12 rounded-xl flex items-center justify-center`) y los
      iconos de botón llevan `shrink-0`. Landmine conocida: jamás `animate-spin` en el
      mismo elemento que un `-translate-y-1/2` (el spinner "bota" y no gira) — el
      centrado va siempre en un wrapper.
- [ ] Dark y light: cualquier clase utilitaria nueva usada solo en dark necesita su
      remap `.light .<utility>` en `index.css` (`test-light-theme-utilities.mjs` ayuda,
      pero revisar visualmente ambos temas).
- [ ] Dropdowns/selects dentro de contenedores `overflow-hidden` → portal a `body`
      (landmine de Databases).

Estructura del hub:

```
┌────────────────────────────────────────────────────────┐
│ [🔧] Herramientas                                       │
│ Utilidades de proceso de archivos para investigación,  │
│ docencia y estudio. Todo local, nada sale de tu equipo.│
│                                                        │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│ │ [swap]   │  │ [presen.]│  │ [scanTxt]│               │
│ │ Nodus    │  │ PDF      │  │ AI OCR   │               │
│ │ Convert  │  │ Presenter│  │          │               │
│ │ subtítulo│  │ subtítulo│  │ subtítulo│               │
│ │          │  │ Próxima- │  │ Próxima- │               │
│ │          │  │ mente    │  │ mente    │               │
│ └──────────┘  └──────────┘  └──────────┘               │
└────────────────────────────────────────────────────────┘
```

Acento de color de la sección: **ámbar/bronce** (tono "taller"), distinto del índigo
base, del crimson de Databases y del teal de Estudio. Se usa solo en iconos-loseta,
badges y detalles — el chrome sigue siendo neutral como el resto de la app.

Iconos nuevos en `ICON_PATHS` (todos trazos feather, únicos): `tools` (llave inglesa),
`swap` (flechas de intercambio, para Convert), `scanText` (para AI OCR). PDF Presenter
reutiliza el icono `presentation` existente.

---

## 4. Nodus Convert — especificación funcional

### 4.1 UI

```
┌ Herramientas / Nodus Convert ──────────────────────────────┐
│ [←] [swap] Nodus Convert                                   │
│                                                            │
│ ┌ Categorías ┐ ┌ Zona principal ──────────────────────────┐│
│ │ Documentos │ │  ┌ Dropzone ─────────────────────────┐   ││
│ │ PDF        │ │  │  Arrastra archivos o carpetas,    │   ││
│ │ OCR        │ │  │  o haz clic para elegir           │   ││
│ │ Imágenes   │ │  └───────────────────────────────────┘   ││
│ │ Texto      │ │  Lista de archivos (nombre, tamaño,      ││
│ └────────────┘ │  estado/progreso por archivo, quitar)    ││
│                │  ┌ Opciones de la operación ┐             ││
│                │  │ Formato destino, calidad, │            ││
│                │  │ rangos de página, idioma… │            ││
│                │  └───────────────────────────┘            ││
│                │  [Carpeta de salida ▾] [□ Abrir al        ││
│                │   terminar]              [ Convertir ]    ││
│                └──────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

- Panel izquierdo de categorías: pills/botones **del mismo tamaño**, patrón visual del
  sidebar de Study/Databases.
- La operación se elige con un select "De → A" filtrado por los archivos añadidos
  (p. ej. si sueltas `.docx` solo se ofrecen las salidas válidas). Bulk = N archivos,
  misma operación.
- Progreso: lista por archivo con estado (`pendiente / procesando (x%) / hecho /
  error`), botón cancelar el lote. El job sobrevive a la navegación (corre en main;
  el renderer se re-suscribe vía `backgroundJobs.ts`).
- Resultado por archivo: ruta de salida + "Mostrar en Finder" (`shell.showItemInFolder`)
  + error legible si falló (sin stack traces al usuario).
- Estados vacíos y errores con el tono del resto de la app; textos ES como claves i18n.

### 4.2 Política de salida (regla de oro)

- **Nunca** se modifica ni sobrescribe el original.
- Destino por defecto: junto al original con la extensión nueva; si existe colisión,
  sufijo incremental ` (2)`, ` (3)`… (nunca overwrite silencioso).
- Alternativa: carpeta de salida elegida por el usuario (persistida en settings).
- Bulk conserva nombres base; operaciones N→1 (merge, imágenes→PDF) piden nombre.

### 4.3 Catálogo de operaciones v1

Cada operación lista su motor y su **test real de aceptación** (ver §6). *Regla DoD:
una operación solo se mergea con su test de procesado real en verde.*

**A. Documentos** — `electron/toolkit/convert/docs.ts`

| # | Operación | Motor | Test real (aserción principal) |
|---|---|---|---|
| A1 | PDF → TXT | pdfjs (reutiliza `pdfjsLoader`/`textExtractor`) | El TXT contiene las frases conocidas de las 3 páginas del fixture, en orden |
| A2 | PDF → Markdown | A1 + heurística ligera (títulos por tamaño de fuente, párrafos) | Encabezados `#` presentes; texto íntegro |
| A3 | DOCX → Markdown / HTML / TXT | mammoth (+ turndown para MD) | `# Título`, `**negrita**`, lista y tabla del fixture presentes |
| A4 | Markdown / HTML → DOCX | lib `docx` | Descomprimir el .docx (adm-zip) y asertar texto y estilos de heading en `document.xml` |
| A5 | Markdown / HTML → PDF | render con CSS de la app + KaTeX → `printToPDF` (main, ventana oculta) | **e2e**: extraer texto del PDF con pdfjs y casarlo; nº páginas > 0 |
| A6 | EPUB → Markdown / TXT | adm-zip + orden del spine OPF + turndown | Texto de ambos capítulos del fixture, en orden del spine |
| A7 | Markdown → EPUB | zip manual (mimetype sin comprimir + container.xml + OPF + XHTML) | Estructura válida: `mimetype` primera entrada y STORED; container/OPF parseables; capítulos con el texto |

**B. Utilidades PDF** — `electron/toolkit/convert/pdfOps.ts` (pdf-lib)

| # | Operación | Test real |
|---|---|---|
| B1 | Unir PDFs | páginas = suma; texto de ambos fixtures presente vía pdfjs |
| B2 | Dividir / extraer páginas (rangos "1-3,5") | nº páginas y texto de la página concreta correctos |
| B3 | Rotar páginas | `/Rotate` correcto en el page dict; re-abrible |
| B4 | Reordenar / eliminar páginas | orden verificado por el texto de cada página |
| B5 | Extraer imágenes incrustadas | ≥1 imagen, decodificable por canvas, dimensiones > 0 |
| B6 | Imágenes → PDF (una por página) | nº páginas = nº imágenes; tamaño de página coherente |
| B7 | Ver/editar metadatos (título, autor, tema, fecha) | round-trip: escribir → releer → igual |
| B8 | Comprimir PDF escaneado (re-render a JPEG, calidad configurable, etiquetado "con pérdida") | salida < entrada; mismo nº páginas; OCR-able. *Fase tardía* |

**C. OCR ligero** — `electron/toolkit/convert/ocrOps.ts` (reutiliza `extraction/ocr.ts`)

| # | Operación | Test real |
|---|---|---|
| C1 | Imagen(es) → TXT | el texto reconocido contiene las palabras clave del fixture renderizado a 300 dpi (match normalizado) |
| C2 | PDF escaneado → TXT | ídem sobre el PDF-imagen de 2 páginas |
| C3 | PDF escaneado → **PDF buscable** (sandwich: capa de texto invisible con bboxes de Tesseract vía pdf-lib) | pdfjs encuentra las palabras en las posiciones correctas; el PDF visualmente intacto (mismo nº páginas, imágenes preservadas) |
| C4 | Preprocesado: escala de grises / binarizar (Otsu) | dimensiones intactas; histograma binario; C1 sobre la imagen preprocesada sigue pasando |
| C5 | Deskew (perfil de proyección) | *Fase tardía*; ángulo detectado ±1° en fixture girado 3° |

- Idiomas Tesseract descargables bajo demanda con UI de gestión (patrón
  Piper/Kokoro), caché en userData, consentimiento reutilizando el copy de
  `ocrEnabled` (es la única llamada de red del Toolkit).

**D. Imágenes** — `electron/toolkit/convert/imageOps.ts` (@napi-rs/canvas; `heic-decode` nuevo)

| # | Operación | Test real |
|---|---|---|
| D1 | Convertir PNG/JPEG/WebP (+AVIF si el canvas lo soporta — *spike* al inicio de la fase) | salida decodificable; dimensiones intactas; magic bytes correctos |
| D2 | HEIC → JPEG/PNG | detección por magic bytes en `npm test`; la conversión real se verifica **en local contra una foto de iPhone aportada por el usuario, que nunca se commitea** (ver §6.2-bis) |
| D3 | Redimensionar (lado máx. / %) en bulk | dimensiones exactas esperadas; aspect ratio intacto |
| D4 | Comprimir (calidad JPEG/WebP) | salida < entrada; decodificable |

**E. Texto** — `shared/toolkitText.ts` (puro, sin Electron)

| # | Operación | Test real |
|---|---|---|
| E1 | Limpiador de texto pegado de PDF (des-guionado, unir líneas partidas respetando párrafos, espacios dobles, comillas) | golden tests: entrada real pegada de PDF → salida exacta esperada |
| E2 | Mayúsculas/minúsculas (Tipo oración / Título / MAYÚS / minús, con reglas ES: no capitalizar "de", "la"…) | golden tests |
| E3 | SRT/VTT → TXT limpio (sin timestamps, líneas unidas por cue) | golden test sobre entrevista fixture |
| E4 | Checksum SHA-256 / MD5 de archivos | hash conocido del fixture, byte a byte |

**F. Datos y citas** — *v1.1, planificado pero fuera del primer release*
BibTeX ↔ RIS ↔ CSL-JSON (con "importar a Zotero" vía puente existente),
CSV ↔ JSON ↔ tabla Markdown (reutilizando el parser robusto de Databases).

---

## 5. Arquitectura técnica

### 5.1 Módulos

```
electron/toolkit/
  convert/
    docs.ts        # A*  (mammoth, docx, turndown, adm-zip, pdfjs — imports lazy)
    pdfOps.ts      # B*  (pdf-lib, pdfjs)
    ocrOps.ts      # C*  (tesseract.js vía extraction/ocr.ts, canvas)
    imageOps.ts    # D*  (@napi-rs/canvas, heic-decode)
    index.ts       # registro tipado de operaciones (id, categoría, entradas, salidas)
  toolkitWorker.ts # worker_thread runner (patrón computeWorker)
  toolkitJobs.ts   # cola en main: 1 job activo, progreso, cancelación, naming de salida
shared/
  toolkitText.ts   # E* puro
  toolkitTypes.ts  # ToolkitOpId, ToolkitJobRequest/Progress/FileResult
src/views/
  ToolkitView.tsx      # hub + sub-navegación
  ToolkitConvertView.tsx
```

**Reglas duras:**
- Los módulos `convert/*` son **Electron-free** (como `databasesRepo`): imports de
  Node y libs solamente, deps pesadas con `import()` lazy (patrón de `ocr.ts`). Esto
  es lo que permite testearlos de verdad con esbuild + node:test.
- Todo el trabajo corre en `toolkitWorker.ts` (worker_thread), **nunca** en el event
  loop del main (landmine histórica de la app). *Spike en F1*: verificar
  `@napi-rs/canvas` + tesseract dentro de worker_threads en las 3 plataformas; plan B:
  `utilityProcess`.
- Excepción: A5 (`printToPDF`) necesita `BrowserWindow` → corre en main con ventana
  oculta; es I/O asíncrono de Chromium, no bloquea.
- Cancelación cooperativa: el worker comprueba una flag entre archivos y entre páginas;
  cancelar nunca deja archivos a medias (escritura a `.tmp` + rename atómico).

### 5.2 IPC y estado

- Canales: `toolkit:job:start`, `toolkit:job:cancel`, `toolkit:job:event` (progreso
  push), `toolkit:ops:list`, `toolkit:pickFiles`, `toolkit:pickOutputDir`,
  `toolkit:showInFolder`. Tipados en `NodusApi` (preload sin fugas de nombres IPC,
  como el resto).
- Renderer: `startBackgroundJob('toolkit:convert', …)` de `backgroundJobs.ts` para que
  el progreso sobreviva a la navegación y se re-suscriba al volver.
- Settings nuevas en `AppSettings` (JSON de settings, **sin migración de schema**):
  `toolkitOcrLanguages` (default `'spa+eng'`), `toolkitOutputDir` (null = junto al
  original), `toolkitOpenFolderOnDone` (bool). "Trabajos recientes" en localStorage.

### 5.3 i18n

Todas las cadenas nuevas en ES como clave + entradas en EN/FR/DE/PT/PT-BR
(`test-i18n-coverage.mjs` obliga; presupuestar este trabajo en cada fase, no al final).

---

## 6. Estrategia de testing — "ninguna operación pasa sin procesado real"

### 6.1 Fixtures reales — `scripts/fixtures/toolkit/`

Generadas una vez por `scripts/gen-toolkit-fixtures.mjs` y **commiteadas** (deterministas,
< 200 KB cada una), para que los tests sean herméticos:

| Fixture | Contenido |
|---|---|
| `sample-3pages.pdf` | PDF con capa de texto, 3 páginas con frases conocidas ES/EN + títulos con jerarquía de tamaños |
| `sample-b.pdf` | segundo PDF (para merge) |
| `scanned-2pages.pdf` | PDF **solo imagen** (texto renderizado a 300 dpi, sin capa de texto) |
| `scan-es.png`, `scan-en.jpg` | párrafos renderizados a 300 dpi para OCR |
| `scan-skewed.png` | ídem girado 3° (para C5) |
| `sample.docx` | headings, negrita, lista, tabla |
| `sample.epub` | 2 capítulos con spine definido |
| `sample.md`, `sample.html` | con encabezados, tabla y una fórmula KaTeX |
| `photo.jpg` | foto pequeña real |
| ~~`photo.heic`~~ | ⛔ **NO se commitea. Ver §6.2-bis** — una foto HEIC real es un archivo personal del usuario y no entra en el repo bajo ninguna circunstancia. |
| `interview.srt` | 6 cues con timestamps |
| `pdf-paste.txt` + `pdf-paste.expected.txt` | golden del limpiador E1 |

### 6.2 Tests unitarios (node --test, patrón esbuild-bundle existente)

`test-toolkit-docs.mjs`, `test-toolkit-pdf.mjs`, `test-toolkit-ocr.mjs`,
`test-toolkit-images.mjs`, `test-toolkit-text.mjs`, `test-toolkit-jobs.mjs`.

- Cada test bundlea el módulo real con esbuild (patrón `test-image-analysis.mjs`),
  procesa el fixture **de verdad** y aserta **contenido del resultado** (texto
  extraído, nº de páginas, dimensiones, hashes), jamás la mera existencia del archivo.
- OCR: `langPath` apuntando a una caché (`scripts/.cache/tessdata/`); primera ejecución
  descarga `spa`/`eng` (tessdata_fast); timeout generoso. Sin red y sin caché el test
  **falla** — correcto según la regla ("sin procesado real no hay verde"). CI ya tiene
  red (instala npm).
- `test-toolkit-jobs.mjs`: semántica de cola — naming anticolisión, cancelación limpia
  (no deja `.tmp`), progreso monótono, error en un archivo no aborta el lote.

### 6.2-bis HEIC: verificación local, nunca una fixture

**Regla dura: ninguna foto real del usuario entra en el repo.** Un HEIC de verdad es
un archivo personal (lleva metadatos de dispositivo, fecha y posiblemente GPS), y
además el repo es público. No se commitea ni se sube a GitHub de ningún modo.

Eso choca con la regla "sin procesado real no hay verde", porque un HEIC real no se
puede generar en CI (no hay codificador HEIC en las dependencias). Se resuelve como
ya hace el repo con Whisper y otros recursos pesados: un script `verify-*` manual,
no un test de `npm test`.

- `scripts/verify-toolkit-heic.mjs` (patrón de `verify-study-whisper.mjs`), invocado
  como `npm run verify:toolkit-heic -- /ruta/a/una/foto.HEIC`, o vía la variable
  `NODUS_HEIC_FIXTURE`. Procesa el archivo REAL y aserta el resultado (decodifica,
  dimensiones correctas, JPEG/PNG de salida válido). Si no se le pasa archivo, falla
  con un mensaje que explica cómo aportarlo — nunca se salta en silencio.
- En `npm test`/CI, D2 se cubre solo en su parte determinista: detección de HEIC por
  magic bytes / marca `ftyp` (fixture sintética mínima de unas decenas de bytes,
  construida en el propio test, sin ser una foto), y el mensaje de error cuando el
  decodificador no está disponible.
- La conversión HEIC no se da por terminada hasta que `verify:toolkit-heic` pasa en
  local contra una foto real de iPhone. El usuario aporta el archivo desde fuera del
  repo; el plan no lo referencia por ruta dentro del árbol.

### 6.3 e2e (app real)

`scripts/e2e-toolkit.mjs` (patrón `e2e-smoke.mjs`: Electron real + playwright-core +
perfil desechable):
1. Sidebar muestra "Herramientas"; el hub renderiza 3 tarjetas con igual tamaño y las
   dos "Próximamente" no navegan.
2. Entrar a Nodus Convert, cargar `sample.md`, ejecutar **MD → PDF real**
   (`printToPDF`), asertar que el PDF de salida existe y que pdfjs extrae el texto
   esperado (cubre A5, imposible en unit).
3. Volver al hub con el botón atrás; sin errores no capturados en consola.

⚠️ Landmine conocida: `test:e2e` **no** rebuidea — ejecutar `npm run build` antes o el
dist obsoleto da falsos rojos.

### 6.4 Puertas de calidad por PR

`npm run typecheck` + `npm run lint` + `npm test` + e2e afectado, más el checklist de
diseño de §3 revisado en ambos temas (dark/light) y capturas en el PR.

---

## 7. Fases de implementación

Cada fase termina con la suite completa en verde y es mergeable por sí sola.

**F0 — Sección y hub** ✅ **COMPLETADA** (2026-07-17)
`View 'toolkit'`, grupo nav `tools` (tras Escribir, antes de Ajustes), iconos
`tools`/`swap`/`scanText`, `ToolkitView` con hub de 3 tarjetas + sub-navegación +
volver, HeaderAction en el top bar (tras Asistente), i18n completa (5 tablas),
documentación de Nodi actualizada con el estado real. Tests: `test-toolkit-ui.mjs`
(8 casos) + paso del hub en `e2e-smoke.mjs` que mide en el shell real que las tres
tarjetas tienen dimensiones idénticas, que el glifo está centrado en su loseta
(±0,5 px), que las tarjetas "Próximamente" no navegan y que el botón volver regresa.
Verificado además con capturas en tema oscuro y claro. Suite: 388/388 + e2e en verde.

Notas de lo aprendido en F0:
- La paleta de comandos ya expone la sección automáticamente: recorre `NAV_ITEMS`
  filtrando por tipo de vault, así que no hizo falta añadir un comando a mano.
- `'Nodus Toolkit'` YA existía como clave i18n (viene del roadmap); duplicarla rompe
  el typecheck (TS1117). Antes de añadir claves, comprobar si ya existen.
- El nombre de marca de la 3.ª herramienta se alineó con el roadmap: **OCR Workspace**
  (no "AI OCR"), que es como ya se anuncia en `NODUS_ROADMAP`.

**F1 — Motor de jobs** *(spike primero)*
Spike: canvas+tesseract+pdfjs dentro de worker_thread en macOS (y CI Linux). Después:
`toolkitTypes`, `toolkitWorker`, `toolkitJobs`, IPC + preload, política de salida,
`startBackgroundJob` en renderer. Tests: `test-toolkit-jobs.mjs`.
**DoD**: un job dummy multi-archivo con progreso y cancelación, main thread libre
(ventana responde durante el job).

**F2 — Utilidades PDF (B1–B7)** + categoría "PDF" en la UI. `test-toolkit-pdf.mjs`.

**F3 — Documentos (A1–A7)** + categoría "Documentos". `test-toolkit-docs.mjs` +
e2e MD→PDF.

**F4 — OCR ligero (C1–C4)** + categoría "OCR" + gestor de idiomas con consentimiento.
`test-toolkit-ocr.mjs`. El PDF buscable (C3) es el buque insignia — priorizarlo.

**F5 — Imágenes (D1–D4)** + dep `heic-decode` + spike AVIF. `test-toolkit-images.mjs`.
D2 se cierra con `npm run verify:toolkit-heic` en local contra una foto real del
usuario (§6.2-bis); esa foto no se commitea jamás.

**F6 — Texto (E1–E4)** + categoría "Texto". `test-toolkit-text.mjs` (goldens).

**F7 — Pulido y release**
Drag & drop de carpetas, trabajos recientes, estados vacíos, roadmap→hecho, What's New,
documentación de Nodi, capturas para la web/README, release notes (inglés, política
habitual). Fases tardías pendientes: B8, C5, categoría F (citas/datos), contact sheet.

Orden F2 antes que F3 a propósito: pdf-lib puro es el terreno más firme para validar el
motor de F1 antes de meter mammoth/turndown/printToPDF.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Nativos (@napi-rs/canvas) o tesseract fallan dentro de worker_threads en alguna plataforma | Spike en F1; plan B `utilityProcess`; plan C troceo asíncrono en main (último recurso) |
| AVIF no soportado por el canvas | Spike en F5; si no, ocultar AVIF del select (el registro de operaciones lo permite) |
| Descarga de traineddata (única red) sorprende al usuario | Opt-in explícito reutilizando el copy de `ocrEnabled`; caché persistente; gestor de idiomas visible |
| Fidelidad MD/HTML→PDF (no es Word) | Etiquetar como "re-maquetación con estilo Nodus"; nunca prometer fidelidad DOCX→PDF |
| EPUBs reales malformados | adm-zip tolerante + spine fallback a orden de archivos; test adicional con un EPUB real descargado en F7 |
| PDFs grandes → memoria | Proceso página a página, sin cargar rasterizados completos; progreso por página |
| Cadenas i18n nuevas rompen `test-i18n-coverage` | Traducciones dentro de cada fase, no al final |

## 9. Fuera de alcance (explícito)

- ffmpeg / audio / vídeo (Whisper ya existe en Study; no se duplica).
- Binarios nativos por plataforma (Ghostscript, LibreOffice, Calibre).
- IA en Nodus Convert (determinista; la IA es de AI OCR).
- Cambios de schema de base de datos (no hay persistencia nueva en DB).
- PDF Presenter y AI OCR: solo tarjeta "Próximamente"; se diseñan en planes propios.
