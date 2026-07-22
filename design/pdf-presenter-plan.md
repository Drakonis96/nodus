# PDF Presenter — plan de implementación (réplica fiel + mejora)

> Estado: **plan para revisión**, sin código todavía.
> Objetivo acordado con el usuario (2026-07-20): **portar la app de referencia
> `~/Documents/GitHub/pdfpresenter` de forma más o menos exacta**, verificar cada
> función una a una, cubrir con tests, y **adaptar/mejorar el diseño** para
> integrarlo en Nodus (iconos centralizados, temas claro/oscuro, ritmo de
> espaciado, i18n). Las presentaciones viven en una **biblioteca global del
> Toolkit** (agnóstica de bóveda, como Convert/Protect).

---

## 1. Qué es la app de referencia (inventario completo)

App Electron con **tres ventanas + una web móvil**, coordinadas por un servidor
Express + WebSocket local. Todo el estado vive en un `currentState` central que
se difunde por WS a los clientes y por IPC a las ventanas.

### 1.1 Ventana principal — biblioteca (`src/js/renderer.js`)
- Importar PDF (se copia a `userData/presentations/<id>.pdf` + entrada en `meta.json`).
- Lista con **búsqueda**, **orden** (añadido reciente / abierto reciente / nombre ↑↓) y selección.
- **Carpetas**: crear, borrar (mueve su contenido a raíz), mover presentación, breadcrumb, contadores, filtro.
- **Renombrar** en línea (sidebar) y desde el título de detalle.
- **Borrar** con modal de confirmación.
- **Rejilla de miniaturas** con carga perezosa (`IntersectionObserver`, concurrencia limitada, liberación fuera de pantalla) y **badges** por diapositiva (tiene nota / tiene vídeo); botones rápidos "presentar" / "modo presentador" desde una diapositiva concreta.
- **Importar notas .pptx** (valida que el nº de diapositivas coincide con el PDF).
- **Visor de notas** a pantalla completa: canvas por diapositiva + textarea, sidebar de miniaturas, **undo/redo** (⌘Z / ⌘⇧Z), autoguardado, navegación con teclado, panel de notas redimensionable.
- **Editor de vídeo** por diapositiva: URL de YouTube + posición (x,y,ancho,alto en %) con overlay arrastrable/redimensionable y miniatura de previsualización.
- **Editar diapositivas** (rejilla para saltar al editor de vídeo).
- **QR**, **Ajustes** (idioma), **info de detalle** (nº de páginas, notas, vídeos).

### 1.2 Ventana de audiencia (`src/presentation.html`)
Render de diapositiva a canvas (ajuste, DPR, cancelación de render en carrera),
overlays de herramientas (linterna, dibujo, puntero, lupa con aumento),
**overlay de vídeo YouTube** + sincronía de seek, **pantalla en negro**,
**zoom de diapositiva** (⌘+rueda / pinch), barra de herramientas autoocultable
(colores, tamaños, slider, QR, cast, fullscreen), atajos de teclado, tamaño por
rueda, indicador de tamaño, y emisión de estado al servidor y al presentador.

### 1.3 Ventana de presentador (`src/presenter.html`)
Barra superior (nombre, ‹ contador ›, **temporizador** play/pausa/reset,
pantalla negra, QR, cast, **reloj del sistema**, finalizar), diapositiva actual
+ mismas herramientas (colores, tamaño, botones de aumento de lupa),
**previsualización de la siguiente**, **notas del presentador** (con control de
tamaño de fuente), **carrusel de miniaturas**, divisores redimensionables
(vertical y horizontal), atajos, zoom de diapositiva, controles de vídeo + seek,
sincronía de temporizador al servidor, y espejo de controles a la audiencia.

