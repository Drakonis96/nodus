import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type {
  AppSettings,
  ModelRef,
  StudyAnswerAssessment,
  StudyAuthorPlan,
  StudyGuidePlan,
  StudyProgressStatus,
  StudyRecommendedWork,
  StudySession,
  StudyQuizQuestion,
} from '@shared/types';
import { Badge, Icon, Spinner, TypeDot } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { VirtualList } from '../components/VirtualList';
import { WorkIdeasModal } from './WorkIdeasModal';
import { useDataRefresh, useScanComplete } from '../hooks';
import type { PendingAssistantNavigationTarget, PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

const AUTHOR_ROW_HEIGHT = 132;

type StudyPlanLoadPhase = 'idle' | 'preparing' | 'reading' | 'rendering' | 'semantic';

const STATUS_LABELS: Record<StudyProgressStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  understood: 'Entendido',
  needs_full_read: 'Lectura completa',
  review: 'Repasar',
};

const STATUS_COLORS: Record<StudyProgressStatus, 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan'> = {
  pending: 'neutral',
  in_progress: 'cyan',
  understood: 'green',
  needs_full_read: 'amber',
  review: 'indigo',
};

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

export function StudyGuideView({
  settings,
  onOpenGraph,
  onOpenAssistant,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [plan, setPlan] = useState<StudyGuidePlan | null>(null);
  const [objective, setObjective] = useState('');
  const [sessionMinutes, setSessionMinutes] = useState(45);
  const [authorLimit, setAuthorLimit] = useState(18);
  const [worksPerAuthor, setWorksPerAuthor] = useState(4);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadPhase, setLoadPhase] = useState<StudyPlanLoadPhase>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelRef | null>(settings.synthesisModel ?? settings.defaultModel);
  const [session, setSession] = useState<StudySession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [assessment, setAssessment] = useState<StudyAnswerAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const loadSeqRef = useRef(0);

  const loadPlan = useCallback(
    async (semanticFocus = false) => {
      const seq = loadSeqRef.current + 1;
      loadSeqRef.current = seq;
      setLoading(true);
      setLoadPhase(semanticFocus ? 'semantic' : 'preparing');
      try {
        await waitForPaint();
        if (seq !== loadSeqRef.current) return;
        setLoadPhase(semanticFocus ? 'semantic' : 'reading');
        const next = await window.nodus.getStudyPlan({
          objective,
          sessionMinutes,
          authorLimit,
          worksPerAuthor,
          includeCompleted,
          semanticFocus,
        });
        if (seq !== loadSeqRef.current) return;
        setLoadPhase('rendering');
        setPlan(next);
        setSelectedId((current) => {
          if (current && next.authors.some((author) => author.authorId === current)) return current;
          return next.nextAuthorId ?? next.authors[0]?.authorId ?? null;
        });
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
          setLoadPhase('idle');
        }
      }
    },
    [authorLimit, includeCompleted, objective, sessionMinutes, worksPerAuthor]
  );

  useEffect(() => {
    void loadPlan(false);
  }, []);
  useDataRefresh(() => loadPlan(false));
  useScanComplete(() => loadPlan(false));

  const selectedAuthor = useMemo(
    () => plan?.authors.find((author) => author.authorId === selectedId) ?? plan?.authors[0] ?? null,
    [plan, selectedId]
  );

  useEffect(() => {
    setSession(null);
    setSessionError(null);
    setSelectedQuestionId(null);
    setAnswer('');
    setAssessment(null);
  }, [selectedAuthor?.authorId]);

  const setProgress = useCallback(
    async (kind: 'author' | 'work' | 'idea' | 'theme', id: string, status: StudyProgressStatus, note?: string | null) => {
      await window.nodus.setStudyProgress({ targetKind: kind, targetId: id, status, note });
      await loadPlan(false);
    },
    [loadPlan]
  );

  const generateSession = useCallback(async () => {
    if (!selectedAuthor || sessionLoading) return;
    setSessionLoading(true);
    setSessionError(null);
    setAssessment(null);
    setAnswer('');
    try {
      const result = await window.nodus.generateStudySession({
        authorId: selectedAuthor.authorId,
        objective,
        sessionMinutes,
        useFullText: true,
        model,
      });
      setSession(result);
      setSelectedQuestionId(result.quiz[0]?.id ?? null);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionLoading(false);
    }
  }, [model, objective, selectedAuthor, sessionLoading, sessionMinutes]);

  const selectedQuestion = useMemo(
    () => session?.quiz.find((question) => question.id === selectedQuestionId) ?? session?.quiz[0] ?? null,
    [selectedQuestionId, session?.quiz]
  );

  const evaluateAnswer = useCallback(async () => {
    if (!selectedAuthor || !selectedQuestion || !answer.trim() || assessing) return;
    setAssessing(true);
    try {
      setAssessment(
        await window.nodus.evaluateStudyAnswer({
          authorId: selectedAuthor.authorId,
          question: selectedQuestion.question,
          answer,
          objective,
          model,
        })
      );
    } finally {
      setAssessing(false);
    }
  }, [answer, assessing, model, objective, selectedAuthor, selectedQuestion]);

  const askAssistant = useCallback(() => {
    if (!selectedAuthor) return;
    onOpenAssistant({
      title: tx('Estudiar a {name}', { name: selectedAuthor.fullName }),
      prompt:
        `${t('Quiero estudiar este autor como parte de mi corpus. Prioriza tesis, ideas, obras que debo abrir en Zotero, pasajes y contradicciones:')}\n\n` +
        `${selectedAuthor.fullName}\n` +
        `${selectedAuthor.keyIdeas.map((idea) => `- ${idea.label}: ${idea.statement}`).join('\n')}`,
      selection: {
        ideas: true,
        themes: true,
        contradictions: true,
        gaps: false,
        readingPath: true,
        authors: true,
        documents: true,
        passages: true,
        graph: true,
        graphParts: {
          ideaNodes: true,
          themeNodes: true,
          ideaEdges: true,
          authorGraph: true,
        },
      },
    });
  }, [onOpenAssistant, selectedAuthor]);

  return (
    <div className="h-full min-h-0 flex flex-col p-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Modo Estudio')}</h1>
          {plan && <p className="text-sm text-neutral-400 mt-1">{plan.summary}</p>}
        </div>
        <div className="flex-1" />
        <ModelPicker settings={settings} value={model} onChange={setModel} compact />
        <button className="btn btn-ghost gap-1.5" onClick={() => void loadPlan(true)} disabled={loading}>
          <Icon name="search" /> {t('Afinar con embeddings')}
        </button>
        <button className="btn btn-primary gap-1.5" onClick={() => void loadPlan(false)} disabled={loading}>
          <Icon name="refresh" className={loading ? 'animate-spin' : ''} /> {t('Recalcular')}
        </button>
      </div>

      {loading && <StudyPlanLoadingBar phase={loadPhase} />}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_21rem] gap-4 mb-4">
        <div className="space-y-3">
          <textarea
            className="input w-full min-h-20 resize-y"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={t('Objetivo de estudio, tema, examen, capítulo o pregunta de investigación...')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input" value={sessionMinutes} onChange={(e) => setSessionMinutes(Number(e.target.value))}>
              {[30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>{tx('{n} min', { n })}</option>
              ))}
            </select>
            <select className="input" value={authorLimit} onChange={(e) => setAuthorLimit(Number(e.target.value))}>
              {[12, 18, 30, 50].map((n) => (
                <option key={n} value={n}>{tx('{n} autores', { n })}</option>
              ))}
            </select>
            <select className="input" value={worksPerAuthor} onChange={(e) => setWorksPerAuthor(Number(e.target.value))}>
              {[3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>{tx('{n} obras/autor', { n })}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={includeCompleted}
                onChange={(e) => setIncludeCompleted(e.target.checked)}
              />
              {t('Incluir entendidos')}
            </label>
          </div>
        </div>
        {plan ? <PlanStats plan={plan} /> : <div className="rounded-lg border border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900/40"><Spinner label={t('Calculando plan...')} /></div>}
      </div>

      {plan?.semanticFocusSummary && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${plan.semanticFocusUsed ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-200' : 'border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-400'}`}>
          {plan.semanticFocusSummary}
        </div>
      )}

      {plan?.coverageWarnings.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {plan.coverageWarnings.map((warning) => (
            <Badge key={warning} color="amber">{warning}</Badge>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[23rem_minmax(0,1fr)] gap-4">
        <section className="min-h-0 flex flex-col rounded-lg border border-neutral-800 overflow-hidden">
          <div className="px-3 py-2 border-b border-neutral-800 flex items-center gap-2">
            <Icon name="graduation" className="text-indigo-400" />
            <h2 className="font-medium text-sm">{t('Ruta de autores')}</h2>
            <div className="flex-1" />
            {loading && <Spinner />}
          </div>
          {plan && plan.authors.length > 0 ? (
            <VirtualList
              items={plan.authors}
              itemHeight={AUTHOR_ROW_HEIGHT}
              getKey={(author) => author.authorId}
              className="flex-1 min-h-0"
              renderItem={(author) => (
                <AuthorRow
                  author={author}
                  selected={author.authorId === selectedAuthor?.authorId}
                  onSelect={() => setSelectedId(author.authorId)}
                />
              )}
            />
          ) : (
            <div className="p-4 text-sm text-neutral-500">{t('No hay autores para estudiar con los filtros actuales.')}</div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto pr-1">
          {selectedAuthor ? (
            <AuthorStudyPanel
              author={selectedAuthor}
              session={session}
              sessionLoading={sessionLoading}
              sessionError={sessionError}
              selectedQuestion={selectedQuestion}
              answer={answer}
              assessment={assessment}
              assessing={assessing}
              onAnswerChange={setAnswer}
              onQuestionChange={setSelectedQuestionId}
              onGenerateSession={generateSession}
              onEvaluateAnswer={evaluateAnswer}
              onSetProgress={setProgress}
              onOpenGraph={onOpenGraph}
              onAskAssistant={askAssistant}
              onOpenWorkIdeas={setIdeasWork}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-neutral-500 text-sm">{t('Selecciona un autor.')}</div>
          )}
        </section>
      </div>
      {ideasWork && (
        <WorkIdeasModal
          work={ideasWork}
          model={model}
          enableSynthesis
          onClose={() => setIdeasWork(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(work) => {
            setIdeasWork(null);
            onOpenGraph({ preset: 'reading', workId: work.nodus_id, workTitle: work.title, label: `${t('Ideas y conexiones:')} ${work.title}` });
          }}
        />
      )}
    </div>
  );
}

function StudyPlanLoadingBar({ phase }: { phase: StudyPlanLoadPhase }) {
  const label =
    phase === 'semantic'
      ? t('Afinando ruta con embeddings…')
      : phase === 'rendering'
        ? t('Actualizando ruta de autores…')
        : phase === 'reading'
          ? t('Leyendo autores, obras e ideas…')
          : t('Preparando ruta de estudio…');

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/25">
      <div className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-200">
        <Spinner />
        <span>{label}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-900">
        <div className="study-plan-progress h-full w-1/3 rounded-full bg-indigo-500" />
      </div>
    </div>
  );
}

function PlanStats({ plan }: { plan: StudyGuidePlan }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label={t('Autores')} value={`${plan.stats.shownAuthors}/${plan.stats.totalAuthors}`} />
        <Metric label={t('Ideas')} value={plan.stats.totalIdeas} />
        <Metric label={t('Obras')} value={plan.stats.totalWorks} />
        <Metric label={t('Zotero')} value={plan.stats.zoteroLinkedWorks} />
        <Metric label={t('Entendidos')} value={plan.stats.completedAuthors} />
        <Metric label={t('Repaso')} value={plan.stats.reviewAuthors} />
      </div>
      {plan.phases.length > 0 && (
        <div className="mt-3 space-y-1">
          {plan.phases.map((phase) => (
            <div key={phase.id} className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="truncate">{phase.title}</span>
              <span className="ml-auto text-neutral-500">{phase.authorIds.length}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-neutral-950/70 border border-neutral-800 px-2 py-1.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function AuthorRow({ author, selected, onSelect }: { author: StudyAuthorPlan; selected: boolean; onSelect: () => void }) {
  return (
    <button
      className={`h-[132px] w-full text-left px-3 py-2 border-b border-neutral-900 hover:bg-neutral-900/80 ${
        selected ? 'bg-indigo-950/40 ring-1 ring-inset ring-indigo-700/60' : 'bg-neutral-950'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs font-mono text-neutral-500 w-6">{author.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{author.fullName}</span>
            {author.progressStatus && <Badge color={STATUS_COLORS[author.progressStatus]}>{t(STATUS_LABELS[author.progressStatus])}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge>{tx('{n} ideas', { n: author.ideaCount })}</Badge>
            <Badge>{tx('{n} obras', { n: author.workCount })}</Badge>
            {author.relationCount > 0 && <Badge color="cyan">{tx('{n} conexiones', { n: author.relationCount })}</Badge>}
          </div>
          <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{author.nextAction}</p>
          <div className="mt-1 text-[11px] text-neutral-600 truncate">{author.topThemes.slice(0, 4).join(' · ')}</div>
        </div>
      </div>
    </button>
  );
}

function AuthorStudyPanel({
  author,
  session,
  sessionLoading,
  sessionError,
  selectedQuestion,
  answer,
  assessment,
  assessing,
  onAnswerChange,
  onQuestionChange,
  onGenerateSession,
  onEvaluateAnswer,
  onSetProgress,
  onOpenGraph,
  onAskAssistant,
  onOpenWorkIdeas,
}: {
  author: StudyAuthorPlan;
  session: StudySession | null;
  sessionLoading: boolean;
  sessionError: string | null;
  selectedQuestion: StudyQuizQuestion | null;
  answer: string;
  assessment: StudyAnswerAssessment | null;
  assessing: boolean;
  onAnswerChange: (value: string) => void;
  onQuestionChange: (id: string) => void;
  onGenerateSession: () => void;
  onEvaluateAnswer: () => void;
  onSetProgress: (kind: 'author' | 'work' | 'idea' | 'theme', id: string, status: StudyProgressStatus, note?: string | null) => Promise<void>;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onAskAssistant: () => void;
  onOpenWorkIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{author.fullName}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge color="indigo">{tx('prioridad {n}', { n: author.score })}</Badge>
              <Badge>{tx('{n} ideas', { n: author.ideaCount })}</Badge>
              <Badge>{tx('{n} obras', { n: author.workCount })}</Badge>
              <Badge color={author.coverage.fullTextWorks > 0 ? 'green' : 'neutral'}>{tx('{n} textos', { n: author.coverage.fullTextWorks })}</Badge>
              <Badge color={author.coverage.zoteroLinkedWorks > 0 ? 'cyan' : 'neutral'}>{tx('{n} Zotero', { n: author.coverage.zoteroLinkedWorks })}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-ghost gap-1.5"
              onClick={() => onOpenGraph({ preset: 'authors', nodeId: author.authorId, label: author.fullName })}
            >
              <Icon name="network" /> {t('Grafo')}
            </button>
            <button className="btn btn-ghost gap-1.5" onClick={onAskAssistant}>
              <Icon name="chat" /> {t('Asistente')}
            </button>
            <ProgressSelect
              value={author.progressStatus ?? 'pending'}
              onChange={(status) => void onSetProgress('author', author.authorId, status)}
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <h3 className="text-sm font-medium mb-2">{t('Objetivos')}</h3>
            <ul className="space-y-1">
              {author.learningGoals.map((goal) => (
                <li key={goal} className="text-sm text-neutral-300 flex gap-2">
                  <Icon name="check" size={13} className="mt-0.5 text-emerald-400" />
                  <span>{goal}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">{t('Preguntas de repaso')}</h3>
            <ul className="space-y-1">
              {author.reviewQuestions.slice(0, 4).map((question) => (
                <li key={question} className="text-sm text-neutral-400 flex gap-2">
                  <Icon name="help" size={13} className="mt-0.5 text-indigo-400" />
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] gap-4">
        <div className="space-y-4">
          <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="book" className="text-cyan-400" />
              <h3 className="font-medium">{t('Obras recomendadas')}</h3>
            </div>
            <div className="space-y-2">
              {author.recommendedWorks.map((work) => (
                <WorkRecommendation
                  key={work.nodusId}
                  work={work}
                  onSetProgress={onSetProgress}
                  onOpenGraph={onOpenGraph}
                  onOpenIdeas={onOpenWorkIdeas}
                />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="bulb" className="text-amber-400" />
              <h3 className="font-medium">{t('Ideas clave')}</h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {author.keyIdeas.map((idea) => (
                <div key={idea.globalId} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TypeDot type={idea.type} />
                    <span className="font-medium text-sm line-clamp-1">{idea.label}</span>
                  </div>
                  <p className="text-xs text-neutral-400 line-clamp-3">{idea.statement}</p>
                  <div className="mt-2 text-[11px] text-neutral-600 truncate">{idea.workTitle}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <SessionPanel
          session={session}
          loading={sessionLoading}
          error={sessionError}
          selectedQuestion={selectedQuestion}
          answer={answer}
          assessment={assessment}
          assessing={assessing}
          onGenerate={onGenerateSession}
          onQuestionChange={onQuestionChange}
          onAnswerChange={onAnswerChange}
          onEvaluate={onEvaluateAnswer}
        />
      </div>
    </div>
  );
}

function ProgressSelect({
  value,
  onChange,
}: {
  value: StudyProgressStatus;
  onChange: (status: StudyProgressStatus) => void;
}) {
  return (
    <select className="input text-xs py-1" value={value} onChange={(e) => onChange(e.target.value as StudyProgressStatus)}>
      {(Object.keys(STATUS_LABELS) as StudyProgressStatus[]).map((status) => (
        <option key={status} value={status}>{t(STATUS_LABELS[status])}</option>
      ))}
    </select>
  );
}

function WorkRecommendation({
  work,
  onSetProgress,
  onOpenGraph,
  onOpenIdeas,
}: {
  work: StudyRecommendedWork;
  onSetProgress: (kind: 'author' | 'work' | 'idea' | 'theme', id: string, status: StudyProgressStatus, note?: string | null) => Promise<void>;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  const openZotero = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (work.zoteroKey) await window.nodus.openInZotero(work.zoteroKey);
  };
  return (
    <div
      className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 transition-colors hover:border-neutral-700 hover:bg-neutral-900/70 cursor-pointer"
      role="button"
      tabIndex={0}
      title={t('Ver todas las ideas de esta obra')}
      onClick={() => onOpenIdeas({ nodus_id: work.nodusId, title: work.title || t('(sin título)') })}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenIdeas({ nodus_id: work.nodusId, title: work.title || t('(sin título)') });
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium text-sm line-clamp-1">{work.title || t('(sin título)')}</h4>
            {work.year && <Badge>{work.year}</Badge>}
            {work.read ? <Badge color="green">{t('Leída')}</Badge> : <Badge color="amber">{t('Por leer')}</Badge>}
            <Badge color="indigo">{tx('prioridad {n}', { n: work.score })}</Badge>
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            {work.authors[0] ?? t('Autoría no disponible')}{work.authors.length > 1 ? ' et al.' : ''}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge>{tx('{n} ideas', { n: work.ideaCount })}</Badge>
            <Badge>{tx('{n} principales', { n: work.principalIdeaCount })}</Badge>
            <Badge color={work.passageCount > 0 ? 'cyan' : 'neutral'}>{tx('{n} pasajes', { n: work.passageCount })}</Badge>
            {work.summaryStatus === 'done' && <Badge color="green">{t('resumen')}</Badge>}
          </div>
          {work.summary && <p className="mt-2 text-xs text-neutral-400 line-clamp-2">{work.summary}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {work.reasons.map((reason) => (
              <span key={reason} className="text-[11px] text-neutral-500 bg-neutral-950 rounded px-1.5 py-0.5">{reason}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5" onClick={(event) => event.stopPropagation()}>
          <button
            className="btn btn-ghost py-1 px-2 gap-1"
            title={work.zoteroKey ? t('Abrir en Zotero') : t('Sin enlace Zotero')}
            onClick={openZotero}
            disabled={!work.zoteroKey}
          >
            <Icon name="external" /> {t('Zotero')}
          </button>
          <button
            className="btn btn-ghost py-1 px-2 gap-1"
            onClick={(event) => {
              event.stopPropagation();
              onOpenGraph({ preset: 'reading', workId: work.nodusId, workTitle: work.title, zoteroKey: work.zoteroKey ?? undefined, label: work.title });
            }}
          >
            <Icon name="network" /> {t('Grafo')}
          </button>
          <ProgressSelect
            value={work.progressStatus ?? 'pending'}
            onChange={(status) => void onSetProgress('work', work.nodusId, status)}
          />
        </div>
      </div>
    </div>
  );
}

function SessionPanel({
  session,
  loading,
  error,
  selectedQuestion,
  answer,
  assessment,
  assessing,
  onGenerate,
  onQuestionChange,
  onAnswerChange,
  onEvaluate,
}: {
  session: StudySession | null;
  loading: boolean;
  error: string | null;
  selectedQuestion: StudyQuizQuestion | null;
  answer: string;
  assessment: StudyAnswerAssessment | null;
  assessing: boolean;
  onGenerate: () => void;
  onQuestionChange: (id: string) => void;
  onAnswerChange: (value: string) => void;
  onEvaluate: () => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="wand" className="text-indigo-400" />
        <h3 className="font-medium">{t('Tutor de estudio')}</h3>
        <div className="flex-1" />
        <button className="btn btn-primary py-1.5 gap-1.5" onClick={onGenerate} disabled={loading}>
          <Icon name="wand" /> {loading ? t('Generando...') : t('Generar sesión')}
        </button>
      </div>
      {loading && <Spinner label={t('Preparando sesión tutor...')} />}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!session && !loading && !error && <p className="text-sm text-neutral-500">{t('Sin sesión generada para este autor.')}</p>}
      {session && (
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge color={session.usedFullText ? 'green' : 'neutral'}>
                {session.usedFullText ? t('pasajes usados') : t('sin pasajes')}
              </Badge>
              {session.model && <Badge color="indigo">{session.model.provider}</Badge>}
            </div>
            <p className="text-sm text-neutral-300">{session.guide}</p>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">{t('Secuencia')}</h4>
            <div className="space-y-2">
              {session.sequence.map((step, index) => (
                <div key={`${step.title}-${index}`} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-neutral-500">{index + 1}</span>
                    <span className="text-sm font-medium">{step.title}</span>
                    <span className="ml-auto text-xs text-neutral-500">{tx('{n} min', { n: step.minutes })}</span>
                  </div>
                  <p className="text-xs text-neutral-400">{step.body}</p>
                </div>
              ))}
            </div>
          </div>

          {session.passages.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">{t('Pasajes para comprobar')}</h4>
              <div className="space-y-2">
                {session.passages.slice(0, 5).map((passage) => (
                  <div key={passage.passageId} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                    <p className="text-xs text-neutral-300 line-clamp-4">{passage.snippet}</p>
                    <div className="mt-2 text-[11px] text-neutral-500 truncate">
                      {passage.workTitle}{passage.pageLabel ? ` · ${passage.pageLabel}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {session.fullReadCandidates.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">{t('Lectura completa')}</h4>
              <div className="space-y-2">
                {session.fullReadCandidates.slice(0, 3).map((work) => (
                  <div key={work.nodusId} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-1">{work.title}</p>
                      <p className="text-xs text-neutral-500">{work.year ?? t('s.f.')} · {tx('{n} ideas', { n: work.ideaCount })}</p>
                    </div>
                    <button
                      className="btn btn-ghost py-1 px-2 gap-1"
                      onClick={() => work.zoteroKey && window.nodus.openInZotero(work.zoteroKey)}
                      disabled={!work.zoteroKey}
                    >
                      <Icon name="external" /> {t('Zotero')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {session.quiz.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">{t('Comprobación')}</h4>
              <select
                className="input w-full mb-2"
                value={selectedQuestion?.id ?? ''}
                onChange={(e) => onQuestionChange(e.target.value)}
              >
                {session.quiz.map((question) => (
                  <option key={question.id} value={question.id}>{question.question}</option>
                ))}
              </select>
              {selectedQuestion && (
                <div className="space-y-2">
                  <textarea
                    className="input w-full min-h-28 resize-y"
                    value={answer}
                    onChange={(e) => onAnswerChange(e.target.value)}
                    placeholder={t('Respuesta de repaso...')}
                  />
                  <button className="btn btn-ghost gap-1.5" onClick={onEvaluate} disabled={assessing || !answer.trim()}>
                    <Icon name="check" /> {assessing ? t('Evaluando...') : t('Evaluar respuesta')}
                  </button>
                  {assessment && (
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge color={assessment.verdict === 'solid' ? 'green' : assessment.verdict === 'partial' ? 'amber' : 'red'}>
                          {assessment.verdict}
                        </Badge>
                        <span className="text-xs text-neutral-500">{assessment.score}/100</span>
                      </div>
                      <p className="text-sm text-neutral-300">{assessment.feedback}</p>
                      {assessment.missing.length > 0 && (
                        <div className="mt-2 text-xs text-neutral-500">
                          {t('Falta')}: {assessment.missing.join('; ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {session.nextActions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">{t('Siguiente')}</h4>
              <div className="space-y-1">
                {session.nextActions.map((action) => (
                  <div key={action} className="text-sm text-neutral-400 flex gap-2">
                    <Icon name="check" size={13} className="mt-0.5 text-emerald-400" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
