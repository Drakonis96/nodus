import { useEffect, useRef, useState } from 'react';
import { useQuestionCapture } from './world/questionCapture';
import { t } from '../i18n';

/**
 * One prose field that saves itself on blur.
 *
 * Blur rather than a Save button, and blur rather than a debounce: a character sheet is a
 * dozen of these and a dozen buttons is noise, while a debounce would fire a write per
 * pause in a sentence. The value is echoed back from props so an external change (a
 * regeneration, a reload) replaces the draft instead of being overwritten by it, and the
 * commit is skipped when nothing changed so tabbing through the sheet writes nothing.
 *
 * Inside a worldbuilding sheet it does one more thing: selecting text offers to turn it
 * into an open question, anchored HERE, in this field. That affordance lives in the shared
 * field rather than in each sheet because the moment a writer notices an undecided thing is
 * always mid-sentence, and a capture that costs a trip to another section is a capture that
 * does not happen.
 */
export function AutoSavingField({
  label,
  hint,
  hideLabel = false,
  value,
  placeholder,
  rows = 3,
  field,
  onSave,
}: {
  label: string;
  hint?: string;
  hideLabel?: boolean;
  value: string | null;
  placeholder: string;
  rows?: number;
  /** The stored field name (`backstory`, `atmosphere`…). It is what lets an answer be
   *  written back here later; without it the capture still works, but its answer can only
   *  be remembered rather than written. */
  field?: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { anchor, capture } = useQuestionCapture();

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const commit = async () => {
    if (draft === (value ?? '')) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const syncSelection = () => {
    const area = areaRef.current;
    if (!area) return;
    setSelection(area.value.slice(area.selectionStart, area.selectionEnd).trim());
  };

  const captureSelection = async () => {
    if (!selection) return;
    await capture(selection, field);
    setSelection('');
  };

  return (
    <label className="block">
      {hideLabel ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="mb-1 flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
          {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
          {saving && <span className="ml-auto text-[10px] text-neutral-500">{t('Guardando…')}</span>}
        </span>
      )}
      <textarea
        ref={areaRef}
        className="input w-full resize-y text-sm"
        style={{ minHeight: `${Math.max(2, rows) * 1.5 + 1}rem` }}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onSelect={syncSelection}
        onKeyUp={syncSelection}
        onMouseUp={syncSelection}
        onKeyDown={(event) => {
          // Alt+Q, on the field itself. A global shortcut would have to guess which of the
          // dozen fields on a sheet the writer meant.
          if (event.altKey && (event.key === 'q' || event.key === 'Q') && anchor) {
            event.preventDefault();
            syncSelection();
            void captureSelection();
          }
        }}
        // The blur commit must not fire before the capture button's click lands, so the
        // selection is read on mousedown and the commit still runs afterwards.
        onBlur={() => void commit()}
      />
      {anchor && selection && (
        <button
          type="button"
          data-testid="capture-question"
          className="mt-1 flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200"
          title={t('Alt+Q')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void captureSelection()}
        >
          {t('Convertir en pregunta abierta')}
        </button>
      )}
    </label>
  );
}
