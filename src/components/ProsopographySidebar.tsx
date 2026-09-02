import { Icon } from './ui';
import { Tooltip } from './Tooltip';
import { t } from '../i18n';
import { orderSidebarItems, type View } from '../navigation';

export type ProsopographyView =
  | 'prosopSearch'
  | 'prosopPopulation'
  | 'prosopPersons'
  | 'prosopSources'
  | 'prosopAnalysis'
  | 'prosopNetworks'
  | 'notes';

interface ProsopographyItem { label: string; icon: string; view: ProsopographyView }
interface ProsopographyGroup { id: string; label: string; items: ProsopographyItem[] }

export const PROSOPOGRAPHY_GROUPS: ProsopographyGroup[] = [
  { id: 'explore', label: 'Explorar', items: [
    { label: 'Buscar', icon: 'search', view: 'prosopSearch' },
    { label: 'Población', icon: 'users', view: 'prosopPopulation' },
    { label: 'Personas', icon: 'user', view: 'prosopPersons' },
    { label: 'Fuentes', icon: 'archive', view: 'prosopSources' },
  ] },
  { id: 'analyze', label: 'Analizar', items: [
    { label: 'Análisis', icon: 'chartBar', view: 'prosopAnalysis' },
    { label: 'Redes', icon: 'network', view: 'prosopNetworks' },
  ] },
  { id: 'create', label: 'Registrar', items: [
    { label: 'Notas', icon: 'notebook', view: 'notes' },
  ] },
];

export function ProsopographySidebar({
  compact = false,
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  compact?: boolean;
  activeView: View;
  onNavigate: (view: ProsopographyView) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  return (
    <div data-testid="prosopography-sidebar" className="flex flex-col gap-1">
      {PROSOPOGRAPHY_GROUPS.map((group) => {
        const items = orderSidebarItems(
          group.items.map((item) => ({ ...item, id: item.view })),
          sidebarOrder,
        ).filter((item) => !sidebarHidden.includes(item.id));
        if (!items.length) return null;
        return (
          <section key={group.id} className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
            <h2 className={compact ? 'sr-only' : 'px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600'}>
              {t(group.label)}
            </h2>
            {items.map((item) => {
              const button = (
                <button
                  key={item.id}
                  data-tour={`nav-${item.view}`}
                  onClick={() => onNavigate(item.view)}
                  aria-label={compact ? t(item.label) : undefined}
                  className={`flex items-center rounded-lg py-2 text-left text-sm ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${
                    activeView === item.view
                      ? 'bg-blue-600 text-white'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={item.icon} className="shrink-0" />
                  <span className={compact ? 'sr-only' : undefined}>{t(item.label)}</span>
                </button>
              );
              if (!compact) return button;
              return <Tooltip key={item.id} label={t(item.label)} placement="right">{button}</Tooltip>;
            })}
          </section>
        );
      })}
    </div>
  );
}
