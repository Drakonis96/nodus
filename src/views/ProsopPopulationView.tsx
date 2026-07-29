import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ProsopCriterionInput,
  ProsopPopulationWorkspace,
  ProsopStudyInput,
  ProsopVariableRevisionInput,
} from '@shared/prosopography';
import { missingReasons, valueKinds } from '@shared/prosopography';
import { Icon } from '../components/ui';
import { ProsopCohortsPanel } from '../components/ProsopCohortsPanel';
import { errorText, t, tx } from '../i18n';

type Tab = 'study' | 'criteria' | 'questionnaire' | 'vocabularies' | 'cohorts' | 'coverage';

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'study', label: 'Estudio', icon: 'compass' },
  { id: 'criteria', label: 'Criterios', icon: 'check' },
  { id: 'questionnaire', label: 'Cuestionario', icon: 'table' },
  { id: 'vocabularies', label: 'Vocabularios', icon: 'tree' },
  { id: 'cohorts', label: 'Cohortes', icon: 'users' },
  { id: 'coverage', label: 'Cobertura', icon: 'chartBar' },
];

const fieldClass = 'mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';
const labelClass = 'text-[11px] font-medium text-neutral-600 dark:text-neutral-400';

function StatusBadge({ status, version }: { status: string; version: number }) {
  const tone = status === 'published'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone}`}>{tx('v{version} · {status}', { version, status: t(status === 'published' ? 'Publicada' : status === 'draft' ? 'Borrador' : 'Retirada') })}</span>;
}

export function ProsopPopulationView() {
  const [workspace, setWorkspace] = useState<ProsopPopulationWorkspace | null>(null);
  const [tab, setTab] = useState<Tab>('study');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setWorkspace(await window.nodus.getProsopPopulationWorkspace());
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const perform = useCallback(async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(''); setNotice('');
    try {
      await action();
      await load();
      setNotice(t(success));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy('');
    }
  }, [load]);

  if (!workspace) {
    return <div className="grid h-full place-items-center bg-neutral-50 text-sm text-neutral-500 dark:bg-neutral-950"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" />{t('Cargando...')}</span></div>;
  }

  const currentMethod = workspace.methodologies.find((item) => item.versionId === workspace.study.currentMethodologyVersionId);
  const currentQuestionnaire = workspace.questionnaires.find((item) => item.questionnaireVersionId === workspace.study.currentQuestionnaireVersionId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100" data-testid="prosop-population-view">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-6 py-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-600 dark:text-blue-400">{t('Diseño del estudio')}</p><h1 className="mt-1 text-2xl font-semibold">{t('Población')}</h1><p className="mt-1 text-xs text-neutral-500">{t('Define quién entra, qué preguntas se formulan y cómo se codifican las respuestas.')}</p></div>
            <div className="flex gap-2">
              {currentMethod ? <StatusBadge status={currentMethod.status} version={currentMethod.versionNo} /> : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{t('Metodología sin publicar')}</span>}
              {currentQuestionnaire ? <StatusBadge status={currentQuestionnaire.status} version={currentQuestionnaire.versionNo} /> : <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800">{t('Cuestionario sin publicar')}</span>}
            </div>
          </div>
          <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label={t('Población')}>
            {tabs.map((item) => <button key={item.id} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${tab === item.id ? 'bg-blue-600 font-medium text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} onClick={() => setTab(item.id)}><Icon name={item.icon} size={13} />{t(item.label)}</button>)}
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl">
          {(error || notice) && <div role={error ? 'alert' : 'status'} className={`mb-4 rounded-xl border px-4 py-3 text-xs ${error ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>{error || notice}</div>}
          {tab === 'study' && <StudyEditor workspace={workspace} busy={busy} perform={perform} />}
          {tab === 'criteria' && <CriteriaEditor workspace={workspace} busy={busy} perform={perform} />}
          {tab === 'questionnaire' && <QuestionnaireEditor workspace={workspace} busy={busy} perform={perform} />}
          {tab === 'vocabularies' && <VocabularyEditor workspace={workspace} busy={busy} perform={perform} />}
          {(tab === 'cohorts' || tab === 'coverage') && <ProsopCohortsPanel tab={tab} population={workspace} />}
        </div>
      </main>
    </div>
  );
}

