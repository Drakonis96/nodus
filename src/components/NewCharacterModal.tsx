import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterLifeStatus, CharacterNarrativeRole } from '@shared/types';
import {
  CHARACTER_ACCENTS,
  CHARACTER_LIFE_STATUSES,
  CHARACTER_LIFE_STATUS_LABEL,
  CHARACTER_ROLES,
  CHARACTER_ROLE_LABEL,
} from '@shared/characterLabels';
import { CHARACTER_TEMPLATES, characterTemplate } from '@shared/characterTemplates';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Create a character with just enough to exist: a name, and optionally who they are
 * and where they sit in the story. Everything else — the description, the aliases, the
 * events, the relations — belongs on the sheet, which opens right after saving.
 */
export function NewCharacterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (personId: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [epithet, setEpithet] = useState('');
  const [species, setSpecies] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [lifeStatus, setLifeStatus] = useState<CharacterLifeStatus>('unknown');
  const [narrativeRole, setNarrativeRole] = useState<CharacterNarrativeRole | ''>('');
  const [accent, setAccent] = useState<string>('');
  const [templateId, setTemplateId] = useState('blank');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      // A template only nudges the role and the tag colour. It writes no prose: see
      // characterTemplates.ts for why pre-filled text is worse than an empty box.
      const template = characterTemplate(templateId);
      const created = await window.nodus.createCharacter({
        displayName: trimmed,
        species: species.trim() || null,
        pronouns: pronouns.trim() || null,
        lifeStatus,
        narrativeRole: narrativeRole || template?.narrativeRole || null,
        accent: accent || template?.accent || null,
        names: [
          { name: trimmed, kind: null },
          ...(epithet.trim() ? [{ name: epithet.trim(), kind: 'epithet' }] : []),
        ],
      });
      await onCreated(created.personId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      <section
        className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-character-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="new-character-title" className="text-base font-semibold text-neutral-100">
              {t('Nuevo personaje')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('Con el nombre basta para empezar. El resto de la ficha se rellena después.')}
            </p>
          </div>
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
            placeholder={t('Nombre')}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Epíteto o título (opcional)')}
            aria-label={t('Epíteto o título (opcional)')}
            value={epithet}
            onChange={(event) => setEpithet(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input h-9 text-sm"
              placeholder={t('Especie')}
              aria-label={t('Especie')}
              value={species}
              onChange={(event) => setSpecies(event.target.value)}
            />
            <input
              className="input h-9 text-sm"
              placeholder={t('Pronombres')}
              aria-label={t('Pronombres')}
              value={pronouns}
              onChange={(event) => setPronouns(event.target.value)}
            />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('Plantilla')}
            </span>
            <select
              className="input h-9 w-full text-sm"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {CHARACTER_TEMPLATES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] leading-4 text-neutral-600">
              {t(characterTemplate(templateId)?.description ?? '')}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input h-9 text-sm"
              value={lifeStatus}
              aria-label={t('Estado')}
              onChange={(event) => setLifeStatus(event.target.value as CharacterLifeStatus)}
            >
              {CHARACTER_LIFE_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(CHARACTER_LIFE_STATUS_LABEL[entry])}
                </option>
              ))}
            </select>
            <select
              className="input h-9 text-sm"
              value={narrativeRole}
              aria-label={t('Rol narrativo')}
              onChange={(event) => setNarrativeRole(event.target.value as CharacterNarrativeRole | '')}
            >
              <option value="">{t('Sin rol asignado')}</option>
              {CHARACTER_ROLES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(CHARACTER_ROLE_LABEL[entry])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t('Color de etiqueta')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                title={t('Sin color')}
                aria-label={t('Sin color')}
                aria-pressed={accent === ''}
                onClick={() => setAccent('')}
                className={`h-7 w-7 rounded-full border text-neutral-500 ${
                  accent === '' ? 'border-indigo-500 ring-1 ring-indigo-500/40' : 'border-neutral-700'
                }`}
              >
                <Icon name="x" size={12} className="mx-auto" />
              </button>
              {CHARACTER_ACCENTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={t(entry.label)}
                  aria-label={t(entry.label)}
                  aria-pressed={accent === entry.id}
                  onClick={() => setAccent(entry.id)}
                  style={{ backgroundColor: entry.hex }}
                  className={`h-7 w-7 rounded-full border ${
                    accent === entry.id ? 'border-neutral-100 ring-1 ring-neutral-100/50' : 'border-transparent'
                  }`}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? t('Creando…') : t('Crear personaje')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
