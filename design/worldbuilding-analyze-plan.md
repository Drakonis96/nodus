# Worldbuilding — el grupo «Analizar» (migración 99)

> **Estado: el grupo «Analizar» está COMPLETO — A0–A10 implementados y verificados**
> (2026-07-28). `SCHEMA_VERSION = 99`, 1160/1160 tests, lint 0 errores, typecheck,
> `npm run build` y `npm run test:e2e` en verde. Lo único que A10 dejó deliberadamente
> fuera es el historial de conversaciones: habría pedido una migración que el plan no
> contempla, y el chat vive en la sesión.
>
> Plan producido por un workflow de 12 agentes (5 diseños + 5 críticas «desde la mesa de un
> novelista» + síntesis). Este documento es el resumen ejecutable; la enciclopedia (v98) va
> aparte, en la sección correspondiente del historial.

---

## 1. La tesis (no volver a discutirla)

Las cinco secciones de «Analizar» **no son cinco informes**: son cinco lecturas de una sola
afirmación que el vault no podía guardar — **«en esta escena, esto se mueve así»**. Una
regla puesta a prueba, un conflicto que avanza y un arco que gira **son la misma fila**.

Por eso el corazón es una tabla, `world_beats`, y **una franja en la ficha de escena**
(`SceneThreadsPanel` + `RulesInPlay`) que la rellena con un clic, con las filas ya
prepobladas. El autor **nunca visita cinco secciones para alimentarlas**: alimenta la escena
que está escribiendo y las cinco se llenan solas. Las vistas del menú son **informes de
lectura**, no formularios.

Corolario que decide la arquitectura: **la IA no calcula nada**. Todo diagnóstico es
aritmética pura sobre lo que el autor tecleó. Solo sobreviven dos usos de modelo, por
elemento y bajo botón, en cuarentena (§A9).

---

## 2. Lo que ya está hecho

| Fase | Qué entregó |
|---|---|
| **A0** | Migración **99** con 8 tablas: `world_scene_days`, `world_threads`, `thread_parties`, `world_beats`, `world_rules`, `world_questions`, `world_question_options`, `world_notice_mutes`. Tipos en `shared/types.ts`, alta en el grupo `worldbuilding` de `syncTables.ts`. |
| **A1** | La **cadena de días**: `shared/worldSceneDays.ts`, `recomputeSceneDays()`/`reorderScene()` en `worldStoryRepo.ts`, `SceneDayChain` en la ficha de escena. Precondición de media Continuidad. |
| **A2** | **Hilos y latidos**: `shared/worldThreads.ts` + `electron/db/worldThreadsRepo.ts` + `SceneThreadsPanel`. Ninguna vista nueva en el menú. |
| **A3** | **Continuidad como insignia**: `shared/worldFindings.ts`, `shared/worldContinuity.ts`, `electron/db/worldContinuityRepo.ts`, `ContinuityBadge`/`ContinuityProvider` en cinco fichas. |
| **A4** | **La vista de Continuidad**: `src/views/ContinuityView.tsx`, silencios enlatados, excepciones aceptadas, estado vacío con recuentos reales. «Consistencia» → **«Continuidad»**. |
| **A5** | **Conflictos**: `src/views/ConflictsView.tsx` (tablero primero), `CharacterThreadsSection`, lealtades cruzadas, `conflict` como 7.ª `WorldEntryKind`, `checkThreads` en Continuidad. |
| **A6** | **Arcos**: `src/views/ArcsView.tsx`, carriles SVG de solo lectura, tira de densidad, tramos inertes, orden de cierre, hoja de hitos. Se retiró «Tramas». |
| **A10** | **Chat del mundo**: `shared/worldChatContext.ts` + `electron/ai/worldChat.ts` + `WorldChatView`. Nodus calcula las cinco lecturas y el modelo redacta; las citas se validan contra las entradas reales. |
| **A9** | **Los dos usos de IA**: `shared/worldRuleContext.ts` + `electron/ai/worldRules.ts` (redactar el enunciado de una ley) y `shared/worldQuestionContext.ts` + `electron/ai/worldQuestionOptions.ts` (proponer tres respuestas). Nada más: la IA sigue sin calcular nada. |
| **A8** | **Preguntas abiertas**: `shared/worldQuestions.ts`, `electron/db/worldQuestionsRepo.ts`, `QuestionsView`, la captura desde cualquier campo de prosa (`questionCapture.tsx` + `anchorOf` en el shell) y la franja `SceneQuestionBand` en la escena. |
| **A7** | **Reglas**: `shared/worldRules.ts`, `electron/db/worldRulesRepo.ts`, `RulesView`, `RulesInPlay` en la escena, `rule` como 8.ª `WorldEntryKind`, «convertir en ley», `checkRules` en Continuidad. |

