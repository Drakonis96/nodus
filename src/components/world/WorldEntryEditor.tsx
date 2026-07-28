import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldEntry } from '@shared/types';
import { formatWorldLink, rankEntryCandidates } from '@shared/worldEncyclopedia';
import { Markdown } from '../Markdown';
import { Icon } from '../ui';
import { WORLD_ENTRY_KIND_ICON } from '../../views/EncyclopediaView';
import { t } from '../../i18n';

/**
 * The article body editor: a textarea, a preview, and the one thing that makes an
 * encyclopedia an encyclopedia — typing `[[` offers everything in the world.
 *
 * The autocomplete runs entirely against the index the view already loaded, so there is no
 * IPC round-trip per keystroke. Picking a candidate writes the RESOLVED form
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
  /** Where the open `[[` starts, and what has been typed after it. */
  const [trigger, setTrigger] = useState<{ at: number; fragment: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const candidates = useMemo(
    () => (trigger ? rankEntryCandidates(entries, trigger.fragment, 8) : []),
    [entries, trigger]
  );

  useEffect(() => {
    setHighlight(0);
  }, [trigger?.fragment]);

  /**
   * Find an unclosed `[[` before the caret. Scanning backwards from the caret rather than
   * reacting to the keystroke is what keeps the popover correct when the author clicks
   * back into a half-written link, or pastes over one.
   */
  const syncTrigger = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const open = before.lastIndexOf('[[');
    if (open < 0) return setTrigger(null);
    const fragment = before.slice(open + 2);
    // A newline or a closing bracket means the link is over; an unbroken run of prose
    // after `[[` is still being typed.
    if (/[\]\n]/.test(fragment)) return setTrigger(null);
    setTrigger({ at: open, fragment });
  };

  const choose = (entry: WorldEntry) => {
    if (!trigger) return;
    const area = areaRef.current;
    const caret = area?.selectionStart ?? draft.length;
    const link = formatWorldLink({ kind: entry.kind, id: entry.id }, entry.title);
    const next = `${draft.slice(0, trigger.at)}${link}${draft.slice(caret)}`;
    setDraft(next);
    setTrigger(null);
    // The caret has to land after the link or the next word is typed inside it.
    requestAnimationFrame(() => {
      const position = trigger.at + link.length;
      area?.focus();
      area?.setSelectionRange(position, position);
    });
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
              syncTrigger(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) => syncTrigger(draft, event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (!trigger || candidates.length === 0) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight((current) => (current + 1) % candidates.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight((current) => (current - 1 + candidates.length) % candidates.length);
              } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                choose(candidates[highlight]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setTrigger(null);
              }
            }}
          />
          {trigger && candidates.length > 0 && (
            <ul
              data-testid="entry-link-autocomplete"
              className="absolute left-2 top-2 z-20 max-h-64 w-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
            >
              {candidates.map((entry, index) => (
                <li key={entry.key}>
                  <button
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                      index === highlight ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                    // The textarea would lose the caret before the click landed.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(entry);
                    }}
                  >
                    <Icon name={WORLD_ENTRY_KIND_ICON[entry.kind]} size={12} className="shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
