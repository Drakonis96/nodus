# Tutoriales en vídeo de Nodus

Motor para grabar tutoriales narrados **desde la aplicación real**, con voz en off en
inglés, subtítulos en varios idiomas, tarjeta de inicio, tarjeta de cierre y música
de fondo. No usa captura manual ni *computer use*: conduce la app con Playwright y
captura los fotogramas por CDP.

Con esto se han hecho cuatro vídeos: introducción general (7:00), bóveda académica
(4:58), Nodi (1:59) y MCP + Nodus Server (3:00).

---

## Si eres el modelo que va a hacer el vídeo, empieza aquí

1. Lee este archivo entero y después [PITFALLS.md](PITFALLS.md). El segundo es la
   lista de fallos que ya han costado tomas enteras; casi todos reaparecen.
2. Pregunta al usuario **qué debe contar el vídeo** y en qué orden, antes de escribir
   una sola línea de guion.
3. **Pide las claves de API si no las tienes.** Hacen falta dos, y no están en el
   repositorio:
   - **OpenRouter** — para la voz en off (TTS) y, en los vídeos que analizan corpus,
     para los *embeddings*. Se lee de `~/.config/nodus/openrouter.key`, o de
     `~/.config/nodus/openrouter-app.key`, o de `OPENROUTER_API_KEY`.
   - **Google Gemini** — para el análisis de documentos en los vídeos que escanean.
     Se lee de `~/.config/nodus/gemini-app.key`.

   Si alguno no existe, **pregunta al usuario y espera**. No supongas que hay saldo,
   y no escribas ninguna clave en el repositorio ni en un comentario: es público.
4. **Nunca toques el Nodus instalado del usuario.** Toda grabación corre sobre un
   `NODUS_USERDATA` desechable. El motor ya lo hace; no lo cambies.
5. Ensaya con `--dry` antes de gastar en voz. Es gratis y caza casi todo.

---

## Requisitos

```bash
npm run build
```

- `ffmpeg` y `ffprobe` en el PATH (`brew install ffmpeg`).
- La app compilada: el grabador conduce `dist-electron/main.js`, no el código fuente.
- Un tema de fondo en `scripts/tutorial/music/` (ver [music/README.md](music/README.md)).

---

## Las seis fases

Cada una es un comando. `--deck=<nombre>` elige el vídeo; la salida va siempre a
`.tutorial-out/<nombre>/`, fuera del control de versiones.

| # | Fase | Comando | Qué hace |
|---|------|---------|----------|
| 1 | **Guion** | editas `decks/<deck>/shots.mjs` | Una frase por plano y lo que la app hace mientras |
| 2 | **Voz** | `node scripts/tutorial/engine/narrate.mjs --deck=<deck>` | Un clip por frase, medido con ffprobe |
| 3 | **Grabación** | `node scripts/tutorial/decks/<deck>/record.mjs` | Conduce la app y captura fotogramas |
| 4 | **Subtítulos** | `node scripts/tutorial/engine/subtitles.mjs --deck=<deck>` | `.srt` y `.vtt`, normales y para YouTube |
| 5 | **Montaje** | `node scripts/tutorial/engine/assemble.mjs --deck=<deck>` | Cámara, cortes y voz sobre los fotogramas |
| 6 | **Tarjetas** | `node scripts/tutorial/engine/cards.mjs --deck=<deck>` | Inicio, cierre, música y pistas de subtítulos |

Y para la descripción de YouTube:

```bash
node scripts/tutorial/engine/describe.mjs --deck=<deck>
```

### La regla que lo gobierna todo: **la narración manda el reloj**

Cada plano dura exactamente lo que dura su frase. De ahí se sigue:

- **La voz se sintetiza ANTES de grabar.** Sin `narration.json` el grabador no sabe
  cuánto aguantar cada plano y se niega a arrancar (salvo con `--dry`).
