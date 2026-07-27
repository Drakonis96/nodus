# Worldbuilding — Mapas

> Estado: **M0–M7 implementados. El plan está completo** (2026-07-27). Schema en **v97**.
> `npm test` 1023/1023 · typecheck, lint (0 errores), i18n (7 idiomas) y `build` en verde.
> **SIN commitear.**
>
> | Fase | Qué entrega |
> |---|---|
> | M0 | Migración v97 (5 tablas), `shared/worldMapGeometry.ts` puro, dos repos, IPC, ruta de imagen propia, `syncTables` |
> | M1 | Sección Mapas (sustituye a «Mapa» en worldbuilding), rejilla, subir imagen, visor Leaflet `CRS.Simple`, migas de pan |
> | M2 | Calibración por dos puntos, barra de escala y rosa de los vientos nativas, regla con tiempos de viaje, modos de viaje |
> | M3 | Punto → círculo → polígono → ruta con edición de vértices a mano, capas, vínculo bidireccional con lugares |
> | M4 | `shared/worldPresence.ts` (escenas + eventos + residencia como fondo), línea temporal con reproducción, tránsitos interpolados |
> | M5 | `resolveMapFocus`, autoseguimiento de un personaje, tira de reparto con salto entre mapas |
> | M6 | `shared/mapPrompt.ts` (10 estilos), capacidades por proveedor con degradación honesta, recorte sin IA, zoom con IA, outpainting, anotación por visión |
> | M7 | Escenas en el mapa, viajes imposibles, buscador de encuentros, exportación a PNG |
>
> Verificado **en pantalla** además de por tests: clic → coordenada normalizada exacto en
> cinco pruebas; 224 km medidos sobre un mapa de 400 km con 8,9/4,1/1,9 días; barra de
> escala exacta a tres niveles de zoom; y un vértice arrastrado de (0,45 · 0,25) a
> (0,622 · 0,162) con un solo commit.
>
> **Cinco bugs reales cazados mirando la pantalla, ninguno por los tests:**
> 1. `@napi-rs/canvas` usa calidad WebP **0–100, no 0–1**: con `0.88` un mapa de 4096 px
>    salía a 16 KB de puré.
> 2. La barra de escala dependía de `setTick` (estable) en vez de `tick`: se calculaba una
>    vez y nunca más.
> 3. El `fitBounds` inicial corría con el contenedor aún sin tamaño → zoom mínimo. Carrera.
> 4. `pointsRef.current = points` asignado en el render: **arrastrar un vértice no
>    guardaba nada**.
> 5. `mapCoverage` colisionaba con el del mapa de investigación — y `tsc --noEmit` no
>    cubre `electron/`, así que sólo lo vio el build.
>
> **Dos huecos de test que sólo se vieron mutando** y que llevaron a reescribir código:
> el comparador de `sortPresences` era *inconsistente* con nulos (el resultado dependía
> del algoritmo interno de V8, así que ahora particiona en vez de comparar), y el guard de
> nulos de `buildJourneys` no se ejercitaba con todas las presencias sin fecha.
>
> Lo que NO se ha podido ejercitar con un gesto real: añadir un vértice arrastrando un
> punto intermedio y borrarlo con Alt+clic. Cubiertos por tests unitarios de
> `insertVertex`/`removeVertex`/`midpoints` y por aserciones sobre los manejadores.

> Diseño original (2026-07-27). Schema actual **v96**; este plan introduce **v97**.
>
> Las cinco decisiones abiertas se resolvieron el 2026-07-27 y están aplicadas en el
> cuerpo del documento; el §13 las recoge con su motivo.
>
> Precedentes: [worldbuilding-characters-plan.md](worldbuilding-characters-plan.md),
> [worldbuilding-collections-plan.md](worldbuilding-collections-plan.md),
> [worldbuilding-families-plan.md](worldbuilding-families-plan.md).

---

## 0. Sobre qué se construye (lo que YA existe)

Antes de inventar nada conviene fijar qué hay, porque la mitad de este diseño consiste en
**no duplicarlo**.

| Pieza | Dónde | Qué aporta |
|---|---|---|
| `places` + `place_profiles` (v95) | `electron/db/worldPlacesRepo.ts` | Los lugares, su jerarquía (`parent_id`), su clasificador (`kind`) y la capa de ficción (aspecto, atmósfera, historia, `visual_seed`, acento). |
| `person_places` | genealogía | Persona ↔ lugar con `label` y `date`/`date_sort`. **La columna se llama `label`, no `role`.** |
| `events` + `event_participants` + `event_world_dates` | genealogía + v91 | Un hecho con `place_id`, sus participantes y su `world_day` absoluto. |
| `world_scenes` + `scene_characters` (v96) | `worldStoryRepo.ts` | La unidad real de trabajo del escritor: lugar, `world_day`, `narrative_order`, estado. |
| `worldCalendar.ts` | `shared/` | Eras, meses, y la conversión fecha inventada ↔ `world_day` absoluto. Sin años bisiestos, por diseño. |
| `world_images` (v94) | `worldImagesRepo.ts` | Galería polimórfica (`entity_kind`/`entity_id`) con blobs. |
| `callImageProvider` | `electron/ai/decorativeImages.ts` | Google / OpenAI / OpenRouter / Nodus local, `(provider, model, prompt) → bytes`. |
| `aiClient` con `images` | `electron/ai/aiClient.ts` | Entrada **multimodal**: un modelo de texto puede *mirar* una imagen. |
| Leaflet 1.9.4 | `src/components/PlacesMap.tsx` | Ya es dependencia. Genealogía lo usa con teselas OSM reales. |
| `WorldWorkspace` + `worldFilters` | `src/components/world/` | Cabecera, buscador, facetas y ficha: la carcasa de toda colección del vault. |

**Lo que hay que tirar.** Hoy la entrada «Mapa» del sidebar de worldbuilding apunta a
`MapView`, el mapa de genealogía, que proyecta lat/lon sobre teselas de OpenStreetMap. En
un mundo inventado los lugares no tienen coordenadas de gacetero, así que esa vista sale
**siempre vacía**: no es que sea mejorable, es que no puede funcionar.

