import { useEffect, useRef, useState } from 'react';
import type { WorldEntry } from '@shared/types';
import { useQuestionCapture } from './questionCapture';
import { useWorldLinkAutocomplete, WorldLinkCandidates } from './worldLinkAutocomplete';
import { Markdown } from '../Markdown';
import { t } from '../../i18n';

/**
 * The article body editor: a textarea, a preview, and the one thing that makes an
 * encyclopedia an encyclopedia — typing `[[` offers everything in the world.
 *
 * The autocomplete itself lives in {@link useWorldLinkAutocomplete}, shared with the
 * manuscript editor. Picking a candidate writes the RESOLVED form
 * (`[label](nodus://world/kind/id)`) straight into the text, which is what makes a rename
 * survive; typing a name and moving on writes `[[name]]` and is promoted on save, so the
 * author never has to learn that there are two forms.
 */
export function WorldEntryEditor({
  value,
  entries,
  onSave,
  onCancel,
}: {
  value: string;
  entries: WorldEntry[];
  onSave: (next: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  /** The words the author has selected right now — what «convertir en pregunta abierta»
   *  would capture, anchored to this article and its body. */
  const [selection, setSelection] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { anchor, capture } = useQuestionCapture();
  const links = useWorldLinkAutocomplete({ entries, value: draft, onChange: setDraft, areaRef });

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const syncSelection = () => {
    const area = areaRef.current;
    if (!area) return;
    setSelection(area.value.slice(area.selectionStart, area.selectionEnd).trim());
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="entry-editor">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-neutral-800 p-0.5">
          {(['edit', 'preview'] as const).map((entry) => (
            <button
              key={entry}
              onClick={() => setMode(entry)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                mode === entry ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {t(entry === 'edit' ? 'Editar' : 'Vista previa')}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-neutral-600">{t('Escribe [[ para enlazar con cualquier cosa del mundo')}</span>
        {anchor && selection && (
          <button
            data-testid="capture-question"
            className="text-[11px] text-indigo-300 hover:text-indigo-200"
            onMouseDown={(event) => event.preventDefault()}
            onClick={async () => {
              await capture(selection, 'body');
              setSelection('');
            }}
          >
            {t('Convertir en pregunta abierta')}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary px-4 text-xs" data-testid="entry-editor-save" disabled={saving} onClick={() => void save()}>
            {saving ? t('Guardando…') : t('Guardar')}
          </button>
        </div>
      </div>

      {mode === 'preview' ? (
        <div className="rounded-lg border border-neutral-800 p-3">
          <Markdown content={draft} verify={false} />
        </div>
      ) : (
        <div className="relative">
          <textarea
            ref={areaRef}
            className="input w-full resize-y text-sm leading-6"
            rows={16}
            value={draft}
            placeholder={t('Escribe la entrada…')}
            onChange={(event) => {
              setDraft(event.target.value);
              links.sync(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) => {
              links.sync(draft, event.currentTarget.selectionStart);
              syncSelection();
            }}
            onSelect={syncSelection}
            onMouseUp={syncSelection}
            onKeyDown={(event) => {
              links.handleKeyDown(event);
            }}
          />
          <WorldLinkCandidates candidates={links.candidates} highlight={links.highlight} onChoose={links.choose} />
        </div>
      )}
    </div>
  );
}
