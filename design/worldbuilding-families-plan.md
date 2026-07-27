# Vault de Worldbuilding — Sección **Familias**

> Estado: **plan, sin implementar** (2026-07-27).
> Segunda sección del vault `worldbuilding`, sobre la de [Personajes](worldbuilding-characters-plan.md).
> Una familia agrupa personajes y da un árbol genealógico **por familia**, con las mismas
> funciones que el árbol de genealogía, más un emblema propio.

---

## 1. Lo que hay que decidir antes de escribir código

Cuatro decisiones que condicionan todo lo demás. Las tres primeras las he resuelto en el
plan; la cuarta te la dejo marcada porque cambia el alcance.

### 1.1 «Familia» ya significa otra cosa en el código

`shared/treeFamilies.ts` define **`TreeFamily`**, y no es una casa ni un linaje: es la
unidad de dibujo *pareja + sus hijos*, con sus carriles y sus conectores. Es el motor del
árbol actual y se va a reutilizar tal cual.

Si la familia nueva se llama `Family` en el código, cualquiera que lea `treeFamilies.ts`
dentro de seis meses va a mezclar las dos.

> **Decisión.** En la UI la palabra es **Familia** (que es la correcta en español y la que
> pediste). En el código el tipo es **`CharacterFamily`** y la tabla `character_families`,
> nunca `Family` a secas. `TreeFamily` se queda como está.

### 1.2 Un personaje pertenece a UNA familia… pero se casa con otra

Pediste «asignar cada personaje a una familia (o a ninguna)», y así se implementa: la
pertenencia tiene el `person_id` como clave primaria, o sea **una familia como máximo**.

Pero en cuanto haya un matrimonio entre casas aparece la pregunta: si un personaje solo
pertenece a la casa A, ¿qué pasa con su cónyuge de la casa B cuando miras el árbol de A?
Si el árbol filtra duro por pertenencia, **el cónyuge desaparece y la arista de matrimonio
queda colgando de la nada**, que es justo lo que hace ilegible un árbol dinástico.

> **Decisión.** La familia define el **conjunto raíz** del árbol, no un filtro duro. Se
> dibujan sus miembros **y** todo personaje conectado a ellos por parentesco, marcando
> visualmente a los de fuera (emblema pequeño de su casa, o gris si no tienen). Es lo que
> hace cualquier software de genealogía y elimina el problema de raíz.
>
> Además la pertenencia guarda **cómo** se pertenece — `born | married | adopted | sworn |
> other` — así que casarse con la casa A es representable sin dejar de ser de la casa B:
> el personaje es miembro `married` de A, y en el árbol de B aparece como externo.
>
> Si más adelante quieres pertenencia múltiple, basta con cambiar la PK por una compuesta
> `(person_id, family_id)`. Es un cambio contenido y lo dejo anotado en el DDL.

### 1.3 El color de rama paterna/materna NO funciona en worldbuilding

Éste es el hallazgo importante y lo he verificado en el código.

`deriveTreeKinship` decide la rama así ([treeKinship.ts:532](../shared/treeKinship.ts)):

```ts
const father = focusParents.find((id) => sexOf.get(id) === 'male');
const mother = focusParents.find((id) => sexOf.get(id) === 'female');
```

Un personaje **nunca** fija `persons.sex` — se queda en `'unknown'` a propósito, porque
esa columna no describe a un dios ni a un dragón. Resultado: no hay raíz paterna ni
materna, **todas las ramas salen `neutral`, el árbol entero se dibuja en un solo gris y
los dos selectores de color no hacen absolutamente nada**.

Mapear el campo libre `gender` a male/female sería la solución fácil y es la equivocada:
reimpone un binario que la ficha quitó a propósito, y falla con cualquier personaje que no
encaje en él.

