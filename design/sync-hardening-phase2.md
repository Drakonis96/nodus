# Sincronización: borrados, cifrado y relojes

Propuesta de diseño · 2026-07-19 · continúa `backup-recovery-audit.md`

Los tres puntos que quedaron conscientemente fuera de la primera corrección. No son
independientes: **el mismo mecanismo que hace seguros los borrados hace seguro el sesgo
de reloj**, así que conviene decidirlos juntos.

---

## Principio rector

Hoy la fusión es *newest-wins destructivo*: la versión que pierde la comparación
desaparece sin dejar rastro. Eso es aceptable cuando los relojes coinciden y nadie borra
nada; deja de serlo en cuanto una de las dos cosas falla.

La propuesta se apoya en una sola idea:

> **Que la fusión deje de destruir.** Si toda versión perdedora se conserva y se puede
> recuperar, entonces un reloj mal puesto, un borrado a destiempo o una resolución
> equivocada dejan de ser pérdida de datos y pasan a ser una decisión revisable.

Con esa base, los tres problemas se vuelven tratables sin reescribir la app.

---

## 1 · Borrados (tombstones)

### El comportamiento actual

Notas, carpetas, búsquedas, borradores, veredictos y bases de datos se borran en duro.
Al importar cualquier paquete anterior al borrado, la rama `INSERT` los revive con sus
marcas originales — y lo repetirá en cada sincronización, en ambos sentidos.
**No hay forma de borrar nada de manera definitiva entre dos equipos.**

Las entidades de estudio son la excepción correcta: usan `deleted_at`, así que el borrado
es una actualización y se propaga sola.

### Diseño propuesto

**Una tabla de lápidas, alimentada por triggers.**

```sql
CREATE TABLE sync_tombstones (
  table_name TEXT NOT NULL,
  row_key    TEXT NOT NULL,          -- clave de identidad serializada
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key)
);
```

Los triggers se generan **desde el registro de grupos de sync**, no a mano, en cada
apertura de la base (`ensureTombstoneTriggers()`). Así una tabla nueva queda cubierta por
el mismo mecanismo que ya obliga a clasificarla, y no hay forma de olvidarse.

> Verificado sobre la librería que usa la app: un `DELETE` en cascada **sí** dispara los
> `AFTER DELETE` de las tablas hijas, con y sin `recursive_triggers`. Los triggers, por
> tanto, capturan también los borrados en cascada — no hace falta razonar sobre árboles.

**Reglas de fusión** (last-writer-wins, tratando el borrado como una escritura más):

| Situación | Resultado |
|---|---|
| Llega una fila desconocida y hay lápida con `deleted_at >= updated_at` | No se inserta. Se borró después de escribirse. |
| Llega una fila desconocida y hay lápida con `deleted_at < updated_at` | Se inserta y se retira la lápida: el otro equipo la editó *después* del borrado, y esa edición es la última palabra. |
| Llega una lápida más nueva que la fila local | Se borra la fila local y se guarda la lápida. **La fila borrada va a `sync_superseded`** (§4): un borrado remoto nunca destruye trabajo local sin retorno. |
| Llega una lápida más antigua que la fila local | Se descarta: la fila se editó después de que el otro la borrara. |

Las lápidas viajan en el paquete como una tabla más.

### El problema real: la recolección de lápidas

Una lápida no puede vivir para siempre, y si se recoge antes de que un equipo rezagado
sincronice, la fila resucita. Es una limitación inherente a la sincronización por
ficheros, no un descuido.

Propuesta: **horizonte de 180 días**, y —esto es lo importante— al importar un paquete
construido hace más de ese horizonte, **avisar explícitamente** de que los borrados
antiguos pueden reaparecer. El límite deja de ser una trampa silenciosa y pasa a ser
información.

---

## 2 · Cifrado del `.nodussync`

### El comportamiento actual

