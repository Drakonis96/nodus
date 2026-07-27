# Vault de Worldbuilding — Sección **Personajes**

> Estado: **F0–F7, la cola Q1–Q8 y el calendario del mundo (W1) implementados y
> verificados, SIN commitear** (2026-07-27).
> `npm test` 875/875 · `eslint` 0 errores · `typecheck` limpio · `build` + `test:e2e`
> en verde con `database at schema v93`.
>
> **Pendiente, con el diseño ya decidido (§16):** W2 facciones y culturas + pertenencias,
> W3 secretos y quién los sabe, W4 escenas y apariciones. No están bloqueadas: cada una
> es la versión mínima de una sección anunciada que un escritor necesita de verdad.
>
> Tres cosas que no estaban en el plan y hubo que hacer:
>
> 1. **`shared/types.ts` — `HistoricalEventType` ampliada** con el vocabulario de ficción
>    (`first_appearance`, `oath`, `betrayal`, `battle`, `journey`, `ascension`, `exile`,
>    `transformation`, `bond`, `loss`, `revelation`). Es seguro porque ningún consumidor
>    recorre la unión de forma exhaustiva: todos son listas explícitas
>    (`EVENT_TYPE_OPTIONS`, el `Set` de `recordsExtraction`, el `satisfies` del MCP), así
>    que los dos vocabularios comparten columna sin cruzarse nunca en un mismo selector.
> 2. **`electron/db/syncTables.ts` — grupo de sync `worldbuilding`.** El motor de
>    `.nodussync` exige que TODA tabla esté clasificada como sincronizada o excluida, y
>    `test-sync-package` / `test-superseded-versions` lo hacen cumplir. Sin registrar
>    `character_profiles` y `event_world_dates`, la mitad de ficción de cada personaje
>    no habría viajado entre máquinas. Clave nueva en `SyncGroupKey`; los tombstones de
>    borrado se generan de esa misma lista, así que se arreglan solos.
> 3. **`scripts/test-protect-persistence.mjs`** fijaba `SCHEMA_VERSION === 90` como
>    número literal, así que cualquier migración posterior lo rompía sin decir nada sobre
>    Protect. Ahora comprueba la coherencia de los tres valores y `>= 90`.
>
> Y una desviación deliberada: **`WorldbuildingHome` se adelantó de F6 a F2**, porque es
> parte de graduar el vault (sin ella, quitar el Inicio de preview dejaba el árbol sin
> compilar). F6 quedó reducida a la paleta de comandos, que sale gratis: se deriva de
> `NAV_ITEMS` filtrada por `isViewAllowedForVaultType`.

<details>
<summary>Plan original (2026-07-27)</summary>
> Primera sección real del vault `worldbuilding`, que hoy es sólo una cáscara *preview*.
> Se construye sobre la ontología de registros de genealogía (`persons`, `events`,
> `relationships`, `social_relations`, `places`) mediante una tabla de superposición,
> sin tocar el comportamiento del vault de genealogía.

---

## 1. Alcance y decisiones cerradas

### 1.1 Decisiones tomadas

| Decisión | Elección | Consecuencia |
|---|---|---|
| **Almacenamiento** | Reutilizar `persons` + tabla overlay `character_profiles` (1:1) | Eventos, parentesco, relaciones sociales, lugares, retrato, fusión y —más adelante— árbol, cronología y mapa se heredan gratis. Genealogía no se modifica. |
| **Fechas del mundo** | Texto libre para mostrar + entero opcional para ordenar | Cualquier calendario inventado funciona con una columna. Sin sistema de eras (queda en cola). |
| **Extra de fase 1** | Sólo la **cuadrícula de fichas** | Galería multi‑imagen, entrevistar al personaje y aviso de nombres confundibles quedan en cola (§13). |

### 1.2 Qué entra en la fase 1

Paridad con la ficha de personas de genealogía, adaptada a ficción:

- Crear, editar, buscar y borrar personajes.
- Nombres y **alias tipados** (nombre verdadero, de nacimiento, epíteto/título, apodo, alias, nombre en otra lengua).
- **Eventos de su vida** (tipos de ficción) con lugar, notas y orden en el calendario del mundo.
- **Parentesco** (reutiliza `KinshipEditor`) y **relaciones** (reutiliza `RelationsSection`).
- **Descripción**: Apariencia · Personalidad · Trasfondo, más **semilla visual**.
- **Biografía generada con IA** a partir de la ficha.
- **Retrato generado con IA**, y subida/encuadre de imagen propia.
- Notas en Markdown.
- **Vista en cuadrícula** de fichas con retrato, filtrable.
- Graduar `worldbuilding` de tipo *preview* a vault real, con su sidebar, su acento violeta y su Inicio.

### 1.3 Qué NO entra

Cronología, mapa, árbol, enciclopedia, facciones, culturas, escenas, tramas y manuscritos siguen sin construir: aparecen en el sidebar como secciones anunciadas (§8.4). El resto, en §13.

---

## 2. Lo que no encaja de genealogía (y por qué se cambia)

Cinco puntos concretos, todos verificados en el código actual:

