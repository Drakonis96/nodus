import { useEffect, useMemo, useState } from 'react';
import type { StudyFlashcard, StudyQuestion, StudyWorkspace } from '@shared/types';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

type ReviewKind = 'test' | 'exam' | 'flashcards';
type ReviewItem = { id: string; front: string; back: string; card?: StudyFlashcard };

export function StudyReviewView() {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [cards, setCards] = useState<StudyFlashcard[]>([]);
  const [kind, setKind] = useState<ReviewKind>('flashcards');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [groupTag, setGroupTag] = useState('');
  const [count, setCount] = useState(10);
  const [source, setSource] = useState<'existing' | 'new'>('existing');
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<'setup' | 'session' | 'done'>('setup');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyQuestions({ status: 'approved' }), window.nodus.listStudyFlashcards()]).then(([nextWorkspace, nextQuestions, nextCards]) => { setWorkspace(nextWorkspace); setQuestions(nextQuestions); setCards(nextCards); }); }, []);
  const groups = useMemo(() => [...new Set((kind === 'flashcards' ? cards : questions).flatMap((item) => item.tags.filter((tag) => tag.startsWith(`nodus-group:${kind}:`))))].sort().reverse(), [cards, kind, questions]);
  const inScope = (item: { subjectId: string | null; topicId: string | null; tags: string[] }) => (!subjectId || item.subjectId === subjectId) && (!topicId || item.topicId === topicId) && (!groupTag || item.tags.includes(groupTag));
  const available = useMemo(() => kind === 'flashcards'
    ? cards.filter(inScope).length
    : questions.filter((question) => inScope(question) && (question.tags.includes(`nodus:${kind}`) || (!question.tags.some((tag) => tag.startsWith('nodus:')) && (kind === 'test' ? ['single_choice', 'multiple_choice', 'true_false'].includes(question.type) : true)))).length,
  [cards, groupTag, kind, questions, subjectId, topicId]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      let nextQuestions = questions;
      let nextCards = cards;
      if (source === 'new') {
        const sources = (await window.nodus.listStudyAssistantSources()).filter((entry) => (!subjectId || entry.scope.subjectId === subjectId) && (!topicId || entry.scope.topicId === topicId));
        if (!sources.length) throw new Error(t('No hay contenido indexado en este ámbito.'));
        const generated = await window.nodus.generateStudyQuestions({ sourceKeys: sources.map((entry) => entry.sourceKey), count, difficulty: 'mixed', cognitiveLevels: kind === 'flashcards' ? ['remember', 'understand'] : ['remember', 'understand', 'analyze', 'apply'], types: [kind === 'test' ? 'single_choice' : kind === 'exam' ? 'essay' : 'definition'], subjectId: subjectId || null, customPrompt: prompt.trim() });
        const saved: StudyQuestion[] = [];
        const nextGroupTag = `nodus-group:${kind}:${Date.now()}`;
        for (const question of generated.questions) saved.push(await window.nodus.createStudyQuestion({ ...question, tags: [...new Set([...(question.tags ?? []), `nodus:${kind}`, nextGroupTag])], generationPrompt: prompt.trim(), status: 'approved', locked: true }));
        nextQuestions = [...saved, ...questions];
        if (kind === 'flashcards') nextCards = [...await window.nodus.createStudyFlashcardsFromQuestions(saved.map((question) => question.id)), ...cards];
        setQuestions(nextQuestions); setCards(nextCards);
      }
      const selected: ReviewItem[] = (kind === 'flashcards'
        ? nextCards.filter(inScope).map((card) => ({ id: card.id, front: card.front, back: card.back, card }))
        : nextQuestions.filter((question) => inScope(question) && (question.tags.includes(`nodus:${kind}`) || (!question.tags.some((tag) => tag.startsWith('nodus:')) && (kind === 'test' ? ['single_choice', 'multiple_choice', 'true_false'].includes(question.type) : true)))).map((question) => ({ id: question.id, front: question.prompt, back: question.answer.text ?? String(question.answer.value ?? '') }))).slice(0, count);
      if (!selected.length) throw new Error(t('No hay elementos disponibles para esta revisión.'));
      setItems(selected); setIndex(0); setRevealed(false); setStep('session');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const next = async (rating?: 1 | 3 | 4 | 5) => {
    const current = items[index];
    if (current?.card && rating) await window.nodus.reviewStudyFlashcard({ cardId: current.card.id, rating });
    if (index + 1 >= items.length) setStep('done'); else { setIndex((value) => value + 1); setRevealed(false); }
  };
  const reset = () => { setStep('setup'); setItems([]); setIndex(0); setRevealed(false); };
  return <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="study-review-view">
    <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{t('Aprendizaje guiado')}</p><h1 className="text-xl font-semibold">{t('Revisión')}</h1><p className="mt-1 text-xs text-neutral-500">{t('Reabre contenidos anteriores o genera una sesión nueva sin salir del repaso.')}</p></header>
    <main className="min-h-0 flex-1 overflow-y-auto p-5">
      {step === 'setup' && <section className="mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/35" data-testid="study-review-wizard"><div className="mb-6 flex items-center gap-2">{[1,2,3].map((value) => <span key={value} className="grid h-7 w-7 place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">{value}</span>)}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t('Modo de revisión')}<select data-testid="study-review-kind" className="input mt-1 w-full" value={kind} onChange={(event) => { setKind(event.target.value as ReviewKind); setGroupTag(''); }}><option value="test">{t('Test')}</option><option value="exam">{t('Examen')}</option><option value="flashcards">{t('Flashcards')}</option></select></label><label className="text-xs text-neutral-500">{t('Asignatura')}<select className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{workspace?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Tema')}<select className="input mt-1 w-full" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{workspace?.topics.filter((topic) => !subjectId || topic.subjectId === subjectId).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Grupo guardado')}<select className="input mt-1 w-full" value={groupTag} onChange={(event) => setGroupTag(event.target.value)}><option value="">{t('Cualquier grupo')}</option>{groups.map((tag) => <option key={tag} value={tag}>{new Date(Number(tag.split(':').at(-1))).toLocaleString()}</option>)}</select></label><label className="text-xs text-neutral-500">{t('Contenido')}<select className="input mt-1 w-full" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="existing">{t('Reutilizar contenido guardado')}</option><option value="new">{t('Crear contenido nuevo con IA')}</option></select></label><label className="text-xs text-neutral-500">{t('Número de elementos')}<input className="input mt-1 w-full" type="number" min={1} max={40} value={count} onChange={(event) => setCount(Math.max(1, Math.min(40, Number(event.target.value) || 1)))} /></label></div>{source === 'new' && <label className="mt-4 block text-xs text-neutral-500">{t('Tema o indicaciones (opcional)')}<textarea className="input mt-1 min-h-24 w-full" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>}<p className="mt-4 text-xs text-neutral-500">{source === 'existing' ? `${available} ${t('elementos disponibles')}` : t('El contenido nuevo se guardará automáticamente en el banco.')}</p>{error && <p className="mt-3 text-xs text-red-500">{error}</p>}<div className="mt-6 flex justify-end"><button data-testid="study-review-start" className="btn btn-primary" disabled={busy} onClick={() => void start()}>{busy ? <Spinner label={t('Preparando revisión…')} /> : <><Icon name="play" />{t('Comenzar revisión')}</>}</button></div></section>}
      {step === 'session' && <section className="mx-auto max-w-2xl" data-testid="study-review-session"><div className="mb-3 flex items-center text-xs text-neutral-500"><span>{index + 1} / {items.length}</span><div className="mx-3 h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-teal-500" style={{ width: `${((index + 1) / items.length) * 100}%` }} /></div><button className="btn btn-ghost h-8" onClick={reset}>{t('Salir')}</button></div><button className="min-h-80 w-full rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45" onClick={() => setRevealed(true)}><p className="text-xl leading-8">{items[index]?.front}</p>{!revealed ? <p className="mt-10 text-xs text-neutral-500">{t('Pulsa para mostrar la respuesta')}</p> : <><div className="mx-auto my-7 h-px max-w-sm bg-neutral-200 dark:bg-neutral-800"/><p className="text-lg text-emerald-700 dark:text-emerald-300">{items[index]?.back}</p></>}</button>{revealed && (kind === 'flashcards' ? <div className="mt-4 grid grid-cols-4 gap-2">{([{r:1,l:'Otra vez'},{r:3,l:'Difícil'},{r:4,l:'Bien'},{r:5,l:'Fácil'}] as const).map((entry) => <button key={entry.r} data-testid={`study-review-rate-${entry.r}`} className="rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900" onClick={() => void next(entry.r)}>{t(entry.l)}</button>)}</div> : <button className="btn btn-primary mt-4 ml-auto" onClick={() => void next()}>{t('Siguiente')}<Icon name="chevronRight" /></button>)}</section>}
      {step === 'done' && <section className="mx-auto max-w-xl rounded-2xl border border-teal-200 bg-white p-10 text-center dark:border-teal-900 dark:bg-neutral-900/45"><Icon name="check" size={30} className="text-teal-600"/><h2 className="mt-4 text-2xl font-semibold">{t('Revisión completada')}</h2><p className="mt-2 text-sm text-neutral-500">{items.length} {t('elementos revisados')}</p><button className="btn btn-primary mt-6" onClick={reset}>{t('Crear otra revisión')}</button></section>}
    </main>
  </div>;
}