Zip en claro. Contiene cuerpos de notas, documentos de estudio, calificaciones, evidencia
genealógica y adjuntos. Convive en Ajustes con la copia cifrada por contraseña maestra,
sin advertir de la asimetría.

### Diseño propuesto

**Cifrar siempre. Sin casilla de «sin cifrar».** Una opción de conveniencia en claro es
exactamente el camino por el que se filtran estos ficheros.

Reutilizando las primitivas ya auditadas de `backupCrypto.ts` (scrypt N=32768 +
AES-256-GCM), con un cambio necesario: **derivar la clave una sola vez**, no por entrada.
scrypt cuesta ~100 ms; aplicado a 500 entradas serían casi un minuto. Se añaden
`deriveBackupKey()` y `encryptWithKey()/decryptWithKey()` al módulo existente.

**Estructura (formato v3)** — preserva la propiedad que arregló el límite de tamaño:

```
manifest.json     ← en claro: formato, versión, fecha, schemaVersion, parámetros KDF
index.bin         ← cifrado: qué entrada corresponde a cada tabla y a cada blob
<id opaco>        ← cifrado: IV(12) ‖ authTag(16) ‖ ciphertext, uno por tabla y por blob
```

Cada entrada se cifra por separado con su propio IV. **No hay ningún punto en el que el
paquete entero exista como un solo búfer**, que es justo lo que hacía imposible
sincronizar bóvedas grandes. Los nombres de tabla viven en `index.bin` cifrado, así que
el fichero no revela que contiene, por ejemplo, calificaciones.

`schemaVersion` queda fuera a propósito: permite rechazar un paquete de una versión más
reciente **sin pedir la contraseña**, que es mejor experiencia y no revela nada.

### La credencial: aquí está la decisión de diseño

La exportación manual `.nodus` genera una clave aleatoria de un solo uso. **Para sync eso
sería un error**: es una operación *recurrente*, y copiar una clave nueva en cada
exportación se abandona a la tercera vez.

Tampoco sirve reutilizar la contraseña maestra de copias: tras una restauración con clave
de recuperación, Nodus **genera una contraseña maestra nueva y aleatoria**, así que los
dos equipos tendrían credenciales distintas y el sync fallaría sin motivo aparente.

Propuesta: **una «frase de sincronización» propia**, que el usuario fija una vez y
escribe en ambos equipos. Se guarda con `safeStorage` como las demás. La exportación se
niega si no está configurada; la importación la usa automáticamente y solo pregunta si no
descifra. Explícita, estable, sin acoplarse al ciclo de vida de las copias.

Compatibilidad: se siguen **leyendo** paquetes v1 y v2 en claro; solo se **escribe** v3.

---

## 3 · Sesgo de reloj

### El comportamiento actual

El ganador se decide comparando `updated_at` como cadenas. Un equipo con el reloj
atrasado pierde **todas** las comparaciones, siempre, en silencio, y el resumen lo
presenta como `skipped`, indistinguible de «ya estaba al día».

### Lo que se puede y lo que no se puede detectar

Conviene ser honesto: con paquetes de fichero en un solo sentido **no se puede medir el
desfase de relojes**. Un paquete con fecha de hace tres días puede ser un paquete
genuinamente antiguo o un reloj atrasado tres días; no hay forma de distinguirlos sin un
viaje de ida y vuelta.

Sí es detectable **una** dirección, que además es la peligrosa:

- Fecha del paquete o marcas de fila **en el futuro** respecto al reloj local ⇒ el reloj
  del emisor va adelantado. Ese equipo ganaría todas las comparaciones.

La dirección contraria (emisor atrasado) es indistinguible de un paquete viejo.

### Diseño propuesto: tres capas

**Capa 1 — detectar lo detectable.** Si el paquete o sus filas vienen del futuro, avisar;
si el desfase supera las 24 h, exigir confirmación explícita antes de fusionar.