### 1.4 Móvil (`src/mobile/`)
Pantallas conectar / esperando / mando + toast de reconexión. WS con **PIN**,
canvas de previsualización, notas (tamaño de fuente), **puntos** de diapositiva
(ventana deslizante), prev/next, **swipe**, **carrusel**, **modo vista local**
(adelantarse en las notas sin mover la audiencia), herramientas táctiles
(→ audiencia + eco en la previsualización), **popup de tamaños** (por herramienta
+ aumento de lupa + **volumen del sistema** + silenciar), **pinch-zoom** on/off,
pantalla negra, alternar vídeo, temporizador (toca para pausar / reset), y **modo
apaisado/pantalla completa** con su propia barra inferior.

### 1.5 Proceso principal (`main.js` / `server.js`)
Directorio de datos + `meta.json`; importar/borrar/leer PDF; abrir/cerrar
ventanas con **detección de pantalla externa**; **power-save blocker**; limpieza
de User-Agent (para que YouTube no bloquee a Electron); icono de dock; **selector
de cast** (osascript, macOS); **volumen** get/set (osascript, macOS); **puente**
`setElectronCallback` que traduce WS ↔ IPC; **PIN**; **QR**; servido de PDF con
guardia anti-traversal.

---

## 2. Cómo encaja en Nodus (lo que se reutiliza)

| Necesidad | En Nodus |
|---|---|
| Render PDF **offline** | `pdfjs-dist@4.8.69` **bundleado** + worker local (`src/components/materials/PdfViewer.tsx`, `src/lib/protect/engine.ts`). La referencia usa pdf.js por CDN — lo eliminamos. |
| Tarjeta + navegación | `src/navigation.ts` ya declara `presenter` (`state:'soon'`). Se pasa a `'wip'` y el sidebar/hub la pintan solos. |
| Patrón de vista con "volver" | `ToolkitConvertView.tsx`, `ToolkitProtectView.tsx`. |
| Ventana secundaria | `electron/mascotWindow.ts` (crear/gestionar ciclo de vida de un `BrowserWindow`). |
| Multi-entrada Vite | `vite.config.ts` ya construye `main` + `mascot`; añadiremos las entradas de audiencia/presentador/mando. |
| IPC + preload del Toolkit | `electron/ipc.ts` (`h('toolkit:…')`), `electron/preload.ts` (`runToolkitJob`, `pickToolkitFiles`, …). |
| Iconos centralizados | `src/components/ui.tsx` (`ICON_PATHS` + `<Icon>`). Sustituye los SVG en línea de la referencia. |
| Zip (para .pptx) | `adm-zip` ya está (+ `@types/adm-zip`). **Sin `jszip`/`xml2js`.** |
| IDs | `uuid` ya está. |
| Jobs en 2º plano, i18n (8 idiomas), tema claro/oscuro | ya existen. |

**Dependencias nuevas (mínimas):** `ws` (servidor WebSocket, estándar y pequeño)
y `qrcode` (generación de QR). Ambas puramente locales. *(Alternativa evaluada:
implementar el handshake WS a mano sobre `http` nativo — descartado por frágil;
QR propio sin dependencia — posible pero `qrcode` es más fiable.)*

---

## 3. Decisiones de arquitectura

1. **Gestión = vista React dentro de Nodus.** `ToolkitPresenterView` (+ subcomponentes)
   siguiendo el patrón Convert/Protect. Se voltea la tarjeta a `state:'wip'`.

2. **Audiencia y presentador = `BrowserWindow` propios, entradas Vite dedicadas**
   (`presenterAudience.html`, `presenterView.html`), que **reutilizan el preload
   `preload.cjs`** y hablan con `main` por **IPC** (no por el servidor). Cargan
   pdfjs bundleado y el tema/i18n de Nodus, pero **no** montan la app completa ni
   tocan la base de datos (rendimiento: "presentaciones básicas que no colapsen").
   Patrón de creación = `mascotWindow.ts`.

3. **Mando móvil = entrada Vite `presenterRemote.html`** construida a `dist/`,
   **servida por el servidor local** al navegador del teléfono. No usa preload;
   habla solo por **WebSocket + fetch**. pdfjs se le **sirve desde el servidor
   local** (desde `node_modules/pdfjs-dist`) → 100 % offline.

