# Plan de corrección — vault de docencia (código no-IA)

> Estado: redactado el 2026-07-19 tras auditar el código no-IA de calificaciones,
> grupos, rúbricas y exámenes. Rama `claude/modo-docencia-funciones-pendientes-9f3880`,
> nada en `main`. Continúa el plan de las 8 fases en `~/.claude/plans/`.

## Cómo usar este documento

**Regla número uno: reproducir antes de corregir.** La auditoría que originó esta lista
se equivocó al menos una vez (afirmó que las etiquetas de agregación y de perfil estaban
sin traducir; están en los cinco idiomas). En esta misma sesión, además, dos "fallos"
resultaron ser aserciones mías mal escritas y no defectos del código. Un hallazgo sin
escenario reproducido no es un hallazgo.

Cada entrada lleva su estado:

- **VERIFICADO** — reproducido contra el código real. Corregir.
- **PLAUSIBLE** — el mecanismo se sostiene leyendo el código, pero nadie lo ha ejecutado.
  Escribir primero un test que falle; si no falla, cerrar la entrada como descartada.
- **DESCARTADO** — comprobado y falso. Está aquí para que nadie vuelva a perseguirlo.

Protocolo por corrección: test que falla → arreglo → test en verde → **prueba de
mutación** sobre el arreglo → `npm run lint && npm run build && npm test && npm run test:e2e`.
Si toca interfaz, además `node scripts/verify-teaching-groups-ui.mjs`.

---

## Bloque A — Reglas que se configuran y no hacen nada · VERIFICADO

Lo más grave de toda la auditoría, y no es un bug sino una decisión pendiente. Cuatro
comportamientos tienen control en la interfaz y **cero consumidores** en `src/`
(comprobado por grep). Una casilla marcada que no hace nada es peor que no ofrecerla:
el docente cree que su cuaderno se comporta de una manera y se comporta de otra.

Por cada uno hay que **elegir explícitamente: cablearlo o retirar el control.**

| Regla | Dónde está el control | Qué falta |
|---|---|---|
| **Efecto trinquete** | `AssessmentPlanEditor.tsx` (casilla), activo por defecto en 3 perfiles | `computeGrade` recibe `previous`, y nadie lo puebla. Hay que leer las notas de convocatorias/evaluaciones anteriores y pasarlas desde `TeachingGradesView`. |
| **Mención honorífica** | `AssessmentPlanEditor.tsx` (cupo + redondeo), columna en el acta | `awardHonours`/`honoursQuota` no se llaman. Calcular en la vista sobre el grupo y rellenar `ActaRow.honours`. |
| **Evaluación por rúbrica** | El selector promete «se evalúa abriendo la rúbrica» | `setRubricEvaluation`/`getRubricEvaluation` no tienen llamante. Falta la celda que abre la rejilla de la rúbrica. |
| **Estados de entrada** | Regla «Lo no entregado cuenta como» | La rejilla solo envía `evaluated`/`not_assessed`. `not_submitted`, `exempt` y `validated` son inalcanzables. Falta el menú de estado en la celda. |

Recomendación: **cablear los cuatro**. Los tres primeros ya tienen motor y persistencia;
falta interfaz. El cuarto es el más valioso de todos —es la diferencia entre una casilla
en blanco y un cero— y es un menú contextual en la celda.

También sin uso: `anonymousGrid` (`shared/assessment/grid.ts`) y
`GradebookGridInput.convocatoria`, declarado y nunca leído.

---

## Bloque B — Registros legales incorrectos · PLAUSIBLE

Estos producen una nota mal puesta en planes verosímiles. Reproducir primero.

### B1. El disparador de «no presentado» suma pesos de padres distintos
`shared/assessment/engine.ts` (`totalLeafWeight` / `missingLeafWeight`).

