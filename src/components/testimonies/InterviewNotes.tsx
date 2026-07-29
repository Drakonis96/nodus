import { useCallback, useEffect, useState } from 'react';
import type { Note, NoteLink, TestimonyInterviewRow } from '@shared/types';
import { buildTestimonyLink } from '@shared/testimonyDeepLinks';
import { Icon } from '../ui';
import { toast } from '../feedback';
import { t, tx } from '../../i18n';

/**
 * Las notas enlazadas con esta entrevista.
 *
 * LA NOTA ES INTERPRETACIÓN; LA TRANSCRIPCIÓN ES MATERIAL. Por eso viven separadas y por
 * eso una nota SOBREVIVE a lo que enlaza: si el fragmento desaparece, el texto del
 * investigador se queda y el enlace se muestra roto. La asimetría es deliberada — lo que
 * alguien escribió es suyo, y borrárselo porque cambió una transcripción sería perder
 * trabajo sin avisar.
 *
 * Se reutiliza el espacio universal de Notas: aquí solo se listan y se crean las que
 * apuntan a esta entrevista. Editarlas se hace en Notas, que es donde ya se sabe hacerlo.
 */
export function InterviewNotes({ row }: { row: TestimonyInterviewRow }) {
  const [links, setLinks] = useState<NoteLink[]>([]);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await window.nodus.linksForTarget('testimony_interview', row.id);
    setLinks(rows);
    const loaded = new Map<string, Note>();
    for (const link of rows) {
      const note = await window.nodus.getNote(link.noteId);
      if (note) loaded.set(link.noteId, note);
    }
    setNotes(loaded);
    setLoading(false);
  }, [row.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createNote = async (): Promise<void> => {
    const link = buildTestimonyLink({ target: 'interview', id: row.id });
    const note = await window.nodus.createNote({
      title: tx('Notas sobre {title}', { title: row.title }),
      content: `[${row.title}](${link})\n\n`,
    });
    await window.nodus.addNoteLink(note.id, 'testimony_interview', row.id, row.title);
    await reload();
  };

  return (
    <div className="space-y-4" data-testid="testimony-notes">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" data-testid="testimony-new-note" onClick={() => void createNote()}>
          <Icon name="plus" /> {t('Nueva nota sobre esta entrevista')}
        </button>
        <button
          className="btn btn-ghost"
          data-testid="testimony-copy-link"
          onClick={async () => {
            await navigator.clipboard.writeText(buildTestimonyLink({ target: 'interview', id: row.id }));
            toast(t('Enlace copiado. Pégalo en cualquier nota para volver aquí.'));
          }}
        >
          <Icon name="link" /> {t('Copiar el enlace de la entrevista')}
        </button>
      </div>

      <p className="text-[11px] leading-5 text-neutral-500">
        {t('Los memos, las observaciones de campo y las interpretaciones viven en Notas, separados de lo que la persona dijo literalmente. Desde un fragmento codificado puedes crear una nota que ya incluye la cita, el hablante, el minuto y el enlace de vuelta al audio.')}
      </p>

      {loading ? (
        <p className="text-sm text-neutral-500">{t('Cargando...')}</p>
      ) : links.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
          {t('Todavía no hay notas enlazadas con esta entrevista.')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="testimony-note-list">
          {links.map((link) => {
            const note = notes.get(link.noteId);
            return (
              <li key={link.noteId} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <Icon name="notebook" size={13} className="shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {note?.title ?? link.label ?? t('Nota sin título')}
                  </span>
                  <span className="shrink-0 text-[11px] text-neutral-500">{note?.updatedAt.slice(0, 10)}</span>
                </div>
                {note?.content && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-neutral-500">
                    {note.content.replace(/\[([^\]]*)\]\(nodus:\/\/[^)]*\)/g, '$1').slice(0, 320)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
