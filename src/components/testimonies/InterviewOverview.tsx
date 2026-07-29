import { useEffect, useState } from 'react';
import type {
  InterviewKind,
  InterviewMode,
  InterviewWorkflowStatus,
  TestimonyInterviewRow,
  TestimonyParticipantRow,
} from '@shared/types';
import { INTERVIEW_KINDS, INTERVIEW_MODES, suggestedTransitions } from '@shared/testimonies';
import { INTERVIEW_KIND_LABEL, INTERVIEW_MODE_LABEL, WORKFLOW_STATUS_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { TestimonyField } from './TestimonyField';
import { ParticipantPicker } from './ParticipantPicker';
import { t } from '../../i18n';

/** Lo que hay que tener antes de grabar. No bloquea nada: recuerda. */
const CHECKLIST: { id: string; label: string }[] = [
  { id: 'agreement', label: 'Acuerdo documentado, o anotado el motivo por el que sigue pendiente' },
  { id: 'permission', label: 'Permiso para grabar' },
  { id: 'use', label: 'Uso previsto explicado a la persona entrevistada' },
  { id: 'repository', label: 'Repositorio o plan de custodia decidido' },
  { id: 'equipment', label: 'Equipo y almacenamiento disponibles' },
  { id: 'attribution', label: 'Nombre público y preferencias de atribución acordados' },
];

/**
 * La pestaña Resumen del dossier: la ficha de la entrevista y su preparación.
 *
 * La LISTA DE COMPROBACIÓN es explícitamente no bloqueante. Nodus no puede decidir si un
 * acuerdo es jurídicamente suficiente y no va a fingir que sí; lo que sí puede hacer es
 * que nadie llegue a la grabación sin haberse hecho las seis preguntas. Marcarla es un
 * gesto del investigador y se guarda en su preparación, no un permiso del programa.
 */
export function InterviewOverview({
  row,
  people,
  onChanged,
}: {
  row: TestimonyInterviewRow;
  people: TestimonyParticipantRow[];
  onChanged: () => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<string[]>([]);

  useEffect(() => {
    void window.nodus.testimonyInterviewFacets().then((facets) => setCollections(facets.collections));
  }, []);

  // La lista de comprobación es una ayuda de sesión, no un dato del archivo: guardarla en
  // el esquema convertiría un recordatorio en un registro de conformidad que Nodus no
  // puede sostener.
  useEffect(() => {
    const raw = localStorage.getItem(`nodus.testimony.checklist.${row.id}`);
    setChecked(new Set(raw ? (JSON.parse(raw) as string[]) : []));
  }, [row.id]);

  const toggle = (id: string): void => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
    localStorage.setItem(`nodus.testimony.checklist.${row.id}`, JSON.stringify([...next]));
  };

  const patch = async (fields: Parameters<typeof window.nodus.updateTestimonyInterview>[1]): Promise<void> => {
    await window.nodus.updateTestimonyInterview(row.id, fields);
    await onChanged();
  };

  const narratorIds = row.participants.filter((person) => person.role === 'narrator').map((person) => person.personId);
  const interviewerIds = row.participants.filter((person) => person.role === 'interviewer').map((person) => person.personId);

  return (
    <div className="space-y-6" data-testid="testimony-overview">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <TestimonyField
            label="Título"
            multiline={false}
            value={row.title}
            testid="testimony-overview-title"
            onSave={(next) => patch({ title: next })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Estado del flujo')}</span>
              <select
                className="input w-full"
                data-testid="testimony-overview-status"
                value={row.workflowStatus}
                onChange={(event) => void patch({ workflowStatus: event.target.value as InterviewWorkflowStatus })}
              >
                {/* Se ofrecen los pasos naturales primero, pero el estado actual y los
                    retrocesos siguen estando: una entrevista real vuelve atrás. */}
                <option value={row.workflowStatus}>{t(WORKFLOW_STATUS_LABEL[row.workflowStatus])}</option>
                {suggestedTransitions(row.workflowStatus).map((status) => (
                  <option key={status} value={status}>{t(WORKFLOW_STATUS_LABEL[status])}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Tipo')}</span>
              <select
                className="input w-full"
                value={row.interviewKind}
                onChange={(event) => void patch({ interviewKind: event.target.value as InterviewKind })}
              >
                {INTERVIEW_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{t(INTERVIEW_KIND_LABEL[kind])}</option>
                ))}
              </select>
            </label>
          </div>

          <ParticipantPicker
            testid="testimony-overview-narrators"
            label="Narrador o narradores"
            selected={narratorIds}
            onChange={(ids) => void patch({ narratorIds: ids })}
            people={people}
            onCreated={onChanged}
          />
          <ParticipantPicker
            testid="testimony-overview-interviewers"
            label="Entrevistador o entrevistadores"
            selected={interviewerIds}
            onChange={(ids) => void patch({ interviewerIds: ids })}
            people={people}
            onCreated={onChanged}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Fecha prevista')}</span>
              <input
                type="date"
                className="input w-full"
                value={row.scheduledAt?.slice(0, 10) ?? ''}
                onChange={(event) => void patch({ scheduledAt: event.target.value ? new Date(event.target.value).toISOString() : null })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Fecha realizada')}</span>
              <input
                type="date"
                className="input w-full"
                value={row.conductedAt?.slice(0, 10) ?? ''}
                onChange={(event) => void patch({ conductedAt: event.target.value ? new Date(event.target.value).toISOString() : null })}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TestimonyField label="Lugar" multiline={false} value={row.locationText} onSave={(next) => patch({ locationText: next || null })} />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Modalidad')}</span>
              <select
                className="input w-full"
                value={row.interviewMode ?? ''}
                onChange={(event) => void patch({ interviewMode: (event.target.value || null) as InterviewMode | null })}
              >
                <option value="">{t('Sin indicar')}</option>
                {INTERVIEW_MODES.map((mode) => (
                  <option key={mode} value={mode}>{t(INTERVIEW_MODE_LABEL[mode])}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TestimonyField label="Idioma" multiline={false} value={row.language} placeholder="es" onSave={(next) => patch({ language: next || null })} />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Colección')}</span>
              <input
                className="input w-full"
                list="testimony-dossier-collections"
                defaultValue={row.collectionLabel ?? ''}
                onBlur={(event) => void patch({ collectionLabel: event.target.value || null })}
              />
              <datalist id="testimony-dossier-collections">
                {collections.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <TestimonyField
            label="Objetivo de la entrevista"
            hint="Qué se busca escuchar, no qué se espera confirmar."
            value={row.objective}
            rows={3}
            onSave={(next) => patch({ objective: next || null })}
          />
          <TestimonyField
            label="Contexto histórico"
            value={row.contextMarkdown}
            rows={4}
            onSave={(next) => patch({ contextMarkdown: next || null })}
          />
          <TestimonyField
            label="Guía de entrevista"
            hint="Una guía abierta: temas y preguntas de partida, no un cuestionario cerrado."
            value={row.guideMarkdown}
            rows={6}
            testid="testimony-overview-guide"
            onSave={(next) => patch({ guideMarkdown: next || null })}
          />
          <TestimonyField
            label="Resumen descriptivo"
            hint="De qué habla la entrevista. Es lo que hará que alguien la encuentre dentro de diez años."
            value={row.abstract}
            rows={4}
            onSave={(next) => patch({ abstract: next || null })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TestimonyField
              label="Repositorio de destino"
              multiline={false}
              value={row.repositoryName}
              onSave={(next) => patch({ repositoryName: next || null })}
            />
            <TestimonyField
              label="Identificador de acceso"
              hint="El código que le dará el archivo, si ya se conoce."
              multiline={false}
              value={row.accessionId}
              onSave={(next) => patch({ accessionId: next || null })}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="testimony-checklist">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          <Icon name="check" size={15} className="text-indigo-400" />
          {t('Antes de grabar')}
        </h3>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          {t('Un recordatorio, no un requisito: Nodus no puede decidir si un acuerdo es jurídicamente suficiente y no va a fingir que sí.')}
        </p>
        <ul className="mt-3 space-y-1.5">
          {CHECKLIST.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked.has(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span>{t(item.label)}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
