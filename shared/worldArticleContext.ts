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

import type { AppLanguage } from './types';
import { normalizeUiLanguage, worldArticleCategoryLabel, worldEntryKindLabel } from './worldPromptLanguage';
import { worldOperationSystemPrompt } from './worldOperationPrompts';

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

/** Localized system contract for callers that use this pure context module directly. */
export function worldArticleSystemPrompt(language: AppLanguage = 'es', expand = false): string {
  return worldOperationSystemPrompt(expand ? 'articleExpand' : 'articleDraft', normalizeUiLanguage(language));
}

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

export function composeWorldArticleContext(sources: WorldArticleSources, language: AppLanguage = 'es'): string {
  const locale = normalizeUiLanguage(language);
  const copy = ARTICLE_CONTEXT_COPY[locale];
  const lines: string[] = [];
  lines.push(`${copy.entry}: ${sources.title}`);
  lines.push(`${copy.category}: ${worldArticleCategoryLabel(sources.category, locale)}`);
  if (sources.aliases.length) lines.push(`${copy.aliases}: ${sources.aliases.join(', ')}`);
  if ((sources.summary ?? '').trim()) lines.push(`${copy.authorSummary}: ${sources.summary!.trim()}`);

  if (sources.calendar && (sources.calendar.eras.length || sources.calendar.months.length)) {
    lines.push('');
    lines.push(copy.calendar);
    if (sources.calendar.eras.length) lines.push(`- ${copy.eras}: ${sources.calendar.eras.join(', ')}`);
    if (sources.calendar.months.length) lines.push(`- ${copy.months}: ${sources.calendar.months.join(', ')}`);
  }

  if (sources.neighbours.length) {
    lines.push('');
    lines.push(copy.neighbours);
    for (const neighbour of sources.neighbours) {
      const relation = neighbour.direction === 'outgoing' ? copy.outgoing : copy.incoming;
      lines.push(`- ${neighbour.title} (${worldEntryKindLabel(neighbour.kind, locale)}; ${relation})${neighbour.summary ? `: ${neighbour.summary}` : ''}`);
    }
  }

  if ((sources.body ?? '').trim()) {
    lines.push('');
    lines.push(copy.currentBody);
    lines.push(sources.body!.trim());
    lines.push('');
    lines.push(copy.returnExpanded);
  } else {
    lines.push('');
    lines.push(copy.writeEntry);
  }
  return lines.join('\n');
}