1. **`persons.sex` es `male|female|unknown`.** No describe a un dios, un dragón ni una IA. Se sustituye en la ficha por `species`, `gender` y `pronouns` en el overlay. La columna `sex` se queda a `'unknown'` en worldbuilding y **no se muestra nunca**.
2. **Las fechas.** `finishCore` en [genealogyDates.ts:86](../shared/genealogyDates.ts) rechaza cualquier año fuera de 1–3000 y sólo entiende meses reales; «342 T.E.» o «13 de Lluvia de 1204» devuelven `sortKey: null`. Sin sort key, la lista de eventos de la ficha queda en orden arbitrario **sin avisar**. Por eso el año del mundo es un entero aparte (§3.2).
3. **La epistemología está invertida.** Genealogía prohíbe inventar y exige evidencia documental (`BIOGRAPHY_SYSTEM`, `hasBiographyEvidence`). En ficción el autor *es* la fuente: la biografía se escribe desde la ficha, no desde citas. Prompts nuevos (§5.1).
4. **El generador de retratos está redactado como algo a evitar** — «No recomendado… no es una fotografía real» ([PersonDossier.tsx:951](../src/components/PersonDossier.tsx)) y `buildReferencePortraitPrompt` fuerza *sepia y tonos heritage* ([decorativeImages.ts:407](../electron/ai/decorativeImages.ts)). En worldbuilding es una función de primera clase con estilo elegible.
5. **`persons.national_id`** no aplica; simplemente no se expone.

---

## 3. Modelo de datos — migración **91**

`SCHEMA_VERSION` pasa de 90 a 91 en [migrations.ts:10](../electron/db/migrations.ts).
Migración **sólo CREATE**, sin `ALTER`, para que sea reproducible por el mecanismo de
backfill de `isCreateOnly`.

### 3.1 `character_profiles`

```sql
-- Superposición de ficción sobre `persons`. Un personaje ES una persona (así hereda
-- eventos, parentesco, relaciones, lugares y retrato); esta tabla guarda lo que sólo
-- tiene sentido en un mundo inventado. En un vault de genealogía nunca tiene filas.
CREATE TABLE character_profiles (
  person_id        TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,

  -- Identidad: sustituye a persons.sex, que no describe a un dios ni a un dragón.
  species          TEXT,
  gender           TEXT,
  pronouns         TEXT,

  -- Estado narrativo en vez de nacimiento+defunción a secas.
  -- unknown | alive | dead | missing | undead | immortal | unborn
  life_status      TEXT NOT NULL DEFAULT 'unknown',

  -- protagonist | antagonist | secondary | tertiary | cameo
  narrative_role   TEXT,
  -- Token de la paleta de etiquetas (no un hex), para la cuadrícula.
  accent           TEXT,

  -- La descripción biográfica, partida en tres para que el prompt de imagen no
  -- reciba también el carácter y el pasado.
  appearance       TEXT,
  personality      TEXT,
  backstory        TEXT,

  -- Prompt canónico de apariencia, reinyectado en TODAS las generaciones de imagen.
  -- Es lo único que consigue que el personaje se parezca a sí mismo entre imágenes.
  visual_seed      TEXT,

  -- Año del mundo. La fecha legible sigue en persons.birth_date / death_date tal como
  -- la escriba el autor; estos enteros (pueden ser negativos) son lo único que ordena.
  birth_year_sort  INTEGER,
  death_year_sort  INTEGER,

  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_character_profiles_birth ON character_profiles(birth_year_sort);
```

### 3.2 `event_world_dates`

```sql
-- Orden de un evento en un calendario inventado. Tabla aparte y no una columna en
-- `events` para que la migración siga siendo sólo-CREATE y para no cargar el
-- ontología de genealogía con una columna que nunca usará.
CREATE TABLE event_world_dates (
  event_id    TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  world_year  INTEGER,
  -- Desempate dentro del mismo año (estación, día, capítulo) sin obligar al autor a
  -- inventarse un calendario completo.
  world_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_event_world_dates_year ON event_world_dates(world_year, world_order);
```

### 3.3 Lo que **no** cambia

- Los alias tipados usan `person_names.kind`, que ya es texto libre. **Sin migración.**
- El retrato usa `persons.portrait_*` y `setPersonPortrait`, ya existentes.
- Notas → `persons.notes`. Biografía → `persons.biography` / `biography_at`.

---

## 4. Tipos compartidos — `shared/types.ts`

```ts
export type CharacterLifeStatus =
  | 'unknown' | 'alive' | 'dead' | 'missing' | 'undead' | 'immortal' | 'unborn';

export type CharacterNarrativeRole =
  | 'protagonist' | 'antagonist' | 'secondary' | 'tertiary' | 'cameo';

export interface CharacterProfile {
  personId: string;
  species: string | null;
  gender: string | null;
  pronouns: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  accent: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  visualSeed: string | null;
  birthYearSort: number | null;
  deathYearSort: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Un personaje = la fila compartida de `persons` más su superposición de ficción. */
export interface Character extends Person {
  profile: CharacterProfile;
}

export interface CharacterInput {
  displayName: string;
  species?: string | null;
  gender?: string | null;
  pronouns?: string | null;
  lifeStatus?: CharacterLifeStatus;
  narrativeRole?: CharacterNarrativeRole | null;
  accent?: string | null;
  appearance?: string | null;
  personality?: string | null;
  backstory?: string | null;
  visualSeed?: string | null;
  birthDate?: string | null;      // texto libre, como lo escriba el autor
  deathDate?: string | null;
  birthYearSort?: number | null;
  deathYearSort?: number | null;
}

export interface CharacterFilter {
  search?: string;
  role?: CharacterNarrativeRole;
  status?: CharacterLifeStatus;
}
```

