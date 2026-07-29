/**
 * Utilidades de audio compartidas por Estudio y Testimonios.
 *
 * Se extraen de `StudyRecordingsView` porque los dos verticales graban, reproducen y
 * transcriben audio local con el mismo motor. Lo que NO se comparte es el modelo: una
 * clase es un archivo con una transcripción, y una entrevista es varias sesiones con
 * varios archivos y varias versiones. Compartir componentes y no tablas es exactamente
 * la línea que evita que el vocabulario docente se filtre en un archivo de historia oral.
 */

/** `hh:mm:ss` cuando pasa de una hora, `mm:ss` cuando no. Para etiquetas y marcadores. */
export function formatMediaTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** El mejor contenedor que este Chromium sabe grabar, o '' si no hay preferencia. */
export function bestRecorderMime(): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

/**
 * La duración real de un blob grabado.
 *
 * MediaRecorder no la escribe en la cabecera de un WebM en directo, así que la única
 * forma fiable de conocerla es dejar que el propio decodificador la mida. Un fallo
 * devuelve 0 en vez de rechazar: una duración desconocida no puede impedir que se guarde
 * la grabación.
 */
export async function blobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const audio = new Audio();
      const done = (value: number) => resolve(Number.isFinite(value) ? value : 0);
      audio.onloadedmetadata = () => done(audio.duration);
      audio.onerror = () => done(0);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** La extensión que corresponde al contenedor que MediaRecorder acabó usando. */
export function recorderExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

/** El acento de cada vertical. Se pasa como dato para que la extracción no cambie ni un
 *  píxel de Estudio al reutilizar sus componentes en otro vault. */
export interface MediaAccent {
  /** Relleno de la barra de nivel y de la de progreso. */
  bar: string;
  /** Texto acentuado (tiempos, enlaces de salto). */
  text: string;
  /** Borde + fondo del panel de captura o de progreso. */
  panel: string;
  /** Color del control de volumen. */
  range: string;
}

export const STUDY_MEDIA_ACCENT: MediaAccent = {
  bar: 'bg-teal-500 dark:bg-teal-400',
  text: 'text-teal-700 dark:text-teal-300',
  panel: 'border-teal-200 bg-teal-50 dark:border-teal-800/60 dark:bg-teal-950/20',
  range: 'accent-teal-500',
};

/** Testimonios usa las utilidades índigo, que `.testimonios` remapea a cian. */
export const TESTIMONY_MEDIA_ACCENT: MediaAccent = {
  bar: 'bg-indigo-500 dark:bg-indigo-400',
  text: 'text-indigo-700 dark:text-indigo-300',
  panel: 'border-indigo-200 bg-indigo-50 dark:border-indigo-800/60 dark:bg-indigo-950/20',
  range: 'accent-indigo-500',
};
