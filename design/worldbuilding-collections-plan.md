# Worldbuilding — Colecciones, lugares y filtros

> ## Por dónde iba (handoff)
>
> **Schema v96.** Todo verde: `npm test` 891/891, `tsc --noEmit`, `eslint` (0 errores),
> i18n en 7 idiomas, `npm run build` y `npm run test:e2e`.
>
> Terminado: F0–F7 y la cola Q1–Q8 (ver el plan de personajes), W1 calendario del mundo,
> W2 facciones y culturas, W3 secretos, W4 escenas, y C0–C6 de este plan.
>
> **Lo que NO está hecho**, por si retomas: no hay demo de worldbuilding (como sí la hay
> para genealogía o docencia), no hay tour guiado del vault, y las secciones Enciclopedia,
> Chat del mundo, Grafo del mundo, Reglas del mundo, Conflictos, Arcos narrativos,
> Consistencia, Preguntas abiertas, Tramas y Manuscritos siguen inertes en el sidebar a
> propósito.
>
> **Para probarlo hace falta un perfil aislado.** Este build lleva seis migraciones nuevas
> (91→96) y abrir un vault real con él lo corrompe:
>
> ```
> NODUS_USERDATA=/tmp/nodus-worldbuilding ./node_modules/.bin/electron .
> ```

> Estado: **C0–C5 implementadas y verificadas; C6 (verificación final) pendiente** (2026-07-27).
> **Schema v95.** `npm test` 891/891 · typecheck, lint e i18n (7 idiomas) limpios ·
> `build` + `test:e2e` en verde con `database at schema v95`.
>
> **C3 hecha:** Lugares como árbol, `place_profiles` (v95), 37 tipos con escala, aviso de
> escala, guardián de ciclos antes de escribir, y borrado que DESPRENDE lo contenido en
> vez de arrastrarlo. La galería se extrajo a `worldImagesRepo` + `WorldGallery` y
> `charactersRepo` delega: una sola implementación de «las imágenes de una cosa».
>
> **C4 y C5 hechas:** Facciones y Culturas como dos vistas filtradas de `world_groups`
> desde un único descriptor parametrizado, sección de Pertenencias en la ficha de
> personaje, y facetas de facción y cultura en la cuadrícula. Las pertenencias viajan con
> la lista en UNA consulta agrupada, no una por personaje.
>
> Verificado por mutación: el guardián de ciclos, y mandar `language` al lado de las
> facciones (el reparto ingenuo por `!== 'culture'`) — los dos fallan como deben.
>
> **C1 hecha:** `src/components/world/WorldWorkspace.tsx` (cabecera, buscador, facetas,
> colección en rejilla/árbol/lista y ficha) + `WorldFilterBar.tsx`. `CharactersView` pasa
> de 220 líneas a un descriptor: sólo conserva lo que es de verdad de personajes (la
> tarjeta, las facetas y qué ficha abre). El layout queda como se propuso en el §1.1:
> colección a ancho completo sin selección, raíl izquierdo + ficha al seleccionar.
>
> La prueba de que el refactor no cambió el comportamiento es que **el e2e de personajes
> pasó sin tocarlo**. Después se le añadió una aserción para el layout partido, que es lo
> único nuevo, verificada por mutación (volver al comportamiento de sustituir la colección
> hace fallar el e2e).
>
> También se registró `CharactersView.tsx` en `INDIRECT_KEY_SOURCES`: los textos del
> descriptor llegan por `t(section.title)` y pasaban de milagro, porque ya estaban
> traducidos de cuando eran llamadas directas a `t()`.
> **Schema v94.** `npm test` 891/891 · typecheck y lint limpios · `build` + `test:e2e` en
> verde con `database at schema v94`.
>
> **C2 hecha:** `world_images` (con la copia desde `character_images` y el borrado de esa
> tabla), `world_groups` y `character_affiliations`, más `electron/db/worldGroupsRepo.ts`.
> Facciones y culturas comparten tabla, como propone el §4.
>
> Dos cosas que costó ver:
>
> 1. Al hacer `world_images.entity_id` polimórfica **se pierde el `ON DELETE CASCADE`** que
>    daba `character_images`. `deleteCharacter` borra la galería a mano; olvidarlo filtra
>    todas las imágenes de cada personaje borrado, y de forma invisible porque ya nadie las
>    lee. Verificado por mutación.
> 2. La primera versión del test **no probaba la copia de datos en absoluto**: creaba la BD
>    directamente en v94, donde `character_images` nunca existió, así que quitar el
>    `INSERT…SELECT` entero no rompía nada. Ahora hay un caso que levanta una BD en **v93**,
>    le mete una imagen y aplica la 94 — la única ruta que prueba lo que le pasará a un
>    vault real al actualizarse.
> Hechos: `shared/worldFilters.ts` (facetas aditivas) y `shared/placeKinds.ts` (vocabulario
> con escala, padre sugerido, chequeo de escala y detección de ciclos), con 16 casos en
> `scripts/test-world-collections.mjs`. `npm test` 891/891.
> Verificados por mutación: combinar dimensiones con OR en vez de AND, y quitar el
> conjunto de visitados del detector de ciclos — los dos fallan como deben.
>
> Las decisiones del §6 quedan aplicadas en el diseño de estas dos piezas: el modelo de
> filtros es el de bases de datos con interfaz de facetas, y la escala de lugares ya
> alimenta padre sugerido y coherencia.
> Continúa [`worldbuilding-characters-plan.md`](worldbuilding-characters-plan.md), que dejó
> hechos F0–F7, la cola Q1–Q8 y W1 (calendario) sobre **schema v93**.
>
> Objetivo: generalizar la vista de Personajes a las demás colecciones del vault
> (Lugares, Facciones, Culturas y, más adelante, Escenas), con un buscador y filtros
> facetados aditivos compartidos.

