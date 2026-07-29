import { useEffect, useMemo, useState } from 'react';
import type { InterviewKind, TestimonyInterview, TestimonyParticipantRow } from '@shared/types';
import { INTERVIEW_KINDS, proposeInterviewTitle, validateNewInterview } from '@shared/testimonies';
import { INTERVIEW_KIND_LABEL } from '@shared/testimonyLabels';
import { Icon, ModalBackdrop } from '../ui';
import { ParticipantPicker } from './ParticipantPicker';
import { t } from '../../i18n';

/**
 * Crear una entrevista: UN MODAL PEQUEÑO, no un asistente.
 *
 * Solo el título y el estado son obligatorios. Todo lo demás — el audio, la
 * transcripción, el acuerdo, la guía, el contexto — se hace después, en el dossier, que
 * es una vista amplia y persistente. La razón es concreta: un formulario de creación con
 * veinte campos hace que el investigador aplace registrar la entrevista hasta «tenerlo
 * todo», y la entrevista que se aplaza es la que acaba fuera del sistema.
 *
 * El título se PROPONE a partir del narrador y la fecha, pero se puede escribir encima:
 * proponer ahorra el 90 % de los casos sin quitarle el nombre a nadie.
 */
export function NewInterviewModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (interview: TestimonyInterview) => void;
}) {
  const [people, setPeople] = useState<TestimonyParticipantRow[]>([]);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [kind, setKind] = useState<InterviewKind>('thematic');
  const [status, setStatus] = useState<'preparation' | 'scheduled'>('preparation');
  const [narratorIds, setNarratorIds] = useState<string[]>([]);
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [language, setLanguage] = useState('');
  const [collection, setCollection] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadPeople = async (): Promise<void> => {
    setPeople(await window.nodus.listTestimonyParticipants(''));
  };

  useEffect(() => {
    void reloadPeople();
    void window.nodus.testimonyInterviewFacets().then((facets) => setCollections(facets.collections));
    void window.nodus.getSettings().then((settings) => {
      setLanguage(settings.testimonyDefaultLanguage ?? '');
    });
  }, []);

  const narratorName = useMemo(() => {
    const first = people.find((person) => person.personId === narratorIds[0]);
    return first?.publicName?.trim() || first?.workingName || '';
  }, [people, narratorIds]);

  // La propuesta deja de aplicarse en cuanto el usuario escribe: sobrescribir lo que
  // alguien acaba de teclear es la forma más rápida de que desconfíe del formulario.
  useEffect(() => {
    if (titleTouched) return;
    setTitle(proposeInterviewTitle(narratorName, scheduledAt || null));
  }, [narratorName, scheduledAt, titleTouched]);

  const submit = async (): Promise<void> => {
    const input = {
      title,
      interviewKind: kind,
      workflowStatus: status,
      narratorIds,
      interviewerIds,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      language: language.trim() || null,
      collectionLabel: collection.trim() || null,
    };
    const invalid = validateNewInterview(input);
    if (invalid) {
      setError(t(invalid));
      return;
    }
    setSaving(true);
    try {
      const created = await window.nodus.createTestimonyInterview(input);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
        data-testid="testimony-new-interview-modal"
      >
        <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <Icon name="microphone" size={18} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Nueva entrevista')}</h2>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Título')}</span>
            <input
              autoFocus
              data-testid="testimony-new-interview-title"
              className="input w-full"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }}
              placeholder={t('Entrevista a…')}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Estado inicial')}</span>
              <select className="input w-full" value={status} onChange={(event) => setStatus(event.target.value as 'preparation' | 'scheduled')}>
                <option value="preparation">{t('Preparación')}</option>
                <option value="scheduled">{t('Programada')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Tipo')}</span>
              <select className="input w-full" value={kind} onChange={(event) => setKind(event.target.value as InterviewKind)}>
                {INTERVIEW_KINDS.map((value) => (
                  <option key={value} value={value}>{t(INTERVIEW_KIND_LABEL[value])}</option>
                ))}
              </select>
            </label>
          </div>

          <ParticipantPicker
            testid="testimony-narrator-picker"
            label="Narrador o narradores"
            hint="La persona que cuenta. Puedes crearla aquí mismo escribiendo su nombre."
            selected={narratorIds}
            onChange={setNarratorIds}
            people={people}
            onCreated={reloadPeople}
          />
          <ParticipantPicker
            testid="testimony-interviewer-picker"
            label="Entrevistador o entrevistadores"
            selected={interviewerIds}
            onChange={setInterviewerIds}
            people={people}
            onCreated={reloadPeople}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Fecha prevista')}</span>
              <input type="date" className="input w-full" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Idioma')}</span>
              <input className="input w-full" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="es" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Colección')}</span>
              <input
                className="input w-full"
                list="testimony-collections"
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
              />
              <datalist id="testimony-collections">
                {collections.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
            </label>
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
            {t('El audio, la transcripción y el acuerdo se añaden después, dentro de la entrevista. Aquí solo se crea la ficha.')}
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-neutral-200 p-4 dark:border-neutral-800">
          <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button
            className="btn btn-primary"
            data-testid="testimony-new-interview-submit"
            disabled={saving || !title.trim()}
            onClick={() => void submit()}
          >
            <Icon name={saving ? 'sync' : 'plus'} className={saving ? 'animate-spin' : ''} />
            {t('Crear entrevista')}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