> **Decisión, y es lo que hace que esta sección valga la pena.** En worldbuilding las ramas
> se colorean **por familia**, no por sexo. En un árbol dinástico eso es más útil de lo que
> nunca fue paterno/materno: de un vistazo ves de qué casa viene cada línea de ancestros.
> Los dos selectores de color se sustituyen por la leyenda de familias, y cada familia usa
> su propio acento (la paleta `CHARACTER_ACCENTS` que ya existe).
>
> El modelo de rama del *layout* (`branchByPerson`, tres valores) se deja intacto: solo
> influye en el orden de los carriles y degradar a `neutral` es inocuo. El color pasa a
> venir de un mapa `familyByPerson` separado. Es una separación limpia y de bajo riesgo:
> no se toca `treeKinship.ts`.

### 1.4 Lo que te dejo por decidir

**¿Las familias son solo de worldbuilding, o también de genealogía?** El plan las scopea a
`worldbuilding`. Genealogía tiene el mismo problema (agrupar por apellido/casa) y la tabla
serviría igual, pero su árbol ya usa paterno/materno y su vocabulario es otro. Meterlas en
genealogía sería una segunda decisión de producto, no una consecuencia de ésta.

---

## 2. Alcance

### 2.1 Entra

- Crear, editar, ordenar y borrar familias.
- Asignar un personaje a una familia **desde las dos puntas**: desde la sección Familias
  (añadir miembros) y desde la ficha del personaje (elegir familia, o crear una nueva sin
  salir de la ficha). Ambas escriben lo mismo.
- Tipo de pertenencia (`born | married | adopted | sworn | other`) y rango dentro de la casa.
- **Emblema** por familia: generado con IA (catálogo de estilos, §6) o subido a mano.
- **Árbol por familia**: selector de familia, personajes de fuera dibujados y marcados,
  ramas coloreadas por casa. Todas las funciones del árbol de genealogía (§5.2).
- Lema, descripción, estado, sede y fundador.
- Sugerencia de familias a partir del parentesco ya registrado (§7.1).

### 2.2 No entra

Alianzas entre casas como grafo propio, herencia de títulos, cronología dinástica y
generación de una casa entera con IA. Quedan en §11.

---

## 3. Modelo de datos — migración **93**

`SCHEMA_VERSION` 92 → 93. Migración **solo CREATE**, sin `ALTER`.

```sql
-- Una familia: una casa, un clan, un linaje. Agrupa personajes y da un árbol propio.
--
-- NO confundir con `TreeFamily` de shared/treeFamilies.ts, que es la unidad de dibujo
-- «pareja + hijos» del motor del árbol y no tiene nada que ver con esto.
CREATE TABLE character_families (
  family_id         TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- Las palabras de la casa. Corto a propósito: es un lema, no una descripción.
  motto             TEXT,
  description       TEXT,
  -- unknown | ruling | declining | exiled | extinct | ascendant
  status            TEXT NOT NULL DEFAULT 'unknown',
  -- Token de CHARACTER_ACCENTS. Es lo que colorea las ramas de esta casa en el árbol,
  -- así que dos familias con el mismo acento son un problema de lectura: la UI avisa.
  accent            TEXT,
  seat_place_id     TEXT REFERENCES places(place_id) ON DELETE SET NULL,
  -- El personaje por el que se centra el árbol al abrir la familia. SET NULL, no CASCADE:
  -- borrar al fundador no debe borrar la casa.
  founder_person_id TEXT REFERENCES persons(person_id) ON DELETE SET NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_character_families_sort ON character_families(sort_order, name);

-- Pertenencia. `person_id` es la PK, o sea UNA familia por personaje como máximo, que es
-- lo pedido. Tabla propia y no una columna en `character_profiles` por dos razones: la
-- pertenencia lleva datos suyos (cómo se pertenece y con qué rango), y pasar a pertenencia
-- múltiple algún día es solo cambiar esta PK por (person_id, family_id).
CREATE TABLE character_family_members (
  person_id  TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,
  family_id  TEXT NOT NULL REFERENCES character_families(family_id) ON DELETE CASCADE,
  -- born | married | adopted | sworn | other
  membership TEXT NOT NULL DEFAULT 'born',
  -- Rango o título dentro de la casa: texto libre, cada mundo tiene los suyos.
  rank       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_character_family_members_family ON character_family_members(family_id);

-- El emblema, en tabla aparte y no en columnas de `character_families`, exactamente por la
-- misma razón que `person_portraits` está separada de `persons`: un BLOB en la fila
-- principal convierte cualquier listado en una transferencia de megabytes, y quitar el
-- emblema debe ser un DELETE y no siete UPDATE a NULL.
CREATE TABLE character_family_emblems (
  family_id  TEXT PRIMARY KEY REFERENCES character_families(family_id) ON DELETE CASCADE,
  mime_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes      INTEGER NOT NULL DEFAULT 0,
  blob       BLOB,
  -- El prompt que lo generó, para poder iterar en vez de volver a adivinar.
  prompt     TEXT,
  provider   TEXT,
  model      TEXT,
  style      TEXT,
  generated  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

**Registrar las tres tablas en `electron/db/syncTables.ts`**, grupo `worldbuilding`. Sin
eso, `test-sync-package` y `test-superseded-versions` fallan con «unclassified» — y con
razón: una casa que no viaja entre máquinas es media bóveda perdida.

---

## 4. Tipos compartidos

```ts
export type FamilyStatus = 'unknown' | 'ruling' | 'ascendant' | 'declining' | 'exiled' | 'extinct';
export type FamilyMembershipKind = 'born' | 'married' | 'adopted' | 'sworn' | 'other';

