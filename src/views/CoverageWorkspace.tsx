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
    <div className="h-full flex flex-col min-h-0">
      <nav
        className="shrink-0 flex border-b border-neutral-800 px-3"
        role="tablist"
        aria-label={t('Estado de la cuestión')}
      >
        {TABS.map(([value, label, icon], index) => (
          <button
            key={value}
            id={`coverage-tab-${value}`}
            role="tab"
            data-testid={`coverage-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="coverage-tabpanel"
            tabIndex={tab === value ? 0 : -1}
            // border-current sigue al color del texto, que sí tiene remap en modo
            // claro; una tinta indigo fija en el borde se quedaría sin traducir.
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium ${
              tab === value
                ? 'border-current text-indigo-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-200'
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
