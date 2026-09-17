import type { CreateStudyDocumentInput, NoteSource, StudyPlacementInput } from '@shared/types';

/**
 * A study note carries no structured source column — unlike a workspace note, whose
 * `NoteSource` is stored beside it — so the provenance of an answer saved from the
 * chat travels inside the note's own Markdown, written the way the notes export
 * writes it. The answer itself is never rewritten: the block is appended after a
 * rule, and the user can edit or delete it like any other paragraph.
 */
export function studyNoteProvenanceMarkdown(source: NoteSource | null | undefined, savedAt: string): string {
  const lines: string[] = ['**Procedencia:**'];
  const chat = source?.researchChat;
  if (chat) {
    lines.push(`- Conversación: ${chat.conversationTitle}`);
    lines.push(`- Guardada: ${savedAt}`);
    if (source?.model) lines.push(`- Modelo: ${source.model.provider} / ${source.model.model}`);
    const references = chat.references ?? [];
    if (references.length > 0) {
      lines.push('- Fuentes:');
      for (const reference of references) {
        const link = reference.href ? `[${reference.label}](${reference.href})` : reference.label;
        lines.push(`  - ${link}${reference.subtitle ? ` — ${reference.subtitle}` : ''}`);
      }
    }
  } else {
    lines.push(`- Guardada: ${savedAt}`);
  }
  return lines.join('\n');
}

/** The study note that captures one answer, with its provenance and its location. */
export function buildStudyNoteDocument(input: {
  title: string;
  content: string;
  source?: NoteSource | null;
  placement?: StudyPlacementInput | null;
  /** Injectable so the caller's clock — and the test — decide the saved date. */
  savedAt?: string;
}): CreateStudyDocumentInput {
  const savedAt = input.savedAt ?? new Date().toISOString();
  return {
    title: input.title,
    kind: 'apunte',
    contentMarkdown: `${input.content.trimEnd()}\n\n---\n\n${studyNoteProvenanceMarkdown(input.source, savedAt)}\n`,
    placement: input.placement ?? null,
  };
}
