import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  StudyAssessment,
  StudyAssessmentSelection,
  StudyAttempt,
  StudyQuestion,
  StudyQuestionResponse,
  StudyQuestionType,
  StudyWorkspace,
} from '@shared/types';
import { STUDY_QUESTION_TYPES } from '@shared/studyQuestions';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

const TYPE_LABELS: Record<StudyQuestionType, string> = {
  short: 'Respuesta corta', essay: 'Desarrollo', definition: 'Definición', relation: 'Relación', comparison: 'Comparación', commentary: 'Comentario',
  case: 'Caso práctico', true_false: 'Verdadero / falso', single_choice: 'Elección simple', multiple_choice: 'Elección múltiple', fill_blank: 'Completar huecos',
  ordering: 'Ordenación', matching: 'Emparejamiento',
};

function formatTime(seconds: number) { return `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.max(0, seconds % 60).toString().padStart(2, '0')}`; }

function responseFor(answer: StudyAttempt['answers'][number] | undefined): StudyQuestionResponse { return answer?.response ?? {}; }

export function StudyTestView({ onOpenQuestionBank }: { onOpenQuestionBank: () => void }) {
  const [tests, setTests] = useState<StudyAssessment[]>([]);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [builder, setBuilder] = useState(false);
  const [title, setTitle] = useState('Test de repaso');
  const [selection, setSelection] = useState<StudyAssessmentSelection>('adaptive');
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [subjectId, setSubjectId] = useState('');
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [questionType, setQuestionType] = useState<StudyQuestionType | 'all'>('all');
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [correctionMode, setCorrectionMode] = useState<'immediate' | 'end'>('immediate');
  const [negativePoints, setNegativePoints] = useState(0);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [active, setActive] = useState<StudyAttempt | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, StudyQuestionResponse>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const [nextTests, nextQuestions, nextWorkspace, nextAttempts] = await Promise.all([
      window.nodus.listStudyAssessments('test'), window.nodus.listStudyQuestions({ status: 'approved' }), window.nodus.getStudyWorkspace(), window.nodus.listStudyAttempts(),
    ]);
    setTests(nextTests); setQuestions(nextQuestions); setWorkspace(nextWorkspace); setAttempts(nextAttempts.filter((attempt) => attempt.assessment?.kind === 'test'));
    setSelectedId((current) => current && nextTests.some((test) => test.id === current) ? current : nextTests[0]?.id ?? null);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [load]);

  const selected = tests.find((test) => test.id === selectedId) ?? null;
  const orderedItems = useMemo(() => active?.config.questionOrder.flatMap((id) => active.assessment?.items.find((item) => item.id === id) ?? []) ?? [], [active]);
  const current = orderedItems[currentIndex] ?? null;
  const currentAnswer = active?.answers.find((answer) => answer.assessmentItemId === current?.id);
  const currentResponse = current ? (drafts[current.id] ?? responseFor(currentAnswer)) : {};
  const remaining = active?.assessment?.durationMinutes ? active.assessment.durationMinutes * 60 - elapsed : null;

  useEffect(() => {
    if (!active || active.status !== 'in_progress') return;
    const started = Date.parse(active.startedAt);
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [active]);

  const submit = useCallback(async (expired = false) => {
    if (!active || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (current) await window.nodus.saveStudyAttemptAnswer(active.id, { assessmentItemId: current.id, response: drafts[current.id] ?? responseFor(currentAnswer), responseMs: elapsed * 1000, flagged: flags[current.id] ?? currentAnswer?.flagged, confidence: confidence[current.id] ?? currentAnswer?.confidence });
      const result = await window.nodus.submitStudyAttempt(active.id, expired); setActive(result); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submitting.current = false; setBusy(false); }
  }, [active, confidence, current, currentAnswer, drafts, elapsed, flags, load]);
  useEffect(() => { if (remaining != null && remaining <= 0 && active?.status === 'in_progress') void submit(true); }, [active?.status, remaining, submit]);

  const createTest = async () => {
    setBusy(true); setError('');
    try {
      const created = await window.nodus.buildStudyTest({
        title, kind: 'test', count: questionCount, selection, questionIds: selection === 'manual' ? manualIds : undefined,
        subjectId: subjectId || null, durationMinutes: durationMinutes || null, difficulty, questionTypes: questionType === 'all' ? undefined : [questionType],
        config: { correctionMode, negativePoints, blankPoints: 0, randomizeQuestions, randomizeOptions: randomizeQuestions, showExplanations: true },
      });
      setBuilder(false); setSelectedId(created.id); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const start = async (test: StudyAssessment, mode: 'practice' | 'exam' = 'practice', retryKind?: 'all' | 'errors' | 'flagged', sourceAttemptId?: string) => {
    setBusy(true); setError('');
    try {
      const next = await window.nodus.startStudyAttempt({ assessmentId: test.id, mode, retryKind, sourceAttemptId });
      setActive(next); setDrafts({}); setFlags({}); setConfidence({}); setCurrentIndex(0); setElapsed(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const saveAndMove = async (nextIndex: number) => {
    if (!active || !current) return;
    setBusy(true);
    try {
      const saved = await window.nodus.saveStudyAttemptAnswer(active.id, {
        assessmentItemId: current.id, response: currentResponse, responseMs: elapsed * 1000,
        flagged: flags[current.id] ?? currentAnswer?.flagged, confidence: confidence[current.id] ?? currentAnswer?.confidence,
      });
      setActive({ ...active, answers: [...active.answers.filter((answer) => answer.id !== saved.id), saved] }); setCurrentIndex(nextIndex);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (active) {
    if (active.status !== 'in_progress') {
      const scorePercent = active.maxScore ? Math.round((active.score ?? 0) / active.maxScore * 100) : 0;
      return <div className="h-full overflow-y-auto p-6" data-testid="study-test-results">
        <div className="mx-auto max-w-4xl"><button className="btn btn-ghost mb-4" onClick={() => setActive(null)}><Icon name="arrowLeft" />{t('Volver a tests')}</button>
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center"><p className="text-xs uppercase tracking-widest text-teal-400">{active.status === 'expired' ? t('Tiempo agotado') : t('Intento completado')}</p><h1 className="mt-2 text-3xl font-semibold">{active.assessment?.title}</h1><p className="mt-4 text-5xl font-bold text-teal-300">{scorePercent}%</p><p className="mt-2 text-sm text-neutral-500">{active.score?.toFixed(2)} / {active.maxScore?.toFixed(2)} {t('puntos')}</p>
            <div className="mx-auto mt-6 grid max-w-xl grid-cols-3 gap-3"><div className="rounded-xl bg-emerald-950/30 p-3"><b className="block text-2xl text-emerald-300">{active.correctCount}</b>{t('Aciertos')}</div><div className="rounded-xl bg-red-950/30 p-3"><b className="block text-2xl text-red-300">{active.incorrectCount}</b>{t('Errores')}</div><div className="rounded-xl bg-neutral-950 p-3"><b className="block text-2xl">{active.omittedCount}</b>{t('En blanco')}</div></div>
            <div className="mt-6 flex flex-wrap justify-center gap-2"><button className="btn btn-primary" onClick={() => void start(active.assessment!, 'practice', 'all', active.id)}>{t('Repetir todo')}</button>{active.incorrectCount > 0 && <button className="btn btn-secondary" onClick={() => void start(active.assessment!, 'practice', 'errors', active.id)}>{t('Repetir errores')}</button>}{active.answers.some((answer) => answer.flagged) && <button className="btn btn-ghost" onClick={() => void start(active.assessment!, 'practice', 'flagged', active.id)}>{t('Repetir dudosas')}</button>}</div>
          </section>
          <div className="mt-5 space-y-3">{active.config.questionOrder.map((itemId, index) => { const item = active.assessment?.items.find((candidate) => candidate.id === itemId); const answer = active.answers.find((candidate) => candidate.assessmentItemId === itemId); if (!item) return null; const feedback = answer?.feedback as { correct?: boolean; expected?: string; feedback?: string }; return <article key={item.id} className="rounded-xl border border-neutral-800 p-4"><div className="flex gap-2"><span className="text-neutral-600">{index + 1}.</span><p className="font-medium">{item.question.prompt}</p><span className={`ml-auto text-xs ${feedback.correct ? 'text-emerald-300' : 'text-red-300'}`}>{feedback.feedback}</span></div><p className="mt-2 text-sm text-neutral-500">{t('Tu respuesta')}: {String(answer?.response.text ?? answer?.response.value ?? '—')}</p><p className="mt-1 text-sm text-emerald-300">{t('Respuesta esperada')}: {feedback.expected}</p>{active.assessment?.config.showExplanations && <p className="mt-2 border-l-2 border-teal-800 pl-3 text-xs text-neutral-400">{item.question.explanation}<br />{item.question.source.title}: “{item.question.source.excerpt}”</p>}</article>; })}</div>
        </div>
      </div>;
    }
    if (!current) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando intento…')} /></div>;
    const optionIds = active.config.optionOrder[current.id] ?? current.question.options.map((option) => option.id);
    const options = optionIds.flatMap((id) => current.question.options.find((option) => option.id === id) ?? []);
    const setResponse = (response: StudyQuestionResponse) => setDrafts((value) => ({ ...value, [current.id]: response }));
    const immediate = active.mode === 'practice' && active.assessment?.config.correctionMode === 'immediate' ? currentAnswer?.feedback as { feedback?: string; expected?: string; correct?: boolean } : null;
    return <div className="flex h-full min-h-0 flex-col" data-testid="study-test-runner">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/70 px-4 py-3"><div><p className="text-[10px] uppercase tracking-widest text-teal-400">{active.mode === 'exam' ? t('Modo examen') : t('Modo práctica')}</p><h1 className="font-semibold">{active.assessment?.title}</h1></div><span className="ml-auto text-xs text-neutral-500">{currentIndex + 1} / {orderedItems.length}</span>{remaining != null && <span className={`rounded-lg px-3 py-1 font-mono text-sm ${remaining < 60 ? 'bg-red-950 text-red-300' : 'bg-neutral-900'}`}><Icon name="clock" /> {formatTime(remaining)}</span>}<button className="btn btn-ghost text-red-300" onClick={() => void submit()}>{t('Entregar')}</button></header>
      <div className="h-1 bg-neutral-900"><div className="h-full bg-teal-600 transition-all" style={{ width: `${(currentIndex + 1) / orderedItems.length * 100}%` }} /></div>
      {error && <p className="mx-4 mt-3 rounded-lg border border-red-900 bg-red-950/20 p-2 text-xs text-red-300">{error}</p>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5"><article className="mx-auto max-w-3xl"><div className="flex items-center gap-2 text-xs text-neutral-600"><span>{t(TYPE_LABELS[current.question.type])}</span><span>·</span><span>{current.points} {t('puntos')}</span><button className={`btn btn-ghost ml-auto h-8 ${flags[current.id] ?? currentAnswer?.flagged ? 'text-amber-300' : ''}`} onClick={() => setFlags((value) => ({ ...value, [current.id]: !(value[current.id] ?? currentAnswer?.flagged) }))}><Icon name="star" />{t('Marcar dudosa')}</button></div><h2 className="mt-5 text-xl leading-8">{current.question.prompt}</h2>
        <div className="mt-6">
          {current.question.type === 'true_false' ? <div className="grid grid-cols-2 gap-3">{[{ label: 'Verdadero', value: true }, { label: 'Falso', value: false }].map((option) => <button key={option.label} className={`rounded-xl border p-4 ${currentResponse.value === option.value ? 'border-teal-600 bg-teal-950/30' : 'border-neutral-800'}`} onClick={() => setResponse({ value: option.value })}>{t(option.label)}</button>)}</div>
          : ['single_choice', 'multiple_choice'].includes(current.question.type) ? <div className="space-y-2">{options.map((option) => { const selectedValues = Array.isArray(currentResponse.value) ? currentResponse.value : []; const checked = current.question.type === 'multiple_choice' ? selectedValues.includes(option.id) : currentResponse.value === option.id; return <button key={option.id} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${checked ? 'border-teal-600 bg-teal-950/30' : 'border-neutral-800 hover:border-neutral-700'}`} onClick={() => setResponse({ value: current.question.type === 'multiple_choice' ? (checked ? selectedValues.filter((id) => id !== option.id) : [...selectedValues, option.id]) : option.id })}><span className={`flex h-5 w-5 items-center justify-center border ${current.question.type === 'multiple_choice' ? 'rounded' : 'rounded-full'} ${checked ? 'border-teal-500 bg-teal-600' : 'border-neutral-600'}`}>{checked && <Icon name="check" size={12} />}</span>{option.text}</button>; })}</div>
          : <textarea data-testid="study-test-response" className="input min-h-40 w-full" value={currentResponse.text ?? ''} onChange={(event) => setResponse({ text: event.target.value })} placeholder={t('Escribe tu respuesta…')} />}
        </div>
        {immediate?.feedback && <div className={`mt-4 rounded-xl border p-4 ${immediate.correct ? 'border-emerald-800 bg-emerald-950/20' : 'border-red-900 bg-red-950/20'}`}><strong className={immediate.correct ? 'text-emerald-300' : 'text-red-300'}>{immediate.feedback}</strong><p className="mt-1 text-sm text-neutral-400">{t('Respuesta esperada')}: {immediate.expected}</p><p className="mt-2 text-xs text-neutral-500">{current.question.explanation}</p></div>}
        <div className="mt-6 flex items-center gap-2"><span className="text-xs text-neutral-600">{t('Confianza')}:</span>{[1, 2, 3].map((value) => <button key={value} className={`rounded px-2 py-1 text-xs ${confidence[current.id] === value ? 'bg-teal-800 text-teal-100' : 'bg-neutral-900 text-neutral-500'}`} onClick={() => setConfidence((currentValue) => ({ ...currentValue, [current.id]: value }))}>{value}</button>)}</div>
      </article></main>
      <footer className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3 pr-32"><button className="btn btn-ghost" disabled={currentIndex === 0 || busy} onClick={() => void saveAndMove(currentIndex - 1)}><Icon name="chevronLeft" />{t('Anterior')}</button>{currentIndex < orderedItems.length - 1 ? <button data-testid="study-test-next" className="btn btn-primary" disabled={busy} onClick={() => void saveAndMove(currentIndex + 1)}>{t('Siguiente')}<Icon name="chevronRight" /></button> : <button data-testid="study-test-submit" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{t('Entregar')}</button>}<div className="ml-auto flex max-w-[45%] gap-1 overflow-x-auto">{orderedItems.map((item, index) => <button key={item.id} className={`h-7 min-w-7 rounded text-xs ${index === currentIndex ? 'bg-teal-700' : active.answers.some((answer) => answer.assessmentItemId === item.id) ? 'bg-neutral-700' : 'bg-neutral-900 text-neutral-600'}`} onClick={() => void saveAndMove(index)}>{index + 1}</button>)}</div></footer>
    </div>;
  }

  return <div className="flex h-full min-h-0 flex-col" data-testid="study-tests-view">
    <header className="border-b border-neutral-800 bg-neutral-950/70 px-4 py-3"><div className="flex items-center gap-2"><div className="mr-auto"><p className="text-[10px] uppercase tracking-widest text-teal-400">{t('Evaluación')}</p><h1 className="text-xl font-semibold">{t('Tests')}</h1></div><button className="btn btn-ghost" onClick={onOpenQuestionBank}><Icon name="help" />{t('Banco de preguntas')}</button><button data-testid="study-test-new" className="btn btn-primary" onClick={() => setBuilder(!builder)}><Icon name="plus" />{t('Nuevo test')}</button></div></header>
    {error && <p className="mx-4 mt-3 rounded-lg border border-red-900 bg-red-950/20 p-2 text-xs text-red-300">{error}</p>}
    {builder && <section className="m-4 rounded-xl border border-teal-900/60 bg-teal-950/15 p-4" data-testid="study-test-builder"><div className="grid gap-3 md:grid-cols-4"><label className="text-xs text-neutral-500 md:col-span-2">{t('Título')}<input data-testid="study-test-title" className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="text-xs text-neutral-500">{t('Selección')}<select className="input mt-1 w-full" value={selection} onChange={(event) => setSelection(event.target.value as StudyAssessmentSelection)}><option value="adaptive">{t('Adaptativa (prioriza fallos)')}</option><option value="random">{t('Aleatoria')}</option><option value="manual">{t('Manual')}</option></select></label><label className="text-xs text-neutral-500">{t('Preguntas')}<input className="input mt-1 w-full" type="number" min="1" max="200" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label><label className="text-xs text-neutral-500">{t('Duración (min)')}<input className="input mt-1 w-full" type="number" min="0" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label><label className="text-xs text-neutral-500">{t('Asignatura')}<select className="input mt-1 w-full" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">{t('Todas')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Dificultad')}<select className="input mt-1 w-full" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>{['mixed', 'easy', 'medium', 'hard'].map((value) => <option key={value} value={value}>{t(value === 'mixed' ? 'Mixta' : value === 'easy' ? 'Fácil' : value === 'medium' ? 'Media' : 'Difícil')}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Tipo')}<select className="input mt-1 w-full" value={questionType} onChange={(event) => setQuestionType(event.target.value as typeof questionType)}><option value="all">{t('Todos')}</option>{STUDY_QUESTION_TYPES.map((value) => <option key={value} value={value}>{t(TYPE_LABELS[value])}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Corrección')}<select className="input mt-1 w-full" value={correctionMode} onChange={(event) => setCorrectionMode(event.target.value as typeof correctionMode)}><option value="immediate">{t('Inmediata')}</option><option value="end">{t('Al finalizar')}</option></select></label><label className="text-xs text-neutral-500">{t('Penalización por fallo')}<input className="input mt-1 w-full" type="number" min="0" step="0.05" value={negativePoints} onChange={(event) => setNegativePoints(Number(event.target.value))} /></label></div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-400"><label><input type="checkbox" checked={randomizeQuestions} onChange={(event) => setRandomizeQuestions(event.target.checked)} /> {t('Barajar preguntas y opciones')}</label></div>
      {selection === 'manual' && <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto md:grid-cols-2">{questions.map((question) => <label key={question.id} className="flex gap-2 rounded-lg border border-neutral-800 p-2 text-xs"><input type="checkbox" checked={manualIds.includes(question.id)} onChange={(event) => setManualIds(event.target.checked ? [...manualIds, question.id] : manualIds.filter((id) => id !== question.id))} /><span>{question.prompt}</span></label>)}</div>}
      <div className="mt-4 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setBuilder(false)}>{t('Cancelar')}</button><button data-testid="study-test-create" className="btn btn-primary" disabled={busy || !title.trim() || (selection === 'manual' && !manualIds.length)} onClick={() => void createTest()}>{busy ? <Spinner label={t('Creando…')} /> : t('Crear test')}</button></div></section>}
    {!builder && <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,0.8fr)_minmax(440px,1.4fr)]"><aside className="min-h-0 overflow-y-auto border-r border-neutral-800 p-3">{tests.map((test) => <button key={test.id} className={`mb-2 w-full rounded-xl border p-3 text-left ${selectedId === test.id ? 'border-teal-700 bg-teal-950/25' : 'border-neutral-800 bg-neutral-900/30'}`} onClick={() => setSelectedId(test.id)}><p className="font-medium">{test.title}</p><p className="mt-1 text-xs text-neutral-600">{test.items.length} {t('preguntas')} · {test.durationMinutes ?? '∞'} min · {test.attemptCount} {t('intentos')}</p></button>)}{!tests.length && <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-600">{t('Crea tu primer test con preguntas aprobadas del banco.')}</div>}</aside><main className="min-h-0 overflow-y-auto p-5">{selected ? <><div className="flex items-center gap-2"><span className="rounded bg-teal-950 px-2 py-1 text-xs text-teal-300">{selected.shortId}</span><button className="btn btn-ghost ml-auto" onClick={() => void window.nodus.exportStudyAssessment(selected.id)}><Icon name="download" />{t('Exportar / imprimir')}</button></div><h2 className="mt-3 text-2xl font-semibold">{selected.title}</h2><p className="mt-2 text-sm text-neutral-500">{selected.description}</p><div className="mt-5 grid grid-cols-4 gap-2 text-center"><div className="rounded-xl bg-neutral-900 p-3"><b className="block text-xl">{selected.items.length}</b><span className="text-xs text-neutral-500">{t('Preguntas')}</span></div><div className="rounded-xl bg-neutral-900 p-3"><b className="block text-xl">{selected.durationMinutes ?? '∞'}</b><span className="text-xs text-neutral-500">min</span></div><div className="rounded-xl bg-neutral-900 p-3"><b className="block text-xl">{selected.config.negativePoints}</b><span className="text-xs text-neutral-500">{t('Penalización')}</span></div><div className="rounded-xl bg-neutral-900 p-3"><b className="block text-xl">{selected.attemptCount}</b><span className="text-xs text-neutral-500">{t('Intentos')}</span></div></div><div className="mt-5 flex flex-wrap gap-2"><button data-testid="study-test-start" className="btn btn-primary" disabled={busy} onClick={() => void start(selected, 'practice')}><Icon name="play" />{t('Practicar')}</button><button className="btn btn-secondary" disabled={busy} onClick={() => void start(selected, 'exam')}><Icon name="clock" />{t('Simular examen')}</button><button className="btn btn-ghost" onClick={() => void window.nodus.updateStudyAssessment(selected.id, { favorite: !selected.favorite }).then(load)}><Icon name="star" />{t('Favorito')}</button></div><section className="mt-6"><h3 className="text-xs uppercase tracking-widest text-neutral-600">{t('Preguntas incluidas')}</h3><div className="mt-2 space-y-2">{selected.items.map((item, index) => <div key={item.id} className="flex gap-3 rounded-lg border border-neutral-800 p-3 text-sm"><span className="text-neutral-600">{index + 1}</span><span>{item.question.prompt}</span><span className="ml-auto text-xs text-neutral-600">{item.points} pt</span></div>)}</div></section><section className="mt-6"><h3 className="text-xs uppercase tracking-widest text-neutral-600">{t('Historial')}</h3><div className="mt-2 space-y-2">{attempts.filter((attempt) => attempt.assessmentId === selected.id).map((attempt) => <button key={attempt.id} className="flex w-full items-center rounded-lg bg-neutral-900 px-3 py-2 text-left text-xs" onClick={() => setActive(attempt)}><span>{new Date(attempt.startedAt).toLocaleString()}</span><span className="ml-auto">{attempt.status === 'in_progress' ? t('Continuar') : `${attempt.score?.toFixed(1)} / ${attempt.maxScore?.toFixed(1)}`}</span></button>)}</div></section></> : <div className="flex h-full items-center justify-center text-sm text-neutral-600">{t('Selecciona o crea un test.')}</div>}</main></div>}
  </div>;
}
