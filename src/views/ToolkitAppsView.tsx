import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, ModelRef, PromptLanguage } from '@shared/types';
import {
  TOOLKIT_APP_CATEGORY_LABELS,
  type StoredToolkitApp,
  type ToolkitAppCategory,
  type ToolkitAppGenerationPhase,
  type ToolkitAppGenerationProgress,
  type ToolkitAppManifest,
  type ToolkitAppSessionInfo,
  type ToolkitAppSessionSnapshot,
} from '@shared/toolkitApps';
import { ConfirmModal } from '../components/ConfirmModal';
import { ModelPicker } from '../components/ModelPicker';
import { Icon } from '../components/ui';
import { errorText, t, tx } from '../i18n';
import { clearToolkitAppPersistedState, ToolkitAppPreview } from '../toolkitApps/AppPreview';
import { ToolkitAppSession } from '../toolkitApps/AppSession';
import {
  INCLUDED_TOOLKIT_APPS,
  createStoredToolkitApp,
  readGeneratedToolkitApps,
  writeGeneratedToolkitApps,
} from '../toolkitApps/catalog';

type Screen = 'catalog' | 'studio' | 'detail';
type DetailTab = 'run' | 'share';
type CatalogueFilter = 'available' | 'mine' | 'archived';

const STARTERS = [
  {
    icon: 'book',
    label: 'Para estudiar',
    prompt: 'Una app de repaso activo para preparar un examen: preguntas y respuestas creadas por mí, sesiones cortas y una lista de conceptos que necesito volver a revisar.',
  },
  {
    icon: 'search',
    label: 'Para investigar',
    prompt: 'Una matriz para comparar artículos académicos por pregunta, método, muestra, hallazgo, limitaciones y relación con mi investigación. Debe guardar los datos y permitir buscar y filtrar.',
  },
  {
    icon: 'graduation',
    label: 'Para enseñar',
    prompt: 'Un planificador de seminarios que reparta el tiempo entre explicación, trabajo individual, discusión y cierre, y avise si la sesión supera la duración disponible.',
  },
  {
    icon: 'users',
    label: 'Para un grupo',
    prompt: 'Una actividad por QR para que un grupo responda de forma anónima a una pregunta y el anfitrión vea un resumen en directo sin calificar ni identificar a nadie.',
  },
];