Nuevo fichero `shared/characterLabels.ts` (paralelo a `src/components/personLabels.ts`,
pero compartido porque el prompt de la IA también los necesita):

```ts
export const CHARACTER_LIFE_STATUS_LABEL: Record<CharacterLifeStatus, string>;
export const CHARACTER_ROLE_LABEL: Record<CharacterNarrativeRole, string>;
export const CHARACTER_EVENT_TYPE_LABEL: Record<string, string>;
export const CHARACTER_NAME_KINDS: { id: string; label: string }[];
export const CHARACTER_ACCENTS: { id: string; hex: string }[];
```

**Tipos de evento de ficción** (sustituyen a `EVENT_TYPE_OPTIONS` de genealogía; se
guardan en la misma columna `events.type`, que es texto libre):
`birth`, `death`, `first_appearance`, `oath`, `betrayal`, `battle`, `journey`,
`ascension`, `exile`, `transformation`, `bond`, `loss`, `revelation`, `other`.

**Estados**: sin determinar · vivo · muerto · desaparecido · no‑muerto · inmortal · aún no nace.
**Tipos de nombre**: nombre verdadero · nombre de nacimiento · epíteto o título · apodo · alias · nombre en otra lengua.

---

## 5. Capa de datos — `electron/db/charactersRepo.ts`

```ts
listCharacters(filter?: CharacterFilter): Character[]
getCharacter(personId: string): Character | null
createCharacter(input: CharacterInput): Character
updateCharacter(personId: string, patch: Partial<CharacterInput>): Character | null
deleteCharacter(personId: string): void          // delega en deletePerson; CASCADE limpia el overlay
listCharacterEvents(personId: string): HistoricalEvent[]
setEventWorldDate(eventId: string, worldYear: number | null, worldOrder: number): void
characterCounts(): { total: number; byRole: Record<string, number>; byStatus: Record<string, number> }
```

**Reglas de implementación, no negociables:**

- **Nunca asumir que existe la fila del overlay.** Un `Person` creado por otra vía (import,
  fusión, sincronización) no la tendrá. Todas las lecturas hacen `LEFT JOIN character_profiles`
  y **sintetizan los valores por defecto** en memoria; las escrituras usan
  `INSERT … ON CONFLICT(person_id) DO UPDATE`. No hay un `ensureProfile()` que llamar y
  olvidar: si se olvida, la ficha aparece vacía sin error.
- **Búsqueda por alias**, no sólo por `display_name`: `listCharacters({search})` hace
  `EXISTS (SELECT 1 FROM person_names …)` igual que `listPersons`.
- **Orden de los eventos**: `ORDER BY world_year IS NULL, world_year, world_order, date_sort, created_at`.
  El `IS NULL` primero evita que SQLite ponga los nulos delante y desordene la ficha.
- `updateCharacter` toca `persons` **y** el overlay en **una transacción**.

---

## 6. IA

### 6.1 Biografía — `shared/characterBiographyContext.ts` + `electron/ai/characterBiography.ts`

Espejo de [personBiography.ts](../electron/ai/personBiography.ts), con tres diferencias:

1. **La fuente es la ficha**, no la evidencia: apariencia, personalidad, trasfondo,
   alias, estado, eventos, parentesco y relaciones. `hasCharacterMaterial()` devuelve
   `true` con sólo una descripción — en genealogía eso no existía y el usuario recibía
   «no hay evidencia suficiente» con la ficha llena.
2. **Prompt nuevo.** Reglas: prosa narrativa continua, 150–250 palabras; **usar
   literalmente los pronombres y el nombre indicados**; no contradecir nada de la ficha;
   no introducir hechos, nombres ni lugares que no estén en ella; sin encabezados ni viñetas.
3. **La biografía generada no es canon automático.** Se guarda en `persons.biography`
   como hoy, pero la ficha la etiqueta como generada, con su fecha y un botón de regenerar.
   (El modo «proponer y rellenar huecos» queda en cola, §13.)

Modelo: `synthesisModel ?? extractionModel`, como en genealogía.

### 6.2 Retrato — `electron/ai/decorativeImages.ts`

Nueva exportación `generateCharacterPortrait(personId, opts: { style, extra? })`, junto a
`generatePersonPortraitFromDescription` (que se queda intacta para genealogía).

Construcción del prompt, en `shared/characterImagePrompt.ts`:

```
[plantilla de estilo elegido de DECORATIVE_IMAGE_STYLES]
. [visual_seed]                      ← primero, es el ancla de consistencia
. [appearance]
. single character portrait, head and shoulders, plain backdrop
. no text, no letters, no numbers, no logos, no watermark
```

- El estilo sale del selector ya existente `DECORATIVE_IMAGE_STYLES`; no hay maquinaria nueva.
- `vaultTypeImagePrompt('worldbuilding')` se queda en `''` **a propósito**: el estilo lo
  elige el autor por personaje, no lo impone el vault.
- Reutiliza `callImageProvider` → `optimizedJpegs` → `setPersonPortrait(..., generated=true)`,
  con lo que el `AiBadge` de `PersonPortrait` sigue funcionando.
