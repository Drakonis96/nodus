import { useCallback, useEffect, useState } from 'react';
import type {
  TestimonyAccessLevel,
  TestimonyAgreementStatus,
  TestimonyAttributionMode,
  TestimonyAgreement,
  TestimonyDocumentedUse,
  TestimonyInterviewRow,
  TestimonyNarratorReviewStatus,
  TestimonyAccessChannel,
  TestimonyAccessDecision,
  TestimonyExportKind,
} from '@shared/types';
import {
  ACCESS_LEVELS,
  AGREEMENT_STATUSES,
  ATTRIBUTION_MODES,
  DOCUMENTED_USES,
  NARRATOR_REVIEW_STATUSES,
} from '@shared/testimonies';
import {
  ACCESS_DENIAL_LABEL,
  ACCESS_LEVEL_HINT,
  ACCESS_LEVEL_LABEL,
  AGREEMENT_STATUS_LABEL,
  ATTRIBUTION_MODE_LABEL,
  DOCUMENTED_USE_LABEL,
  NARRATOR_REVIEW_STATUS_LABEL,
} from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { confirm, toast } from '../feedback';
import { AccessBadge, AgreementBadge } from './AccessBadge';
import { TestimonyField } from './TestimonyField';
import { t, tx } from '../../i18n';

/**
 * Acuerdo y acceso: la pestaña que este vault existe para tener.
 *
 * TODO CAMBIO CREA UNA VERSIÓN. No hay «guardar»: hay «documentar un cambio», y el
 * historial de abajo es el registro de la agencia continua del narrador — cuándo amplió
 * los usos, cuándo pidió un embargo, cuándo lo retiró. Un formulario que se sobrescribe
 * convierte el consentimiento en un trámite y borra exactamente la información que
 * después hace falta para responder «¿puedo publicar esto?».
 *
 * Y las tres dimensiones se pintan por separado a propósito: el ESTADO del acuerdo, el
 * NIVEL de acceso y la ATRIBUCIÓN son independientes entre sí y del flujo de trabajo.
 */
