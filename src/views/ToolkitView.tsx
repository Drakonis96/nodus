// Nodus Toolkit — el hub de Herramientas: utilidades locales de proceso de
// archivos (conversión, presentación de PDFs, OCR asistido). La navegación
// interna (hub ↔ herramienta) vive aquí y no añade ids a la union View: el
// sidebar tiene una única entrada y cada herramienta se abre desde sus
// tarjetas, con un botón para volver al hub.
import { useState } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';

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

/** Cabecera de una herramienta: volver al hub + identidad de la herramienta. */
function ToolHeader({ icon, name, subtitle, onBack }: { icon: string; name: string; subtitle: string; onBack: () => void }) {
  return (
    <header className="flex items-center gap-3">
      <button
        data-testid="toolkit-back"
        className="btn btn-ghost h-9 min-h-9 justify-center px-2.5 py-0 leading-none"
        onClick={onBack}
        title={t('Volver a Herramientas')}
        aria-label={t('Volver a Herramientas')}
      >
        <Icon name="chevronLeft" className="shrink-0" />
      </button>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{name}</h1>
        <p className="text-sm text-neutral-500">{subtitle}</p>
      </div>
    </header>
  );
}

function ConvertPage({ onBack }: { onBack: () => void }) {
  // Categorías previstas del conversor; se muestran como avance honesto de lo
  // que llegará por fases (ver design/nodus-toolkit-plan.md, F2–F6).
  const upcoming: Array<{ icon: string; label: string }> = [
    { icon: 'copy', label: t('Utilidades PDF: unir, dividir, rotar, extraer páginas e imágenes, metadatos') },
    { icon: 'book', label: t('Documentos: PDF, DOCX, EPUB, Markdown, HTML y texto') },
    { icon: 'scanText', label: t('OCR ligero local, con PDF buscable a partir de escaneados') },
    { icon: 'image', label: t('Imágenes: convertir formato (incluido HEIC), redimensionar y comprimir en lote') },
    { icon: 'edit', label: t('Texto: limpiar texto pegado de PDF, mayúsculas, subtítulos y checksums') },
  ];
  return (
    <div data-testid="toolkit-convert-page" className="mx-auto max-w-3xl space-y-6">
      <ToolHeader
        icon="swap"
        name="Nodus Convert"
        subtitle={t('Convierte documentos, PDF e imágenes, con OCR ligero y utilidades de texto, de uno en uno o en lote.')}
        onBack={onBack}
      />
      <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('El conversor está en construcción.')}</p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {t('Todo se procesará en tu equipo, sin subir nada a ningún servicio, y nunca se modificará el archivo original.')}
        </p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {upcoming.map((item) => (
            <li key={item.icon} className="flex items-start gap-2.5 text-sm text-neutral-600 dark:text-neutral-300">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Icon name={item.icon} size={13} />
              </span>
              <span className="leading-relaxed">{item.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
        <ConvertPage onBack={() => setPage('home')} />
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