- Si no hay `imageProvider`/`imageModel`, el mismo error accionable que ya se lanza.

### 6.3 `promptPack` del tipo de vault — `shared/vaultTypes.ts`

Hoy está vacío. Se redacta (en español, como los demás):

> **CONTEXTO DEL VAULT — MODO WORLDBUILDING.** Este vault construye un mundo de ficción.
> A diferencia de un corpus documental, aquí **el autor es la fuente de verdad**: lo que
> consta en las fichas es canon y no se contradice ni se «corrige». No introduzcas
> hechos, nombres, lugares ni parentescos que no estén en el material aportado, y cuando
> propongas algo, dilo explícitamente en vez de presentarlo como establecido. Respeta
> literalmente los nombres, epítetos y pronombres tal como el autor los escribe: no los
> traduzcas, normalices ni sustituyas. Ten en cuenta que los personajes pueden no ser
> humanos y que el calendario, la geografía y las reglas del mundo son inventados.

---

## 7. IPC · preload · `NodusApi`

| Canal | Handler | Firma en `window.nodus` |
|---|---|---|
| `characters:list` | `listCharacters` | `listCharacters(filter?): Promise<Character[]>` |
| `characters:get` | `getCharacter` | `getCharacter(id): Promise<Character \| null>` |
| `characters:create` | `createCharacter` | `createCharacter(input): Promise<Character>` |
| `characters:update` | `updateCharacter` | `updateCharacter(id, patch): Promise<Character \| null>` |
| `characters:delete` | `deleteCharacter` | `deleteCharacter(id): Promise<void>` |
| `characters:listEvents` | `listCharacterEvents` | `listCharacterEvents(id): Promise<HistoricalEvent[]>` |
| `characters:setEventWorldDate` | `setEventWorldDate` | `setCharacterEventWorldDate(eventId, year, order): Promise<void>` |
| `characters:counts` | `characterCounts` | `characterCounts(): Promise<…>` |
| `characters:generateBiography` | `generateCharacterBiography` | `generateCharacterBiography(id): Promise<{biography, noMaterial}>` |
| `characters:generatePortrait` | `generateCharacterPortrait` | `generateCharacterPortrait(id, style): Promise<Character \| null>` |

Se reutilizan sin tocar: `addPersonName`, `setPersonPortraitFromFile`, `getPersonPortrait`,
`updatePortraitFocus`, `clearPersonPortrait`, `createEvent`, `updateEvent`, `deleteEvent`,
`findOrCreatePlace`, `addRelationship`, `kinOf`, `createSocialRelation`.

Tres ficheros a tocar en paralelo, siempre los tres: [ipc.ts](../electron/ipc.ts),
[preload.ts](../electron/preload.ts) y la interfaz `NodusApi` en `shared/types.ts`.

---

## 8. Interfaz

### 8.1 `src/views/CharactersView.tsx` — la cuadrícula

Sustituye al patrón lista‑22rem + detalle de `PersonasView`: una rejilla quiere el ancho completo.

- **Cabecera**: título · contador · buscador · `Nuevo personaje` · dos selectores de filtro (rol, estado).
- **Rejilla**: `grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]`.
- **Tarjeta** (`data-testid="character-card"`):
  - retrato en `aspect-[3/4]` con `<PersonPortrait fill rounded="md" />`;
  - franja de acento arriba con el color de `profile.accent`;
  - nombre; debajo, el epíteto (primer alias de tipo *epíteto/título*) o el estado;
  - insignia de rol narrativo en la esquina;
  - punto de estado (muerto/desaparecido en gris apagado).
- **Vacío**: «Aún no hay personajes» + el botón de crear.
- **Detalle**: al pulsar una tarjeta, la ficha ocupa el panel con un botón de volver.
  Se mantiene el scroll de la rejilla al regresar.
- **Virtualización**: innecesaria por debajo de ~500 tarjetas; por encima, aplicar el
  mismo patrón que la galería ya virtualizada. Se anota, no se implementa.

> **Detalle de retrato**: con `fill`, el marcador de posición de `PersonPortrait` dibuja
> `<Icon name="user" size={size * 0.5} />` con el `size` **por defecto de 48**, o sea un
> icono diminuto en una tarjeta grande ([PersonPortrait.tsx:102](../src/components/PersonPortrait.tsx)).
> Hay que pasarle un `size` coherente o darle un marcador propio. Además, la silueta por
> defecto se elige a partir de `persons.sex`: con `sex='unknown'` cae en el marcador
> neutro, que es lo correcto aquí — **no** hay que "arreglarlo" mapeando `gender` a las
> siluetas humanas, porque un personaje puede no ser humano.

### 8.2 `src/components/CharacterDossier.tsx` — la ficha

Secciones en orden, reutilizando `PERSON_DOSSIER_SECTION_CLASS`,
`PERSON_DOSSIER_ACTION_BUTTON_CLASS` y `PERSON_DOSSIER_ADD_BUTTON_CLASS`:

1. **Cabecera** — retrato con sus acciones (subir · encuadrar · generar con IA · quitar),
   nombre, epíteto, `pronouns · species · estado`, botones editar/eliminar/cerrar.