const CATEGORY_COLORS: Record<ToolkitAppCategory, string> = {
  game: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  productivity: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  utility: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  education: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  creative: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  social: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  other: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

const GENERATION_STEPS: Array<{ phase: Exclude<ToolkitAppGenerationPhase, 'complete'>; label: string }> = [
  { phase: 'planning', label: 'Entendiendo tu idea' },
  { phase: 'building', label: 'Construyendo la app' },
  { phase: 'design-review', label: 'Revisando la coherencia visual' },
  { phase: 'function-review', label: 'Comprobando funciones y conexiones' },
  { phase: 'validating', label: 'Validando el paquete final' },
];

function GenerationProgress({ progress }: { progress: ToolkitAppGenerationProgress }) {
  const activeIndex = progress.phase === 'complete' ? GENERATION_STEPS.length - 1 : Math.max(0, GENERATION_STEPS.findIndex((step) => step.phase === progress.phase));
  return (
    <div className="mx-auto w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900" data-testid="toolkit-app-generation-progress" data-phase={progress.phase}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="sparkles" size={19} /></span>
        <div><p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">{tx('Paso {current} de {total}', { current: String(progress.current), total: String(progress.total) })}</p><h2 className="mt-1 text-lg font-semibold">{t(GENERATION_STEPS[activeIndex].label)}</h2></div>
      </div>
      <div className="mt-6 space-y-2">
        {GENERATION_STEPS.map((step, index) => {
          const complete = progress.phase === 'complete' || index < activeIndex;
          const active = index === activeIndex && progress.phase !== 'complete';
          return <div key={step.phase} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/35 dark:text-amber-100' : complete ? 'text-emerald-700 dark:text-emerald-300' : 'text-neutral-400'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${complete ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-amber-500 text-amber-600' : 'border-neutral-300 dark:border-neutral-700'}`}>{complete ? <Icon name="check" size={11} /> : active ? <Icon name="sync" size={11} className="animate-spin" /> : index + 1}</span><span className={active ? 'font-medium' : ''}>{t(step.label)}</span></div>;
        })}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-neutral-500">{t('Nodus construye, revisa el diseño y prueba la lógica antes de enseñarte el resultado.')}</p>
    </div>
  );
}

function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function displayTitle(app: StoredToolkitApp): string {
  return app.source === 'included' ? t(app.manifest.title) : app.manifest.title;
}

function displaySummary(app: StoredToolkitApp): string {
  return app.source === 'included' ? t(app.manifest.summary) : app.manifest.summary;
}

function BackButton({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="btn btn-ghost h-9 px-3"><Icon name="arrowLeft" size={14} />{t(label)}</button>;
}

function AppCard({ app, onOpen }: { app: StoredToolkitApp; onOpen: () => void }) {
  const meta = TOOLKIT_APP_CATEGORY_LABELS[app.manifest.category];
  const status = app.source === 'included' ? 'Incluida' : app.status === 'archived' ? 'Archivada' : 'Creada por ti';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`toolkit-app-card-${app.id}`}
      className="group flex h-full min-h-60 flex-col rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-amber-600"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span className={`grid h-11 w-11 place-items-center rounded-xl ${CATEGORY_COLORS[app.manifest.category]}`}><Icon name={meta.icon} size={20} /></span>
        <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-800">{t(status)}</span>
      </div>
      <h3 className="mt-4 text-base font-semibold text-neutral-900 group-hover:text-amber-700 dark:text-neutral-100 dark:group-hover:text-amber-300">{displayTitle(app)}</h3>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-neutral-500">{displaySummary(app)}</p>
      <div className="mt-auto flex w-full items-center justify-between gap-3 pt-5 text-[11px] text-neutral-400">
        <span>{t(meta.name)}</span>
        <span className="inline-flex items-center gap-1">
          {app.manifest.capabilities.multiplayer ? <><Icon name="users" size={11} />{t('En directo')}</> : <><Icon name="wand" size={11} />{t('Adaptable con IA')}</>}
        </span>
      </div>
    </button>
  );
}

function Catalogue({ apps, onCreate, onOpen }: { apps: StoredToolkitApp[]; onCreate: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogueFilter>('available');
  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    return apps.filter((app) => {
      if (filter === 'available' && app.status === 'archived') return false;
      if (filter === 'mine' && (app.source !== 'generated' || app.status === 'archived')) return false;
      if (filter === 'archived' && app.status !== 'archived') return false;
      const meta = TOOLKIT_APP_CATEGORY_LABELS[app.manifest.category];
      const haystack = [displayTitle(app), displaySummary(app), t(meta.name), ...app.manifest.tags.map((tag) => app.source === 'included' ? t(tag) : tag)].join(' ');
      return !needle || fold(haystack).includes(needle);
    });
  }, [apps, filter, query]);

  const filters: Array<[CatalogueFilter, string]> = [['available', 'Explorar'], ['mine', 'Mis apps'], ['archived', 'Archivadas']];
  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="toolkit-apps-catalog">
      <header className="relative overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-indigo-50 p-6 dark:border-amber-900/50 dark:from-amber-950/30 dark:via-neutral-950 dark:to-indigo-950/20 sm:p-8">
        <div className="absolute -right-12 -top-24 h-64 w-64 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="sparkles" size={11} />Nodus App Studio</span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-white">{t('Herramientas hechas para tu forma de trabajar.')}</h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{t('Describe una necesidad de estudio, docencia o investigación. La IA construye la app, tú la pruebas y puedes pedir cambios con tus propias palabras.')}</p>
          </div>
          <button data-testid="toolkit-app-create" type="button" className="btn btn-primary h-11 shrink-0 px-5" onClick={onCreate}><Icon name="wand" size={15} />{t('Crear una app con IA')}</button>
        </div>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input data-testid="toolkit-app-search" aria-label={t('Buscar apps')} className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar por tarea o necesidad…')} />
        </div>
        <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
          {filters.map(([id, label]) => <button key={id} type="button" className={`rounded-lg px-3 py-2 text-xs ${filter === id ? 'bg-white font-medium shadow-sm dark:bg-neutral-800' : 'text-neutral-500'}`} onClick={() => setFilter(id)}>{t(label)}</button>)}
        </div>
      </div>
      {filtered.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((app) => <AppCard key={app.id} app={app} onOpen={() => onOpen(app.id)} />)}</div> : (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center dark:border-neutral-700"><Icon name="search" size={24} className="text-neutral-400" /><p className="mt-3 text-sm text-neutral-500">{t('No hay apps que coincidan con esta búsqueda.')}</p></div>
      )}
    </div>
  );
}

function Studio({
  settings,
  initialApp,
  initialInstruction,
  onCancel,
  onSave,
}: {
  settings: AppSettings | null;
  initialApp: StoredToolkitApp | null;
  initialInstruction: string;
  onCancel: () => void;
  onSave: (manifest: ToolkitAppManifest, history: string[]) => void;
}) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const [model, setModel] = useState<ModelRef | null>(settings?.synthesisModel ?? null);
  const [generated, setGenerated] = useState<ToolkitAppManifest | null>(initialApp?.manifest ?? null);
  const [history, setHistory] = useState<string[]>(initialApp?.promptHistory ?? []);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ToolkitAppGenerationProgress>({ phase: 'planning', current: 1, total: 5 });
  const [error, setError] = useState('');
  const revising = Boolean(initialApp);

  useEffect(() => { if (!model && settings?.synthesisModel) setModel(settings.synthesisModel); }, [model, settings]);

  const generate = async () => {
    const request = instruction.trim();
    if (!request) { setError(revising ? t('Describe el cambio que quieres ver.') : t('Describe la herramienta que necesitas.')); return; }
    setBusy(true); setError('');
    setProgress({ phase: 'planning', current: 1, total: 5 });
    try {
      const result = await window.nodus.generateToolkitApp({
        instruction: request,
        language: (settings?.promptLanguage ?? 'es') as PromptLanguage,
        model,
        previousManifest: generated,
      }, setProgress);
      setGenerated(result.manifest);
      setHistory((current) => [...current, request].slice(-30));
      setChanged(true);
      setInstruction('');
    } catch (cause) {
      setError(errorText(cause));
    } finally { setBusy(false); }
  };

  const applyStarter = (prompt: string) => setInstruction(t(prompt));
  const handleRepairRequest = (message: string) => {
    setInstruction(tx('Corrige este error de la app y comprueba todas sus interacciones: {error}', { error: message }));
  };

  return (
    <div className="mx-auto max-w-[1380px]" data-testid="toolkit-app-studio">
      <div className="mb-5 flex items-center justify-between gap-3">
        <BackButton onClick={onCancel} />
        {generated && changed && <button data-testid="toolkit-app-save" type="button" className="btn btn-primary" onClick={() => onSave(generated, history)}><Icon name="save" size={13} />{t(revising ? 'Usar esta versión' : 'Guardar en Mis apps')}</button>}
      </div>
      <div className="grid min-h-[720px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-neutral-200 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-950/30 lg:border-b-0 lg:border-r">
          <div className="border-b border-neutral-200 p-5 dark:border-neutral-800">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-indigo-500 text-white"><Icon name="wand" size={18} /></span>
              <div><h1 className="font-semibold">{t(revising ? 'Mejora la app hablando con la IA' : 'Cuéntanos qué necesitas')}</h1><p className="text-xs text-neutral-500">{t('No necesitas saber programar.')}</p></div>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {history.length === 0 && !revising ? <>
              <p className="px-1 text-xs leading-relaxed text-neutral-500">{t('Puedes empezar con una frase. La IA se ocupará de la estructura, el diseño y el funcionamiento.')}</p>
              <div className="grid gap-2">
                {STARTERS.map((starter) => <button key={starter.label} type="button" className="rounded-xl border border-neutral-200 bg-white p-3 text-left hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900" onClick={() => applyStarter(starter.prompt)}><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"><Icon name={starter.icon} size={12} />{t(starter.label)}</span><span className="mt-1.5 line-clamp-3 block text-xs leading-relaxed text-neutral-500">{t(starter.prompt)}</span></button>)}
              </div>
            </> : <>
              {revising && history.length === 0 && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"><Icon name="sparkles" size={12} /> {t('Esta es la versión actual. Pide un cambio concreto o explica qué te resulta difícil.')}</div>}
              {history.map((item, index) => <div key={`${item}-${index}`} className="ml-7 rounded-2xl rounded-br-sm bg-amber-100 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{item}</div>)}
            </>}
          </div>
          <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
            <label className="mb-1.5 block text-[11px] font-medium text-neutral-600 dark:text-neutral-300" htmlFor="toolkit-app-instruction">{t(revising ? '¿Qué quieres cambiar?' : '¿Qué debería hacer la app?')}</label>
            <textarea data-testid="toolkit-app-instruction" id="toolkit-app-instruction" className="input min-h-28 w-full resize-none text-sm" maxLength={8000} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t(revising ? 'Ej. Simplifica la pantalla inicial y añade un filtro por fecha…' : 'Ej. Necesito organizar las fuentes de mi trabajo final y comparar sus conclusiones…')} />
            {settings && <details className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"><summary className="cursor-pointer text-[10px] font-medium text-neutral-500">{t('Modelo de IA')}</summary><ModelPicker settings={settings} value={model} onChange={setModel} allowEmpty={false} compact className="mt-2 w-full" /></details>}
            {!model && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t('Elige un modelo de IA para construir la app.')}</p>}
            {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/20 dark:text-rose-300">{error}</p>}
            <button data-testid="toolkit-app-generate" type="button" className="btn btn-primary mt-2 h-11 w-full" disabled={busy || !settings || !model || !instruction.trim()} onClick={() => void generate()}>{busy ? <Icon name="sync" className="animate-spin" /> : <Icon name="sparkles" />} {t(busy ? (GENERATION_STEPS.find((step) => step.phase === progress.phase)?.label ?? 'Validando el paquete final') : revising ? 'Aplicar el cambio con IA' : 'Crear la app con IA')}</button>
            <div className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-neutral-400"><Icon name="shield" size={13} className="mt-0.5 shrink-0" /><span>{t('La app se ejecuta aislada, sin acceso a Internet, archivos, credenciales ni datos de Nodus.')}</span></div>
          </div>
        </aside>
        <section className="min-w-0 bg-neutral-100 p-3 dark:bg-neutral-950 sm:p-5">
          {busy ? <div className="grid h-full min-h-[650px] place-items-center px-4"><GenerationProgress progress={progress} /></div> : generated ? <div><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">{generated.title}</h2><p className="text-xs text-neutral-500">{t(changed ? 'Prueba la nueva versión. Si algo no encaja, pide otro cambio.' : 'Prueba la app actual y describe cualquier mejora con tus palabras.')}</p></div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Icon name="play" size={10} />{t('En ejecución')}</span></div><ToolkitAppPreview manifest={generated} appId={initialApp?.id ?? 'creator-preview'} onRequestRepair={handleRepairRequest} /></div> : (
            <div className="grid h-full min-h-[650px] place-items-center"><div className="max-w-md text-center"><span className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-white text-amber-600 shadow-xl dark:bg-neutral-900"><Icon name="sparkles" size={30} /></span><h2 className="mt-6 text-2xl font-semibold">{t('La IA preparará una primera versión')}</h2><p className="mt-2 text-sm leading-relaxed text-neutral-500">{t('Podrás utilizarla aquí mismo y seguir pidiendo cambios hasta que se adapte a ti.')}</p></div></div>
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({
  app,
  onBack,
  onImprove,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  app: StoredToolkitApp;
  onBack: () => void;
  onImprove: (seed?: string) => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('run');
  const [fullscreen, setFullscreen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [liveInfo, setLiveInfo] = useState<ToolkitAppSessionInfo | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<ToolkitAppSessionSnapshot>({ participants: [], messages: [] });
  const meta = TOOLKIT_APP_CATEGORY_LABELS[app.manifest.category];
  const tabs: Array<[DetailTab, string, string]> = [['run', 'Usar app', 'play'], ['share', 'Compartir por QR', 'share']];
  useEffect(() => {
    let active = true;
    const refreshInfo = async () => {
      const info = await window.nodus.getToolkitAppSessionInfo();
      if (active) setLiveInfo(info?.appTitle === app.manifest.title ? info : null);
    };
    void Promise.all([refreshInfo(), window.nodus.getToolkitAppSessionSnapshot().then((snapshot) => {
      if (active) setLiveSnapshot(snapshot);
    })]);
    const unsubscribe = window.nodus.onToolkitAppSessionEvent((event) => {
      if (event.type === 'stopped') {
        setLiveInfo(null);
        setLiveSnapshot({ participants: [], messages: [] });
        return;
      }
      setLiveSnapshot(event.snapshot);
      void refreshInfo();
    });
    return () => { active = false; unsubscribe(); };
  }, [app.manifest.title]);
  const liveRuntimeSession = useMemo(() => liveInfo && app.manifest.capabilities.multiplayer ? {
    role: 'host' as const,
    participant: { id: 0, name: t('Anfitrión') },
    messages: liveSnapshot.messages,
    send: (channel: string, payload: Parameters<typeof window.nodus.sendToolkitAppSessionMessage>[1]) => window.nodus.sendToolkitAppSessionMessage(channel, payload),
  } : null, [app.manifest.capabilities.multiplayer, liveInfo, liveSnapshot.messages]);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);
  const download = async () => {
    if (downloadBusy) return;
    setDownloadBusy(true); setDownloadNotice(null);
    try {
      const saved = await window.nodus.downloadToolkitAppPackage(app.manifest);
      if (saved) setDownloadNotice({ kind: 'success', text: t('Paquete guardado en tu ordenador.') });
    } catch (cause) { setDownloadNotice({ kind: 'error', text: errorText(cause) }); }
    finally { setDownloadBusy(false); }
  };
  const requestRepair = (message: string) => { setFullscreen(false); onImprove(tx('Corrige este error de la app y comprueba todas sus interacciones: {error}', { error: message })); };
  return (
    <div className="mx-auto max-w-[1380px]" data-testid="toolkit-app-detail">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <BackButton onClick={onBack} label="Todas las apps" />
        <div className="flex flex-wrap gap-2">
          <button data-testid="toolkit-app-improve" type="button" className="btn btn-primary" onClick={() => onImprove()}><Icon name="wand" size={13} />{t('Mejorar con IA')}</button>
          <button type="button" className="btn btn-secondary" onClick={onDuplicate}><Icon name="copy" size={13} />{t('Crear una copia')}</button>
          <button data-testid="toolkit-app-download" type="button" className="btn btn-secondary" disabled={downloadBusy} onClick={() => void download()}><Icon name={downloadBusy ? 'sync' : 'download'} className={downloadBusy ? 'animate-spin' : ''} size={13} />{t(downloadBusy ? 'Preparando paquete…' : 'Descargar paquete')}</button>
          <button data-testid="toolkit-app-fullscreen-open" type="button" className="btn btn-secondary h-9 w-9 p-0" title={t('Pantalla completa')} aria-label={t('Pantalla completa')} onClick={() => { setTab('run'); setFullscreen(true); }}><Icon name="fit" size={15} /></button>
          {app.source === 'generated' && <><button type="button" className="btn btn-secondary" onClick={onArchive}><Icon name="archive" size={13} />{t(app.status === 'archived' ? 'Restaurar' : 'Archivar')}</button><button data-testid="toolkit-app-delete" type="button" className="btn text-rose-600" onClick={onDelete}><Icon name="trash" size={13} />{t('Eliminar')}</button></>}
        </div>
      </div>
      <header className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="flex items-start gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${CATEGORY_COLORS[app.manifest.category]}`}><Icon name={meta.icon} size={22} /></span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{displayTitle(app)}</h1><span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-800">{t(meta.name)}</span>{app.manifest.capabilities.multiplayer && <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">{t('Multijugador')}</span>}</div><p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-500">{displaySummary(app)}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-400"><span className="inline-flex items-center gap-1"><Icon name="fit" size={12} />{t(app.manifest.viewport === 'responsive' ? 'Se adapta a la pantalla' : app.manifest.viewport === 'mobile' ? 'Diseño móvil' : 'Escritorio')}</span>{app.manifest.capabilities.storage && <span className="inline-flex items-center gap-1"><Icon name="save" size={12} />{t('Guarda sus datos')}</span>}<span className="inline-flex items-center gap-1"><Icon name="shield" size={12} />{t('Ejecución aislada')}</span></div></div>
        </div>
      </header>
      {downloadNotice && <p role={downloadNotice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-xs ${downloadNotice.kind === 'error' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>{downloadNotice.text}</p>}
      <nav className="my-5 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">{tabs.map(([id, label, icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm ${tab === id ? 'border-amber-500 font-medium text-amber-700 dark:text-amber-300' : 'border-transparent text-neutral-500'}`}><Icon name={icon} size={13} />{t(label)}</button>)}</nav>
      {tab === 'run' && !fullscreen && <ToolkitAppPreview manifest={app.manifest} appId={app.id} session={liveRuntimeSession} onRequestRepair={requestRepair} />}
      {tab === 'share' && <ToolkitAppSession app={app} />}
      {fullscreen && <div className="fixed inset-0 z-[120] flex min-h-0 flex-col bg-neutral-100 dark:bg-neutral-950" role="dialog" aria-modal="true" aria-label={tx('{name} a pantalla completa', { name: displayTitle(app) })} data-testid="toolkit-app-fullscreen">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900"><span className={`grid h-8 w-8 place-items-center rounded-lg ${CATEGORY_COLORS[app.manifest.category]}`}><Icon name={meta.icon} size={15} /></span><div className="min-w-0"><strong className="block truncate text-sm">{displayTitle(app)}</strong><span className="block text-[10px] text-neutral-500">{t('Vista a pantalla completa')}</span></div><button data-testid="toolkit-app-fullscreen-close" type="button" className="btn btn-ghost ml-auto" onClick={() => setFullscreen(false)}><Icon name="x" size={13} />{t('Cerrar')}</button></header>
        <main className="min-h-0 flex-1 p-2 sm:p-3"><ToolkitAppPreview manifest={app.manifest} appId={app.id} session={liveRuntimeSession} fill className="h-full rounded-xl" onRequestRepair={requestRepair} /></main>
      </div>}
    </div>
  );
}

export function ToolkitAppsView({ onBack, settings }: { onBack: () => void; settings: AppSettings | null }) {
  const [generatedApps, setGeneratedApps] = useState<StoredToolkitApp[]>(() => readGeneratedToolkitApps());
  const [screen, setScreen] = useState<Screen>('catalog');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studioTarget, setStudioTarget] = useState<StoredToolkitApp | null>(null);
  const [studioSeed, setStudioSeed] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StoredToolkitApp | null>(null);
  const apps = useMemo(() => [...INCLUDED_TOOLKIT_APPS, ...generatedApps], [generatedApps]);
  const selected = selectedId ? apps.find((app) => app.id === selectedId) ?? null : null;

  const persist = (next: StoredToolkitApp[]) => { setGeneratedApps(next); writeGeneratedToolkitApps(next); };
  const open = (id: string) => { setSelectedId(id); setScreen('detail'); };
  const create = () => { setStudioTarget(null); setStudioSeed(''); setScreen('studio'); };
  const improve = (app: StoredToolkitApp, seed = '') => { setStudioTarget(app); setStudioSeed(seed); setScreen('studio'); };
  const saveStudio = (manifest: ToolkitAppManifest, history: string[]) => {
    const latestInstruction = history.at(-1) ?? '';
    if (studioTarget?.source === 'generated') {
      const next = generatedApps.map((entry) => entry.id === studioTarget.id ? { ...entry, manifest, sourceInstruction: latestInstruction, promptHistory: history, status: 'ready' as const, updatedAt: new Date().toISOString() } : entry);
      persist(next); setSelectedId(studioTarget.id);
    } else {
      const app = createStoredToolkitApp(manifest, latestInstruction, { promptHistory: history, originAppId: studioTarget?.id });
      persist([app, ...generatedApps]); setSelectedId(app.id);
    }
    setStudioTarget(null); setStudioSeed(''); setScreen('detail');
  };
  const duplicate = (app: StoredToolkitApp) => {
    const copy = createStoredToolkitApp({ ...app.manifest, title: tx('{name} — copia', { name: displayTitle(app) }) }, app.sourceInstruction, { promptHistory: app.promptHistory, originAppId: app.id });
    persist([copy, ...generatedApps]); open(copy.id);
  };
  const archive = (app: StoredToolkitApp) => {
    if (app.source !== 'generated') return;
    const status = app.status === 'archived' ? 'ready' : 'archived';
    persist(generatedApps.map((entry) => entry.id === app.id ? { ...entry, status, updatedAt: new Date().toISOString() } : entry));
    if (status === 'archived') { setSelectedId(null); setScreen('catalog'); }
  };
  const confirmDelete = () => {
    if (!deleteTarget || deleteTarget.source !== 'generated') return;
    clearToolkitAppPersistedState(deleteTarget.id);
    persist(generatedApps.filter((entry) => entry.id !== deleteTarget.id));
    setDeleteTarget(null); setSelectedId(null); setScreen('catalog');
  };

  return (
    <div className="mx-auto min-h-full max-w-[1480px]" data-testid="toolkit-apps-page">
      {screen === 'catalog' && <div><div className="mb-4"><BackButton onClick={onBack} label="Nodus Toolkit" /></div><Catalogue apps={apps} onCreate={create} onOpen={open} /></div>}
      {screen === 'studio' && <Studio key={`${studioTarget?.id ?? 'new'}-${studioSeed}`} settings={settings} initialApp={studioTarget} initialInstruction={studioSeed} onCancel={() => setScreen(studioTarget ? 'detail' : 'catalog')} onSave={saveStudio} />}
      {screen === 'detail' && selected && <Detail app={selected} onBack={() => setScreen('catalog')} onImprove={(seed) => improve(selected, seed)} onDuplicate={() => duplicate(selected)} onArchive={() => archive(selected)} onDelete={() => setDeleteTarget(selected)} />}
      {deleteTarget && <ConfirmModal title={t('Eliminar app')} message={tx('Se eliminará «{name}» y sus datos guardados en Nodus Apps. Esta acción no se puede deshacer.', { name: displayTitle(deleteTarget) })} confirmLabel={t('Eliminar app')} danger onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}
