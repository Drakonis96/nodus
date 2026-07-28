import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { RuleHardness } from '@shared/types';
import { RULE_HARDNESS, RULE_HARDNESS_HINT, RULE_HARDNESS_LABEL, RULE_SUGGESTIONS } from '@shared/worldRules';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * Create a law: a title and how hard it is. Nothing else.
 *
 * The hardness is asked for because it is the ONE field that changes what a breach means —
 * breaking a physical law is a continuity error, breaking a priced one without paying is a
 * cheat, breaking a social one is a plot. Everything else is written in the sheet.
 *
 * The suggestions fill only the TITLE, and only when the author clicks one. They are not
 * seeds that prefill statement, cost and limits with prose: the character archetype
 * templates learned that the hard way — prefilled prose has to be deleted before it can be
 * answered, and it lands in the database outside the reach of i18n. What gets stored here
 * is the sentence the author read, in their own language, and chose.
 */
export function NewRuleModal({
  onClose,
  onCreated,
  articleId,
  initialTitle = '',
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  /** Set when the law is being made out of an encyclopedia article. */
  articleId?: string;
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [hardness, setHardness] = useState<RuleHardness>('costly');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.createWorldRule({ title: title.trim(), hardness, articleId });
      await onCreated(created.ruleId);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" data-testid="new-rule-modal">
        <div className="mb-4 flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-neutral-100">{t('Nueva regla')}</h3>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Qué es siempre verdad en este mundo')}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void save()}
          />

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Qué clase de ley')}</span>
            <div className="space-y-1">
              {RULE_HARDNESS.map((entry) => (
                <label
                  key={entry}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
                    hardness === entry ? 'border-indigo-600 bg-indigo-950/20' : 'border-neutral-800'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={hardness === entry}
                    onChange={() => setHardness(entry)}
                  />
                  <span>
                    <span className="block text-neutral-200">{t(RULE_HARDNESS_LABEL[entry])}</span>
                    <span className="block text-[10px] text-neutral-600">{t(RULE_HARDNESS_HINT[entry])}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!title.trim() && (
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
                {t('O empieza por una de estas')}
              </span>
              <div className="flex flex-wrap gap-1">
                {RULE_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                    onClick={() => setTitle(t(suggestion))}
                  >
                    {t(suggestion)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !title.trim()} onClick={() => void save()}>
              {saving ? t('Creando…') : t('Crear')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
