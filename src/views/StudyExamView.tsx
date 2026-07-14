import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StudyAssessment, StudyAttempt, StudyGradingRun, StudyGradingSeverity, StudyQuestion, StudyQuestionResponse, StudyRubric } from '@shared/types';
import { studyResponseWordCount } from '@shared/studyAssessments';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

function formatTime(seconds: number) { return `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.max(0, seconds % 60).toString().padStart(2, '0')}`; }

export function StudyExamView({ onOpenQuestionBank }: { onOpenQuestionBank: () => void }) {
  const [exams, setExams] = useState<StudyAssessment[]>([]);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [builder, setBuilder] = useState(false);
  const [title, setTitle] = useState('Simulacro escrito');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(90);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [points, setPoints] = useState<Record<string, number>>({});
  const [newPrompt, setNewPrompt] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [active, setActive] = useState<StudyAttempt | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, StudyQuestionResponse>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rubrics, setRubrics] = useState<StudyRubric[]>([]);
  const [gradingRuns, setGradingRuns] = useState<StudyGradingRun[]>([]);
  const [gradingAnswerId, setGradingAnswerId] = useState<string | null>(null);
  const [rubricId, setRubricId] = useState('');
  const [gradingSeverity, setGradingSeverity] = useState<StudyGradingSeverity>('balanced');
  const [gradingBusy, setGradingBusy] = useState(false);
  const [gradingProgress, setGradingProgress] = useState(0);
  const [manualScore, setManualScore] = useState(0);
  const [manualComment, setManualComment] = useState('');
  const [showRubrics, setShowRubrics] = useState(false);
  const [rubricName, setRubricName] = useState('');
  const autosave = useRef<number | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const [nextExams, nextQuestions, nextAttempts, nextRubrics, nextGradingRuns] = await Promise.all([
      window.nodus.listStudyAssessments('exam'), window.nodus.listStudyQuestions({ status: 'approved' }), window.nodus.listStudyAttempts(), window.nodus.listStudyRubrics(), window.nodus.listStudyGradingRuns(),
    ]);
    setExams(nextExams); setQuestions(nextQuestions); setAttempts(nextAttempts.filter((attempt) => attempt.assessment?.kind === 'exam'));
    setRubrics(nextRubrics); setGradingRuns(nextGradingRuns); setRubricId((current) => current && nextRubrics.some((rubric) => rubric.id === current) ? current : nextRubrics[0]?.id ?? '');
    setSelectedId((current) => current && nextExams.some((exam) => exam.id === current) ? current : nextExams[0]?.id ?? null);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [load]);
  const selected = exams.find((exam) => exam.id === selectedId) ?? null;
  const orderedItems = useMemo(() => active?.config.questionOrder.flatMap((id) => active.assessment?.items.find((item) => item.id === id) ?? []) ?? [], [active]);
  const current = orderedItems[currentIndex] ?? null;
  const persisted = active?.answers.find((answer) => answer.assessmentItemId === current?.id);
  const response = current ? drafts[current.id] ?? persisted?.response ?? {} : {};
  const remaining = active?.assessment?.durationMinutes ? active.assessment.durationMinutes * 60 - elapsed : null;

  useEffect(() => {
    if (!active || active.status !== 'in_progress') return;
    const started = Date.parse(active.startedAt); const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [active]);

  const saveCurrent = useCallback(async () => {
    if (!active || !current || active.status !== 'in_progress') return null;
    const saved = await window.nodus.saveStudyAttemptAnswer(active.id, {
      assessmentItemId: current.id, response, responseMs: elapsed * 1000, flagged: flags[current.id] ?? persisted?.flagged,
    });
    setActive((value) => value ? { ...value, answers: [...value.answers.filter((answer) => answer.id !== saved.id), saved] } : value);
    setSavedAt(new Date().toISOString()); return saved;
  }, [active, current, elapsed, flags, persisted?.flagged, response]);

  useEffect(() => {
    if (!active || !current || active.status !== 'in_progress' || drafts[current.id] == null) return;
    if (autosave.current) window.clearTimeout(autosave.current);
    autosave.current = window.setTimeout(() => void saveCurrent().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))), 900);
    return () => { if (autosave.current) window.clearTimeout(autosave.current); };
  }, [active, current, drafts, saveCurrent]);

  const submit = useCallback(async (expired = false) => {
    if (!active || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await saveCurrent(); const result = await window.nodus.submitStudyAttempt(active.id, expired); setActive(result); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submitting.current = false; setBusy(false); }
  }, [active, load, saveCurrent]);
  useEffect(() => { if (remaining != null && remaining <= 0 && active?.status === 'in_progress') void submit(true); }, [active?.status, remaining, submit]);

  const createExam = async () => {
    setBusy(true); setError('');
    try {
      const created = await window.nodus.createStudyAssessment({
        kind: 'exam', title, description, durationMinutes: duration || null, questionIds: selectedQuestions, points,
        config: { selection: 'manual', correctionMode: 'end', randomizeQuestions: false, randomizeOptions: false, showExplanations: true, negativePoints: 0, blankPoints: 0 },
      });
      setBuilder(false); setSelectedId(created.id); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const createDevelopmentQuestion = async () => {
    if (!newPrompt.trim() || !newAnswer.trim()) return;
    setBusy(true); setError('');
    try {
      const created = await window.nodus.createStudyQuestion({
        prompt: newPrompt, type: 'essay', difficulty: 'medium', cognitiveLevel: 'analyze', status: 'approved', answer: { text: newAnswer },
        explanation: newAnswer, source: { title: 'Pregunta de examen creada manualmente', excerpt: newAnswer }, locked: true,
      });
      setQuestions((value) => [created, ...value]); setSelectedQuestions((value) => [...value, created.id]); setPoints((value) => ({ ...value, [created.id]: 5 })); setNewPrompt(''); setNewAnswer('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const start = async (exam: StudyAssessment) => {
    setBusy(true); setError('');
    try { const attempt = await window.nodus.startStudyAttempt({ assessmentId: exam.id, mode: 'exam' }); setActive(attempt); setCurrentIndex(0); setDrafts({}); setFlags({}); setElapsed(0); setSavedAt(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const createVariant = async (exam: StudyAssessment) => {
    const variant = await window.nodus.createStudyAssessment({
      kind: 'exam', title: `${exam.title} · Variante ${exam.attemptCount + 2}`, description: exam.description, durationMinutes: exam.durationMinutes,
      questionIds: exam.items.map((item) => item.questionId), points: Object.fromEntries(exam.items.map((item) => [item.questionId, item.points])), config: { ...exam.config, seed: Date.now(), randomizeQuestions: true, randomizeOptions: true },
    });
    await load(); setSelectedId(variant.id);
  };

  const runGrading = async (answerId: string) => {
    if (!rubricId) return;
    setGradingBusy(true); setGradingProgress(0); setError('');
    try {
      const run = await window.nodus.gradeStudyAnswer({ attemptAnswerId: answerId, rubricId, severity: gradingSeverity }, { onDelta: (delta) => setGradingProgress((value) => value + delta.length) });
      setGradingRuns((value) => [run, ...value]); setManualScore(run.estimatedScore ?? 0); setManualComment('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setGradingBusy(false); }
  };

  const saveManualGrade = async (run: StudyGradingRun) => {
    setGradingBusy(true); setError('');
    try { const updated = await window.nodus.setStudyGradingManualScore(run.id, manualScore, manualComment); setGradingRuns((value) => value.map((item) => item.id === updated.id ? updated : item)); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setGradingBusy(false); }
  };

  const createRubric = async () => {
    if (!rubricName.trim()) return;
    const created = await window.nodus.createStudyRubric({ name: rubricName, description: 'Rúbrica personal para respuestas escritas.', criteria: [
      { id: 'content', label: 'Contenido', description: 'Exactitud, cobertura y dominio conceptual.', weight: 0.5 },
      { id: 'reasoning', label: 'Razonamiento', description: 'Relaciones, justificación y coherencia argumental.', weight: 0.3 },
      { id: 'clarity', label: 'Claridad', description: 'Estructura y precisión expresiva.', weight: 0.2 },
    ] });
    setRubricName(''); await load(); setRubricId(created.id);
  };

  if (active) {
    if (active.status !== 'in_progress') {
      const pending = active.answers.filter((answer) => answer.isCorrect == null && String(answer.response.text ?? '').trim()).length;
      return <div className="h-full overflow-y-auto p-6" data-testid="study-exam-results"><div className="mx-auto max-w-4xl"><button className="btn btn-ghost" onClick={() => setActive(null)}><Icon name="arrowLeft" />{t('Volver a exámenes')}</button><section className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center"><p className="text-xs uppercase tracking-widest text-teal-400">{active.status === 'expired' ? t('Tiempo agotado') : t('Simulacro entregado')}</p><h1 className="mt-2 text-3xl font-semibold">{active.assessment?.title}</h1><p className="mt-5 text-lg text-amber-300">{pending} {t('respuestas pendientes de corrección')}</p><p className="mt-2 text-sm text-neutral-500">{active.omittedCount} {t('en blanco')} · {Math.round(active.durationSeconds / 60)} min</p></section>{error && <p className="mt-3 rounded-lg border border-red-900 bg-red-950/20 p-2 text-xs text-red-300">{error}</p>}<div className="mt-5 space-y-3">{active.config.questionOrder.map((itemId, index) => { const item = active.assessment?.items.find((candidate) => candidate.id === itemId); const answer = active.answers.find((candidate) => candidate.assessmentItemId === itemId); if (!item) return null; const run = answer ? gradingRuns.find((candidate) => candidate.attemptAnswerId === answer.id) : null; const open = gradingAnswerId === answer?.id; return <article key={item.id} className="rounded-xl border border-neutral-800 p-4"><p className="font-medium">{index + 1}. {item.question.prompt} <span className="float-right text-xs text-neutral-600">{item.points} pt</span></p><p className="mt-3 whitespace-pre-wrap text-sm text-neutral-400">{answer?.response.text || '—'}</p><div className="mt-2 flex items-center gap-2"><span className="text-xs text-neutral-600">{studyResponseWordCount(answer?.response ?? {})} {t('palabras')}</span>{answer?.response.text && <button data-testid="study-grade-open" className="btn btn-ghost ml-auto h-8 text-xs" onClick={() => { setGradingAnswerId(open ? null : answer.id); setManualScore(run?.manualScore ?? run?.estimatedScore ?? 0); setManualComment(run?.manualComment ?? ''); }}><Icon name="wand" />{run ? t('Revisar corrección') : t('Corregir con IA')}</button>}</div>{open && answer && <section className="mt-4 rounded-xl border border-indigo-900/50 bg-indigo-950/15 p-4" data-testid="study-grading-panel"><div className="flex flex-wrap items-end gap-2"><label className="text-xs text-neutral-500">{t('Rúbrica')}<select className="input mt-1" value={rubricId} onChange={(event) => setRubricId(event.target.value)}>{rubrics.map((rubric) => <option key={rubric.id} value={rubric.id}>{rubric.name}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Exigencia')}<select className="input mt-1" value={gradingSeverity} onChange={(event) => setGradingSeverity(event.target.value as StudyGradingSeverity)}><option value="supportive">{t('Formativa')}</option><option value="balanced">{t('Equilibrada')}</option><option value="strict">{t('Estricta')}</option></select></label><button data-testid="study-grade-run" className="btn btn-primary" disabled={gradingBusy || !rubricId} onClick={() => void runGrading(answer.id)}>{gradingBusy ? <Spinner label={gradingProgress ? `${t('Analizando')} · ${gradingProgress}` : t('Preparando corrección…')} /> : t(run ? 'Volver a corregir' : 'Generar corrección')}</button>{gradingBusy && <button className="btn btn-ghost" onClick={() => void window.nodus.cancelStudyGrading()}>{t('Cancelar')}</button>}</div>{run && <div className="mt-4" data-testid="study-grading-result"><div className="flex items-end gap-2"><b className="text-3xl text-indigo-300">{run.estimatedScore?.toFixed(2)}</b><span className="pb-1 text-sm text-neutral-500">/ {run.result.maxScore} · {t('estimación')}</span><span className="ml-auto text-[10px] text-neutral-600">{run.model.provider} · {run.model.model}</span></div><p className="mt-3 text-sm text-neutral-300">{run.result.generalFeedback}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{run.result.criteria.map((grade) => { const criterion = rubrics.find((rubric) => rubric.id === run.rubricId)?.criteria.find((item) => item.id === grade.criterionId); return <div key={grade.criterionId} className="rounded-lg bg-neutral-950/60 p-3"><div className="flex text-xs"><b>{criterion?.label ?? grade.criterionId}</b><span className="ml-auto text-indigo-300">{Math.round(grade.score * 100)}%</span></div><p className="mt-1 text-xs text-neutral-500">{grade.rationale}</p></div>; })}</div>{run.result.errors.length > 0 && <p className="mt-3 text-xs text-red-300"><b>{t('Errores')}:</b> {run.result.errors.join(' · ')}</p>}{run.result.omissions.length > 0 && <p className="mt-2 text-xs text-amber-300"><b>{t('Omisiones')}:</b> {run.result.omissions.join(' · ')}</p>}<p className="mt-3 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500"><b>{t('Incertidumbre')}:</b> {run.result.uncertainty}</p><details className="mt-3"><summary className="cursor-pointer text-xs text-neutral-500">{t('Ver respuesta corregida')}</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-950 p-3 text-sm text-neutral-300">{run.result.correctedAnswer}</p></details><div className="mt-4 grid gap-2 md:grid-cols-[100px_1fr_auto]"><label className="text-xs text-neutral-500">{t('Nota final')}<input className="input mt-1 w-full" type="number" min="0" max={item.points} step="0.1" value={manualScore} onChange={(event) => setManualScore(Number(event.target.value))} /></label><label className="text-xs text-neutral-500">{t('Comentario manual')}<input className="input mt-1 w-full" value={manualComment} onChange={(event) => setManualComment(event.target.value)} /></label><button data-testid="study-grade-save" className="btn btn-primary self-end" onClick={() => void saveManualGrade(run)}>{t('Confirmar nota')}</button></div>{run.manualScore != null && <p className="mt-2 text-xs text-emerald-300">{t('Nota confirmada manualmente')}: {run.manualScore} / {item.points}</p>}</div>}</section>}</article>; })}</div></div></div>;
    }
    if (!current) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando simulacro…')} /></div>;
    return <div className="flex h-full min-h-0 flex-col" data-testid="study-exam-runner"><header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950/70 px-4 py-3"><div><p className="text-[10px] uppercase tracking-widest text-teal-400">{t('Simulacro escrito')}</p><h1 className="font-semibold">{active.assessment?.title}</h1></div><span className="ml-auto text-xs text-neutral-500">{savedAt ? t('Guardado automáticamente') : t('Autoguardado activo')}</span>{remaining != null && <span className={`rounded-lg px-3 py-1 font-mono ${remaining < 300 ? 'bg-red-950 text-red-300' : 'bg-neutral-900'}`}><Icon name="clock" /> {formatTime(remaining)}</span>}<button className="btn btn-ghost text-red-300" onClick={() => void submit()}>{t('Entregar examen')}</button></header>
      <main className="min-h-0 flex-1 overflow-y-auto p-6"><article className="mx-auto max-w-4xl"><div className="flex items-center gap-2 text-xs text-neutral-600"><span>{currentIndex + 1} / {orderedItems.length}</span><span>·</span><span>{current.points} {t('puntos')}</span><button className={`btn btn-ghost ml-auto ${flags[current.id] ?? persisted?.flagged ? 'text-amber-300' : ''}`} onClick={() => setFlags((value) => ({ ...value, [current.id]: !(value[current.id] ?? persisted?.flagged) }))}><Icon name="star" />{t('Marcar para revisar')}</button></div><h2 className="mt-5 text-xl leading-8">{current.question.prompt}</h2><textarea data-testid="study-exam-response" className="input mt-6 min-h-[360px] w-full resize-y leading-7" value={response.text ?? ''} onChange={(event) => setDrafts((value) => ({ ...value, [current.id]: { text: event.target.value } }))} placeholder={t('Desarrolla aquí tu respuesta…')} /><div className="mt-2 flex text-xs text-neutral-600"><span>{studyResponseWordCount(response)} {t('palabras')}</span><span className="ml-auto">{savedAt ? `${t('Último guardado')}: ${new Date(savedAt).toLocaleTimeString()}` : t('Los cambios se guardan mientras escribes.')}</span></div></article></main>
      <footer className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3 pr-32"><button className="btn btn-ghost" disabled={currentIndex === 0 || busy} onClick={() => void saveCurrent().then(() => setCurrentIndex(currentIndex - 1))}><Icon name="chevronLeft" />{t('Anterior')}</button><button className="btn btn-primary" disabled={currentIndex >= orderedItems.length - 1 || busy} onClick={() => void saveCurrent().then(() => setCurrentIndex(currentIndex + 1))}>{t('Siguiente')}<Icon name="chevronRight" /></button><div className="ml-auto flex gap-1">{orderedItems.map((item, index) => <button key={item.id} className={`h-7 w-7 rounded text-xs ${index === currentIndex ? 'bg-teal-700' : active.answers.some((answer) => answer.assessmentItemId === item.id) ? 'bg-neutral-700' : 'bg-neutral-900 text-neutral-600'}`} onClick={() => void saveCurrent().then(() => setCurrentIndex(index))}>{index + 1}</button>)}</div></footer></div>;
  }

  return <div className="flex h-full min-h-0 flex-col" data-testid="study-exams-view"><header className="border-b border-neutral-800 bg-neutral-950/70 px-4 py-3"><div className="flex items-center gap-2"><div className="mr-auto"><p className="text-[10px] uppercase tracking-widest text-teal-400">{t('Evaluación')}</p><h1 className="text-xl font-semibold">{t('Exámenes')}</h1></div><button className="btn btn-ghost" onClick={onOpenQuestionBank}><Icon name="help" />{t('Banco de preguntas')}</button><button data-testid="study-rubrics-open" className="btn btn-ghost" onClick={() => { setShowRubrics(!showRubrics); setBuilder(false); }}><Icon name="list" />{t('Rúbricas')}</button><button data-testid="study-exam-new" className="btn btn-primary" onClick={() => { setBuilder(!builder); setShowRubrics(false); }}><Icon name="plus" />{t('Nuevo simulacro')}</button></div></header>{error && <p className="mx-4 mt-3 rounded-lg border border-red-900 bg-red-950/20 p-2 text-xs text-red-300">{error}</p>}
    {showRubrics ? <section className="min-h-0 flex-1 overflow-y-auto p-5" data-testid="study-rubric-library"><div className="mx-auto max-w-4xl"><div className="flex gap-2"><input className="input flex-1" value={rubricName} onChange={(event) => setRubricName(event.target.value)} placeholder={t('Nombre de la rúbrica')} /><button className="btn btn-primary" disabled={!rubricName.trim()} onClick={() => void createRubric()}><Icon name="plus" />{t('Crear rúbrica')}</button></div><div className="mt-4 space-y-3">{rubrics.map((rubric) => <article key={rubric.id} className="rounded-xl border border-neutral-800 p-4"><div className="flex items-center"><h2 className="font-medium">{rubric.name}</h2>{rubric.builtIn && <span className="ml-2 rounded bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500">{t('Integrada')}</span>}<button className="btn btn-ghost ml-auto h-8 text-xs" onClick={() => void window.nodus.duplicateStudyRubric(rubric.id).then(load)}><Icon name="copy" />{t('Duplicar')}</button></div><p className="mt-1 text-xs text-neutral-500">{rubric.description}</p><div className="mt-3 space-y-2">{rubric.criteria.map((criterion) => <div key={criterion.id} className="grid grid-cols-[130px_1fr_48px] gap-2 text-xs"><b>{criterion.label}</b><span className="text-neutral-500">{criterion.description}</span><span className="text-right text-teal-300">{Math.round(criterion.weight * 100)}%</span></div>)}</div></article>)}</div></div></section>
    : builder ? <section className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="study-exam-builder"><div className="mx-auto max-w-5xl rounded-xl border border-teal-900/60 bg-teal-950/15 p-4"><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-neutral-500 md:col-span-2">{t('Título')}<input data-testid="study-exam-title" className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="text-xs text-neutral-500">{t('Duración (min)')}<input className="input mt-1 w-full" type="number" min="0" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label><label className="text-xs text-neutral-500 md:col-span-3">{t('Instrucciones')}<textarea className="input mt-1 min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
        <h2 className="mt-5 text-xs font-semibold uppercase tracking-widest text-neutral-500">{t('Elegir del banco')}</h2><div className="mt-2 grid max-h-56 gap-2 overflow-y-auto md:grid-cols-2">{questions.map((question) => { const checked = selectedQuestions.includes(question.id); return <label key={question.id} className={`flex gap-2 rounded-lg border p-3 text-xs ${checked ? 'border-teal-700 bg-teal-950/20' : 'border-neutral-800'}`}><input type="checkbox" checked={checked} onChange={(event) => { setSelectedQuestions(event.target.checked ? [...selectedQuestions, question.id] : selectedQuestions.filter((id) => id !== question.id)); if (event.target.checked && points[question.id] == null) setPoints((value) => ({ ...value, [question.id]: question.type === 'essay' ? 5 : 1 })); }} /><span className="flex-1">{question.prompt}</span>{checked && <input aria-label={t('Puntos')} className="input w-16" type="number" min="0" step="0.5" value={points[question.id] ?? 1} onChange={(event) => setPoints((value) => ({ ...value, [question.id]: Number(event.target.value) }))} />}</label>; })}</div>
        <h2 className="mt-5 text-xs font-semibold uppercase tracking-widest text-neutral-500">{t('Crear pregunta de desarrollo')}</h2><div className="mt-2 grid gap-2 md:grid-cols-2"><textarea className="input min-h-24" value={newPrompt} onChange={(event) => setNewPrompt(event.target.value)} placeholder={t('Enunciado de desarrollo')} /><textarea className="input min-h-24" value={newAnswer} onChange={(event) => setNewAnswer(event.target.value)} placeholder={t('Respuesta modelo y criterios esperados')} /></div><button className="btn btn-ghost mt-2" disabled={!newPrompt.trim() || !newAnswer.trim()} onClick={() => void createDevelopmentQuestion()}><Icon name="plus" />{t('Añadir al examen')}</button>
        <div className="mt-5 flex items-center justify-end gap-2"><span className="mr-auto text-xs text-neutral-500">{selectedQuestions.length} {t('preguntas')} · {selectedQuestions.reduce((sum, id) => sum + (points[id] ?? 1), 0)} {t('puntos')}</span><button className="btn btn-ghost" onClick={() => setBuilder(false)}>{t('Cancelar')}</button><button data-testid="study-exam-create" className="btn btn-primary" disabled={busy || !title.trim() || !selectedQuestions.length} onClick={() => void createExam()}>{t('Crear simulacro')}</button></div></div></section>
    : <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,0.8fr)_minmax(440px,1.4fr)]"><aside className="min-h-0 overflow-y-auto border-r border-neutral-800 p-3">{exams.map((exam) => <button key={exam.id} className={`mb-2 w-full rounded-xl border p-3 text-left ${selectedId === exam.id ? 'border-teal-700 bg-teal-950/25' : 'border-neutral-800 bg-neutral-900/30'}`} onClick={() => setSelectedId(exam.id)}><p className="font-medium">{exam.title}</p><p className="mt-1 text-xs text-neutral-600">{exam.items.length} {t('preguntas')} · {exam.items.reduce((sum, item) => sum + item.points, 0)} pt · {exam.durationMinutes ?? '∞'} min</p></button>)}{!exams.length && <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-600">{t('Crea un simulacro escrito a partir del banco o añade preguntas nuevas.')}</div>}</aside><main className="min-h-0 overflow-y-auto p-5">{selected ? <><div className="flex items-center"><span className="rounded bg-teal-950 px-2 py-1 text-xs text-teal-300">{selected.shortId}</span><button className="btn btn-ghost ml-auto" onClick={() => void window.nodus.exportStudyAssessment(selected.id)}><Icon name="download" />{t('Exportar / imprimir')}</button></div><h2 className="mt-3 text-2xl font-semibold">{selected.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-500">{selected.description}</p><div className="mt-5 flex flex-wrap gap-2"><button data-testid="study-exam-start" className="btn btn-primary" onClick={() => void start(selected)}><Icon name="play" />{t('Comenzar simulacro')}</button><button className="btn btn-secondary" onClick={() => void createVariant(selected)}><Icon name="copy" />{t('Crear variante')}</button><button className="btn btn-ghost" onClick={() => void window.nodus.exportStudyAssessment(selected.id, true)}><Icon name="download" />{t('Exportar con soluciones')}</button></div><section className="mt-6"><h3 className="text-xs uppercase tracking-widest text-neutral-600">{t('Ejercicios y puntuación')}</h3><div className="mt-2 space-y-2">{selected.items.map((item, index) => <div key={item.id} className="flex gap-3 rounded-lg border border-neutral-800 p-3 text-sm"><span className="text-neutral-600">{index + 1}</span><span>{item.question.prompt}</span><span className="ml-auto text-xs text-neutral-500">{item.points} pt</span></div>)}</div></section><section className="mt-6"><h3 className="text-xs uppercase tracking-widest text-neutral-600">{t('Historial de intentos')}</h3><div className="mt-2 space-y-2">{attempts.filter((attempt) => attempt.assessmentId === selected.id).map((attempt) => <button key={attempt.id} className="flex w-full rounded-lg bg-neutral-900 px-3 py-2 text-left text-xs" onClick={() => setActive(attempt)}><span>{new Date(attempt.startedAt).toLocaleString()}</span><span className="ml-auto">{attempt.status === 'in_progress' ? t('Continuar') : t('Entregado')}</span></button>)}</div></section></> : <div className="flex h-full items-center justify-center text-sm text-neutral-600">{t('Selecciona o crea un simulacro.')}</div>}</main></div>}
  </div>;
}
