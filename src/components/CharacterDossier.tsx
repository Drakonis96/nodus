import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Character,
  CharacterBiographyMode,
  CharacterEvent,
  CharacterLifeStatus,
  CharacterNarrativeRole,
  HistoricalEventType,
  Kin,
  Person,
} from '@shared/types';
import {
  CHARACTER_ACCENTS,
  CHARACTER_EVENT_TYPES,
  CHARACTER_EVENT_TYPE_LABEL,
  CHARACTER_LIFE_STATUSES,
  CHARACTER_LIFE_STATUS_LABEL,
  CHARACTER_NAME_KINDS,
  CHARACTER_NAME_KIND_LABEL,
  CHARACTER_ROLES,
  CHARACTER_ROLE_LABEL,
  characterEpithet,
} from '@shared/characterLabels';
import { EMPTY_CALENDAR, formatWorldDate, hasCalendar, type WorldCalendar } from '@shared/worldCalendar';
import { Icon } from './ui';
import { CharacterPortraitEditor } from './CharacterPortraitEditor';
import { AutoSavingField } from './AutoSavingField';
import { CharacterGallery } from './CharacterGallery';
import { CharacterAbilitiesSection, CharacterArcSection, CharacterVoiceSection } from './CharacterCraftSections';
import { CharacterChecksSection } from './CharacterChecksSection';
import { CharacterAffiliationsSection } from '../views/GroupsView';
import { CharacterAppearancesSection, CharacterSecretsSection } from '../views/ScenesView';
import { CharacterInterviewModal } from './CharacterInterviewModal';
import { MarkdownNotesEditor } from './MarkdownNotesEditor';
import { RelationsSection } from './RelationsSection';
import { KinshipEditor } from './KinshipEditor';
import {
  PERSON_DOSSIER_ACTION_BUTTON_CLASS,
  PERSON_DOSSIER_ADD_BUTTON_CLASS,
  PERSON_DOSSIER_SECTION_CLASS,
} from './personDossierLayout';
import { confirm } from './feedback';
import { characterSubtitle } from '../views/CharactersView';
import { t, tx } from '../i18n';

/**
 * A character's full sheet.
 *
 * It reuses the person-dossier furniture (sections, kinship editor, relations, notes)
 * because a character IS a person row underneath, but it deliberately drops the
 * genealogy surfaces that assume a documentary source of truth: identity-merge
 * suggestions, evidence-driven kinship proposals, conflicting-facts detection, linked
 * documents and cited evidence. In fiction the author IS the source, so there is
 * nothing to corroborate and nothing to reconcile.
 */