2. **Descripción** — tres editores con autoguardado: *Apariencia*, *Personalidad*, *Trasfondo*.
   Debajo, plegado, **Semilla visual** con la explicación de para qué sirve y un botón
   «Usar la apariencia como semilla».
3. **Biografía** — igual que en genealogía: generar/regenerar, texto, fecha, etiqueta de generada.
4. **Nombres y alias** — chips; el modal de alta lleva un `<select>` de tipo en vez del
   `'variante'` fijo que usa hoy `NameVariantsEditor`.
5. **Eventos de su vida** — misma tabla que genealogía, con dos campos extra en el
   formulario: *año del mundo* (entero, admite negativos) y *orden dentro del año*.
   Los tipos son los de ficción.
6. **Parentesco** — `KinshipEditor` + resumen `KinRow`, reutilizados tal cual.
7. **Relaciones** — `RelationsSection`, reutilizada tal cual.
8. **Notas** — `MarkdownNotesEditor` sobre `persons.notes`.

Editor de datos básicos (`CharacterBasicsEditor`): nombre, especie, género, pronombres,
estado, rol narrativo, acento, fecha de nacimiento y de muerte (texto libre) y sus dos
años del mundo.

**No se portan**: sugerencias de identidad (fusión), parentescos sugeridos por evidencia,
hechos en conflicto, documentos vinculados, evidencia citada e identificador nacional.
Son superficies de prueba documental que no tienen sentido con un autor como fuente.

### 8.3 `src/views/WorldbuildingHome.tsx`

Pequeña, al estilo de `TeachingHome`: contador de personajes, «Crear personaje», los
últimos personajes tocados, y un aviso sobrio de que el resto de secciones está en construcción.

### 8.4 `src/components/WorldbuildingSidebar.tsx`

Sustituye a [PreviewVaultSidebar.tsx](../src/components/PreviewVaultSidebar.tsx), que se
elimina (worldbuilding era su único usuario). Sigue el patrón de
[TeachingSidebar.tsx](../src/components/TeachingSidebar.tsx): los ítems con `view` navegan,
los demás quedan **deshabilitados con tooltip «Disponible próximamente»**.

- **Explorar**: Enciclopedia · **Personajes → `characters`** · Lugares · Facciones · Culturas · Cronología · Mapa · Relaciones
- **Analizar**: Chat del mundo · Grafo del mundo · Reglas del mundo · Conflictos · Arcos narrativos · Consistencia · Preguntas abiertas
- **Crear**: **Notas → `notes`** (existe ya, es universal) · Escenas · Tramas · Manuscritos

