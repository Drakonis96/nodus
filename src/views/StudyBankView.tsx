import { useCallback, useEffect, useState } from 'react';
import type {
  StudyAssistantSourceOption,
  StudyQuestion,
  StudyQuestionCollection,
  StudyQuestionDifficulty,
  StudyQuestionInput,
  StudyQuestionStatus,
  StudyQuestionType,
  StudyWorkspace,
} from '@shared/types';
import { STUDY_QUESTION_TYPES } from '@shared/studyQuestions';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

const TYPE_LABELS: Record<StudyQuestionType, string> = {
  short: 'Respuesta breve', essay: 'Desarrollo', definition: 'Definición', relation: 'Relación', comparison: 'Comparación',
  commentary: 'Comentario', case: 'Caso práctico', true_false: 'Verdadero / falso', single_choice: 'Elección simple',
  multiple_choice: 'Respuesta múltiple', fill_blank: 'Completar', ordering: 'Ordenar', matching: 'Relacionar columnas',
};
const STATUS_LABELS: Record<StudyQuestionStatus, string> = { pending: 'Pendiente', approved: 'Aprobada', problematic: 'Problemática', discarded: 'Descartada' };
const DIFFICULTY_LABELS = { easy: 'Fácil', medium: 'Media', hard: 'Difícil', mixed: 'Mixta' } as const;

function emptyDraft(): StudyQuestionInput {
  return { prompt: '', type: 'short', difficulty: 'medium', cognitiveLevel: 'understand', status: 'pending', answer: { text: '' }, explanation: '', tags: [], source: { title: 'Creación manual', excerpt: '' } };
}