**Capa 2 — comparar sobre una línea temporal común.** Cuando se detecta un adelanto
consistente, compensar las marcas entrantes por el desfase medido **solo a efectos de
comparación**, sin reescribir nada, y registrar que se hizo.

**Capa 3 — y esta es la que de verdad resuelve el problema — no destruir nunca al
perdedor** (§4). Aunque un reloj mal puesto resuelva mal un conflicto, la versión que
pierde se conserva y se puede recuperar. El sesgo de reloj deja de ser pérdida de datos y
pasa a ser una resolución subóptima, revisable.

### La alternativa de libro, y por qué no la recomiendo ahora

Lo correcto en teoría son relojes lógicos por fila (Lamport/HLC): cada escritura
incrementa un contador y la comparación deja de depender del reloj de pared.

El coste real en este código: **una columna nueva en ~60 tablas** y tocar **todas** las
rutas de escritura de ~70 repositorios, porque hoy cada una hace `updated_at = now()` por
su cuenta. Es un cambio grande, transversal y con mucha superficie de regresión, para
resolver un problema que la capa 3 vuelve inofensivo.

Mi recomendación es hacer las tres capas ahora y dejar los relojes lógicos como evolución
posterior: **`sync_superseded` es precisamente la base sobre la que se construirían**.

---

## 4 · La pieza común: `sync_superseded`

```sql
CREATE TABLE sync_superseded (
  id            TEXT PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_key       TEXT NOT NULL,
  origin        TEXT NOT NULL,   -- 'incoming-lost' | 'local-overwritten' | 'deleted-remotely'
  row_json      TEXT NOT NULL,   -- la fila, sin columnas BLOB
  row_stamp     TEXT,
  winner_stamp  TEXT,
  package_date  TEXT,
  created_at    TEXT NOT NULL
);
```

Se escribe en **tres** situaciones, y la segunda es la más importante:

1. La fila entrante pierde y su contenido difiere de la local (`incoming-lost`).
2. La fila entrante gana y **sobrescribe** trabajo local distinto (`local-overwritten`)
   ← el caso que hoy destruye trabajo del usuario sin dejar rastro.
3. Una lápida remota borra una fila local (`deleted-remotely`).

**Limitación honesta:** no se guardan las columnas BLOB (adjuntos, grabaciones, retratos).
Duplicarlas multiplicaría el tamaño de la base. Para esas columnas se conserva la fila y
un marcador, no los bytes. Recolección a los 90 días.

**Superficie de usuario:** en Ajustes → Sincronización, «N versiones sustituidas»,
con vista de detalle y acción de restaurar. Sin esa vista, la tabla es solo consuelo.

---

## Fases propuestas

| Fase | Contenido | Riesgo |
|---|---|---|
| **F1** ✅ | `sync_superseded` + registro en las tres situaciones + vista en Ajustes | Bajo. No cambia ninguna resolución, solo deja de destruir. |
| **F2** ✅ | Tombstones: tabla, triggers generados, reglas de fusión, horizonte y aviso | Medio. Cambia el comportamiento observable del borrado. |
| **F3** ✅ | Cifrado v3 + frase de sincronización + lectura de v1/v2 | Medio. Formato nuevo; conviene ir después de F1/F2 para no mezclar. |
| **F4** ✅ | Capas 1 y 2 del reloj (detección, confirmación, compensación) | Bajo. |

**F1 primero, deliberadamente.** Es la que convierte cualquier error de las otras dos en
recuperable, así que conviene tenerla antes de tocar borrados o resolución temporal. Cada
fase es verificable por separado con el arnés de esquema real que ya existe.

---

## F1 · Implementada (esquema v88)

`scripts/test-superseded-versions.mjs`. 532/532 tests, build y smoke e2e sobre la app
real (v88). Lo entregado:

- Migración **88**, puramente aditiva: crea `sync_superseded` y no toca ninguna tabla
  existente. Se construye una base **real en v87**, se puebla (notas, genealogía con
  blob, calificaciones, bases de datos) y se comprueba que tras migrar **cada tabla
  conserva su recuento exacto**, la integridad y las claves foráneas están limpias, los
  bytes de la evidencia son idénticos, y volver a migrar no cambia nada.
- Registro en las dos direcciones del conflicto, incluida la que antes destruía trabajo
  sin dejar rastro: **la versión local sobrescrita por la del otro equipo**.
- Restauración **reversible**: al promover una versión, la que desplaza se guarda a su
  vez, así que restaurar por error también se deshace. Una fila borrada puede
  recrearse desde su versión guardada.
- `sync_superseded` es explícitamente **local**: no viaja en el paquete, porque el
  registro de lo que *este* equipo descartó no tiene sentido en el otro.
- Compatibilidad verificada en ambos sentidos: un `.nodussync` construido con esquema 87
  sigue importándose, una copia de un esquema **más reciente** se rechaza sin tocar los
  datos, y una de un esquema anterior se restaura con normalidad.

### Defecto encontrado durante la implementación

La primera versión guardaba **la misma versión perdedora en cada sincronización**: una
fila que pierde una vez pierde en todas las importaciones futuras del mismo paquete, así
que la lista habría crecido con un duplicado por sync hasta enterrar los conflictos
reales. `recordSuperseded` deduplica y devuelve si llegó a almacenar; el contador del
resumen solo cuenta lo realmente guardado.

### Limitaciones asumidas

- **No se guardan las columnas BLOB.** Duplicar adjuntos, grabaciones y retratos
  multiplicaría el tamaño de la base. Se conserva la fila y un marcador con el tamaño; al
  restaurar se mantienen los adjuntos actuales y se avisa de ello.
- **No hay recolección automática.** Esta tabla *es* la red de seguridad, así que nada la
  borra por tiempo: solo el usuario, de forma explícita. El crecimiento está acotado por
  los conflictos reales, que son raros, y la deduplicación evita la repetición.

---

## F2 · Implementada (esquema v89)

`scripts/test-tombstones.mjs` (10 supuestos) + `scripts/test-source-hygiene.mjs`.
534/534 tests, build y smoke e2e sobre la app real (v89).

Un borrado deja de resucitar: se registra en `sync_tombstones` mediante triggers
generados desde el mismo registro que decide qué se sincroniza, viaja en el paquete, se
aplica antes de fusionar filas, y lo que elimina queda recuperable en `sync_superseded`.

### La mitad peligrosa: lo que NO debe parecer un borrado

Propagar borrados es fácil; lo difícil es no propagar los que no lo son. Cada uno de
estos habría eliminado datos del usuario **en el otro equipo**:

- **Guardar borrando y reescribiendo.** El horario borra todos los periodos de un curso y
  los reinserta con los mismos ids. Sin el trigger `AFTER INSERT` que retira la lápida,
  un guardado normal habría dicho al otro equipo que borrara el horario. Verificado, y
  verificado también que una fila que *sí* desaparece en ese reescrito sí se marca.
- **La limpieza interna de la fusión.** Al soltar filas recién insertadas cuyas claves
  foráneas quedan colgando, el trigger no distingue eso de un borrado del usuario: la
  lápida se retira explícitamente.
- **Restaurar una versión guardada.** Escribe una fila que una lápida da por muerta. Sin
  una marca de tiempo nueva, la siguiente sincronización la habría vuelto a borrar y el
  usuario habría visto cómo su recuperación se deshacía sola. Ahora restaurar es el hecho
  más reciente sobre la fila.

Y en sentido contrario: un borrado no es sagrado. Si el otro equipo editó la fila
**después** del borrado, esa edición es el hecho más reciente y la fila vuelve.

### Defecto encontrado durante la implementación