**Decidido: la sustituye.** «Mapa» pasa a ser la vista nueva y no hay segunda entrada.
`MapView` se queda intacto y sigue siendo la de genealogía —`VAULT_TYPE_SCOPED_VIEWS` ya
sabe repartir vistas por tipo de vault, que es exactamente el mecanismo que hace falta.

El caso que perdemos —ficción histórica sobre lugares reales geocodificados— tiene salida
sin una segunda entrada en el menú: un mapa con `projection = 'globe'` y una lámina real
de fondo hace el mismo trabajo dentro de la vista nueva. Si algún día aparece demanda de
verdad, la forma correcta no es duplicar la sección sino admitir un origen de teselas como
un `kind` más de mapa.

---

## 1. El modelo conceptual

### 1.1 Un mapa es un lienzo, no un lugar

La decisión estructural de todo el diseño. Un **mapa** es una imagen con un sistema de
coordenadas; un **lugar** es una entidad del mundo. No son lo mismo y la relación entre
ellos es de muchos a muchos:

- Una ciudad **aparece como chincheta** en el mapa del continente, en el mapa del reino y
  en el mapa de rutas comerciales.
- Esa misma ciudad **tiene su propio mapa**, y ese mapa contiene chinchetas de sus barrios.
- Un mapa puede no ser de ningún lugar: «las posiciones de la batalla de Vael, día 3».

De ahí sale el requisito del usuario («se podrán crear tantos mapas como lugares haya
incluso»): no es que cada lugar *tenga* un mapa, es que **cualquier lugar puede tener
uno**, y el mapa se ancla al lugar con `world_maps.place_id`.

### 1.2 La jerarquía de mapas

`world_maps.parent_map_id` + el rectángulo que ocupa dentro del padre
(`parent_x0/y0/x1/y1`, en coordenadas normalizadas del padre). Esto da tres cosas gratis:

1. **Navegación por profundidad.** Doble clic en la chincheta de Aldermoor → se abre el
   mapa de Aldermoor. Volver → migas de pan `Mundo › Norte › Aldermoor › La Ciudadela`.
2. **Herencia de escala** (§3.3).
3. **Reproyección de chinchetas** al hacer zoom con IA (§7.4): las chinchetas que caen
   dentro del rectángulo aparecen ya colocadas en el mapa hijo.

La jerarquía de mapas **no está obligada a coincidir** con la de lugares. Coincidirá casi
siempre, pero un mapa de «rutas de la seda» cruza cinco reinos y no cuelga de ninguno.

### 1.3 Coordenadas: normalizadas, siempre

Todas las coordenadas (chinchetas, vértices, rectángulos, calibración) se guardan como
**reales 0..1** relativos al ancho y alto de la imagen, nunca en píxeles.

Motivo: la imagen base **va a cambiar**. Se regenera con otro estilo, se sube una versión
en más resolución, se amplía por un borde. Con píxeles, cada uno de esos gestos mueve
todas las chinchetas. Con coordenadas normalizadas, sólo el *outpainting* las mueve — y ahí
la transformación es una afín conocida y explícita (§7.5).

`world_maps` guarda además `width_px`/`height_px` nativos, porque para medir distancias hay
que corregir la relación de aspecto: un desplazamiento de 0.1 en X y otro de 0.1 en Y no
son la misma distancia salvo que la imagen sea cuadrada.

---

## 2. Esquema (migración v97)

