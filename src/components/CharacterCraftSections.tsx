import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character, CharacterAbility } from '@shared/types';
import { CHARACTER_ARC_FIELDS, CHARACTER_VOICE_FIELDS } from '@shared/characterLabels';
import { Icon } from './ui';
import { AutoSavingField } from './AutoSavingField';
import { confirm } from './feedback';
import { PERSON_DOSSIER_ADD_BUTTON_CLASS, PERSON_DOSSIER_SECTION_CLASS } from './personDossierLayout';
import { t } from '../i18n';

/**
 * The character's arc: want, need, flaw, the lie they believe, the wound it came from.
 *
 * Collapsed by default and entirely optional. It is the part of a sheet an author either
 * lives in or never opens, and forcing five empty boxes above the description would push
 * everything else off the screen for the second group.
 */
export function CharacterArcSection({
  character,
  onChanged,
}: {
  character: Character;
  onChanged: () => Promise<void>;
}) {
  const filled = CHARACTER_ARC_FIELDS.filter((field) => character.profile.arc[field.id]?.trim()).length;
  const [open, setOpen] = useState(filled > 0);

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-arc">
      <button
        className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {t('Arco')}
        {filled > 0 && <span className="text-neutral-600">({filled}/5)</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {CHARACTER_ARC_FIELDS.map((field) => (
            <AutoSavingField
              key={field.id}
              label={t(field.label)}
              hint={t(field.hint)}
              value={character.profile.arc[field.id]}
              placeholder={t(field.hint)}
              rows={2}
              onSave={async (next) => {
                // Patched field by field: sending the whole arc would let each blur wipe
                // the four boxes the author was not editing.
                await window.nodus.updateCharacter(character.personId, { arc: { [field.id]: next || null } });
                await onChanged();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * How the character sounds. The dialogue sample is the field that earns its place: it is
 * what the AI imitates when asked to write them, and — since Nodus already carries a
 * local TTS — it can be heard.
 */
export function CharacterVoiceSection({
  character,
  onChanged,
}: {
  character: Character;
  onChanged: () => Promise<void>;
}) {
  const filled = CHARACTER_VOICE_FIELDS.filter((field) => character.profile.voice[field.id]?.trim()).length;
  const [open, setOpen] = useState(filled > 0);
  const [speaking, setSpeaking] = useState(false);
  const sample = character.profile.voice.sample?.trim() ?? '';

  // The browser's own speech synthesis: no provider, no key, no cost. Nodus's TTS
  // pipeline is built for long narration jobs and would be a sledgehammer for two lines.
  const speak = () => {
    if (!sample || typeof window.speechSynthesis === 'undefined') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sample);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-voice">
      <button
        className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {t('Voz')}
        {filled > 0 && <span className="text-neutral-600">({filled}/3)</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {CHARACTER_VOICE_FIELDS.map((field) => (
            <AutoSavingField
              key={field.id}
              label={t(field.label)}
              hint={t(field.hint)}
              value={character.profile.voice[field.id]}
              placeholder={t(field.hint)}
              rows={field.id === 'sample' ? 3 : 2}
              onSave={async (next) => {
                await window.nodus.updateCharacter(character.personId, { voice: { [field.id]: next || null } });
                await onChanged();
              }}
            />
          ))}
          {sample && (
            <button
              className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs"
              onClick={() => (speaking ? (window.speechSynthesis.cancel(), setSpeaking(false)) : speak())}
            >
              <Icon name={speaking ? 'x' : 'volume'} size={12} />
              {speaking ? t('Parar') : t('Escuchar la muestra')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Abilities, each with a COST and a LIMIT. Both are prompted for explicitly because a
 * power with neither is a plot solvent: the limit is what makes it dramatic, and it is
 * the field an author skips unless the form asks.
 */
export function CharacterAbilitiesSection({ character }: { character: Character }) {
  const [abilities, setAbilities] = useState<CharacterAbility[]>([]);
  const [editing, setEditing] = useState<CharacterAbility | 'new' | null>(null);

  const load = useCallback(async () => {
    setAbilities(await window.nodus.listCharacterAbilities(character.personId));
  }, [character.personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (ability: CharacterAbility) => {
    const ok = await confirm({
      title: t('Eliminar habilidad'),
      message: t('¿Eliminar esta habilidad?'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteCharacterAbility(ability.abilityId);
    await load();
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-abilities">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Habilidades')} <span className="text-neutral-600">({abilities.length})</span>
        </h3>
        <button
          className={`${PERSON_DOSSIER_ADD_BUTTON_CLASS} ml-auto`}
          title={t('Añadir')}
          aria-label={t('Añadir habilidad')}
          onClick={() => setEditing('new')}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {abilities.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Sin habilidades registradas.')}</p>
      ) : (
        <ul className="space-y-2">
          {abilities.map((ability) => (
            <li key={ability.abilityId} className="rounded-md border border-neutral-800 p-2.5">
              <div className="flex items-start gap-2">
                <span className="flex-1 text-sm font-medium text-neutral-100">{ability.name}</span>
                <button
                  className="btn btn-ghost h-6 w-6 p-0 text-neutral-400 hover:text-neutral-200"
                  title={t('Editar')}
                  onClick={() => setEditing(ability)}
                >
                  <Icon name="edit" size={12} />
                </button>
                <button
                  className="btn btn-ghost h-6 w-6 p-0 text-red-300 hover:text-red-200"
                  title={t('Eliminar')}
                  onClick={() => void remove(ability)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
              {ability.description && (
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-neutral-400">{ability.description}</p>
              )}
              <dl className="mt-1.5 space-y-0.5">
                {ability.cost && (
                  <div className="flex gap-1.5 text-[11px]">
                    <dt className="shrink-0 uppercase tracking-wide text-amber-400/80">{t('Coste')}</dt>
                    <dd className="text-neutral-400">{ability.cost}</dd>
                  </div>
                )}
                {ability.limits ? (
                  <div className="flex gap-1.5 text-[11px]">
                    <dt className="shrink-0 uppercase tracking-wide text-indigo-400/80">{t('Límite')}</dt>
                    <dd className="text-neutral-400">{ability.limits}</dd>
                  </div>
                ) : (
                  <div className="text-[11px] text-neutral-600">
                    {t('Sin límite definido: una habilidad sin límite resuelve cualquier escena.')}
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AbilityForm
          personId={character.personId}
          ability={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function AbilityForm({
  personId,
  ability,
  onSaved,
  onCancel,
}: {
  personId: string;
  ability: CharacterAbility | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(ability?.name ?? '');
  const [description, setDescription] = useState(ability?.description ?? '');
  const [cost, setCost] = useState(ability?.cost ?? '');
  const [limits, setLimits] = useState(ability?.limits ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        cost: cost.trim() || null,
        limits: limits.trim() || null,
      };
      if (ability) await window.nodus.updateCharacterAbility(ability.abilityId, payload);
      else await window.nodus.addCharacterAbility(personId, payload);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <section
        className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ability-form-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="ability-form-title" className="text-base font-semibold text-neutral-100">
              {ability ? t('Editar habilidad') : t('Nueva habilidad')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('El límite es lo que hace interesante a un poder: sin él resuelve cualquier escena.')}
            </p>
          </div>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onCancel}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="space-y-3">
          <input
            className="input h-9 w-full text-sm"
            value={name}
            autoFocus
            placeholder={t('Nombre de la habilidad')}
            aria-label={t('Nombre de la habilidad')}
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            className="input min-h-16 w-full resize-y text-sm"
            value={description}
            placeholder={t('Qué hace')}
            aria-label={t('Qué hace')}
            onChange={(event) => setDescription(event.target.value)}
          />
          <textarea
            className="input min-h-16 w-full resize-y text-sm"
            value={cost}
            placeholder={t('Qué le cuesta usarla')}
            aria-label={t('Qué le cuesta usarla')}
            onChange={(event) => setCost(event.target.value)}
          />
          <textarea
            className="input min-h-16 w-full resize-y text-sm"
            value={limits}
            placeholder={t('Qué NO puede hacer con ella')}
            aria-label={t('Qué NO puede hacer con ella')}
            onChange={(event) => setLimits(event.target.value)}
          />
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? t('Guardando…') : t('Guardar')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
