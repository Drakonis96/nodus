import { useEffect, useState } from 'react';
import type {
  AppSettings,
  CopilotServerStatus,
  EmbeddingProvider,
  McpServerStatus,
  ModelInfo,
  UpdateProgressEvent,
  VaultSummary,
} from '@shared/types';
import { ProvidersSettings } from './ProvidersSettings';
import { ConfirmModal } from '../components/ConfirmModal';
import { confirm } from '../components/feedback';
import { Icon, PROVIDER_LABELS } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { NAV_GROUPS, orderedNav } from '../navigation';
import { t } from '../i18n';

const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'gemini', 'openrouter'];

const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'baai/bge-m3',
};

type SettingsTabId = 'providers' | 'models' | 'library' | 'extraction' | 'interface' | 'integrations' | 'system' | 'data';

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: string; keywords: string }[] = [
  { id: 'providers', label: 'Proveedores', icon: 'key', keywords: 'api key keys claves proveedores provider providers modelos favoritos default openai anthropic deepseek gemini google openrouter xiaomi lm studio ollama vault boveda' },
  { id: 'models', label: 'Modelos IA', icon: 'wand', keywords: 'model model id embedding embeddings extraccion sintesis tutor resumen fusion razonamiento openrouter unpaywall contexto concurrencia' },
  { id: 'library', label: 'Biblioteca', icon: 'book', keywords: 'zotero sincronizacion tag lectura automatizacion cola analisis resumen relaciones' },
  { id: 'extraction', label: 'Texto y OCR', icon: 'search', keywords: 'pdf texto fulltext zotero ocr tesseract paginas idiomas' },
  { id: 'interface', label: 'Interfaz', icon: 'palette', keywords: 'idioma tema claro oscuro animaciones barra lateral menu navegacion' },
  { id: 'integrations', label: 'Integraciones', icon: 'link', keywords: 'mcp servidor token puerto word copilot certificado addin' },
  { id: 'system', label: 'Sistema', icon: 'settings', keywords: 'ayuda tutorial actualizaciones update version' },
  { id: 'data', label: 'Datos', icon: 'download', keywords: 'backup exportar importar demo copia cifrada peligro reinicializar grafo borrar' },
];