`weight` es relativo **dentro de su padre**; el contador los suma por todo el árbol.
Escenario a reproducir: bloque EXAMEN (peso 50) con 2 hojas de peso 1, y bloque
PRÁCTICAS (peso 50) con 10 hojas de peso 10. Quien hace el examen entero y ninguna
práctica acumula 90/102 = 88 % de ausencia → **no presentado**, pese a haber hecho la
mitad de la asignatura. El simétrico da 2 % y se califica con normalidad.

Arreglo: calcular la ausencia como **fracción del peso efectivo del árbol**, normalizando
por nivel igual que hace la agregación. La misma suma entre padres invalida
`maxNonRecoverablePct` en `validatePlan`.

### B2. Los mínimos se disparan en items que `bestOf` luego descarta
`applyThresholds` corre durante el recorrido de hojas, antes de que el padre decida
cuáles cuentan, y `unmetMin` es global.

Escenario: «mejores 3 de 4», cada prueba con `minToAverage: 0.4`, notas **9, 9, 9, 2**.
El 2 se descarta, la media es 9 — pero el 2 ya marcó el mínimo incumplido y la nota
final queda topada en 4,9 y suspensa. Igual con `isMandatory`.

Arreglo: mover la comprobación de umbrales a después de que el padre seleccione los
hijos que cuentan, o registrar los incumplimientos por nodo y consolidarlos al agregar.

### B3. El perfil de FP se contradice consigo mismo
`shared/assessment/profiles.ts` (`fp`: `scaleMin: 1`, `scaleMax: 10`, `passAt: 0.5`).

Con escala 1–10, `passAt: 0.5` significa **5,5**, no 5. Y hay tres consumidores que
ignoran `scaleMin`: `grid.ts` y `gradebookHtml.ts` proyectan bloques con
`fraction * scaleMax` en vez de `toScale`, y `itemAnalysis.ts` calcula
`passMark = passAt * scaleMax`. Resultado a reproducir: un alumno con todo a 4,7/10
sale «5 — No apto» en el acta y **aprobado** en el panel de analítica.

Arreglo: exportar `toScale`/`toFraction` desde el motor y usarlas en los tres
consumidores; revisar el `passAt` del perfil de FP.

### B4. Coma flotante: `truncate`, `threshold` y `halfDown` no llevan épsilon
`roundValue` en `engine.ts`. `halfUp` lo lleva a propósito («so binary representation
cannot flip it») y los otros tres no.

No conseguí reproducirlo con el caso concreto que me dieron (daba 5,0 exacto), así que
**está sin confirmar**. Pero la asimetría es real y basta con una media ponderada que
caiga en 4,999999999999999 para registrar 4,9 y suspender a quien tiene un 5.

Arreglo: aplicar el mismo épsilon en los cuatro modos. Test: barrer valores **calculados**
(medias ponderadas reales), no literales — los literales nunca reproducen el problema.

### B5. `threshold` e `integer` ignoran `decimals`
Ambos ramales calculan `factor` y no lo usan. Con `decimals: 2` y umbral 0,7,
`roundValue(6.55)` devuelve 6. El editor deja configurar ambos y no avisa de que uno
anula al otro. Además `roundingThreshold: 0` (permitido por el `min="0"` del campo) hace
que 6,0 suba a 7.

### B6. La proyección de «no presentado» pisa lo que el plan registra
En `computeGrade`, el bloque final asigna `record.numeric` y `record.qualitative` después
de la comprobación de `rules.record`. Un plan **solo cualitativo** puede acabar emitiendo
un número, y uno **solo numérico** un término. Además los dos caminos que llevan a «no
presentado» producen registros distintos (uno deja `qualitative: null`, el otro pone el
código del plan).

---

## Bloque C — Pérdida de trabajo y de datos · PLAUSIBLE

### C1. Borrados destructivos sin confirmación
Borrar un elemento de evaluación (`AssessmentPlanEditor.tsx`) arrastra en cascada todos
sus descendientes **y todas las notas** que colgaran de ellos, con un solo clic. Borrar un
alumno (`TeachingGroupsView.tsx`) elimina sus notas en todos los cuadernos. Ambos conviven
con flujos que sí usan `ConfirmModal` — esa inconsistencia es la señal.