```sql
-- ── Los mapas ────────────────────────────────────────────────────────────────
CREATE TABLE world_maps (
  map_id        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- world | continent | region | city | town | building | interior | dungeon
  -- | battle | route | schematic | other
  kind          TEXT NOT NULL DEFAULT 'region',
  -- «Este mapa ES el de este lugar». SET NULL: borrar el lugar no debe llevarse el
  -- mapa, que puede seguir teniendo valor como lámina.
  place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,

  parent_map_id TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
  -- Dónde cae este mapa dentro del padre, en coordenadas normalizadas del padre.
  parent_x0 REAL, parent_y0 REAL, parent_x1 REAL, parent_y1 REAL,

  image_id      TEXT,               -- → map_images.image_id (base actual)
  width_px      INTEGER NOT NULL DEFAULT 0,
  height_px     INTEGER NOT NULL DEFAULT 0,

  -- Calibración: «este segmento mide tanto». Se guardan los DOS extremos, no una
  -- longitud, para que sobreviva a cualquier renormalización (§3.1).
  scale_x0 REAL, scale_y0 REAL, scale_x1 REAL, scale_y1 REAL,
  scale_distance REAL,              -- cuánto mide ese segmento…
  scale_unit     TEXT,              -- …en esta unidad (km, mi, league, m, ft, custom)

  -- flat (por defecto) | globe. `globe` trata la imagen como equirectangular sobre
  -- un planeta de radio dado y mide con haversine.
  projection     TEXT NOT NULL DEFAULT 'flat',
  planet_radius  REAL,
  planet_radius_unit TEXT,

  -- Un mapa puede ser de una época: «el Imperio en el año 300».
  from_world_day INTEGER,
  to_world_day   INTEGER,

  -- Ancla de consistencia visual, igual que `place_profiles.visual_seed`.
  visual_seed    TEXT,
  style          TEXT,              -- el estilo cartográfico con el que se generó
  -- 0 = Nodus rotula (por defecto); 1 = se le pide al modelo que escriba los nombres.
  model_labels   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_world_maps_place  ON world_maps(place_id);
CREATE INDEX idx_world_maps_parent ON world_maps(parent_map_id);

-- ── Las imágenes ─────────────────────────────────────────────────────────────
-- Tabla propia y NO `world_images`: los mapas necesitan resolución nativa alta y
-- `optimizedJpegs` recorta a 1280 px (§12, landmine nº1). Además aquí guardamos el
-- historial de versiones, que una galería no tiene.
CREATE TABLE map_images (
  image_id   TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  -- base | previous | reference   (`previous` = deshacer una regeneración)
  role       TEXT NOT NULL DEFAULT 'base',
  mime_type  TEXT NOT NULL DEFAULT 'image/webp',
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  blob       BLOB,
  thumbnail  BLOB,
  prompt     TEXT,
  provider   TEXT,
  model      TEXT,
  style      TEXT,
  generated  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_map_images_map ON map_images(map_id, role);

-- ── Capas ────────────────────────────────────────────────────────────────────
CREATE TABLE map_layers (
  layer_id   TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- political | physical | routes | climate | culture | battle | custom
  kind       TEXT NOT NULL DEFAULT 'custom',
  color      TEXT,
  opacity    REAL NOT NULL DEFAULT 1,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_map_layers_map ON map_layers(map_id, sort_order);

-- ── Chinchetas y formas ──────────────────────────────────────────────────────
CREATE TABLE map_markers (
  marker_id     TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  layer_id      TEXT REFERENCES map_layers(layer_id) ON DELETE SET NULL,

  -- El vínculo con el mundo. NULL = chincheta decorativa o todavía sin asignar.
  place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,
  -- Doble clic entra aquí. Normalmente el mapa del mismo lugar, pero no obligatorio.
  child_map_id  TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
  label         TEXT,               -- override; NULL = usar el nombre del lugar

  -- point | circle | polygon | path
  geometry_kind TEXT NOT NULL DEFAULT 'point',
  x REAL NOT NULL, y REAL NOT NULL, -- ancla (centroide en las formas)
  radius REAL,                      -- círculo; normalizado contra el eje X
  points TEXT,                      -- JSON [[x,y],…] para polygon/path

  icon  TEXT,
  color TEXT,
  -- Validez temporal: las fronteras se mueven, las ciudades caen.
  from_world_day INTEGER,
  to_world_day   INTEGER,

  notes      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_map_markers_map   ON map_markers(map_id, sort_order);
CREATE INDEX idx_map_markers_place ON map_markers(place_id);

-- ── Modos de viaje (del vault, no de un mapa) ────────────────────────────────
CREATE TABLE map_travel_modes (
  mode_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,          -- «a pie», «a caballo», «carro», «barco»
  distance_per_day REAL NOT NULL,
  unit       TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**No hay tabla de «posiciones de personaje».** Es deliberado y es la decisión más
importante del §6: dónde está un personaje ya está registrado tres veces (eventos, escenas,
`person_places`). Una cuarta tabla sería una cuarta respuesta a la misma pregunta y
divergiría en una semana.

**Sincronización:** las cuatro tablas nuevas van al grupo `worldbuilding` de
`electron/db/syncTables.ts`. Una tabla que no está ahí no viaja *y sus borrados
resucitan* (§12, landmine nº4).

---

## 3. Escalas: generación y cálculo

El usuario pide explícitamente que la escala cuente **tanto al generar como al calcular**.
Son dos usos del mismo dato y conviene tratarlos juntos.

### 3.1 Calibrar

El autor traza un segmento sobre el mapa y escribe cuánto mide: «esto son 200 leguas».
Se guardan los dos extremos normalizados más distancia y unidad. La conversión es:

```
pixelLength = hypot((x1-x0) * width_px, (y1-y0) * height_px)
unitsPerPixel = scale_distance / pixelLength
```

Guardar los extremos y no la longitud es lo que hace que la calibración **sobreviva a una
regeneración de la imagen en otra resolución**: los extremos siguen siendo los mismos dos
puntos del dibujo.

Si no hay calibración, la vista no miente: la barra de escala muestra «sin escala» y las
herramientas de distancia se ofrecen desactivadas con un enlace a calibrar. Nunca una
distancia inventada.

### 3.2 Proyección

- **`flat`** (por defecto): geometría euclídea. Es lo correcto para casi todo — una
  región, una ciudad, una mazmorra.
- **`globe`**: la imagen se interpreta como equirectangular sobre un planeta de radio
  `planet_radius`. X ↦ longitud [-180, 180], Y ↦ latitud [90, -90], distancias por
  haversine. Sólo tiene sentido en un mapamundi, y ahí importa: en plano, la distancia
  entre dos puntos árticos sale disparatada. Permite además decir «mi mundo es 0,8 Tierras»,
  que es una decisión que los escritores toman y luego no pueden usar para nada.

Reutiliza el vocabulario de `shared/mapProjection.ts`; la lógica nueva vive en
`shared/worldMapGeometry.ts`, pura y con tests.

### 3.3 Herencia y coherencia entre mapas

Un mapa hijo con `parent_map_id` y rectángulo conocido **puede derivar su escala del
padre** sin que el autor calibre nada:

```
childUnitsPerPixel = parentUnitsPerPixel * (parent_x1 - parent_x0) * parentWidthPx / childWidthPx
```

Y cuando hay las dos —heredada y calibrada a mano— Nodus **avisa si no cuadran**:

> «El mapa de Aldermoor está calibrado a 4 km de ancho, pero su huella en *El Norte* mide
> 40 km. Uno de los dos está mal.»

Este chivato es barato (una comparación) y caza un error que si no se descubre tres meses
después, escribiendo una escena de persecución.

### 3.4 La escala en el prompt

Al generar (§7) el autor dice la extensión pretendida: «una región de unos 600 km de
ancho». Eso hace dos cosas:

1. Entra en el prompt. Un modelo dibuja cosas distintas si le pides 600 km (cordilleras,
   varios reinos) o 6 km (un valle, un pueblo y sus campos). Sin ese dato salen mapas con
   la densidad de detalle equivocada, que es el fallo más común de los mapas generados.
2. **Precalibra el mapa resultante**: `scale_distance` = 600 km sobre el segmento
   (0,0.5)→(1,0.5). El mapa nace medible. El autor puede recalibrar si el modelo se
   desvió, pero no parte de cero.

---

## 4. Chinchetas: del punto a la forma exacta

El usuario pide: chinchetas, radio de acción aproximado, radio ajustable a mano, poder
**añadir puntos de ajuste** y editarlos «para adaptarse a la forma de un lugar a la
perfección». Eso es una escalera de cuatro peldaños, y el diseño la hace continua:

| Peldaño | `geometry_kind` | Gesto |
|---|---|---|
| 1. Un punto | `point` | Clic en el mapa. |
| 2. Un radio | `circle` | Arrastrar el tirador del borde, o escribir «12 km» en la ficha. |
| 3. Una forma | `polygon` | «Convertir en forma» → el círculo se convierte en un polígono de 12 vértices arrastrables. |
| 4. Una forma exacta | `polygon` | Arrastrar vértices; los **tiradores intermedios** (uno en el punto medio de cada arista) añaden vértice al arrastrarlos; `Alt`+clic elimina. |
| — | `path` | Línea abierta: ríos, carreteras, murallas, la ruta de una marcha. |

El punto 3 es la clave de que esto se sienta como *una* herramienta y no cuatro: el
polígono **nace del círculo**, con los vértices ya en su sitio. Nadie empieza a dibujar el
contorno de un bosque desde cero; lo que quiere es abollar un círculo.

El radio se guarda normalizado contra el eje X y se muestra en unidades del mundo cuando
hay escala. Un radio en km escrito a mano se convierte al guardar.

**Decidido: edición de vértices a mano, sin dependencia nueva.** `leaflet-editable` o
`leaflet-draw` resolverían esto, pero son ~40 KB y una API que hay que domar para el 20 %
que usaríamos, y su aspecto no es el del resto de la app. Un `L.marker` arrastrable por
vértice más otro por punto medio son ~200 líneas con control total, y encaja con cómo esta
base de código ha resuelto el motor de tours o el centrado del badge: a mano, medido, sin
dependencia.

Lo que hay que hacer bien para que salga a cuenta, y que va en los tests:

- **Deshacer por gesto**, no por vértice: arrastrar y soltar es UNA acción. Sin esto,
  deshacer un contorno de treinta puntos es treinta pulsaciones.
- **Umbral de arrastre** (~4 px) antes de mover: sin él, un clic para seleccionar desplaza
  el vértice uno o dos píxeles y el contorno se degrada solo con mirarlo.
- **Los tiradores no se reescalan con el zoom** (van en píxeles de pantalla, no en unidades
  del mapa), o al alejar se vuelven inalcanzables.
- **`Alt`+clic elimina**, con mínimo de 3 vértices en polígonos y 2 en rutas.

---

## 5. El vínculo con los lugares

### 5.1 Del mapa al lugar

Clic en una chincheta sin lugar → un buscador de los lugares ya guardados (el mismo
`SearchableMultiSelect` que usan las escenas), con «crear lugar nuevo» al final. Es
exactamente el flujo que pide el usuario: *«cuando el usuario clique en una chincheta
añadirá un lugar de los que ya ha guardado previamente»*.

Al asignar, la chincheta hereda nombre, icono por `kind` y color del acento del lugar
(`place_profiles.accent`), y **el kind sugiere la geometría**: un `city` nace círculo, un
`river` nace `path`, un `realm` nace polígono. Sugerencia, no imposición.

### 5.2 Del lugar al mapa

La ficha de lugar gana una sección **«En los mapas»**: miniatura recortada alrededor de su
chincheta en cada mapa donde aparece, y un botón «Crear el mapa de este lugar» que crea un
`world_maps` con `place_id` puesto y `parent_map_id` al mapa donde ya está pinchado, con el
rectángulo tomado del radio de la chincheta. La ida y la vuelta son simétricas.

### 5.3 Navegación

Migas de pan por `parent_map_id`. Doble clic en una chincheta con `child_map_id` desciende.
Un minimapa en la esquina muestra el rectángulo del mapa actual dentro de su padre —
lo que en un atlas es el recuadro «usted está aquí».

---

## 6. La capa temporal

El corazón de lo que pide el usuario, y donde este diseño se separa del mapa de genealogía:
allí la línea temporal barre **años**; aquí barre **días del mundo**, y los personajes no
aparecen y desaparecen, **se mueven**.

### 6.1 Resolver dónde está alguien: `shared/worldPresence.ts`

Una función pura que une las tres fuentes que ya existen y devuelve, por personaje, una
lista ordenada de presencias:

```ts
interface Presence {
  personId: string;
  placeId: string;
  worldDay: number | null;      // null = sin fechar
  source: 'scene' | 'event' | 'residence';
  sourceId: string;
  label: string | null;         // «residencia», el título de la escena…
}
```

- `world_scenes` ⋈ `scene_characters` → la fuente principal para un novelista.
- `events` ⋈ `event_participants` ⋈ `event_world_dates` → nacimientos, batallas, viajes.
- `person_places` → residencias de larga duración (llegan sin `world_day`; ver §6.5).

Reglas, todas testeables sin base de datos:

1. **Presencias consecutivas en el mismo lugar se colapsan** en un intervalo — igual que
   `buildMigrationPath` colapsa las paradas repetidas. Estar no es moverse.
2. Entre dos presencias en lugares distintos hay un **tránsito**: `[díaSalida, díaLlegada]`
   de A a B. El personaje no teletransporta, viaja.
3. Una presencia sin fecha no se descarta: se ancla al final, visible pero fuera del barrido
   (mismo criterio que `buildMigrationPath`).

### 6.2 Reproducción

Un cabezal sobre `world_day`, no sobre el año. Controles: reproducir/pausa, velocidad
(×0,5 ×1 ×2 ×5), paso día a día, y **saltar al siguiente suceso** — porque en un mundo con
360 días por año, avanzar de uno en uno entre dos escenas separadas por medio año es
insufrible. El rango por defecto va del primer al último suceso del reparto seleccionado,
no del calendario entero.

Durante un tránsito la chincheta del personaje se **interpola** por el trayecto y se dibuja
la estela discontinua. Si hay un `path` (una carretera) entre los dos lugares, el trayecto
la sigue; si no, recta.

Sin calendario definido, todo degrada a `world_year` + `world_order`, exactamente como ya
hace `TimelineView`. El mapa funciona el primer día, sin que el autor haya inventado doce
meses.

### 6.3 Seguir a un personaje entre mapas

El requisito más específico del usuario: *«si clicamos en reproducir temporalmente y
estamos en un mapa pero el personaje salta a otro, nosotros también lo haremos»*.

El cabezal es **global**, no del mapa. La vista resuelve en cada instante qué mapa mira,
con una función pura `resolveMapFocus(placeId, maps, markers, currentMapId)`:

1. Sube por la cadena de ancestros del lugar (`places.parent_id`), de lo más específico a lo
   más general.
2. Para cada ancestro, busca mapas donde ese lugar tenga chincheta **válida en ese día**.
3. Prefiere, por este orden: **el mapa actual** (no cambiar si no hace falta) → el mapa cuyo
   `place_id` sea el ancestro más específico → el más recientemente usado.

El punto 3 importa: sin él, la vista salta de mapa cada dos días y marea.

**Autoseguimiento: interruptor, activo por defecto sólo con UN personaje seleccionado.**
Con cinco personajes en cuatro mapas, seguir automáticamente sería un baile de pantallas.
Con varios seleccionados aparece en su lugar una **tira de reparto**: un chip por personaje
con su retrato, dónde está y en qué mapa; los que están fuera del mapa actual se muestran
atenuados y con el nombre del mapa, y un clic salta allí. Se ve todo sin que nada se mueva
solo.

La transición entre mapas es un cross-fade con el nombre del mapa nuevo, no un corte: si no,
es imposible saber que has cambiado de sitio.

### 6.4 Fronteras que cambian

`map_markers.from_world_day` / `to_world_day` no son sólo para chinchetas: un **polígono**
con validez temporal es una frontera. Al mover el cabezal, el imperio se expande, la ciudad
cae, el bosque arde. Es la misma maquinaria y hace que la línea temporal sobre el mapa sea
mucho más que puntos moviéndose.

### 6.5 Presencias de larga duración

`person_places` no tiene `world_day` (guarda `date`/`date_sort`, formato Tierra).

**Decidido: la residencia es el FONDO.** Dónde está alguien cuando ninguna escena ni
evento dice otra cosa, sin fecha propia. No toca esquema, y una residencia es
conceptualmente un estado por defecto, no un suceso.

Consecuencia en `worldPresence.ts`: la residencia entra con `worldDay: null` y prioridad
más baja. Al resolver un día concreto gana siempre la escena o el evento fechado; la
residencia sólo rellena los huecos y **no genera tránsitos** (no se puede interpolar un
viaje contra algo que no tiene fecha). Se dibuja atenuada y con el rótulo «residencia»,
para que se vea que es una suposición y no un dato.

Si en uso real se echa de menos poder decir «vivió en Vael del día 200 al 900», la salida
es una tabla puente `person_place_world_dates` análoga a `event_world_dates`. Es aditiva:
no migra nada de lo que el autor haya escrito para entonces.

---

## 7. Generación con IA

### 7.1 Estilos cartográficos

`shared/mapPrompt.ts`, puro y con tests, calcado en estructura a
`shared/characterImagePrompt.ts` (donde lo único que importa es el ORDEN):

```
estilo → visual_seed del mundo → encuadre por tipo de mapa → contenido exigido
       → escala pretendida → política de etiquetas → negativos
