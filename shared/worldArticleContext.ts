/**
 * The prompt and the context for writing an encyclopedia article.
 *
 * Pure, so what the model is actually told can be asserted without a provider, a database
 * or a network. The composition is where this feature succeeds or fails: a model given
 * only a title writes a generic fantasy entry that could belong to any world, and a writer
 * deletes it. What makes it belong to THIS world is the neighbourhood — the one-line
 * summary of everything this entry links to and everything that links to it — plus the
 * world's own calendar, so it does not quietly invent a month.
 */

export interface WorldArticleNeighbour {
  title: string;
  kind: string;
  summary: string | null;
  /** 'menciona' when this article points at it, 'la menciona' when it is the other way. */
  direction: 'outgoing' | 'incoming';
}

export interface WorldArticleSources {
  title: string;
  category: string;
  aliases: string[];
  summary: string | null;
  body: string | null;
  neighbours: WorldArticleNeighbour[];
  /** Era and month names, when the vault has an invented calendar. */
  calendar: { eras: string[]; months: string[] } | null;
}

export const WORLD_ARTICLE_SYSTEM = `Escribes entradas de enciclopedia para un mundo de ficción inventado por un autor.

Reglas, sin excepción:
- Lo que consta en el material es CANON. No lo contradigas, no lo "corrijas" y no lo suavices.
- No introduzcas nombres propios (personas, lugares, facciones, objetos) que no aparezcan en el material.
- Copia literalmente los nombres, epítetos y fechas tal como los escribe el autor: no los traduzcas, normalices ni conviertas a un calendario terrestre.
- Escribe en tercera persona, en tono enciclopédico y sobrio. Nada de segunda persona, nada de dirigirte al lector.
- Estructura la entrada con subtítulos "## " cuando tenga más de un aspecto.
- Empieza directamente por el texto: sin preámbulos, sin repetir el título como encabezado y sin comentar lo que vas a hacer.`;

export const WORLD_ARTICLE_EXPAND_SYSTEM = `${WORLD_ARTICLE_SYSTEM}
- Estás AMPLIANDO una entrada que ya existe: conserva lo escrito, no lo reescribas ni lo reordenes, y añade lo que falte.`;

/** True when there is enough to write from. An empty article with no links yields a
 *  generic entry, and offering one anyway teaches the writer to distrust the button. */
export function hasWorldArticleMaterial(sources: WorldArticleSources): boolean {
  return Boolean(
    (sources.summary ?? '').trim() ||
      (sources.body ?? '').trim() ||
      sources.neighbours.length > 0 ||
      sources.aliases.length > 0
  );
}

export function composeWorldArticleContext(sources: WorldArticleSources): string {
  const lines: string[] = [];
  lines.push(`ENTRADA: ${sources.title}`);
  lines.push(`CLASE: ${sources.category}`);
  if (sources.aliases.length) lines.push(`TAMBIÉN LLAMADA: ${sources.aliases.join(', ')}`);
  if ((sources.summary ?? '').trim()) lines.push(`RESUMEN DEL AUTOR: ${sources.summary!.trim()}`);

  if (sources.calendar && (sources.calendar.eras.length || sources.calendar.months.length)) {
    lines.push('');
    lines.push('CALENDARIO DE ESTE MUNDO (no uses ningún otro):');
    if (sources.calendar.eras.length) lines.push(`- Eras: ${sources.calendar.eras.join(', ')}`);
    if (sources.calendar.months.length) lines.push(`- Meses: ${sources.calendar.months.join(', ')}`);
  }

  if (sources.neighbours.length) {
    lines.push('');
    lines.push('EL MUNDO ALREDEDOR DE ESTA ENTRADA (úsalo; no inventes nada fuera de aquí):');
    for (const neighbour of sources.neighbours) {
      const relation = neighbour.direction === 'outgoing' ? 'esta entrada lo menciona' : 'lo menciona a esta entrada';
      lines.push(`- ${neighbour.title} (${neighbour.kind}; ${relation})${neighbour.summary ? `: ${neighbour.summary}` : ''}`);
    }
  }

  if ((sources.body ?? '').trim()) {
    lines.push('');
    lines.push('TEXTO ACTUAL DE LA ENTRADA (consérvalo y amplíalo):');
    lines.push(sources.body!.trim());
    lines.push('');
    lines.push('Devuelve la entrada COMPLETA, ya ampliada.');
  } else {
    lines.push('');
    lines.push('Escribe la entrada.');
  }
  return lines.join('\n');
}
