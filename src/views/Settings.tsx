import { useEffect, useState } from 'react';
import type {
  AppSettings,
  CopilotServerStatus,
  EmbeddingProvider,
  McpServerStatus,
  ModelInfo,
  StudyDataOverview,
  UpdateProgressEvent,
  VaultSummary,
  VaultType,
} from '@shared/types';
import { ImageGenerationSettings, ProvidersSettings } from './ProvidersSettings';
import { AudioGenerationSettings } from './AudioGenerationSettings';
import { ConfirmModal } from '../components/ConfirmModal';
import { confirm } from '../components/feedback';
import { Icon, PROVIDER_LABELS } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { SttSettings } from '../components/SttSettings';
import { LocalAiModelsSettings } from '../components/LocalAiModelsSettings';
import { NAV_GROUPS, orderedNav } from '../navigation';
import { t, tx } from '../i18n';
import { updateStatusMessage } from '../updateStatus';
import { DEFAULT_EMBEDDING_MODELS, EMBEDDING_PROVIDERS } from '@shared/providers';
import { effectiveSidebarHidden, isViewAllowedForVaultType } from '@shared/vaultTypes';

type SettingsTabId = 'providers' | 'models' | 'library' | 'extraction' | 'interface' | 'integrations' | 'system' | 'data' | 'about';

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: string; keywords: string }[] = [
  { id: 'providers', label: 'Proveedores', icon: 'key', keywords: 'api key keys claves proveedores provider providers modelos favoritos default openai anthropic deepseek gemini google openrouter xiaomi lm studio ollama vault boveda' },
  { id: 'models', label: 'Modelos IA', icon: 'wand', keywords: 'model model id embedding embeddings extraccion sintesis tutor resumen fusion razonamiento openrouter unpaywall contexto concurrencia' },
  { id: 'library', label: 'Biblioteca', icon: 'book', keywords: 'zotero sincronizacion tag lectura automatizacion cola analisis resumen relaciones' },
  { id: 'extraction', label: 'Texto y OCR', icon: 'search', keywords: 'pdf texto fulltext zotero ocr tesseract paginas idiomas' },
  { id: 'interface', label: 'Interfaz', icon: 'palette', keywords: 'idioma tema claro oscuro animaciones barra lateral menu navegacion accesibilidad contraste escala fuente lectura enfoque' },
  { id: 'integrations', label: 'Integraciones', icon: 'link', keywords: 'mcp servidor token puerto word copilot certificado addin' },
  { id: 'system', label: 'Tutoriales', icon: 'graduation', keywords: 'sistema ayuda tutorial' },
  { id: 'data', label: 'Backup / copia de seguridad', icon: 'download', keywords: 'datos backup exportar importar demo copia cifrada peligro reinicializar grafo borrar' },
  { id: 'about', label: 'Acerca de Nodus', icon: 'info', keywords: 'acerca proyecto codigo abierto open source gratuito apoyar donacion paypal desarrollador licencia actualizaciones update version novedades ultimos cambios latest changes' },
];

const ABOUT_ACTION_BUTTON_CLASS = 'btn btn-ghost w-56 shrink-0 justify-center border border-neutral-300 dark:border-neutral-700';

