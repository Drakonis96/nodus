# Música de fondo

Los cuatro tutoriales usan **un solo tema en bucle**, con fundido de entrada y de
salida y compresión lateral, de modo que la voz siempre va por delante.

## Dónde se busca

`engine/cards.mjs` lo resuelve en este orden:

1. `NODUS_TUTORIAL_MUSIC=/ruta/al/tema.mp3`
2. el primer archivo de audio que haya **en esta carpeta**
3. `~/Desktop/Quiet Dashboard Glow.mp3`, de donde lo tomaron los primeros vídeos

Si no encuentra ninguno, monta el vídeo **sin música** y lo dice por consola en vez
de fallar.

## Por qué el audio no está en el repositorio

Este repositorio es público y el tema usado hasta ahora es un archivo personal del
autor, sin licencia declarada para redistribución. Añadirlo aquí sería publicarlo.

Deja tu tema en esta carpeta (queda ignorado por git) o apunta a él con
`NODUS_TUTORIAL_MUSIC`. Si en algún momento se elige una pista con licencia libre,
este es su sitio y basta con quitarla del `.gitignore` de al lado.

## Cómo se mezcla

Los parámetros están en `engine/cards.mjs` y conviene no tocarlos a ojo:

- `MUSIC_GAIN = 0.16` — el lecho, muy por debajo de la voz.
- `sidechaincompress` — la música cede automáticamente cuando hay narración.
- `acrossfade` — el bucle se encadena consigo mismo, sin corte audible.
- Fundidos de entrada y salida en los extremos del vídeo.

El encargo original era claro: *"bajita y estable, sin cambios raros y sin solapar la
voz bajo ninguna circunstancia"*. Cualquier cambio debe seguir cumpliéndolo.

## Duración

No importa que el tema sea más corto que el vídeo: se repite en bucle y se recorta a
la duración exacta del montaje.
