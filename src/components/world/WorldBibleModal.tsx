import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorldBibleOptions, WorldEntryKind } from '@shared/types';
import { WORLD_ENTRY_KINDS, WORLD_ENTRY_KIND_LABEL } from '@shared/worldEncyclopedia';
import { Icon } from '../ui';
import { toast } from '../feedback';
import { t, tx } from '../../i18n';

/**
 * Export the encyclopedia as one document.
 *
 * The three switches default to OFF, and that is the whole safety model of this screen:
 * exporting is handing the file to somebody else, so a secret, a private note and a draft
 * the author never accepted must each be an explicit decision, not something you discover
 * after sending the file.
 */
export function WorldBibleModal({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<'md' | 'pdf'>('md');
  const [order, setOrder] = useState<'alpha' | 'category'>('alpha');
  const [kinds, setKinds] = useState<WorldEntryKind[]>([]);
  const [includeSpoilers, setIncludeSpoilers] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeProposals, setIncludeProposals] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const run = async () => {
    setSaving(true);
    try {
      const options: WorldBibleOptions = {
        format,
        order,
        kinds: kinds.length ? kinds : undefined,
        includeSpoilers,
        includeNotes,
        includeProposals,
        title: title.trim() || t('La biblia del mundo'),
      };
      const result = await window.nodus.exportWorldBible(options);
      if (result) {
        toast(tx('Guardado en {path}', { path: result.path }));
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleKind = (kind: WorldEntryKind) =>
    setKinds((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" data-testid="world-bible-modal">
        <div className="mb-4 flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-neutral-100">{t('Exportar la biblia del mundo')}</h3>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400" aria-label={t('Cerrar')} onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Título del documento')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Formato')}</span>
              <select
                className="input h-9 w-full text-sm"
                value={format}
                onChange={(event) => setFormat(event.target.value as 'md' | 'pdf')}
              >
                <option value="md">{t('Markdown')}</option>
                <option value="pdf">{t('PDF')}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Orden')}</span>
              <select
                className="input h-9 w-full text-sm"
                value={order}
                onChange={(event) => setOrder(event.target.value as 'alpha' | 'category')}
              >
                <option value="alpha">{t('Alfabético')}</option>
                <option value="category">{t('Por clase')}</option>
              </select>
            </label>
          </div>

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
              {t('Qué incluir (todo, si no eliges nada)')}
            </span>
            <div className="flex flex-wrap gap-1">
              {WORLD_ENTRY_KINDS.map((kind) => (
                <button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    kinds.includes(kind)
                      ? 'border-indigo-600 bg-indigo-600/20 text-indigo-200'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  {t(WORLD_ENTRY_KIND_LABEL[kind])}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 rounded-lg border border-neutral-800 p-2">
            {[
              { checked: includeSpoilers, set: setIncludeSpoilers, label: 'Incluir lo marcado como spoiler' },
              { checked: includeNotes, set: setIncludeNotes, label: 'Incluir tus notas privadas' },
              { checked: includeProposals, set: setIncludeProposals, label: 'Incluir propuestas de la IA sin aceptar' },
            ].map((option) => (
              <label key={option.label} className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={option.checked}
                  onChange={(event) => option.set(event.target.checked)}
                />
                {t(option.label)}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" data-testid="world-bible-export" disabled={saving} onClick={() => void run()}>
              {saving ? t('Exportando…') : t('Exportar')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
