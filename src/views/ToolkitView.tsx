// Nodus Toolkit — el hub de Herramientas: utilidades locales de proceso de
// archivos (conversión, presentación de PDFs, OCR asistido). La navegación
// interna (hub ↔ herramienta) vive aquí y no añade ids a la union View: el
// sidebar tiene una única entrada y cada herramienta se abre desde sus
// tarjetas, con un botón para volver al hub.
import { useState } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { ToolkitConvertView } from './ToolkitConvertView';

type ToolkitPage = 'home' | 'convert';

// Se recuerda la última página a nivel de módulo para que salir de la sección
// y volver no pierda el sitio (mismo patrón que otras vistas con sub-estado).
let lastToolkitPage: ToolkitPage = 'home';

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

/** Tarjeta del hub. Las tres se renderizan con la MISMA estructura y altura
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

export function ToolkitView() {
  const [page, setPageState] = useState<ToolkitPage>(lastToolkitPage);
  const setPage = (next: ToolkitPage) => {
    lastToolkitPage = next;
    setPageState(next);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6 max-md:px-4">
      {page === 'convert' ? (
        <ToolkitConvertView onBack={() => setPage('home')} />
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ToolCard
              testid="toolkit-card-convert"
              icon="swap"
              name="Nodus Convert"
              description={t('Convierte documentos, PDF e imágenes, con OCR ligero y utilidades de texto, de uno en uno o en lote.')}
              state="wip"
              onOpen={() => setPage('convert')}
            />
            <ToolCard
              testid="toolkit-card-presenter"
              icon="presentation"
              name="PDF Presenter"
              description={t('Presenta PDFs como diapositivas, con vista del presentador, notas del orador y anotaciones en directo.')}
              state="soon"
            />
            <ToolCard
              testid="toolkit-card-aiocr"
              icon="scanText"
              name="OCR Workspace"
              description={t('OCR asistido por IA para escaneados difíciles, con revisión página a página e integración con tus bóvedas.')}
              state="soon"
            />
          </div>
        </div>
      )}
    </div>
  );
}