function normalizeSettingsText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function Settings({
  settings,
  vaults,
  activeVault,
  onChange,
  onVaultsChanged,
}: {
  settings: AppSettings;
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onChange: () => Promise<unknown>;
  onVaultsChanged: () => Promise<unknown>;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('providers');
  const [settingsQuery, setSettingsQuery] = useState('');
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
  const [autoBackupHasPassword, setAutoBackupHasPassword] = useState(false);
  const [autoBackupPasswordInput, setAutoBackupPasswordInput] = useState('');
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, port: null, url: null, error: null });
  const [copilotStatus, setCopilotStatus] = useState<CopilotServerStatus>({ running: false, port: null, addinUrl: null, certReady: false, error: null });
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotInstallBusy, setCopilotInstallBusy] = useState(false);
  const [copilotInstallMessage, setCopilotInstallMessage] = useState<string | null>(null);
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
    void window.nodus.hasBackupPassword().then((has) => {
      if (active) setAutoBackupHasPassword(has);
    });
    return () => {
      active = false;
    };
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
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getCopilotStatus();
      if (active) setCopilotStatus(next);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [settings.copilotEnabled, settings.copilotPort, settings.copilotToken]);

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

  const startReset = async () => {
    const ok = await confirm({
      title: t('Reinicializar el grafo'),
      message: t('Reinicializar el grafo borrará TODAS las ideas, temas, conexiones, autores y huecos, y dejará cada obra sin analizar. Tu biblioteca de Zotero y tus ajustes se conservan. Esta acción no se puede deshacer.'),
      confirmLabel: t('Continuar'),
      danger: true,
    });
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
  const normalizedSettingsQuery = normalizeSettingsText(settingsQuery);
  const settingsSearchActive = normalizedSettingsQuery.length > 0;
  const visibleSettingsSection = (tab: SettingsTabId, title: string, keywords: string): boolean => {
    if (!settingsSearchActive) return settingsTab === tab;
    const tabMeta = SETTINGS_TABS.find((item) => item.id === tab);
    return normalizeSettingsText(`${title} ${t(title)} ${tabMeta?.label ?? ''} ${t(tabMeta?.label ?? '')} ${tabMeta?.keywords ?? ''} ${keywords}`).includes(normalizedSettingsQuery);
  };
  const visibleSettingsCount = [
    visibleSettingsSection('providers', 'Proveedores de IA y modelos', 'api claves proveedor favoritos predeterminado vault boveda cargar claves'),
    visibleSettingsSection('library', 'Zotero y sincronización', 'zotero sincronizacion manual tiempo real storage tag lectura'),
    visibleSettingsSection('library', 'Automatización de análisis', 'analizar temas profundo resumen cola relaciones reanudar'),
    visibleSettingsSection('interface', 'Idioma', 'interfaz prompts idioma español english citas'),
    visibleSettingsSection('interface', 'Apariencia', 'tema claro oscuro animaciones velocidad'),
    visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion'),
    visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado actualizaciones version update reiniciar'),
    visibleSettingsSection('integrations', 'Servidor MCP', 'mcp servidor puerto token cliente conexion'),
    visibleSettingsSection('integrations', 'Copiloto de escritura Word', 'word copilot addin certificado token localhost'),
    visibleSettingsSection('data', 'Datos', 'demo exportar importar copia backup cifrada contraseña'),
    visibleSettingsSection('models', 'IA avanzada', 'modelo extraccion sintesis tutor resumen fusion embeddings indexacion razonamiento openrouter unpaywall contexto concurrencia'),
    visibleSettingsSection('extraction', 'Extracción de texto PDFs grandes', 'pdf texto zotero ocr tesseract paginas idiomas'),
    visibleSettingsSection('data', 'Zona de peligro', 'reinicializar grafo borrar ideas temas conexiones autores huecos'),
  ].filter(Boolean).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start gap-4 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Ajustes')}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {t('Busca un ajuste o entra por una sección temática.')}
          </p>
          <p className="text-xs text-neutral-600 mt-1">Nodus v{__APP_VERSION__}</p>
        </div>
        <div className="flex-1" />
        <label className="relative w-full sm:w-80">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input w-full pl-9"
            value={settingsQuery}
            onChange={(e) => setSettingsQuery(e.target.value)}
            placeholder={t('Buscar en ajustes…')}
          />
        </label>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {SETTINGS_TABS.map((tab) => (
          <SettingsTabButton
            key={tab.id}
            active={!settingsSearchActive && settingsTab === tab.id}
            icon={tab.icon}
            onClick={() => {
              setSettingsTab(tab.id);
              setSettingsQuery('');
            }}
          >
            {t(tab.label)}
          </SettingsTabButton>
        ))}
        {settingsSearchActive && (
          <div className="ml-auto self-center text-xs text-neutral-500">
            {visibleSettingsCount === 1 ? t('1 sección encontrada') : `${visibleSettingsCount} ${t('secciones encontradas')}`}
          </div>
        )}
      </div>

      {visibleSettingsCount === 0 && (
        <div className="card p-5 text-sm text-neutral-500">
          {t('No hay ajustes que coincidan con la búsqueda.')}
        </div>
      )}
      {visibleSettingsSection('providers', 'Proveedores de IA y modelos', 'api claves proveedor favoritos predeterminado vault boveda cargar claves') && (
        <ProvidersSettings
            settings={settings}
            vaults={vaults}
            activeVault={activeVault}
            onChange={onChange}
            onVaultsChanged={onVaultsChanged}
          />
      )}

      {visibleSettingsSection('library', 'Zotero y sincronización', 'zotero sincronizacion manual tiempo real storage tag lectura') && (
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
      )}

      {visibleSettingsSection('library', 'Automatización de análisis', 'analizar temas profundo resumen cola relaciones reanudar') && (
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
      )}

      {visibleSettingsSection('interface', 'Idioma', 'interfaz prompts idioma español english citas') && (
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
      )}

      {visibleSettingsSection('interface', 'Apariencia', 'tema claro oscuro animaciones velocidad') && (
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
      )}

      {visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion') && (
          <Section title={t('Barra lateral')}>
            <p className="text-xs text-neutral-500 -mt-1">
              {t('Reordena u oculta las secciones del menú lateral. «Inicio» queda siempre la primera y «Ajustes» la última; ninguna de las dos puede moverse ni ocultarse.')}
            </p>
            <SidebarOrderEditor
              sidebarOrder={settings.sidebarOrder}
              sidebarHidden={settings.sidebarHidden}
              onReorder={(ids) => void patch({ sidebarOrder: ids })}
              onToggleHidden={(hidden) => void patch({ sidebarHidden: hidden })}
            />
          </Section>
      )}

      {visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado actualizaciones version update reiniciar') && (
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
      )}

      {visibleSettingsSection('integrations', 'Servidor MCP', 'mcp servidor puerto token cliente conexion') && (
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
      )}

      {visibleSettingsSection('integrations', 'Copiloto de escritura Word', 'word copilot addin certificado token localhost') && (
          <Section title={t('Copiloto de escritura (Word)')}>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Activar Nodus Copilot para Word')}</label>
              <input type="checkbox" checked={settings.copilotEnabled} onChange={(e) => void patch({ copilotEnabled: e.target.checked })} />
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs">
              {copilotStatus.running ? (
                <span className="text-emerald-400">{t('Activo')}: {copilotStatus.addinUrl}</span>
              ) : copilotStatus.error ? (
                <span className="text-red-400">{t('Error')}: {copilotStatus.error}</span>
              ) : (
                <span className="text-neutral-500">{t('Apagado')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost border border-neutral-700"
                disabled={copilotBusy}
                onClick={async () => {
                  setCopilotBusy(true);
                  try {
                    const r = await window.nodus.ensureCopilotCert();
                    flash(r.message);
                  } finally {
                    setCopilotBusy(false);
                  }
                }}
              >
                <Icon name={copilotStatus.certReady ? 'check' : 'lock'} /> {copilotStatus.certReady ? t('Certificado listo') : t('Generar certificado')}
              </button>
              <button
                className="btn btn-primary"
                disabled={copilotInstallBusy}
                onClick={async () => {
                  setCopilotInstallBusy(true);
                  setCopilotInstallMessage(null);
                  try {
                    const result = await window.nodus.installCopilotAddin();
                    setCopilotInstallMessage(result.message);
                    flash(result.message);
                  } finally {
                    setCopilotInstallBusy(false);
                  }
                }}
              >
                <Icon name={copilotInstallBusy ? 'sync' : 'download'} className={copilotInstallBusy ? 'animate-spin' : ''} />
                {copilotInstallBusy ? t('Instalando…') : t('Instalar/actualizar en Word')}
              </button>
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.regenerateCopilotToken().then(() => flash(t('Token del copiloto regenerado.')))}>
                <Icon name="refresh" /> {t('Regenerar token')}
              </button>
            </div>
            {copilotInstallMessage && <p className="text-xs text-emerald-400">{copilotInstallMessage}</p>}
            <p className="text-xs text-neutral-500">
              {t('Sirve Nodus Copilot en https://localhost, busca ideas del corpus, muestra conexiones y permite insertar una idea con la IA configurada en Nodus.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('data', 'Datos', 'demo exportar importar copia backup cifrada contraseña') && (
          <Section title={t('Datos')}>
            {settings.demoMode && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/20">
                <div>
                  <label className="text-sm text-amber-700 dark:text-amber-300">{t('Modo demo activo')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Estás viendo un corpus de ejemplo. Sal del modo demo para empezar con tu propia biblioteca.')}
                  </p>
                </div>
                <button
                  className="btn border border-amber-300 text-amber-700 hover:bg-amber-100 shrink-0 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/50"
                  onClick={async () => {
                    await window.nodus.clearDemoData();
                    await onChange();
                    flash(t('Datos de demostración eliminados.'));
                  }}
                >
                  <Icon name="trash" /> {t('Salir del modo demo')}
                </button>
              </div>
            )}
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
            <div className="mt-2 border-t border-neutral-800 pt-3">
              <label className="text-sm">{t('Sincronización entre equipos')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={async () => {
                    const result = await window.nodus.exportSyncPackage();
                    if (result) flash(`${t('Exportado')}: ${result.path}`);
                  }}
                >
                  <Icon name="download" /> {t('Exportar paquete de sync (.nodussync)')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={async () => {
                    try {
                      const summary = await window.nodus.importSyncPackage();
                      if (!summary) return;
                      const total = (c: { inserted: number; updated: number }) => c.inserted + c.updated;
                      const applied =
                        total(summary.notes) + total(summary.noteFolders) + total(summary.writingDrafts) + total(summary.savedSearches) + total(summary.edgeFeedback);
                      flash(`${t('Sincronización fusionada')}: ${applied} ${t('cambios aplicados (nada local se ha borrado).')}`);
                    } catch (e) {
                      flash(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Icon name="upload" /> {t('Importar paquete de sync (.nodussync)')}
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {t('Lleva tus notas, borradores, búsquedas guardadas y auditorías de relaciones a otro equipo. Al importar se fusiona: gana la versión más reciente y nunca se borra nada local.')}
              </p>
            </div>
            <div className="mt-2 border-t border-neutral-800 pt-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm">{t('Copias de seguridad automáticas')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Copias cifradas periódicas en una carpeta a tu elección (apúntala a iCloud Drive o Google Drive para tenerlas fuera de este equipo). No incluyen claves API.')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-indigo-500"
                  checked={settings.autoBackupEnabled}
                  onChange={(e) => void patch({ autoBackupEnabled: e.target.checked })}
                />
              </div>
              {settings.autoBackupEnabled && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-ghost border border-neutral-700"
                      onClick={async () => {
                        const folder = await window.nodus.chooseBackupFolder();
                        if (folder) await patch({ autoBackupFolder: folder });
                      }}
                    >
                      <Icon name="folder" /> {t('Elegir carpeta')}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-400" title={settings.autoBackupFolder}>
                      {settings.autoBackupFolder || t('Sin carpeta elegida')}
                    </span>
                    <select
                      className="input w-auto text-xs"
                      value={settings.autoBackupIntervalHours}
                      onChange={(e) => void patch({ autoBackupIntervalHours: Number(e.target.value) })}
                    >
                      <option value={12}>{t('Cada 12 horas')}</option>
                      <option value={24}>{t('Cada día')}</option>
                      <option value={168}>{t('Cada semana')}</option>
                    </select>
                  </div>
                  {autoBackupHasPassword ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-emerald-400">{t('Contraseña maestra configurada (guardada en el llavero del sistema).')}</span>
                      <button
                        className="btn btn-ghost border border-neutral-700 text-xs"
                        onClick={async () => {
                          const result = await window.nodus.saveBackupRecoveryKit();
                          flash(result.ok ? `${t('Kit de recuperación guardado en')} ${result.message}` : result.message);
                        }}
                      >
                        {t('Guardar kit de recuperación')}
                      </button>
                      <button
                        className="btn btn-ghost border border-neutral-700 text-xs"
                        onClick={async () => {
                          await window.nodus.clearBackupPassword();
                          setAutoBackupHasPassword(false);
                          flash(t('Contraseña maestra eliminada. Las copias automáticas quedan en pausa.'));
                        }}
                      >
                        {t('Cambiar contraseña')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="password"
                        className="input w-64"
                        placeholder={t('Contraseña maestra (mín. 8 caracteres)')}
                        value={autoBackupPasswordInput}
                        onChange={(e) => setAutoBackupPasswordInput(e.target.value)}
                      />
                      <button
                        className="btn btn-ghost border border-neutral-700"
                        disabled={autoBackupPasswordInput.trim().length < 8}
                        onClick={async () => {
                          try {
                            await window.nodus.setBackupPassword(autoBackupPasswordInput);
                            setAutoBackupPasswordInput('');
                            setAutoBackupHasPassword(true);
                            flash(t('Contraseña maestra guardada. Descarga el kit de recuperación: sin la contraseña, las copias no se pueden restaurar.'));
                          } catch (e) {
                            flash(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        {t('Guardar contraseña')}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-ghost border border-neutral-700"
                      disabled={autoBackupRunning || !settings.autoBackupFolder || !autoBackupHasPassword}
                      onClick={async () => {
                        setAutoBackupRunning(true);
                        try {
                          const result = await window.nodus.runBackupNow();
                          flash(result.message);
                          await onChange();
                        } finally {
                          setAutoBackupRunning(false);
                        }
                      }}
                    >
                      <Icon name="download" /> {autoBackupRunning ? t('Copiando…') : t('Hacer copia ahora')}
                    </button>
                    {settings.lastAutoBackupStatus && (
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" title={settings.lastAutoBackupStatus}>
                        {settings.lastAutoBackupAt ? `${new Date(settings.lastAutoBackupAt).toLocaleString()} · ` : ''}
                        {settings.lastAutoBackupStatus}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>
      )}

      {visibleSettingsSection('models', 'IA avanzada', 'modelo extraccion sintesis tutor resumen fusion embeddings indexacion razonamiento openrouter unpaywall contexto concurrencia') && (
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
            <Row
              label={t('Razonamiento (chat/tutor/escritura)')}
              hint={t('Los escaneos siempre usan razonamiento desactivado para ir más rápido. Esto solo afecta a las respuestas conversacionales.')}
            >
              <select
                className="input"
                value={settings.chatReasoning}
                onChange={(e) => patch({ chatReasoning: e.target.value as AppSettings['chatReasoning'] })}
              >
                <option value="off">{t('Desactivado (más rápido)')}</option>
                <option value="low">{t('Bajo')}</option>
                <option value="medium">{t('Medio')}</option>
                <option value="high">{t('Alto (más lento)')}</option>
              </select>
            </Row>
            <Row
              label={t('OpenRouter: priorizar velocidad')}
              hint={t('Enruta hacia el proveedor más rápido disponible. Puede aumentar ligeramente el coste.')}
            >
              <input
                type="checkbox"
                checked={settings.openRouterThroughput}
                onChange={(e) => patch({ openRouterThroughput: e.target.checked })}
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
      )}

      {visibleSettingsSection('extraction', 'Extracción de texto PDFs grandes', 'pdf texto zotero ocr tesseract paginas idiomas') && (
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
      )}

      {visibleSettingsSection('data', 'Zona de peligro', 'reinicializar grafo borrar ideas temas conexiones autores huecos') && (
          <section className="card p-4 mb-4 border border-red-200 dark:border-red-900/60">
            <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3 dark:text-red-400">{t('Zona de peligro')}</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Reinicializar grafo')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {t('Borra todas las ideas, temas, conexiones, autores y huecos, y deja cada obra sin analizar. La biblioteca y los ajustes se conservan.')}
                </p>
              </div>
              <button className="btn border border-red-300 text-red-700 hover:bg-red-50 shrink-0 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50" onClick={startReset}>
                <Icon name="trash" /> {t('Reinicializar…')}
              </button>
            </div>
          </section>
      )}

      {resetCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => !resetting && setResetCode(null)}>
          <div className="card p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-600 dark:text-red-400">{t('Confirmación final')}</h3>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {t('Esto borrará todo el grafo de forma permanente. Para confirmar, escribe este código:')}
            </p>
            <div className="text-center text-3xl font-mono tracking-[0.5em] text-neutral-900 bg-neutral-100 rounded-lg py-3 select-none dark:text-neutral-100 dark:bg-neutral-950">
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
                className="btn border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
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

/**
 * Reorder and show/hide the sidebar sections, grouped like the sidebar itself
 * (Explorar · Analizar · Escribir). Home (pinned first) and Settings (pinned
 * last) can neither be moved nor hidden, so they are not shown here. Reordering
 * is constrained to within a group; the saved order is the flat list of the
 * remaining view ids, from which {@link groupedNav} derives each group's order.
 */
function SidebarOrderEditor({
  sidebarOrder,
  sidebarHidden,
  onReorder,
  onToggleHidden,
}: {
  sidebarOrder: string[];
  sidebarHidden: string[];
  onReorder: (ids: string[]) => void;
  onToggleHidden: (hidden: string[]) => void;
}) {
  const orderedAll = orderedNav(sidebarOrder).filter((n) => n.id !== 'home' && n.id !== 'settings');
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: orderedAll.filter((n) => n.group === g.id) }));
  const hidden = new Set(sidebarHidden);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const move = (id: string, dir: -1 | 1) => {
    const group = groups.find((g) => g.items.some((n) => n.id === id));
    if (!group) return;
    const gi = group.items.findIndex((n) => n.id === id);
    const target = gi + dir;
    if (target < 0 || target >= group.items.length) return;
    const ids: string[] = orderedAll.map((n) => n.id);
    const ia = ids.indexOf(id);
    const ib = ids.indexOf(group.items[target].id);
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    onReorder(ids);
  };

  const toggleHidden = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onToggleHidden([...next]);
  };

  // Drag-and-drop only rearranges within the same group; cross-group drops are ignored.
  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const src = orderedAll.find((n) => n.id === draggingId);
    const tgt = orderedAll.find((n) => n.id === targetId);
    if (!src || !tgt || src.group !== tgt.group) return;
    const ids: string[] = orderedAll.map((n) => n.id);
    const from = ids.indexOf(draggingId);
    if (from < 0) return;
    ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, draggingId);
    onReorder(ids);
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            {t(group.label)}
          </div>
          <ul className="space-y-1">
            {group.items.map((item, gi) => (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                  setDraggingId(item.id);
                }}
                onDragEnter={() => setDragOverId(item.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(item.id);
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                className={`flex items-center gap-2 rounded-md border bg-neutral-900/40 px-3 py-1.5 transition-colors ${
                  draggingId === item.id ? 'opacity-40' : ''
                } ${
                  dragOverId === item.id && draggingId !== item.id
                    ? 'border-indigo-500 border-dashed'
                    : 'border-neutral-800'
                }`}
              >
                <Icon name="list" size={13} className="shrink-0 cursor-grab text-neutral-600" />
                <Icon
                  name={item.icon}
                  size={15}
                  className={`shrink-0 ${hidden.has(item.id) ? 'text-neutral-700' : 'text-neutral-500'}`}
                />
                <span
                  className={`flex-1 min-w-0 truncate text-sm ${
                    hidden.has(item.id) ? 'text-neutral-600 line-through' : 'text-neutral-200'
                  }`}
                >
                  {t(item.label)}
                </span>
                <button
                  className={`p-1 rounded hover:bg-neutral-800 ${
                    hidden.has(item.id)
                      ? 'text-neutral-600 hover:text-neutral-300'
                      : 'text-neutral-500 hover:text-neutral-100'
                  }`}
                  title={hidden.has(item.id) ? t('Mostrar') : t('Ocultar')}
                  onClick={() => toggleHidden(item.id)}
                >
                  <Icon name={hidden.has(item.id) ? 'eyeOff' : 'eye'} size={14} />
                </button>
                <button
                  className="p-1 rounded text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
                  title={t('Subir')}
                  disabled={gi === 0}
                  onClick={() => move(item.id, -1)}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
                <button
                  className="p-1 rounded text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-500"
                  title={t('Bajar')}
                  disabled={gi === group.items.length - 1}
                  onClick={() => move(item.id, 1)}
                >
                  <Icon name="arrowDown" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
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

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(13rem,0.85fr)_minmax(0,1.55fr)] md:items-start">
      <label className="pt-2 text-sm text-neutral-300">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>}
      </label>
      <div className="min-w-0 md:flex md:justify-end">{children}</div>
    </div>
  );
}

function SettingsTabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm shadow-indigo-950/20'
          : 'border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
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
    <div className="w-full max-w-3xl space-y-2">
      <div className="grid gap-2 lg:grid-cols-[11rem_minmax(13rem,1fr)_auto]">
        <select className="input w-full" value={provider} onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}>
          {EMBEDDING_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        <input
          className="input w-full min-w-0"
          value={settings.embeddingModel}
          onChange={(e) => onPatch({ embeddingModel: e.target.value })}
          placeholder={DEFAULT_EMBEDDING_MODEL[provider]}
        />
        <button className="btn btn-ghost justify-center border border-neutral-700" onClick={loadModels} disabled={loading}>
          {loading ? t('Cargando…') : t('Cargar modelos')}
        </button>
      </div>
      {models && (
        <select
          className="input w-full"
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
      {error && <div className="text-xs text-red-400">{error}</div>}
      <p className="text-xs text-neutral-500">
        {t('OpenRouter acepta IDs como baai/bge-m3; si escribes BAAI:bge-m3 se normaliza automáticamente.')}
      </p>
    </div>
  );
}