La clave de búsqueda de lápidas se construía en dos sitios, y en uno el separador acabó
siendo un **byte NUL** en vez de un espacio. Resultado: la búsqueda no coincidía nunca,
la supresión de resurrecciones no hacía nada, y **TypeScript compilaba sin quejarse**;
`grep` además dejaba de encontrar el fichero porque pasaba a considerarlo binario.

Dos correcciones: la clave se construye ahora en **una sola función** (`tombstoneKey`), y
`scripts/test-source-hygiene.mjs` rechaza caracteres de control y UTF-8 inválido en todo
el código. Ese guard destapó tres ficheros ya en `main` que usan NUL como separador de
claves compuestas de forma **deliberada y correcta** (`ideaDedupe`, `graph/lod`, `stats`):
están en una lista explícita, no tocados, para que un NUL *nuevo* siga fallando.

### Interacción conocida (documentada, no un fallo)

Restaurar una copia anterior a un borrado devuelve la fila **y** retrocede el estado local
de lápidas. Si el otro equipo sigue teniendo la suya, la siguiente sincronización volverá
a aplicar el borrado, porque es el hecho más reciente. No se pierde nada: queda en
«Versiones sustituidas» como *borrado en el otro equipo*.

### Limitaciones asumidas

- **Horizonte de 180 días.** Pasado ese plazo la lápida se olvida y la fila podría volver
  desde un equipo muy rezagado. Al importar un paquete más antiguo que el horizonte se
  avisa explícitamente en el resumen.
- **Una lápida por fila borrada.** Medido: 20.000 borrados en cascada con el trigger
  cuestan 20 ms, así que el coste no es un problema; el tamaño lo acota el horizonte.


---

## F3 y F4 · Implementadas

`scripts/test-sync-package.mjs` (ampliado). 534/534 tests, build y smoke e2e (v89).
**Sin cambio de esquema**: la frase vive en `safeStorage`, no en la base, así que estas
dos fases no tocan los datos de nadie.

### F3 · Cifrado (formato v3)

Cada tabla y cada adjunto se sella por separado bajo una clave derivada **una sola vez**
(scrypt N=32768 + AES-256-GCM, IV propio por entrada). Así el cifrado **no reintroduce**
el búfer único que hacía imposible sincronizar bóvedas grandes. Los nombres de tabla
viven en un índice cifrado y las entradas tienen nombres opacos: el fichero no anuncia
que contiene un cuaderno de calificaciones.

El manifiesto sigue en claro a propósito — permite rechazar un paquete incompatible o
avisar de su antigüedad **sin pedir la frase**.

**Compatibilidad verificada**: se siguen importando paquetes **v1** (JSON único con
blobs en base64) y **v2** (una entrada por tabla, en claro), incluidos sus adjuntos. Solo
se escribe v3.

**La credencial**: una «frase de sincronización» propia, no la contraseña maestra —
restaurar con la clave de recuperación genera una contraseña maestra nueva y aleatoria,
así que los dos equipos habrían acabado con credenciales distintas y el sync habría
fallado sin motivo aparente. Queda incluida en el kit de recuperación. Al importar un
paquete ajeno, la interfaz pide la frase del equipo que lo generó en vez de dejar al
usuario atascado.

### F4 · Sesgo de reloj

Se mide y se reporta lo único que un paquete de un solo sentido permite medir: que el
reloj del emisor va **adelantado**. Un paquete con fecha antigua es indistinguible de un
reloj atrasado, así que no se adivina — y el test comprueba explícitamente que un paquete
viejo **no** se confunde con desfase.

Lo que de verdad resuelve el problema no es la detección, sino la F1: gane quien gane la
comparación, la versión perdedora se conserva. Un reloj mal puesto cuesta una revisión,
no el trabajo.

### Aserciones que eran débiles

Las comprobaciones de privacidad buscaban el texto plano en el fichero completo. Un zip
**comprime** sus entradas, así que pasaban igual sin cifrar nada. Ahora se hacen sobre
los bytes **descomprimidos** de cada entrada, y se verificó que con `seal` desactivado el
test falla.
