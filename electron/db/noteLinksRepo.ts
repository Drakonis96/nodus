// Enlaces de una nota con cualquier entidad (`note_links`, v105).
//
// Tabla y repositorio GENÉRICOS a propósito, aunque los estrene Testimonios: nada aquí
// habla de entrevistas, así que cualquier otro vault puede colgar sus notas de sus
// propias entidades sin una segunda tabla igual.
//
// EL ENLACE PUEDE ROMPERSE Y NO PASA NADA. No hay clave foránea y no se comprueba que el
// destino exista. Una nota interpretativa —«aquí se contradice con lo que contó en
// 1998»— es trabajo del investigador y sobrevive a la desaparición de su fragmento; lo
// que debe hacer entonces es mostrar un enlace roto, no evaporarse con él. Esa asimetría
// es deliberada: la transcripción es material, la nota es autoría.

import { getDb } from './database';
import { buildTestimonyLink, testimonyLinkMarkdown } from '@shared/testimonyDeepLinks';
import { formatCitation, formatTimecode } from '@shared/testimonies';
import { getFragment } from './testimonyAnalysisRepo';
import { createNote } from './notesRepo';
import type { NoteLink } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

export function listNoteLinks(noteId: string): NoteLink[] {
  return (getDb()
    .prepare('SELECT note_id, target_kind, target_id, label, created_at FROM note_links WHERE note_id = ? ORDER BY created_at')
    .all(noteId) as { note_id: string; target_kind: string; target_id: string; label: string | null; created_at: string }[])
    .map((row) => ({ noteId: row.note_id, targetKind: row.target_kind, targetId: row.target_id, label: row.label, createdAt: row.created_at }));
}

/** Las notas que apuntan a una entidad. Lo que hace útil el panel «Notas» del dossier. */
export function linksForTarget(targetKind: string, targetId: string): NoteLink[] {
  return (getDb()
    .prepare('SELECT note_id, target_kind, target_id, label, created_at FROM note_links WHERE target_kind = ? AND target_id = ? ORDER BY created_at DESC')
    .all(targetKind, targetId) as { note_id: string; target_kind: string; target_id: string; label: string | null; created_at: string }[])
    .map((row) => ({ noteId: row.note_id, targetKind: row.target_kind, targetId: row.target_id, label: row.label, createdAt: row.created_at }));
}

export function addNoteLink(noteId: string, targetKind: string, targetId: string, label: string | null = null): void {
  getDb()
    .prepare(
      `INSERT INTO note_links (note_id, target_kind, target_id, label, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(note_id, target_kind, target_id) DO UPDATE SET label = excluded.label`
    )
    .run(noteId, targetKind, targetId, label, now());
}

export function removeNoteLink(noteId: string, targetKind: string, targetId: string): void {
  getDb().prepare('DELETE FROM note_links WHERE note_id = ? AND target_kind = ? AND target_id = ?').run(noteId, targetKind, targetId);
}

export function removeLinksForNote(noteId: string): void {
  getDb().prepare('DELETE FROM note_links WHERE note_id = ?').run(noteId);
}

/**
 * Crear una nota A PARTIR de un fragmento.
 *
 * La nota nace con la cita, el hablante, la entrevista, el tiempo, los códigos y el
 * enlace que devuelve al minuto exacto. Ese es el gesto que cierra el círculo del vault:
 * la interpretación se escribe pegada a la voz que la provocó, y meses después se puede
 * volver a oírla en vez de fiarse de lo que uno recordaba haber oído.
 *
 * El nombre del hablante viene YA RESUELTO por la puerta de atribución (`getFragment`),
 * así que una nota nunca puede filtrar un nombre real bajo seudónimo.
 */
export function createNoteFromFragment(annotationId: string): { noteId: string; title: string } {
  const fragment = getFragment(annotationId);
  if (!fragment) throw new Error('El fragmento no existe.');

  const link = {
    target: 'interview' as const,
    id: fragment.interviewId,
    transcriptId: fragment.transcriptId,
    annotationId,
    t: fragment.tStart,
  };
  const citation = formatCitation({
    displayName: fragment.speakerName,
    interviewTitle: fragment.interviewTitle,
    dateText: fragment.conductedAt ? fragment.conductedAt.slice(0, 10) : undefined,
    tStart: fragment.tStart,
    tEnd: fragment.tEnd,
  });
  const codes = fragment.codes.map((code) => code.label).join(', ');
  const title = `${fragment.speakerName} — ${formatTimecode(fragment.tStart)}`;
  const body = [
    `> ${fragment.text.trim().replace(/\n+/g, '\n> ')}`,
    '',
    `— ${citation}`,
    '',
    codes ? `**Códigos:** ${codes}` : null,
    fragment.memo ? `**Memo:** ${fragment.memo}` : null,
    '',
    testimonyLinkMarkdown('Abrir el fragmento en su minuto', link),
    '',
    '---',
    '',
  ].filter((line) => line !== null).join('\n');

  const note = createNote({ title, content: body });
  const db = getDb();
  const tx = db.transaction(() => {
    addNoteLink(note.id, 'testimony_annotation', annotationId, fragment.text.slice(0, 120));
    addNoteLink(note.id, 'testimony_interview', fragment.interviewId, fragment.interviewTitle);
    if (fragment.speakerPersonId) addNoteLink(note.id, 'testimony_participant', fragment.speakerPersonId, fragment.speakerName);
    for (const code of fragment.codes) addNoteLink(note.id, 'testimony_code', code.id, code.label);
  });
  tx();
  return { noteId: note.id, title };
}

/** El enlace canónico de una entrevista, para copiar al portapapeles. */
export function interviewLink(interviewId: string, options: { t?: number; annotationId?: string } = {}): string {
  return buildTestimonyLink({ target: 'interview', id: interviewId, t: options.t, annotationId: options.annotationId });
}