export function InterviewAgreement({ row, onChanged }: { row: TestimonyInterviewRow; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<TestimonyAgreement[]>([]);
  const [draft, setDraft] = useState<TestimonyAgreement | null>(row.agreement);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const rows = await window.nodus.getTestimonyInterview(row.id);
    setDraft(rows?.agreement ?? null);
    // El historial se pide por separado: la tabla solo trae el vigente, porque es lo único
    // que una lista necesita saber.
    setHistory(await window.nodus.testimonyAgreementHistory(row.id));
  }, [row.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = draft ?? row.agreement;
  const [pending, setPending] = useState<Partial<TestimonyAgreement>>({});
  const value = { ...current, ...pending } as TestimonyAgreement;
  const dirty = Object.keys(pending).length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await window.nodus.saveTestimonyAgreement({
        interviewId: row.id,
        status: value.status,
        accessLevel: value.accessLevel,
        embargoUntil: value.embargoUntil,
        attributionMode: value.attributionMode,
        allowedUses: value.allowedUses,
        narratorReviewRequired: value.narratorReviewRequired,
        narratorReviewStatus: value.narratorReviewStatus,
        narratorReviewSentAt: value.narratorReviewSentAt,
        narratorReviewNotes: value.narratorReviewNotes,
        restrictionsMarkdown: value.restrictionsMarkdown,
      });
      setPending({});
      await reload();
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (): Promise<void> => {
    const ok = await confirm({
      title: t('Retirar el acuerdo'),
      message: t('Retirar el acuerdo bloquea toda salida de esta entrevista: exportaciones, IA y paquetes de consulta. No borra nada por su cuenta: el material sigue en la bóveda y decides tú qué hacer con él.'),
      confirmLabel: t('Retirar el acuerdo'),
      danger: true,
    });
    if (!ok) return;
    setPending({ status: 'withdrawn' });
    await window.nodus.saveTestimonyAgreement({ interviewId: row.id, status: 'withdrawn' });
    setPending({});
    await reload();
    await onChanged();
  };

  const toggleUse = (use: TestimonyDocumentedUse): void => {
    const uses = new Set(value.allowedUses);
    if (uses.has(use)) uses.delete(use);
    else uses.add(use);
    setPending({ ...pending, allowedUses: [...uses] });
  };

  if (!current) return <p className="text-sm text-neutral-500">{t('Esta entrevista todavía no tiene acuerdo.')}</p>;

  return (
    <div className="space-y-6" data-testid="testimony-agreement">
      <section className="flex flex-wrap items-center gap-2">
        <AgreementBadge status={value.status} />
        <AccessBadge level={value.accessLevel} embargoUntil={value.embargoUntil} />
        <span className="text-xs text-neutral-500">
          {tx('Versión {n} del acuerdo', { n: current.versionNo })}
          {current.documentedAt && ` · ${current.documentedAt.slice(0, 10)}`}
        </span>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Estado del acuerdo')}</span>
            <select
              className="input w-full"
              data-testid="testimony-agreement-status"
              value={value.status}
              onChange={(event) => setPending({ ...pending, status: event.target.value as TestimonyAgreementStatus })}
            >
              {AGREEMENT_STATUSES.map((status) => (
                <option key={status} value={status}>{t(AGREEMENT_STATUS_LABEL[status])}</option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Acceso')}</legend>
            <div className="mt-1 space-y-1.5">
              {ACCESS_LEVELS.map((level) => (
                <label key={level} className="flex cursor-pointer items-start gap-2 text-xs leading-5">
                  <input
                    type="radio"
                    name="testimony-access"
                    className="mt-0.5"
                    checked={value.accessLevel === level}
                    onChange={() => setPending({ ...pending, accessLevel: level as TestimonyAccessLevel })}
                  />
                  <span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">{t(ACCESS_LEVEL_LABEL[level])}</span>
                    <span className="block text-neutral-500">{t(ACCESS_LEVEL_HINT[level])}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {value.accessLevel === 'embargoed' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Embargo hasta')}</span>
              <input
                type="date"
                className="input w-full"
                data-testid="testimony-embargo-until"
                value={value.embargoUntil?.slice(0, 10) ?? ''}
                onChange={(event) => setPending({ ...pending, embargoUntil: event.target.value ? new Date(event.target.value).toISOString() : null })}
              />
              <span className="text-[11px] leading-4 text-neutral-500">
                {t('Sin fecha, el embargo no vence solo. Al llegar la fecha Nodus avisa, pero no abre el acceso por su cuenta: eso lo decides tú.')}
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Nombre de atribución')}</span>
            <select
              className="input w-full"
              value={value.attributionMode}
              onChange={(event) => setPending({ ...pending, attributionMode: event.target.value as TestimonyAttributionMode })}
            >
              {ATTRIBUTION_MODES.map((mode) => (
                <option key={mode} value={mode}>{t(ATTRIBUTION_MODE_LABEL[mode])}</option>
              ))}
            </select>
            <span className="text-[11px] leading-4 text-neutral-500">
              {t('Determina con qué nombre aparece esta persona en citas, derivados y exportaciones. Nunca promete anonimato absoluto.')}
            </span>
          </label>
        </div>

        <div className="space-y-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Usos documentados')}</legend>
            <p className="text-[11px] leading-4 text-neutral-500">
              {t('Lo que explicaste y se acordó, no un dictamen legal. Los dos últimos deciden si esta entrevista puede llegar a un modelo de IA o salir del equipo.')}
            </p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {DOCUMENTED_USES.map((use) => (
                <label key={use} className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    data-testid={`testimony-use-${use}`}
                    checked={value.allowedUses.includes(use)}
                    onChange={() => toggleUse(use)}
                  />
                  <span>{t(DOCUMENTED_USE_LABEL[use])}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.narratorReviewRequired}
              onChange={(event) => setPending({ ...pending, narratorReviewRequired: event.target.checked })}
            />
            <span>{t('El narrador revisa la transcripción antes de darla por buena')}</span>
          </label>

          {value.narratorReviewRequired && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('Revisión del narrador')}</span>
              <select
                className="input w-full"
                value={value.narratorReviewStatus}
                onChange={(event) => setPending({ ...pending, narratorReviewStatus: event.target.value as TestimonyNarratorReviewStatus })}
              >
                {NARRATOR_REVIEW_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(NARRATOR_REVIEW_STATUS_LABEL[status])}</option>
                ))}
              </select>
              <span className="text-[11px] leading-4 text-neutral-500">
                {t('Aprobar una transcripción y abrir el acceso son cosas distintas: esta casilla no cambia el nivel de acceso.')}
              </span>
            </label>
          )}

          <TestimonyField
            label="Restricciones"
            hint="Lo que no puede hacerse con esta entrevista, en tus palabras."
            value={value.restrictionsMarkdown}
            rows={4}
            onSave={async (next) => { setPending((prev) => ({ ...prev, restrictionsMarkdown: next || null })); }}
          />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          data-testid="testimony-agreement-save"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          <Icon name={saving ? 'sync' : 'save'} className={saving ? 'animate-spin' : ''} />
          {t('Documentar este cambio')}
        </button>
        {dirty && <span className="text-xs text-neutral-500">{t('Se guardará como una versión nueva; la anterior se conserva.')}</span>}
        {value.status !== 'withdrawn' && (
          <button className="btn btn-ghost ml-auto text-rose-500" onClick={() => void withdraw()}>
            <Icon name="alert" /> {t('Retirar el acuerdo')}
          </button>
        )}
      </section>

      <ExportPanel interviewId={row.id} />

      <section>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Historial del acuerdo')}</h3>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          {t('Cada cambio queda como una versión fechada. Es lo que permite responder, años después, qué se acordó y cuándo.')}
        </p>
        <ol className="mt-3 space-y-2" data-testid="testimony-agreement-history">
          {history.map((entry) => (
            <li
              key={entry.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs ${
                entry.isCurrent
                  ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700/60 dark:bg-indigo-950/30'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <span className="font-medium text-neutral-700 dark:text-neutral-200">v{entry.versionNo}</span>
              <AgreementBadge status={entry.status} />
              <AccessBadge level={entry.accessLevel} embargoUntil={entry.embargoUntil} compact />
              <span className="text-neutral-500">{t(ATTRIBUTION_MODE_LABEL[entry.attributionMode])}</span>
              <span className="ml-auto text-neutral-500">{entry.createdAt.slice(0, 10)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Exportar esta entrevista.
 *
 * ANTES DE EXPORTAR SE ENSEÑA SI PUEDE SALIR, y por qué canal. La puerta de acceso
 * responde en el momento, con el motivo exacto, en vez de dejar que el usuario pulse y se
 * lleve un paquete vacío o —peor— uno que él creía completo. Los tres paquetes son
 * distintos destinatarios, no tres niveles de detalle del mismo archivo.
 */
function ExportPanel({ interviewId }: { interviewId: string }) {
  const [decisions, setDecisions] = useState<Partial<Record<TestimonyExportKind, TestimonyAccessDecision>>>({});
  const [busy, setBusy] = useState<TestimonyExportKind | null>(null);
  const [includeNotes, setIncludeNotes] = useState(false);

  const CHANNELS: Record<TestimonyExportKind, TestimonyAccessChannel> = {
    preservation: 'preservationExport',
    access: 'accessExport',
    review: 'reviewExport',
  };

  useEffect(() => {
    void (async () => {
      const next: Partial<Record<TestimonyExportKind, TestimonyAccessDecision>> = {};
      for (const kind of Object.keys(CHANNELS) as TestimonyExportKind[]) {
        next[kind] = await window.nodus.testimonyAccessDecision(interviewId, CHANNELS[kind]);
      }
      setDecisions(next);
    })();
    // La decisión depende del acuerdo vigente, que cambia al guardar una versión nueva.
  }, [interviewId]);

  const run = async (kind: TestimonyExportKind): Promise<void> => {
    setBusy(kind);
    try {
      const result = await window.nodus.exportTestimonyPackage({ kind, interviewIds: [interviewId], includeNotes });
      if (!result) return;
      toast(result.excluded.length > 0
        ? tx('Paquete guardado. {n} entrevistas quedaron fuera por sus condiciones de acceso.', { n: result.excluded.length })
        : tx('Paquete guardado: {files} archivos.', { files: result.files }));
    } finally {
      setBusy(null);
    }
  };

  const CARDS: { kind: TestimonyExportKind; title: string; description: string; icon: string }[] = [
    {
      kind: 'preservation',
      title: 'Paquete de preservación',
      description: 'Para el archivo o el repositorio: originales, derivados, todas las transcripciones, metadatos y sumas de comprobación.',
      icon: 'archive',
    },
    {
      kind: 'access',
      title: 'Paquete de consulta',
      description: 'Para alguien ajeno al proyecto: copia de acceso, transcripción autorizada y metadatos públicos. Sin originales ni notas.',
      icon: 'share',
    },
    {
      kind: 'review',
      title: 'Paquete de revisión',
      description: 'Para la persona entrevistada: su transcripción con tiempos e instrucciones, sin ninguna nota tuya.',
      icon: 'users',
    },
  ];

  return (
    <section data-testid="testimony-export-panel">
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Exportar')}</h3>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {CARDS.map((card) => {
          const decision = decisions[card.kind];
          const blocked = decision && !decision.allowed;
          return (
            <div
              key={card.kind}
              className={`rounded-xl border p-3 ${blocked ? 'border-neutral-200 opacity-70 dark:border-neutral-800' : 'border-neutral-200 dark:border-neutral-800'}`}
              data-testid={`testimony-export-${card.kind}`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                <Icon name={card.icon} size={14} className="text-indigo-400" /> {t(card.title)}
              </span>
              <p className="mt-1 text-[11px] leading-4 text-neutral-500">{t(card.description)}</p>
              {blocked ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                  <Icon name="lock" size={11} className="mt-0.5 shrink-0" />
                  {t(ACCESS_DENIAL_LABEL[decision.reason ?? 'access_restricted'])}
                </p>
              ) : (
                <button
                  className="btn btn-ghost mt-2 w-full text-xs"
                  data-testid={`testimony-export-run-${card.kind}`}
                  disabled={busy !== null}
                  onClick={() => void run(card.kind)}
                >
                  <Icon name={busy === card.kind ? 'sync' : 'download'} className={busy === card.kind ? 'animate-spin' : ''} />
                  {t('Exportar')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <label className="mt-2 flex items-start gap-2 text-[11px] leading-4 text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" className="mt-0.5" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
        <span>{t('Incluir mis notas en el paquete de preservación. Son interpretación tuya, no material del narrador: van en una carpeta aparte.')}</span>
      </label>
      <p className="mt-2 text-[11px] leading-4 text-neutral-500">
        {t('El documento del acuerdo nunca se incluye automáticamente: lleva firmas y datos que no son material de investigación.')}
      </p>
    </section>
  );
}