4. **`main` es el hub.** Traduce controles WS (teléfono) ↔ IPC (ventanas), igual
   que el `setElectronCallback` de la referencia. El estado canónico vive en un
   reductor **Electron-free** (`presenterState.ts`) para poder testearlo.

5. **Almacenamiento global del Toolkit.** `app.getPath('userData')/toolkit/presenter/`:
   PDFs internos como `<id>.pdf` + `library.json` (`{ presentations, folders }`).
   Los formatos de presentación externos se convierten localmente mediante una
   suite instalada, tras advertir de la pérdida de animaciones. Módulo
   **Electron-free** `presenterLibrary.ts` (CRUD puro dada una ruta) + envoltura IPC.
   Nunca se toca el original: se **copia** al importar (regla de oro del Toolkit).

6. **El servidor solo existe mientras se presenta.** Se arranca al iniciar la
   presentación y se apaga al terminarla. Escucha en `0.0.0.0` (necesario para el
   teléfono) con **PIN de 6 dígitos** obligatorio para conexiones no-loopback.
   La app avisa de que el mando es accesible en la red local mientras dure.

### 3.1 Superficie IPC nueva (`presenter:*`)
Espejo del `preload`/`ipc` del Toolkit, p. ej.:
`presenter:library:get|save`, `presenter:import:pick|file`, `presenter:import:pptxNotes`,
`presenter:pdf:getData`, `presenter:delete`, `presenter:start` /
`presenter:startPresenterMode` / `presenter:stop`, `presenter:server:info`,
`presenter:control` (audiencia↔presentador↔servidor), `presenter:state:update`,
`presenter:timer:sync`, `presenter:cast:show`, `presenter:volume:get|set`.

---

## 4. Diseño / "mejorar" (lo que NO es copia literal)

- **Iconos:** sustituir los SVG en línea de la referencia por `<Icon>` centralizado.
  `presentation` y `scanText` ya existen; se añaden a `ICON_PATHS` (trazo feather,
  únicos, validados por el test del catálogo): `flashlight`, `pencil`/`draw`,
  `pointer`, `magnifier`/`zoom`, `timer`, `monitor`/`cast`, `qr`, `blackScreen`,
  `nextSlide`, etc.
- **Acento de sección:** ámbar/bronce del Toolkit en el chrome de gestión (coherente
  con Convert/Protect). Las ventanas de audiencia/presentador usan un tema oscuro
  neutro (convención de presentaciones) pero coherente con la paleta de Nodus.
- **Temas claro/oscuro:** cualquier utilidad nueva usada solo en dark necesita su
  remap `.light .<utility>` en `index.css` (test de utilidades de tema claro).
- **Ritmo de espaciado** e idioma como claves i18n (español primero) igual que el
  resto de vistas. Cobertura en los 8 idiomas.
- **Dropdowns** dentro de contenedores `overflow-hidden` → portal a `body` (landmine
  de Databases/Convert).
- **Landmine de spinners:** nunca `animate-spin` en el mismo elemento que un
  `-translate-y-1/2` (el centrado va en un wrapper).

---

## 5. Fases (cada una: funciona en la app real + test de lógica pura)

> **DoD por fase:** la función se verifica **en la app real** (no solo test) y su
> lógica Electron-free tiene un test que asevera **contenido real** (no mera
> existencia de fichero), al estilo de `scripts/test-toolkit-*.mjs`.

### F0 — Andamiaje + biblioteca
- `navigation.ts`: `presenter` → `state:'wip'`.
- `src/views/ToolkitPresenterView.tsx` + subcomponentes (biblioteca: importar,
  lista, búsqueda, orden, carpetas, renombrar, mover, borrar, rejilla de
  miniaturas con badges, detalle).
- `electron/toolkit/presenter/library.ts` (**Electron-free**: CRUD de
  `library.json`, colisión de nombres, mover a carpeta, borrado).
- IPC `presenter:library:*`, `presenter:import:pick|file`, `presenter:pdf:getData`,
  `presenter:delete` + preload.
- Miniaturas: reutilizar el motor perezoso de la referencia (IntersectionObserver
  + concurrencia + liberación), portado a React con pdfjs bundleado.
