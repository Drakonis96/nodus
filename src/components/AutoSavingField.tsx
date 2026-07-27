import { useEffect, useState } from 'react';
import { t } from '../i18n';

/**
 * One prose field that saves itself on blur.
 *
 * Blur rather than a Save button, and blur rather than a debounce: a character sheet is a
 * dozen of these and a dozen buttons is noise, while a debounce would fire a write per
 * pause in a sentence. The value is echoed back from props so an external change (a
 * regeneration, a reload) replaces the draft instead of being overwritten by it, and the
 * commit is skipped when nothing changed so tabbing through the sheet writes nothing.
 */
export function AutoSavingField({
  label,
  hint,
  hideLabel = false,
  value,
  placeholder,
  rows = 3,
  onSave,
}: {
  label: string;
  hint?: string;
  hideLabel?: boolean;
  value: string | null;
  placeholder: string;
  rows?: number;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

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
        className="input w-full resize-y text-sm"
        style={{ minHeight: `${Math.max(2, rows) * 1.5 + 1}rem` }}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
      />
    </label>
  );
}