---

## 3. A8 — Preguntas abiertas (mínima, a propósito) — **HECHA**

Las tablas ya existían (`world_questions`, `world_question_options`, migración 99); esta
fase construyó todo lo demás **sin tocar el esquema**. Lo que sigue es el diseño tal como se
implementó, más las desviaciones al final de la sección.

### Alcance recortado

De las **siete** reglas de derivación que pedía el diseño original quedan **dos**:

- `author` — la que el autor teclea.
- `placeholder` — `???`, `TBD`, `XXX`, `[…]` encontrados en la prosa que ya escribió.

Las otras cinco **pertenecen a otra sección** y volverían a su dueño con un botón «convertir
en pregunta abierta»: enlaces rojos y entradas sin desarrollar → Enciclopedia (que ya tiene
`world_entry_proposals` con su propio libro de descartes; un segundo libro sobre los mismos
hechos es un descarte que sigue vivo en el otro sitio), huecos de arco → Arcos,
contradicciones → Continuidad, escenas sin fecha → Escenas, revelaciones → Secretos.

Con eso desaparecen `WorldQuestionWorld` (que era el vault entero por IPC en cada apertura),
`deriveQuestions` y `WorldDependencyIndex`.

### `shared/worldQuestions.ts` (puro)

```ts
export const WORLD_QUESTION_STATUS_LABEL, WORLD_QUESTION_ORIGIN_LABEL, WORLD_APPLY_MODE_LABEL;
export function questionOriginKey(origin, ...parts): string;   // 'ph:character:prs_7:backstory'
/** ???, TBD, XXX, […] — consciente de bloques de código; reutilizar el recorrido de la enciclopedia. */
export function findPlaceholders(texts: WorldTextRef[]): PlaceholderHit[];
export function mergeQuestionFeed(stored, derived, options): WorldQuestionFeedItem[];
export function nextBlockedScene(anchor, scenes): { sceneId; title; narrativeOrder } | null;
export function questionUrgency(item): WorldQuestionUrgency;
export function rankQuestionFeed(items): WorldQuestionFeedItem[];
export function planApply(option, anchor, anchorField, currentText):
  { field; nextText; replacedText } | { create: 'article'; title; summary } | null;
/** El deshacer solo es seguro si el campo sigue conteniendo lo que se aplicó. */
export function canUndo(option, currentText): boolean;
```

### La pantalla

Reutiliza el shell con `presentation: 'list'`. `idOf` devuelve `questionId` o `originKey`.

- **Dos facetas**: `anchorTitle` (distinct) y un interruptor «me bloquea». Fuera `origin` y
  `status` como facetas.
- Ficha: pregunta editable con `[[` → evidencia verbatim → línea de apalancamiento y escena
  límite → **opciones en columnas**, cada una con un único botón que **nombra la escritura
  antes de hacerla** («Se escribirá en Kaelen → Trasfondo») y que se convierte en «Deshacer»
  mientras `replaced_text` esté presente y `canUndo()` sea cierto → tras aplicar, **la lista
  de sitios que todavía dicen el texto viejo**.
- Vista «decisiones tomadas» (`status='answered'`) que **muestra las opciones descartadas**:
  la única memoria de *por qué* el mundo es como es.

### Lo que la hace usable

La **captura en una tecla** desde cualquier campo de prosa: seleccionar texto → «convertir en
pregunta abierta», con el ancla y el campo **prerrellenados**. Toca `AutoSavingField` y
`WorldEntryEditor`, que son componentes compartidos — es la parte cara de esta fase.

