import type { AppLanguage } from './types';
import type { ReleaseHighlight, ReleaseNote, ReleaseNoteScope } from './releaseNotes';

export const RELEASE_CATEGORIES = ['new', 'enhancement', 'fix'] as const;
export type ReleaseCategory = typeof RELEASE_CATEGORIES[number];

export const RELEASE_SECTION_LABELS: Record<AppLanguage, Record<ReleaseCategory, string>> = {
  es: { new: 'Funciones nuevas', enhancement: 'Mejoras', fix: 'Correcciones' },
  en: { new: 'New features', enhancement: 'Enhancements', fix: 'Fixes' },
  fr: { new: 'Nouvelles fonctionnalités', enhancement: 'Améliorations', fix: 'Corrections' },
  de: { new: 'Neue Funktionen', enhancement: 'Verbesserungen', fix: 'Fehlerbehebungen' },
  pt: { new: 'Novas funcionalidades', enhancement: 'Melhorias', fix: 'Correções' },
  'pt-BR': { new: 'Novas funcionalidades', enhancement: 'Melhorias', fix: 'Correções' },
  it: { new: 'Nuove funzionalità', enhancement: 'Miglioramenti', fix: 'Correzioni' },
  tr: { new: 'Yeni özellikler', enhancement: 'İyileştirmeler', fix: 'Düzeltmeler' },
  'zh-CN': { new: '新增功能', enhancement: '改进', fix: '修复' },
  'zh-TW': { new: '新增功能', enhancement: '改善', fix: '修正' },
  ja: { new: '新機能', enhancement: '改善', fix: '修正' },
  ko: { new: '새 기능', enhancement: '개선', fix: '수정' },
};
export const RELEASE_EMPTY_SECTION: Record<AppLanguage, string> = {
  es: 'Sin novedades en esta sección.', en: 'No changes in this section.',
  fr: 'Aucun changement dans cette section.', de: 'Keine Änderungen in diesem Abschnitt.',
  pt: 'Sem novidades nesta secção.', 'pt-BR': 'Sem novidades nesta seção.',
  it: 'Nessuna novità in questa sezione.', tr: 'Bu bölümde değişiklik yok.',
  'zh-CN': '本节无变更。', 'zh-TW': '本節無變更。', ja: 'このセクションに変更はありません。', ko: '이 섹션에는 변경 사항이 없습니다.',
};

// Preserve the modal's existing scope ordering inside each category: largest group
// first, stable first-appearance ties, and original order inside each group.
export function groupHighlightsByScope<T extends { scope: ReleaseNoteScope }>(highlights: readonly T[]): T[] {
  const groups = new Map<ReleaseNoteScope, T[]>();
  for (const highlight of highlights) {
    const bucket = groups.get(highlight.scope);
    if (bucket) bucket.push(highlight);
    else groups.set(highlight.scope, [highlight]);
  }
  return [...groups.values()]
    .map((items, index) => ({ items, index }))
    .sort((a, b) => b.items.length - a.items.length || a.index - b.index)
    .flatMap(group => group.items);
}

export function releaseNoteSections(note: ReleaseNote): { category: ReleaseCategory | null; highlights: ReleaseHighlight[] }[] {
  // Only v5 and future releases adopt sections. Earlier generations keep their layout.
  if (Number.parseInt(note.version, 10) < 5) return [{ category: null, highlights: groupHighlightsByScope(note.highlights) }];
  for (const highlight of note.highlights) {
    if (!highlight.category || !RELEASE_CATEGORIES.includes(highlight.category)) {
      throw new Error(`Release ${note.version} has an uncategorized highlight: ${highlight.en}`);
    }
  }
  return RELEASE_CATEGORIES.map(category => ({
    category,
    highlights: groupHighlightsByScope(note.highlights.filter(highlight => highlight.category === category)),
  }));
}

/** The published description uses exactly the modal's English text and displayed order. */
export function releaseNoteMarkdown(note: ReleaseNote): string {
  if (!note.highlights.length) throw new Error(`Release ${note.version} has no highlights`);
  return `# Nodus ${note.version}\n\n` + releaseNoteSections(note).map(section =>
    (section.category ? `## ${RELEASE_SECTION_LABELS.en[section.category]}\n\n` : '') +
    (section.highlights.length
      ? section.highlights.map(highlight => {
          if (!highlight.en.trim()) throw new Error(`Release ${note.version} has an empty English highlight`);
          return `- ${highlight.en}`;
        }).join('\n\n')
      : RELEASE_EMPTY_SECTION.en)
  ).join('\n\n') + '\n';
}