---

## 1. La idea central: una colección, una ficha

Hoy `CharactersView` mezcla tres cosas distintas: cómo se **cargan** los personajes, cómo
se **presentan** y cómo es su **ficha**. Las tres se repetirían literalmente en Lugares,
Facciones y Culturas. Se extrae un contenedor único, `WorldWorkspace`, parametrizado por
un descriptor de sección.

### 1.1 El layout, y una discrepancia que conviene resolver ahora

Pediste «a la izquierda lo que hemos ido añadiendo y a la derecha los formularios». La
sección de Personajes hoy **no** hace eso: la cuadrícula ocupa todo el ancho y la ficha la
*sustituye*. Las dos formas son buenas para cosas distintas —la rejilla ancha para
*mirar* el reparto, el partido para *trabajar* saltando entre elementos— así que propongo
quedarnos con las dos en un solo componente:

```
┌──────────────────────────────────────────────┐   ┌──────────┬───────────────────────┐
│  buscador · facetas · nuevo                  │   │ buscador │  ficha                │
├──────────────────────────────────────────────┤   ├──────────┤  (formulario de la    │
│  ▢ ▢ ▢ ▢ ▢   colección a ancho completo      │ → │ ▢ ▢      │   sección)            │
│  ▢ ▢ ▢ ▢ ▢   (nada seleccionado)             │   │ ▢ ▢      │                       │
└──────────────────────────────────────────────┘   └──────────┴───────────────────────┘
```

Sin selección, la colección ocupa todo el ancho. Al seleccionar, se **encoge a un raíl
de 18–22 rem a la izquierda** y la ficha aparece a la derecha. Un botón fija el raíl
plegado o desplegado, y la preferencia se recuerda por sección.

> **Decisión que necesito de ti:** si prefieres el partido fijo siempre (raíl + ficha,
> sin modo ancho), es una línea menos de estado. Lo he diseñado con los dos porque para
> Personajes la rejilla ancha es lo que hace que el vault se sienta un mundo y no una
> tabla, pero es tu llamada.

### 1.2 Tres presentaciones, una por naturaleza del dato

La colección se pinta de tres formas, y cada sección elige la suya porque **el dato manda**:

| Presentación | Secciones | Por qué |
|---|---|---|
| **Rejilla de tarjetas** | Personajes, Facciones, Culturas | Se navegan por imagen: cara, emblema, motivo. |
| **Árbol jerárquico** | Lugares | Un lugar *está dentro de* otro. Una rejilla plana de 200 lugares es inservible; el árbol es el navegador natural. |
| **Lista cronológica** | Escenas (W4) | Se navegan por orden narrativo, no por aspecto. |

