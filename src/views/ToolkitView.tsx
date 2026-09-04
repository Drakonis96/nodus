// Nodus Toolkit — el hub de Herramientas: utilidades locales de proceso de
// archivos (conversión, protección, presentación de PDFs y OCR asistido). La navegación
// interna (catálogo ↔ herramienta) no añade ids a la union View: los accesos
// fijados del sidebar apuntan a estas páginas anidadas, y la página activa la
// controla App (así el estado sobrevive a salir de la sección).
import { useState } from 'react';
import type { AppSettings } from '@shared/types';
import { normalizeToolkitToolPages, type ToolkitToolPage } from '@shared/toolkitNavigation';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { TOOLKIT_TOOLS, toolkitSidebarId, type ToolkitPage } from '../navigation';
import { ToolkitConvertView } from './ToolkitConvertView';
import { ToolkitProtectView } from './ToolkitProtectView';
import { ToolkitPresenterView } from './ToolkitPresenterView';
import { ToolkitAiOcrView } from './ToolkitAiOcrView';
import { ToolkitAppsView } from './ToolkitAppsView';
import { ToolkitTranslateView } from './ToolkitTranslateView';

interface ToolCardProps {
  testid: string;
  icon: string;
  /** Nombre de marca de la herramienta; no se traduce. */
  name: string;
  description: string;
  /** 'wip' = navegable pero en construcción; 'soon' = tarjeta deshabilitada. */
  state: 'wip' | 'soon';
  pinned: boolean;
  pinBusy: boolean;
  onOpen?: () => void;
  onTogglePinned: () => void;
}

/** Tarjeta del hub. Todas se renderizan con la MISMA estructura y altura
 *  (grid + h-full); el icono va en una loseta cuadrada fija para que quede
 *  perfectamente centrado. Solo las herramientas aún no disponibles muestran
 *  estado: las aplicaciones navegables no necesitan una etiqueta de desarrollo. */
function ToolCard({ testid, icon, name, description, state, pinned, pinBusy, onOpen, onTogglePinned }: ToolCardProps) {
  const disabled = state === 'soon';
  return (
    <div className="relative h-full">
      <button
        data-testid={testid}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? t('Próximamente') : undefined}
        onClick={disabled ? undefined : onOpen}
        className={`flex h-full w-full flex-col items-start gap-3 rounded-xl border p-5 pr-16 text-left transition-colors ${
          disabled
            ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60 dark:border-neutral-800 dark:bg-neutral-900/20'
            : 'border-neutral-200 bg-white hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-amber-500/60'
        }`}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name={icon} size={22} />
        </span>
        <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{name}</span>
        <span className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</span>
        {disabled && (
          <span className="mt-auto inline-flex items-center gap-1 rounded-md bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {t('Próximamente')}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid={`${testid}-pin`}
        aria-pressed={pinned}
        aria-label={`${name} · ${t(pinned ? 'Desfijar' : 'Fijar')}`}
        title={t(pinned ? 'Desfijar' : 'Fijar')}
        disabled={disabled || pinBusy}
        onClick={onTogglePinned}
        className={`absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait disabled:opacity-50 ${
          pinned
            ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300'
            : 'border-neutral-200 bg-white/90 text-neutral-400 hover:border-amber-300 hover:text-amber-600 dark:border-neutral-700 dark:bg-neutral-900/90 dark:hover:border-amber-500/50 dark:hover:text-amber-300'
        }`}
      >
        <Icon name="pin" size={17} />
      </button>
    </div>
  );
}

export function ToolkitView({
  page,
  onNavigate,
  settings,
}: {
  page: ToolkitPage;
  onNavigate: (page: ToolkitPage) => void;
  settings: AppSettings | null;
}) {
  const [pinBusy, setPinBusy] = useState<ToolkitToolPage | null>(null);
  const pinnedPages = normalizeToolkitToolPages(settings?.toolkitPinnedPages);
  const pinned = new Set(pinnedPages);

  const togglePinned = async (toolPage: ToolkitToolPage) => {
    if (!settings || pinBusy) return;
    setPinBusy(toolPage);
    const id = toolkitSidebarId(toolPage);
    const isPinned = pinned.has(toolPage);
    try {
      await window.nodus.updateSettings({
        toolkitPinnedPages: isPinned
          ? pinnedPages.filter((pageId) => pageId !== toolPage)
          : [...pinnedPages, toolPage],
        // A fresh pin must be visible. Unpinning also retires its ordering and
        // visibility residue so pinning it again starts beside Nodus Tools.
        sidebarHidden: settings.sidebarHidden.filter((itemId) => itemId !== id),
        sidebarOrder: isPinned
          ? settings.sidebarOrder.filter((itemId) => itemId !== id)
          : settings.sidebarOrder,
      });
    } catch (error) {
      console.error('[toolkit] no se pudo actualizar la chincheta', error);
    } finally {
      setPinBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6 max-md:px-4">
      {/* Las herramientas tienen página propia; cualquier otra página
          cae en el catálogo en lugar de dejar el panel en blanco. */}
      {page === 'convert' ? (
        <ToolkitConvertView onBack={() => onNavigate('home')} />
      ) : page === 'apps' ? (
        <ToolkitAppsView onBack={() => onNavigate('home')} settings={settings} />
      ) : page === 'translate' ? (
        <ToolkitTranslateView onBack={() => onNavigate('home')} settings={settings} />
      ) : page === 'protect' ? (
        <ToolkitProtectView onBack={() => onNavigate('home')} />
      ) : page === 'presenter' ? (
        <ToolkitPresenterView onBack={() => onNavigate('home')} />
      ) : page === 'ocr' ? (
        <ToolkitAiOcrView onBack={() => onNavigate('home')} settings={settings} />
      ) : (
        <div data-testid="toolkit-home" className="mx-auto max-w-5xl space-y-6">
          <header className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Icon name="tools" size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('Herramientas')}</h1>
              <p className="text-sm text-neutral-500">
                {t('Utilidades locales para investigación, docencia y estudio: convierte y procesa archivos sin salir de Nodus.')}
              </p>
            </div>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 auto-rows-fr">
            {TOOLKIT_TOOLS.map((tool) => (
              <ToolCard
                key={tool.page}
                testid={`toolkit-card-${tool.testid}`}
                icon={tool.icon}
                name={tool.name}
                description={t(tool.description)}
                state={tool.state}
                pinned={pinned.has(tool.page)}
                pinBusy={pinBusy === tool.page}
                onOpen={() => onNavigate(tool.page)}
                onTogglePinned={() => void togglePinned(tool.page)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
