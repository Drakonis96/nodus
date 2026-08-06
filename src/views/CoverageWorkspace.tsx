// Cobertura y Huecos responden la misma pregunta —¿qué le falta a mi corpus?— desde
// los dos extremos: el mapa de cobertura mide la biblioteca contra la pregunta que
// escribe el investigador, y los huecos son lo que las propias obras declaran que
// queda pendiente. Sueltos en el menú parecían alternativas; aquí son dos pestañas
// del mismo sitio.
//
// Los dos hijos se montan tal cual, cada uno con su encabezado: la pestaña dice en
// qué sección estás y el encabezado explica qué hace. Solo vive una a la vez, así
// que cambiar de pestaña no paga el coste de la otra.
import { useState } from 'react';
import { Icon } from '../components/ui';
import type {
  PendingAssistantNavigationTarget,
  PendingGraphNavigationTarget,
} from '../navigation';
import { t } from '../i18n';
import { GapsView } from './GapsView';
import { ResearchMapView } from './ResearchMapView';

export type CoverageTab = 'map' | 'gaps';

const TABS: readonly (readonly [CoverageTab, string, string])[] = [
  ['map', 'Cobertura', 'compass'],
  ['gaps', 'Huecos', 'gap'],
] as const;

export function CoverageWorkspace({
  vaultId,
  initialTab,
  onOpenGraph,
  onOpenAssistant,
  onOpenDebates,
}: {
  vaultId: string | null;
  /** Qué pestaña abre. Navegar a 'gaps' entra directamente por los huecos. */
  initialTab: CoverageTab;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenDebates: () => void;
}) {
  const [tab, setTab] = useState<CoverageTab>(initialTab);

  return (
    <div className="h-full flex flex-col min-h-0">
      <nav
        className="shrink-0 flex border-b border-neutral-800 px-3"
        role="tablist"
        aria-label={t('Cobertura y huecos')}
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
        {tab === 'map' ? (
          <ResearchMapView
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenDebates={onOpenDebates}
          />
        ) : (
          <GapsView
            vaultId={vaultId}
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenDebates={onOpenDebates}
          />
        )}
      </div>
    </div>
  );
}