Más la banda «esta escena depende de N decisiones abiertas» en la ficha de escena.

### Landmines propias

- `planApply`/`canUndo` es **lo único de todo el grupo que escribe en fichas de otras
  secciones** (el trasfondo de un personaje, un artículo). El deshacer tiene que ser correcto
  de verdad: `canUndo` es falso en cuanto el campo dejó de contener lo aplicado.
- El destino se **infiere** del ancla; jamás se elige en un formulario de tres widgets.
- `apply_mode` tiene tres valores: `none | fill_field | create_article`. `none` es una
  respuesta de primera clase: hay decisiones que se toman y simplemente se recuerdan.
- El estado `parked` absorbe lo que el diseño llamaba `dismissed`: eran dos estados negativos
  indistinguibles en la práctica.

### Lo que cambió al construirla

- **`planApply` recibe la pregunta entera**, no solo `(option, anchor, anchorField)`: el
  título del artículo que crea sale de la pregunta (`questionTitle`), y el ancla no lo sabe.
- **Una decisión respondida NO desaparece de la lista**. La primera versión la borraba de la
  pantalla en el mismo clic: sin confirmación de lo que se había escrito y sin el «Deshacer»
  justo en el momento en que alguien lo quiere. Ahora se queda hasta que el autor sale de la
  sección (un `Set` de ids en la vista, no un estado en la base de datos).
- **`emptyLabel` no puede ser un ternario.** El colector de i18n lee el literal que sigue a
  `emptyLabel:`, así que la otra lectura dice lo suyo desde `EmptyState`, que llama a `t()`.
- **La captura viaja por contexto** (`WorldAnchorProvider` en `WorldWorkspace`, alimentado
  por un `anchorOf?` nuevo en el descriptor de sección) en vez de por props: son ~20 campos
  en seis fichas, y el que se olvidaría es el que se añada el año que viene.
- **`stillSaying` se resolvió como `remainingHoles(optionId)`**: la marca se lee del
  `replaced_text` de la propia opción, así que ninguna columna tiene que recordarla y sigue
  funcionando después de que el hueco que rellenó haya desaparecido.
- **Los perfiles se escriben con upsert.** `character_profiles` y `place_profiles` cuelgan de
  su padre por LEFT JOIN en todas partes: un `UPDATE` contra una ficha sin fila diría que ha
  escrito un párrafo y no habría escrito nada.

---

## 4. A9 — Los dos usos de IA — **HECHA**

Ambos **por elemento, bajo botón y en cuarentena**. Copiar el patrón de
`electron/ai/worldArticleDraft.ts`, que ya funciona: prompt puro en `shared/`, llamada en
`electron/ai/`, modelo `synthesisModel ?? extractionModel`.

1. **`draftWorldRule(ruleId)`** — `shared/worldRuleContext.ts` + `electron/ai/worldRules.ts`,
   temperatura 0.8. Escribe en **`world_rules.proposed_text`**, nunca en `statement`. La
   pantalla ya lo pinta y ya tiene Aceptar/Descartar (`rules:acceptDraft` / `rules:rejectDraft`
   existen y funcionan). Ataca la página en blanco, que es el problema real.
2. **`proposeQuestionOptions(questionId)`** — `shared/worldQuestionContext.ts` +
   `electron/ai/worldQuestionOptions.ts`, temperatura 0.9. Escribe **3 opciones** con su
   `implications` como filas `world_question_options` con `origin='ai'`. La cuarentena aquí
   es **estructural**: una opción no es canon hasta que se elige y se aplica.

Aceptar es **siempre una llamada aparte**. Ficha vacía → `noMaterial: true` sin error.

**Lo que NO se construye**, y por qué: `auditRuleAgainstScenes`, `conflictProposals` y su
bandeja, `generateArcDraft` en modo propose, `reviewWorldProse`, `world_ai_findings` con su
`material_hash` y su caducidad. Su entrada real es `world_scenes.summary`, que es NULLABLE y
en un vault real está vacío la mayor parte del tiempo. **No se paga un modelo por lo que
contesta un JOIN.**

