// Lo que hay que comprobarle a la IA en un vault de testimonios, en funciones puras.
//
// El principio es uno y vale para las dos operaciones que la usan: EL MODELO PROPONE Y
// NODUS COMPRUEBA. Un análisis que inventa una cita y una corrección que cambia una
// palabra son el mismo error —poner en boca de alguien algo que no dijo— y los dos se
// detectan comparando con el texto original antes de guardar nada.

/** Normalizar para comparar: minúsculas, sin acentos, sin puntuación y sin espacios de más. */
export function comparable(text: string): string {
  return text
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Las palabras de un texto, ya normalizadas. */
export function words(text: string): string[] {
  const clean = comparable(text);
  return clean ? clean.split(' ') : [];
}

export interface QuoteMatch {
  /** El segmento donde aparece la cita, o `null` si no aparece en ninguno. */
  segmentId: string | null;
  tStart: number | null;
  /** Proporción de la cita que se encontró, entre 0 y 1. */
  coverage: number;
}

/**
 * ¿De dónde sale esta cita?
 *
 * Se busca el texto normalizado dentro de cada segmento. No basta con que «se parezca»:
 * una cita que el modelo ha recompuesto juntando dos frases distintas del narrador NO es
 * una cita, y este vault no la puede fijar como fragmento con su minuto.
 *
 * Cuando la cita cruza el corte entre dos segmentos —cosa que pasa, porque el corte lo
 * puso el transcriptor y no el narrador— se acepta si aparece entera en la unión de dos
 * segmentos consecutivos, y se ancla al primero.
 */
export function locateQuote(
  quote: string,
  segments: { id: string; tStart: number; text: string }[],
): QuoteMatch {
  const needle = comparable(quote);
  if (!needle) return { segmentId: null, tStart: null, coverage: 0 };

  for (const segment of segments) {
    if (comparable(segment.text).includes(needle)) {
      return { segmentId: segment.id, tStart: segment.tStart, coverage: 1 };
    }
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const pair = `${comparable(segments[index].text)} ${comparable(segments[index + 1].text)}`;
    if (pair.includes(needle)) {
      return { segmentId: segments[index].id, tStart: segments[index].tStart, coverage: 1 };
    }
  }

  // No aparece. Se informa de CUÁNTO se parece al mejor segmento para poder decir en la
  // pantalla si el modelo se acercó o se lo inventó entero.
  const needleWords = new Set(words(quote));
  let best = 0;
  for (const segment of segments) {
    const segmentWords = new Set(words(segment.text));
    let shared = 0;
    for (const word of needleWords) if (segmentWords.has(word)) shared += 1;
    best = Math.max(best, needleWords.size ? shared / needleWords.size : 0);
  }
  return { segmentId: null, tStart: null, coverage: Number(best.toFixed(2)) };
}

export interface RewriteVerdict {
  accepted: boolean;
  /** Qué palabras desaparecieron y cuáles aparecieron, ya normalizadas. */
  removed: string[];
  added: string[];
}

/**
 * ¿La versión corregida dice lo mismo?
 *
 * Corregir una transcripción es puntuar, poner mayúsculas y arreglar lo que el
 * reconocedor oyó mal. NO es reescribir. Así que se comparan las palabras de las dos
 * versiones: si el modelo quitó o añadió alguna que no sea de puntuación, el segmento se
 * RECHAZA y se queda el original.
 *
 * Se permite un margen mínimo —un 6 % de las letras— porque un reconocedor pega palabras
 * («sesabía») o se come una tilde, y arreglarlo mueve el texto un poco. Más que eso ya no
 * es corregir.
 */
export function verifyRewrite(original: string, rewritten: string): RewriteVerdict {
  const before = words(original);
  const after = words(rewritten);
  const count = (list: string[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const word of list) map.set(word, (map.get(word) ?? 0) + 1);
    return map;
  };
  const beforeCount = count(before);
  const afterCount = count(after);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [word, times] of beforeCount) {
    const missing = times - (afterCount.get(word) ?? 0);
    for (let index = 0; index < missing; index += 1) removed.push(word);
  }
  for (const [word, times] of afterCount) {
    const extra = times - (beforeCount.get(word) ?? 0);
    for (let index = 0; index < extra; index += 1) added.push(word);
  }
  // La cuenta de palabras NO basta para decidir, y este es el caso que lo demuestra:
  // añadir «llorando» a una frase de siete palabras es UNA diferencia, igual que corregir
  // una tilde, y sin embargo una cosa es corregir y la otra es poner en boca de alguien un
  // adverbio que no dijo. Así que la decisión se toma sobre las LETRAS: puntuar, acentuar
  // y separar palabras mal pegadas apenas mueve el texto, y meter una palabra nueva lo
  // mueve tanto como letras tenga.
  const letters = (list: string[]): string => list.join('');
  const distance = editDistance(letters(before), letters(after));
  const budget = Math.max(2, Math.ceil(letters(before).length * 0.06));
  return { accepted: after.length > 0 && distance <= budget, removed, added };
}

/** Levenshtein con dos filas: sobra para comparar un tramo de transcripción. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length)) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}