export interface CharacterFamily {
  familyId: string;
  name: string;
  motto: string | null;
  description: string | null;
  status: FamilyStatus;
  accent: string | null;
  seatPlaceId: string | null;
  seatPlaceName: string | null;   // resuelto por conveniencia, como en SocialRelation
  founderPersonId: string | null;
  founderName: string | null;
  sortOrder: number;
  /** Solo el hecho de que exista, nunca los bytes: el listado no los carga. */
  hasEmblem: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterFamilyInput { /* name obligatorio; el resto opcional */ }

export interface FamilyMembership {
  personId: string;
  familyId: string;
  membership: FamilyMembershipKind;
  rank: string | null;
}

/** Un miembro tal como lo lista la ficha de la familia. */
export interface FamilyMember extends FamilyMembership {
  displayName: string;
  epithet: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  birthYear: number | null;
}
```

Y en `shared/characterLabels.ts`: `FAMILY_STATUS_LABEL`, `FAMILY_MEMBERSHIP_LABEL`, con
sus arrays de orden. Recuerda registrarlos en `INDIRECT_KEY_SOURCES` — ya está el fichero,
pero los patrones actuales cogen `label:`/`hint:` y las claves de los `Record`, así que
estas entran solas.

---

## 5. Interfaz

### 5.1 `src/views/FamiliesView.tsx` — la sección

Misma forma que Personajes, por coherencia: cuadrícula arriba, detalle que la sustituye.

- **Cuadrícula de casas**: tarjeta con el emblema (cuadrado, no 3:4 como los personajes),
  nombre, lema en cursiva, franja del acento, y contadores (miembros, generaciones).
- **Detalle de la familia**, en este orden:
  1. Cabecera: emblema grande + nombre + lema + estado + sede + acciones.
  2. **Emblema** (§6): generar / subir / quitar, con su prompt guardado y visible.
  3. Descripción (campo autoguardado, reutiliza `AutoSavingField`).
  4. **Miembros**: lista con retrato, tipo de pertenencia y rango, editable en línea;
     botón de añadir que abre un selector de personajes (reutiliza `PersonMultiSelect`).
  5. **Árbol de la familia**: botón que lleva a la vista de árbol ya scopeada a esta casa.
  6. Fundador y sede.

### 5.2 El árbol por familia

`TreeView` gana una prop `family` y, cuando está presente:

| Función del árbol de genealogía | Qué pasa en el árbol por familia |
|---|---|
| Selector de persona para centrar | **Se antepone un selector de FAMILIA.** Al cambiar de casa, el foco salta a su fundador (o al miembro más antiguo por año del mundo). Es la iteración entre familias que pediste. |
| Buscar en el árbol | Igual, sobre el conjunto ya scopeado |
| Invertir orientación | Igual (`treeOrientation`) |
| **Colores paterno/materno** | **Sustituidos por la leyenda de familias** (§1.3). Cada casa con su acento; sin casa, gris |
| Zoom y paneo | Igual |
| Clic en nodo → panel lateral | Igual: marco, `KinshipEditor`, ficha completa, centrar aquí. **Más**: pertenencia y rango en esta casa |
| Leyenda de líneas | Igual |
| Aviso de edad de progenitor | Igual, pero comparando **años del mundo** (§9, landmine 2) |
| Marco de madera por persona | Igual. *Sugerencia*: que el marco por defecto se pueda fijar **por familia**, no solo por bóveda — es una forma barata de que cada casa se vea distinta |

**Personajes de fuera de la casa**: se dibujan (si no, las aristas de matrimonio cuelgan de
la nada) con el emblema pequeño de su propia familia en la esquina del nodo, o en gris si
no tienen. Un conmutador «solo miembros» permite ocultarlos para exportar o imprimir.

### 5.3 Desde la ficha del personaje

Una sección **Familia** en `CharacterDossier`, entre Descripción y Galería:

- Selector de familia con opción **«Crear familia nueva…»** en la propia lista, que abre el
  modal de alta y asigna al personaje al guardar. Ésta es la mitad de «¿desde personajes o
  desde familias?»: las dos.
- Tipo de pertenencia y rango.
- Enlace a la casa y botón para abrir el árbol centrado en este personaje.

### 5.4 Sidebar

`WorldbuildingSidebar`: **«Familias»** (icono `users` está cogido por Personajes; usar
`network` o `shield`) va en Explorar justo debajo de Personajes. Y **«Dinastías»**, que hoy
apunta a `tree`, pasa a llamarse igual pero abre el árbol con el selector de familia.

---

## 6. El emblema y sus prompts

Igual que el retrato del personaje: el estilo lo elige el autor, el prompt se guarda junto
a los bytes, y se puede subir una imagen propia.

### 6.1 Catálogo — `shared/familyEmblemStyles.ts`

```ts
export const FAMILY_EMBLEM_STYLES = [
  { id: 'heraldic_shield', label: 'Escudo heráldico',
    prompt: 'a heraldic coat of arms on a shield, flat vector heraldry, bold tinctures, clean divisions of the field, crisp edges, perfectly symmetrical' },
  { id: 'sigil', label: 'Sigilo',
    prompt: 'a single bold sigil, minimal solid silhouette, extreme contrast, iconic and instantly readable at small size' },
  { id: 'wax_seal', label: 'Sello de lacre',
    prompt: 'an antique wax seal impression, deep relief, softly worn edges, one colour of wax, photographed straight on' },
  { id: 'banner', label: 'Estandarte',
    prompt: 'a hanging cloth banner bearing one emblem, visible weave and heavy folds, muted natural dyes, straight-on view' },
  { id: 'engraved_crest', label: 'Escudo grabado',
    prompt: 'a finely engraved crest, dense line hatching, antique bookplate feel, monochrome ink on aged paper' },
  { id: 'monogram', label: 'Monograma',
    prompt: 'an ornate interlaced monogram of abstract strokes, calligraphic, symmetrical, a single colour' },
  { id: 'totem', label: 'Tótem',
    prompt: 'a carved wood and stone totem emblem, tribal geometry, weathered surface, one central motif' },
  { id: 'arcane_glyph', label: 'Glifo arcano',
    prompt: 'a luminous arcane glyph, concentric sacred geometry, fine glowing lines, deep dark field' },
  { id: 'industrial_mark', label: 'Marca industrial',
    prompt: 'a stamped industrial maker\'s mark, stencil geometry, worn painted metal, one colour' },
  { id: 'organic_crest', label: 'Emblema orgánico',
    prompt: 'an emblem grown from living matter: branches, bone, coral or chitin, biological symmetry, natural pigments' },
];
```

### 6.2 Cómo se compone — `buildFamilyEmblemPrompt(style, { charges, tinctures, extra })`

```
[plantilla del estilo]
. [charges: lo que aparece — «un cuervo negro sobre una torre partida»]
. [tinctures: los colores — «negro y oro sobre gules»]
. [extra: solo para esta imagen]
. a single emblem, centred, square composition, plain flat background, no scene, no landscape
. no text, no words, no letters, no numbers, no motto, no banner scroll, no signature, no watermark
```

Dos cosas deliberadas y las dos importan:

1. **El nombre de la familia NO entra en el prompt.** Si le das «Casa Vandrek» al modelo,
   escribe «Casa Vandrek» dentro del escudo. Un blasón con texto inventado y medio
   ilegible es inservible, y por eso la cláusula anti-texto es la más larga del prompt y
   menciona explícitamente el pergamino del lema, que es donde los modelos insisten en
   escribir.
2. **`charges` y `tinctures` van separados**, no en un campo libre único. La heráldica es
   *qué figura* y *de qué color*, y separarlos hace que el resultado sea reproducible: se
   puede cambiar el color sin que el modelo redibuje otro animal.

**Cuadrado, no 16:9.** `callImageProvider` pide `aspect_ratio: '16:9'` a Google
([decorativeImages.ts:143](../electron/ai/decorativeImages.ts)); un escudo panorámico sale
con dos tercios de fondo vacío. Hay que parametrizar la relación de aspecto — es el único
cambio que esta sección exige en código compartido con otras funciones, así que debe ser
un parámetro opcional con el valor actual por defecto, no un cambio de comportamiento.

---

## 7. Sugerencias mías

Ordenadas por lo que aportan frente a lo que cuestan. Ninguna es obligatoria.

### 7.1 Detectar familias a partir del parentesco *(barata, alta)*

Los personajes ya tienen parentesco. Recorrer las componentes conexas por aristas de
progenitor da, gratis, los grupos que **ya son** una familia. La sección propone: «6
personajes conectados y sin familia: Kaelen, Serel… ¿crear una casa con ellos?».

Convierte la asignación de un mundo ya empezado de media hora de clics en dos. Y es puro:
`shared/familySuggestions.ts`, testeable sin base de datos.

### 7.2 Aviso de acento repetido *(trivial, alta)*

Si el color de las ramas identifica la casa, dos casas con el mismo acento hacen el árbol
mentir. Un aviso al elegir el color lo evita, y es una comprobación de tres líneas.

### 7.3 Lema y estado *(triviales, media)*

Ya están en el DDL. El lema es la línea que más carácter da por menos esfuerzo, y alimenta
la IA. El estado (`reinante`, `en declive`, `exiliada`, `extinta`) da a la cuadrícula una
lectura de un vistazo que un simple listado alfabético no tiene.

### 7.4 Fundador como foco por defecto *(trivial, media)*

Sin él, cambiar de familia centra el árbol en un personaje arbitrario y hay que recolocarse
a mano cada vez. Con él, iterar entre casas es un solo clic — que es justo lo que pediste.

### 7.5 Marco de madera por familia *(barata, media)*

`effectiveFrame(personFrame, vaultFrame)` ya resuelve dos niveles. Meter la familia en
medio — `persona → familia → bóveda` — hace que cada casa se vea distinta sin tocar ningún
personaje. Una línea en `effectiveFrame` y un selector en la ficha de la familia.

### 7.6 Panel de alianzas *(media, media)* — yo lo dejaría para después

Qué casas están unidas por matrimonio y por cuántos vínculos. Se deduce entero de lo que ya
hay (aristas de cónyuge cruzando pertenencias) y no necesita esquema. Es la semilla natural
de la sección **Facciones**, así que igual conviene esperar a construirla ahí.

### 7.7 Exportar el árbol como imagen *(media, media)*

El árbol ya es un `<svg>`. Serializarlo a PNG o SVG es contenido, no motor. Encaja con la
ficha exportable que ya existe para personajes.

---

## 8. Fases

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **G0** | Migración 93, tipos, `charactersRepo`/`familiesRepo`, `syncTables` | `test-worldbuilding-families.mjs` en verde |
| **G1** | IPC + preload + `NodusApi` | `npm run build` limpio (ojo: `tsc --noEmit` no cubre `electron/`) |
| **G2** | `FamiliesView`: cuadrícula, alta, ficha, miembros | Se crean casas y se les asignan personajes |
| **G3** | Sección Familia en la ficha del personaje, con «crear familia nueva…» | Asignación desde las dos puntas |
| **G4** | Emblema: catálogo, generación, subida, relación de aspecto | Emblema generado y subido, con su prompt visible |
| **G5** | Árbol por familia: selector, externos marcados, color por casa, año del mundo | Se itera entre familias y el árbol sale coloreado por casa |
| **G6** | Sugerencia de familias (§7.1) + aviso de acento (§7.2) | Propone casas sobre un mundo ya poblado |
| **G7** | i18n en los 7 idiomas, tests, `lint`/`typecheck`/`test`/`build`/`e2e` | Todo verde |

---

## 9. Landmines

Los tres primeros los he verificado en el código; el resto ya me han mordido en esta bóveda.

1. **`sex` es `'unknown'` en todo personaje**, así que paterno/materno no existe (§1.3). No
   «arreglarlo» mapeando `gender`.
2. **El año de nacimiento del árbol sale de `parseHistoricalDate(p.birthDate).year`**
   ([TreeView.tsx:99](../src/views/TreeView.tsx)), que con un calendario inventado devuelve
   `null`. Consecuencias: las parejas se ordenan por id (arbitrario) y el aviso de edad de
   progenitor no salta nunca. Hay que alimentarlo con `profile.birthYearSort`.
3. **`TreeFamily` ya existe y significa otra cosa** (§1.1).
4. **La generación de imágenes pide 16:9**; un escudo necesita 1:1 (§6.2).
5. **Toda tabla nueva va a `syncTables.ts`** o los tests de sync fallan — y con razón.
6. **`tsc --noEmit` no cubre `electron/`**: solo `npm run build` type-checkea el main.
7. **Clave i18n duplicada = TS1117**, y las claves antiguas pueden estar **sin comillas**
   (`Galería:`), así que un detector que solo mire `'clave':` no las ve.
8. **`test:e2e` no reconstruye**: con `dist` rancio el fallo es `92 !== 93` y parece un
   error de migración.
9. **No abrir bóvedas reales con este build** mientras la numeración de migraciones difiera.

---

## 10. Tests

**Nuevo `scripts/test-worldbuilding-families.mjs`** (repo, con migraciones reales):

1. Crear familia, asignar miembro, leerlo unido con su nombre y su rango.
2. Un personaje solo puede estar en una familia: reasignar **mueve**, no duplica.
3. Borrar la familia deja a los personajes **vivos y sin familia** (no los borra).
4. Borrar un personaje limpia su pertenencia y no deja emblemas ni miembros huérfanos.
5. `listFamilies` **no** trae los bytes del emblema.
6. El conjunto del árbol de una casa incluye a los cónyuges de fuera, marcados como externos.
7. `founderPersonId` sobrevive al borrado del fundador puesto a `NULL`, sin borrar la casa.

**Nuevo `scripts/test-family-suggestions.mjs`** (puro): componentes conexas, y sobre todo
lo que **no** debe proponer (dos personajes unidos solo por matrimonio no son una casa).

**A modificar**: `test-vault-types.mjs` (vista `families` scopeada y cableada en el
sidebar), `test-i18n-coverage.mjs`, y el caso de worldbuilding del `e2e-smoke.mjs` — crear
una casa, asignarle dos personajes, comprobar que el árbol se centra en el fundador y que
el nodo del cónyuge externo aparece marcado.

Y como siempre: **romper a propósito** al menos la exclusión del blob en el listado, el
«una sola familia» y el color por casa, y ver los tres fallar antes de darlos por buenos.

---

## 11. Fuera de alcance

- Alianzas entre casas como grafo propio → espera a **Facciones** (§7.6).
- Herencia de títulos y línea de sucesión.
- Cronología dinástica (qué casa reinaba en cada año) → espera a **Cronología**.
- Generar una casa entera con IA (fundador, tres generaciones, lema y emblema de una vez).
- Pertenencia múltiple → cambio de PK, contenido, cuando haga falta (§1.2).
