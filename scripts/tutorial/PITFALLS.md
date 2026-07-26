# Fallos que ya han costado tomas

Todo lo de aquí ocurrió de verdad haciendo los cuatro primeros tutoriales. Están
ordenados por lo caro que salió cada uno. Léelo antes de grabar.

---

## 1. Lo que tapa la app y se traga los clics

Un modal abierto convierte cada clic siguiente en un no-op **silencioso**: la
grabación termina, informa de éxito, y son veinte planos de un fondo gris.

| Qué lo abría | Cómo se calla |
|---|---|
| Modal de Novedades | `localStorage['nodus.lastSeenVersion']` = la versión real. Se abre cuando difiere; poner `'9999.0.0'` lo abre siempre, no lo cierra |
| Modal de actualización al arrancar | `sessionStorage['nodus.startupUpdateChecked'] = '1'`. `NODUS_E2E_UPDATE_STATUS` **no** basta |
| Asistente de recuperación | `recoverySetupVersion: 9999`. Lo destapa `basicsTutorialVersion: 9999` |
| Elección de Nodi | `mascotStyleChosen: true` |
| Aviso de copias de seguridad | clic en `.backup-health-dismiss` |

El motor ya hace todo esto (`BASE_SETTINGS`) y además **se niega a filmar** si algo
grande cubre la app al arrancar.

## 2. Cerrar un modal: no adivines su botón

Tres intentos seguidos fallaron y los tres informaron de éxito:

- Clic en (24, 24) para "dar al fondo" → cae en los **botones de ventana de macOS**.
- `button:has-text("✕")` → engancha el chip de monitorización, no el modal.
- Comprobar el cierre en un punto tapado por el propio fondo → `closest('[role=dialog]')`
  del fondo es `null`, así que "no hay diálogo".

Lo que funciona, y está en `closeAnyDialog`: buscar la capa fija a pantalla completa
con `z-index ≥ 40` y, dentro, **un botón pequeño cerca de su borde superior**. Se
busca por **forma**, no por texto: el ✕ suele ser un SVG con `textContent` vacío.

## 3. La IA "no funciona" y la app miente sobre por qué

Síntoma: el escaneo se pausa con *"This message could not be translated"*.
Causa real: `Falta la clave de IA para gemini`.

Nodus cifra las claves con `safeStorage`, pero descifrarlas pide permiso al Llavero
y **nadie lo concede** en una sesión automatizada. La UI dice "clave guardada" y el
motor no puede leerla. La salida: escribir el archivo en formato legible.

```js
await writeFile(path.join(userData, 'secrets', `ai_key_${provider}.bin`),
  `b64:${Buffer.from(key, 'utf8').toString('base64')}`, 'utf8');
```

El motor refleja el `stderr` del proceso principal para que el motivo real se vea.

## 4. El aislamiento del perfil es una ilusión si no copias el vault

`vaults.json` guarda la **ruta absoluta** de la base de datos del vault. Copiar el
perfil copia el puntero, no el vault: todas las tomas leen y escriben el mismo
archivo, y el estado se filtra de una a otra. Así apareció un vault ya emparejado con
Nodus Server, sin formulario de conexión, en una toma que debía empezar limpia.

El motor copia el vault y reescribe el registro. Si añades otro almacén, comprueba si
también guarda rutas absolutas.

## 5. Esperar a que termine un trabajo: un instante de calma no es el final

El escaneo encadena fases (ligera, profunda, resumen, embeddings, pasajes, puentes) y
cada una encola la siguiente. Un `done >= total` momentáneo entre dos fases **es
idéntico a haber terminado**. Filmar ahí da un grafo vacío.

Exige calma **sostenida**: 20 sondeos de 3 s (un minuto). 21 segundos no bastaron.

Y el reverso: una cola que sigue vacía a los 45 s es un trabajo terminado, no uno
pendiente. Sin esa salida, un temporizador posterior se queda 45 minutos filmando una
app quieta.

## 6. Elementos que existen aunque no se vean

