import { useEffect, useState } from 'react';
import type { AppSettings, EmbeddingProvider, McpServerStatus, ModelInfo, UpdateProgressEvent } from '@shared/types';
import { ProvidersSettings } from './ProvidersSettings';
import { ConfirmModal } from '../components/ConfirmModal';
import { Icon, PROVIDER_LABELS } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { t } from '../i18n';

const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'gemini', 'openrouter'];

const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'baai/bge-m3',
};

export function Settings({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<unknown> }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'basic' | 'advanced'>('basic');
  // Reset-graph flow: a confirm() dialog, then a modal that requires typing a
  // freshly generated 4-digit code so it can't be triggered by accident.
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const [confirmReindex, setConfirmReindex] = useState(false);
  const [backupResult, setBackupResult] = useState<{ path: string; password: string } | null>(null);
  const [backupCopied, setBackupCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importingBackup, setImportingBackup] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, port: null, url: null, error: null });
  const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcpPort));
  const [mcpHelpOpen, setMcpHelpOpen] = useState(false);
  const [mcpCopied, setMcpCopied] = useState<'url' | 'token' | null>(null);

  useEffect(() => {
    return window.nodus.onUpdateProgress((event) => {
      setUpdateProgress(event);
      setUpdateMessage(event.message);
      setCheckingUpdate(event.status === 'checking');
    });
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getMcpStatus();
      if (active) setMcpStatus(next);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [settings.mcpEnabled, settings.mcpPort, settings.mcpToken]);

  useEffect(() => setMcpPortInput(String(settings.mcpPort)), [settings.mcpPort]);

  useEffect(() => {
    if (!mcpHelpOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMcpHelpOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mcpHelpOpen]);

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
      t('Reinicializar el grafo borrará TODAS las ideas, temas, conexiones, autores y huecos, y dejará cada obra sin analizar. Tu biblioteca de Zotero y tus ajustes se conservan. Esta acción no se puede deshacer.\n\n¿Continuar?')
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
      flash(t('Grafo reinicializado. Vuelve a analizar tus obras para reconstruirlo.'));
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

  const exportBackup = async () => {
    const result = await window.nodus.exportData();
    if (!result) return;
    setBackupCopied(false);
    setBackupResult(result);
    flash(`${t('Exportado')}: ${result.path}`);
  };

  const copyBackupPassword = async () => {
    if (!backupResult) return;
    await navigator.clipboard.writeText(backupResult.password);
    setBackupCopied(true);
  };

  const commitMcpPort = () => {
    const parsed = Math.min(65535, Math.max(1024, parseInt(mcpPortInput, 10) || 4319));
    setMcpPortInput(String(parsed));
    if (parsed !== settings.mcpPort) void patch({ mcpPort: parsed });
  };

  const regenerateMcpToken = async () => {
    await window.nodus.regenerateMcpToken();
    await onChange();
    setMcpStatus(await window.nodus.getMcpStatus());
    flash(t('Token MCP regenerado. Reconecta los clientes con el nuevo token.'));
  };

  const copyMcpValue = async (kind: 'url' | 'token', value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setMcpCopied(kind);
    setTimeout(() => setMcpCopied(null), 1500);
  };

  const importBackup = async () => {
    if (!importPassword.trim()) {
      flash(t('Introduce la contraseña de la copia.'));
      return;
    }
    setImportingBackup(true);
    try {
      const result = await window.nodus.importData(importPassword);
      flash(result.message);
      if (result.ok) {
        setImportOpen(false);
        setImportPassword('');
        await onChange();
      }
    } finally {
      setImportingBackup(false);
    }
  };

  const updatePct =
    updateProgress?.progress != null ? Math.max(0, Math.min(100, updateProgress.progress)) : null;
  const updateBusy = updateProgress?.status === 'downloading' || updateProgress?.status === 'installing';
  const updateDownloaded = updateProgress?.status === 'downloaded';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t('Ajustes')}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {t('Lo básico queda separado de los parámetros técnicos de análisis y extracción.')}
          </p>
        </div>
        <div className="flex-1" />
        <div className="inline-grid grid-cols-2 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          <SettingsTabButton active={settingsTab === 'basic'} onClick={() => setSettingsTab('basic')}>
            {t('Básico')}
          </SettingsTabButton>
          <SettingsTabButton active={settingsTab === 'advanced'} onClick={() => setSettingsTab('advanced')}>
            {t('Avanzado')}
          </SettingsTabButton>
        </div>
      </div>

      {settingsTab === 'basic' ? (
        <>
          <ProvidersSettings settings={settings} onChange={onChange} />

          <Section title={t('Zotero y sincronización')}>
            <Row label={t('Modo de sincronización')}>
              <select className="input" value={settings.syncMode} onChange={(e) => patch({ syncMode: e.target.value as any })}>
                <option value="manual">{t('Manual')}</option>
                <option value="realtime">{t('Tiempo real')}</option>
              </select>
            </Row>
            <Row label={t('Tag de lectura')}>
              <input className="input" value={settings.readTag} onChange={(e) => patch({ readTag: e.target.value })} />
            </Row>
            <Row label={t('Ruta de storage de Zotero')}>
              <input
                className="input w-full"
                value={settings.zoteroStoragePath}
                onChange={(e) => patch({ zoteroStoragePath: e.target.value })}
              />
            </Row>
          </Section>

          <Section title={t('Automatización de análisis')}>
            <Row label={t('Analizar temas al sincronizar')}>
              <input type="checkbox" checked={settings.autoLightScan} onChange={(e) => patch({ autoLightScan: e.target.checked })} />
            </Row>
            <Row label={t('Analizar a fondo obras con tag')}>
              <input
                type="checkbox"
                checked={settings.autoDeepScanOnReadTag}
                onChange={(e) => patch({ autoDeepScanOnReadTag: e.target.checked })}
              />
            </Row>
            <Row label={t('Resumir tras análisis profundo')}>
              <input
                type="checkbox"
                checked={settings.autoSummaryAfterDeep}
                onChange={(e) => patch({ autoSummaryAfterDeep: e.target.checked })}
              />
            </Row>
            <Row label={t('Descubrir relaciones al vaciar la cola')}>
              <input
                type="checkbox"
                checked={settings.autoBridgeAfterQueue}
                onChange={(e) => patch({ autoBridgeAfterQueue: e.target.checked })}
              />
            </Row>
            <Row label={t('Reanudar cola al abrir')}>
              <input type="checkbox" checked={settings.autoResumeQueue} onChange={(e) => patch({ autoResumeQueue: e.target.checked })} />
            </Row>
            <p className="text-xs text-neutral-500">
              {t('Apagado por defecto: sincronizar solo incorpora metadatos. Los análisis manuales desde Biblioteca o Colecciones se ejecutan siempre.')}
            </p>
          </Section>

          <Section title={t('Idioma')}>
            <Row label={t('Idioma de la interfaz')}>
              <select
                className="input"
                value={settings.uiLanguage}
                onChange={(e) => patch({ uiLanguage: e.target.value as AppSettings['uiLanguage'] })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </Row>
            <Row label={t('Idioma de los prompts (idioma de las ideas generadas)')}>
              <select
                className="input"
                value={settings.promptLanguage}
                onChange={(e) => patch({ promptLanguage: e.target.value as AppSettings['promptLanguage'] })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </Row>
            <p className="text-xs text-neutral-500">
              {t('El idioma de los prompts determina en qué idioma la IA genera ideas, temas, narrativa del tutor y borradores. Las citas textuales siempre conservan el idioma original de la fuente.')}
            </p>
          </Section>

          <Section title={t('Apariencia')}>
            <Row label={t('Tema')}>
              <select className="input" value={settings.theme} onChange={(e) => patch({ theme: e.target.value as any })}>
                <option value="dark">{t('Oscuro')}</option>
                <option value="light">{t('Claro')}</option>
              </select>
            </Row>
            <Row label={t('Velocidad de animaciones')}>
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

          <Section title={t('Ayuda')}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Tutorial de uso')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('Lo básico: sincronizar, escanear y moverte por el grafo.')}</p>
              </div>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => patch({ tourComplete: false }).then(() => flash(t('Se mostrará el tutorial.')))}
              >
                <Icon name="help" /> {t('Ver de nuevo')}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Tutorial avanzado de investigación')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('El flujo completo: leer con criterio, comprender el corpus, encontrar tu aportación y escribir.')}</p>
              </div>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => patch({ advancedTourComplete: false }).then(() => flash(t('Se mostrará el tutorial avanzado.')))}
              >
                <Icon name="route" /> {t('Empezar')}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Actualizaciones')}</label>
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
                    <Icon name="refresh" /> {t('Reiniciar')}
                  </button>
                )}
                <button className="btn btn-ghost border border-neutral-700" onClick={checkForUpdates} disabled={checkingUpdate || updateBusy}>
                  <Icon name="sync" className={checkingUpdate || updateBusy ? 'animate-spin' : ''} />
                  {checkingUpdate ? t('Buscando…') : updateBusy ? t('Actualizando…') : t('Buscar actualización')}
                </button>
              </div>
            </div>
          </Section>

          <Section title={t('Servidor MCP')}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-neutral-300">{t('Activar servidor MCP')}</label>
                <button
                  type="button"
                  className="text-neutral-500 hover:text-neutral-200"
                  aria-label={t('Ayuda para conectar un cliente MCP')}
                  title={t('Ayuda para conectar un cliente MCP')}
                  onClick={() => setMcpHelpOpen(true)}
                >
                  <Icon name="help" size={15} />
                </button>
              </div>
              <input type="checkbox" checked={settings.mcpEnabled} onChange={(e) => void patch({ mcpEnabled: e.target.checked })} />
            </div>
            <Row label={t('Puerto local')}>
              <input
                className="input w-24"
                type="number"
                min={1024}
                max={65535}
                value={mcpPortInput}
                onChange={(e) => setMcpPortInput(e.target.value)}
                onBlur={commitMcpPort}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </Row>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs">
              {mcpStatus.running ? (
                <span className="text-emerald-400">{t('Activo')}: {mcpStatus.url}</span>
              ) : mcpStatus.error ? (
                <span className="text-red-400">{t('Error del servidor MCP')}: {mcpStatus.error}</span>
              ) : (
                <span className="text-neutral-500">{t('Apagado')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void setMcpHelpOpen(true)}>
                <Icon name="link" /> {t('Ver datos de conexión')}
              </button>
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void regenerateMcpToken()}>
                <Icon name="refresh" /> {t('Regenerar token')}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {t('Solo escucha en este ordenador. Las herramientas de escritura están activas mientras el servidor esté encendido.')}
            </p>
          </Section>

          <Section title={t('Datos')}>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost border border-neutral-700" onClick={exportBackup}>
                <Icon name="download" /> {t('Exportar (.nodus)')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700"
                onClick={() => {
                  setImportPassword('');
                  setImportOpen(true);
                }}
              >
                <Icon name="upload" /> {t('Importar (.nodus)')}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {t('La copia incluye todos los datos de Nodus: textos extraídos, embeddings de ideas, resúmenes y pasajes, modelos seleccionados, grafo, ajustes y claves API, dentro de un archivo cifrado.')}
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section title={t('IA avanzada')}>
            <Row label={t('Modelo de extracción (extrae temas, ideas, evidencias y huecos)')}>
              <ModelPicker settings={settings} value={settings.extractionModel} onChange={(m) => patch({ extractionModel: m })} />
            </Row>
            <Row label={t('Modelo de síntesis/tutor (asistente de investigación y narrativa del tutor)')}>
              <ModelPicker settings={settings} value={settings.synthesisModel} onChange={(m) => patch({ synthesisModel: m })} />
            </Row>
            <Row label={t('Modelo de resúmenes (orientación por obra; no genera evidencia citable)')}>
              <ModelPicker settings={settings} value={settings.summaryModel} onChange={(m) => patch({ summaryModel: m })} />
            </Row>
            <Row label={t('Modelo de fusión (deduplica y relaciona ideas; muchas llamadas pequeñas, conviene uno rápido)')}>
              <ModelPicker settings={settings} value={settings.fusionModel} onChange={(m) => patch({ fusionModel: m })} />
            </Row>
            <Row label={t('Modelo de embeddings (similitud semántica multilingüe)')}>
              <EmbeddingModelControl settings={settings} onPatch={patch} />
            </Row>
            <Row label={t('Indexación de embeddings')}>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost border border-cyan-800 text-cyan-300"
                  title={t('Genera embeddings solo para ideas que aún no los tienen.')}
                  onClick={() => {
                    void window.nodus.startEmbedding();
                  }}
                >
                  <Icon name="search" /> {t('Indexar pendientes')}
                </button>
                <button
                  className="btn btn-ghost border border-cyan-800 text-cyan-300"
                  title={t('Borra todos los embeddings y los regenera desde cero. Útil tras cambiar de modelo.')}
                  onClick={() => setConfirmReindex(true)}
                >
                  <Icon name="search" /> {t('Reindexar todo')}
                </button>
              </div>
            </Row>
            <Row label={t('Llamadas simultáneas')}>
              <input
                type="number"
                min={1}
                max={5}
                className="input w-20"
                value={settings.concurrency}
                onChange={(e) => patch({ concurrency: parseInt(e.target.value) || 1 })}
              />
            </Row>
            <Row label={t('Email Unpaywall (fallback de texto)')}>
              <input className="input" value={settings.unpaywallEmail} onChange={(e) => patch({ unpaywallEmail: e.target.value })} />
            </Row>
            <Row label={t('Modo de contexto deep scan')}>
              <select
                className="input"
                value={settings.deepContextMode}
                onChange={(e) => patch({ deepContextMode: e.target.value as AppSettings['deepContextMode'] })}
              >
                <option value="standard">{t('Estándar')}</option>
                <option value="long">{t('Contexto largo')}</option>
              </select>
            </Row>
            <Row label={t('Palabras por fragmento')}>
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

          <Section title={t('Extracción de texto (PDFs grandes)')}>
            <Row label={t('Reusar texto indexado por Zotero')}>
              <input
                type="checkbox"
                checked={settings.preferZoteroFulltext}
                onChange={(e) => patch({ preferZoteroFulltext: e.target.checked })}
              />
            </Row>
            <Row label={t('OCR para PDFs escaneados')}>
              <input type="checkbox" checked={settings.ocrEnabled} onChange={(e) => patch({ ocrEnabled: e.target.checked })} />
            </Row>
            <Row label={t('Idiomas de OCR (Tesseract)')}>
              <input
                className="input"
                value={settings.ocrLanguages}
                onChange={(e) => patch({ ocrLanguages: e.target.value })}
                placeholder="spa+eng"
              />
            </Row>
            <Row label={t('Máx. páginas a OCR por obra')}>
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
              {t('El OCR es local pero descarga los datos de idioma de Tesseract la primera vez. Desactivado por defecto.')}
            </p>
          </Section>

          <section className="card p-4 mb-4 border border-red-900/60">
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-3">{t('Zona de peligro')}</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Reinicializar grafo')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {t('Borra todas las ideas, temas, conexiones, autores y huecos, y deja cada obra sin analizar. La biblioteca y los ajustes se conservan.')}
                </p>
              </div>
              <button className="btn border border-red-800 text-red-300 hover:bg-red-950/50 shrink-0" onClick={startReset}>
                <Icon name="trash" /> {t('Reinicializar…')}
              </button>
            </div>
          </section>
        </>
      )}

      {resetCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => !resetting && setResetCode(null)}>
          <div className="card p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-400">{t('Confirmación final')}</h3>
            <p className="text-sm text-neutral-300">
              {t('Esto borrará todo el grafo de forma permanente. Para confirmar, escribe este código:')}
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
                {t('Cancelar')}
              </button>
              <button
                className="btn border border-red-800 text-red-300 hover:bg-red-950/50 disabled:opacity-40"
                disabled={resetInput !== resetCode || resetting}
                onClick={() => void confirmReset()}
              >
                {resetting ? t('Borrando…') : t('Borrar grafo')}
              </button>
            </div>
          </div>
        </div>
      )}

      {saved && <div className="fixed bottom-20 right-6 card px-4 py-2 text-sm text-emerald-400">{saved}</div>}
      {mcpHelpOpen && (
        <McpConnectionModal
          url={mcpStatus.url ?? `http://127.0.0.1:${settings.mcpPort}/mcp`}
          token={settings.mcpToken}
          copied={mcpCopied}
          onCopy={copyMcpValue}
          onClose={() => setMcpHelpOpen(false)}
        />
      )}
      {backupResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-6" onClick={() => setBackupResult(null)}>
          <div className="card w-full max-w-lg p-5" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">{t('Contraseña de la copia')}</h2>
            <p className="text-sm text-neutral-400 mb-4">
              {t('Guarda esta contraseña. Nodus no puede recuperarla y será necesaria para importar la copia en otro ordenador.')}
            </p>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-sm break-all">
              {backupResult.password}
            </div>
            <div className="mt-2 text-xs text-neutral-500 truncate">{backupResult.path}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setBackupResult(null)}>
                {t('Cerrar')}
              </button>
              <button className="btn btn-primary" onClick={() => void copyBackupPassword()}>
                <Icon name={backupCopied ? 'check' : 'copy'} /> {backupCopied ? t('Copiada') : t('Copiar contraseña')}
              </button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-6" onClick={() => setImportOpen(false)}>
          <div className="card w-full max-w-md p-5" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">{t('Importar copia cifrada')}</h2>
            <p className="text-sm text-neutral-400 mb-4">
              {t('Introduce la contraseña generada al exportar. Después selecciona el archivo .nodus.')}
            </p>
            <input
              className="input w-full"
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void importBackup();
              }}
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)} disabled={importingBackup}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary" onClick={() => void importBackup()} disabled={importingBackup}>
                <Icon name={importingBackup ? 'sync' : 'upload'} className={importingBackup ? 'animate-spin' : ''} />
                {importingBackup ? t('Importando…') : t('Seleccionar archivo')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmReindex && (
        <ConfirmModal
          title={t('Reindexar todos los embeddings')}
          message={t('Se borrarán TODOS los embeddings existentes y se regenerarán desde cero. Esto consumirá tokens del proveedor de embeddings configurado. ¿Continuar?')}
          confirmLabel={t('Reindexar todo')}
          danger
          onConfirm={() => {
            setConfirmReindex(false);
            void window.nodus.reindexAll();
          }}
          onCancel={() => setConfirmReindex(false)}
        />
      )}
    </div>
  );
}