### C2. Revisar un plan deja la interfaz editando la versión congelada
`AssessmentPlanEditor` descarta el plan devuelto por `reviseAssessmentPlan` y recarga por
el id antiguo. Tras «Crear versión nueva» sigues viendo la publicada y el botón sigue ahí:
pulsarlo tres veces crea tres versiones huérfanas inalcanzables.

### C3. Los objetos anidados del editor se parchean desde una prop obsoleta
El repo fusiona parches parciales precisamente para que dos ediciones simultáneas
compongan, pero la fusión es superficial y el editor envía objetos anidados enteros
(`np`, `minNotMet`, `honours`, `advisories`) construidos desde la prop. Editar el código
del acta y acto seguido su equivalencia numérica pierde el primero.

### C4. Evaluaciones parciales de rúbrica puntúan como ceros
`setRubricEvaluation` hace `continue` en los criterios sin nivel elegido, y esos aportan 0
al total, que se guarda como `evaluated`. Una rúbrica de 5 criterios con 3 marcados al
máximo da 60 %, indistinguible de un mal desempeño.

### C5. Exámenes: pérdida de datos al teclear
- Cambiar el número de opciones de una pregunta dispara `resizeExamOptions` **en cada
  pulsación**: teclear «10» sobre «4» pasa primero por 1, que se recorta a 2 y **borra las
  opciones 3 y 4 con su texto**.
- «Total del enunciado» escribe en la base de datos en cada pulsación; vaciar el campo
  pone **todas las subpreguntas a 0 puntos**, y el campo ni siquiera se puede vaciar.
- Lo tecleado mientras corre una generación con IA se revierte al resolverse, porque el
  parche se construye sobre la instantánea capturada al pulsar Generar.

### C6. Ids duplicados en rúbricas y exámenes
`emptyRubricCriterion(\`C${length + 1}\`)` y equivalentes para niveles y pares. Borrar C2
de C1/C2/C3 y añadir vuelve a crear **C3**. Consecuencias reales: rellenar una celda con
IA escribe en dos criterios, y en niveles dos columnas comparten `cells[id]`, de modo que
escribir en una cambia la otra.

---

## Bloque D — Calidad de los documentos · PLAUSIBLE

- **D1.** El pie de una rúbrica ponderada contradice sus filas: las filas suman los
  máximos por criterio y el pie imprime `/ scaleMax`. Con pesos 50 % + 20 % las filas dan 7
  y el pie dice 10.
- **D2.** Los saltos de línea se pierden en el DOCX (no en el PDF): `docx` no parte `\n`,
  hace falta `break: 1` o una tirada por línea.
- **D3.** «Solo el solucionario» en DOCX imprime igualmente la cabecera del examen y la
  casilla de nota; la ruta HTML sí usa una cabecera aparte.
- **D4.** La validación no bloquea la exportación pese a que su propia documentación dice
  que sí. Se puede exportar un examen con una pregunta de imagen sin imagen.
- **D5.** La vista previa del examen conserva el idioma anterior tras cambiar el de la
  interfaz (`useMemo` sin el idioma en dependencias — este proyecto **no tiene regla
  `exhaustive-deps`**, así que solo lo caza la app real). La exportación sí usa el nuevo,
  con lo que la vista previa deja de coincidir con el fichero.
- **D6.** `record: 'both'` emite dos columnas con la misma cabecera «Calificación».
- **D7.** El CSV no neutraliza la inyección de fórmulas (`=`, `+`, `-`, `@` al inicio de
  celda). Riesgo bajo en el acta —solo exporta identificador, nombre y notas— pero el
  arreglo va en el escritor común de `shared/databaseExport.ts`, no aquí.

---

## Bloque E — Analítica · PLAUSIBLE

