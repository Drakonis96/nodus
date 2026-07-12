import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';
import { t } from '../i18n';

/**
 * A compact markdown notes field with an Edit/Preview toggle, for inline use inside
 * a ficha or card (not a full-page editor like Notas). Saves explicitly, not on
 * every keystroke, so a half-written note never gets committed mid-typing.
 */
export function MarkdownNotesEditor({
  value,
  onSave,
  placeholder,
  rows = 4,
}: {
  value: string | null;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  rows?: number;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>(value?.trim() ? 'preview' : 'edit');
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const dirty = draft !== (value ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setMode('preview');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[11px]">
        <button
          className={`rounded px-2 py-0.5 ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
          onClick={() => setMode('edit')}
        >
          {t('Editar')}
        </button>
        <button
          className={`rounded px-2 py-0.5 ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
          onClick={() => setMode('preview')}
        >
          {t('Vista previa')}
        </button>
        {mode === 'edit' && dirty && (
          <button className="btn btn-primary ml-auto h-6 px-2 text-[11px]" disabled={saving} onClick={() => void save()}>
            {saving ? t('Guardando…') : t('Guardar')}
          </button>
        )}
      </div>
      {mode === 'edit' ? (
        <textarea
          className="input w-full resize-y text-sm"
          rows={rows}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : draft.trim() ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-2.5 text-sm">
          <Markdown content={draft} verify={false} />
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{placeholder}</p>
      )}
    </div>
  );
}