export function CharacterDossier({
  character,
  onChanged,
  onBack,
}: {
  character: Character;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<CharacterEvent[]>([]);
  const [kin, setKin] = useState<Kin | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [editingBasics, setEditingBasics] = useState(false);
  const [interviewing, setInterviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    void window.nodus.listCharacterEvents(character.personId).then(setEvents);
    void window.nodus.kinOf(character.personId).then(setKin);
    void window.nodus.listPersons().then(setPersons);
  }, [character.personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar personaje'),
      message: t('¿Eliminar este personaje y su ficha? Los eventos en que participa se conservan.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteCharacter(character.personId);
    onBack();
    await onChanged();
  };

  // Secrets and private notes are left out: exporting is handing the sheet to someone
  // else, and a secret alias is a plot device, not a field.
  const exportSheet = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const saved = await window.nodus.exportCharacterSheet(character.personId);
      if (saved) setExportMessage(tx('Ficha guardada en {path}', { path: saved }));
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const epithet = characterEpithet(character.names);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <CharacterPortraitEditor character={character} onChanged={onChanged} />
        <div className="min-w-0 flex-1">
          <button
            className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
            onClick={onBack}
          >
            <Icon name="chevronLeft" size={13} /> {t('Volver a los personajes')}
          </button>
          <h2 className="text-xl font-semibold">{character.displayName}</h2>
          {epithet && <p className="text-sm italic text-indigo-300">{epithet}</p>}
          <p className="text-sm text-neutral-400">{characterSubtitle(character)}</p>
        </div>
        <button
          className="btn btn-ghost h-8 w-8 p-0 text-neutral-300"
          title={t('Exportar la ficha a Markdown')}
          aria-label={t('Exportar la ficha a Markdown')}
          disabled={exporting}
          onClick={() => void exportSheet()}
        >
          <Icon name={exporting ? 'sync' : 'download'} size={15} className={exporting ? 'animate-spin' : undefined} />
        </button>
        <button
          className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 px-2.5 text-xs"
          title={t('Hablar con el personaje en su propia voz')}
          onClick={() => setInterviewing(true)}
        >
          <Icon name="chat" size={13} /> {t('Entrevistar')}
        </button>
        <button
          className={`btn h-8 w-8 p-0 ${editingBasics ? 'border border-indigo-600 bg-indigo-900/30 text-indigo-200' : 'btn-ghost text-neutral-300'}`}
          title={t('Editar datos')}
          onClick={() => setEditingBasics((value) => !value)}
        >
          <Icon name="edit" size={15} />
        </button>
        <button
          className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200"
          title={t('Eliminar personaje')}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      {exportMessage && (
        <p className="text-xs text-neutral-400">
          {exportMessage}{' '}
          <span className="text-neutral-600">{t('(sin los nombres secretos ni tus notas privadas)')}</span>
        </p>
      )}

      {editingBasics && (
        <CharacterBasicsEditor
          character={character}
          onClose={() => setEditingBasics(false)}
          onSaved={async () => {
            setEditingBasics(false);
            await onChanged();
          }}
        />
      )}

      <CharacterChecksSection character={character} events={events} />

      <DescriptionSection character={character} onChanged={onChanged} />

      <CharacterGallery character={character} onChanged={onChanged} />

      <BiographySection character={character} onChanged={onChanged} />

      <AliasesSection character={character} onChanged={onChanged} />

      <CharacterArcSection character={character} onChanged={onChanged} />

      <CharacterVoiceSection character={character} onChanged={onChanged} />

      <CharacterAbilitiesSection character={character} />

      <CharacterAffiliationsSection personId={character.personId} />

      <CharacterSecretsSection personId={character.personId} />

      <CharacterAppearancesSection personId={character.personId} />

      <EventsSection
        personId={character.personId}
        events={events}
        onChanged={async () => {
          await load();
        }}
      />

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-kinship">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Parentesco')}</h3>
        {kin && kin.parents.length + kin.spouses.length + kin.children.length + kin.siblings.length > 0 ? (
          <div className="space-y-1.5 text-sm">
            <KinRow label={t('Progenitores')} people={kin.parents} />
            <KinRow label={t('Parejas')} people={kin.spouses} />
            <KinRow label={t('Descendencia')} people={kin.children} />
            <KinRow label={t('Hermanos')} people={kin.siblings} />
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('Sin parentesco por ahora')}</p>
        )}
      </section>

      <KinshipEditor
        person={character}
        persons={persons}
        onChanged={async () => {
          await load();
          await onChanged();
        }}
      />

      <RelationsSection personId={character.personId} showValence />

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-notes">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Notas')}</h3>
        <MarkdownNotesEditor
          value={character.notes}
          placeholder={t('Notas libres sobre este personaje, en Markdown…')}
          onSave={async (next) => {
            await window.nodus.updateCharacter(character.personId, { notes: next || null });
            await onChanged();
          }}
        />
      </section>

      {interviewing && <CharacterInterviewModal character={character} onClose={() => setInterviewing(false)} />}
    </div>
  );
}

/**
 * The biographical description, split in three. One blob would be simpler, but the
 * image prompt is built from the appearance alone: feeding it the personality and the
 * backstory as well makes the model paint the mood instead of the character.
 */
