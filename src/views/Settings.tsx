import { useEffect, useState } from 'react';
import type { AppSettings, EmbeddingProvider, ModelInfo, UpdateProgressEvent } from '@shared/types';
import { ProvidersSettings } from './ProvidersSettings';
import { Icon, PROVIDER_LABELS } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';

const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'gemini', 'openrouter'];

const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'baai/bge-m3',
};

export function Settings({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<unknown> }) {
  const [saved, setSaved] = useState<string | null>(null);
  // Reset-graph flow: a confirm() dialog, then a modal that requires typing a
  // freshly generated 4-digit code so it can't be triggered by accident.
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);

  useEffect(() => {
    return window.nodus.onUpdateProgress((event) => {
      setUpdateProgress(event);
      setUpdateMessage(event.message);
      setCheckingUpdate(event.status === 'checking');
    });
  }, []);

  const patch = async (p: Partial<AppSettings>) => {
    await window.nodus.updateSettings(p);
    await onChange();
  };

  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(null), 2000);
  };

  const activeChunkWords =
    settings.deepContextMode === 'long' ? settings.deepLongChunkWords : settings.deepStandardChunkWords;
  const patchActiveChunkWords = (value: string) => {
    const min = settings.deepContextMode === 'long' ? 5000 : 500;
    const max = settings.deepContextMode === 'long' ? 50000 : 5000;
    const parsed = Math.min(max, Math.max(min, parseInt(value, 10) || min));
    void patch(
      settings.deepContextMode === 'long'
        ? { deepLongChunkWords: parsed }
        : { deepStandardChunkWords: parsed }
    );
  };

  const startReset = () => {
    const ok = window.confirm(
      'Reinicializar el grafo borrará TODAS las ideas, temas, conexiones, autores y huecos, y dejará cada obra sin analizar. Tu biblioteca de Zotero y tus ajustes se conservan. Esta acción no se puede deshacer.\n\n¿Continuar?'
    );
    if (!ok) return;
    setResetInput('');
    setResetCode(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const confirmReset = async () => {
    if (resetInput !== resetCode) return;
    setResetting(true);
    try {
      await window.nodus.resetGraph();
      setResetCode(null);
      setResetInput('');
      flash('Grafo reinicializado. Vuelve a analizar tus obras para reconstruirlo.');
    } finally {
      setResetting(false);
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateMessage(null);
    try {
      const result = await window.nodus.checkForUpdates();
      setUpdateProgress({ ...result, at: new Date().toISOString() });
      setUpdateMessage(result.message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    const result = await window.nodus.installUpdate();
    setUpdateProgress({ ...result, at: new Date().toISOString() });
    setUpdateMessage(result.message);
  };

  const updatePct =
    updateProgress?.progress != null ? Math.max(0, Math.min(100, updateProgress.progress)) : null;
  const updateBusy = updateProgress?.status === 'downloading' || updateProgress?.status === 'installing';
  const updateDownloaded = updateProgress?.status === 'downloaded';

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-6">Ajustes</h1>

      <ProvidersSettings settings={settings} onChange={onChange} />

      <Section title="IA (avanzado)">
        <Row label="Modelo de extracción (extrae temas, ideas, evidencias y huecos)">
          <ModelPicker settings={settings} value={settings.extractionModel} onChange={(m) => patch({ extractionModel: m })} />
        </Row>
        <Row label="Modelo de síntesis/tutor (asistente de investigación y narrativa del tutor)">
          <ModelPicker settings={settings} value={settings.synthesisModel} onChange={(m) => patch({ synthesisModel: m })} />
        </Row>
        <Row label="Modelo de fusión (deduplica y relaciona ideas; muchas llamadas pequeñas, conviene uno rápido)">
          <ModelPicker settings={settings} value={settings.fusionModel} onChange={(m) => patch({ fusionModel: m })} />
        </Row>
        <Row label="Modelo de embeddings (similitud semántica multilingüe)">
          <EmbeddingModelControl settings={settings} onPatch={patch} />
        </Row>
        <Row label="Reindexar embeddings">
          <button
            className="btn btn-ghost border border-cyan-800 text-cyan-300"
            title="Genera embeddings para todas las ideas que aún no los tienen. Útil tras cambiar de modelo de embeddings."
            onClick={() => {
              void window.nodus.startEmbedding();
            }}
          >
            <Icon name="search" /> Reindexar todo
          </button>
        </Row>
        <Row label="Llamadas simultáneas">
          <input
            type="number"
            min={1}
            max={5}
            className="input w-20"
            value={settings.concurrency}
            onChange={(e) => patch({ concurrency: parseInt(e.target.value) || 1 })}
          />
        </Row>
        <Row label="Email Unpaywall (fallback de texto)">
          <input className="input" value={settings.unpaywallEmail} onChange={(e) => patch({ unpaywallEmail: e.target.value })} />
        </Row>
        <Row label="Modo de contexto deep scan">
          <select
            className="input"
            value={settings.deepContextMode}
            onChange={(e) => patch({ deepContextMode: e.target.value as AppSettings['deepContextMode'] })}
          >
            <option value="standard">Estándar</option>
            <option value="long">Contexto largo</option>
          </select>
        </Row>
        <Row label="Palabras por fragmento">
          <input
            type="number"
            min={settings.deepContextMode === 'long' ? 5000 : 500}
            max={settings.deepContextMode === 'long' ? 50000 : 5000}
            step={settings.deepContextMode === 'long' ? 1000 : 100}
            className="input w-28"
            value={activeChunkWords}
            onChange={(e) => patchActiveChunkWords(e.target.value)}
          />
        </Row>
      </Section>

      <Section title="Zotero y sincronización">
        <Row label="Modo de sincronización">
          <select className="input" value={settings.syncMode} onChange={(e) => patch({ syncMode: e.target.value as any })}>
            <option value="manual">Manual</option>
            <option value="realtime">Tiempo real</option>
          </select>
        </Row>
        <Row label="Tag de lectura">
          <input className="input" value={settings.readTag} onChange={(e) => patch({ readTag: e.target.value })} />
        </Row>
        <Row label="Ruta de storage de Zotero">
          <input
            className="input w-full"
            value={settings.zoteroStoragePath}
            onChange={(e) => patch({ zoteroStoragePath: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="Automatización de análisis">
        <Row label="Analizar temas al sincronizar">
          <input type="checkbox" checked={settings.autoLightScan} onChange={(e) => patch({ autoLightScan: e.target.checked })} />
        </Row>
        <Row label="Analizar a fondo obras con tag">
          <input
            type="checkbox"
            checked={settings.autoDeepScanOnReadTag}
            onChange={(e) => patch({ autoDeepScanOnReadTag: e.target.checked })}
          />
        </Row>
        <Row label="Reanudar cola al abrir">
          <input type="checkbox" checked={settings.autoResumeQueue} onChange={(e) => patch({ autoResumeQueue: e.target.checked })} />
        </Row>
        <p className="text-xs text-neutral-500">
          Apagado por defecto: sincronizar solo incorpora metadatos. Los análisis manuales desde Biblioteca o Colecciones se ejecutan siempre.
        </p>
      </Section>

      <Section title="Extracción de texto (PDFs grandes)">
        <Row label="Reusar texto indexado por Zotero">
          <input
            type="checkbox"
            checked={settings.preferZoteroFulltext}
            onChange={(e) => patch({ preferZoteroFulltext: e.target.checked })}
          />
        </Row>
        <Row label="OCR para PDFs escaneados">
          <input type="checkbox" checked={settings.ocrEnabled} onChange={(e) => patch({ ocrEnabled: e.target.checked })} />
        </Row>
        <Row label="Idiomas de OCR (Tesseract)">
          <input
            className="input"
            value={settings.ocrLanguages}
            onChange={(e) => patch({ ocrLanguages: e.target.value })}
            placeholder="spa+eng"
          />
        </Row>
        <Row label="Máx. páginas a OCR por obra">
          <input
            type="number"
            min={1}
            max={2000}
            className="input w-24"
            value={settings.ocrMaxPages}
            onChange={(e) => patch({ ocrMaxPages: parseInt(e.target.value) || 1 })}
          />
        </Row>
        <p className="text-xs text-neutral-500">
          El OCR es local pero descarga los datos de idioma de Tesseract la primera vez. Desactivado por defecto.
        </p>
      </Section>

      <Section title="Apariencia">
        <Row label="Tema">
          <select className="input" value={settings.theme} onChange={(e) => patch({ theme: e.target.value as any })}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </Row>
        <Row label="Velocidad de animaciones">
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.animationSpeed}
            onChange={(e) => patch({ animationSpeed: parseFloat(e.target.value) })}
          />
        </Row>
      </Section>

      <Section title="Ayuda">
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm text-neutral-300">Tutorial de uso</label>
          <button
            className="btn btn-ghost border border-neutral-700"
            onClick={() => patch({ tourComplete: false }).then(() => flash('Se mostrará el tutorial.'))}
          >
            <Icon name="help" /> Ver de nuevo
          </button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="text-sm text-neutral-300">Actualizaciones</label>
            {updateMessage && <p className="text-xs text-neutral-500 mt-0.5">{updateMessage}</p>}
            {(updatePct != null || updateBusy) && (
              <div className="mt-2 w-72 max-w-full">
                <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${updatePct ?? 100}%` }}
                  />
                </div>
                {updateProgress?.bytesPerSecond != null && updateProgress.status === 'downloading' && (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {Math.round(updateProgress.bytesPerSecond / 1024)} KiB/s
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {updateDownloaded && (
              <button className="btn btn-primary" onClick={installUpdate}>
                <Icon name="refresh" /> Reiniciar
              </button>
            )}
            <button className="btn btn-ghost border border-neutral-700" onClick={checkForUpdates} disabled={checkingUpdate || updateBusy}>
              <Icon name="sync" className={checkingUpdate || updateBusy ? 'animate-spin' : ''} />
              {checkingUpdate ? 'Buscando…' : updateBusy ? 'Actualizando…' : 'Buscar actualización'}
            </button>
          </div>
        </div>
      </Section>

      <Section title="Datos">
        <div className="flex gap-2">
          <button className="btn btn-ghost border border-neutral-700" onClick={() => window.nodus.exportData().then((r) => r && flash(`Exportado: ${r.path}`))}>
            <Icon name="download" /> Exportar (.nodus)
          </button>
          <button
            className="btn btn-ghost border border-neutral-700"
            onClick={() => window.nodus.importData().then((r) => flash(r.message))}
          >
            <Icon name="upload" /> Importar (.nodus)
          </button>
        </div>
      </Section>

      <section className="card p-4 mb-4 border border-red-900/60">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-3">Zona de peligro</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <label className="text-sm text-neutral-300">Reinicializar grafo</label>
            <p className="text-xs text-neutral-500 mt-0.5">
              Borra todas las ideas, temas, conexiones, autores y huecos, y deja cada obra sin analizar. La
              biblioteca y los ajustes se conservan.
            </p>
          </div>
          <button className="btn border border-red-800 text-red-300 hover:bg-red-950/50 shrink-0" onClick={startReset}>
            <Icon name="trash" /> Reinicializar…
          </button>
        </div>
      </section>

      {resetCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => !resetting && setResetCode(null)}>
          <div className="card p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-400">Confirmación final</h3>
            <p className="text-sm text-neutral-300">
              Esto borrará todo el grafo de forma permanente. Para confirmar, escribe este código:
            </p>
            <div className="text-center text-3xl font-mono tracking-[0.5em] text-neutral-100 bg-neutral-950 rounded-lg py-3 select-none">
              {resetCode}
            </div>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={4}
              className="input w-full text-center text-xl tracking-[0.4em] font-mono"
              placeholder="····"
              value={resetInput}
              onChange={(e) => setResetInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resetInput === resetCode) void confirmReset();
              }}
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" disabled={resetting} onClick={() => setResetCode(null)}>
                Cancelar
              </button>
              <button
                className="btn border border-red-800 text-red-300 hover:bg-red-950/50 disabled:opacity-40"
                disabled={resetInput !== resetCode || resetting}
                onClick={() => void confirmReset()}
              >
                {resetting ? 'Borrando…' : 'Borrar grafo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {saved && <div className="fixed bottom-20 right-6 card px-4 py-2 text-sm text-emerald-400">{saved}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-neutral-300">{label}</label>
      <div>{children}</div>
    </div>
  );
}

function EmbeddingModelControl({
  settings,
  onPatch,
}: {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = settings.embeddingProvider ?? 'openai';

  const setProvider = (next: EmbeddingProvider) => {
    setModels(null);
    setError(null);
    void onPatch({ embeddingProvider: next, embeddingModel: DEFAULT_EMBEDDING_MODEL[next] });
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await window.nodus.listEmbeddingModels(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = (models ?? []).slice(0, 300);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}>
          {EMBEDDING_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        <input
          className="input w-64"
          value={settings.embeddingModel}
          onChange={(e) => onPatch({ embeddingModel: e.target.value })}
          placeholder={DEFAULT_EMBEDDING_MODEL[provider]}
        />
        <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loading}>
          {loading ? 'Cargando…' : 'Cargar modelos'}
        </button>
      </div>
      {models && (
        <select
          className="input w-full max-w-md"
          value={settings.embeddingModel}
          onChange={(e) => onPatch({ embeddingModel: e.target.value })}
        >
          {!shown.some((m) => m.id === settings.embeddingModel) && (
            <option value={settings.embeddingModel}>{settings.embeddingModel}</option>
          )}
          {shown.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ? `${m.name} · ${m.id}` : m.id}
            </option>
          ))}
        </select>
      )}
      {error && <div className="text-xs text-red-400 max-w-md text-right">{error}</div>}
      <p className="text-xs text-neutral-500 max-w-md text-right">
        OpenRouter acepta IDs como baai/bge-m3; si escribes BAAI:bge-m3 se normaliza automáticamente.
      </p>
    </div>
  );
}
