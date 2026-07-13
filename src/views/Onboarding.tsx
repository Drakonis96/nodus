import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AiProvider, ZoteroCollection, ModelInfo, VaultSummary } from '@shared/types';
import { AI_PROVIDERS, PROVIDER_LABELS, Spinner, Icon } from '../components/ui';
import { t, tx } from '../i18n';

type OnboardingExit = 'home' | 'library' | 'settings';

export function Onboarding({
  activeVault,
  providerKeys,
  onLanguageChosen,
  onDone,
  onCancel,
  discardsVault,
}: {
  activeVault: VaultSummary | null;
  /** Which providers already have a (globally shared) key configured. */
  providerKeys?: Partial<Record<AiProvider, boolean>>;
  /** Reload settings so the interface language switches once the user picks it. */
  onLanguageChosen: () => Promise<unknown>;
  onDone: (view?: OnboardingExit) => void;
  /** Cancel the wizard (discards a freshly-created vault when `discardsVault`). */
  onCancel?: () => void | Promise<unknown>;
  discardsVault?: boolean;
}) {
  // The very first thing a new user does is pick the interface language. Until
  // then the wizard is shown in English (this screen is intentionally not
  // translated); afterwards the rest of the wizard follows the chosen language.
  const [langChosen, setLangChosen] = useState(false);
  const [step, setStep] = useState(0);
  const [ping, setPing] = useState<{ ok: boolean; userId?: string; message?: string } | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readTag, setReadTag] = useState('leído');
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [storagePath, setStoragePath] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [syncedWorks, setSyncedWorks] = useState<number | null>(null);

  const [confirmExit, setConfirmExit] = useState(false);

  // The onboarding adapts to the active vault: academic vaults get the Zotero flow;
  // genealogy / databases vaults skip Zotero and get a short intro → AI → done flow.
  const vaultType = activeVault?.type ?? 'academic';
  const simple = vaultType === 'genealogy' || vaultType === 'databases';
  const aiStep = simple ? 1 : 3; // the "AI provider" step index
  const doneStep = simple ? 2 : 4; // the final step index
  // Providers already configured (keys are shared across all vaults).
  const configuredProviders = providerKeys ? AI_PROVIDERS.filter((p) => providerKeys[p]) : [];

  const checkZotero = async () => {
    const res = await window.nodus.zoteroPing();
    setPing(res);
    if (res.ok) {
      const cols = await window.nodus.zoteroCollections().catch(() => []);
      setCollections(cols);
    }
  };

  useEffect(() => {
    void checkZotero();
  }, []);

  const toggleCollection = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelError(null);
    try {
      if (apiKey.trim()) await window.nodus.setApiKey(provider, apiKey.trim());
      const list = await window.nodus.listModels(provider);
      setModels(list);
      if (list[0]) setSelectedModel(list[0].id);
    } catch (e) {
      setModelError((e as Error).message);
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    setSyncSummary(null);
    setSyncedWorks(null);
    try {
      if (apiKey.trim()) await window.nodus.setApiKey(provider, apiKey.trim());
      const ref = selectedModel ? { provider, model: selectedModel } : null;
      await window.nodus.updateSettings({
        ...(simple ? {} : { monitoredCollections: Array.from(selected), readTag, zoteroStoragePath: storagePath }),
        favorites: ref ? [ref] : [],
        extractionModel: ref,
        synthesisModel: ref,
        summaryModel: ref,
        fusionModel: ref,
        onboardingComplete: true,
      });
      setStep(doneStep);
      // Only academic vaults ingest Zotero; genealogy/databases have nothing to sync here.
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

  const chooseLanguage = async (lang: 'en' | 'es') => {
    await window.nodus.updateSettings({ uiLanguage: lang, promptLanguage: lang });
    await onLanguageChosen();
    setLangChosen(true);
  };

  if (!langChosen) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card w-full max-w-md p-8 text-center"
        >
          <div className="text-2xl font-semibold mb-1">Welcome to Nodus</div>
          <p className="text-neutral-400 text-sm mb-6">Choose your language to get started.</p>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-primary !py-3 text-base" onClick={() => void chooseLanguage('en')}>
              English
            </button>
            <button className="btn btn-primary !py-3 text-base" onClick={() => void chooseLanguage('es')}>
              Español
            </button>
          </div>
          <p className="mt-5 text-xs text-neutral-500">You can change this later in Settings.</p>
        </motion.div>
      </div>
    );
  }

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
              <button className="btn bg-red-600 text-xs text-white hover:bg-red-500" onClick={() => void onCancel?.()}>
                {t('Salir y descartar')}
              </button>
            </div>
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
            <p className="text-xs text-neutral-500">{t('Solo queda elegir un modelo de IA (opcional) para empezar.')}</p>
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
            {/* Billing notice — shown for every vault mode. */}
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-200">
              {t('El uso de IA se factura según tu proveedor (OpenAI, Anthropic, Google, OpenRouter…), no por Nodus. Revisa el precio por token y, si quieres evitar sorpresas, establece un límite de gasto (spend limit) desde el panel del proveedor antes de empezar.')}
            </div>
            {configuredProviders.length > 0 && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300">
                {tx('Ya tienes claves configuradas ({list}). Las claves se comparten entre todas tus bóvedas, así que puedes continuar sin volver a introducirlas.', {
                  list: configuredProviders.map((p) => PROVIDER_LABELS[p]).join(', '),
                })}
              </div>
            )}
            <label className="block text-sm">
              {t('Proveedor')}
              <select
                className="input w-full mt-1"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as AiProvider);
                  setModels([]);
                  setSelectedModel('');
                }}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            {provider === 'ollama' || provider === 'lmstudio' ? (
              <p className="text-sm text-neutral-500">
                {t('Proveedor local: no necesita clave. Usa la dirección por defecto; puedes cambiar IP y puerto en Ajustes → Proveedores.')}
              </p>
            ) : (
              <label className="block text-sm">
                {t('Clave de IA (se guarda cifrada, nunca se exporta)')}
                {provider === 'openrouter' && (
                  <span className="text-neutral-500"> {t('— opcional para listar, necesaria para escanear')}</span>
                )}
                <input
                  type="password"
                  className="input w-full mt-1"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
            )}
            <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loadingModels}>
              {loadingModels ? t('Cargando modelos…') : t('Cargar modelos')}
            </button>
            {modelError && <div className="text-sm text-red-400">{modelError}</div>}
            {models.length > 0 && (
              <label className="block text-sm">
                {tx('Modelo inicial para las tareas de IA ({n} disponibles)', { n: models.length })}
                <select className="input w-full mt-1" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.group ? `[${m.group}] ` : ''}
                      {m.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-neutral-500">
              {t('Podrás añadir más proveedores y marcar favoritos en Ajustes.')}
            </p>
            {!selectedModel && (
              <p className="text-xs text-amber-400">
                {t('⚠ Sin un modelo seleccionado podrás sincronizar metadatos, pero no analizar temas ni ideas hasta configurarlo.')}
              </p>
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
            {!selectedModel && (
              <p className="text-xs text-amber-400">
                {t('Falta configurar un modelo para analizar temas e ideas. Puedes hacerlo desde Ajustes.')}
              </p>
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
            <button className="btn btn-primary" onClick={finish} disabled={finishing}>
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
                <button className="btn btn-ghost border border-neutral-700" onClick={() => onDone(selectedModel ? 'library' : 'settings')} disabled={finishing}>
                  {selectedModel ? t('Ir a Biblioteca') : t('Configurar IA')}
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
