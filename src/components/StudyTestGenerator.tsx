import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyAssistantSourceOption, StudyAttempt, StudyFlashcard, StudyGradingRun, StudyQuestion, StudyRubric, StudyWorkspace } from '@shared/types';
import { Icon, Spinner } from './ui';
import { t } from '../i18n';
import { studyQuestionGenerationEmptyMessage } from '../studyQuestions';

export interface StudyTestScope { courseId?: string | null; subjectId?: string | null; folderId?: string | null; topicId?: string | null }
type AssessmentKind = 'test' | 'exam' | 'flashcards';
interface Choice { key: string; label: string; subtitle: string; kind: 'course' | 'subject' | 'folder' | 'topic' | 'source'; depth: number }
const CHOICE_KIND_LABEL: Record<Choice['kind'], string> = { course: 'Curso', subject: 'Asignatura', folder: 'Carpeta', topic: 'Tema', source: 'Material individual' };

function ContentMultiSelect({ workspace, sources, scope, value, onChange }: { workspace: StudyWorkspace; sources: StudyAssistantSourceOption[]; scope: StudyTestScope; value: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false); const [search, setSearch] = useState(''); const [showNestedContent, setShowNestedContent] = useState(false);
  const choices = useMemo<Choice[]>(() => {
    const result: Choice[] = [];
    for (const course of workspace.courses) {
      result.push({ key: `course:${course.id}`, label: course.name, subtitle: t('Curso completo'), kind: 'course', depth: 0 });
      for (const subject of workspace.subjects.filter((item) => item.courseId === course.id)) {
        result.push({ key: `subject:${subject.id}`, label: subject.name, subtitle: course.name, kind: 'subject', depth: 1 });
        for (const topic of workspace.topics.filter((item) => item.subjectId === subject.id)) result.push({ key: `topic:${topic.id}`, label: topic.name, subtitle: subject.name, kind: 'topic', depth: 2 });
        if (showNestedContent) for (const source of sources.filter((item) => ['document', 'material', 'transcript'].includes(item.kind) && item.scope.subjectId === subject.id)) result.push({ key: `source:${source.sourceKey}`, label: source.title, subtitle: source.subtitle || t(source.kind === 'material' ? 'Material' : source.kind === 'document' ? 'Apunte' : 'Transcripción'), kind: 'source', depth: source.scope.topicId ? 3 : 2 });
      }
    }
    return result;
  }, [showNestedContent, sources, workspace]);
  useEffect(() => {
    if (value.length || !choices.length) return;
    const initial = scope.topicId ? `topic:${scope.topicId}` : scope.subjectId ? `subject:${scope.subjectId}` : scope.courseId ? `course:${scope.courseId}` : '';
    if (initial && choices.some((choice) => choice.key === initial)) onChange([initial]);
  }, [choices, onChange, scope, value.length]);
  const visible = choices.filter((choice) => !search.trim() || `${choice.label} ${choice.subtitle}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const labels = value.flatMap((key) => choices.find((choice) => choice.key === key)?.label ?? []);
  return <div className="relative">
    <button data-testid="study-content-selector" type="button" className="input flex min-h-10 w-full items-center gap-2 text-left" onClick={() => setOpen((current) => !current)}><Icon name="layers" size={14} /><span className="min-w-0 flex-1 truncate">{labels.length ? labels.join(' · ') : t('Selecciona asignaturas, carpetas o materiales')}</span><span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">{value.length}</span><Icon name="chevronDown" size={12} /></button>
    {open && <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-neutral-700 bg-white p-3 shadow-2xl dark:bg-neutral-950">
      <div className="relative"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input autoFocus className="input input-with-leading-icon w-full text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(showNestedContent ? 'Buscar curso, asignatura, tema o contenido…' : 'Buscar curso, asignatura o tema…')} /></div>
      <label data-testid="study-content-show-nested" className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 px-2.5 py-2 text-xs text-neutral-400"><input className="study-app-checkbox" type="checkbox" checked={showNestedContent} onChange={(event) => setShowNestedContent(event.target.checked)} /><span>{t('Mostrar materiales y apuntes')}</span></label>
      <div className="mt-2 flex gap-2 text-[10px]"><button type="button" className="text-indigo-400" onClick={() => onChange([...new Set([...value, ...visible.map((choice) => choice.key)])])}>{t('Seleccionar visibles')}</button><button type="button" className="text-neutral-500" onClick={() => onChange([])}>{t('Limpiar selección')}</button></div>
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">{visible.map((choice) => <label key={choice.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-800 px-2 py-2 hover:border-indigo-700" style={{ marginLeft: `${choice.depth * 14}px` }}><input className="study-app-checkbox mt-0.5" type="checkbox" checked={value.includes(choice.key)} onChange={(event) => onChange(event.target.checked ? [...value, choice.key] : value.filter((key) => key !== choice.key))} /><span className="min-w-0"><span className="block truncate text-xs text-neutral-300">{choice.label}</span><span className="block truncate text-[10px] text-neutral-600">{t(CHOICE_KIND_LABEL[choice.kind])} · {choice.subtitle}</span></span></label>)}</div>
    </div>}
  </div>;
}

function selectedSourceKeys(keys: string[], sources: StudyAssistantSourceOption[]): string[] {
  const direct = new Set(keys.filter((key) => key.startsWith('source:')).map((key) => key.slice(7)));
  const aggregates = keys.filter((key) => !key.startsWith('source:')).map((key) => { const [kind, id] = key.split(':'); return { kind, id }; });
  for (const source of sources) if (aggregates.some(({ kind, id }) => kind === 'course' ? source.scope.courseId === id : kind === 'subject' ? source.scope.subjectId === id : kind === 'folder' ? source.scope.folderId === id : source.scope.topicId === id)) direct.add(source.sourceKey);
  return [...direct];
}

export function StudyTestGeneratorDialog({ kind = 'test', scope, scopeTitle, onCancel, onCreated }: { kind?: AssessmentKind; scope: StudyTestScope; scopeTitle: string; onCancel: () => void; onCreated: (questions: StudyQuestion[]) => void }) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null); const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]); const [selection, setSelection] = useState<string[]>([]);
  const [count, setCount] = useState(kind === 'exam' ? 3 : 10); const [countMode, setCountMode] = useState(String(kind === 'exam' ? 3 : 10)); const [optionCount, setOptionCount] = useState(4); const [customPrompt, setCustomPrompt] = useState('');
  const [flashcards, setFlashcards] = useState<StudyFlashcard[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [attempt, setAttempt] = useState<StudyAttempt>(null as unknown as StudyAttempt); const [rubric, setRubric] = useState<StudyRubric | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({}); const [grades, setGrades] = useState<Record<string, StudyGradingRun>>({}); const [gradingId, setGradingId] = useState<string | null>(null); const [finalAttempt, setFinalAttempt] = useState<StudyAttempt | null>(null);
  useEffect(() => { void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyAssistantSources(), window.nodus.listStudyRubrics()]).then(([nextWorkspace, nextSources, rubrics]) => { setWorkspace(nextWorkspace); setSources(nextSources); setRubric(rubrics.find((item) => item.name === 'Respuesta de desarrollo') ?? rubrics[0] ?? null); }); }, []);
  const sourceKeys = useMemo(() => selectedSourceKeys(selection, sources), [selection, sources]);

  const create = async () => {
    if (!sourceKeys.length) { setError(t('Selecciona al menos un contenido indexado.')); return; }
    setBusy(true); setError('');
    try {
      const generated = await window.nodus.generateStudyQuestions({ sourceKeys, count, optionCount: kind === 'test' ? optionCount : undefined, customPrompt: customPrompt.trim(), difficulty: 'mixed', cognitiveLevels: kind === 'flashcards' ? ['remember', 'understand'] : ['remember', 'understand', 'analyze', 'apply'], types: [kind === 'test' ? 'single_choice' : kind === 'exam' ? 'essay' : 'definition'] });
      if (!generated.questions.length) throw new Error(studyQuestionGenerationEmptyMessage(generated));
      const categoryTag = `nodus:${kind}`;
      const groupTag = `nodus-group:${kind}:${Date.now()}`;
      const saved: StudyQuestion[] = []; for (const question of generated.questions) saved.push(await window.nodus.createStudyQuestion({ ...question, tags: [...new Set([...(question.tags ?? []), categoryTag, groupTag])], generationPrompt: customPrompt.trim(), status: 'approved', locked: true }));
      if (kind === 'flashcards') {
        setFlashcards(await window.nodus.createStudyFlashcardsFromQuestions(saved.map((question) => question.id)));
        onCreated(saved);
        return;
      }
      const points = Object.fromEntries(saved.map((question) => [question.id, Math.round((10 / saved.length) * 100) / 100]));
      const assessment = kind === 'test' ? await window.nodus.buildStudyTest({ kind: 'test', title: `${t('Test')} · ${scopeTitle} · ${new Date().toLocaleDateString()}`, description: customPrompt.trim(), count: saved.length, selection: 'manual', questionIds: saved.map((question) => question.id), questionTypes: ['single_choice'], config: { correctionMode: 'end', randomizeQuestions: true, randomizeOptions: true, showExplanations: true } }) : await window.nodus.createStudyAssessment({ kind: 'exam', title: `${t('Examen')} · ${scopeTitle} · ${new Date().toLocaleDateString()}`, description: customPrompt.trim(), questionIds: saved.map((question) => question.id), points, config: { selection: 'manual', correctionMode: 'end', randomizeQuestions: false, randomizeOptions: false, showExplanations: true, negativePoints: 0, blankPoints: 0 } });
      onCreated(saved);
      if (kind === 'exam') setAttempt(await window.nodus.startStudyAttempt({ assessmentId: assessment.id, mode: 'exam' })); else onCancel();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const verify = async (itemId: string) => {
    if (!attempt || !rubric || !answers[itemId]?.trim()) return; setGradingId(itemId); setError('');
    try {
      const savedAnswer = await window.nodus.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: itemId, response: { text: answers[itemId] } });
      const run = await window.nodus.gradeStudyAnswer({ attemptAnswerId: savedAnswer.id, rubricId: rubric.id, severity: 'balanced' }, { onDelta: () => undefined });
      const confirmed = await window.nodus.setStudyGradingManualScore(run.id, run.estimatedScore ?? 0, run.result.generalFeedback);
      setGrades((current) => ({ ...current, [itemId]: confirmed }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setGradingId(null); }
  };
  const finish = async () => { if (!attempt) return; setBusy(true); try { setFinalAttempt(await window.nodus.submitStudyAttempt(attempt.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };

  return createPortal(<div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-5" onClick={() => { if (!busy && !gradingId) onCancel(); }}><div className={`card max-h-[92vh] w-full ${attempt ? 'max-w-5xl' : 'max-w-2xl'} overflow-y-auto p-5`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
    {!attempt && !flashcards.length ? <div className="space-y-4"><div><h2 className="text-base font-semibold">{t(kind === 'test' ? 'Crear test con IA' : kind === 'exam' ? 'Crear examen con IA' : 'Crear flashcards con IA')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Puedes combinar asignaturas, carpetas, temas y materiales individuales ya indexados.')}</p></div>
      <label className="block text-xs text-neutral-500">{t('Contenido seleccionado')}{workspace ? <div className="mt-1"><ContentMultiSelect workspace={workspace} sources={sources} scope={scope} value={selection} onChange={setSelection} /></div> : <Spinner label={t('Cargando contenidos…')} />}</label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t(kind === 'flashcards' ? 'Número de flashcards' : 'Número de preguntas')}<select className="input mt-1 w-full" value={countMode} onChange={(event) => { setCountMode(event.target.value); if (event.target.value !== 'custom') setCount(Number(event.target.value)); }}>{(kind === 'test' ? [10, 15, 20] : kind === 'flashcards' ? [10, 20, 30] : [3, 5, 10]).map((value) => <option key={value} value={value}>{value}</option>)}{kind !== 'test' && <option value="custom">{t('Personalizado')}</option>}</select>{countMode === 'custom' && <input className="input mt-2 w-full" type="number" min={1} max={40} value={count} onChange={(event) => setCount(Math.max(1, Math.min(40, Number(event.target.value) || 1)))} />}</label>{kind === 'test' && <label className="text-xs text-neutral-500">{t('Respuestas posibles por pregunta')}<input className="input mt-1 w-full" type="number" min={2} max={10} value={optionCount} onChange={(event) => setOptionCount(Math.max(2, Math.min(10, Number(event.target.value) || 4)))} /></label>}</div>
      <label className="block text-xs text-neutral-500">{t(kind === 'flashcards' ? 'Idea o tema para las flashcards (opcional)' : 'Indicaciones adicionales (opcional)')}<textarea className="input mt-1 min-h-24 w-full" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} /></label>{error && <p className="text-xs text-red-400">{error}</p>}<div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button><button data-testid="study-generate-submit" className="btn btn-primary" disabled={busy || !sourceKeys.length} onClick={() => void create()}>{busy ? <Spinner label={t('Generando y guardando…')} /> : <><Icon name={kind === 'test' ? 'checkSquare' : kind === 'flashcards' ? 'flashcards' : 'edit'} />{t(kind === 'test' ? 'Generar y crear test' : kind === 'exam' ? 'Generar examen' : 'Generar flashcards')}</>}</button></div></div> : flashcards.length ? <div data-testid="study-flashcards-result"><div className="flex items-start"><div><p className="text-[10px] uppercase tracking-widest text-teal-500">{t('Flashcards generadas')}</p><h2 className="text-xl font-semibold">{scopeTitle}</h2><p className="mt-1 text-xs text-neutral-500">{t('Se han guardado en el banco y están listas para revisar.')}</p></div><button className="btn btn-ghost ml-auto" onClick={onCancel}><Icon name="x" /></button></div><div className="mt-5 grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">{flashcards.map((card) => <article key={card.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50"><p className="text-sm font-semibold">{card.front}</p><div className="my-3 h-px bg-neutral-200 dark:bg-neutral-800"/><p className="text-sm text-emerald-700 dark:text-emerald-300">{card.back}</p></article>)}</div><div className="mt-5 flex justify-end"><button className="btn btn-primary" onClick={onCancel}>{t('Cerrar')}</button></div></div> : <div>
      <div className="flex items-start gap-3"><div className="mr-auto"><p className="text-[10px] uppercase tracking-widest text-teal-400">{t('Examen generado')}</p><h2 className="text-xl font-semibold">{attempt.assessment?.title}</h2><p className="mt-1 text-xs text-neutral-500">{t('Responde y verifica cada pregunta con IA. La nota total es sobre 10.')}</p></div><button className="btn btn-ghost" onClick={onCancel}><Icon name="x" /></button></div>
      {finalAttempt ? <section className="mt-8 rounded-2xl border border-teal-800 bg-teal-950/20 p-8 text-center"><p className="text-xs uppercase tracking-widest text-teal-400">{t('Calificación final')}</p><p className="mt-3 text-5xl font-semibold">{(Object.values(grades).reduce((sum, run) => sum + (run.manualScore ?? run.estimatedScore ?? 0), 0)).toFixed(2)} / 10</p><button className="btn btn-primary mt-6" onClick={onCancel}>{t('Cerrar examen')}</button></section> : <><div className="mt-5 space-y-4">{attempt.assessment?.items.map((item, index) => { const grade = grades[item.id]; return <article key={item.id} className="rounded-xl border border-neutral-800 p-4"><div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-900/40 text-xs text-teal-300">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex gap-3"><h3 className="flex-1 font-medium leading-6">{item.question.prompt}</h3><span className="text-xs text-neutral-500">{item.points.toFixed(2)} pt</span></div><div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><textarea className="input min-h-28 w-full" value={answers[item.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={t('Escribe una respuesta breve…')} /><button className="btn btn-primary self-end" disabled={gradingId != null || !answers[item.id]?.trim()} onClick={() => void verify(item.id)}>{gradingId === item.id ? <Spinner label={t('Verificando…')} /> : <><Icon name="wand" />{t(grade ? 'Verificar de nuevo' : 'Verificar')}</>}</button></div>{grade && <div className="mt-3 rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3"><div className="flex items-center"><span className="text-xs font-semibold uppercase text-indigo-300">{t('Valoración de la IA')}</span><strong className="ml-auto text-lg text-indigo-200">{(grade.manualScore ?? grade.estimatedScore ?? 0).toFixed(2)} / {item.points.toFixed(2)}</strong></div><p className="mt-2 text-sm text-neutral-300">{grade.result.generalFeedback}</p></div>}</div></div></article>; })}</div>{error && <p className="mt-3 text-xs text-red-400">{error}</p>}<div className="mt-5 flex justify-end"><button className="btn btn-primary" disabled={busy || Object.keys(grades).length !== attempt.assessment?.items.length} onClick={() => void finish()}><Icon name="check" />{t('Finalizar y calcular nota')}</button></div></>}
    </div>}
  </div></div>, document.body);
}

export function StudyGeneratedQuestionsTable({ questions }: { questions: StudyQuestion[] }) { if (!questions.length) return null; return <section className="px-5 pb-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-neutral-300">{t('Preguntas generadas')}</h2><span className="text-xs text-neutral-600">{questions.length}</span></div><div className="overflow-x-auto rounded-xl border border-neutral-800"><table className="w-full min-w-[840px] text-xs"><thead className="study-browser-table-head text-left"><tr><th className="px-4 py-2">{t('Pregunta')}</th><th className="px-3 py-2">{t('Respuesta correcta')}</th><th className="px-3 py-2">{t('Última respuesta')}</th><th className="px-3 py-2">{t('Última calificación')}</th><th className="px-3 py-2">{t('Generada')}</th></tr></thead><tbody>{questions.map((question) => <tr key={question.id} className="border-t border-neutral-800/70 align-top"><td className="px-4 py-3 font-medium text-neutral-300">{question.prompt}</td><td className="px-3 py-3 text-emerald-400">{question.options.find((option) => option.correct)?.text ?? question.answer.text}</td><td className="max-w-sm px-3 py-3 text-neutral-500">{question.lastResponse || '—'}</td><td className="px-3 py-3 text-indigo-300">{question.lastScore == null ? '—' : `${question.lastScore.toFixed(2)} / ${(question.lastMaxScore ?? 0).toFixed(2)}`}</td><td className="px-3 py-3 text-neutral-500">{new Date(question.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div></section>; }