export function StudyBankView({
  onOpenDocument,
  onOpenMaterial,
  onOpenRecording,
}: {
  onOpenDocument: (id: string) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number) => void;
}) {
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]);
  const [collections, setCollections] = useState<StudyQuestionCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<StudyQuestionType | 'all'>('all');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'all'>('all');
  const [status, setStatus] = useState<StudyQuestionStatus | 'all'>('all');
  const [subjectId, setSubjectId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<StudyQuestionInput | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [generated, setGenerated] = useState<StudyQuestionInput[]>([]);
  const [sourceKeys, setSourceKeys] = useState<string[]>([]);
  const [generationType, setGenerationType] = useState<StudyQuestionType>('short');
  const [generationDifficulty, setGenerationDifficulty] = useState<StudyQuestionDifficulty>('mixed');
  const [generationCount, setGenerationCount] = useState(8);
  const [collectionName, setCollectionName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextQuestions, nextWorkspace, nextSources, nextCollections] = await Promise.all([
      window.nodus.listStudyQuestions({ search, type, difficulty, status, subjectId: subjectId || undefined }),
      window.nodus.getStudyWorkspace(), window.nodus.listStudyAssistantSources(), window.nodus.listStudyQuestionCollections(),
    ]);
    setQuestions(nextQuestions); setWorkspace(nextWorkspace); setSources(nextSources); setCollections(nextCollections);
    setSelectedId((current) => current && nextQuestions.some((question) => question.id === current) ? current : nextQuestions[0]?.id ?? null);
  }, [difficulty, search, status, subjectId, type]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [load]);
  const selected = questions.find((question) => question.id === selectedId) ?? null;
  const successRate = selected && selected.usageCount ? Math.round(selected.correctCount / selected.usageCount * 100) : null;
  const mutate = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await task(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const normalized: StudyQuestionInput = { ...draft, source: { ...draft.source, excerpt: draft.source?.excerpt || draft.explanation || draft.answer?.text || '' } };
    await mutate(async () => { const saved = await window.nodus.createStudyQuestion(normalized); setDraft(null); setSelectedId(saved.id); });
  };

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const result = await window.nodus.generateStudyQuestions({
        sourceKeys, count: generationCount, difficulty: generationDifficulty, types: [generationType],
        cognitiveLevels: ['remember', 'understand', 'analyze', 'apply'], subjectId: subjectId || null,
      });
      setGenerated(result.questions);
      if (!result.questions.length) setError('Las fuentes no permitieron generar preguntas válidas sin duplicados.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const saveGenerated = async () => {
    await mutate(async () => {
      for (const question of generated) await window.nodus.createStudyQuestion(question);
      setGenerated([]); setShowGenerator(false); setSourceKeys([]);
    });
  };

  const openSource = (question: StudyQuestion) => {
    if (question.documentId) onOpenDocument(question.documentId);
    else if (question.materialId) onOpenMaterial(question.materialId);
    else if (question.recordingId) onOpenRecording(question.recordingId, question.source.location?.timestampSeconds ?? undefined);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="study-question-bank">
      <header className="border-b border-neutral-800 bg-neutral-950/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-teal-400">{t('Evaluación')}</p><h1 className="text-xl font-semibold">{t('Banco de preguntas')}</h1></div>
          <button className="btn btn-ghost" onClick={() => void window.nodus.importStudyQuestions().then(load)}><Icon name="upload" />{t('Importar')}</button>
          <button className="btn btn-ghost" onClick={() => void window.nodus.exportStudyQuestions()}><Icon name="download" />{t('Exportar')}</button>
          <button data-testid="study-question-generate" className="btn btn-secondary" onClick={() => { setShowGenerator(!showGenerator); setDraft(null); }}><Icon name="wand" />{t('Generar')}</button>
          <button data-testid="study-question-new" className="btn btn-primary" onClick={() => { setDraft(emptyDraft()); setShowGenerator(false); }}><Icon name="plus" />{t('Nueva pregunta')}</button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(220px,1.8fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input className="input input-with-leading-icon w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar enunciado, explicación o etiqueta…')} /></div>
          <select className="input" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">{t('Todos los tipos')}</option>{STUDY_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select>
          <select className="input" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="all">{t('Toda dificultad')}</option>{(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">{t('Todos los estados')}</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
          <select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">{t('Todas las asignaturas')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
        </div>
      </header>

      {error && <div className="mx-4 mt-3 rounded-lg border border-red-900/60 bg-red-950/25 px-3 py-2 text-xs text-red-300">{error}</div>}

      {draft && <section className="m-4 grid gap-3 rounded-xl border border-teal-900/60 bg-teal-950/15 p-4 lg:grid-cols-2" data-testid="study-question-editor">
        <label className="lg:col-span-2 text-xs text-neutral-500">{t('Enunciado')}<textarea autoFocus className="input mt-1 min-h-20 w-full" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} /></label>
        <label className="text-xs text-neutral-500">{t('Tipo')}<select className="input mt-1 w-full" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as StudyQuestionType })}>{STUDY_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1 w-full" value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value as 'easy' | 'medium' | 'hard' })}>{(['easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select></label>
        <label className="text-xs text-neutral-500">{t('Respuesta correcta / modelo')}<textarea className="input mt-1 min-h-20 w-full" value={draft.answer?.text ?? ''} onChange={(event) => setDraft({ ...draft, answer: { ...draft.answer, text: event.target.value } })} /></label>
        <label className="text-xs text-neutral-500">{t('Explicación y justificación')}<textarea className="input mt-1 min-h-20 w-full" value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value, source: { ...draft.source, excerpt: event.target.value } })} /></label>
        <label className="lg:col-span-2 text-xs text-neutral-500">{t('Etiquetas (separadas por comas)')}<input className="input mt-1 w-full" value={draft.tags?.join(', ') ?? ''} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <div className="lg:col-span-2 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setDraft(null)}>{t('Cancelar')}</button><button data-testid="study-question-save" className="btn btn-primary" disabled={busy || !draft.prompt.trim()} onClick={() => void saveDraft()}>{t('Guardar pregunta')}</button></div>
      </section>}

      {showGenerator && <section className="m-4 rounded-xl border border-indigo-900/60 bg-indigo-950/15 p-4" data-testid="study-question-generator">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-neutral-500">{t('Cantidad')}<input className="input mt-1 w-20" type="number" min="1" max="40" value={generationCount} onChange={(event) => setGenerationCount(Number(event.target.value))} /></label>
          <label className="text-xs text-neutral-500">{t('Tipo')}<select className="input mt-1" value={generationType} onChange={(event) => setGenerationType(event.target.value as StudyQuestionType)}>{STUDY_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select></label>
          <label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1" value={generationDifficulty} onChange={(event) => setGenerationDifficulty(event.target.value as StudyQuestionDifficulty)}>{(['mixed', 'easy', 'medium', 'hard'] as const).map((value) => <option key={value} value={value}>{t(DIFFICULTY_LABELS[value])}</option>)}</select></label>
          <button className="btn btn-primary" disabled={busy || (!sourceKeys.length && !sources.length)} onClick={() => void generate()}>{busy ? <Spinner label={t('Generando…')} /> : <><Icon name="wand" />{t('Generar borradores')}</>}</button>
        </div>
        <p className="mt-3 text-[10px] text-neutral-500">{sourceKeys.length ? `${sourceKeys.length} ${t('fuentes seleccionadas')}` : t('Sin selección: se usará el ámbito filtrado disponible.')}</p>
        <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto md:grid-cols-2">{sources.map((source) => <label key={source.sourceKey} className="flex items-start gap-2 rounded-lg border border-neutral-800 px-2 py-1.5 text-xs"><input type="checkbox" checked={sourceKeys.includes(source.sourceKey)} onChange={(event) => setSourceKeys(event.target.checked ? [...sourceKeys, source.sourceKey] : sourceKeys.filter((key) => key !== source.sourceKey))} /><span><span className="block text-neutral-300">{source.title}</span><span className="text-[10px] text-neutral-600">{source.subtitle}</span></span></label>)}</div>
        {generated.length > 0 && <div className="mt-3 space-y-2"><div className="flex items-center"><strong className="text-xs">{generated.length} {t('borradores para revisar')}</strong><button className="btn btn-primary ml-auto" onClick={() => void saveGenerated()}>{t('Aprobar y guardar todo')}</button></div>{generated.map((question, index) => <article key={`${question.prompt}-${index}`} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"><p className="text-sm">{question.prompt}</p><p className="mt-1 text-xs text-emerald-300">{question.answer?.text ?? String(question.answer?.value ?? '')}</p><p className="mt-1 text-[10px] text-neutral-600">{question.source?.title} · {question.explanation}</p></article>)}</div>}
      </section>}

      {!draft && !showGenerator && <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.4fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-neutral-800 p-3">
          <div className="mb-3 flex items-center gap-2"><span className="text-xs text-neutral-500">{questions.length} {t('preguntas')}</span><span className="ml-auto text-[10px] text-neutral-700">{collections.length} {t('colecciones')}</span></div>
          {questions.map((question) => <button data-testid={`study-question-${question.id}`} key={question.id} className={`mb-2 w-full rounded-xl border p-3 text-left ${selectedId === question.id ? 'border-teal-700 bg-teal-950/25' : 'border-neutral-800 bg-neutral-900/30 hover:border-neutral-700'}`} onClick={() => setSelectedId(question.id)}>
            <div className="flex items-center gap-2"><span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">{t(TYPE_LABELS[question.type])}</span><span className="text-[9px] text-neutral-600">{t(DIFFICULTY_LABELS[question.difficulty])}</span>{question.favorite && <Icon name="star" size={10} className="ml-auto text-amber-400" />}</div>
            <p className="mt-2 line-clamp-3 text-sm text-neutral-200">{question.prompt}</p><p className="mt-1 truncate text-[10px] text-neutral-600">{question.source.title || t('Sin fuente enlazada')}</p>
          </button>)}
          {!questions.length && <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-600">{t('No hay preguntas con estos filtros.')}</div>}
        </aside>
        <main className="min-h-0 overflow-y-auto p-4">{selected ? <>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-teal-900/30 px-2 py-1 text-[10px] text-teal-300">{t(STATUS_LABELS[selected.status])}</span>{selected.locked && <span className="text-[10px] text-neutral-500"><Icon name="lock" size={10} /> {t('Validada y bloqueada')}</span>}<span className="ml-auto text-[10px] text-neutral-600">{selected.shortId}</span></div>
          <h2 className="mt-3 text-lg font-medium leading-7">{selected.prompt}</h2>
          {selected.options.length > 0 && <div className="mt-4 space-y-2">{selected.options.map((option) => <div key={option.id} className={`rounded-lg border px-3 py-2 text-sm ${option.correct ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200' : 'border-neutral-800 text-neutral-400'}`}>{option.text}</div>)}</div>}
          <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900/30 p-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Respuesta y explicación')}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-emerald-200">{selected.answer.text ?? String(selected.answer.value ?? '')}</p><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-400">{selected.explanation}</p></section>
          <section className="mt-3 rounded-xl border border-neutral-800 p-4"><div className="flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Fuente justificativa')}</h3>{(selected.documentId || selected.materialId || selected.recordingId) && <button className="btn btn-ghost ml-auto h-7 text-xs" onClick={() => openSource(selected)}><Icon name="external" size={11} />{t('Abrir fuente')}</button>}</div><p className="mt-2 text-xs text-neutral-500">{selected.source.title}</p><blockquote className="mt-2 border-l-2 border-teal-800 pl-3 text-sm leading-6 text-neutral-300">{selected.source.excerpt}</blockquote></section>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs"><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base">{selected.usageCount}</b>{t('Usos')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base text-emerald-300">{selected.correctCount}</b>{t('Aciertos')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base text-red-300">{selected.incorrectCount}</b>{t('Errores')}</div><div className="rounded-lg bg-neutral-900 p-2"><b className="block text-base">{successRate == null ? '—' : `${successRate}%`}</b>{t('Dificultad real')}</div></div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.updateStudyQuestion(selected.id, { favorite: !selected.favorite }))}><Icon name="star" />{t(selected.favorite ? 'Quitar favorito' : 'Favorita')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.updateStudyQuestion(selected.id, { status: selected.status === 'approved' ? 'pending' : 'approved', locked: selected.status !== 'approved' }))}><Icon name={selected.status === 'approved' ? 'unlock' : 'check'} />{t(selected.status === 'approved' ? 'Reabrir' : 'Aprobar y bloquear')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.duplicateStudyQuestion(selected.id))}><Icon name="copy" />{t('Crear variante')}</button>
            <button className="btn btn-ghost" onClick={() => void mutate(() => window.nodus.setStudyQuestionLifecycle(selected.id, 'archive'))}><Icon name="archive" />{t('Archivar')}</button>
            {confirmDelete === selected.id ? <><button className="btn btn-ghost text-red-300" onClick={() => void mutate(() => window.nodus.setStudyQuestionLifecycle(selected.id, 'delete')).then(() => setConfirmDelete(null))}>{t('Confirmar eliminación')}</button><button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>{t('Cancelar')}</button></> : <button className="btn btn-ghost text-red-400" onClick={() => setConfirmDelete(selected.id)}><Icon name="trash" />{t('Eliminar')}</button>}
          </div>
          <section className="mt-6 border-t border-neutral-800 pt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">{t('Colecciones')}</h3><div className="mt-2 flex gap-2"><input className="input flex-1" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t('Nueva colección')} /><button className="btn btn-ghost" disabled={!collectionName.trim()} onClick={() => void mutate(() => window.nodus.createStudyQuestionCollection(collectionName)).then(() => setCollectionName(''))}><Icon name="folderPlus" />{t('Crear')}</button></div>{collections.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{collections.map((collection) => <button key={collection.id} className="rounded bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400" onClick={() => void mutate(() => window.nodus.setStudyQuestionCollectionItems(collection.id, [selected.id]))}>{collection.name} · {collection.questionCount}</button>)}</div>}</section>
        </> : <div className="flex h-full items-center justify-center text-sm text-neutral-600">{t('Selecciona o crea una pregunta.')}</div>}</main>
      </div>}
    </div>
  );
}