### 1.3 El descriptor de sección

```ts
// src/components/world/worldSections.ts
export interface WorldSectionDef<T> {
  id: 'characters' | 'places' | 'factions' | 'cultures' | 'scenes';
  icon: string;
  labels: { title: string; empty: string; create: string; searchPlaceholder: string };
  presentation: 'grid' | 'tree' | 'list';
  load: (filter: WorldFilterState) => Promise<T[]>;
  /** Sólo para 'tree': de dónde cuelga cada elemento. */
  parentOf?: (item: T) => string | null;
  idOf: (item: T) => string;
  facets: WorldFacetDef[];
  Card: React.ComponentType<{ item: T; compact: boolean; onOpen: () => void }>;
  Sheet: React.ComponentType<{ item: T; onChanged: () => Promise<void>; onBack: () => void }>;
  CreateModal: React.ComponentType<{ onClose: () => void; onCreated: (id: string) => Promise<void> }>;
}
```

`CharactersView` pasa a ser `WorldWorkspace` + el descriptor de personajes. Es una
refactorización a coste real pero acotada, y es la que evita escribir cuatro veces el
mismo buscador, la misma barra de filtros y la misma gestión de selección.

---

## 2. Filtros facetados

### 2.1 Qué se reutiliza y qué no

Describes filtros «aditivos, con buscador y varios valores por tipo». Eso es exactamente
el comportamiento de la **barra de facetas del Archivo**
([`ArchiveFilterBar.tsx`](../src/components/ArchiveFilterBar.tsx)), no el constructor de
condiciones de las bases de datos. Pero el **modelo** de bases de datos
([`databaseFilters.ts`](../shared/databaseFilters.ts)) ya tiene lo que hace falta:
`FilterCondition` con operadores `isAnyOf` / `isNoneOf` / `isEmpty`.

Propuesta: **modelo de bases de datos, interfaz de facetas.**

- Cada faceta activa se guarda como una `FilterCondition` con `op: 'isAnyOf'`.
- La barra por defecto muestra un chip por dimensión; cada chip abre un
  `SearchableMultiSelect` (el que ya usan las relaciones sociales).
- Al ser el mismo modelo, más adelante caben gratis las **vistas guardadas** y un modo
  avanzado de condiciones, sin migrar nada.

```ts
// shared/worldFilters.ts
export interface WorldFacetDef {
  id: string;
  label: string;
  /** De dónde salen los valores: un vocabulario fijo o los valores presentes en el vault. */
  source: 'vocabulary' | 'distinct';
  vocabulary?: { id: string; label: string }[];
}
export interface WorldFilterState {
  search: string;
  /** dimensión → valores seleccionados. Vacío = sin filtrar por esa dimensión. */
  facets: Record<string, string[]>;
}
```

**Aditivas entre dimensiones (AND), acumulativas dentro de una (OR).** «Rol: protagonista
o antagonista» **y** «Cultura: Vael» es lo que un escritor espera al pinchar dos valores
en un chip y uno en otro.

### 2.2 Facetas por sección

| Sección | Facetas |
|---|---|
| Personajes | Rol narrativo · Estado vital · Especie · Facción · Cultura · Etiqueta de color |
| Lugares | Tipo de lugar · Escala · Dentro de · Con imágenes |
| Facciones | Tipo · Estado (activa / extinta / latente) · Alineamiento |
| Culturas | Tipo · Lengua |
| Escenas | Estado (borrador / escrita) · Lugar · Personaje que aparece |

Las de `source: 'distinct'` (especie, lengua, dentro de) se calculan de lo que hay en el
vault: un mundo con tres especies no debe ofrecer una lista de treinta.

### 2.3 Contador honesto

La cabecera muestra `12 de 87` cuando hay filtros activos, y un botón de quitarlos. Un
recuento filtrado que se presenta como el total es la forma más fácil de que alguien crea
que ha perdido la mitad de su mundo.

---

## 3. Lugares

### 3.1 Lo que ya existe (y es mucho)

`places` tiene **`parent_id` y `kind` desde la migración 33**. La jerarquía y el
clasificador no necesitan esquema nuevo: necesitan un vocabulario y una vista.