- **Tests:** `test-presenter-library.mjs` (crear/mover/borrar/colisión, backward-compat).
- **Verificar:** importar un PDF y un PowerPoint reales, verlos en la lista con
  miniaturas y comprobar la conversión y las notas.

### F1 — Notas del presentador (núcleo pedido explícitamente)
- Visor de notas a pantalla completa: canvas + textarea por diapositiva, sidebar
  de miniaturas, **undo/redo**, autoguardado, navegación por teclado, panel
  redimensionable.
- **Importar notas .pptx**: `electron/toolkit/presenter/pptxNotes.ts`
  (**Electron-free**, `adm-zip` + extractor de `<a:t>`/`<a:br>` por regex, sin
  `xml2js`); valida nº de diapositivas.
- **Tests:** `test-presenter-notes.mjs` — parsea un `.pptx` de fixture real y
  asevera el texto de notas por diapositiva (incluidos saltos de línea) + el
  reductor de undo/redo.
- **Verificar:** escribir/editar/undo notas; importar un `.pptx` real.

### F2 — Ventanas de audiencia y presentador (sin móvil)
- Entradas Vite `presenterAudience.html` / `presenterView.html` + su código
  (React lean, canvas, sin DB).
- `electron/toolkit/presenter/windows.ts`: creación con **detección de pantalla
  externa** (`screen.getAllDisplays`), fullscreen, power-save blocker, ciclo de
  vida (cerrar una cierra la otra), patrón `mascotWindow.ts`.
- Render seguro (cancelación por generación, DPR, ajuste), siguiente diapositiva,
  **temporizador**, **reloj**, **carrusel**, **pantalla negra**, **zoom de
  diapositiva**, navegación por teclado, divisores redimensionables.
- `electron/toolkit/presenter/presenterState.ts` (**Electron-free**: reductor de
  navegar/timer/black-screen/zoom con clamping).
- Bridge IPC audiencia↔presentador por `main`.
- **Tests:** `test-presenter-state.mjs` (clamp de diapositiva, deriva de
  temporizador, transiciones).
- **Verificar:** iniciar presentación + modo presentador (con 1 y con 2 pantallas
  si es posible); navegar, timer, negro, zoom.

### F3 — Herramientas de anotación
- Linterna, dibujo (colores + tamaño), puntero, lupa (con aumento), sincronizadas
  audiencia↔presentador por IPC. Tamaño por slider / rueda / "tips".
- **Verificar:** cada herramienta, visualmente, en ambas ventanas.

### F4 — Servidor + mando móvil (mayor superficie nueva)
- `electron/toolkit/presenter/server.ts`: `http` nativo + `ws`, `0.0.0.0`, puerto
  escaneado, **PIN**, arranque/parada atados a presentar. Sirve `/remote` (entrada
  Vite `presenterRemote.html` construida), `/api/pdf/:id` (con guardia
  anti-traversal), `/api/qr`, `/api/state`, y pdfjs desde `node_modules`.
- Entrada Vite `presenterRemote.html` + su código: conectar/esperando/mando,
  navegación, notas, puntos, carrusel, swipe, **modo vista local**, herramientas
  táctiles, **popup de tamaños**, pinch-zoom, pantalla negra, temporizador,
  **modo apaisado/fullscreen**.
- Puente servidor↔IPC en `main` (traduce controles del teléfono a las ventanas).
- Deps nuevas: `ws`, `qrcode`.
- **Tests:** `test-presenter-server.mjs` (reductor de estado, autenticación por PIN,
  guardia de ruta de `/api/pdf`) — Electron-free.
- **Verificar:** escanear el QR con el teléfono (o abrir la URL LAN en otra
  pestaña); navegar, ver notas, herramientas, timer, modo local.

### F5 — Vídeos de YouTube
- Editor de vídeo por diapositiva (posición/redimensión con overlay), overlay en
  audiencia, **sincronía de play/pausa y seek** entre ventanas y móvil, limpieza
  de User-Agent para YouTube.