> **Decisión pendiente, no bloqueante.** Docencia convirtió sus secciones no construidas en
> hilos permanentes de GitHub (`ROADMAP_THREADS`, issues #68‑73) para que la gente las
> moldeara antes de existir. Aquí serían **18 issues nuevas**, así que la fase 1 las deja
> como botones inertes. Subirlas a hilo después es una línea por sección.

### 8.5 Cableado en `src/App.tsx`

- `const isWorldbuilding = activeVault?.type === 'worldbuilding';`
- `document.documentElement.classList.toggle('worldbuilding', isWorldbuilding)`.
- Logo: nuevo `src/assets/nodus-logo-violet.svg` y su entrada en `data-vault-logo`.
- Rama de sidebar junto a la de `isDocencia`: `WorldbuildingSidebar` + **sólo** el grupo
  `tools` de `navGroups` (si no, Explorar/Analizar/Escribir salen duplicados).
- Rama de Inicio: `view === 'home' && isWorldbuilding` → `WorldbuildingHome`; y **añadir
  `&& !isWorldbuilding`** a la condición del `HomeView` genérico ([App.tsx:1354](../src/App.tsx)).
- Ruta nueva: `view === 'characters'` → `CharactersView` (carga diferida con `lazy`,
  como el resto de vistas por tipo de vault).
- Entrada en la paleta de comandos: «Personajes».

### 8.6 `src/index.css` — acento violeta

Bloque `.worldbuilding` calcado del de `.docencia` (líneas 1405‑1540, 136 reglas), con
`#7c3aed` y su escala. **Y su gemelo `.dark.worldbuilding`**: `.docencia` no remapea las
utilidades `dark:`, y los componentes de personas están llenos de ellas.

### 8.7 `src/navigation.ts`

- `View` gana `'characters'`.
- `NAV_ITEMS`: `{ id: 'characters', label: 'Personajes', icon: 'users', group: 'explore' }`.
  Comparte icono con `persons` y `teachingGroups`, que es aceptable porque nunca coinciden
  en el mismo vault.

### 8.8 `shared/vaultTypes.ts`

- `PREVIEW_VAULT_TYPES` → `[]`. Se **conserva el mecanismo** (lo reutilizarán
  `primary_sources` y `testimonios` cuando se anuncien), pero deja de tener usuarios: las
  ~12 guardas `!isPreviewVault` de `App.tsx` pasan a ser siempre verdaderas. Limpiarlas es
  un follow‑up aparte, no parte de esta fase.
- `VAULT_TYPE_SCOPED_VIEWS`: `characters: ['worldbuilding']`.
- `defaultHiddenViews` de `worldbuilding`: la misma lista que `docencia` **menos `notes`**
  (que el sidebar sí ofrece).
- `promptPack`: el texto de §6.3.

---

## 9. i18n

Todas las cadenas nuevas se escriben en español y se traducen en las **7** tablas:
`en`, `fr`, `de`, `it`, `pt`, `pt-BR`, `tr`.

`scripts/test-i18n-coverage.mjs` sólo ve las claves que puede recolectar. Las tablas de
etiquetas (`CHARACTER_LIFE_STATUS_LABEL`, `CHARACTER_ROLE_LABEL`,
`CHARACTER_EVENT_TYPE_LABEL`, `CHARACTER_NAME_KINDS`) se renderizan como `t(LABEL[x])`, o sea
**indirectamente**, así que hay que añadir `shared/characterLabels.ts` a
`INDIRECT_KEY_SOURCES` ([test-i18n-coverage.mjs:114](../scripts/test-i18n-coverage.mjs)) o
sus traducciones faltarán en silencio — exactamente el fallo con el que se lanzó el vault
de genealogía. Lo mismo para `WorldbuildingSidebar.tsx` si sus etiquetas viven en un array.

---

## 10. Tests

### A modificar

| Fichero | Cambio |
|---|---|
| `scripts/test-vault-types.mjs` | `worldbuilding` deja de ser preview: quitar del bucle de `PREVIEW_VAULT_TYPES`, `isViewAllowedForVaultType('settings','worldbuilding')` pasa a `true`, y la prueba «the worldbuilding preview exposes its complete inert bilingual sidebar» se reescribe contra `WorldbuildingSidebar`. Añadir que `characters` sólo está permitida en `worldbuilding`. |
| `scripts/test-vault-onboarding-ui.mjs` | Revisar; el icono `globe` y el color `#7c3aed` no cambian. |
| `scripts/test-i18n-coverage.mjs` | Añadir la fuente indirecta nueva. |

### A crear — `scripts/test-worldbuilding-characters.mjs`

Contra un vault real en `mkdtemp` con las migraciones de verdad:

1. `createCharacter` escribe `persons` y el overlay, y `getCharacter` los devuelve unidos.
2. **Un `Person` sin fila de overlay** se lee como personaje con los valores por defecto (la trampa del §5).
3. Los eventos se ordenan por `world_year`/`world_order`, y **un evento sin año no se cuela al principio**.
4. `deleteCharacter` limpia el overlay por CASCADE y no deja `event_world_dates` huérfanos.
5. La búsqueda encuentra por alias, no sólo por nombre visible.
6. `updateCharacter` es atómico: si falla la parte del overlay, no queda escrita la de `persons`.

### Comprobaciones finales

`npm run lint` · `npx tsc --noEmit` · `npm test` · `npm run build` **antes** de `npm run test:e2e`.

---

## 11. Orden de trabajo

| Fase | Contenido | Hecho cuando |
|---|---|---|
| **F0** | Migración 91, tipos compartidos, `characterLabels`, `charactersRepo` | `test-worldbuilding-characters.mjs` en verde |
| **F1** | IPC + preload + `NodusApi` | `tsc --noEmit` limpio |
| **F2** | Graduación del tipo de vault: `vaultTypes`, `navigation`, `WorldbuildingSidebar`, CSS violeta, logo, ramas de `App.tsx` | Un vault worldbuilding nuevo abre con su sidebar y su acento, y «Personajes» navega a una vista vacía |
| **F3** | `CharactersView` (cuadrícula, buscador, filtros, alta) | Se crean y se listan personajes |
| **F4** | `CharacterDossier`: básicos, descripción, alias, eventos, parentesco, relaciones, notas | Ficha completa editable |
| **F5** | IA: biografía y retrato | Ambos generan con un proveedor configurado y fallan con un mensaje accionable sin él |
| **F6** | `WorldbuildingHome` + entrada en la paleta de comandos | Inicio del vault útil |
| **F7** | i18n de las 7 tablas + tests actualizados + lint/tsc/test/build/e2e | Todo verde |

---

## 12. Landmines

1. **`test:e2e` no reconstruye.** Con `SCHEMA_VERSION` a 91 y un `dist` rancio, el fallo
   es `90 !== 91` y parece un error de migración. Siempre `npm run build` antes.
2. **No abrir vaults reales con este build.** Probar ramas con numeración de migraciones
   distinta sobre vaults de verdad los corrompe (tabla futura ya presente + `user_version`
   viejo → «table X already exists» al cambiar de vault). Usar un `NODUS_USERDATA` aislado.
3. **Graduar de *preview* enciende cosas.** `isPreviewVault` hoy silencia el onboarding, el
   asistente de recuperación, el tutorial básico y el tour. Al dejar de ser preview, un
   vault worldbuilding ya creado los verá aparecer de golpe. Es correcto —le pasó a
   docencia— pero hay que esperarlo y probarlo con un vault worldbuilding preexistente.
4. **`.worldbuilding` no remapea `dark:`.** Hace falta `.dark.worldbuilding` explícito.
   Los componentes de personas usan `dark:` a menudo.
5. **`t()` dinámico se escapa del test de cobertura.** §9.
6. **El worktree no lleva `node_modules` propio**: enlazar simbólicamente desde `main`, no
   `npm install` (rompe `better-sqlite3`); si hace falta, `npx electron-builder install-app-deps`.
7. **Nunca llevar nada a `main` sin confirmación explícita**, y los commits sin coautoría.

---

## 15. W1 — El calendario del mundo (migración **93**)

Un vault es **un mundo**, igual que en genealogía un vault es una familia. Por eso el
calendario es del vault y no necesita columna de propietario.

**Es opcional, y eso es la decisión de diseño principal.** Nadie debería tener que
inventarse doce nombres de mes antes de escribir su primer personaje. Sin calendario, el
entero del año ordena la cronología exactamente como antes; definirlo añade orden exacto
*dentro* de cada año y un selector de fecha en vez de una caja de texto.

- `world_calendar` (fila única, con `CHECK (id = 1)`), `world_calendar_eras`,
  `world_calendar_months`; `event_world_dates` gana `era_id`, `month_index`, `day` y
  `world_day`.
- **`world_day` es DERIVADO y almacenado**, porque SQLite tiene que poder `ORDER BY` con
  él. El precio es el mantenimiento: *cualquier* edición del calendario lo invalida —
  alargar un mes un día mueve todas las fechas posteriores— así que toda mutación termina
  en `recomputeWorldDays()`. Sin eso la cronología se pudre en silencio: seguiría
  ordenada, solo que mal, que es la peor forma de estar mal.
- **`world_day` es el desempate DENTRO del año, nunca la clave principal.** El año siempre
  significa algo; `world_day` solo existe si hay calendario. Ordenar por él primero
  mezclaría dos escalas en cuanto un vault tuviera hechos fechados y hechos con solo año.
- **Sin años bisiestos.** Son un accidente de la órbita terrestre; modelarlos volvería
  condicional toda la aritmética de días para algo que casi ningún calendario inventado
  quiere. Un año es la suma de sus meses, siempre.
- Una fecha con solo año cae en el día 0 de ese año, así que ordena **antes** que todo lo
  fechado dentro de él, que es lo que espera quien lee «1229» junto a «13 de Lluvia, 1229».
- Días y meses fuera de rango se **recortan**: un valor malo no puede producir un día
  absoluto que caiga en otro año.

`shared/worldCalendar.ts` es puro y está cubierto por 13 casos, incluida la ida y vuelta
`worldDayOf` ⇄ `fromWorldDay`. Verificado por mutación: quitar el recorte del día hace
fallar «out-of-range days and months are clamped».

---

## 16. Pendiente, con el diseño decidido

Ninguna está bloqueada: cada una es la versión mínima de una sección anunciada.

- **W2 — Facciones y culturas + pertenencias.** `world_groups` (facción · cultura ·
  religión · casa · orden) + `character_affiliations` (personaje, grupo, rango, periodo en
  días del mundo). Enciende dos secciones del sidebar y desbloquea el ítem «pertenencias».
- **W3 — Secretos y quién los sabe.** `world_secrets` (texto, dueño opcional) +
  `secret_knowers` (personaje, desde qué evento o día del mundo, cómo se enteró). El
  «desde qué capítulo» se resuelve con el evento, sin necesidad de Manuscritos.
- **W4 — Escenas y apariciones.** `world_scenes` (título, resumen, fecha del mundo, lugar,
  estado borrador/escrita, orden narrativo) + `scene_characters`. La escena es la unidad
  de trabajo real de un escritor, y da la sección «Apariciones» de la ficha.

---

## 13. Cola original de la fase 1 (ya implementada, salvo lo bloqueado en §15)

Por orden aproximado de valor:

- **Galería multi‑imagen** por personaje (retrato, cuerpo entero, expresiones, edades),
  cada imagen con su prompt guardado y una marcada como avatar. `decorative_images` ya
  guarda prompt, proveedor, modelo y una ranura `prev_*`.
- **Entrevistar al personaje**: chat en su voz, alimentado por la ficha.
- **Aviso de nombres confundibles** entre personajes (distancia de cadenas).
- **Biografía en modo propuesta**: rellena huecos y lo marca como sugerencia hasta aceptarlo.
- **Alias secretos**: marca de *secreto* y «quién lo conoce» (necesita columna en `person_names`).
- **Arco**: quiere · necesita · defecto · mentira que se cree · herida.
- **Relaciones con valencia y asimetría**, y cómo cambian a partir de un evento.
- **Voz**: registro, tics, muletillas y muestra de diálogo — audible con el TTS que ya hay.
- **Coherencia**: participar en un evento después de muerto, edades imposibles, dos «único heredero».
- **Habilidades con coste y límite.**
- **Pertenencias**: facción + rango + periodo, cultura de origen (espera a que existan esas secciones).
- **Ficha exportable** a una página (hay tubería HTML→PDF).
- **Sistema de calendario con eras** propio del mundo, que sustituiría al entero de orden.
- **Plantillas de arquetipo** y generación de personaje coherente con el mundo.
- **Secretos y estado de conocimiento**: quién sabe qué y desde qué capítulo.
- **Apariciones en escenas y manuscrito.**
- Reactivar cronología, árbol y mapa para `worldbuilding` (ya funcionan; sólo hay que
  ampliar `VAULT_TYPE_SCOPED_VIEWS` y darles el año del mundo como criterio de orden).

</details>

---

## 14. Lo que quedó construido

| Capa | Ficheros |
|---|---|
| Esquema | `electron/db/migrations.ts` (v91: `character_profiles`, `event_world_dates`) |
| Tipos | `shared/types.ts` (`Character`, `CharacterProfile`, `CharacterEvent`, …), `shared/characterLabels.ts` |
| Datos | `electron/db/charactersRepo.ts`, `electron/db/syncTables.ts` |
| IA | `shared/characterBiographyContext.ts`, `shared/characterImagePrompt.ts`, `electron/ai/characterBiography.ts`, `generateCharacterPortrait` en `electron/ai/decorativeImages.ts` |
| Puente | `electron/ipc.ts`, `electron/preload.ts` |
| Vault | `shared/vaultTypes.ts`, `src/navigation.ts`, `src/components/WorldbuildingSidebar.tsx` (sustituye a `PreviewVaultSidebar.tsx`, eliminado), `src/index.css`, `src/assets/nodus-logo-violet.svg`, `src/App.tsx` |
| UI | `src/views/CharactersView.tsx`, `src/views/WorldbuildingHome.tsx`, `src/components/CharacterDossier.tsx`, `src/components/CharacterPortrait.tsx`, `src/components/CharacterPortraitEditor.tsx`, `src/components/NewCharacterModal.tsx` |
| i18n | 115 claves × 7 tablas; `shared/characterLabels.ts` registrado en `INDIRECT_KEY_SOURCES` |
| Tests | `scripts/test-worldbuilding-characters.mjs` (nuevo), `scripts/test-vault-types.mjs`, `scripts/test-i18n-coverage.mjs`, `scripts/test-protect-persistence.mjs`, caso de worldbuilding en `scripts/e2e-smoke.mjs` |

### Segunda ronda: la cola del §13 (migración **92**)

Todo lo que tocaba esquema fue a **una** migración en vez de cinco.

| Ítem | Dónde |
|---|---|
| Galería multi-imagen | `character_images` + `CharacterGallery.tsx`; cada imagen guarda su prompt, proveedor y modelo |
| Arco y voz | columnas en `character_profiles` + `CharacterCraftSections.tsx`; la muestra de diálogo se puede **escuchar** |
| Habilidades con coste y límite | `character_abilities`; la ficha señala la habilidad sin límite |
| Alias secretos | `person_names.secret` / `known_by`; **nunca** salen en la cuadrícula |
| Valencia de relaciones | `social_relations.valence` / `since_event_id`; `RelationsSection` gana un `showValence` que genealogía no enciende |
| Nombres confundibles y coherencia | `shared/characterChecks.ts`, puro y testeado; la sección solo existe si tiene algo que decir |
| Biografía en modo propuesta | `biography_proposed`, prompt propio que exige marcar entre corchetes, y aceptar/descartar explícito |
| Entrevistar al personaje | `shared/characterInterview.ts` + `CharacterInterviewModal.tsx`; efímero a propósito |
| Ficha exportable | `shared/characterSheetExport.ts` → Markdown, **sin secretos ni notas privadas** |
| Plantillas de arquetipo | `shared/characterTemplates.ts` |
| Cronología, mapa, relaciones y dinastías | reutilizadas; solo la cronología necesitó adaptarse al año del mundo |

Tres decisiones que merecen explicación:

1. **El avatar se COPIA, no se referencia.** `person_portraits` sigue siendo la única
   fuente de verdad del avatar (lo leen la cuadrícula, el árbol y la cabecera, y es quien
   posee el encuadre no destructivo). Un blob duplicado es más barato que dos respuestas
   distintas a «cuál es la imagen de este personaje», y borrar la imagen de la galería no
   deja el avatar en blanco.
2. **Las plantillas no escriben prosa.** La primera versión rellenaba los campos con
   preguntas en español; había que borrarlas para escribir la respuesta, y eran texto
   castellano incrustado en la base de datos, fuera del alcance del i18n. Ahora una
   plantilla solo fija rol y color y dice qué campos del arco y la voz importan: quien
   pregunta son los *hints*, que son UI y ya están traducidos.
3. **La entrevista no se guarda.** Es una herramienta de pensamiento; lo que produzca se
   convierte en canon editando la ficha. Persistir transcripciones crearía un segundo
   relato del personaje que nada más lee ni mantiene.

### Mutaciones con las que se comprobó que los tests sirven

Un test que pasa no prueba nada hasta verlo fallar. Se rompieron a propósito y los tres
fallaron como debían:

1. Quitar `(w.world_year IS NULL)` del `ORDER BY` → falla «events sort by world year…».
2. Hacer que `getCharacter` devuelva `null` sin fila de overlay → falla «a person without
   an overlay is still a character».
3. Anular el `classList.toggle('worldbuilding', …)` de `App.tsx` → falla el e2e.
4. Parchear el arco de golpe en vez de campo a campo → falla «patching one arc field
   leaves its siblings alone». Es el fallo que produciría que cada blur borrase los
   cuatro campos que no estabas editando.
5. Hacer que borrar una imagen de la galería borre el avatar → falla. La primera versión
   de esa aserción reventaba con un `TypeError` en vez de nombrar el invariante; se
   reescribió con una comprobación de presencia previa.
6. Quitar el filtro de secreto de `characterEpithet` → **la primera versión NO lo cazaba**:
   el epíteto público ganaba por orden alfabético, no por el filtro. Corregido dándole al
   secreto un nombre que ordena antes («Ala Rota» < «El Cuervo de Vael»); ahora fallan
   tanto el test unitario como el e2e.