### 3.2 El vocabulario de tipos, con escala

`shared/placeKinds.ts`, con una **escala numérica** por tipo:

| Escala | Tipos |
|---|---|
| 0 | Plano · Universo |
| 1 | Galaxia · Cúmulo |
| 2 | Sistema · Estrella |
| 3 | Planeta · Luna |
| 4 | Continente · Océano |
| 5 | Región · Cordillera · Bosque · Desierto · Mar |
| 6 | País · Reino · Imperio |
| 7 | Provincia · Comarca · Condado |
| 8 | Ciudad · Pueblo · Aldea |
| 9 | Barrio · Distrito · Fortaleza · Templo · Ruina |
| 10 | Edificio · Posada · Sala · Cámara |

La escala **no es decorativa**: da tres cosas gratis.

1. **Padre por defecto** al crear: desde una Ciudad, el tipo sugerido para un hijo es Barrio.
2. **Chequeo de coherencia**, en la misma línea que los de personajes: «Un Continente
   dentro de una Ciudad» es casi siempre un error de arrastre, y detectarlo cuesta una
   comparación de enteros. Aviso, no error: un mundo puede tener una ciudad que contiene
   un plano entero, y eso es una decisión, no una errata.
3. **Agrupación del árbol** y sangrado coherente.

> **Landmine:** `places` es **compartida con genealogía**, que ya escribe
> `kind: 'municipality'`. Los dos vocabularios comparten columna y **nunca** comparten
> selector — exactamente el patrón que ya usan los tipos de evento
> (`EVENT_TYPE_OPTIONS` frente a `CHARACTER_EVENT_TYPES`). El selector de worldbuilding
> lista sólo tipos de ficción; el de genealogía, sólo los suyos.

### 3.3 Galería del lugar

Arriba de la ficha, como pediste. Dos contenidos:

- **Imágenes del lugar**, con la misma maquinaria que la galería de personajes, incluida
  la **semilla visual**: sin ella, dos imágenes de la misma ciudad no se parecen entre sí.
- **Escenas transcurridas ahí**, cuando llegue W4. Hasta entonces la tira no se dibuja
  (una sección permanentemente vacía enseña al ojo a saltársela).

**Esto exige generalizar `character_images`.** Hoy es específica de personajes; la misma
tabla debe servir a lugares, facciones y culturas. Propuesta: migración que crea
`world_images(entity_kind, entity_id, …)`, copia las filas existentes con
`entity_kind = 'character'` y elimina `character_images`. Una tabla por concepto, no dos.

> **Coste que hay que aceptar:** esa migración **no es sólo-CREATE**, así que no la puede
> reproducir el mecanismo de backfill. Y si ya has creado un vault de worldbuilding con
> este build, la copia se hace sobre datos reales. Es la razón de hacerlo **ahora**, con
> la galería recién puesta y casi sin filas, y no dentro de tres secciones.

### 3.4 Ficha de lugar

Cabecera con galería · Descripción (Apariencia · Atmósfera · Historia) y semilla visual ·
Tipo y lugar padre · Habitantes (los personajes con `person_places` apuntando aquí —
**ya existe**, es lo que genealogía usa para residencias) · Hechos ocurridos aquí (los
`events` con `place_id`, **ya existe**) · Facciones y culturas presentes · Notas.

Casi toda la ficha se alimenta de tablas que ya están pobladas.

---

## 4. Facciones y culturas: una tabla, no dos

Facción y Cultura tienen la misma forma: nombre, tipo, descripción, imagen, miembros,
periodo de existencia. Diseñarlas por separado duplicaría todo.

```sql
CREATE TABLE world_groups (
  group_id   TEXT PRIMARY KEY,
  -- faction | culture | religion | house | order | species | language
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  ...
  parent_id  TEXT REFERENCES world_groups(group_id) ON DELETE SET NULL,
  seat_place_id TEXT REFERENCES places(place_id) ON DELETE SET NULL
);
CREATE TABLE character_affiliations (
  affiliation_id TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
  group_id       TEXT NOT NULL REFERENCES world_groups(group_id) ON DELETE CASCADE,
  rank           TEXT,
  from_world_day INTEGER,
  to_world_day   INTEGER,
  notes          TEXT
);
```