function StudyEditor({ workspace, busy, perform }: {
  workspace: ProsopPopulationWorkspace;
  busy: string;
  perform: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProsopStudyInput>({ ...workspace.study });
  useEffect(() => setDraft({ ...workspace.study }), [workspace.study]);
  const field = <K extends keyof ProsopStudyInput>(key: K, value: ProsopStudyInput[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{t('Definición del estudio')}</h2><p className="mt-1 text-xs text-neutral-500">{t('La población, las fuentes y las preguntas se diseñan juntas.')}</p></div><button disabled={busy === 'study'} className="btn bg-blue-600 text-white hover:bg-blue-700" onClick={() => void perform('study', () => window.nodus.updateProsopStudy(draft), 'Estudio guardado.')}><Icon name={busy === 'study' ? 'sync' : 'check'} className={busy === 'study' ? 'animate-spin' : ''} size={14} />{t('Guardar')}</button></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className={labelClass}>{t('Título')}<input className={fieldClass} value={draft.title ?? ''} onChange={(event) => field('title', event.target.value)} /></label>
        <label className={labelClass}>{t('Unidad de análisis')}<select className={fieldClass} value={draft.unitOfAnalysis ?? 'person'} onChange={(event) => field('unitOfAnalysis', event.target.value as ProsopStudyInput['unitOfAnalysis'])}><option value="person">{t('Persona')}</option><option value="statement">{t('Afirmación')}</option><option value="event">{t('Evento')}</option><option value="person_period">{t('Persona-periodo')}</option></select></label>
        <label className={`${labelClass} md:col-span-2`}>{t('Pregunta de investigación')}<textarea className={`${fieldClass} min-h-24`} value={draft.researchQuestion ?? ''} onChange={(event) => field('researchQuestion', event.target.value)} /></label>
        <label className={`${labelClass} md:col-span-2`}>{t('Definición de la población')}<textarea className={`${fieldClass} min-h-28`} value={draft.populationDefinition ?? ''} onChange={(event) => field('populationDefinition', event.target.value)} /></label>
        <label className={labelClass}>{t('Ámbito temporal')}<input className={fieldClass} value={draft.temporalScope ?? ''} onChange={(event) => field('temporalScope', event.target.value)} placeholder={t('p. ej., 1620–1680')} /></label>
        <label className={labelClass}>{t('Ámbito geográfico')}<input className={fieldClass} value={draft.geographicScope ?? ''} onChange={(event) => field('geographicScope', event.target.value)} /></label>
        <label className={labelClass}>{t('Inicio ordenable')}<input type="number" className={fieldClass} value={draft.dateStartSort ?? ''} onChange={(event) => field('dateStartSort', event.target.value ? Number(event.target.value) : null)} /></label>
        <label className={labelClass}>{t('Final ordenable')}<input type="number" className={fieldClass} value={draft.dateEndSort ?? ''} onChange={(event) => field('dateEndSort', event.target.value ? Number(event.target.value) : null)} /></label>
        <label className={labelClass}>{t('Población esperada')}<input type="number" min="0" className={fieldClass} value={draft.expectedPopulation ?? ''} onChange={(event) => field('expectedPopulation', event.target.value ? Number(event.target.value) : null)} /></label>
        <label className={labelClass}>{t('Política para personas vivas')}<select className={fieldClass} value={draft.livingPeoplePolicy ?? 'restricted'} onChange={(event) => field('livingPeoplePolicy', event.target.value as ProsopStudyInput['livingPeoplePolicy'])}><option value="exclude">{t('Excluir')}</option><option value="restricted">{t('Restringir')}</option><option value="allow_with_consent">{t('Permitir con consentimiento')}</option></select></label>
        <label className={labelClass}>{t('Estrategia de muestreo')}<textarea className={`${fieldClass} min-h-24`} value={draft.samplingStrategy ?? ''} onChange={(event) => field('samplingStrategy', event.target.value)} /></label>
        <label className={labelClass}>{t('Plan de fuentes')}<textarea className={`${fieldClass} min-h-24`} value={draft.sourceStrategy ?? ''} onChange={(event) => field('sourceStrategy', event.target.value)} /></label>
        <label className={`${labelClass} md:col-span-2`}>{t('Sesgos y límites conocidos')}<textarea className={`${fieldClass} min-h-24`} value={draft.knownBiases ?? ''} onChange={(event) => field('knownBiases', event.target.value)} /></label>
      </div>
    </section>
  );
}

function CriteriaEditor({ workspace, busy, perform }: {
  workspace: ProsopPopulationWorkspace; busy: string;
  perform: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const draftVersion = workspace.methodologies.find((item) => item.status === 'draft');
  const published = workspace.methodologies.find((item) => item.status === 'published');
  const [criteria, setCriteria] = useState<ProsopCriterionInput[]>(draftVersion?.criteria ?? []);
  useEffect(() => setCriteria(draftVersion?.criteria ?? []), [draftVersion?.versionId, draftVersion?.criteria.length]);
  const createDraft = () => perform('method-draft', () => window.nodus.createProsopMethodologyDraft(), published ? 'Nueva versión metodológica creada.' : 'Borrador metodológico creado.');
  if (!draftVersion) return <EmptyAction icon="check" title={t('Criterios de pertenencia')} body={t(published ? 'La versión publicada es inmutable. Crea una nueva versión para modificar los criterios.' : 'Crea el primer borrador y documenta por qué una persona entra o queda fuera.')} action={t(published ? 'Crear nueva versión' : 'Crear borrador')} busy={busy === 'method-draft'} onAction={() => void createDraft()} />;
  const update = (index: number, patch: Partial<ProsopCriterionInput>) => setCriteria((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{t('Criterios de pertenencia')}</h2><StatusBadge status={draftVersion.status} version={draftVersion.versionNo} /></div><p className="mt-1 text-xs text-neutral-500">{t('Los pesos ayudan a revisar; nunca incluyen ni excluyen automáticamente.')}</p></div><div className="flex gap-2"><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => setCriteria((items) => [...items, { kind: 'include', label: '', required: false, weight: 1, position: items.length }])}><Icon name="plus" size={14} />{t('Añadir criterio')}</button><button disabled={busy === 'criteria'} className="btn bg-blue-600 text-white hover:bg-blue-700" onClick={() => void perform('criteria', () => window.nodus.replaceProsopCriteria(draftVersion.versionId, criteria), 'Criterios guardados.')}><Icon name="check" size={14} />{t('Guardar')}</button></div></div>
      <div className="mt-5 space-y-3">
        {criteria.length === 0 && <p className="rounded-xl border border-dashed border-neutral-300 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">{t('Añade al menos un criterio de inclusión.')}</p>}
        {criteria.map((criterion, index) => <article key={criterion.criterionId ?? index} className="grid gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800 md:grid-cols-[150px_minmax(0,1fr)_110px_auto]"><select aria-label={t('Tipo de criterio')} className={fieldClass} value={criterion.kind} onChange={(event) => update(index, { kind: event.target.value as ProsopCriterionInput['kind'] })}><option value="include">{t('Inclusión')}</option><option value="exclude">{t('Exclusión')}</option><option value="supporting">{t('Apoyo')}</option></select><div><input aria-label={t('Etiqueta')} className={fieldClass} value={criterion.label} placeholder={t('Etiqueta del criterio')} onChange={(event) => update(index, { label: event.target.value })} /><textarea aria-label={t('Descripción')} className={`${fieldClass} min-h-16`} value={criterion.description ?? ''} placeholder={t('Cómo se evalúa y qué evidencia admite')} onChange={(event) => update(index, { description: event.target.value })} /></div><div><label className={labelClass}>{t('Peso')}<input type="number" step=".1" className={fieldClass} value={criterion.weight ?? 1} onChange={(event) => update(index, { weight: Number(event.target.value) })} /></label><label className="mt-3 flex items-center gap-2 text-xs text-neutral-500"><input type="checkbox" checked={criterion.required ?? false} onChange={(event) => update(index, { required: event.target.checked })} />{t('Obligatorio')}</label></div><button aria-label={t('Eliminar')} className="self-start rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20" onClick={() => setCriteria((items) => items.filter((_, position) => position !== index))}><Icon name="trash" size={15} /></button></article>)}
      </div>
      <div className="mt-5 flex justify-end border-t border-neutral-200 pt-4 dark:border-neutral-800"><button disabled={busy === 'method-publish' || criteria.length === 0} className="btn bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void perform('method-publish', async () => { await window.nodus.replaceProsopCriteria(draftVersion.versionId, criteria); return window.nodus.publishProsopMethodology(draftVersion.versionId, draftVersion.versionNo === 1 ? 'Primera versión' : 'Revisión metodológica'); }, 'Metodología publicada.')}><Icon name="check" size={14} />{t('Publicar versión')}</button></div>
    </section>
  );
}

function QuestionnaireEditor({ workspace, busy, perform }: {
  workspace: ProsopPopulationWorkspace; busy: string;
  perform: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const draft = workspace.questionnaires.find((item) => item.status === 'draft');
  const published = workspace.questionnaires.find((item) => item.status === 'published');
  const [variable, setVariable] = useState<ProsopVariableRevisionInput>({ key: '', label: '', question: '', valueType: 'text', cardinality: 'one', missingReasons: [...missingReasons], sensitivity: 'ordinary' });
  const createDraft = () => perform('questionnaire-draft', () => window.nodus.createProsopQuestionnaireDraft({ title: published ? `${published.title} v${published.versionNo + 1}` : t('Cuestionario común') }), published ? 'Nueva versión de cuestionario creada.' : 'Borrador de cuestionario creado.');
  if (!draft) return <EmptyAction icon="table" title={t('Cuestionario común')} body={t(published ? 'La versión publicada es inmutable. Crea una nueva versión para cambiar preguntas, tipos o vocabularios.' : 'Las mismas preguntas se aplicarán de forma comparable a cada integrante de la población.')} action={t(published ? 'Crear nueva versión' : 'Crear borrador')} busy={busy === 'questionnaire-draft'} onAction={() => void createDraft()} />;
  const save = async () => {
    await perform('variable', () => window.nodus.saveProsopVariableRevision(draft.questionnaireVersionId, variable), 'Variable guardada.');
    setVariable({ key: '', label: '', question: '', valueType: 'text', cardinality: 'one', missingReasons: [...missingReasons], sensitivity: 'ordinary' });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="font-semibold">{draft.title}</h2><StatusBadge status={draft.status} version={draft.versionNo} /></div><button disabled={!draft.revisions.length || busy === 'questionnaire-publish'} className="btn bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void perform('questionnaire-publish', () => window.nodus.publishProsopQuestionnaire(draft.questionnaireVersionId, draft.versionNo === 1 ? 'Primera versión' : 'Revisión del cuestionario'), 'Cuestionario publicado.')}><Icon name="check" size={14} />{t('Publicar versión')}</button></div>
        <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          {draft.revisions.length === 0 ? <p className="py-12 text-center text-sm text-neutral-500">{t('Añade la primera variable del cuestionario.')}</p> : draft.revisions.map((item) => <article key={item.revisionId} className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-0 dark:border-neutral-800"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><Icon name={item.valueType === 'term' ? 'tree' : item.valueType === 'number' ? 'chartBar' : 'table'} size={14} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{item.label}</h3><span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800">{t(item.valueType)}</span><span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500 dark:bg-neutral-800">{t(item.cardinality)}</span>{item.sensitivity !== 'ordinary' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{t(item.sensitivity)}</span>}</div><p className="mt-1 text-xs text-neutral-500">{item.question}</p></div><button aria-label={t('Eliminar')} className="rounded-lg p-2 text-neutral-400 hover:text-red-600" onClick={() => void perform(`delete-${item.variableId}`, () => window.nodus.deleteProsopVariableRevision(draft.questionnaireVersionId, item.variableId), 'Variable eliminada.')}><Icon name="trash" size={14} /></button></article>)}
        </div>
      </section>
      <aside className="self-start rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">
        <h2 className="font-semibold">{t('Nueva variable')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Conserva una pregunta clara, tipo, cardinalidad y razones de ausencia.')}</p>
        <div className="mt-4 space-y-3">
          <label className={labelClass}>{t('Etiqueta')}<input className={fieldClass} value={variable.label} onChange={(event) => setVariable((item) => ({ ...item, label: event.target.value, key: item.key || event.target.value }))} /></label>
          <label className={labelClass}>{t('Clave estable')}<input className={fieldClass} value={variable.key} onChange={(event) => setVariable((item) => ({ ...item, key: event.target.value }))} /></label>
          <label className={labelClass}>{t('Pregunta')}<textarea className={`${fieldClass} min-h-20`} value={variable.question} onChange={(event) => setVariable((item) => ({ ...item, question: event.target.value }))} /></label>
          <div className="grid grid-cols-2 gap-3"><label className={labelClass}>{t('Tipo')}<select className={fieldClass} value={variable.valueType} onChange={(event) => setVariable((item) => ({ ...item, valueType: event.target.value as ProsopVariableRevisionInput['valueType'] }))}>{valueKinds.map((kind) => <option key={kind} value={kind}>{t(kind)}</option>)}</select></label><label className={labelClass}>{t('Cardinalidad')}<select className={fieldClass} value={variable.cardinality} onChange={(event) => setVariable((item) => ({ ...item, cardinality: event.target.value as 'one' | 'many' }))}><option value="one">{t('Un valor')}</option><option value="many">{t('Varios valores')}</option></select></label></div>
          <label className={labelClass}>{t('Sensibilidad')}<select className={fieldClass} value={variable.sensitivity} onChange={(event) => setVariable((item) => ({ ...item, sensitivity: event.target.value as ProsopVariableRevisionInput['sensitivity'] }))}><option value="ordinary">{t('Ordinaria')}</option><option value="sensitive">{t('Sensible')}</option><option value="restricted">{t('Restringida')}</option></select></label>
          {variable.valueType === 'term' && <label className={labelClass}>{t('Vocabulario')}<select className={fieldClass} value={variable.vocabularyId ?? ''} onChange={(event) => setVariable((item) => ({ ...item, vocabularyId: event.target.value || null }))}><option value="">{t('Selecciona un vocabulario')}</option>{workspace.vocabularies.map((item) => <option key={item.vocabularyId} value={item.vocabularyId}>{item.name}</option>)}</select></label>}
          <button disabled={!variable.label.trim() || !variable.question.trim() || busy === 'variable'} className="btn w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => void save()}><Icon name="plus" size={14} />{t('Añadir variable')}</button>
        </div>
      </aside>
    </div>
  );
}

function VocabularyEditor({ workspace, busy, perform }: {
  workspace: ProsopPopulationWorkspace; busy: string;
  perform: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [termDrafts, setTermDrafts] = useState<Record<string, { code: string; label: string }>>({});
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="self-start rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45"><h2 className="font-semibold">{t('Nuevo vocabulario')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Codificar permite comparar sin perder la expresión histórica.')}</p><label className={`${labelClass} mt-4 block`}>{t('Nombre')}<input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} /></label><button disabled={!name.trim() || busy === 'vocabulary'} className="btn mt-3 w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => void perform('vocabulary', async () => { await window.nodus.saveProsopVocabulary({ name }); setName(''); }, 'Vocabulario creado.')}><Icon name="plus" size={14} />{t('Crear vocabulario')}</button></section>
      <section className="space-y-4">{workspace.vocabularies.length === 0 && <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">{t('Todavía no hay vocabularios controlados.')}</div>}{workspace.vocabularies.map((vocabulary) => { const draft = termDrafts[vocabulary.vocabularyId] ?? { code: '', label: '' }; return <article key={vocabulary.vocabularyId} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{vocabulary.name}</h2><p className="mt-1 text-xs text-neutral-500">{tx('{count} términos · versión {version}', { count: vocabulary.terms.length, version: vocabulary.version })}</p></div><Icon name="tree" className="text-blue-500" /></div><div className="mt-4 flex flex-wrap gap-2">{vocabulary.terms.map((term) => <span key={term.termId} className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"><span className="mr-1 text-[9px] text-neutral-400">{term.code}</span>{term.preferredLabel}</span>)}</div><div className="mt-4 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto]"><input aria-label={t('Código')} className={fieldClass} placeholder={t('Código')} value={draft.code} onChange={(event) => setTermDrafts((items) => ({ ...items, [vocabulary.vocabularyId]: { ...draft, code: event.target.value } }))} /><input aria-label={t('Término preferido')} className={fieldClass} placeholder={t('Término preferido')} value={draft.label} onChange={(event) => setTermDrafts((items) => ({ ...items, [vocabulary.vocabularyId]: { ...draft, label: event.target.value } }))} /><button disabled={!draft.code.trim() || !draft.label.trim()} className="btn mt-1 bg-blue-600 text-white" onClick={() => void perform(`term-${vocabulary.vocabularyId}`, async () => { await window.nodus.saveProsopVocabularyTerm({ vocabularyId: vocabulary.vocabularyId, code: draft.code, preferredLabel: draft.label }); setTermDrafts((items) => ({ ...items, [vocabulary.vocabularyId]: { code: '', label: '' } })); }, 'Término añadido.')}><Icon name="plus" size={14} />{t('Añadir')}</button></div></article>; })}</section>
    </div>
  );
}

function EmptyAction({ icon, title, body, action, busy, onAction }: { icon: string; title: string; body: string; action: string; busy: boolean; onAction: () => void }) {
  return <section className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900/35"><div className="max-w-md"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><Icon name={icon} size={21} /></span><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-neutral-500">{body}</p><button disabled={busy} className="btn mt-5 bg-blue-600 text-white hover:bg-blue-700" onClick={onAction}><Icon name={busy ? 'sync' : 'plus'} className={busy ? 'animate-spin' : ''} size={14} />{action}</button></div></section>;
}