- **Se puede rehacer una frase sin volver a grabar.** El montaje recorta cada clip a
  la duración de su cue: cambias la línea, vuelves a narrar y a montar. Esto salvó
  una toma en la que la voz decía "Gemini 2.5" y la pantalla mostraba 3.1.
- **Si una acción tarda más que su frase, el plano se corta a media acción.** Ajusta
  la acción, no la frase.

---

## Hacer un vídeo nuevo, paso a paso

```bash
cp -r scripts/tutorial/decks/_template scripts/tutorial/decks/miVideo
```

1. **Escribe el guion** en `decks/miVideo/shots.mjs`. Una frase por plano, en inglés
   hablado. Deletrea las siglas como suenan: `'M C P'`, `'H T T P S'`, `'P D F'`.
2. **Escribe los ayudantes** en `decks/miVideo/record.mjs`. Cada uno debe
   **verificar** lo que hizo (ver PITFALLS).
3. **Ensaya gratis**: `node scripts/tutorial/decks/miVideo/record.mjs --dry`.
   Objetivo: **cero avisos**. Cada `⚠` acaba viéndose en el vídeo de una forma u otra.
4. **Sintetiza la voz**: `node scripts/tutorial/engine/narrate.mjs --deck=miVideo`.
5. **Graba de verdad** y vuelve a exigir cero avisos.
6. **Subtítulos, montaje y tarjetas** (fases 4-6).
7. **Revisa fotogramas del vídeo YA MONTADO**, no del guion ni de los logs:

   ```bash
   ffmpeg -ss 90 -i .tutorial-out/miVideo/nodus-tutorial-miVideo-en-final.mp4 -frames:v 1 -y /tmp/check.png
   ```

   Este paso ha destapado tres fallos que ningún log mostraba: ideas extraídas en
   español bajo interfaz inglesa, una barra de progreso cruzando todas las vistas de
   análisis, y una narración que hablaba de nodos mientras la pantalla mostraba temas.

---

## Convenciones de la serie

Se mantienen entre vídeos para que parezcan una colección y no cuatro cosas sueltas.

**Cámara.** Acercamiento (`focus`) **solo** para modales y para Nodi. Todo lo demás
lleva aro (`highlight`). El zoom continuo marea.

**Tarjeta de inicio.** Fondo claro, la N de Nodus centrada y debajo el título, 5
segundos. El título sale de `TITLE` en el `shots.mjs` del mazo.

**Tarjeta de cierre.** 8 segundos, adaptación clara del cierre de marca.

Ambas se generan en `engine/cards.mjs` desde HTML, que queda en
`.tutorial-out/<deck>/cards/` (`title.html`, `end.html`): se editan ahí y se ven al
instante en el navegador.

**Música.** Un solo tema en bucle, con fundidos y **compresión lateral** para que la
voz vaya siempre por delante (`MUSIC_GAIN = 0.16`). No debe pisar la narración nunca.

**Voz.** Siempre la misma, para que los vídeos suenen a una serie:

| | |
|---|---|
| Proveedor | **OpenRouter** (`/api/v1/audio/speech`) |
| Modelo | **`deepgram/aura-2`** |
| Voz | **`aura-2-thalia-en`** |
| Idioma | inglés |

Queda registrado en `.tutorial-out/<deck>/narration.json` (`provider`, `model`,
`voice`) en cada vídeo, y `describe.mjs` lo imprime. Se puede cambiar con
`--voice=<id>` o `--model=<id>`, y hay rutas alternativas (`--provider=hume`,
`--provider=openai`, `--local` para una voz de relleno sin coste).

Dos alternativas se probaron y se descartaron, por si vuelven a tentar:

- **`openai/gpt-audio-mini`** — es un modelo de chat, no de locución: **parafrasea el
  guion**. Como los subtítulos se generan del guion, la voz y el texto dejan de
  coincidir en todos los idiomas. El selector exige `output_modalities=speech`.
- **Hume Octave** — la voz se cortaba a mitad de frase (minuto 0:52 del primer vídeo).

