import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AiProvider, AppSettings, ZoteroCollection, ModelRef, VaultSummary } from '@shared/types';
import { normalizeEmbeddingModel, normalizeEmbeddingProvider } from '@shared/providers';
import { getNodusLocalModel } from '@shared/localAiModels';
import { Spinner, Icon } from '../components/ui';
import { OnboardingModelStep } from '../components/OnboardingModelStep';
import { t, tx } from '../i18n';

type OnboardingExit = 'home' | 'library' | 'settings';

export function Onboarding({
  activeVault,
  settings,
  providerKeys,
  onDone,
  onCancel,
  discardsVault,
}: {
  activeVault: VaultSummary | null;
  settings: AppSettings;
  /** Which providers already have a (globally shared) key configured. */
  providerKeys?: Partial<Record<AiProvider, boolean>>;
  onDone: (view?: OnboardingExit) => void;
  /** Cancel the wizard (discards a freshly-created vault when `discardsVault`). */
  onCancel?: () => void | Promise<unknown>;
  discardsVault?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [ping, setPing] = useState<{ ok: boolean; userId?: string; message?: string } | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readTag, setReadTag] = useState('leído');
  // The two models the vault needs. Seeded from what this vault already has so a
  // re-run of the wizard shows the current choice instead of resetting it.
  const [aiModel, setAiModel] = useState<ModelRef | null>(settings.synthesisModel);
  const [embeddingModel, setEmbeddingModel] = useState<ModelRef | null>(
    settings.embeddingModel ? { provider: settings.embeddingProvider, model: settings.embeddingModel } : null
  );
  const [modelError, setModelError] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [syncedWorks, setSyncedWorks] = useState<number | null>(null);

  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  // The onboarding adapts to the active vault: only academic research starts with
  // Zotero. Genealogy, databases and study use a short intro → AI → done flow.
  const vaultType = activeVault?.type ?? 'academic';
  const simple = vaultType === 'genealogy' || vaultType === 'databases' || vaultType === 'estudio' || vaultType === 'docencia';
  const aiStep = simple ? 1 : 3; // the "AI provider" step index
  const doneStep = simple ? 2 : 4; // the final step index

  const exitOnboarding = async () => {
    if (!onCancel || exiting) return;
    setExiting(true);
    setExitError(null);
    try {
      await onCancel();
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error));
    } finally {
      setExiting(false);
    }
  };

  const checkZotero = async () => {
    const res = await window.nodus.zoteroPing();
    setPing(res);
    if (res.ok) {
      const libs = await window.nodus.zoteroLibraries().catch(() => []);
      const groups = await Promise.all(libs.map((library) => window.nodus.zoteroCollections(library).catch(() => [])));
      setCollections(groups.flat());
    }
  };

  useEffect(() => {
    if (!simple) void checkZotero();
  }, []);

  const toggleCollection = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Built-in models are chosen here but only fetched now, so the wizard stays
   *  responsive while browsing and the download runs once the choice is final. */
  const downloadLocalModels = async (refs: (ModelRef | null)[]) => {
    const definitions = [...new Set(refs.filter((ref) => ref?.provider === 'nodus').map((ref) => ref!.model))]
      .map((id) => {
        const definition = getNodusLocalModel(id);
        if (!definition) throw new Error(t('El modelo local seleccionado ya no está disponible.'));
        return definition;
      });
    if (!definitions.length) return;
    const status = await window.nodus.getNodusLocalAiStatus();
    const needsRuntime = definitions.some((model) => model.runtime === 'llama_cpp') && !status.runtime.ready;
    const pending = definitions.filter((model) => !status.models.find((entry) => entry.id === model.id)?.downloaded);
    const total = (needsRuntime ? 1 : 0) + pending.length;
    if (!total) return;
    let done = 0;
    const onProgress = (fraction: number) => setDownloadProgress((done + fraction) / total);
    if (needsRuntime) {
      setDownloadLabel(t('Preparando el motor local…'));
      await window.nodus.installNodusLocalRuntime(onProgress);
      done += 1;
    }
    for (const model of pending) {
      setDownloadLabel(tx('Descargando {model}…', { model: model.label }));
      await window.nodus.downloadNodusLocalModel(model.id, onProgress);
      done += 1;
    }
    setDownloadProgress(1);
    setDownloadLabel('');
  };

  const finish = async () => {
    if (!aiModel || !embeddingModel) {
      setModelError(t('Elige un modelo de IA y uno de embeddings para continuar.'));
      return;
    }
    setFinishing(true);
    setFinishError(null);
    setModelError(null);
    setSyncSummary(null);
    setSyncedWorks(null);
    setDownloadProgress(0);
    try {
      await downloadLocalModels([aiModel, embeddingModel]);
      const favorites = settings.favorites.some((model) => model.provider === aiModel.provider && model.model === aiModel.model)
        ? settings.favorites
        : [...settings.favorites, aiModel];
      const embeddingProvider = normalizeEmbeddingProvider(embeddingModel.provider);
      await window.nodus.updateSettings({
        ...(simple ? {} : { monitoredCollections: Array.from(selected), readTag, zoteroStoragePath: storagePath }),
        favorites,
        synthesisModel: aiModel,
        embeddingProvider,
        embeddingModel: normalizeEmbeddingModel(embeddingProvider, embeddingModel.model),
        modelSettingsMode: 'basic',
        onboardingComplete: true,
      });
      setStep(doneStep);
      // Only academic vaults ingest Zotero during setup. Study can import files or
      // connect Zotero later from its own Materials section.
      if (!simple) {
        const sync = await window.nodus.syncNow();
        const works = await window.nodus.listWorks();
        setSyncSummary(sync.summary);
        setSyncedWorks(works.length);
      }
    } catch (e) {
      setStep(doneStep);
      setFinishError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinishing(false);
    }
  };

  const steps = simple
    ? [t('Introducción'), t('Proveedor de IA'), t('Listo')]
    : [t('Conectar Zotero'), t('Colecciones'), t('Lecturas'), t('Proveedor de IA'), t('Primer resultado')];
  const intro =
    vaultType === 'genealogy'
      ? {
          subtitle: t('Reconstruye tu historia familiar en un árbol navegable, con evidencias citadas y parentescos sugeridos por la IA. Todo es local.'),
          body: t('Añade personas y sus vínculos, documenta cada dato con su fuente y explora el árbol, la línea temporal y el archivo de evidencias. Configura un modelo de IA para las sugerencias de parentesco.'),
        }
      : vaultType === 'databases'
        ? {
            subtitle: t('Organiza tus datos en tablas tipo Notion con columnas tipadas, relaciones, rollups y análisis con IA. Todo es local.'),
            body: t('Crea bases de datos con columnas de texto, número, selección, adjuntos, relaciones y rollups; impórtalas desde CSV y analízalas o conversa con ellas. Configura un modelo de IA para las columnas y el chat.'),
          }
        : vaultType === 'estudio'
          ? {
              subtitle: t('Organiza cursos, apuntes, materiales y repasos en un espacio de aprendizaje local.'),
              body: t('Empieza creando tus cursos y asignaturas. Después podrás importar archivos o enlazar materiales de Zotero de forma opcional, grabar clases, generar preguntas y repasar con ayuda de la IA.'),
            }
        : vaultType === 'docencia'
          ? {
              subtitle: t('Organiza tu docencia: cursos, materiales, horarios y clases en un espacio local y privado.'),
              body: t('Empieza creando tus cursos y asignaturas. Después podrás importar archivos o enlazar materiales de Zotero de forma opcional, planificar horarios y calendario, y grabar tus clases.'),
            }
        : { subtitle: '', body: '' };

  return (
    <div className="h-full flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card w-full max-w-2xl p-8"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-2xl font-semibold mb-1">{t('Bienvenido a Nodus')}</div>
          {onCancel && (
            <button
              className="btn btn-ghost shrink-0 gap-1 text-xs text-neutral-400"
              onClick={() => (discardsVault ? setConfirmExit(true) : void onCancel())}
              title={t('Salir del asistente')}
            >
              <Icon name="x" size={14} /> {t('Salir')}
            </button>
          )}
        </div>
        <p className="text-neutral-400 text-sm mb-6">
          {simple ? intro.subtitle : t('Teje tu biblioteca de Zotero en un grafo navegable de ideas y autores. Todo es local.')}
        </p>

        {confirmExit && (
          <div className="mb-5 rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-sm">
            <p className="text-amber-200">
              {tx('Si sales ahora, se descartará la bóveda «{name}» que acabas de crear. ¿Continuar?', { name: activeVault?.name ?? '' })}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-ghost text-xs" onClick={() => setConfirmExit(false)}>
                {t('Seguir configurando')}
              </button>
              <button className="btn bg-red-600 text-xs text-white hover:bg-red-500 disabled:opacity-50" disabled={exiting} onClick={() => void exitOnboarding()}>
                {exiting ? t('Saliendo…') : t('Salir y descartar')}
              </button>
            </div>
            {exitError && <p role="alert" className="mt-2 text-xs text-red-300">{exitError}</p>}
          </div>
        )}

        <div className="flex gap-2 mb-6">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 text-center text-xs py-1.5 rounded-lg ${
                i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-neutral-800 text-neutral-300' : 'bg-neutral-900 text-neutral-600'
              }`}
            >
              {s}
            </div>
          ))}
        </div>

        {step === 0 && simple && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">{intro.body}</p>
            <p className="text-xs text-neutral-500">{t('En el siguiente paso elegirás el modelo de IA y el de embeddings. Nodus detecta tus claves y carga los modelos disponibles por ti.')}</p>
          </div>
        )}

        {step === 0 && !simple && (
          <div className="space-y-4">
            <p className="text-sm">
              {t('Nodus usa la API local de Zotero 7 (solo lectura). Abre Zotero y verifica la conexión.')}
            </p>
            <button className="btn btn-primary" onClick={checkZotero}>
              {t('Verificar conexión')}
            </button>
            {ping && (
              <div className={`text-sm ${ping.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {ping.ok ? tx('Conectado (userID {id})', { id: ping.userId ?? '' }) : tx('No disponible: {msg}', { msg: ping.message ?? t('sin respuesta') })}
              </div>
            )}
          </div>
        )}

        {step === 1 && !simple && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">
              {t('Elige las colecciones a monitorizar. Despliega cualquier colección para elegir subcolecciones concretas si una es demasiado grande. Se incorporan metadatos; los análisis se lanzan manualmente salvo que actives automatización en Ajustes.')}
            </p>
            {selected.size > 0 && (
              <p className="text-xs text-emerald-400">{tx('{n} seleccionadas', { n: selected.size })}</p>
            )}
            <div className="max-h-64 overflow-y-auto pr-1">
              {collections.map((c) => (
                <OnboardingCollectionNode key={c.key} col={c} depth={0} selected={selected} onToggle={toggleCollection} />
              ))}
              {collections.length === 0 && <div className="text-neutral-500 text-sm">{t('No hay colecciones cargadas.')}</div>}
            </div>
          </div>
        )}

        {step === 2 && !simple && (
          <div className="space-y-4">
            <label className="block text-sm">
              {t('Tag de lectura')}
              <input className="input w-full mt-1" value={readTag} onChange={(e) => setReadTag(e.target.value)} />
            </label>
            <label className="block text-sm">
              {t('Ruta de la carpeta storage de Zotero (opcional, para localizar PDFs)')}
              <input
                className="input w-full mt-1"
                value={storagePath}
                placeholder="/Users/tu/Zotero/storage"
                onChange={(e) => setStoragePath(e.target.value)}
              />
            </label>
          </div>
        )}

        {step === aiStep && (
          <div className="space-y-4">
            <OnboardingModelStep
              settings={settings}
              providerKeys={providerKeys ?? {}}
              aiModel={aiModel}
              embeddingModel={embeddingModel}
              onAiChange={(ref) => { setAiModel(ref); setModelError(null); }}
              onEmbeddingChange={(ref) => { setEmbeddingModel(ref); setModelError(null); }}
              disabled={finishing}
            />
            {modelError && <p role="alert" className="text-sm text-red-400">{modelError}</p>}
            {finishing && downloadLabel && (
              <div className="rounded-lg border border-indigo-800/60 bg-indigo-950/25 p-3" data-testid="onboarding-model-download-progress">
                <div className="flex items-center justify-between gap-3 text-xs text-indigo-200">
                  <span>{downloadLabel}</span>
                  {downloadProgress > 0 && <span className="tabular-nums">{Math.round(downloadProgress * 100)}%</span>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800">
                  <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, downloadProgress * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === doneStep && (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold">{simple ? t('Listo') : t('Primer resultado')}</div>
              <p className="text-sm text-neutral-400 mt-1">
                {simple
                  ? t('Tu bóveda está lista. El panel de Inicio te guiará en los primeros pasos.')
                  : finishing
                    ? t('Sincronizando Zotero para preparar el panel inicial...')
                    : finishError
                      ? t('No se pudo completar la primera sincronización, pero puedes entrar y corregirlo desde Inicio o Ajustes.')
                      : t('La biblioteca local ya está preparada. El panel de Inicio te dirá qué conviene hacer después.')}
              </p>
            </div>
            {!simple && finishing && <Spinner label={t('Sincronizando metadatos...')} />}
            {finishError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {finishError}
              </div>
            )}
            {!simple && !finishing && !finishError && (
              <div className="grid grid-cols-2 gap-3">
                <ResultMetric label={t('Obras locales')} value={syncedWorks ?? 0} />
                <ResultMetric label={t('Colecciones')} value={selected.size} />
              </div>
            )}
            {syncSummary && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-300">
                {syncSummary}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between mt-8">
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || finishing}>
            {t('Atrás')}
          </button>
          {step < aiStep ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              {t('Siguiente')}
            </button>
          ) : step === aiStep ? (
            <button className="btn btn-primary" data-testid="onboarding-start" onClick={finish} disabled={finishing || !aiModel || !embeddingModel}>
              {finishing ? t('Preparando...') : t('Empezar')}
            </button>
          ) : (
            <div className="flex gap-2">
              {finishError && (
                <button className="btn btn-ghost border border-neutral-700" onClick={finish} disabled={finishing}>
                  {t('Reintentar')}
                </button>
              )}
              {!simple && (
                <button className="btn btn-ghost border border-neutral-700" onClick={() => onDone(aiModel ? 'library' : 'settings')} disabled={finishing}>
                  {aiModel ? t('Ir a Biblioteca') : t('Configurar IA')}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => onDone('home')} disabled={finishing}>
                {t('Abrir Inicio')}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * One row of the collection tree in the wizard: a checkbox to monitor this
 * collection plus an expander that lazily loads its subcollections (via
 * zoteroChildCollections) so a user can drill into a large collection and pick a
 * specific subcollection instead. Selection is independent per node — checking a
 * parent does not auto-check its children.
 */
function OnboardingCollectionNode({
  col,
  depth,
  selected,
  onToggle,
}: {
  col: ZoteroCollection;
  depth: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ZoteroCollection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const hasChildren = (col.subCount ?? 0) > 0;

  const expand = async () => {
    if (!open && children === null && hasChildren) {
      setLoading(true);
      const loaded = await window.nodus.zoteroChildCollections(col.key).catch(() => []);
      setChildren(loaded);
      setLoading(false);
    }
    setOpen((o) => !o);
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          className={`w-4 shrink-0 text-neutral-500 ${hasChildren ? 'hover:text-neutral-300' : 'invisible'}`}
          onClick={expand}
          aria-label={open ? t('Plegar') : t('Desplegar')}
          title={open ? t('Plegar') : t('Desplegar')}
        >
          {loading ? '…' : open ? '▾' : '▸'}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input type="checkbox" className="shrink-0" checked={selected.has(col.key)} onChange={() => onToggle(col.key)} />
          <span className="truncate">{col.name}</span>
          {depth === 0 && <span className="shrink-0 text-[10px] text-neutral-500">{col.library.type === 'group' ? col.library.name : t('Mi biblioteca')}</span>}
          <span className="shrink-0 text-neutral-600">
            ({col.itemCount} {t('ítems')}{col.subCount ? `, ${col.subCount} ${t('subcol.')}` : ''})
          </span>
        </label>
      </div>
      {open &&
        children?.map((c) => (
          <OnboardingCollectionNode key={c.key} col={c} depth={depth + 1} selected={selected} onToggle={onToggle} />
        ))}
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
