# Worldbuilding — «Manuscritos» (migración 100)

> **Estado: COMPLETO. M0–M9 implementadas y verificadas** (2026-07-28).
> `SCHEMA_VERSION = 101`, 1180/1180 tests, lint 0 errores, typecheck, `npm run build` y
> `npm run test:e2e` en verde. Con esto **el vault de worldbuilding no tiene ni una sección
> inerte** y su sección de escritura está terminada.

---

## 1. La tesis (no volver a discutirla)

**El manuscrito no es un documento nuevo: es la columna que le falta a la escena.**

Una novela es sus escenas en orden de relato. Este vault ya sabe cuáles son, en qué orden
van, qué día ocurren, quién sale, qué se mueve en cada una, qué leyes las rigen y qué
decisiones las bloquean. Lo único que no sabe es **qué dice el texto**.

De ahí se sigue todo lo demás, y en particular lo que esta sección **no** es: escribir la
novela en un documento aparte crearía una segunda fuente de verdad sobre la misma historia —
exactamente el fallo que este vault lleva cinco secciones evitando (no hay tabla de
hallazgos, no hay copia del trasfondo de un personaje, las proyecciones de la enciclopedia
se calculan y no se guardan). Un capítulo que existe a la vez como escena y como sección de
un documento se desincroniza el primer día que alguien corta un párrafo.

Corolario que decide el producto: **Nodus no compite con Scrivener ni con Word.** No hay
control de cambios, ni comentarios, ni WYSIWYG, ni edición colaborativa. Lo que ofrece —y no
puede ofrecer ningún editor de textos— es escribir la escena **con el mundo delante**: los
latidos que tiene que dar, las leyes que la rigen, las preguntas que la bloquean y los avisos
de continuidad, todos ya calculados, en el margen derecho mientras se escribe. Esa es la
única razón para escribir aquí en vez de en otro sitio, y por tanto es la sección entera.

Segundo corolario: **la IA no escribe la novela.** Ni una línea. El vault entero sostiene que
el autor es la fuente de verdad; una sección donde un modelo redacta prosa que después es
canon lo contradiría de raíz. (Lo que sí se abre, y se discute en §7, es una revisión que A9
rechazó **por falta de entrada** y que esta fase crea.)

---

## 2. Lo que ya existe, y lo que falta

| Ya está | Dónde |
|---|---|
| El orden del relato | `world_scenes.narrative_order`, denso y total; `reorderScene()` renumera **todas** |
| Qué pasa en la escena | `world_scenes.summary` — el plan, no el texto |
| Cuándo ocurre | la cadena de días (`world_scene_days`) → `world_day` canónico |
| Qué se mueve | `world_beats` + la franja `SceneThreadsPanel` |
| Qué leyes rigen | `rulesInPlay(sceneId)` + `RulesInPlay` |
| Qué la bloquea | `sceneQuestionLoad(sceneId)` + `SceneQuestionBand` |
| Qué choca | `ContinuityBadge` sobre la instantánea de continuidad |
| Enlaces `[[…]]` a cualquier cosa del mundo | `promoteWorldLinks` + `world_links` + retroenlaces |
| Exportar un documento largo | `worldBibleExport` (MD y PDF con `professionalReportPdf`) |

**Falta una sola cosa: el texto.** Y con él, tres cosas que sólo tienen sentido cuando el
texto existe: contar palabras, agrupar en capítulos y compilar.

---

## 3. El modelo de datos (migración 100)

Tres tablas nuevas, **todas CREATE-only**. `isCreateOnly()` rechaza cualquier cuerpo con
`ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE` o `REPLACE`, y una migración que las use pierde
**los dos** caminos de reparación (`backfillMissingCreateOnly` y la reejecución sobre una base
migrada con otra numeración). Eso significa, literalmente, que **no se puede añadir una
columna a `world_scenes`**: ni `text`, ni `chapter_id`, ni `word_count`. Todo va en tablas
nuevas con `scene_id` como clave.