**Subtítulos.** El inglés se lee del propio guion, así que voz y subtítulo no pueden
desincronizarse. Los demás idiomas van en `decks/<deck>/captions.mjs`. Se generan dos
juegos: uno normal y otro en `subtitles/youtube/` **desplazado +5 s** para compensar
la tarjeta de inicio, con nombres BCP-47 listos para subir.

**Miniatura.** Un fotograma de la tarjeta de inicio:

```bash
ffmpeg -ss 2 -i .tutorial-out/<deck>/nodus-tutorial-<deck>-en-final.mp4 -frames:v 1 -q:v 2 -y miniatura.jpg
```

---

## Privacidad — no negociable

El repositorio es **público** y los vídeos se publican en YouTube.

- **Claves de API y tokens: siempre difuminados.** El motor trae la clase
  `.nodus-blur`; el mazo `mcp` enseña cómo tapar **solo** los caracteres del token
  dejando legible el JSON que lo rodea.
- **Colecciones de Zotero ajenas al vídeo: difuminadas desde el primer fotograma.**
  Un temporizador que arranca al abrir el diálogo deja varios cientos de
  milisegundos legibles, y esos fotogramas acaban publicados. Usa un
  `MutationObserver`.
- **Nada de fotos ni documentos personales del usuario en el repositorio.**
- Verifica la privacidad **mirando fotogramas del vídeo montado**, no leyendo el
  código: una regla de difuminado que no encaja con el marcado no da ningún error.

---

## Coste

Grabar es gratis. Lo que se paga es la voz y, en los vídeos que analizan, el modelo.

- `--dry` no gasta nada: úsalo hasta que no queden avisos.
- La voz **cachea por texto**: cambiar una frase cuesta una llamada, no el mazo entero.
- **Reutiliza corpus ya escaneados** (`masterProfile`) en lugar de volver a analizar.
- Las respuestas de chat de un tutorial deben ir **guionizadas**, no generadas: un
  tutorial tiene que enseñar lo mismo cada vez, y además así no gasta.

---

## Estructura

```
scripts/tutorial/
  README.md              este archivo
  PITFALLS.md            los fallos que ya han costado tomas
  engine/
    recorder.mjs         conduce la app y captura (lo comparten los mazos)
    cursor.mjs           cursor sintético y aro de resalte
    narrate.mjs          voz en off, una frase por plano, con caché
    assemble.mjs         cámara, cortes y voz
    cards.mjs            tarjetas, música y pistas de subtítulos
    subtitles.mjs        .srt/.vtt, normales y para YouTube
    describe.mjs         capítulos y guion para la descripción
  decks/
    _template/           punto de partida para un vídeo nuevo
    intro/ academic/ nodi/ mcp/    los cuatro ya hechos, como ejemplos
  probes/                sondas: interrogar la app sin grabar ni gastar
  music/                 el tema de fondo
```

`intro` y `academic` son **anteriores** a la extracción del motor: sus `record.mjs`
llevan su propio andamiaje. Funcionan y se conservan como referencia, sobre todo
`academic`, que es el único que importa de Zotero y escanea de verdad. Los mazos
`nodi` y `mcp` ya usan el motor y son el patrón a copiar.

`.tutorial-out/` (fotogramas, audio, perfiles, vídeos) está ignorado por git: es
material de trabajo, pesa gigabytes y no pertenece al repositorio.

---

## Sondas

`probes/` sirve para responder preguntas sobre la app **sin grabar**: qué selectores
existen, cómo se llama un botón en inglés, si una vista devuelve resultados. Tardan
segundos y no gastan nada.

La regla que más tiempo ahorra: **cuando algo no funcione, vuelca el DOM real en vez
de deducir el marcado**. Tres intentos seguidos de cerrar un modal fallaron por
suponer cómo era su botón de cerrar; el cuarto, tras mirarlo, acertó a la primera.
