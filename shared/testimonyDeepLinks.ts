/**
 * Enlaces profundos del vault de Testimonios.
 *
 *   nodus://testimonios/interview/{id}?session=…&transcript=…&t=…&annotation=…
 *   nodus://testimonios/participant/{personId}
 *   nodus://testimonios/contrast/{contrastId}
 *
 * Existen por una razón concreta: una nota interpretativa que dice «aquí se contradice
 * con lo que contó en 1998» no vale nada si volver al minuto exacto cuesta cinco
 * clics. El enlace es el que devuelve la interpretación a la voz.
 *
 * Construir y analizar viven juntos y en shared: el que escribe el enlace (Notas,
 * Contrastes, el portapapeles) y el que lo abre (App) no se conocen, y dos gramáticas
 * ligeramente distintas producen enlaces que parecen buenos y no llevan a ninguna parte.
 */

export type TestimonyLinkTarget = 'interview' | 'participant' | 'contrast';

export interface TestimonyDeepLink {
  target: TestimonyLinkTarget;
  id: string;
  sessionId?: string;
  transcriptId?: string;
  annotationId?: string;
  /** Segundos desde el inicio del medio. */
  t?: number;
}

const SCHEME = 'nodus://testimonios/';

export function buildTestimonyLink(link: TestimonyDeepLink): string {
  const params = new URLSearchParams();
  if (link.sessionId) params.set('session', link.sessionId);
  if (link.transcriptId) params.set('transcript', link.transcriptId);
  if (link.annotationId) params.set('annotation', link.annotationId);
  if (link.t != null && Number.isFinite(link.t) && link.t > 0) {
    // Décimas: el oído no distingue más y una cita con seis decimales parece
    // generada por una máquina, que es justo lo contrario de lo que se cita.
    params.set('t', String(Math.round(link.t * 10) / 10));
  }
  const query = params.toString();
  return `${SCHEME}${link.target}/${encodeURIComponent(link.id)}${query ? `?${query}` : ''}`;
}

export function parseTestimonyLink(url: string): TestimonyDeepLink | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(SCHEME)) return null;
  const rest = trimmed.slice(SCHEME.length);
  const [pathPart, queryPart] = rest.split('?', 2);
  const [targetRaw, ...idParts] = pathPart.split('/');
  const target = targetRaw as TestimonyLinkTarget;
  if (target !== 'interview' && target !== 'participant' && target !== 'contrast') return null;
  const idRaw = idParts.join('/');
  if (!idRaw) return null;
  let id: string;
  try {
    id = decodeURIComponent(idRaw);
  } catch {
    id = idRaw;
  }
  const link: TestimonyDeepLink = { target, id };
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const session = params.get('session');
    const transcript = params.get('transcript');
    const annotation = params.get('annotation');
    const t = params.get('t');
    if (session) link.sessionId = session;
    if (transcript) link.transcriptId = transcript;
    if (annotation) link.annotationId = annotation;
    if (t != null) {
      const seconds = Number(t);
      if (Number.isFinite(seconds) && seconds >= 0) link.t = seconds;
    }
  }
  return link;
}

/** Enlace Markdown listo para pegar en una nota. */
export function testimonyLinkMarkdown(label: string, link: TestimonyDeepLink): string {
  const safeLabel = label.replace(/\]/g, '\\]').replace(/\n+/g, ' ').trim() || 'Abrir fragmento';
  return `[${safeLabel}](${buildTestimonyLink(link)})`;
}

/**
 * Todos los enlaces de Testimonios que aparecen en un texto. Lo usa la exportación de
 * Notas para degradarlos a su etiqueta: un `nodus://` en un lector Markdown cualquiera
 * es un enlace que parece real y no lleva a ningún sitio.
 */
export function extractTestimonyLinks(markdown: string): TestimonyDeepLink[] {
  const out: TestimonyDeepLink[] = [];
  const re = /nodus:\/\/testimonios\/[^\s)<>"']+/gi;
  for (const match of markdown.matchAll(re)) {
    const parsed = parseTestimonyLink(match[0]);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Sustituye cada enlace `nodus://testimonios/...` por su etiqueta a secas. */
export function stripTestimonyLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\(nodus:\/\/testimonios\/[^)]*\)/gi, '$1');
}
