# Tarjetas de inicio y de cierre

Ejemplos reales, tomados del tutorial de MCP.

| Archivo | Qué es |
|---|---|
| `title.html` / `title.png` | Tarjeta de apertura, **5 s**: la N de Nodus centrada y debajo el título |
| `end.html` / `end.png` | Tarjeta de cierre, **8 s**: adaptación clara del cierre de marca |

Las genera `engine/cards.mjs` en cada montaje, dentro de
`.tutorial-out/<deck>/cards/`. El HTML se renderiza sobre un escenario de 1280×720
escalado desde una maqueta de 1920×1080 (si la ventana es más baja que la pantalla,
se recorta el escalado).

## Cómo cambiarlas

El HTML está incrustado en `engine/cards.mjs`. Para probar sin montar el vídeo
entero, abre en el navegador el `title.html` que quedó del último montaje, ajusta a
gusto y traslada el cambio al generador.

El **título** no se toca aquí: sale de `TITLE`, en el `shots.mjs` de cada mazo, para
que cada vídeo lleve el suyo sin duplicar la maqueta.

## Miniatura de YouTube

Es un fotograma de la tarjeta de inicio del vídeo ya montado:

```bash
ffmpeg -ss 2 -i .tutorial-out/<deck>/nodus-tutorial-<deck>-en-final.mp4 -frames:v 1 -q:v 2 -y miniatura.jpg
```