function DescriptionSection({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const [seedOpen, setSeedOpen] = useState(Boolean(character.profile.visualSeed));

  const saveField = async (patch: Parameters<typeof window.nodus.updateCharacter>[1]) => {
    await window.nodus.updateCharacter(character.personId, patch);
    await onChanged();
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-description">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción')}</h3>
      <div className="space-y-3">
        <AutoSavingField
          label={t('Apariencia')}
          hint={t('Lo que se ve. Es lo único que alimenta la generación de imágenes.')}
          value={character.profile.appearance}
          placeholder={t('Rasgos, complexión, ropa, marcas distintivas…')}
          onSave={(next) => saveField({ appearance: next || null })}
        />
        <AutoSavingField
          label={t('Personalidad')}
          hint={t('Cómo es y cómo habla.')}
          value={character.profile.personality}
          placeholder={t('Carácter, motivaciones, miedos, forma de hablar…')}
          onSave={(next) => saveField({ personality: next || null })}
        />
        <AutoSavingField
          label={t('Trasfondo')}
          hint={t('De dónde viene y qué le ha pasado.')}
          value={character.profile.backstory}
          placeholder={t('Origen, historia previa, cómo llega al punto en que empieza el relato…')}
          onSave={(next) => saveField({ backstory: next || null })}
        />
      </div>

      <div className="mt-3 border-t border-neutral-800 pt-3">
        <button
          className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
          onClick={() => setSeedOpen((value) => !value)}
        >
          <Icon name={seedOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          {t('Semilla visual')}
          {character.profile.visualSeed && !seedOpen && <Icon name="check" size={11} className="text-indigo-400" />}
        </button>
        {seedOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-4 text-neutral-500">
              {t('Un texto corto y estable que se añade a TODAS las imágenes que generes de este personaje. Es lo que consigue que se parezca a sí mismo de una imagen a otra, así que conviene cambiarlo lo menos posible.')}
            </p>
            <AutoSavingField
              label={t('Semilla visual')}
              hideLabel
              value={character.profile.visualSeed}
              placeholder={t('p. ej. «semielfo de rasgos afilados, pelo negro recogido, ojos ámbar»')}
              onSave={(next) => saveField({ visualSeed: next || null })}
            />
            {character.profile.appearance && (
              <button
                className="btn btn-ghost h-7 border border-neutral-700 text-[11px]"
                onClick={() => void saveField({ visualSeed: character.profile.appearance })}
              >
                {t('Usar la apariencia como semilla')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The AI biography, in two modes.
 *
 * `faithful` retells the sheet and writes straight into the accepted biography.
 * `propose` may invent, so its output lands in a separate, clearly-labelled block that
 * the author accepts or discards. Nothing the model made up can become canon by
 * accident — which is the whole reason the two are not one button.
 */
function BiographySection({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<CharacterBiographyMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const generate = async (mode: CharacterBiographyMode) => {
    setBusy(mode);
    setMessage(null);
    try {
      const result = await window.nodus.generateCharacterBiography(character.personId, mode);
      if (result.noMaterial) {
        setMessage(t('Rellena al menos la descripción, un evento o un vínculo antes de generar la biografía.'));
      }
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const proposal = character.profile.biographyProposed;

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-biography">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Biografía')}</h3>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            className={PERSON_DOSSIER_ACTION_BUTTON_CLASS}
            title={t('Solo cuenta lo que ya está en la ficha')}
            disabled={busy !== null}
            onClick={() => void generate('faithful')}
          >
            <Icon name="wand" size={13} />
            {busy === 'faithful' ? t('Generando…') : character.biography ? t('Regenerar') : t('Generar biografía')}
          </button>
          <button
            className={PERSON_DOSSIER_ACTION_BUTTON_CLASS}
            title={t('Rellena los huecos y marca entre corchetes lo que ha inventado')}
            disabled={busy !== null}
            onClick={() => void generate('propose')}
          >
            <Icon name="bulb" size={13} />
            {busy === 'propose' ? t('Proponiendo…') : t('Proponer')}
          </button>
        </div>
      </div>

      {character.biography ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{character.biography}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
            <Icon name="wand" size={10} /> {t('Generada con IA')}
            {character.biographyAt ? ` · ${new Date(character.biographyAt).toLocaleDateString()}` : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500">
          {t('Redacta una biografía narrativa a partir de la ficha: su descripción, sus eventos y sus vínculos.')}
        </p>
      )}

      {proposal && (
        <div
          data-testid="character-biography-proposal"
          className="mt-3 rounded-md border border-dashed border-indigo-700/70 bg-indigo-950/20 p-3"
        >
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
            <Icon name="bulb" size={11} /> {t('Propuesta sin aceptar')}
          </h4>
          <p className="mb-2 text-[10px] leading-4 text-neutral-500">
            {t('Lo que va entre corchetes lo ha inventado la IA. No es canon hasta que lo aceptes.')}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-200">{proposal}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn btn-primary h-7 text-xs"
              onClick={async () => {
                await window.nodus.acceptProposedBiography(character.personId);
                await onChanged();
              }}
            >
              {t('Aceptar como canon')}
            </button>
            <button
              className="btn btn-ghost h-7 border border-neutral-700 text-xs text-neutral-400"
              onClick={async () => {
                await window.nodus.discardProposedBiography(character.personId);
                await onChanged();
              }}
            >
              {t('Descartar')}
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
    </section>
  );
}

/**
 * Typed aliases: a name is rarely just one name in fiction, and some of them are
 * secrets. A secret alias is marked here and deliberately kept OFF the card grid — the
 * name only three people in the story know should not be the label on the front of the
 * character's card.
 */
function AliasesSection({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [value, setValue] = useState('');
  const [kind, setKind] = useState(CHARACTER_NAME_KINDS[0].id);
  const [secret, setSecret] = useState(false);
  const [knownBy, setKnownBy] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const name = value.trim();
    if (!name) return;
    setSaving(true);
    try {
      await window.nodus.setCharacterName(character.personId, name, kind, secret, knownBy.trim() || null);
      setValue('');
      setKnownBy('');
      setSecret(false);
      setModalOpen(false);
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    // The display name is the character's identity, not an alias: removing it here would
    // leave the sheet titled by a name nothing points at.
    if (name === character.displayName) return;
    await window.nodus.deleteCharacterName(character.personId, name);
    await onChanged();
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-aliases">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Nombres y alias')}</h3>
        <button
          className={`${PERSON_DOSSIER_ADD_BUTTON_CLASS} ml-auto`}
          title={t('Añadir')}
          aria-label={t('Añadir alias')}
          onClick={() => {
            setValue('');
            setKnownBy('');
            setSecret(false);
            setModalOpen(true);
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {character.names.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {character.names.map((entry) => (
            <li
              key={entry.name}
              className={`group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                entry.secret
                  ? 'border border-dashed border-indigo-700/70 bg-indigo-950/30 text-indigo-200'
                  : 'bg-neutral-800 text-neutral-300'
              }`}
              title={entry.secret ? (entry.knownBy ? tx('Secreto · lo conocen: {who}', { who: entry.knownBy }) : t('Secreto')) : undefined}
            >
              {entry.secret && <Icon name="lock" size={10} className="opacity-80" />}
              <span>{entry.name}</span>
              {entry.kind ? (
                <span className="opacity-60">· {t(CHARACTER_NAME_KIND_LABEL[entry.kind] ?? entry.kind)}</span>
              ) : null}
              {entry.name !== character.displayName && (
                <button
                  className="opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                  title={t('Quitar')}
                  aria-label={tx('Quitar {name}', { name: entry.name })}
                  onClick={() => void remove(entry.name)}
                >
                  <Icon name="x" size={10} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">{t('Sin nombres alternativos.')}</p>
      )}
      {character.names.some((entry) => entry.secret) && (
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          {t('Los nombres secretos no aparecen en la cuadrícula de personajes.')}
        </p>
      )}
      {modalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) setModalOpen(false);
            }}
          >
            <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="alias-modal-title">
              <div className="mb-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 id="alias-modal-title" className="text-base font-semibold text-neutral-100">
                    {t('Nuevo nombre o alias')}
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    {t('Un nombre verdadero, un título, un apodo o cómo le llaman en otra lengua.')}
                  </p>
                </div>
                <button
                  className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
                  aria-label={t('Cerrar')}
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  <Icon name="x" size={15} />
                </button>
              </div>
              <div className="space-y-3">
                <input
                  className="input h-9 w-full text-sm"
                  value={value}
                  autoFocus
                  placeholder={t('El nombre…')}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void add()}
                />
                <select
                  className="input h-9 w-full text-sm"
                  value={kind}
                  aria-label={t('Tipo de nombre')}
                  onChange={(event) => setKind(event.target.value)}
                >
                  {CHARACTER_NAME_KINDS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {t(entry.label)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                  <input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} />
                  {t('Es un secreto')}
                </label>
                {secret && (
                  <input
                    className="input h-9 w-full text-sm"
                    value={knownBy}
                    placeholder={t('Quién lo conoce (p. ej. «solo su hermana y el archivero»)')}
                    aria-label={t('Quién lo conoce (p. ej. «solo su hermana y el archivero»)')}
                    onChange={(event) => setKnownBy(event.target.value)}
                  />
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-neutral-800 pt-3">
                <button
                  className="btn btn-ghost border border-neutral-700 px-3 text-xs"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  {t('Cancelar')}
                </button>
                <button className="btn btn-primary min-w-32" disabled={saving || !value.trim()} onClick={() => void add()}>
                  {saving ? t('Guardando…') : t('Guardar')}
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}
    </section>
  );
}

/**
 * Life events, ordered by the world's own calendar. The date stays free text — an
 * invented calendar has no ISO form — and the integer beside it is what actually
 * orders the list.
 */
function EventsSection({
  personId,
  events,
  onChanged,
}: {
  personId: string;
  events: CharacterEvent[];
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CharacterEvent | null>(null);

  const removeEvent = async (eventId: string) => {
    const ok = await confirm({
      title: t('Eliminar evento'),
      message: t('¿Eliminar este evento?'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteEvent(eventId);
    await onChanged();
  };

  const unplaced = events.filter((event) => event.worldYear == null).length;

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-events">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Hechos de su vida')} <span className="text-neutral-600">({events.length})</span>
        </h3>
        <button
          className={`${PERSON_DOSSIER_ADD_BUTTON_CLASS} ml-auto`}
          title={t('Añadir')}
          aria-label={t('Añadir hecho')}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Sin hechos registrados.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li key={event.eventId} className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm">
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-indigo-300">
                {event.worldYear ?? '—'}
              </span>
              <span className="font-medium text-neutral-200">
                {t(CHARACTER_EVENT_TYPE_LABEL[event.type] ?? event.type)}
              </span>
              {event.date ? <span className="truncate text-neutral-400">· {event.date}</span> : null}
              {event.placeName ? <span className="truncate text-neutral-500">· {event.placeName}</span> : null}
              <div className="ml-auto flex shrink-0 gap-0.5">
                <button
                  className="btn btn-ghost h-7 w-7 p-0 text-neutral-400 hover:text-neutral-200"
                  title={t('Editar')}
                  onClick={() => setEditing(event)}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="btn btn-ghost h-7 w-7 p-0 text-red-300 hover:text-red-200"
                  title={t('Eliminar')}
                  onClick={() => void removeEvent(event.eventId)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {unplaced > 0 && (
        <p className="mt-2 text-[11px] text-neutral-500">
          {tx('{n} sin año del mundo: aparecen al final hasta que les pongas uno.', { n: String(unplaced) })}
        </p>
      )}

      {(adding || editing) && (
        <CharacterEventForm
          personId={personId}
          event={editing}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

function CharacterEventForm({
  personId,
  event,
  onSaved,
  onCancel,
}: {
  personId: string;
  event: CharacterEvent | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<HistoricalEventType>(event?.type ?? 'first_appearance');
  const [date, setDate] = useState(event?.date ?? '');
  const [worldYear, setWorldYear] = useState(event?.worldYear != null ? String(event.worldYear) : '');
  const [calendar, setCalendar] = useState<WorldCalendar>(EMPTY_CALENDAR);
  const [eraId, setEraId] = useState(event?.eraId ?? '');
  const [monthIndex, setMonthIndex] = useState(event?.monthIndex != null ? String(event.monthIndex) : '');
  const [day, setDay] = useState(event?.day != null ? String(event.day) : '');

  useEffect(() => {
    let active = true;
    void window.nodus.getWorldCalendar().then((next) => {
      if (!active) return;
      setCalendar(next);
      // Default to the only era there is, so a one-era world never has to pick.
      if (!event?.eraId && next.eras.length === 1) setEraId(next.eras[0].eraId);
    });
    return () => {
      active = false;
    };
  }, [event?.eraId]);

  const calendarDefined = hasCalendar(calendar);
  const [worldOrder, setWorldOrder] = useState(String(event?.worldOrder ?? 0));
  const [place, setPlace] = useState(event?.placeName ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      let placeId: string | null = event?.placeId ?? null;
      const placeName = place.trim();
      if (placeName) {
        placeId = (await window.nodus.findOrCreatePlace(placeName)).placeId;
      } else {
        placeId = null;
      }
      const eventId = event
        ? (await window.nodus.updateEvent(event.eventId, {
            type,
            date: date.trim() || null,
            placeId,
            notes: notes.trim() || null,
          }))?.eventId ?? event.eventId
        : (
            await window.nodus.createEvent({
              type,
              date: date.trim() || null,
              placeId,
              notes: notes.trim() || null,
              participants: [{ personId, role: 'principal' }],
            })
          ).eventId;
      const parsedYear = worldYear.trim() === '' ? null : Number.parseInt(worldYear, 10);
      const parsedOrder = Number.parseInt(worldOrder, 10);
      const year = Number.isNaN(parsedYear as number) ? null : parsedYear;
      if (calendarDefined) {
        // The structured write also stores the derived absolute day, which is what orders
        // events WITHIN a year; the plain call below only knows about the year.
        await window.nodus.setEventWorldDate(
          eventId,
          {
            eraId: eraId || null,
            year,
            monthIndex: monthIndex === '' ? null : Number.parseInt(monthIndex, 10),
            day: day.trim() === '' ? null : Number.parseInt(day, 10),
          },
          Number.isNaN(parsedOrder) ? 0 : parsedOrder
        );
      } else {
        await window.nodus.setCharacterEventWorldDate(
          eventId,
          year,
          Number.isNaN(parsedOrder) ? 0 : parsedOrder
        );
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget && !saving) onCancel();
      }}
    >
      <section
        className="card-modal max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-event-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="character-event-title" className="text-base font-semibold text-neutral-100">
              {event ? t('Editar hecho') : t('Nuevo hecho')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('La fecha se escribe como quieras; el año del mundo es lo que ordena la lista.')}
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
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input h-9 text-sm"
              value={type}
              aria-label={t('Tipo de hecho')}
              onChange={(changeEvent) => setType(changeEvent.target.value as HistoricalEventType)}
            >
              {CHARACTER_EVENT_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(CHARACTER_EVENT_TYPE_LABEL[entry] ?? entry)}
                </option>
              ))}
            </select>
            <input
              className="input h-9 text-sm"
              value={date}
              placeholder={t('Fecha en tu calendario')}
              aria-label={t('Fecha en tu calendario')}
              onChange={(changeEvent) => setDate(changeEvent.target.value)}
            />
          </div>
          {calendarDefined && (
            <div className="grid grid-cols-3 gap-2 rounded-md border border-indigo-900/40 bg-indigo-950/10 p-2">
              {calendar.eras.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Era')}</span>
                  <select
                    className="input h-8 w-full text-xs"
                    value={eraId}
                    onChange={(changeEvent) => setEraId(changeEvent.target.value)}
                  >
                    <option value="">{t('Sin era')}</option>
                    {calendar.eras.map((era) => (
                      <option key={era.eraId} value={era.eraId}>
                        {era.abbreviation?.trim() || era.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Mes')}</span>
                <select
                  className="input h-8 w-full text-xs"
                  value={monthIndex}
                  onChange={(changeEvent) => setMonthIndex(changeEvent.target.value)}
                >
                  <option value="">{t('Sin mes')}</option>
                  {calendar.months.map((month, index) => (
                    <option key={month.monthId || index} value={String(index)}>
                      {month.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Día')}</span>
                <input
                  className="input h-8 w-full text-xs"
                  type="number"
                  min={1}
                  value={day}
                  disabled={monthIndex === ''}
                  onChange={(changeEvent) => setDay(changeEvent.target.value)}
                />
              </label>
              <button
                type="button"
                className="col-span-3 text-left text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
                disabled={worldYear.trim() === ''}
                onClick={() =>
                  setDate(
                    formatWorldDate(calendar, {
                      eraId: eraId || null,
                      year: Number.parseInt(worldYear, 10),
                      monthIndex: monthIndex === '' ? null : Number.parseInt(monthIndex, 10),
                      day: day.trim() === '' ? null : Number.parseInt(day, 10),
                    })
                  )
                }
              >
                {t('Escribir la fecha legible a partir de esto')}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {t('Año del mundo')}
              </span>
              <input
                className="input h-9 w-full text-sm"
                type="number"
                value={worldYear}
                placeholder={t('p. ej. 1204 (admite negativos)')}
                onChange={(changeEvent) => setWorldYear(changeEvent.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {t('Orden dentro del año')}
              </span>
              <input
                className="input h-9 w-full text-sm"
                type="number"
                value={worldOrder}
                onChange={(changeEvent) => setWorldOrder(changeEvent.target.value)}
              />
            </label>
          </div>
          <input
            className="input h-9 w-full text-sm"
            value={place}
            placeholder={t('Lugar')}
            aria-label={t('Lugar')}
            onChange={(changeEvent) => setPlace(changeEvent.target.value)}
          />
          <textarea
            className="input min-h-20 w-full resize-y text-sm"
            value={notes}
            placeholder={t('Notas')}
            aria-label={t('Notas')}
            onChange={(changeEvent) => setNotes(changeEvent.target.value)}
          />
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onCancel} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving} onClick={() => void save()}>
              {saving ? t('Guardando…') : event ? t('Guardar cambios') : t('Guardar hecho')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

/** The character's core fields, written straight through. */
function CharacterBasicsEditor({
  character,
  onSaved,
  onClose,
}: {
  character: Character;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { profile } = character;
  const [displayName, setDisplayName] = useState(character.displayName);
  const [species, setSpecies] = useState(profile.species ?? '');
  const [gender, setGender] = useState(profile.gender ?? '');
  const [pronouns, setPronouns] = useState(profile.pronouns ?? '');
  const [lifeStatus, setLifeStatus] = useState<CharacterLifeStatus>(profile.lifeStatus);
  const [narrativeRole, setNarrativeRole] = useState<CharacterNarrativeRole | ''>(profile.narrativeRole ?? '');
  const [accent, setAccent] = useState(profile.accent ?? '');
  const [birthDate, setBirthDate] = useState(character.birthDate ?? '');
  const [deathDate, setDeathDate] = useState(character.deathDate ?? '');
  const [birthYear, setBirthYear] = useState(profile.birthYearSort != null ? String(profile.birthYearSort) : '');
  const [deathYear, setDeathYear] = useState(profile.deathYearSort != null ? String(profile.deathYearSort) : '');
  const [saving, setSaving] = useState(false);

  const parseYear = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const save = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await window.nodus.updateCharacter(character.personId, {
        displayName: displayName.trim(),
        species: species.trim() || null,
        gender: gender.trim() || null,
        pronouns: pronouns.trim() || null,
        lifeStatus,
        narrativeRole: narrativeRole || null,
        accent: accent || null,
        birthDate: birthDate.trim() || null,
        deathDate: deathDate.trim() || null,
        birthYearSort: parseYear(birthYear),
        deathYearSort: parseYear(deathYear),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <input
        className="input h-8 w-full text-sm"
        value={displayName}
        placeholder={t('Nombre')}
        aria-label={t('Nombre')}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          className="input h-8 text-sm"
          value={species}
          placeholder={t('Especie')}
          aria-label={t('Especie')}
          onChange={(event) => setSpecies(event.target.value)}
        />
        <input
          className="input h-8 text-sm"
          value={gender}
          placeholder={t('Género')}
          aria-label={t('Género')}
          onChange={(event) => setGender(event.target.value)}
        />
        <input
          className="input h-8 text-sm"
          value={pronouns}
          placeholder={t('Pronombres')}
          aria-label={t('Pronombres')}
          onChange={(event) => setPronouns(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="input h-8 text-sm"
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
          className="input h-8 text-sm"
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
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input h-8 text-sm"
          value={birthDate}
          placeholder={t('Nacimiento (texto libre)')}
          aria-label={t('Nacimiento (texto libre)')}
          onChange={(event) => setBirthDate(event.target.value)}
        />
        <input
          className="input h-8 text-sm"
          value={deathDate}
          placeholder={t('Muerte (texto libre)')}
          aria-label={t('Muerte (texto libre)')}
          onChange={(event) => setDeathDate(event.target.value)}
        />
        <input
          className="input h-8 text-sm"
          type="number"
          value={birthYear}
          placeholder={t('Año del mundo · nacimiento')}
          aria-label={t('Año del mundo · nacimiento')}
          onChange={(event) => setBirthYear(event.target.value)}
        />
        <input
          className="input h-8 text-sm"
          type="number"
          value={deathYear}
          placeholder={t('Año del mundo · muerte')}
          aria-label={t('Año del mundo · muerte')}
          onChange={(event) => setDeathYear(event.target.value)}
        />
      </div>
      <p className="text-[11px] text-neutral-500">
        {t('La fecha se muestra tal como la escribas. El año del mundo es un entero y sirve solo para ordenar.')}
      </p>
      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {t('Color de etiqueta')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            title={t('Sin color')}
            aria-label={t('Sin color')}
            aria-pressed={accent === ''}
            onClick={() => setAccent('')}
            className={`h-6 w-6 rounded-full border text-neutral-500 ${
              accent === '' ? 'border-indigo-500 ring-1 ring-indigo-500/40' : 'border-neutral-700'
            }`}
          >
            <Icon name="x" size={11} className="mx-auto" />
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
              className={`h-6 w-6 rounded-full border ${
                accent === entry.id ? 'border-neutral-100 ring-1 ring-neutral-100/50' : 'border-transparent'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 flex-1 text-xs" disabled={saving || !displayName.trim()} onClick={() => void save()}>
          {saving ? t('Guardando…') : t('Guardar')}
        </button>
        <button className="btn btn-ghost h-8 border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}

function KinRow({ label, people }: { label: string; people: Person[] }) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs text-neutral-500">{label}:</span>
      {people.map((person) => (
        <span key={person.personId} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">
          {person.displayName}
        </span>
      ))}
    </div>
  );
}