### Lo que cambió al construirla

- **Dos líneas etiquetadas (`OPCIÓN:` / `IMPLICA:`), no JSON.** `completeJson` escala
  BAJANDO la temperatura hasta que el modelo obedece, y esta es la llamada más caliente de
  la app (0.9): pagaría tres turnos para quedarse con la más sosa de las tres. Además, de
  los modelos locales que un escritor corre de verdad, la mayoría envuelve su JSON en prosa.
  Dos prefijos sobreviven a un preámbulo, a una lista numerada, a la negrita de Markdown y a
  una despedida. El parser está en `shared/`, y **solo continúa una línea si va indentada**:
  sin ese guard, el «espero que te sirvan» del modelo acaba dentro de la ficha de alguien.
- **`hasWorldRuleMaterial` exige el título MÁS una señal** (un ámbito con nombre, una línea
  empezada, una excepción, una escena que la pone a prueba, un texto que la menciona). Un
  título a secas produce una frase que valdría para cualquier novela, y eso se borra una vez
  y no se vuelve a pulsar el botón. El aviso dice cuál de las cinco falta.
- **`blockedSceneFor(anchor)`** se exporta desde `worldQuestionsRepo` para que el prompt
  sepa qué escena está bloqueando **sin pagar el escaneo de toda la prosa del vault** que
  hace el feed.
- **No hay paso de «aceptar» en las opciones**, y no es un olvido: una opción es una
  escritura pendiente, así que elegirla y pulsar el botón que nombra lo que va a escribir ya
  es el consentimiento. El único «Aceptar» del grupo es el de la ley, porque ahí el modelo
  sí escribe en un campo.

---

## 5. A10 — Chat del mundo — **HECHO**

Se diseña **sabiendo que las otras cinco existen**, y eso cambia lo que es: **el chat no
razona sobre el mundo — Nodus calcula y el modelo redacta**. Mismo reparto que la analítica
del vault de bases de datos.

### `shared/worldChatContext.ts` (puro)

```ts
export interface WorldChatFacts {
  focus: WorldEntryRef[];                                   // resuelto por el repo desde la pregunta
  prose: { ref; field; text }[];                            // entryProse() de cada foco, verbatim
  computed: {                                               // CALCULADO POR NODUS, no por el modelo
    effectiveRules?: { rule; ruleId; overriddenBy: string[] }[];
    presenceAt?: { personId; personName; placeName; worldDay }[];
    beatsAtScene?: { threadKind; threadTitle; mark; text }[];
    findings?: WorldFinding[];
    knowersAt?: { secretTitle; people: string[]; worldDay }[];
  };
}
export const WORLD_CHAT_SYSTEM: string;
export function composeWorldChatContext(facts: WorldChatFacts): string;
export function hasWorldChatMaterial(facts: WorldChatFacts): boolean;
```

**El *system* dice tres cosas y solo tres:** (1) los bloques «CALCULADO» son hechos de Nodus
y no se discuten ni se recalculan; (2) toda afirmación sobre el mundo debe citar; (3) si el
material no contiene la respuesta, se dice — no se inventa un mundo plausible.

### Cómo cita

Con la sintaxis que ya recorre el vault: `[Marca de sangre](nodus://world/rule/rul_7)`.
`src/components/Markdown.tsx` **ya la enruta** (rama `onWorldEntry`, añadida por la
enciclopedia), así que cada cita es un clic a la ficha. El repo **valida las citas contra
`entryLookup()`** antes de pintarlas y **degrada a texto plano las inventadas** — el mismo
tratamiento que un enlace rojo.

### Lo que podrá responder, y hoy es imposible

