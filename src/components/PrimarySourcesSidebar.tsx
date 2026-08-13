import { Icon } from './ui';
import { t } from '../i18n';
import { orderSidebarItems, type View } from '../navigation';

export type PrimarySourcesView =
  | 'search'
  | 'archive'
  | 'persons'
  | 'timeline'
  | 'map'
  | 'relations'
  | 'notes';

export interface PrimarySourcesSidebarItem {
  id: PrimarySourcesView;
  label: string;
  icon: string;
  group: 'sources' | 'interpretation';
}

export const PRIMARY_SOURCES_SIDEBAR_ITEMS: PrimarySourcesSidebarItem[] = [
  { id: 'search', label: 'Buscar', icon: 'search', group: 'sources' },
  { id: 'archive', label: 'Archivo', icon: 'archive', group: 'sources' },
  { id: 'persons', label: 'Personas', icon: 'users', group: 'sources' },
  { id: 'timeline', label: 'Cronología', icon: 'clock', group: 'sources' },
  { id: 'map', label: 'Mapa', icon: 'map', group: 'sources' },
  { id: 'relations', label: 'Relaciones', icon: 'network', group: 'sources' },
  { id: 'notes', label: 'Notas', icon: 'notebook', group: 'interpretation' },
];

const GROUPS = [
  { id: 'sources', label: 'Investigar fuentes' },
  { id: 'interpretation', label: 'Interpretar' },
] as const;

export function PrimarySourcesSidebar({
  compact = false,
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  compact?: boolean;
  activeView: View;
  onNavigate: (view: PrimarySourcesView) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  const ordered = orderSidebarItems(PRIMARY_SOURCES_SIDEBAR_ITEMS, sidebarOrder)
    .filter((item) => !sidebarHidden.includes(item.id));

  return (
    <div data-testid="primary-sources-sidebar" className="flex flex-col gap-1">
      {GROUPS.map((group) => {
        const items = ordered.filter((item) => item.group === group.id);
        if (!items.length) return null;
        return (
          <section key={group.id} className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`} aria-labelledby={`primary-sources-group-${group.id}`}>
            <h2 id={`primary-sources-group-${group.id}`} className={compact ? 'sr-only' : 'px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600'}>
              {t(group.label)}
            </h2>
            {items.map((item) => (
              <button
                key={item.id}
                data-tour={`nav-${item.id}`}
                data-testid={`primary-sources-nav-${item.id}`}
                onClick={() => onNavigate(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
                aria-label={compact ? t(item.label) : undefined}
                title={compact ? t(item.label) : undefined}
                className={`flex items-center rounded-lg py-2 text-left text-sm transition-colors ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${
                  activeView === item.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`}
              >
                <Icon name={item.icon} className="shrink-0" />
                <span className={compact ? 'sr-only' : undefined}>{t(item.label)}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