- **E1.** Las filas de alumno en blanco que precrea un grupo entran en el análisis de
  ítems como totales cero. Con un grupo declarado de 30 y 22 reales, el 27 % inferior son
  exactamente las 8 filas vacías: la media del grupo débil es 0 en todas las preguntas y
  **todas salen «excelentes»**. Existe `isStudentFilled` y no se usa aquí.
- **E2.** `groupMean` devuelve 0 para un grupo sin notas en un ítem, lo que confunde
  «ausente» con «cero» — la misma confusión que el módulo declara evitar.
- **E3.** El panel de analítica queda vacío en planes solo cualitativos (lee
  `record.numeric`, siempre nulo): debería decir que la distribución no aplica en vez de
  informar «0 calificaciones».
- **E4.** Cohortes degeneradas (n = 1, notas todas iguales) producen 0 y se etiquetan
  «mala» sin avisar de que el dato no es interpretable. La tabla no muestra `n`.

---

## Bloque F — Robustez · PLAUSIBLE, prioridad baja

- `updateAssessmentItem` acepta cualquier `parentId` sin comprobar ciclos: un item que sea
  su propio descendiente cuelga el proceso principal con recursión infinita. Hoy ninguna
  interfaz lo envía.
- `validated` sin nota usa un valor en escala de plan como si fuera de item.
- Anulación manual en una rama ignorada cuando ningún hijo tiene datos.
- El trinquete sube `fraction` pero deja `points` obsoleto, así que no hace nada bajo
  padres que agregan por `sum` / `normalizeTarget` / `normalizeGroupMax`.
- `normalizeGroupMax` da el máximo cuando falta la referencia del grupo: el primer alumno
  calificado saca 100 % hasta que aparezca un segundo.
- Los pesos que muestra la derivación no son los que se usaron bajo `bestOf`, `mean`,
  `mode`, `max`, `last` ni `conditionalMean` — y esa derivación es el documento que
  responde a una reclamación.
- `awardHonours` no consulta `passed` ni «no presentado»: concedería mención a quien no se
  presentó. Latente mientras nadie la llame (Bloque A).
- `distributeSectionPoints` propaga `NaN`; `scaleMax` no se acota al crear una rúbrica.

---

## Ya corregido en esta sesión — no repetir

- Solucionario de verdadero/falso escrito a mano: decía **siempre «Falso»**.
- Letra de la respuesta en opción múltiple con opciones en blanco.
- `generateRubric` devolvía un criterio cuando se pedían cuatro (guard demasiado laxo,
  el reintento nunca se disparaba).
- `generateExamQuestion` sustituía en silencio un tipo desconocido por `short_essay`.
- El comentario para la familia repetía el nombre del alumno.

## DESCARTADO — no volver a perseguirlo

- **«Las etiquetas de agregación, redondeo y perfiles están sin traducir».** Falso:
  comprobado que están en los cinco idiomas. `shared/assessment/profiles.ts` está
  registrado en `INDIRECT_KEY_SOURCES` de `scripts/test-i18n-coverage.mjs`.
- **Escapado HTML de las exportaciones.** Correcto en las tres rutas (acta, boletín,
  rúbricas y exámenes); probado inyectando `<script>` en nombres, asignaturas y
  descriptores.
- **`= NULL` en vez de `IS NULL`.** Correcto en ambos repos.
- **Componentes definidos dentro de otros.** No queda ninguno.
- **Controles deshabilitados a mitad de clic.** Corregido y con comentario que lo explica.

---

## Orden sugerido

1. **Bloque A** — decidir cablear o retirar. Es lo único que no es un bug sino una
   promesa incumplida al usuario, y condiciona qué se prueba después.
2. **B1, B2, B3** — producen registros legales incorrectos en planes verosímiles.
3. **C1, C5, C6** — pérdida de trabajo y corrupción silenciosa.
4. **E1** — hace que la analítica mienta justo en la dirección que más daña (dice que las
   preguntas malas son excelentes).
5. El resto, por orden de aparición.