**Facciones y Culturas pasan a ser dos vistas filtradas de una misma colección**, con el
mismo descriptor y distinto `kind`. Añadir «Religiones» o «Casas» después cuesta una
entrada en el vocabulario y una del sidebar. Y las facetas *Facción* y *Cultura* de
Personajes salen de aquí sin trabajo extra.

---

## 5. Fases

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **C0** | `shared/worldFilters.ts` + `WorldFilterBar` (facetas con buscador) | Tests puros del filtrado en verde |
| **C1** | `WorldWorkspace` + descriptores; **Personajes migrado a él** sin cambio funcional | El e2e de personajes sigue pasando sin tocarlo |
| **C2** | Migración: `world_images` (con copia desde `character_images`) + `world_groups` + `character_affiliations` | Test de repo; la galería de personajes sigue funcionando |
| **C3** | Lugares: vocabulario con escala, árbol, ficha con galería, chequeo de escala | Se crea una jerarquía y se navega |
| **C4** | Facciones y culturas sobre `world_groups` + pertenencias en la ficha de personaje | Un personaje pertenece a una facción con rango y periodo |
| **C5** | Facetas nuevas de Personajes (facción, cultura, especie) | Filtrado combinado |
| **C6** | i18n ×7, tests, lint, typecheck, build, e2e | Todo verde |

W3 (secretos) y W4 (escenas) siguen después, ya con el contenedor y los filtros hechos.

---

## 6. Mis sugerencias

Las que me parecen más pertinentes, en orden:

1. **Fusionar Facciones y Culturas en una tabla** (§4). Es lo que más trabajo ahorra y lo
   que hace que añadir Religiones o Casas sea trivial. Recomendada con fuerza.
2. **Generalizar `character_images` → `world_images` ahora** (§3.3), mientras la galería
   tiene cuatro filas. En tres secciones costará una migración de datos de verdad.
3. **Escala numérica en los tipos de lugar** (§3.2). Un campo que da padre sugerido,
   chequeo de coherencia y agrupación del árbol.
4. **Modelo de bases de datos con interfaz de facetas** (§2.1), no uno u otro: el
   comportamiento que pides es el de facetas, pero guardarlo como `FilterCondition` deja
   la puerta abierta a vistas guardadas sin migrar nada.
5. **Reutilizar `person_places` para los habitantes** de un lugar en vez de inventar una
   tabla: ya existe, ya tiene rol y periodo, y ya la puebla la ficha de personaje.
6. **Semilla visual también en lugares.** Es lo único que hace que dos imágenes de la
   misma ciudad se parezcan, igual que en personajes.
7. **Un solo `SearchView` del mundo, después.** Con las facetas ya definidas por sección,
   un buscador global que devuelva personajes, lugares y facciones juntos es casi gratis.
   No lo metería en estas fases, pero conviene no cerrarle la puerta.

Y dos cosas que **no** haría:

- **No** poner un mapa en la ficha de lugar todavía. La vista Mapa existe y funciona sobre
  coordenadas reales de un gazetteer terrestre; un mundo inventado necesita un mapa de
  imagen con chinchetas, que es otra funcionalidad entera.
- **No** dar a los lugares eventos propios separados de `events`. Un hecho ocurre en un
  lugar *y* le pasa a alguien; duplicar el concepto crea dos cronologías que se
  contradicen.

---

## 7. Landmines conocidos

- **Ciclos en el árbol de lugares.** «A dentro de B dentro de A» cuelga el render. El
  guardado tiene que rechazar el ciclo, y el árbol tiene que defenderse igualmente con un
  conjunto de visitados.
- **`places.kind` es compartida con genealogía** (§3.2): dos vocabularios, un selector cada uno.
- **`world_images` no es sólo-CREATE**: no la replica el backfill (§3.3).
- **El e2e de personajes es la red de seguridad de C1.** Migrar la vista al contenedor
  compartido sin tocar ese test es justo lo que prueba que no ha cambiado el comportamiento.
- **`tsc --noEmit` no cubre `electron/`**: verificar siempre con `npm run build`.
- Toda tabla nueva va a `syncTables.ts` o no viaja entre máquinas.