Los botones del menú radial de Nodi (`.nodi-node`) están en el DOM **abierto o
cerrado**: cerrados se apilan bajo el orbe. Contarlos para saber si el menú está
abierto siempre da "abierto", nunca se abre, y cada clic cae sobre el orbe.

Mira el estado (`.nodi-node.open`), no la existencia. Y prefiere identificadores
estables (`[data-nodi-action="chat"]`) a posiciones.

## 7. `data-testid` no siempre envuelve lo que parece

`[data-testid="mcp-settings-card"]` envuelve solo la cajita de ChatGPT; la casilla y
los botones de MCP son **hermanos** suyos. Buscar dentro del testid da cero casillas y
un solo botón. Lo correcto: `section.card:has([data-testid="mcp-settings-card"])`.

## 8. Guardas que no comprueban nada

- Medir el **texto de la página** para saber si una búsqueda funcionó: la página
  siempre es larga, así que pasa aunque no se haya escrito nada. Comprueba
  `inputValue()`.
- Registrar `current.state` cuando `current` solo trae `{title, kind}`: un escaneo en
  marcha se lee como parado.
- Un ayudante que no verifica su efecto deja que la toma "triunfe" con el fallo
  dentro. Cada ayudante debe afirmar lo que hizo y avisar si no lo hizo.

## 9. El idioma de la IA es un ajuste aparte

`uiLanguage` **no** arrastra a `promptLanguage`, que viene en español por defecto. Con
interfaz en inglés, todas las ideas extraídas salieron en español. Solo se ve mirando
fotogramas. `BASE_SETTINGS` ya fija los dos.

## 10. La cámara apunta fuera de pantalla

`boundingBox()` devuelve coordenadas de elementos que están bajo el pliegue, y el
zoom se va a un hueco vacío. Hay que hacer `scrollIntoViewIfNeeded` y comprobar
visibilidad antes de medir.

## 11. ffmpeg: `crop` no anima

`crop` evalúa `w`/`h` una sola vez: no hay movimiento de cámara. Lo que sí anima es
`zoompan`.

## 12. Difuminar de más es tan malo como difuminar de menos

Tapar el elemento entero dejó ilegible todo el bloque de configuración de Claude
Desktop, porque el token vive dentro. Envuelve **solo** los caracteres del secreto en
un `<span>` propio (ver `TOKEN_BLUR` en el mazo `mcp`).

Y al revés: una regla de difuminado que no encaja con el marcado **no da error**. En
una toma quedaron legibles todas las colecciones de Zotero del usuario porque la
regla buscaba dentro de un `[role="dialog"]` que ese modal no tiene. Compruébalo
mirando fotogramas.

## 13. `window.nodus` no admite reasignación

Viene del *contextBridge*. Sobrescribir `window.nodus.nodiChatStream` desde la página
falla **en silencio** y responde el modelo de verdad — con su coste. Para guionizar
una respuesta hay que sustituir el manejador IPC en el **proceso principal**:

```js
await app.evaluate(({ ipcMain }, text) => {
  ipcMain.removeHandler('nodi:chatStream');
  ipcMain.handle('nodi:chatStream', async (event, requestId) => { /* … */ });
}, answer);
```

## 14. La voz y la pantalla se descuadran sin avisar

Casos reales: la voz decía "cada nodo es una idea" mientras se veían 7 temas; y decía
"Gemini 2.5" con 3.1 en pantalla. Ningún log lo detecta.

Como la narración manda el reloj, **una línea se puede rehacer sin volver a grabar**:
cambia el texto, vuelve a narrar (solo esa frase, por la caché) y vuelve a montar.

## 15. Cosas de la tubería que muerden

- **El montaje no reconstruye la app.** Si tocas código de Nodus, `npm run build`
  antes de grabar.
- **Cada mazo escribe en su carpeta.** Antes no era así y las tarjetas de un vídeo
  sobrescribieron el vídeo final de otro.
- **La caché de voz es por texto.** Sin ella, cambiar una palabra revocaba el mazo
  entero.
- **Un aviso en la grabación casi siempre se ve en el vídeo.** No montes con avisos
  pendientes sin mirar antes ese momento del metraje.
