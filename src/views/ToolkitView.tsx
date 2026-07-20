// Nodus Toolkit — el hub de Herramientas: utilidades locales de proceso de
// archivos (conversión, protección, presentación de PDFs y OCR asistido). La navegación
// interna (catálogo ↔ herramienta) no añade ids a la union View: el sidebar
// tiene una única entrada de sección con las herramientas anidadas debajo, y la
// página activa la controla App (así el estado sobrevive a salir de la sección).
import type { AppSettings } from '@shared/types';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { TOOLKIT_TOOLS, type ToolkitPage } from '../navigation';
import { ToolkitConvertView } from './ToolkitConvertView';
import { ToolkitProtectView } from './ToolkitProtectView';
import { ToolkitAiOcrView } from './ToolkitAiOcrView';

interface ToolCardProps {
  testid: string;
  icon: string;
  /** Nombre de marca de la herramienta; no se traduce. */
  name: string;
  description: string;
  /** 'wip' = navegable pero en construcción; 'soon' = tarjeta deshabilitada. */
  state: 'wip' | 'soon';
  onOpen?: () => void;
}

/** Tarjeta del hub. Las cuatro se renderizan con la MISMA estructura y altura
 *  (grid + h-full); el icono va en una loseta cuadrada fija para que quede
 *  perfectamente centrado, y el badge se ancla abajo con mt-auto para que el
 *  texto variable no desalinee las tarjetas entre sí. */
function ToolCard({ testid, icon, name, description, state, onOpen }: ToolCardProps) {
  const disabled = state === 'soon';
  return (
    <button
      data-testid={testid}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? t('Próximamente') : undefined}
      onClick={disabled ? undefined : onOpen}
      className={`flex h-full flex-col items-start gap-3 rounded-xl border p-5 text-left transition-colors ${
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
      <span
        className={`mt-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
          disabled
            ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
        }`}
      >
        {disabled ? t('Próximamente') : t('En desarrollo')}
      </span>
    </button>
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
  return (
    <div className="h-full overflow-y-auto px-6 py-6 max-md:px-4">
      {/* Convert, Protect y AI OCR tienen página propia; PDF Presenter sigue
          deshabilitado en el catálogo y en el sidebar, así que cualquier otra
          página cae en el catálogo en lugar de dejar el panel en blanco. */}
      {page === 'convert' ? (
        <ToolkitConvertView onBack={() => onNavigate('home')} />
      ) : page === 'protect' ? (
        <ToolkitProtectView onBack={() => onNavigate('home')} />
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
          <div className="grid gap-4 sm:grid-cols-2">
            {TOOLKIT_TOOLS.map((tool) => (
              <ToolCard
                key={tool.page}
                testid={`toolkit-card-${tool.testid}`}
                icon={tool.icon}
                name={tool.name}
                description={t(tool.description)}
                state={tool.state}
                onOpen={() => onNavigate(tool.page)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
