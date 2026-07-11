import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ModelRef, TutorMode, TutorPlan, TutorRoute, TutorSavedRoute, TutorStop } from '@shared/types';
import { Icon, Spinner, modelLabel, sortModelRefs } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ConfirmModal } from '../components/ConfirmModal';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { t, tx, getActiveLang } from '../i18n';

type Phase = 'setup' | 'routes' | 'touring';
type SetupTab = 'generate' | 'saved';
type TourOrigin = 'generated' | 'saved';

interface StepState {
  text: string;
  loading: boolean;
  error: boolean;
  /** Live reasoning/thinking trace from the model. Transient — never persisted. */
  reasoning?: string;
}

const STOP_KIND_LABEL: Record<TutorStop['kind'], string> = {
  theme: 'tema',
  idea: 'idea',
  connection: 'conexión',
};

export function TutorPanel({
  settings,
  onFocusStop,
  onClearFocus,
  onClose,
}: {
  settings: AppSettings;
  onFocusStop: (stop: TutorStop) => void;
  onClearFocus: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<TutorMode>('overview');
  const [setupTab, setSetupTab] = useState<SetupTab>('generate');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useFeatureModel(settings, 'tutorModel');
  const [generating, setGenerating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TutorPlan | null>(null);
  const [route, setRoute] = useState<TutorRoute | null>(null);
  const [tourOrigin, setTourOrigin] = useState<TourOrigin>('generated');
  const [tourOverview, setTourOverview] = useState('');
  const [tourModel, setTourModel] = useState<ModelRef | null>(selectedModel);
  const [stopIndex, setStopIndex] = useState(0);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [savedRoutes, setSavedRoutes] = useState<TutorSavedRoute[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [completionRating, setCompletionRating] = useState<number | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [savedCurrentRouteId, setSavedCurrentRouteId] = useState<string | null>(null);
  const [pendingRouteDelete, setPendingRouteDelete] = useState<TutorSavedRoute | null>(null);
  // Keep the latest text outside the render closure and retain the in-flight
  // promise. A user can advance before streaming ends; the next stop must wait
  // for the preceding conclusion instead of narrating against stale state.
  const stepsRef = useRef<Record<string, StepState>>({});
  const stepRequestsRef = useRef<Map<string, Promise<string | null>>>(new Map());

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (m: ModelRef | null | undefined) => {
      if (!m || models.some((x) => x.provider === m.provider && x.model === m.model)) return;
      models.push(m);
    };
    add(settings.synthesisModel);
    add(settings.tutorModel);
    add(selectedModel);
    for (const m of settings.favorites ?? []) add(m);
    return sortModelRefs(models);
  }, [settings.synthesisModel, settings.tutorModel, settings.favorites, selectedModel]);

  const stepKey = (routeId: string, index: number) => `${routeId}:${index}`;

  const loadSavedRoutes = useCallback(async () => {
    setSavedLoading(true);
    try {
      setSavedRoutes(await window.nodus.listTutorRoutes());
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedRoutes();
  }, [loadSavedRoutes]);

  const updateSteps = useCallback((update: (current: Record<string, StepState>) => Record<string, StepState>) => {
    setSteps((current) => {
      const next = update(current);
      stepsRef.current = next;
      return next;
    });
  }, []);

  const loadStep = useCallback((activeRoute: TutorRoute, index: number): Promise<string | null> => {
    const key = stepKey(activeRoute.id, index);
    const existing = stepsRef.current[key];
    if (existing?.text && !existing.error) return Promise.resolve(existing.text);
    const pending = stepRequestsRef.current.get(key);
    if (pending) return pending;

    const request = (async (): Promise<string | null> => {
      let previousText: string | undefined;
      if (index > 0) {
        const previousKey = stepKey(activeRoute.id, index - 1);
        previousText = stepsRef.current[previousKey]?.text;
        // Do not generate skipped stops just to fill context, but when the
        // preceding stop is already streaming, wait for its complete ending.
        if (!previousText) previousText = (await stepRequestsRef.current.get(previousKey)) ?? undefined;
      }

      updateSteps((current) => ({ ...current, [key]: { text: '', loading: true, error: false } }));
      try {
        const history = activeRoute.stops.slice(0, index).map((s) => s.title);
        const response = await window.nodus.tutorStepStream(
          { route: activeRoute, stopIndex: index, overview: tourOverview, history, previousText, model: tourModel },
          {
            onDelta: (delta) => {
              updateSteps((current) => {
                const previous = current[key] ?? { text: '', loading: true, error: false };
                return { ...current, [key]: { ...previous, text: previous.text + delta } };
              });
            },
            onReasoning: (delta) => {
              updateSteps((current) => {
                const previous = current[key] ?? { text: '', loading: true, error: false };
                return { ...current, [key]: { ...previous, reasoning: (previous.reasoning ?? '') + delta } };
              });
            },
          }
        );
        updateSteps((current) => ({ ...current, [key]: { text: response.explanation, loading: false, error: false } }));
        return response.explanation;
      } catch (e) {
        updateSteps((current) => ({
          ...current,
          [key]: { text: e instanceof Error ? e.message : String(e), loading: false, error: true },
        }));
        return null;
      } finally {
        stepRequestsRef.current.delete(key);
      }
    })();
    stepRequestsRef.current.set(key, request);
    return request;
  }, [tourModel, tourOverview, updateSteps]);

  // Spotlight the current stop on the real graph and ensure its narration is loaded.
  useEffect(() => {
    if (phase !== 'touring' || !route) return;
    const stop = route.stops[stopIndex];
    if (!stop) return;
    onFocusStop(stop);
    void loadStep(route, stopIndex);
  }, [phase, route, stopIndex]);

  // Arrow-key navigation while touring (ignored when typing in a field).
  useEffect(() => {
    if (phase !== 'touring' || !route) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowRight') {
        setStopIndex((i) => Math.min(route.stops.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setStopIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, route]);

  const generate = async () => {
    if (generating || !selectedModel) return;
    setGenerating(true);
    setPlanError(null);
    try {
      const result = await window.nodus.tutorPlan({
        mode,
        prompt: mode === 'prompt' ? prompt : undefined,
        model: selectedModel,
      });
      setPlan(result);
      stepsRef.current = {};
      stepRequestsRef.current.clear();
      setSteps({});
      await loadSavedRoutes();
      setPhase('routes');
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const startRoute = async (
    r: TutorRoute,
    origin: TourOrigin = 'generated',
    overview = plan?.overview ?? '',
    model: ModelRef | null = selectedModel
  ) => {
    setRoute(r);
    setTourOrigin(origin);
    setTourOverview(overview);
    setTourModel(model);
    setStopIndex(0);
    setCompletionRating(null);
    setSavedCurrentRouteId(origin === 'saved' ? r.id : null);
    setPhase('touring');
    if (origin === 'saved') {
      const saved = await window.nodus.markTutorRoutePlayed(r.id).catch(() => null);
      if (saved) {
        setSavedRoutes((cur) => [saved, ...cur.filter((item) => item.id !== saved.id)]);
      }
    }
  };

  const backToRoutes = () => {
    setPhase(tourOrigin === 'generated' && plan ? 'routes' : 'setup');
    if (tourOrigin === 'saved') setSetupTab('saved');
    setRoute(null);
    onClearFocus();
  };

  const rateRoute = async (routeId: string, rating: number | null) => {
    const saved = await window.nodus.rateTutorRoute(routeId, rating);
    if (!saved) return;
    setSavedRoutes((cur) => {
      const next = [saved, ...cur.filter((item) => item.id !== saved.id)];
      return next.sort((a, b) => (b.lastPlayedAt ?? b.generatedAt).localeCompare(a.lastPlayedAt ?? a.generatedAt));
    });
  };

  const saveCompletedRoute = async () => {
    if (!route || !plan || !completionRating || savingRoute || savedCurrentRouteId) return;
    setSavingRoute(true);
    try {
      const saved = await window.nodus.saveTutorRoute(plan, route, tourModel, completionRating);
      if (!saved) return;
      setSavedCurrentRouteId(saved.id);
      setSavedRoutes((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    } finally {
      setSavingRoute(false);
    }
  };

  const deleteSavedRoute = async () => {
    const saved = pendingRouteDelete;
    if (!saved) return;
    await window.nodus.deleteTutorRoute(saved.id);
    setSavedRoutes((current) => current.filter((item) => item.id !== saved.id));
    setPendingRouteDelete(null);
  };

  const close = () => {
    onClearFocus();
    onClose();
  };

  const currentStop = route?.stops[stopIndex] ?? null;
  const currentKey = route ? stepKey(route.id, stopIndex) : '';
  const currentStep = steps[currentKey];
  const serializedModel = selectedModel ? `${selectedModel.provider}::${selectedModel.model}` : '';

  return (
    <aside className="w-[26rem] max-w-full shrink-0 border-r border-neutral-800 bg-neutral-950/95 flex flex-col min-h-0">
      <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
        <Icon name="compass" className="text-indigo-300" />
        <span className="font-semibold">{t('Modo Tutor')}</span>
        <div className="flex-1" />
        {phase === 'touring' && (
          <button className="btn btn-ghost text-xs px-2 py-1 gap-1" onClick={backToRoutes} title={t('Volver a las rutas')}>
            <Icon name="stop" size={14} /> {t('Parar')}
          </button>
        )}
        {phase === 'routes' && (
          <button
            className="btn btn-ghost text-xs px-2 py-1 gap-1"
            onClick={() => {
              setPhase('setup');
              onClearFocus();
            }}
            title={t('Generar otro recorrido')}
          >
            <Icon name="refresh" size={14} /> {t('Nuevo')}
          </button>
        )}
        <button className="btn btn-ghost px-2 py-1" onClick={close} title={t('Cerrar modo Tutor')}>
          <Icon name="x" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {phase === 'setup' && (
          <>
            <TutorTabs value={setupTab} onChange={setSetupTab} savedCount={savedRoutes.length} />
            {setupTab === 'generate' ? (
              <SetupPanel
                mode={mode}
                setMode={setMode}
                prompt={prompt}
                setPrompt={setPrompt}
                availableModels={availableModels}
                serializedModel={serializedModel}
                onModelChange={(v) => setSelectedModel(v ? parseModel(v) : null)}
                generating={generating}
                planError={planError}
                onGenerate={() => void generate()}
                hasModel={!!selectedModel}
              />
            ) : (
              <SavedRoutesPanel
                routes={savedRoutes}
                loading={savedLoading}
                onStart={(saved) => void startRoute(saved.route, 'saved', saved.overview, saved.model ?? selectedModel)}
                onRate={(routeId, rating) => void rateRoute(routeId, rating)}
                onDelete={setPendingRouteDelete}
                onRefresh={() => void loadSavedRoutes()}
              />
            )}
          </>
        )}

        {phase === 'routes' && plan && (
          <RoutesPanel
            plan={plan}
            onStart={(r) => void startRoute(r, 'generated', plan.overview, selectedModel)}
          />
        )}

        {phase === 'touring' && route && currentStop && (
          <TourPanel
            route={route}
            stop={currentStop}
            stopIndex={stopIndex}
            step={currentStep}
            onJump={setStopIndex}
            onRetry={() => void loadStep(route, stopIndex)}
            showSavePrompt={tourOrigin === 'generated' && !savedCurrentRouteId}
            isSaved={!!savedCurrentRouteId}
            completionRating={completionRating}
            savingRoute={savingRoute}
            onCompletionRating={setCompletionRating}
            onSave={() => void saveCompletedRoute()}
          />
        )}
      </div>

      {phase === 'touring' && route && (
        <footer className="border-t border-neutral-800 p-3 flex items-center gap-2">
          <button
            className="btn btn-ghost border border-neutral-700 flex-1 gap-1.5 disabled:opacity-40"
            onClick={() => setStopIndex((i) => Math.max(0, i - 1))}
            disabled={stopIndex === 0}
          >
            <Icon name="chevronLeft" /> {t('Anterior')}
          </button>
          <span className="text-xs text-neutral-500 tabular-nums px-1">
            {stopIndex + 1}/{route.stops.length}
          </span>
          <button
            className="btn btn-primary flex-1 gap-1.5 disabled:opacity-40"
            onClick={() => setStopIndex((i) => Math.min(route.stops.length - 1, i + 1))}
            disabled={stopIndex >= route.stops.length - 1}
          >
            {t('Siguiente')} <Icon name="chevronRight" />
          </button>
        </footer>
      )}
      {pendingRouteDelete && (
        <ConfirmModal
          title={t('Eliminar recorrido guardado')}
          message={<>{t('Se eliminará «')}{pendingRouteDelete.route.title}{t('». Esta acción no se puede deshacer.')}</>}
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void deleteSavedRoute()}
          onCancel={() => setPendingRouteDelete(null)}
        />
      )}
    </aside>
  );
}

function TutorTabs({
  value,
  onChange,
  savedCount,
}: {
  value: SetupTab;
  onChange: (tab: SetupTab) => void;
  savedCount: number;
}) {
  return (
    <div className="px-4 pt-4">
      <div className="grid grid-cols-2 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
        <button
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${value === 'generate' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
          onClick={() => onChange('generate')}
        >
          {t('Generar')}
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${value === 'saved' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
          onClick={() => onChange('saved')}
        >
          {t('Guardados')}{savedCount > 0 ? ` (${savedCount})` : ''}
        </button>
      </div>
    </div>
  );
}

function SetupPanel({
  mode,
  setMode,
  prompt,
  setPrompt,
  availableModels,
  serializedModel,
  onModelChange,
  generating,
  planError,
  onGenerate,
  hasModel,
}: {
  mode: TutorMode;
  setMode: (m: TutorMode) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  availableModels: ModelRef[];
  serializedModel: string;
  onModelChange: (v: string) => void;
  generating: boolean;
  planError: string | null;
  onGenerate: () => void;
  hasModel: boolean;
}) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-neutral-400">
        {t('Una IA de contexto largo analiza todas tus ideas, temas y conexiones y traza un recorrido guiado. Avanza con las flechas y el Tutor te lo explica paso a paso sobre el propio grafo.')}
      </p>

      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1.5">{t('Tipo de recorrido')}</div>
        <div className="space-y-2">
          <ModeCard
            active={mode === 'overview'}
            title={t('Recorrido completo')}
            description={t('El Tutor propone varias rutas que cubren todo el grafo, ordenadas por peso, y menciona todo lo importante.')}
            onClick={() => setMode('overview')}
          />
          <ModeCard
            active={mode === 'prompt'}
            title={t('Desde un objetivo')}
            description={t('Describe qué quieres repasar y el Tutor traza un recorrido a medida con las ideas y conexiones pertinentes.')}
            onClick={() => setMode('prompt')}
          />
        </div>
      </div>

      {mode === 'prompt' && (
        <textarea
          className="input w-full min-h-24 resize-y"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('Ej.: Quiero repasar cómo se relaciona el concepto de identidad nacional con la literatura de viajes y dónde hay contradicciones.')}
        />
      )}

      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1.5">{t('Modelo (recomendado: contexto largo)')}</div>
        <select className="input w-full text-sm" value={serializedModel} onChange={(e) => onModelChange(e.target.value)}>
          {!hasModel && <option value="">{t('Sin modelo seleccionado')}</option>}
          {availableModels.map((m) => (
            <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {planError && <div className="text-sm text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{planError}</div>}

      <button
        className="btn btn-primary w-full gap-1.5"
        onClick={onGenerate}
        disabled={generating || !hasModel || (mode === 'prompt' && !prompt.trim())}
      >
        {generating ? <Spinner label={t('Analizando el grafo…')} /> : <><Icon name="wand" /> {t('Generar recorrido')}</>}
      </button>
    </div>
  );
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
        active ? 'border-indigo-600 bg-indigo-600/15' : 'border-neutral-800 hover:bg-neutral-900'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={`h-3.5 w-3.5 rounded-full border ${active ? 'border-indigo-400 bg-indigo-500' : 'border-neutral-600'}`} />
        {title}
      </div>
      <div className="text-xs text-neutral-500 mt-1 pl-5">{description}</div>
    </button>
  );
}

function RoutesPanel({
  plan,
  onStart,
}: {
  plan: TutorPlan;
  onStart: (route: TutorRoute) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="text-xs uppercase text-neutral-500">{t('Panorama')}</div>
        <Markdown content={plan.overview} className="text-sm text-neutral-300" />
        <div className="flex flex-wrap gap-1.5 text-[11px] text-neutral-500">
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{tx('{n} temas', { n: plan.totalThemes })}</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{tx('{n} ideas', { n: plan.totalIdeas })}</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{tx('{n} conexiones', { n: plan.totalConnections })}</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{tx('{n} ideas en rutas', { n: plan.coveredIdeas })}</span>
          {plan.truncated && <span className="rounded-md border border-amber-200 bg-amber-50 text-amber-700 px-1.5 py-0.5 dark:border-amber-800/60 dark:bg-transparent dark:text-amber-300/80">{t('grafo recortado')}</span>}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase text-neutral-500">{t('Rutas propuestas')}</div>
        {plan.routes.map((route) => (
          <div
            key={route.id}
            className="rounded-lg border border-neutral-800 hover:border-indigo-700 hover:bg-neutral-900 px-3 py-2.5 transition-colors group"
          >
            <button className="w-full text-left" onClick={() => onStart(route)}>
              <div className="flex items-center gap-2">
                <WeightDots weight={route.weight} />
                <span className="text-sm font-medium flex-1 min-w-0">{route.title}</span>
                <Icon name="chevronRight" size={15} className="text-neutral-600 group-hover:text-indigo-300" />
              </div>
              <div className="text-[11px] text-neutral-500 mt-1 flex flex-wrap gap-1.5">
                <span className="text-indigo-300/80">{route.weightLabel}</span>
                <span>· {tx('{n} paradas', { n: route.stops.length })}</span>
                {route.themes.length > 0 && <span>· {route.themes.slice(0, 3).join(', ')}</span>}
              </div>
              {route.description && <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{route.description}</p>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavedRoutesPanel({
  routes,
  loading,
  onStart,
  onRate,
  onDelete,
  onRefresh,
}: {
  routes: TutorSavedRoute[];
  loading: boolean;
  onStart: (route: TutorSavedRoute) => void;
  onRate: (routeId: string, rating: number | null) => void;
  onDelete: (route: TutorSavedRoute) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase text-neutral-500">{t('Recorridos guardados')}</div>
        <button className="btn btn-ghost text-xs px-2 py-1 gap-1" onClick={onRefresh} disabled={loading}>
          <Icon name="refresh" size={13} className={loading ? 'animate-spin' : ''} /> {t('Actualizar')}
        </button>
      </div>

      {loading ? (
        <Spinner label={t('Cargando recorridos…')} />
      ) : routes.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-500">
          {t('Todavía no hay recorridos guardados. Completa una ruta, puntúala y elige guardarla para repetirla sin volver a llamar al modelo.')}
        </div>
      ) : (
        <div className="space-y-2">
          {routes.map((saved) => (
            <div key={saved.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{saved.route.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-neutral-500">
                    <span>{saved.mode === 'overview' ? t('Completo') : t('Objetivo')}</span>
                    <span>· {tx('{n} paradas', { n: saved.route.stops.length })}</span>
                    <span>· {formatDate(saved.generatedAt)}</span>
                    {saved.lastPlayedAt && <span>· {t('visto')} {formatDate(saved.lastPlayedAt)}</span>}
                  </div>
                  {saved.prompt && <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{saved.prompt}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="btn btn-primary px-2 py-1 gap-1" onClick={() => onStart(saved)} title={t('Iniciar recorrido')}>
                    <Icon name="play" size={14} /> {t('Play')}
                  </button>
                  <button
                    className="btn btn-ghost px-2 py-1 text-red-400 hover:text-red-300"
                    onClick={() => onDelete(saved)}
                    title={t('Eliminar recorrido guardado')}
                    aria-label={`${t('Eliminar recorrido guardado')}: ${saved.route.title}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-800/70 pt-2">
                <span className="text-[11px] text-neutral-500">{t('Valoración')}</span>
                <RatingStars rating={saved.rating} onChange={(rating) => onRate(saved.id, rating)} allowClear={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RatingStars({
  rating,
  onChange,
  allowClear = true,
}: {
  rating: number | null;
  onChange: (rating: number | null) => void;
  allowClear?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          className={value <= (rating ?? 0) ? 'text-amber-300' : 'text-neutral-600 hover:text-neutral-300'}
          title={`${value}/5`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(allowClear && rating === value ? null : value);
          }}
        >
          <Icon name="star" size={15} />
        </button>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(getActiveLang(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

function TourPanel({
  route,
  stop,
  stopIndex,
  step,
  onJump,
  onRetry,
  showSavePrompt,
  isSaved,
  completionRating,
  savingRoute,
  onCompletionRating,
  onSave,
}: {
  route: TutorRoute;
  stop: TutorStop;
  stopIndex: number;
  step: StepState | undefined;
  onJump: (index: number) => void;
  onRetry: () => void;
  showSavePrompt: boolean;
  isSaved: boolean;
  completionRating: number | null;
  savingRoute: boolean;
  onCompletionRating: (rating: number | null) => void;
  onSave: () => void;
}) {
  const finished = stopIndex === route.stops.length - 1;
  return (
    <div className="p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <WeightDots weight={route.weight} />
          <span className="truncate">{route.title}</span>
        </div>
        {/* Step progress dots */}
        <div className="flex flex-wrap gap-1 mt-2">
          {route.stops.map((s, i) => (
            <button
              key={s.id}
              title={`${i + 1}. ${s.title}`}
              onClick={() => onJump(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === stopIndex ? 'w-6 bg-indigo-500' : i < stopIndex ? 'w-1.5 bg-neutral-500' : 'w-1.5 bg-neutral-700'
              }`}
            />
          ))}
        </div>
      </div>

<div className="rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-indigo-700 rounded bg-indigo-100 px-1.5 py-0.5 dark:text-indigo-300/80 dark:bg-indigo-600/15">
            {t(STOP_KIND_LABEL[stop.kind])}
          </span>
          <span className="text-sm font-semibold">{stop.title}</span>
        </div>
        {stop.focus && <p className="text-xs text-neutral-500 mt-1.5 dark:text-neutral-400">{stop.focus}</p>}
      </div>

      <div className="text-sm text-neutral-200 min-h-[3rem]">
        {step?.reasoning?.trim() && !step.error && (
          <details className="mb-2 rounded border border-neutral-800 bg-neutral-950/60" open={!step.text.trim()}>
            <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200">
              {t('Razonamiento')}
            </summary>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-neutral-500">
              {step.reasoning}
            </div>
          </details>
        )}
        {step?.error ? (
          <div className="text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 text-sm">
            <div>{step.text}</div>
            <button className="btn btn-ghost border border-red-800/60 text-xs mt-2 gap-1" onClick={onRetry}>
              <Icon name="refresh" size={13} /> {t('Reintentar')}
            </button>
          </div>
        ) : step?.text ? (
          <Markdown content={step.text} />
        ) : (
          <Spinner label={t('El Tutor está preparando la explicación…')} />
        )}
      </div>

      {finished && showSavePrompt && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-700/70 dark:bg-indigo-950/20">
          <div className="text-sm font-medium">{t('¿Quieres guardar este recorrido?')}</div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('Puntúalo para guardarlo y poder repetirlo después.')}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <RatingStars rating={completionRating} onChange={onCompletionRating} />
            <button className="btn btn-primary text-xs gap-1.5" disabled={!completionRating || savingRoute || step?.loading} onClick={onSave}>
              <Icon name="star" size={14} /> {savingRoute ? t('Guardando…') : t('Guardar ruta')}
            </button>
          </div>
        </div>
      )}
      {finished && isSaved && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300">
          <Icon name="check" size={13} className="mr-1 inline-block" /> {t('Recorrido guardado en tu colección.')}
        </div>
      )}
    </div>
  );
}

function WeightDots({ weight }: { weight: number }) {
  return (
    <span className="inline-flex gap-0.5 shrink-0" title={`${t('Peso')} ${weight}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= weight ? 'bg-indigo-400' : 'bg-neutral-700'}`} />
      ))}
    </span>
  );
}

function parseModel(value: string): ModelRef {
  const [provider, model] = value.split('::');
  return { provider: provider as ModelRef['provider'], model };
}