- **Verificar:** insertar un vídeo, reproducir/pausar/seek desde presentador y móvil.

### F6 — Extras macOS + pulido + integración
- **Volumen** (osascript, macOS), **cast/AirPlay** (osascript, macOS) — gated a
  darwin, no-op elegante en otros SO; icono de dock; indicador de tamaño; ajustes.
- **Integración de shell:** i18n en los 8 idiomas, remaps de tema claro, iconos
  nuevos en el catálogo, entrada en `WhatsNewModal`, doc para Nodi
  (`shared/nodiDocumentation.ts`), comandos en `CommandPalette`.
- **Verificar:** suite completa (`npm test`) y build (`test:e2e`) en verde.

### F7 — Auditoría de rendimiento (PDFs enormes)
Garantizar que **ni con un PDF de cientos de diapositivas** la herramienta cuelga
o colapsa el ordenador. Se audita, se mide y se corrige.
- **Miniaturas:** confirmar que la rejilla (gestión), el carrusel (presentador) y
  los puntos/carrusel (móvil) **nunca renderizan todas las páginas a la vez** —
  carga perezosa por `IntersectionObserver`, concurrencia limitada y **liberación
  de canvas fuera de pantalla** (los canvas fuera de vista se ponen a 0×0 para no
  retener memoria). Medir memoria con 300–500 diapositivas.
- **Render de diapositiva:** cancelación por generación al navegar rápido (no
  acumular tareas pdfjs), `page.cleanup()` tras cada render, y un solo documento
  pdfjs por ventana (destruir el anterior).
- **Bucle de eventos de `main`:** el servidor/serialización de estado no debe
  bloquear el hilo principal (landmine histórica de Nodus: `main` es un único
  event loop). El broadcast WS y el puente IPC deben ser O(nº de clientes), no
  O(nº de diapositivas).
- **Navegación con teclado mantenida** (flecha derecha sostenida) no debe encolar
  renders sin fin: coalescencia/última-gana.
- **Método de medición:** contar trabajo con un proxy (nº de renders lanzados,
  canvas vivos, round-trips) **en vez de asertar milisegundos de reloj** (landmine
  del harness: los tests paralelos hacen que el tiempo de pared mienta). Un
  `scripts/test-presenter-perf.mjs` que, sobre un PDF sintético de N=400 páginas,
  asevere que abrir la biblioteca lanza ≤ concurrencia renders y que navegar 50
  veces deja ≤ K canvas vivos.
- **Verificar:** abrir un PDF real grande, hacer scroll a fondo, navegar rápido y
  presentar; observar memoria y fluidez (la captura, no solo los números).

---

## 6. Riesgos y landmines conocidas
- **El servidor expone la LAN.** Única superficie con implicación de seguridad:
  PIN obligatorio, apagado al terminar, aviso claro. El resto de servidores de
  Nodus (copilot, MCP) son solo-localhost por diseño; este es la excepción
  justificada por el mando móvil.
- **Rendimiento.** Reutilizar la cancelación de render por generación, el DPR y la
  carga perezosa/por lotes de la referencia; las ventanas no montan la app ni la
  DB. Objetivo del usuario: "que no colapsen el ordenador".
- **Tema oscuro por defecto** en las ventanas; cualquier utilidad dark-only necesita
  su remap `.light`.
- **`test:e2e` NO reconstruye** (dist obsoleto miente en migraciones): recordar
  `npm run build` antes de e2e si toca algo compilado.
- **pdfjs para el teléfono** debe servirse desde el servidor local (no CDN) para
  mantener el principio offline.
- **YouTube requiere red** (no es offline) — es la única función que sale a
  Internet; el resto de la herramienta funciona sin conexión.

---

## 7. Entregable de esta fase
Este documento. A la espera de tu visto bueno (o ajustes de orden/alcance de
fases) antes de escribir código. Sugerencia: empezar por **F0 + F1** (biblioteca
+ notas del presentador, que es lo que más te importa) y verificarlas juntas antes
de seguir con las ventanas.
