import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ModelRef, TutorMode, TutorPlan, TutorRoute, TutorStop } from '@shared/types';
import { Icon, Spinner, modelLabel } from '../components/ui';

type Phase = 'setup' | 'routes' | 'touring';

interface StepState {
  text: string;
  loading: boolean;
  error: boolean;
}

const STOP_KIND_LABEL: Record<TutorStop['kind'], string> = {
  theme: 'tema',
  idea: 'idea',
  connection: 'conexión',
};

export function TutorPanel({
  settings,
  onFocusNodes,
  onClearFocus,
  onClose,
}: {
  settings: AppSettings;
  onFocusNodes: (nodeIds: string[], edgeId?: string | null) => void;
  onClearFocus: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<TutorMode>('overview');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(settings.synthesisModel ?? settings.defaultModel);
  const [generating, setGenerating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TutorPlan | null>(null);
  const [route, setRoute] = useState<TutorRoute | null>(null);
  const [stopIndex, setStopIndex] = useState(0);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  // Guards against duplicate in-flight requests for the same stop.
  const inFlight = useRef<Set<string>>(new Set());

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (m: ModelRef | null | undefined) => {
      if (!m || models.some((x) => x.provider === m.provider && x.model === m.model)) return;
      models.push(m);
    };
    add(settings.synthesisModel);
    add(settings.defaultModel);
    add(selectedModel);
    for (const m of settings.favorites ?? []) add(m);
    return models;
  }, [settings.synthesisModel, settings.defaultModel, settings.favorites, selectedModel]);

  const stepKey = (routeId: string, index: number) => `${routeId}:${index}`;

  const loadStep = useCallback(
    async (activeRoute: TutorRoute, index: number) => {
      const key = stepKey(activeRoute.id, index);
      if (inFlight.current.has(key)) return;
      if (steps[key]?.text && !steps[key].error) return;
      inFlight.current.add(key);
      setSteps((cur) => ({ ...cur, [key]: { text: '', loading: true, error: false } }));
      try {
        const history = activeRoute.stops.slice(0, index).map((s) => s.title);
        const response = await window.nodus.tutorStepStream(
          { route: activeRoute, stopIndex: index, overview: plan?.overview ?? '', history, model: selectedModel },
          {
            onDelta: (delta) => {
              setSteps((cur) => {
                const prev = cur[key] ?? { text: '', loading: true, error: false };
                return { ...cur, [key]: { ...prev, text: prev.text + delta } };
              });
            },
          }
        );
        setSteps((cur) => ({ ...cur, [key]: { text: response.explanation, loading: false, error: false } }));
      } catch (e) {
        setSteps((cur) => ({
          ...cur,
          [key]: { text: e instanceof Error ? e.message : String(e), loading: false, error: true },
        }));
      } finally {
        inFlight.current.delete(key);
      }
    },
    [plan?.overview, selectedModel, steps]
  );

  // Spotlight the current stop on the real graph and ensure its narration is loaded.
  useEffect(() => {
    if (phase !== 'touring' || !route) return;
    const stop = route.stops[stopIndex];
    if (!stop) return;
    onFocusNodes(stop.nodeIds, stop.edgeId);
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
      setSteps({});
      setPhase('routes');
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const startRoute = (r: TutorRoute) => {
    setRoute(r);
    setStopIndex(0);
    setPhase('touring');
  };

  const backToRoutes = () => {
    setPhase('routes');
    setRoute(null);
    onClearFocus();
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
        <span className="font-semibold">Modo Tutor</span>
        <div className="flex-1" />
        {phase === 'touring' && (
          <button className="btn btn-ghost text-xs px-2 py-1 gap-1" onClick={backToRoutes} title="Volver a las rutas">
            <Icon name="chevronLeft" size={14} /> Rutas
          </button>
        )}
        {phase === 'routes' && (
          <button
            className="btn btn-ghost text-xs px-2 py-1 gap-1"
            onClick={() => {
              setPhase('setup');
              onClearFocus();
            }}
            title="Generar otro recorrido"
          >
            <Icon name="refresh" size={14} /> Nuevo
          </button>
        )}
        <button className="btn btn-ghost px-2 py-1" onClick={close} title="Cerrar modo Tutor">
          <Icon name="x" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {phase === 'setup' && (
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
        )}

        {phase === 'routes' && plan && <RoutesPanel plan={plan} onStart={startRoute} />}

        {phase === 'touring' && route && currentStop && (
          <TourPanel
            route={route}
            stop={currentStop}
            stopIndex={stopIndex}
            step={currentStep}
            onJump={setStopIndex}
            onRetry={() => void loadStep(route, stopIndex)}
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
            <Icon name="chevronLeft" /> Anterior
          </button>
          <span className="text-xs text-neutral-500 tabular-nums px-1">
            {stopIndex + 1}/{route.stops.length}
          </span>
          <button
            className="btn btn-primary flex-1 gap-1.5 disabled:opacity-40"
            onClick={() => setStopIndex((i) => Math.min(route.stops.length - 1, i + 1))}
            disabled={stopIndex >= route.stops.length - 1}
          >
            Siguiente <Icon name="chevronRight" />
          </button>
        </footer>
      )}
    </aside>
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
        Una IA de contexto largo analiza todas tus ideas, temas y conexiones y traza un recorrido guiado. Avanza con las
        flechas y el Tutor te lo explica paso a paso sobre el propio grafo.
      </p>

      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1.5">Tipo de recorrido</div>
        <div className="space-y-2">
          <ModeCard
            active={mode === 'overview'}
            title="Recorrido completo"
            description="El Tutor propone varias rutas que cubren todo el grafo, ordenadas por peso, y menciona todo lo importante."
            onClick={() => setMode('overview')}
          />
          <ModeCard
            active={mode === 'prompt'}
            title="Desde un objetivo"
            description="Describe qué quieres repasar y el Tutor traza un recorrido a medida con las ideas y conexiones pertinentes."
            onClick={() => setMode('prompt')}
          />
        </div>
      </div>

      {mode === 'prompt' && (
        <textarea
          className="input w-full min-h-24 resize-y"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ej.: Quiero repasar cómo se relaciona el concepto de identidad nacional con la literatura de viajes y dónde hay contradicciones."
        />
      )}

      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1.5">Modelo (recomendado: contexto largo)</div>
        <select className="input w-full text-sm" value={serializedModel} onChange={(e) => onModelChange(e.target.value)}>
          {!hasModel && <option value="">Sin modelo seleccionado</option>}
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
        {generating ? <Spinner label="Analizando el grafo…" /> : <><Icon name="wand" /> Generar recorrido</>}
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

function RoutesPanel({ plan, onStart }: { plan: TutorPlan; onStart: (route: TutorRoute) => void }) {
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="text-xs uppercase text-neutral-500">Panorama</div>
        <p className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">{plan.overview}</p>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-neutral-500">
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{plan.totalThemes} temas</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{plan.totalIdeas} ideas</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{plan.totalConnections} conexiones</span>
          <span className="rounded-md border border-neutral-800 px-1.5 py-0.5">{plan.coveredIdeas} ideas en rutas</span>
          {plan.truncated && <span className="rounded-md border border-amber-800/60 text-amber-300/80 px-1.5 py-0.5">grafo recortado</span>}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase text-neutral-500">Rutas propuestas</div>
        {plan.routes.map((route) => (
          <button
            key={route.id}
            onClick={() => onStart(route)}
            className="w-full text-left rounded-lg border border-neutral-800 hover:border-indigo-700 hover:bg-neutral-900 px-3 py-2.5 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <WeightDots weight={route.weight} />
              <span className="text-sm font-medium flex-1 min-w-0">{route.title}</span>
              <Icon name="chevronRight" size={15} className="text-neutral-600 group-hover:text-indigo-300" />
            </div>
            <div className="text-[11px] text-neutral-500 mt-1 flex flex-wrap gap-1.5">
              <span className="text-indigo-300/80">{route.weightLabel}</span>
              <span>· {route.stops.length} paradas</span>
              {route.themes.length > 0 && <span>· {route.themes.slice(0, 3).join(', ')}</span>}
            </div>
            {route.description && <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{route.description}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

function TourPanel({
  route,
  stop,
  stopIndex,
  step,
  onJump,
  onRetry,
}: {
  route: TutorRoute;
  stop: TutorStop;
  stopIndex: number;
  step: StepState | undefined;
  onJump: (index: number) => void;
  onRetry: () => void;
}) {
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

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-indigo-300/80 rounded bg-indigo-600/15 px-1.5 py-0.5">
            {STOP_KIND_LABEL[stop.kind]}
          </span>
          <span className="text-sm font-semibold">{stop.title}</span>
        </div>
        {stop.focus && <p className="text-xs text-neutral-400 mt-1.5">{stop.focus}</p>}
      </div>

      <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap min-h-[3rem]">
        {step?.error ? (
          <div className="text-red-300 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2 text-sm">
            <div>{step.text}</div>
            <button className="btn btn-ghost border border-red-800/60 text-xs mt-2 gap-1" onClick={onRetry}>
              <Icon name="refresh" size={13} /> Reintentar
            </button>
          </div>
        ) : step?.text ? (
          step.text
        ) : (
          <Spinner label="El Tutor está preparando la explicación…" />
        )}
      </div>
    </div>
  );
}

function WeightDots({ weight }: { weight: number }) {
  return (
    <span className="inline-flex gap-0.5 shrink-0" title={`Peso ${weight}/5`}>
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
