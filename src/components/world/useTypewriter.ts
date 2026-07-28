import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MIRRORED_STYLES, typewriterPadding, typewriterScrollTop } from '@shared/typewriter';

/**
 * Ligeramente por encima del centro. Centrado exacto deja media pantalla de texto ya escrito
 * ocupando el sitio de lo que viene; un poco más arriba se lee mejor hacia delante, que es
 * hacia donde se escribe.
 */
export const TYPEWRITER_BAND = 0.42;

/**
 * Mantener la línea del cursor a la altura de los ojos.
 *
 * Lo difícil no es desplazar: es **saber dónde está el cursor**. Un `<textarea>` da
 * `selectionStart` —un índice en la cadena— y nada más: no existe forma nativa de
 * preguntarle en qué píxel cae. Así que se pinta el mismo texto hasta el cursor en un `div`
 * invisible con EXACTAMENTE los mismos estilos que afectan al salto de línea, se le pega una
 * marca al final y se le pregunta a esa marca por su posición. Es la técnica de siempre para
 * esto, y su único punto débil es la lista de estilos: si el espejo difiere en uno solo, el
 * texto se parte por otro sitio y el error crece línea a línea.
 *
 * Un editor con `contenteditable` daría la posición exacta con `Range.getClientRects()`, pero
 * cambiarlo costaría el autocompletado de `[[` (que vive de `selectionStart`), la pila de
 * deshacer nativa y el comportamiento del IME. No merece la pena para colocar una línea.
 */
export function useTypewriter({
  areaRef,
  enabled,
  band = TYPEWRITER_BAND,
}: {
  areaRef: RefObject<HTMLTextAreaElement>;
  enabled: boolean;
  band?: number;
}): { sync: () => void; paddingBottom: number } {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [paddingBottom, setPaddingBottom] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, {
      position: 'absolute',
      top: '0',
      left: '-9999px',
      visibility: 'hidden',
      height: 'auto',
      overflow: 'hidden',
    });
    document.body.appendChild(mirror);
    mirrorRef.current = mirror;
    return () => {
      mirror.remove();
      mirrorRef.current = null;
    };
  }, [enabled]);

  const sync = useCallback(() => {
    const area = areaRef.current;
    const mirror = mirrorRef.current;
    if (!enabled || !area || !mirror) return;

    const computed = window.getComputedStyle(area);
    for (const property of MIRRORED_STYLES) {
      mirror.style[property as never] = computed[property as never];
    }
    // Never copied: the mirror must be as tall as its content, which is the whole
    // measurement. Copying the height would flatten every line onto the first screen.
    mirror.style.height = 'auto';

    mirror.textContent = area.value.slice(0, area.selectionEnd);
    const marker = document.createElement('span');
    // A zero-width space so the marker has a box on an empty line too — without it the last
    // line of a paragraph measures as the line above.
    marker.textContent = '​';
    mirror.appendChild(marker);

    const lineHeight = Number.parseFloat(computed.lineHeight);
    const caretHeight = Number.isFinite(lineHeight)
      ? lineHeight
      : Number.parseFloat(computed.fontSize) * 1.2;

    const padding = typewriterPadding(area.clientHeight, band);
    setPaddingBottom(padding);

    area.scrollTop = typewriterScrollTop({
      caretTop: marker.offsetTop,
      caretHeight,
      viewportHeight: area.clientHeight,
      band,
      currentScrollTop: area.scrollTop,
      // The padding is applied on the next render, so it is added here rather than read
      // from the DOM: measuring before it lands would clamp the last lines short.
      scrollHeight: Math.max(area.scrollHeight, mirror.scrollHeight + padding),
    });
  }, [areaRef, band, enabled]);

  // Turning the mode on has to place the line immediately: waiting for the next keystroke
  // makes it look broken. Same on resize, where the band moves with the window.
  useEffect(() => {
    if (!enabled) {
      setPaddingBottom(0);
      return;
    }
    const frame = requestAnimationFrame(sync);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', sync);
    };
  }, [enabled, sync]);

  return { sync, paddingBottom };
}