```

Estilos: `parchment` (pergamino clásico), `inked_atlas` (grabado a plumilla),
`painted_fantasy`, `watercolour`, `satellite`, `blueprint`, `isometric`,
`hand_drawn_sketch`, `dark_grimoire`, `nautical_chart`.

Encuadres por `kind`: mundo / continente / región / ciudad amurallada vista cenital /
plano de planta / mazmorra / interior / despliegue de batalla / mapa de rutas.

**`visual_seed` a nivel de mapa y de mundo.** Igual que el retrato de un personaje se ancla
en su `visual_seed`, aquí hay dos anclas: la del mundo (paleta, altura de las montañas,
tipo de costa) para que todos los mapas del vault parezcan del mismo atlas, y la del mapa
para que regenerarlo no lo convierta en otro sitio.

### 7.2 Las etiquetas NO las dibuja el modelo (por defecto)

La decisión de producto que más se va a notar. **Decidido: las dibuja Nodus por defecto,
con una casilla por mapa para dejárselas al modelo.**

Los modelos de imagen escriben texto ilegible o con faltas, y un mapa está lleno de texto.
Por defecto el prompt lleva un negativo explícito —«sin texto, sin letras, sin rótulos, sin
leyenda, sin rosa de los vientos, sin marco»— y **Nodus dibuja las etiquetas encima**,
tomadas de los nombres reales de los lugares.

Ventajas que no son sólo estéticas: las etiquetas quedan **correctas**, buscables,
traducibles, ocultables por capa, y siguen bien cuando el autor renombra un lugar. La rosa
de los vientos y la barra de escala también se dibujan nativas, y por tanto siguen siendo
correctas después de una ampliación.

La casilla «deja que el modelo escriba los nombres» (`world_maps.model_labels`) es para
quien quiera el look de un mapa antiguo rotulado a mano. Cuando está activa, Nodus **no
apaga sus etiquetas**: las deja ocultables por capa, porque el resultado del modelo puede
salir ilegible y hay que poder recuperar los nombres sin regenerar. Junto a la casilla, un
aviso de una línea de que los nombres los escribe el modelo y pueden salir con faltas.

### 7.3 Contenido exigido: el mapa sabe qué mundo dibuja

El prompt de creación incorpora los lugares que el autor marque para incluir, con su tipo
y —si ya están pinchados en un mapa padre— **su disposición relativa**: «Aldermoor, ciudad
portuaria amurallada al noroeste; Vael, fortaleza de montaña al sudeste; el Bosque Cano
entre ambas». Eso es lo que hace que regenerar un mapa dé un mapa *del mismo mundo* y no de
otro cualquiera.

### 7.4 Ampliación: los tres caminos

El usuario pregunta «habría que ver cómo generar la ampliación». Hay tres respuestas
distintas y las tres tienen sitio:

**(1) Recorte, sin IA — el que debe ofrecerse primero.**
El autor traza un rectángulo; Nodus recorta la imagen base a resolución nativa y crea el
mapa hijo con esos píxeles. Es instantáneo, gratis, funciona sin conexión y es
**geográficamente exacto**. Pierde detalle, sí; pero para quien ha encargado su mapa a un
ilustrador es exactamente lo que quiere, y para todos los demás es la base sobre la que
luego pedir detalle.

**(2) Zoom con IA (detalle) — el recorte, mejorado.**
El recorte anterior se manda como **imagen de referencia** junto a un prompt de detalle:
«un mapa más detallado de esta región; conserva costas, ríos y relieve exactamente;
añade el detalle propio de una escala de X km». Sale un mapa hijo nuevo.

**(3) Extensión del lienzo (outpainting) — el mapa crece por un borde.**
El autor elige borde (N/S/E/O) y cuánto. Nodus compone un lienzo mayor con la imagen
existente colocada en su sitio y pide la continuación.

En **(1)** y **(2)**, las chinchetas que caen dentro del rectángulo se **reproyectan
automáticamente** al hijo:

```
xHijo = (xPadre - parent_x0) / (parent_x1 - parent_x0)
```

Eso es lo que hace que el gesto se sienta mágico: amplías el noroeste y las tres ciudades
que ya tenías pinchadas aparecen colocadas en el mapa nuevo, sin tocar nada.

### 7.5 El outpainting y la transformación afín

**La operación más peligrosa de toda la funcionalidad.** Al crecer el lienzo, *todas* las
coordenadas normalizadas del mapa dejan de ser válidas: chinchetas, vértices de polígonos,
puntos de rutas, extremos de la calibración y el rectángulo dentro del padre.

La transformación es conocida y simple —una afín de escala y desplazamiento— pero tiene que
aplicarse **a todo, en una sola transacción**, y merece su propio test con un mapa que
tenga las cuatro geometrías, calibración y un padre. Si falla a medias, el mapa queda
inservible y el autor no tiene forma de repararlo a mano.

Además, la calibración se conserva sola: al mantener los extremos como puntos (§3.1) y
transformarlos con el resto, la escala del mapa ampliado sigue siendo correcta sin
recalibrar. Ése es el rédito de haberla guardado así.

### 7.6 Capacidades por proveedor: la parte honesta

`callImageProvider(provider, model, prompt)` hoy no acepta imagen de entrada. Hay que
ampliarlo a `callImageProvider(provider, model, prompt, { referenceImages })` **y declarar
qué proveedor puede hacerlo**:

| Proveedor | Texto→imagen | Imagen→imagen | Notas |
|---|---|---|---|
| Google (Gemini) | sí | sí | `interactions.create` acepta imagen de entrada. |
| OpenAI | sí | sí | `/v1/images/edits`, endpoint distinto al de generación. |
| OpenRouter | sí | **depende del modelo** | Hay que degradar por modelo, no por proveedor. |
| Nodus local | sí | probablemente no | Verificar antes de prometerlo. |

Cuando el proveedor elegido **no** puede tomar referencia, el camino degradado —y honesto—
es: un modelo de **visión** (que `aiClient` ya soporta) describe el recorte en prosa, y esa
descripción entra en un prompt de texto a imagen. Sale peor y hay que **decirlo en la
interfaz**, no simularlo en silencio: «Tu modelo de imagen no puede partir de una
referencia; el resultado se parecerá al recorte sólo aproximadamente».

### 7.7 Resolución

Los mapas **no pasan por `optimizedJpegs`** (recorta a 1280 px). Camino propio: hasta
~4096 px de lado mayor, WebP con calidad ~88 (bastante más pequeño que JPEG a igual
calidad), más miniatura de 480 px para las rejillas. Un mapa de
4096 px ronda 3–6 MB; diez mapas, ~50 MB en el `.db`, que además viajan en las copias y en
`.nodussync`. Hay que decirlo en la interfaz y ofrecer «reducir resolución» por mapa.

**Ojo con el codificador:** `nativeImage` de Electron sólo sabe `toPNG()` y `toJPEG()`; no
tiene WebP. El WebP hay que sacarlo de `@napi-rs/canvas` (`canvas.toBuffer('image/webp')`),
que ya es dependencia y que `decorativeImages.ts` sólo usa hoy como plan B para rasterizar.
Comprobado en este árbol: png, jpeg, webp y avif responden. Si se prefiere no depender de
canvas en la ruta principal, la alternativa es JPEG con `nativeImage` y ~30 % más de bytes.

### 7.8 Anotar un mapa con visión

El prompt que no genera imagen y que probablemente sea el más útil de todos: un modelo
multimodal **mira el mapa** —subido o generado— y propone chinchetas: «veo una bahía aquí,
una cordillera aquí, tres asentamientos aquí». El autor acepta las que quiera y las asigna
a lugares existentes o crea los que falten.

Es la forma rápida de pasar de «tengo un PNG» a «tengo un mapa vivo», y usa una capacidad
(`aiClient` con `images`) que ya está pagada y probada. Precisión modesta, pero como se
trata de sugerencias que el autor acepta una a una, el coste de un fallo es un clic.

---

## 8. Adjuntar un mapa propio

Arrastrar o elegir PNG / JPG / WebP. Se guardan los **bytes nativos**, sin recomprimir por
encima de 4096 px. Al terminar, un asistente de dos pasos que no se puede saltar sin
querer:

1. **Calibra** («traza una línea sobre la barra de escala del mapa y dime cuánto mide»).
2. **Coloca tus lugares** — la lista de lugares del vault que aún no están en ningún mapa,
   para ir pinchándolos; o el atajo de §7.8.

Un mapa sin calibrar y sin chinchetas es una lámina bonita e inerte; estos dos pasos son
los que lo convierten en un mapa.

Extra barato: un PDF de una sola página se puede pasar por el convertidor del Toolkit, que
ya existe.

---

## 9. Renderizado

**Leaflet con `L.CRS.Simple`** y `L.imageOverlay`. Sin servidor de teselas, sin red, sin
atribución. Los límites se fijan en `[[0,0],[1000, 1000·aspect]]` para que las coordenadas
normalizadas sean una multiplicación.

- Chinchetas: `L.marker` con `divIcon` (retrato del personaje, icono del lugar).
- Círculos: `L.circle` (radio en unidades del mapa; escala bien con el zoom, a diferencia de
  `circleMarker`).
- Formas y rutas: `L.polygon` / `L.polyline`.
- Etiquetas: `divIcon` propio con anticolisión sencilla (si dos etiquetas se solapan al
  nivel de zoom actual, gana la del lugar más importante por `kind`; la otra aparece al
  acercarse). Ésta es la clase de detalle que separa un mapa de un diagrama.
- **Modo oscuro:** `.pm-dark .leaflet-tile` aplica hoy un filtro de inversión a las teselas
  OSM. Ese selector **alcanzaría también al `imageOverlay`** de un mapa autoral y lo
  destrozaría. Hay que acotarlo (`.pm-dark .leaflet-tile-pane .leaflet-tile`, o una clase
  propia en el contenedor del mapa del mundo). Está en la lista de landmines por algo.

---

## 10. Extras para el escritor

Más allá de lo pedido. Todo lo de aquí sale casi gratis del modelo ya descrito, que es
precisamente el criterio para proponerlo.

1. **Regla y calculadora de viaje.** Clic en dos chinchetas → distancia en las unidades del
   mundo y **tiempo de viaje por modo** (`map_travel_modes`). Si hay una ruta (`path`) que
   los une, se mide por la ruta. Es la utilidad que todo escritor de fantasía acaba haciendo
   a mano en una servilleta.

2. **Aviso de viaje imposible.** Con presencias fechadas y escala, Nodus puede comprobar
   cada tránsito: *«Kestra está en Aldermoor el día 120 y en Vael el 122; son 400 leguas,
   20 días a caballo»*. Un informe de consistencia con los viajes imposibles del manuscrito.
   Esto **sólo es posible porque hay escala**, y justifica por sí solo todo el §3.

3. **Capa de conocimiento (niebla de guerra narrativa).** Un mapa *tal y como lo conoce un
   personaje*: regiones marcadas como desconocidas para X hasta el día D. Sirve para no
   hacer que el protagonista mencione un reino del que no ha oído hablar. Es la misma idea
   que `secret_knowers`, aplicada al espacio.

4. **Buscador de encuentros.** Con varios personajes seleccionados, lista los días en que
   dos de ellos coinciden en el mismo lugar: *«¿cuándo pudieron conocerse Kestra y Doran?»*.
   Intersección de intervalos, función pura, y responde una pregunta que hoy sólo se puede
   contestar releyendo.

5. **Las escenas, en el mapa.** Filtra por capítulo o por acto y mira **dónde ocurre tu
   historia**. Un escritor descubre en dos segundos que todo el segundo acto pasa en la
   misma habitación, o que hay un continente entero al que nunca ha ido nadie.

6. **Mapa de calor de presencia.** Dónde pasa el tiempo un personaje en el intervalo
   seleccionado. Delata protagonistas sedentarios y secundarios ubicuos.

7. **Leyenda automática** a partir de las capas y los `kind` de lugar presentes, y
   **exportación a PNG** con etiquetas, rutas y barra de escala incrustadas, a resolución de
   impresión. Un mapa que el autor pueda mandar a su editor o poner en la guarda del libro.

8. **Comparar dos momentos** en paralelo: el mismo mapa el día 100 y el día 900, con las
   fronteras de cada uno. La historia del mundo, de un vistazo.

9. **Capa de batalla.** Chinchetas con «bando» y validez temporal por turnos: mover el
   cabezal reproduce el desarrollo de la batalla. Es la misma maquinaria del §6, con otra
   escala de tiempo.

10. **Nombres coherentes.** Al crear un lugar desde el mapa, sugerir el nombre con el modelo
    de texto usando la **cultura** del lugar contenedor (`world_groups` de tipo `culture`,
    ya existe). Las montañas del norte suenan a norte.

---

## 11. Fases

| Fase | Alcance | Entregable comprobable |
|---|---|---|
| **M0** | Esquema v97, repos (`worldMapsRepo`, `mapMarkersRepo`), IPC, `syncTables`. `shared/worldMapGeometry.ts` puro. | Tests de esquema y de geometría; el vault abre a v97. |
| **M1** | Sección **Mapas** en el sidebar (sustituye a `MapView` en worldbuilding): rejilla de mapas sobre `WorldWorkspace`, crear mapa **subiendo imagen**, visor Leaflet `CRS.Simple`, migas de pan. | Subir un PNG y verlo con zoom. |
| **M2** | Calibración, barra de escala, rosa de los vientos, regla de distancia, `map_travel_modes`. | Medir dos puntos y obtener km y días a caballo. |
| **M3** | Chinchetas: punto → círculo → polígono → ruta, edición de vértices, capas, vínculo con lugares en los dos sentidos, «En los mapas» en la ficha de lugar. Cierra con la **anotación por visión** (§7.8), que sólo necesita que existan las chinchetas. | Dibujar el contorno de un bosque y asignarlo a un lugar; subir un PNG y que la IA proponga las chinchetas. |
| **M4** | `shared/worldPresence.ts`, línea temporal con reproducción, selección de uno o varios personajes, estelas e interpolación de tránsitos, validez temporal de marcadores. | Reproducir y ver moverse a un personaje entre dos ciudades. |
| **M5** | Multi-mapa temporal: `resolveMapFocus`, autoseguimiento, tira de reparto, transición entre mapas. | Reproducir y que la vista salte de mapa siguiendo al personaje. |
| **M6** | Generación con IA: `shared/mapPrompt.ts`, estilos, `callImageProvider` con referencias + capacidades por proveedor, creación desde cero, recorte sin IA, zoom con IA, outpainting con la transformación afín. | Generar un mapa, ampliar una región y ver las chinchetas reproyectadas. |
| **M7** | Extras del §10, en el orden de abajo. | El informe de consistencia lista un viaje imposible real. |

M1–M5 no dependen de la IA en absoluto: quien suba su propio mapa tiene producto completo
al final de M5. M6 es aditivo. Esa separación es deliberada — la funcionalidad no puede
quedar rehén de que el autor tenga clave de un proveedor de imagen.

### 11.1 Orden dentro de M7

El criterio es doble: **primero lo que reutiliza el motor de presencias de M4 mientras está
fresco**, y dentro de eso, lo más barato antes.

| # | Extra | Por qué ahí |
|---|---|---|
| 1 | **Escenas en el mapa** (§10.5) | Lo más barato de todo: las escenas ya tienen `place_id` y `world_day`, y M4 ya las lee. Es una capa y un filtro. Y es lo que el escritor abre a diario. |
| 2 | **Viajes imposibles** (§10.2) | La pieza estrella, y la que justifica todo el §3. Necesita escala (M2), modos de viaje (M2) y presencias (M4): las tres están listas y ninguna otra cosa las combina. |
| 3 | **Buscador de encuentros** (§10.4) | Intersección de los mismos intervalos que acaba de construir el punto 2. Hacerlo aquí es casi gratis; hacerlo en otra fase obliga a releer todo el motor. |
| 4 | **Exportar a PNG** (§10.7) | Independiente de la temporalidad: sólo necesita etiquetas, rutas y barra de escala (M2–M3). Cierra el ciclo — un mapa que se puede mandar al editor. |
| 5 | Niebla de conocimiento, mapa de calor, comparar dos momentos, capa de batalla, nombres por cultura | Fase posterior. Los cuatro son buenos, pero cada uno abre su propio modelo (quién sabe qué, agregación, vista partida, bandos) y ninguno es prerrequisito de nada. |

**La anotación por visión (§7.8) se adelanta y NO va en M7.** Al ordenar esto queda claro
que no depende de M6 en absoluto: usa `aiClient` con `images` (un modelo de visión), no
`callImageProvider`. Su único requisito es que existan las chinchetas, o sea **M3**. Y ahí
es donde vale diez veces más: es el atajo de «tengo un PNG» a «tengo un mapa vivo»,
justamente el momento en que el autor acaba de subir su mapa y tiene por delante media hora
de pinchar lugares a mano. Va al final de M3.

---

## 12. Landmines

1. **`optimizedJpegs` recorta a 1280 px.** Reusar la ruta de imágenes decorativas
   convertiría cualquier mapa en una miniatura borrosa. Camino propio (§7.7).
2. **El outpainting mueve TODAS las coordenadas.** Chinchetas, vértices, rutas, extremos de
   calibración y el rectángulo en el padre. Una transacción, un test con las cuatro
   geometrías (§7.5).
3. **`.pm-dark .leaflet-tile` alcanzaría al `imageOverlay`** e invertiría el mapa del autor.
   Acotar el selector antes de escribir la vista (§9).
4. **Tabla que no está en `syncTables.ts` no viaja** — y sus borrados resucitan, porque los
   tombstones se generan de esa misma lista. Las cuatro tablas nuevas, al grupo
   `worldbuilding`.
5. **Sin calendario, `world_day` es NULL.** Ya mordió en el vault de personajes. Todo el §6
   tiene que degradar a `world_year` + `world_order` sin ramas especiales por todas partes:
   una sola función de orden que devuelva la clave correcta.
6. **`person_places` usa `label`, no `role`.** Ya costó un fallo en tiempo de ejecución.
7. **`tsc --noEmit` no cubre `electron/`.** Los repos nuevos hay que comprobarlos con el
   build.
8. **El tamaño del `.db`.** Diez mapas grandes son ~50 MB que entran en copias, en
   `.nodussync` y en el arranque. Medir y avisar.
9. **No todos los proveedores hacen imagen→imagen.** Degradar por *modelo* en OpenRouter, no
   por proveedor, y decirlo en la interfaz (§7.6).
10. **Probar con perfil aislado.** Este plan sube el esquema; abrir un vault real con un
    build de numeración distinta lo corrompe:
    `NODUS_USERDATA=/tmp/nodus-maps ./node_modules/.bin/electron .`

---

## 13. Decisiones tomadas (2026-07-27)

| # | Decisión | Motivo | Dónde |
|---|---|---|---|
| 1 | La **residencia es el fondo**, sin fecha propia. No hay tabla puente. | Una residencia es un estado por defecto, no un suceso. No toca esquema, y la salida (`person_place_world_dates`) es aditiva si algún día hace falta. | §6.5 |
| 2 | La nueva sección **sustituye** a «Mapa» en worldbuilding. Sin segunda entrada. | La vista de genealogía sale siempre vacía en un mundo inventado: no es mejorable, no puede funcionar. `VAULT_TYPE_SCOPED_VIEWS` ya reparte vistas por tipo de vault. | §0 |
| 3 | **Nodus rotula por defecto**, con casilla por mapa (`model_labels`) para dejárselo al modelo. | Los modelos escriben texto ilegible o con faltas y un mapa es casi todo texto. Rotulando nosotros, los nombres quedan correctos, buscables, traducibles y siguen al renombrar un lugar. | §7.2 |
| 4 | **Edición de vértices a mano**, sin `leaflet-editable`. | ~200 líneas con control total del gesto frente a 40 KB y una API que domar para el 20 % que usaríamos. Mismo criterio que el motor de tours. Los cuatro detalles que hay que clavar están listados. | §4 |
| 5 | Orden de M7: **escenas en el mapa → viajes imposibles → encuentros → exportar PNG**; el resto, después. La **anotación por visión se adelanta a M3**. | Primero lo que reutiliza el motor de presencias de M4 mientras está fresco, y dentro de eso lo más barato antes. La anotación no depende de M6 (usa visión, no generación de imagen) y vale diez veces más justo cuando el autor acaba de subir su mapa. | §11.1 |

### Lo que sigue abierto, pero no bloquea

- **§6.5** — si en uso real se echa de menos «vivió en Vael del día 200 al 900», entra la
  tabla puente. Decisión aplazada a propósito: es aditiva.
- **§3.2** — `projection = 'globe'` está en el esquema desde el principio pero puede
  implementarse en M2 o esperar; sólo importa en un mapamundi.
- **§7.6** — qué modelos concretos de OpenRouter aceptan imagen de referencia hay que
  comprobarlo contra la API, no decidirlo aquí.