const ARTICLE_CONTEXT_COPY: Record<AppLanguage, {
  entry: string; category: string; aliases: string; authorSummary: string; calendar: string;
  eras: string; months: string; neighbours: string; outgoing: string; incoming: string;
  currentBody: string; returnExpanded: string; writeEntry: string;
}> = {
  es: { entry: 'ENTRADA', category: 'CLASE', aliases: 'TAMBIÉN LLAMADA', authorSummary: 'RESUMEN DEL AUTOR', calendar: 'CALENDARIO DE ESTE MUNDO (no uses ningún otro):', eras: 'Eras', months: 'Meses', neighbours: 'EL MUNDO ALREDEDOR DE ESTA ENTRADA (úsalo; no inventes nada fuera de aquí):', outgoing: 'esta entrada lo menciona', incoming: 'lo menciona a esta entrada', currentBody: 'TEXTO ACTUAL DE LA ENTRADA (consérvalo y amplíalo):', returnExpanded: 'Devuelve la entrada COMPLETA, ya ampliada.', writeEntry: 'Escribe la entrada.' },
  en: { entry: 'ENTRY', category: 'CATEGORY', aliases: 'ALSO CALLED', authorSummary: 'AUTHOR SUMMARY', calendar: 'THIS WORLD’S CALENDAR (use no other):', eras: 'Eras', months: 'Months', neighbours: 'THE WORLD AROUND THIS ENTRY (use it; invent nothing beyond it):', outgoing: 'this entry mentions it', incoming: 'it mentions this entry', currentBody: 'CURRENT ENTRY TEXT (preserve and expand it):', returnExpanded: 'Return the COMPLETE expanded entry.', writeEntry: 'Write the entry.' },
  fr: { entry: 'ENTRÉE', category: 'CATÉGORIE', aliases: 'AUSSI APPELÉE', authorSummary: 'RÉSUMÉ DE L’AUTEUR', calendar: 'CALENDRIER DE CE MONDE (n’en utilise aucun autre) :', eras: 'Ères', months: 'Mois', neighbours: 'LE MONDE AUTOUR DE CETTE ENTRÉE (utilise-le ; n’invente rien au-delà) :', outgoing: 'cette entrée le mentionne', incoming: 'il mentionne cette entrée', currentBody: 'TEXTE ACTUEL DE L’ENTRÉE (conserve-le et développe-le) :', returnExpanded: 'Renvoie l’entrée COMPLÈTE, développée.', writeEntry: 'Rédige l’entrée.' },
  de: { entry: 'EINTRAG', category: 'KATEGORIE', aliases: 'AUCH GENANNT', authorSummary: 'ZUSAMMENFASSUNG DER AUTORIN ODER DES AUTORS', calendar: 'KALENDER DIESER WELT (keinen anderen verwenden):', eras: 'Epochen', months: 'Monate', neighbours: 'DIE WELT UM DIESEN EINTRAG (verwenden; nichts darüber hinaus erfinden):', outgoing: 'dieser Eintrag erwähnt es', incoming: 'es erwähnt diesen Eintrag', currentBody: 'AKTUELLER EINTRAGSTEXT (bewahren und erweitern):', returnExpanded: 'Den VOLLSTÄNDIGEN erweiterten Eintrag zurückgeben.', writeEntry: 'Den Eintrag schreiben.' },
  pt: { entry: 'ARTIGO', category: 'CATEGORIA', aliases: 'TAMBÉM CHAMADA', authorSummary: 'RESUMO DO AUTOR', calendar: 'CALENDÁRIO DESTE MUNDO (não uses outro):', eras: 'Eras', months: 'Meses', neighbours: 'O MUNDO À VOLTA DESTE ARTIGO (usa-o; não inventes para além dele):', outgoing: 'este artigo menciona-o', incoming: 'menciona este artigo', currentBody: 'TEXTO ATUAL DO ARTIGO (conserva-o e amplia-o):', returnExpanded: 'Devolve o artigo COMPLETO, ampliado.', writeEntry: 'Escreve o artigo.' },
  'pt-BR': { entry: 'ARTIGO', category: 'CATEGORIA', aliases: 'TAMBÉM CHAMADO', authorSummary: 'RESUMO DO AUTOR', calendar: 'CALENDÁRIO DESTE MUNDO (não use outro):', eras: 'Eras', months: 'Meses', neighbours: 'O MUNDO AO REDOR DESTE ARTIGO (use-o; não invente além dele):', outgoing: 'este artigo o menciona', incoming: 'ele menciona este artigo', currentBody: 'TEXTO ATUAL DO ARTIGO (preserve-o e amplie-o):', returnExpanded: 'Retorne o artigo COMPLETO, ampliado.', writeEntry: 'Escreva o artigo.' },
  it: { entry: 'VOCE', category: 'CATEGORIA', aliases: 'CHIAMATA ANCHE', authorSummary: 'SOMMARIO DELL’AUTORE', calendar: 'CALENDARIO DI QUESTO MONDO (non usarne altri):', eras: 'Ere', months: 'Mesi', neighbours: 'IL MONDO INTORNO A QUESTA VOCE (usalo; non inventare oltre):', outgoing: 'questa voce lo menziona', incoming: 'menziona questa voce', currentBody: 'TESTO ATTUALE DELLA VOCE (conservalo e amplialo):', returnExpanded: 'Restituisci la voce COMPLETA, ampliata.', writeEntry: 'Scrivi la voce.' },
  tr: { entry: 'MADDE', category: 'KATEGORİ', aliases: 'DİĞER ADI', authorSummary: 'YAZARIN ÖZETİ', calendar: 'BU DÜNYANIN TAKVİMİ (başka takvim kullanma):', eras: 'Çağlar', months: 'Aylar', neighbours: 'BU MADDENİN ÇEVRESİNDEKİ DÜNYA (kullan; bunun dışında bir şey uydurma):', outgoing: 'bu madde ondan söz ediyor', incoming: 'o bu maddeden söz ediyor', currentBody: 'MADDENİN MEVCUT METNİ (koru ve genişlet):', returnExpanded: 'TAMAMEN genişletilmiş maddeyi döndür.', writeEntry: 'Maddeyi yaz.' },
};
