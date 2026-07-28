/**
 * Máquina de escribir: mantener la línea que se escribe a la altura de los ojos.
 *
 * El texto sube y el cursor se queda quieto, en vez de que el cursor baje hasta el borde
 * inferior de la ventana. No es cosmética: es la diferencia entre un editor donde se escribe
 * una hora seguida y uno donde se corrigen párrafos sueltos mirando al filo de la pantalla.
 *
 * Aquí está sólo la aritmética, que es la parte que puede mentir en silencio; medir dónde
 * cae el cursor en píxeles es cosa del DOM y vive en el componente.
 */

export interface TypewriterInput {
  /** Píxeles desde el principio del contenido hasta la línea del cursor. */
  caretTop: number;
  /** Alto de esa línea. */
  caretHeight: number;
  /** Alto visible del área de escritura. */
  viewportHeight: number;
  /** Dónde debe quedarse la línea, de 0 (arriba) a 1 (abajo). 0,5 es centrada. */
  band: number;
  /** Lo que hay ahora, para poder no hacer nada. */
  currentScrollTop: number;
  /**
   * Alto total del contenido, RELLENO INFERIOR INCLUIDO.
   *
   * Es la razón de que el componente añada ese relleno al encender el modo: sin él, las
   * últimas líneas no pueden llegar a la banda —no hay nada debajo que empujar— y el efecto
   * se muere justo donde siempre está el autor, que es al final de lo que lleva escrito.
   */
  scrollHeight: number;
}

/**
 * Cuánto hay que desplazar para que la línea del cursor caiga en la banda.
 *
 * La zona muerta no es un detalle de rendimiento: sin ella, cada pulsación corrige uno o dos
 * píxeles y el texto TIEMBLA bajo las manos mientras se escribe, que es exactamente lo
 * contrario de lo que este modo persigue.
 */
export function typewriterScrollTop(input: TypewriterInput, tolerance = 4): number {
  const desired = input.caretTop + input.caretHeight / 2 - input.viewportHeight * input.band;
  const max = Math.max(0, input.scrollHeight - input.viewportHeight);
  const clamped = Math.min(Math.max(desired, 0), max);
  return Math.abs(clamped - input.currentScrollTop) <= tolerance ? input.currentScrollTop : Math.round(clamped);
}

/** El relleno inferior que hace falta para que la última línea pueda llegar a la banda. */
export function typewriterPadding(viewportHeight: number, band: number): number {
  return Math.max(0, Math.round(viewportHeight * (1 - band)));
}

/**
 * Las propiedades que el espejo tiene que copiar del área de texto.
 *
 * Un `<textarea>` no sabe decir en qué píxel está su cursor, así que la única forma de
 * averiguarlo es pintar el mismo texto en un `<div>` invisible y preguntarle a él. Si el
 * espejo difiere en CUALQUIERA de estas, el texto se parte por otro sitio y el error crece
 * línea a línea: a mitad de un capítulo la medición apunta a un párrafo distinto.
 */
export const MIRRORED_STYLES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'wordSpacing',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
  'tabSize',
] as const;