| Pregunta | Qué la contesta |
|---|---|
| «¿Podía Kaelen invocar la Marca el día 4 120?» | `effectiveRules()` + pertenencia de ese día + `knowersAt` |
| «¿Qué tiene que moverse en la escena 41?» | `beatsForScene()` sobre `world_beats` |
| «¿Quién de mi reparto no quiere nada de nadie?» | `findStakeGaps()` |
| «¿Dónde se me hunde el libro?» | `findInertScenes()` + `beatDensity()` |
| «¿Esto contradice algo?» | `runWorldContinuity()` filtrado por los focos |
| «¿Qué me falta decidir antes de escribir la 42?» | `nextBlockedScene()` (necesita A8) |

### Lo que el chat NO hace

No escribe canon (sus sugerencias se copian a mano o se convierten en `world_questions`), no
ve el vault entero (solo los focos y sus hechos calculados, que es además la única forma de
que quepa en el contexto).

### Lo que cambió al construirlo

- **Sin foco no se calcula NADA**, y esto lo cazó el e2e: `rulesReaching` con sujeto nulo
  devuelve todas las leyes de ámbito mundial —alcanzan a todo el mundo por definición—, así
  que una pregunta que no nombraba nada llegaba al modelo con el código legal del mundo
  adjunto y respondía sobre él. Un chat que no puede decir de qué habla tiene que decir eso.
- **El día se lee en `shared/`, no en el modelo** (`readWorldDay`): todo lo que va después
  es aritmética SOBRE ese número, y un modelo que lee «el día 4 120» como 4 se equivoca con
  seguridad en las cinco lecturas. Acepta el separador de millares español (espacio y punto).
- **El foco más largo suprime al que contiene**: «Kaelen Vor» en la pregunta no es una
  mención del personaje llamado «Vor», y dejar entrar a los dos llena el foco —y la ventana
  del modelo— con una ficha que nadie ha pedido. Dos nombres de la MISMA longitud no se
  suprimen: dos cosas pueden llamarse igual.
- **Se le entrega el enlace ya escrito** («Kaelen Vor → `[Kaelen Vor](nodus://…)`»), en vez
  de esperar que componga la URL. Y aun así `validateCitations` degrada a texto plano lo
  que no exista: se conserva la frase y se retira la promesa.
- **Tránsito y «antes de su primera aparición» se dicen en voz alta.** Aplanar una posición
  a un nombre de lugar convertiría «iba de camino» en «estaba en Vael», que es exactamente
  la respuesta confiada y falsa que todo este diseño existe para evitar.
- **Sin historial de conversaciones**: habría necesitado tabla y migración, y el plan de
  A10 no lo pide. El chat vive en la sesión.

---

## 6. Landmines vigentes para las tres fases

1. **Ni una clave foránea ni un `ON DELETE CASCADE` en una migración nueva.** `foreign_keys`
   está ON, así que un `REFERENCES` sin acción declarada usa NO ACTION y **aborta el borrado
   del padre**; y `isCreateOnly()` rechaza cualquier cuerpo que contenga la palabra `DELETE`,
   lo que descalifica la migración de sus **dos** caminos de reparación. La propiedad la
   imponen las transacciones del repo.
2. **Toda tabla nueva al grupo `worldbuilding` de `syncTables.ts`**, o no viaja y sus
   borrados resucitan.
3. **Clave derivada del contenido** en cualquier conjunto que se reescriba vaciando e
   insertando, o cada guardado deja una lápida permanente por fila.
4. **Los textos que llegan a `t()` por variable necesitan clave + variables**, nunca una
   frase interpolada, y hay que registrarlos en `INDIRECT_KEY_SOURCES`. Un patrón ahí
   necesita **dos grupos de captura** (comilla y contenido).
5. **`npm run typecheck` sí cubre `electron/`.** Lo que solo caza `npm run build` son las
   **claves i18n duplicadas (TS1117)** — comprobar las tres formas de comilla antes de añadir.
6. **`npm run test:e2e` NO reconstruye**: `npm run build` antes, siempre.
7. Al graduar una sección hay que **mover el control de «sección inerte»** del e2e a otra que
   siga sin construir; su fallo significa eso, no una regresión.
8. **Probar a mano con perfil aislado**
   (`NODUS_USERDATA=/tmp/nodus-x ./node_modules/.bin/electron .`), **nunca sobre un vault
   real**: un build con distinta numeración de migraciones los corrompe.
