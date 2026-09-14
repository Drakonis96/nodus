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

import type { PromptLanguage } from './types';
import { normalizePromptLanguage, worldArticleCategoryLabel, worldEntryKindLabel } from './worldPromptLanguage';
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
export function worldArticleSystemPrompt(language: PromptLanguage = 'es', expand = false): string {
  return worldOperationSystemPrompt(expand ? 'articleExpand' : 'articleDraft', normalizePromptLanguage(language));
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

export function composeWorldArticleContext(sources: WorldArticleSources, language: PromptLanguage = 'es'): string {
  const locale = normalizePromptLanguage(language);
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

const ARTICLE_CONTEXT_COPY: Record<PromptLanguage, {
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
  'zh-Hans': { entry: '条目', category: '类别', aliases: '又称', authorSummary: '作者摘要', calendar: '本世界的历法（不要使用其他历法）：', eras: '纪元', months: '月份', neighbours: '本条目周围的世界（请利用它；不要虚构此范围之外的内容）：', outgoing: '本条目提及它', incoming: '它提及本条目', currentBody: '条目的当前正文（请保留并扩写）：', returnExpanded: '返回完整扩写后的条目。', writeEntry: '撰写条目。' },
  'zh-Hant': { entry: '條目', category: '類別', aliases: '又稱', authorSummary: '作者摘要', calendar: '本世界的曆法（請勿使用其他曆法）：', eras: '紀元', months: '月份', neighbours: '本條目周圍的世界（請善用它；不要虛構此範圍之外的內容）：', outgoing: '本條目提及它', incoming: '它提及本條目', currentBody: '條目的目前正文（請保留並擴寫）：', returnExpanded: '回傳完整擴寫後的條目。', writeEntry: '撰寫條目。' },
  vi: { entry: 'MỤC TỪ', category: 'THỂ LOẠI', aliases: 'CÒN GỌI LÀ', authorSummary: 'TÓM TẮT CỦA TÁC GIẢ', calendar: 'LỊCH CỦA THẾ GIỚI NÀY (không dùng lịch nào khác):', eras: 'Kỷ nguyên', months: 'Tháng', neighbours: 'THẾ GIỚI XUNG QUANH MỤC TỪ NÀY (hãy dùng nó; đừng bịa đặt gì ngoài phạm vi này):', outgoing: 'mục từ này nhắc đến nó', incoming: 'nó nhắc đến mục từ này', currentBody: 'VĂN BẢN HIỆN TẠI CỦA MỤC TỪ (giữ nguyên và mở rộng):', returnExpanded: 'Trả về mục từ ĐẦY ĐỦ, đã mở rộng.', writeEntry: 'Viết mục từ.' },
  ja: { entry: '項目', category: 'カテゴリ', aliases: '別名', authorSummary: '作者による要約', calendar: 'この世界の暦（他の暦は使わないでください）：', eras: '時代', months: '月', neighbours: 'この項目を取り巻く世界（活用し、それ以外を捏造しないでください）：', outgoing: 'この項目がそれに言及している', incoming: 'それがこの項目に言及している', currentBody: '現在の項目本文（保持して拡張してください）：', returnExpanded: '拡張後の完全な項目を返してください。', writeEntry: '項目を書いてください。' },
  ru: { entry: 'СТАТЬЯ', category: 'КАТЕГОРИЯ', aliases: 'ТАКЖЕ НАЗЫВАЕТСЯ', authorSummary: 'РЕЗЮМЕ АВТОРА', calendar: 'КАЛЕНДАРЬ ЭТОГО МИРА (не используйте никакой другой):', eras: 'Эпохи', months: 'Месяцы', neighbours: 'МИР ВОКРУГ ЭТОЙ СТАТЬИ (используйте его; не выдумывайте ничего за его пределами):', outgoing: 'эта статья упоминает его', incoming: 'оно упоминает эту статью', currentBody: 'ТЕКУЩИЙ ТЕКСТ СТАТЬИ (сохраните и расширьте его):', returnExpanded: 'Верните ПОЛНУЮ расширенную статью.', writeEntry: 'Напишите статью.' },
  uk: { entry: 'СТАТТЯ', category: 'КАТЕГОРІЯ', aliases: 'ТАКОЖ НАЗИВАЄТЬСЯ', authorSummary: 'РЕЗЮМЕ АВТОРА', calendar: 'КАЛЕНДАР ЦЬОГО СВІТУ (не використовуйте жодного іншого):', eras: 'Епохи', months: 'Місяці', neighbours: 'СВІТ НАВКОЛО ЦІЄЇ СТАТТІ (використовуйте його; не вигадуйте нічого поза ним):', outgoing: 'ця стаття згадує його', incoming: 'воно згадує цю статтю', currentBody: 'ПОТОЧНИЙ ТЕКСТ СТАТТІ (збережіть і розширте його):', returnExpanded: 'Поверніть ПОВНУ розширену статтю.', writeEntry: 'Напишіть статтю.' },
  ko: { entry: '항목', category: '분류', aliases: '다른 이름', authorSummary: '저자 요약', calendar: '이 세계의 달력(다른 달력을 사용하지 마십시오):', eras: '시대', months: '월', neighbours: '이 항목을 둘러싼 세계(활용하되, 그 밖의 내용을 지어내지 마십시오):', outgoing: '이 항목이 그것을 언급함', incoming: '그것이 이 항목을 언급함', currentBody: '현재 항목 본문(그대로 유지하고 확장하십시오):', returnExpanded: '확장된 전체 항목을 반환하십시오.', writeEntry: '항목을 작성하십시오.' },
};
