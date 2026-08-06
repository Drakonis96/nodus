import { Icon } from './ui';
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
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
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
          <section key={group.id} className="mt-2 flex flex-col gap-1">
            <h2 className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              {t(group.label)}
            </h2>
            {items.map((item) => (
              <button
                key={item.id}
                data-tour={`nav-${item.view}`}
                onClick={() => onNavigate(item.view)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  activeView === item.view
                    ? 'bg-blue-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`}
              >
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
