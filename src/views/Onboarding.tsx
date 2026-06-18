import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AiProvider, ZoteroCollection, ModelInfo } from '@shared/types';
import { AI_PROVIDERS, PROVIDER_LABELS, Spinner } from '../components/ui';

type OnboardingExit = 'home' | 'library' | 'settings';

export function Onboarding({ onDone }: { onDone: (view?: OnboardingExit) => void }) {
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
        monitoredCollections: Array.from(selected),
        readTag,
        defaultModel: ref,
        favorites: ref ? [ref] : [],
        zoteroStoragePath: storagePath,
        onboardingComplete: true,
      });
      setStep(4);
      // With automatic analysis disabled by default, the first sync only ingests Zotero metadata.
      const sync = await window.nodus.syncNow();
      const works = await window.nodus.listWorks();
      setSyncSummary(sync.summary);
      setSyncedWorks(works.length);
    } catch (e) {
      setStep(4);
      setFinishError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinishing(false);
    }
  };

  const steps = ['Conectar Zotero', 'Colecciones', 'Lecturas', 'Proveedor de IA', 'Primer resultado'];

  return (
    <div className="h-full flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card w-full max-w-2xl p-8"
      >
        <div className="text-2xl font-semibold mb-1">Bienvenido a Nodus</div>
        <p className="text-neutral-400 text-sm mb-6">
          Teje tu biblioteca de Zotero en un grafo navegable de ideas y autores. Todo es local.
        </p>

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

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm">
              Nodus usa la API local de Zotero 7 (solo lectura). Abre Zotero y verifica la conexión.
            </p>
            <button className="btn btn-primary" onClick={checkZotero}>
              Verificar conexión
            </button>
            {ping && (
              <div className={`text-sm ${ping.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {ping.ok ? `Conectado (userID ${ping.userId})` : `No disponible: ${ping.message ?? 'sin respuesta'}`}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">
              Elige las colecciones a monitorizar. Se incorporan metadatos; los análisis se lanzan manualmente salvo que actives automatización en Ajustes.
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {collections.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={selected.has(c.key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.key);
                      else next.delete(c.key);
                      setSelected(next);
                    }}
                  />
                  {c.name}{' '}
                  <span className="text-neutral-600">
                    ({c.itemCount} ítems{c.subCount ? `, ${c.subCount} subcol.` : ''})
                  </span>
                </label>
              ))}
              {collections.length === 0 && <div className="text-neutral-500 text-sm">No hay colecciones cargadas.</div>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="block text-sm">
              Tag de lectura
              <input className="input w-full mt-1" value={readTag} onChange={(e) => setReadTag(e.target.value)} />
            </label>
            <label className="block text-sm">
              Ruta de la carpeta <code>storage</code> de Zotero (opcional, para localizar PDFs)
              <input
                className="input w-full mt-1"
                value={storagePath}
                placeholder="/Users/tu/Zotero/storage"
                onChange={(e) => setStoragePath(e.target.value)}
              />
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <label className="block text-sm">
              Proveedor
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
            <label className="block text-sm">
              Clave de IA (se guarda cifrada, nunca se exporta)
              {provider === 'openrouter' && (
                <span className="text-neutral-500"> — opcional para listar, necesaria para escanear</span>
              )}
              <input
                type="password"
                className="input w-full mt-1"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loadingModels}>
              {loadingModels ? 'Cargando modelos…' : 'Cargar modelos'}
            </button>
            {modelError && <div className="text-sm text-red-400">{modelError}</div>}
            {models.length > 0 && (
              <label className="block text-sm">
                Modelo predeterminado ({models.length} disponibles)
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
              Podrás añadir más proveedores y marcar favoritos en Ajustes.
            </p>
            {!selectedModel && (
              <p className="text-xs text-amber-400">
                ⚠ Sin un modelo seleccionado podrás sincronizar metadatos, pero no analizar temas ni ideas hasta configurarlo.
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold">Primer resultado</div>
              <p className="text-sm text-neutral-400 mt-1">
                {finishing
                  ? 'Sincronizando Zotero para preparar el panel inicial...'
                  : finishError
                    ? 'No se pudo completar la primera sincronización, pero puedes entrar y corregirlo desde Inicio o Ajustes.'
                    : 'La biblioteca local ya está preparada. El panel de Inicio te dirá qué conviene hacer después.'}
              </p>
            </div>
            {finishing && <Spinner label="Sincronizando metadatos..." />}
            {finishError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {finishError}
              </div>
            )}
            {!finishing && !finishError && (
              <div className="grid grid-cols-2 gap-3">
                <ResultMetric label="Obras locales" value={syncedWorks ?? 0} />
                <ResultMetric label="Colecciones" value={selected.size} />
              </div>
            )}
            {syncSummary && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-300">
                {syncSummary}
              </div>
            )}
            {!selectedModel && (
              <p className="text-xs text-amber-400">
                Falta configurar un modelo para analizar temas e ideas. Puedes hacerlo desde Ajustes.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-between mt-8">
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || finishing}>
            Atrás
          </button>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              Siguiente
            </button>
          ) : step === 3 ? (
            <button className="btn btn-primary" onClick={finish} disabled={finishing}>
              {finishing ? 'Preparando...' : 'Empezar'}
            </button>
          ) : (
            <div className="flex gap-2">
              {finishError && (
                <button className="btn btn-ghost border border-neutral-700" onClick={finish} disabled={finishing}>
                  Reintentar
                </button>
              )}
              <button className="btn btn-ghost border border-neutral-700" onClick={() => onDone(selectedModel ? 'library' : 'settings')} disabled={finishing}>
                {selectedModel ? 'Ir a Biblioteca' : 'Configurar IA'}
              </button>
              <button className="btn btn-primary" onClick={() => onDone('home')} disabled={finishing}>
                Abrir Inicio
              </button>
            </div>
          )}
        </div>
      </motion.div>
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
