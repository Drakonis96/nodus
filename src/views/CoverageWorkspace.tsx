// El estado de la cuestión: qué se ha dicho ya sobre el tema, dónde se contradice y
// qué queda por decir. Tres lecturas de la misma pregunta, y por eso tres pestañas del
// mismo sitio en vez de tres secciones del menú:
//
//   · Cobertura mide la biblioteca contra la pregunta que escribe el investigador;
//   · Debates enfrenta las contradicciones que el corpus ya contiene;
//   · Huecos recoge lo que las propias obras declaran que queda pendiente.
//
// Sueltas en el menú parecían alternativas entre las que elegir. Juntas son el recorrido
// que se hace de una sentada: leo qué cubro, veo dónde se pelean mis fuentes, y salgo con
// la lista de lo que falta. Los saltos que antes llevaban de Cobertura o de Huecos a la
// sección de Debates son ahora un cambio de pestaña, sin perder el sitio.
//
// Los tres hijos se montan tal cual, cada uno con su encabezado: la pestaña dice en qué
// parte estás y el encabezado explica qué hace. Solo vive una a la vez, así que cambiar
// de pestaña no paga el coste de las otras.
import { useState } from 'react';
import { Icon } from '../components/ui';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
} from '../navigation';
import { t } from '../i18n';
import { DebateView } from './DebateView';
import { GapsView } from './GapsView';
import { ResearchMapView } from './ResearchMapView';

export type CoverageTab = 'map' | 'debate' | 'gaps';

const TABS: readonly (readonly [CoverageTab, string, string])[] = [
  ['map', 'Cobertura', 'help'],
  ['debate', 'Debates', 'scale'],
  ['gaps', 'Huecos', 'gap'],
] as const;

export function CoverageWorkspace({
  vaultId,
  initialTab,
  onOpenGraph,
  onOpenAssistant,
}: {
  vaultId: string | null;
  /** Qué pestaña abre. Navegar a 'gaps' o a 'debate' entra directamente por la suya. */
  initialTab: CoverageTab;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [tab, setTab] = useState<CoverageTab>(initialTab);
  const openDebates = () => setTab('debate');

  return (
    <div data-testid="coverage-workspace" className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="compass" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t('Estado de la cuestión')}</h1>
            <p className="text-[11px] text-neutral-500">{t('Cobertura')} · {t('Debates')} · {t('Huecos')}</p>
          </div>
        </div>

        <nav data-testid="coverage-tabs" className="flex min-w-0 items-end gap-1 overflow-x-auto" role="tablist" aria-label={t('Estado de la cuestión')}>
          {TABS.map(([value, label, icon], index) => (
            <button
              key={value}
              id={`coverage-tab-${value}`}
              role="tab"
              data-testid={`coverage-tab-${value}`}
              aria-selected={tab === value}
              aria-controls="coverage-tabpanel"
              tabIndex={tab === value ? 0 : -1}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${
                tab === value
                  ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
                  : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'
              }`}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = (index + delta + TABS.length) % TABS.length;
                setTab(TABS[next][0]);
                const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[next]?.focus();
              }}
            >
              <Icon name={icon} size={13} /> {t(label)}
            </button>
          ))}
        </nav>
      </header>

      <div
        id="coverage-tabpanel"
        role="tabpanel"
        aria-labelledby={`coverage-tab-${tab}`}
        className="flex-1 min-h-0"
      >
        {tab === 'map' && (
          <ResearchMapView
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenDebates={openDebates}
          />
        )}
        {tab === 'debate' && (
          <DebateView onOpenGraph={onOpenGraph} onOpenAssistant={onOpenAssistant} />
        )}
        {tab === 'gaps' && (
          <GapsView
            vaultId={vaultId}
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenDebates={openDebates}
          />
        )}
      </div>
    </div>
  );
}