```sql
-- La prosa. Tabla APARTE y no una columna de world_scenes, por dos razones distintas y
-- ambas suficientes: la migración no puede hacer ALTER, y —más importante— una novela de
-- 120 000 palabras son ~700 KB que `listScenes()` arrastraría en CADA lectura, y esa lista
-- la leen la vista de escenas, el feed de preguntas, los arcos y la cadena de días. Misma
-- regla que ya sigue world_maps con sus bytes: el cuerpo NUNCA viaja con la lista.
CREATE TABLE world_scene_text (
  scene_id     TEXT PRIMARY KEY,      -- sin REFERENCES: foreign_keys está ON y NO ACTION
  text         TEXT,                  --   abortaría "corta esta escena"
  -- Denormalizado a propósito: es lo único que la espina, el objetivo y el contador del día
  -- necesitan, y calcularlo exige leer el texto entero de todas las escenas.
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Un capítulo es DONDE EMPIEZA un capítulo. No hay tabla de capítulos con su propio orden:
-- eso sería un segundo eje de ordenación junto a narrative_order, y los dos discreparían el
-- primer día que alguien mueva una escena (la cadena de días y los carriles de los arcos ya
-- dependen de que ese orden sea denso y total). Aquí el capítulo se mueve moviendo sus
-- escenas, que es lo que un autor hace de todas formas.
CREATE TABLE world_chapter_breaks (
  scene_id  TEXT PRIMARY KEY,
  title     TEXT,
  epigraph  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Cuántas palabras había al cerrar cada día. El delta se calcula contra el día anterior y
-- PUEDE SER NEGATIVO: un día de podar es un día de trabajo, y un contador que sólo sabe
-- sumar convierte cortar en un castigo.
CREATE TABLE world_word_days (
  day          TEXT PRIMARY KEY,      -- 'YYYY-MM-DD' local
  total_words  INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

Las tres al grupo `worldbuilding` de `syncTables.ts`, o no viajan y sus borrados resucitan.
La propiedad la imponen las transacciones del repo: `deleteScene()` borra su fila de texto y
su marca de capítulo, como ya borra sus latidos.

### Un manuscrito por vault (de momento)

`narrative_order` es global. Una trilogía en un mismo mundo necesitaría un orden por
manuscrito, y eso toca el eje del que ya cuelgan la cadena de días, los carriles de los arcos
y el «tramo inerte». **Fase 1 = un manuscrito**, y la etiqueta del sidebar pasa de
«Manuscritos» a «Manuscrito» (mismo precedente que «Consistencia» → «Continuidad»). Varios
manuscritos es M7, diseñado abajo y explícitamente no ahora.

---

## 4. Las fases

### M0 — La prosa tiene sitio

Migración 100, tipos en `shared/types.ts`, alta en `syncTables.ts`,
`electron/db/worldManuscriptRepo.ts` (`getSceneText`, `saveSceneText`, `setChapterBreak`,
`manuscriptSpine`), IPC `manuscript:*` y preload. **Sin UI todavía**, salvo el botón
«Escribir» de la ficha de escena.

`saveSceneText` hace tres cosas además de guardar: promociona los `[[…]]` a enlaces
resueltos (`promoteWorldLinks`), reindexa los enlaces de la escena, y recalcula
`word_count` con `countWords()` (§6).

Test: que `listScenes()` sigue sin traer una sola palabra de prosa.

### M1 — El escritorio de escritura

`src/views/ManuscriptView.tsx`, tres columnas:

- **La espina** (izquierda): capítulos y escenas en orden de relato, con su recuento y un
  punto de estado (esbozo · borrador · escrita). Es la tabla de contenidos y el navegador.
- **El texto** (centro): el editor. Medida cómoda (~65ch), serifa, interlínea generosa —
  esto no es decoración, es la diferencia entre escribir aquí y no hacerlo. Autoguardado al
  salir del campo y al cambiar de escena, nunca con debounce (una escritura por pausa en una
  frase). `⌘↑`/`⌘↓` saltan de escena sin soltar el teclado.
- **Lo que esta escena tiene que hacer** (derecha, plegable): los latidos declarados, las
  leyes en juego, las preguntas abiertas que la bloquean y la insignia de continuidad. Todo
  ya calculado por «Analizar»; aquí sólo se muestra.

El autocompletado de `[[` se **extrae** de `WorldEntryEditor` a un hook compartido
(`useWorldLinkAutocomplete`) y el editor del manuscrito se construye sobre él. No se dobla
`WorldEntryEditor`: sus botones Guardar/Cancelar son los de un artículo, y un manuscrito
autoguarda.

### M2 — Capítulos

Marcar una escena como «aquí empieza un capítulo», con título y epígrafe opcionales. La
espina agrupa. Mover o renombrar un capítulo es mover o renombrar sus escenas: **un solo eje
de ordenación, para siempre**. Una escena de esbozo sirve de marcador de capítulo por
escribir, que es lo que un autor ya hace.

### M3 — El contador honesto

Palabras por escena, por capítulo y del manuscrito; objetivo opcional; barra de avance por
estado (esbozo/borrador/escrita, con la cuenta real de cada uno, nunca una proyección). Y el
**delta del día** desde `world_word_days`, con su signo: un día de podar aparece en negativo
y con esas palabras. El estado de la escena lo sigue poniendo el autor: no se deriva
«escrita» de un umbral de palabras — nada de lo que el autor declara se recalcula a su
espalda.

### M4 — La prosa entra en el mundo

La fase que justifica todo el diseño, y la de mayor radio de acción. Con el texto en una
tabla del vault, **toda la maquinaria existente se aplica sola**:

- **Retroenlaces**: `[[Kaelen]]` en el capítulo 12 aparece en la ficha de Kaelen.
- **Búsqueda a texto completo**: `searchWorldBodies` gana la columna de la escena.
- **Huecos**: un `???` en el manuscrito es una decisión sin tomar, y aparece en Preguntas
  abiertas sin una línea de código nueva.
- **Chat del mundo**: puede citar el texto en vez de sólo el resumen.
- **Continuidad** gana una comprobación pura y nueva: *«aparece en el texto y no está en el
  reparto»* — el enlace resuelto dice qué personajes se mencionan; el reparto dice cuáles se
  declararon. Aritmética, sin modelo.

**El punto delicado**: `entryProse()` NO debe devolver el manuscrito. Esa función alimenta
también el panel de lectura de la enciclopedia y el **export de la biblia del mundo**, y
meter ahí la prosa convertiría la biblia en la novela entera. Se añade una función aparte
—`entryIndexableProse()`— que es `entryProse()` **más** el texto, y sólo la usan los
indexadores (enlaces, búsqueda, huecos). Los dos consumidores viejos quedan intactos por
construcción, no por acordarse.

### M5 — Compilar

Exportar el manuscrito como un solo archivo, reutilizando `markdownRender` +
`professionalReportPdf`:

- **Qué se incluye**: todo, o sólo lo escrito; con o sin los resúmenes de las escenas sin
  escribir como marcadores (`[por escribir: …]`), que es como se manda un borrador parcial.
- **Formato**: portada, capítulos con su epígrafe, separador entre escenas, numeración.
- **Landmine central**: la prosa guardada contiene enlaces resueltos
  (`[Kaelen](nodus://world/character/prs_7)`). Un manuscrito que se manda a alguien **no
  puede llevarlos**: la compilación los degrada a su etiqueta. Es la operación inversa de
  `toRenderableBody()` y hay que escribirla y probarla explícitamente.

### M6 — Verificación y graduación

Tests puros (`countWords`, la espina, el degradado de enlaces, la comprobación de reparto),
tests de repo contra un vault migrado, i18n en siete idiomas, y e2e.

**Landmine de la graduación**: «Manuscritos» es el **último** ítem inerte del sidebar. La
aserción del e2e que dice «una sección sin construir no debe poder pulsarse» se queda sin
sujeto: hay que **sustituirla**, no moverla, por la contraria — que todos los ítems del
sidebar navegan. Y `test-vault-types.mjs` pasa a dieciocho vistas cableadas.

---

## 5. Lo que NO se construye, y por qué

- **Control de cambios y comentarios.** Son de un flujo de trabajo con editor externo, no del
  de escribir. Quien los necesita exporta y usa Word, que es donde su editorial ya está.
- **WYSIWYG.** Markdown, como el resto del vault. Un segundo formato de texto en la misma
  base de datos es un segundo conjunto de reglas de escapado y una fuente permanente de
  «esto se ve distinto aquí».
- **Instantáneas / versiones de escena.** Valiosas, pero son otra tabla y otra pantalla; y el
  editor de estudio ya tiene versionado que se podría reutilizar. → M8.
- **Varios manuscritos.** → M7.
- **Objetivos diarios con racha y recordatorios.** Gamificación; el delta honesto del día ya
  da el 90 % del valor sin convertir escribir en una obligación con castigo.
- **Que la IA escriba prosa.** Nunca. Ver §1.

---

## 5 bis. Lo que cambió al construirlo

- **El meta-test del catálogo se desarma solo al graduar una comprobación a otro fichero.**
  `test-world-analyze.mjs` recorría las funciones de `shared/worldContinuity.ts` buscando
  cada `id` de `CONTINUITY_CHECKS`; `manuscript.uncastMention` vive en
  `shared/worldManuscript.ts`, así que el guardián habría pasado en verde sobre un catálogo
  que promete algo que nadie implementa. Ahora recorre los dos módulos.
- **`WorldEntryEditor` se reescribió sobre el hook compartido**, no se copió: lo difícil del
  autocompletado no es el desplegable, es que el disparador se busca **hacia atrás desde el
  cursor**, que es lo que lo mantiene correcto cuando el autor vuelve a un enlace a medio
  escribir. Una segunda copia de eso deriva, y la deriva sale en el editor que esa semana
  nadie estaba probando.
- **Una sola puerta al mismo texto**: «Escribir» en la ficha de escena **navega** al
  manuscrito posicionado en esa escena (`localStorage`), en vez de abrir un segundo editor.
  De paso, el manuscrito reabre donde lo dejaste.
- **`loadedFor` guarda el único caso peligroso del autoguardado**: escribir el texto de la
  escena anterior dentro de la que se acaba de seleccionar. Sin ese guardián, cambiar de
  escena rápido pisa un capítulo con otro.
- **El enlace se llama `sourceField`, no `field`.** Cuesta un e2e en rojo averiguarlo.

## 6. Landmines conocidas antes de empezar

1. **Migración CREATE-only o no hay reparación.** Nada de `ALTER`: la prosa, el capítulo y el
   contador van en tablas nuevas, no en columnas de `world_scenes`.
2. **Ni una clave foránea con acción declarada.** `foreign_keys` está ON: un `REFERENCES` sin
   acción usa NO ACTION y **aborta** el borrado del padre. «Corta esta escena» se convertiría
   en un error de base de datos. La propiedad la imponen las transacciones del repo.
3. **El texto nunca viaja con la lista de escenas.** Es la regla que ya siguen los mapas con
   sus bytes, y aquí la violan cuatro consumidores distintos si se descuida.
4. **Contar palabras es una función pura y NO es `split(' ')`.** El texto lleva enlaces
   resueltos: contar `nodus://world/character/prs_7` como palabras infla cada recuento y el
   objetivo entero. `countWords()` quita primero las URL de los enlaces (conservando la
   etiqueta), los marcadores de Markdown y los bloques de código.
5. **`entryProse()` no puede crecer.** Alimenta la biblia del mundo; el manuscrito entra por
   `entryIndexableProse()`. Sin esa separación, exportar la biblia exporta la novela.
6. **El escaneo de huecos leerá ahora toda la novela.** `questionFeed()` recorre
   `allWorldBodies()` en cada apertura, y `sceneQuestionLoad()` una vez por ficha de escena.
   Con 700 KB de prosa hay que **medirlo** antes de decidir nada; si duele, la salida es
   escanear al guardar, no una caché de hallazgos (que sería la segunda verdad de siempre).
7. **Un capítulo no es un eje de ordenación.** Si en algún momento se añade `sort_order` a
   los capítulos, habrá dos órdenes que discrepan, y el día de la escena pasará a depender de
   cuál se lea primero.
8. **El autoguardado va al salir del campo, no con debounce.** Un debounce escribe una vez por
   pausa en una frase; sobre un capítulo entero eso son cientos de escrituras y un historial
   de sincronización inútil.
9. **`test:e2e` no reconstruye.** `npm run build` antes, siempre.
10. **Al graduar la última sección, la aserción de «sección inerte» se queda sin sujeto.**
    Se sustituyó por la contraria —ningún botón del sidebar está deshabilitado— tanto en el
    e2e como en `test-vault-types.mjs`, que ahora afirma que **ningún ítem carece de vista**.
11. **Probar a mano con perfil aislado** (`NODUS_USERDATA=/tmp/nodus-x`), nunca sobre un vault
    real: un build con distinta numeración de migraciones los corrompe.

---

## 7. M7, M8 y M9 — **HECHAS** (migración 101)

- **M7 — El estante.** El diseño de arriba —`world_manuscripts` + pertenencia de la escena +
  `narrative_order` por manuscrito— **se descartó al construirlo**, y la razón es la misma
  que ya había decidido los capítulos: sería un segundo eje de ordenación junto al del
  relato, del que cuelgan la cadena de días, los carriles de los arcos y la escena límite de
  las preguntas abiertas. **Un libro es DÓNDE empieza un libro**: `world_manuscript_starts`,
  la misma forma que `world_chapter_breaks`. Cero cambios en el orden, cero migración de
  datos, cero riesgo. El precio —los libros son tramos contiguos del orden— es exactamente
  lo que es un estante. La cadena de días sigue siendo global a propósito: en una trilogía
  de un mismo mundo el día 4120 es el día 4120, y un libro que abre otra era ancla su
  primera escena.
- **M8 — Instantáneas.** `world_scene_snapshots`, a mano y **automáticas cuando el texto se
  reduce a menos de la mitad** — el momento en que nadie se acuerda de pulsar nada (un
  pegado sobre el capítulo seleccionado). Restaurar guarda antes lo que hay, porque un
  deshacer que no se puede deshacer es una trampa, y pasa por `saveSceneText`, así que un
  capítulo restaurado no es de segunda: se le promocionan e indexan los enlaces igual.
  Tope de 20 por escena, y sale la más vieja.
- **M9 — `reviewWorldProse`.** La revisión que A9 rechazó por falta de entrada. Bajo botón,
  por escena, temperatura 0.2: de los latidos que el autor declaró, cuáles están en la
  página. **No opina sobre la prosa, no reescribe, no sugiere frases.** Un latido sin
  respuesta vuelve como `present: null` — decirle al autor que algo está escrito cuando
  nadie lo ha comprobado es justo el error que esta comprobación existe para no cometer.

### Lo que enseñó construirlas

- **`\b` es ASCII, y eso borra el español.** El parser daba por no leídos TODOS los «sí»:
  detrás de `í` y delante de `:` no hay frontera de palabra para JS. La condición correcta es
  «no le sigue otra letra», con `(?![\p{L}\p{N}])` y el flag `u`.
- **Dos sitios que saben qué posee una escena es un sitio de más.** `deleteScene()` repetía
  la lista de tablas del manuscrito, y al crecer con dos más de la v101 se quedó vieja: las
  instantáneas sobrevivían al borrado de su escena. Ahora delega en `deleteManuscriptFor()`.
- **Una marca ausente no es una marca nula.** `scene.book !== null` convierte un `undefined`
  —de cualquier llamante que omita el campo— en «aquí empieza un libro»: cada escena abría
  el suyo. Se comprueba con `Boolean(...)`.

## 8. Después (diseñado, no ahora)

- **`reviewWorldProse` en lote**, para leer un capítulo entero de una vez.
- **Modo máquina de escribir** (foco en el párrafo, desplazamiento centrado).