function McpConnectionModal({
  url,
  token,
  copied,
  onCopy,
  onClose,
}: {
  url: string;
  token: string;
  copied: 'url' | 'token' | null;
  onCopy: (kind: 'url' | 'token', value: string) => Promise<void>;
  onClose: () => void;
}) {
  const auth = `Authorization: Bearer ${token || '<token>'}`;
  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        nodus: {
          command: 'npx',
          args: ['mcp-remote', url, '--header', auth],
        },
      },
    },
    null,
    2
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true" aria-label={t('Conectar un cliente MCP')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{t('Conectar un cliente MCP')}</h2>
            <p className="mt-1 text-sm text-neutral-400">{t('Usa la URL y el bearer token actuales. No necesitas claves adicionales.')}</p>
          </div>
          <button className="btn btn-ghost" aria-label={t('Cerrar')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <ConnectionValue label={t('URL del servidor')} value={url} copied={copied === 'url'} onCopy={() => void onCopy('url', url)} />
          <ConnectionValue label={t('Bearer token')} value={token || t('Activa el servidor para generar un token.')} copied={copied === 'token'} onCopy={() => void onCopy('token', token)} />

          <div className="rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300">
            <h3 className="font-medium text-neutral-100">Claude Desktop</h3>
            <p className="mt-1 text-neutral-400">{t('Si tu versión permite conectores MCP remotos, añade la URL y la cabecera de autorización. Como alternativa compatible, usa este puente stdio y reinicia Claude Desktop:')}</p>
            <pre className="mt-3 overflow-x-auto rounded bg-neutral-950 p-3 text-xs text-neutral-300">{claudeConfig}</pre>
          </div>

          <div className="rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300">
            <h3 className="font-medium text-neutral-100">ChatGPT</h3>
            <p className="mt-1 text-neutral-400">{t('Añade un servidor MCP con esta URL y la cabecera de autorización en Connectors/Developer mode. ChatGPT web no puede acceder a 127.0.0.1: necesitarías un túnel HTTPS externo, que no forma parte de Nodus. Si expones el servidor, protege el token.')}</p>
          </div>

          <div className="rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300">
            <h3 className="font-medium text-neutral-100">{t('Cliente genérico')}</h3>
            <p className="mt-1 text-neutral-400">{t('Transporte: Streamable HTTP. Endpoint: la URL anterior. Auth: la cabecera Authorization: Bearer <token>.')}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button className="btn btn-primary" onClick={onClose}>{t('Cerrar')}</button>
        </div>
      </div>
    </div>
  );
}

function ConnectionValue({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
        <code className="min-w-0 flex-1 break-all text-xs text-neutral-200">{value}</code>
        <button className="btn btn-ghost shrink-0" disabled={!value} onClick={onCopy}>
          <Icon name={copied ? 'check' : 'copy'} /> {copied ? t('Copiado') : t('Copiar')}
        </button>
      </div>
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

function SettingsTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
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
          {loading ? t('Cargando…') : t('Cargar modelos')}
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
        {t('OpenRouter acepta IDs como baai/bge-m3; si escribes BAAI:bge-m3 se normaliza automáticamente.')}
      </p>
    </div>
  );
}