function normalizeSettingsText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function Settings({
  settings,
  vaults: _vaults,
  activeVault,
  onChange,
  onVaultsChanged: _onVaultsChanged,
  onOpenWhatsNew,
}: {
  settings: AppSettings;
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onChange: () => Promise<unknown>;
  onVaultsChanged: () => Promise<unknown>;
  onOpenWhatsNew: () => void;
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
  const [pendingModelSettingsMode, setPendingModelSettingsMode] = useState<AppSettings['modelSettingsMode'] | null>(null);
  const [pendingEmbeddingChange, setPendingEmbeddingChange] = useState<{ provider: EmbeddingProvider; model: string } | null>(null);
  const [backupResult, setBackupResult] = useState<{ path: string; password: string; recoveryKey: string } | null>(null);
  const [backupCopied, setBackupCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('nodus.settingsTarget') !== 'nodi') return;
    localStorage.removeItem('nodus.settingsTarget');
    setSettingsTab('interface');
    setSettingsQuery('Nodi');
  }, []);
  const [importPassword, setImportPassword] = useState('');
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [autoBackupHasPassword, setAutoBackupHasPassword] = useState(false);
  const [autoBackupPasswordInput, setAutoBackupPasswordInput] = useState('');
  const [showAutoBackupPassword, setShowAutoBackupPassword] = useState(false);
  const [autoBackupRunning, setAutoBackupRunning] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, port: null, url: null, error: null });
  const [copilotStatus, setCopilotStatus] = useState<CopilotServerStatus>({ running: false, port: null, addinUrl: null, certReady: false, error: null });
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotInstallBusy, setCopilotInstallBusy] = useState(false);
  const [copilotInstallMessage, setCopilotInstallMessage] = useState<string | null>(null);
  const [libreOfficeInstallBusy, setLibreOfficeInstallBusy] = useState(false);
  const [libreOfficeInstallMessage, setLibreOfficeInstallMessage] = useState<string | null>(null);
  const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcpPort));
  const [mcpHelpOpen, setMcpHelpOpen] = useState(false);
  const [mcpCopied, setMcpCopied] = useState<'url' | 'token' | null>(null);

  useEffect(() => {
    return window.nodus.onUpdateProgress((event) => {
      setUpdateProgress(event);
      setUpdateMessage(updateStatusMessage(event));
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
      setUpdateMessage(updateStatusMessage(result));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    const result = await window.nodus.installUpdate();
    setUpdateProgress({ ...result, at: new Date().toISOString() });
    setUpdateMessage(updateStatusMessage(result));
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
    await navigator.clipboard.writeText(`${t('Contraseña')}: ${backupResult.password}\n${t('Clave de recuperación')}: ${backupResult.recoveryKey}`);
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
    visibleSettingsSection('interface', 'Accesibilidad y lectura', 'escala zoom fuente legible contraste movimiento animaciones enfoque lectura teclado lector pantalla'),
    visibleSettingsSection('interface', 'Mascota Nodi', 'nodi mascota mascot flotante superpuesta always on top encima escritorio companion acompanante'),
    visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion'),
    visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado actualizaciones version update reiniciar'),
    visibleSettingsSection('integrations', 'Servidor MCP', 'mcp servidor puerto token cliente conexion'),
    visibleSettingsSection('integrations', 'Copiloto de escritura Word', 'word copilot addin certificado token localhost'),
    visibleSettingsSection('integrations', 'Copiloto de escritura LibreOffice', 'libreoffice copilot macro python install instalacion instalando'),
    visibleSettingsSection('data', 'Backup / copia de seguridad', 'datos demo exportar importar copia backup cifrada contraseña'),
    visibleSettingsSection('models', 'Modelos de IA', 'basico avanzado modelo general extraccion sintesis tutor resumen fusion embeddings transcripcion voz imagen'),
    visibleSettingsSection('extraction', 'Extracción de texto PDFs grandes', 'pdf texto zotero ocr tesseract paginas idiomas'),
    visibleSettingsSection('data', 'Zona de peligro', 'reinicializar grafo borrar ideas temas conexiones autores huecos'),
    visibleSettingsSection('about', 'Acerca de Nodus', 'proyecto independiente codigo abierto open source gratuito apoyar donacion paypal desarrollador actualizaciones update version'),
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
            className="input input-with-leading-icon w-full"
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
            onChange={onChange}
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
                className="input w-full md:w-64"
                value={settings.uiLanguage}
                onChange={(e) => patch({ uiLanguage: e.target.value as AppSettings['uiLanguage'] })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt">Português (Portugal)</option>
                <option value="pt-BR">Português (Brasil)</option>
              </select>
            </Row>
            <Row label={t('Idioma de los prompts (idioma de las ideas generadas)')}>
              <select
                className="input w-full md:w-64"
                value={settings.promptLanguage}
                onChange={(e) => patch({ promptLanguage: e.target.value as AppSettings['promptLanguage'] })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt">Português (Portugal)</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="tr">Türkçe</option>
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
                <option value="system">{t('Sistema')}</option>
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

      {visibleSettingsSection('interface', 'Accesibilidad y lectura', 'escala zoom fuente legible contraste movimiento animaciones enfoque lectura teclado lector pantalla') && (
          <Section title={t('Accesibilidad y lectura')}>
            <div data-testid="accessibility-settings" className="space-y-3">
              <Row label={t('Tamaño de la interfaz')} hint={t('Ajusta menús, botones y texto sin cambiar el contenido de los documentos.') }>
                <div className="flex w-full max-w-md items-center gap-3">
                  <input
                    className="min-w-0 flex-1"
                    type="range"
                    min={0.85}
                    max={1.3}
                    step={0.05}
                    value={settings.interfaceScale}
                    aria-label={t('Tamaño de la interfaz')}
                    onChange={(e) => void patch({ interfaceScale: Math.max(0.85, Math.min(1.3, Number(e.target.value))) })}
                  />
                  <output className="w-12 text-right text-xs text-neutral-400">{Math.round(settings.interfaceScale * 100)}%</output>
                </div>
              </Row>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Fuente de alta legibilidad')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Usa una fuente de sistema más ancha y clara, también sin conexión.')}</span></span>
                <input data-testid="accessibility-font" type="checkbox" checked={settings.accessibleFont} onChange={(e) => void patch({ accessibleFont: e.target.checked })} />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Contraste reforzado')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Refuerza bordes, foco de teclado y separación entre fondo y texto.')}</span></span>
                <input data-testid="accessibility-contrast" type="checkbox" checked={settings.highContrast} onChange={(e) => void patch({ highContrast: e.target.checked })} />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                <span><span className="block text-sm text-neutral-300">{t('Reducir animaciones')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Elimina movimiento no esencial; la preferencia del sistema siempre se respeta.')}</span></span>
                <input data-testid="accessibility-motion" type="checkbox" checked={settings.reduceMotion} onChange={(e) => void patch({ reduceMotion: e.target.checked })} />
              </label>
              {activeVault?.type === 'estudio' && (
                <label className="flex items-start justify-between gap-4 rounded-lg border border-neutral-800 p-3">
                  <span><span className="block text-sm text-neutral-300">{t('Modo de lectura')}</span><span className="mt-0.5 block text-xs text-neutral-500">{t('Da al editor una medida más cómoda y reduce el ruido visual del área de lectura.')}</span></span>
                  <input data-testid="accessibility-reading" type="checkbox" checked={settings.readingFocusMode} onChange={(e) => void patch({ readingFocusMode: e.target.checked })} />
                </label>
              )}
              <p className="text-xs text-neutral-500">{t('Puedes recorrer los controles con Tab, activar botones con Intro o Espacio y abrir la paleta global con Ctrl/⌘ K.')}</p>
            </div>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Mascota Nodi', 'nodi mascota mascot flotante superpuesta always on top encima escritorio companion acompanante') && (
          <Section title={t('Mascota Nodi')}>
            <p className="text-xs text-neutral-500 -mt-1">
              {t('Nodi es el nodo que acompaña la app, flotando abajo a la derecha. Haz clic en Nodi para abrir el chat, tus notificaciones y la ayuda.')}
            </p>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-neutral-300">{t('Mostrar a Nodi')}</label>
              <input type="checkbox" checked={settings.mascotEnabled} onChange={(e) => void patch({ mascotEnabled: e.target.checked })} />
            </div>
            <label className="block text-sm text-neutral-300">
              {t('Modelo del chat de Nodi')}
              <span className="mt-0.5 block text-xs font-normal text-neutral-500">{t('Este selector es independiente del asistente de investigación y del resto de funciones de IA.')}</span>
              <div className="mt-2 max-w-md"><ModelPicker settings={settings} value={settings.nodiModel ?? settings.synthesisModel} onChange={(nodiModel) => void patch({ nodiModel })} compact menu emptyLabel="Usar modelo de síntesis" /></div>
            </label>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <label className="text-sm text-neutral-300">{t('Mantener siempre visible sobre otras apps')}</label>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t('Abre a Nodi en una pequeña ventana flotante del escritorio, por encima del resto de aplicaciones (en los sistemas operativos que lo permiten). Puedes arrastrarla para moverla.')}
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.mascotAlwaysOnTop}
                disabled={!settings.mascotEnabled}
                onChange={(e) => void patch({ mascotAlwaysOnTop: e.target.checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <label className="text-sm text-neutral-300">{t('Trajes de Nodi según la bóveda')}</label>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t('Nodi lleva un pequeño accesorio según el modo de la bóveda (birrete, brote, gafas de estudio). Desactívalo para ver el Nodi normal en todas.')}
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.mascotVaultCostumes}
                disabled={!settings.mascotEnabled}
                onChange={(e) => void patch({ mascotVaultCostumes: e.target.checked })}
              />
            </div>
          </Section>
      )}

      {visibleSettingsSection('interface', 'Barra lateral', 'menu lateral ordenar ocultar mostrar navegacion') && (
          <Section title={t('Barra lateral')}>
            <p className="text-xs text-neutral-500 -mt-1">
              {t('Reordena u oculta las secciones del menú lateral. «Inicio» queda siempre la primera y «Ajustes» la última; ninguna de las dos puede moverse ni ocultarse.')}
            </p>
            <SidebarOrderEditor
              sidebarOrder={settings.sidebarOrder}
              sidebarHidden={effectiveSidebarHidden(settings.sidebarHidden, settings.sidebarCustomized, activeVault?.type)}
              vaultType={activeVault?.type}
              onReorder={(ids) => void patch({ sidebarOrder: ids })}
              onToggleHidden={(hidden) => void patch({ sidebarHidden: hidden, sidebarCustomized: true })}
            />
          </Section>
      )}

      {visibleSettingsSection('system', 'Ayuda', 'tutorial uso avanzado') && (
          <Section title={t('Ayuda')}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-neutral-300">{t('Guía esencial de Nodus e IA')}</label>
                <p className="text-xs text-neutral-500 mt-0.5">{t('Bóvedas, modelos locales, API keys, costes, embeddings y voz explicados desde cero.')}</p>
              </div>
              <button
                data-testid="basics-tutorial-replay"
                className="btn btn-primary"
                onClick={() => patch({ basicsTutorialVersion: 0 }).then(() => flash(t('Se mostrará la guía esencial.')))}
              >
                <Icon name="play" /> {t('Empezar')}
              </button>
            </div>
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
            {activeVault?.type === 'genealogy' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de genealogía')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('El árbol, las fichas con evidencia, los parentescos sugeridos, la línea temporal, el archivo y el mapa.')}</p>
                </div>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ genealogyTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de genealogía.')))}
                >
                  <Icon name="tree" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'databases' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de bases de datos')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('La lista de bases de datos, la tabla con columnas tipadas, la edición de celdas y las secciones de análisis y chat.')}</p>
                </div>
                <button
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ databasesTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de bases de datos.')))}
                >
                  <Icon name="table" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
            {activeVault?.type === 'estudio' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-neutral-300">{t('Tutorial de estudio')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">{t('Cursos, horarios, materiales, grabaciones, chat, ideas, preguntas y repaso.')}</p>
                </div>
                <button
                  data-testid="study-tour-replay"
                  className="btn btn-ghost border border-neutral-700"
                  onClick={() => patch({ studyTourComplete: false }).then(() => flash(t('Se mostrará el tutorial de estudio.')))}
                >
                  <Icon name="graduation" /> {t('Ver de nuevo')}
                </button>
              </div>
            )}
          </Section>
      )}

      {visibleSettingsSection('about', 'Acerca de Nodus', 'proyecto independiente codigo abierto open source gratuito apoyar donacion paypal desarrollador actualizaciones update version novedades ultimos cambios latest changes') && (
        <Section title={t('Acerca de Nodus')}>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <Icon name="network" size={22} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Nodus</h2>
                <p className="mt-0.5 text-xs text-neutral-500">v{__APP_VERSION__}</p>
              </div>
            </div>

            <div className="mt-5 max-w-3xl space-y-3 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
              <p>
                {t('Nodus es un proyecto independiente de código abierto, desarrollado y mantenido principalmente por una sola persona. No es un servicio comercial ni un producto de pago: la aplicación seguirá siendo gratuita y su código permanecerá abierto.')}
              </p>
              <p>
                {t('Si Nodus te ayuda a estudiar, investigar o escribir y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.')}
              </p>
            </div>

            <button
              data-testid="support-nodus-paypal"
              className="btn btn-primary mt-5"
              onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
            >
              <Icon name="paypal" size={17} /> {t('Apoyar con PayPal')}
              <Icon name="external" size={13} className="opacity-70" />
            </button>
            <p className="mt-2 text-xs text-neutral-500">
              {t('El enlace se abrirá en tu navegador. Nodus no procesa pagos ni recibe información de pago.')}
            </p>
          </div>
          <div data-testid="about-latest-changes" className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
            <div>
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Últimos cambios')}</label>
              <p className="mt-0.5 text-xs text-neutral-500">{t('Consulta las novedades de la versión actual cuando quieras.')}</p>
            </div>
            <button
              data-testid="open-latest-changes"
              className={ABOUT_ACTION_BUTTON_CLASS}
              onClick={onOpenWhatsNew}
            >
              <Icon name="star" /> {t('Ver últimos cambios')}
            </button>
          </div>
          <div data-testid="about-updates" className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
            <div>
              <label className="text-sm text-neutral-700 dark:text-neutral-300">{t('Actualizaciones')}</label>
              {updateMessage && <p className="mt-0.5 text-xs text-neutral-500">{updateMessage}</p>}
              {(updatePct != null || updateBusy) && (
                <div className="mt-2 w-72 max-w-full">
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
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
              <button className={ABOUT_ACTION_BUTTON_CLASS} onClick={checkForUpdates} disabled={checkingUpdate || updateBusy}>
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
          <Section title={`${t('Copiloto de escritura (Word)')} · beta`}>
            <p className="text-xs text-neutral-500">
              {t('1) Genera el certificado local · 2) Activa el copiloto · 3) Instálalo en Word y ábrelo desde la pestaña Nodus.')}
            </p>
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

      {visibleSettingsSection('integrations', 'Copiloto de escritura LibreOffice', 'libreoffice copilot macro python install instalacion instalando') && (
          <Section title={t('Copiloto de escritura (LibreOffice)')}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={libreOfficeInstallBusy}
                onClick={async () => {
                  setLibreOfficeInstallBusy(true);
                  setLibreOfficeInstallMessage(null);
                  try {
                    const result = await window.nodus.installLibreOfficeCopilot();
                    setLibreOfficeInstallMessage(result.message);
                    flash(result.message);
                  } catch (err: any) {
                    setLibreOfficeInstallMessage(err.message || String(err));
                    flash(err.message || String(err));
                  } finally {
                    setLibreOfficeInstallBusy(false);
                  }
                }}
              >
                <Icon name={libreOfficeInstallBusy ? 'sync' : 'download'} className={libreOfficeInstallBusy ? 'animate-spin' : ''} />
                {libreOfficeInstallBusy ? t('Instalando…') : t('Instalar macro en LibreOffice')}
              </button>
            </div>
            {libreOfficeInstallMessage && <p className="text-xs text-emerald-400">{libreOfficeInstallMessage}</p>}
            <p className="text-xs text-neutral-500">
              {t('Copia el macro nodus_copilot.py en la carpeta de macros de LibreOffice. Para usarlo en LibreOffice Writer, ve a Herramientas -> Macros -> Ejecutar macro -> Mis macros -> nodus_copilot -> start_nodus_copilot.')}
            </p>
          </Section>
      )}

      {visibleSettingsSection('data', 'Backup / copia de seguridad', 'datos demo exportar importar copia backup cifrada contraseña') && (
          <Section title={t('Backup / copia de seguridad')}>
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
                        total(summary.notes) +
                        total(summary.noteFolders) +
                        total(summary.writingDrafts) +
                        total(summary.savedSearches) +
                        total(summary.edgeFeedback) +
                        total(summary.databases) +
                        total(summary.study);
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
                {t('Lleva tus notas, datos de estudio, materiales y grabaciones, borradores, búsquedas guardadas, auditorías de relaciones y bases de datos a otro equipo. Al importar se fusiona: gana la versión más reciente y nunca se borra nada local.')}
              </p>
            </div>
            <div className="mt-2 border-t border-neutral-800 pt-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm">{t('Copias de seguridad automáticas')}</label>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t('Copias cifradas periódicas en una carpeta a tu elección. Cada copia incluye todo Nodus; puedes usar iCloud Drive, Google Drive o Dropbox para mantenerla fuera de este equipo.')}
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
                      onClick={() => void patch({ recoverySetupVersion: 0 })}
                    >
                      <Icon name="folder" /> {settings.autoBackupFolder ? t('Cambiar carpeta o recuperar') : t('Configurar carpeta segura')}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-400" title={settings.autoBackupFolder}>
                      {settings.autoBackupFolder || t('Sin carpeta elegida')}
                    </span>
                  </div>

                  <div data-testid="automatic-backup-scope" className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/15 dark:text-emerald-200">
                    <Icon name="lock" className="mt-0.5 shrink-0" />
                    <div><span className="font-medium">{t('Cada copia protege todo Nodus automáticamente.')}</span><p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400">{t('Incluye todas las bóvedas, documentos, preferencias, historiales, archivos generados y claves API. No existen exclusiones configurables.')}</p></div>
                  </div>

                  {/* Schedule: which day(s) of the week + at what time. If the machine
                      was off at the scheduled time, the backup runs at the next launch. */}
                  <div className="space-y-2 rounded-md border border-neutral-800 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-500">{t('Días')}</span>
                      {[
                        { d: 1, label: t('L') },
                        { d: 2, label: t('M') },
                        { d: 3, label: t('X') },
                        { d: 4, label: t('J') },
                        { d: 5, label: t('V') },
                        { d: 6, label: t('S') },
                        { d: 0, label: t('D') },
                      ].map(({ d, label }) => {
                        const days = settings.autoBackupDays ?? [];
                        const on = days.length === 0 || days.includes(d);
                        return (
                          <button
                            key={d}
                            className={`h-7 w-7 rounded-md border text-xs ${on ? 'border-indigo-600 bg-indigo-600/25 text-indigo-200' : 'border-neutral-700 text-neutral-500'}`}
                            title={on ? t('Activo') : t('Inactivo')}
                            onClick={() => {
                              // From "every day" (empty), first click selects a single explicit day.
                              const base = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : [...days];
                              const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
                              void patch({ autoBackupDays: next.length === 7 ? [] : next.sort((a, b) => a - b) });
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {(settings.autoBackupDays ?? []).length === 0 && (
                        <span className="text-[11px] text-neutral-500">{t('todos los días')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">{t('Hora')}</span>
                      <input
                        type="time"
                        className="input w-auto text-xs"
                        value={`${String(settings.autoBackupHour ?? 3).padStart(2, '0')}:${String(settings.autoBackupMinute ?? 0).padStart(2, '0')}`}
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':').map(Number);
                          if (Number.isFinite(h) && Number.isFinite(m)) void patch({ autoBackupHour: h, autoBackupMinute: m });
                        }}
                      />
                      <span className="text-[11px] text-neutral-500">
                        {t('Si el equipo estaba apagado, la copia se hace al arrancar la app.')}
                      </span>
                    </div>
                  </div>
                  {autoBackupHasPassword ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-emerald-400">{t('Contraseña maestra y clave de recuperación configuradas.')}</span>
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
                      <div className="relative w-64">
                        <input
                          type={showAutoBackupPassword ? 'text' : 'password'}
                          className="input w-full pr-10"
                          placeholder={t('Contraseña maestra (mín. 8 caracteres)')}
                          value={autoBackupPasswordInput}
                          onChange={(e) => setAutoBackupPasswordInput(e.target.value)}
                        />
                        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100" onClick={() => setShowAutoBackupPassword((value) => !value)} aria-label={t(showAutoBackupPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')} title={t(showAutoBackupPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}><Icon name={showAutoBackupPassword ? 'eyeOff' : 'eye'} size={17} /></button>
                      </div>
                      <button
                        className="btn btn-ghost border border-neutral-700"
                        disabled={autoBackupPasswordInput.trim().length < 8}
                        onClick={async () => {
                          try {
                            await window.nodus.setBackupPassword(autoBackupPasswordInput);
                            setAutoBackupPasswordInput('');
                            setAutoBackupHasPassword(true);
                            flash(t('Contraseña maestra guardada. Descarga el kit: permite recuperar incluso si olvidas la contraseña.'));
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
            {activeVault?.type === 'estudio' && <StudyDataAdministration />}
          </Section>
      )}

      {visibleSettingsSection('models', 'Modelos de IA', 'basico avanzado modelo general extraccion sintesis tutor resumen fusion embeddings transcripcion voz imagen') && (<>
          <Section title={t('Modelos de IA')}>
            <p className="mb-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {t('Solo puede haber un modo de configuración activo. Cambiar de modo modifica qué selección de modelos utiliza Nodus, no solo la vista de este formulario.')}
            </p>
            <div className="mb-5 flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-950" data-testid="model-settings-mode">
              {(['basic', 'advanced'] as const).map((mode) => <button
                key={mode}
                className={`flex-1 rounded-md px-3 py-2 text-sm ${settings.modelSettingsMode === mode ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                aria-pressed={settings.modelSettingsMode === mode}
                onClick={() => {
                  if (settings.modelSettingsMode !== mode) setPendingModelSettingsMode(mode);
                }}
              >{t(mode === 'basic' ? 'Configuración básica' : 'Configuración avanzada')}</button>)}
            </div>
            <p className="mb-4 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              {settings.modelSettingsMode === 'basic'
                ? t('Un modelo general atiende conversación, análisis, resúmenes y las demás tareas de texto. Las capacidades especializadas se configuran debajo.')
                : t('Cada tarea utiliza el modelo concreto seleccionado. Los modelos de las herramientas se guardan solo en el vault actual.')}
            </p>
            {settings.modelSettingsMode === 'basic' && <Row label={t('Modelo general de texto')} hint={t('Conversación, análisis, resúmenes y demás tareas de texto.')}>
              <ModelPicker settings={settings} value={settings.synthesisModel} onChange={(m) => patch({ synthesisModel: m })} />
            </Row>}
            <Row label={t('Modelo de embeddings (similitud semántica multilingüe)')}>
              <EmbeddingModelControl
                settings={settings}
                onEmbeddingChange={(provider, model) => setPendingEmbeddingChange({ provider, model })}
              />
            </Row>
            <LocalAiModelsSettings
              settings={settings}
              patch={patch}
            />
            <SttSettings settings={settings} patch={patch} />
            {settings.modelSettingsMode === 'advanced' && <>
              <div className="mt-5 space-y-3 border-t border-neutral-800 pt-4" data-testid="common-model-overrides">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Ajustes avanzados comunes')}</h3>
                <Row label={t('Extracción de temas, ideas y evidencias')}><ModelPicker allowEmpty={false} settings={settings} value={settings.extractionModel} onChange={(extractionModel) => void patch({ extractionModel })} emptyLabel="Seleccionar modelo" /></Row>
                <Row label={t('Visión y OCR de imágenes')}><ModelPicker allowEmpty={false} settings={settings} value={settings.visionModel} onChange={(visionModel) => void patch({ visionModel })} emptyLabel="Seleccionar modelo" /></Row>
                <Row label={t('Resúmenes de obras')}><ModelPicker allowEmpty={false} settings={settings} value={settings.summaryModel} onChange={(summaryModel) => void patch({ summaryModel })} emptyLabel="Seleccionar modelo" /></Row>
                <Row label={t('Fusión y deduplicación')}><ModelPicker allowEmpty={false} settings={settings} value={settings.fusionModel} onChange={(fusionModel) => void patch({ fusionModel })} emptyLabel="Seleccionar modelo" /></Row>
                <Row label={t('Asistente Nodi')}><ModelPicker allowEmpty={false} settings={settings} value={settings.nodiModel} onChange={(nodiModel) => void patch({ nodiModel })} emptyLabel="Seleccionar modelo" /></Row>
              </div>
              <VaultModelOverrides settings={settings} vaultType={activeVault?.type ?? 'academic'} vaultName={activeVault?.name ?? t('Vault actual')} patch={patch} />
            </>}
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
          <ImageGenerationSettings settings={settings} onChange={onChange} />
          <AudioGenerationSettings settings={settings} onChange={onChange} />
      </>)}

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
            <h2 className="font-semibold mb-2">{t('Credenciales de recuperación de la copia')}</h2>
            <p className="text-sm text-neutral-400 mb-4">
              {t('Guarda ambas fuera de este dispositivo. Podrás importar la copia con cualquiera de ellas.')}
            </p>
            <div className="mb-1 text-xs font-medium text-neutral-400">{t('Contraseña')}</div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-sm break-all">
              {backupResult.password}
            </div>
            <div className="mb-1 mt-3 text-xs font-medium text-neutral-400">{t('Clave de recuperación')}</div>
            <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3 font-mono text-sm break-all text-emerald-300">
              {backupResult.recoveryKey}
            </div>
            <div className="mt-2 text-xs text-neutral-500 truncate">{backupResult.path}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setBackupResult(null)}>
                {t('Cerrar')}
              </button>
              <button className="btn btn-primary" onClick={() => void copyBackupPassword()}>
                <Icon name={backupCopied ? 'check' : 'copy'} /> {backupCopied ? t('Copiadas') : t('Copiar credenciales')}
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
              {t('Introduce la contraseña o la clave de recuperación. Después selecciona el archivo .nodus.')}
            </p>
            <div className="relative">
              <input
                className="input w-full pr-10"
                type={showImportPassword ? 'text' : 'password'}
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void importBackup();
                }}
                autoFocus
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-100" onClick={() => setShowImportPassword((value) => !value)} aria-label={t(showImportPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')} title={t(showImportPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}><Icon name={showImportPassword ? 'eyeOff' : 'eye'} size={17} /></button>
            </div>
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

      {pendingModelSettingsMode && (
        <ConfirmModal
          title={t(pendingModelSettingsMode === 'basic' ? '¿Cambiar a la configuración básica?' : '¿Cambiar a la configuración avanzada?')}
          message={pendingModelSettingsMode === 'basic' ? (
            <div data-testid="confirm-model-settings-mode" className="space-y-2">
              <p>{t('Solo un modo puede estar activo. El modelo general pasará a utilizarse en las tareas de texto y las selecciones avanzadas dejarán de aplicarse.')}</p>
              <p>{t('Después del cambio, revisa y completa «Modelo general de texto» antes de utilizar las funciones de IA. Una configuración incompleta puede hacer que esas funciones fallen.')}</p>
            </div>
          ) : (
            <div data-testid="confirm-model-settings-mode" className="space-y-2">
              <p>{t('Solo un modo puede estar activo. Cada tarea pasará a utilizar el modelo seleccionado en su propio campo en lugar de depender únicamente del modelo general.')}</p>
              <p>{t('Después del cambio, revisa y completa los modelos de «Ajustes avanzados comunes» y del vault actual. Una tarea sin un modelo válido puede fallar.')}</p>
            </div>
          )}
          confirmLabel={t(pendingModelSettingsMode === 'basic' ? 'Cambiar a configuración básica' : 'Cambiar a configuración avanzada')}
          onConfirm={() => {
            const mode = pendingModelSettingsMode;
            setPendingModelSettingsMode(null);
            void patch({ modelSettingsMode: mode });
          }}
          onCancel={() => setPendingModelSettingsMode(null)}
        />
      )}
      {pendingEmbeddingChange && (
        <ConfirmModal
          title={t('Cambiar modelo de embeddings')}
          message={t('Los embeddings creados con el modelo anterior no son compatibles con el nuevo. Nodus conservará los datos, pero tendrás que reindexar para que la búsqueda semántica y las relaciones usen el nuevo modelo. ¿Cambiar de todos modos?')}
          confirmLabel={t('Cambiar modelo')}
          onConfirm={() => {
            const next = pendingEmbeddingChange;
            setPendingEmbeddingChange(null);
            void patch({ embeddingProvider: next.provider, embeddingModel: next.model });
          }}
          onCancel={() => setPendingEmbeddingChange(null)}
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
  vaultType,
  onReorder,
  onToggleHidden,
}: {
  sidebarOrder: string[];
  sidebarHidden: string[];
  vaultType: VaultType | undefined;
  onReorder: (ids: string[]) => void;
  onToggleHidden: (hidden: string[]) => void;
}) {
  const orderedAll = orderedNav(sidebarOrder).filter(
    (n) => n.id !== 'home' && n.id !== 'settings' && isViewAllowedForVaultType(n.id, vaultType)
  );
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

type VaultModelKey = 'chatModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel' | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel';

const VAULT_MODEL_FIELDS: Record<VaultModelKey, string> = {
  chatModel: 'Chat con el corpus',
  deepResearchModel: 'Deep Research',
  immersionModel: 'Inmersión',
  writingModel: 'Taller de escritura',
  argumentMapModel: 'Mapa argumental',
  authorModel: 'Autores y biografías',
  studyModel: 'Guías de estudio',
  tutorModel: 'Tutor',
  hypothesisModel: 'Laboratorio de hipótesis',
};

function vaultModelKeys(type: VaultType): VaultModelKey[] {
  if (type === 'genealogy') return ['chatModel', 'deepResearchModel', 'authorModel'];
  if (type === 'databases') return ['chatModel'];
  if (type === 'estudio') return [];
  return Object.keys(VAULT_MODEL_FIELDS) as VaultModelKey[];
}

function VaultModelOverrides({ settings, vaultType, vaultName, patch }: {
  settings: AppSettings;
  vaultType: VaultType;
  vaultName: string;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const keys = vaultModelKeys(vaultType);
  return <div className="mt-5 border-t border-neutral-800 pt-4" data-testid="vault-model-overrides">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{tx('Ajustes avanzados del vault {vault}', { vault: vaultName })}</h3>
    <p className="mb-3 mt-1 text-xs text-neutral-600">{t('Estos cambios no modifican los demás vaults.')}</p>
    {vaultType === 'estudio' ? <StudyVaultModelOverrides settings={settings} patch={patch} /> : <div className="space-y-3">
      {keys.map((key) => <Row key={key} label={t(VAULT_MODEL_FIELDS[key])}>
        <ModelPicker allowEmpty={false} settings={settings} value={settings[key]} onChange={(model) => void patch({ [key]: model })} emptyLabel="Seleccionar modelo" />
      </Row>)}
    </div>}
  </div>;
}

const STUDY_VAULT_MODEL_FIELDS = [
  { task: 'chat', label: 'Chat con el corpus', key: 'chatModel' },
  { task: 'improve', label: 'Mejora de texto', key: 'improveModel' },
  { task: 'questions', label: 'Generación de preguntas', key: 'questionGenModel' },
  { task: 'grading', label: 'Corrección de exámenes', key: 'gradingModel' },
  { task: 'flashcards', label: 'Generación de flashcards', key: 'flashcardModel' },
] as const;

function StudyVaultModelOverrides({ settings, patch }: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  return <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(11rem,1fr)_minmax(11rem,1fr)] gap-x-4 gap-y-3 text-xs">
    <b className="text-neutral-600">{t('Tarea')}</b>
    <b className="text-neutral-600">{t('Principal')}</b>
    <b className="text-neutral-600">{t('Alternativo ante error')}</b>
    {STUDY_VAULT_MODEL_FIELDS.map((item) => <div key={item.task} className="contents">
      <span className="self-center text-neutral-300">{t(item.label)}</span>
      <ModelPicker compact allowEmpty={false} settings={settings} value={settings[item.key]} onChange={(model) => void patch({ [item.key]: model })} emptyLabel="Seleccionar modelo" />
      <ModelPicker compact settings={settings} value={settings.studyAiFallbackModels[item.task] ?? null} onChange={(model) => void patch({ studyAiFallbackModels: { ...settings.studyAiFallbackModels, [item.task]: model } })} emptyLabel="Sin modelo alternativo" />
    </div>)}
  </div>;
}

function formatDataBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function StudyDataAdministration() {
  const [overview, setOverview] = useState<StudyDataOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => setOverview(await window.nodus.getStudyDataOverview());
  useEffect(() => { void refresh(); }, []);
  const run = async (action: 'rebuild-indexes' | 'clear-embeddings' | 'empty-trash' | 'repair', destructive = false) => {
    if (destructive && !window.confirm(t('Esta acción elimina datos de forma permanente. ¿Quieres continuar?'))) return;
    setBusy(true); setMessage('');
    try { const result = await window.nodus.maintainStudyData(action); setMessage(result.message); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 border-t border-neutral-800 pt-4" data-testid="study-data-admin">
    <div className="flex flex-wrap items-start gap-3"><div className="mr-auto"><label className="text-sm">{t('Administración del vault de estudio')}</label><p className="mt-0.5 text-xs text-neutral-500">{t('Comprobaciones locales de SQLite, almacenamiento, índices, huérfanos y papelera.')}</p></div><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />{t('Comprobar')}</button></div>
    {overview && <><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[
      [t('Base del vault'), formatDataBytes(overview.databaseBytes)], [t('Materiales'), formatDataBytes(overview.materialBytes)],
      [t('Grabaciones'), formatDataBytes(overview.recordingBytes)], [t('Índices vectoriales'), formatDataBytes(overview.embeddingBytes)],
    ].map(([label, value]) => <div key={label} className="rounded-lg bg-neutral-900 p-3"><span className="block text-[10px] uppercase tracking-wider text-neutral-600">{label}</span><b className="mt-1 block text-sm text-neutral-300">{value}</b></div>)}</div>
      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${overview.integrityOk && overview.foreignKeyErrors.length === 0 ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300' : 'border-red-900/60 bg-red-950/20 text-red-300'}`}>
        {overview.integrityOk && overview.foreignKeyErrors.length === 0 ? t('Integridad correcta: sin referencias huérfanas.') : `${overview.integrityMessages.join('; ')} · ${overview.foreignKeyErrors.length} ${t('referencias huérfanas')}`} · schema v{overview.schemaVersion}/{overview.expectedSchemaVersion} · {overview.studyRows} {t('filas de estudio')} · {overview.trashRows} {t('en papelera')}
      </div></>}
    <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('repair')}><Icon name="settings" />{t('Verificar y optimizar')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('rebuild-indexes')}><Icon name="refresh" />{t('Reconstruir índices')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void run('clear-embeddings', true)}>{t('Limpiar índices vectoriales')}</button><button className="btn btn-ghost border border-red-900 text-red-400" disabled={busy || !overview?.trashRows} onClick={() => void run('empty-trash', true)}><Icon name="trash" />{t('Vaciar papelera')}</button><button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={async () => { const result = await window.nodus.exportStudyDiagnostic(); if (result) setMessage(result.path); }}><Icon name="download" />{t('Exportar diagnóstico')}</button></div>
    {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
  </div>;
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
  onEmbeddingChange,
}: {
  settings: AppSettings;
  onEmbeddingChange: (provider: EmbeddingProvider, model: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = settings.embeddingProvider ?? 'openai';
  const [modelInput, setModelInput] = useState(settings.embeddingModel);

  useEffect(() => setModelInput(settings.embeddingModel), [settings.embeddingModel]);

  const commitModelInput = () => {
    const model = modelInput.trim() || DEFAULT_EMBEDDING_MODELS[provider];
    setModelInput(model);
    if (model !== settings.embeddingModel) onEmbeddingChange(provider, model);
  };

  const setProvider = (next: EmbeddingProvider) => {
    setModels(null);
    setError(null);
    onEmbeddingChange(next, DEFAULT_EMBEDDING_MODELS[next]);
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
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onBlur={commitModelInput}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={DEFAULT_EMBEDDING_MODELS[provider]}
        />
        <button className="btn btn-ghost justify-center border border-neutral-700" onClick={loadModels} disabled={loading}>
          {loading ? t('Cargando…') : t('Cargar modelos')}
        </button>
      </div>
      {models && (
        <select
          className="input w-full"
          value={settings.embeddingModel}
          onChange={(e) => onEmbeddingChange(provider, e.target.value)}
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
      <p className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs leading-5 text-amber-200">
        {t('Si cambias de modelo de embeddings, los vectores anteriores no servirán con el nuevo modelo y tendrás que reindexar.')}
      </p>
    </div>
  );
}
