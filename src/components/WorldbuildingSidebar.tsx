import { Icon } from './ui';
import { t } from '../i18n';
import { orderSidebarItems } from '../navigation';

/** Views the worldbuilding vault has already wired up. */
export type WorldbuildingView = 'encyclopedia' | 'continuity' | 'conflicts' | 'arcs' | 'rules' | 'questions' | 'worldChat' | 'manuscript' | 'characters' | 'places' | 'factions' | 'cultures' | 'dynasties' | 'scenes' | 'timeline' | 'tree' | 'map' | 'relations' | 'notes';

export interface WorldbuildingItem { label: string; icon: string; view: WorldbuildingView }
export interface WorldbuildingGroup { id: string; label: string; items: WorldbuildingItem[] }

/**
 * The world-builder's workspace. Every announced item now navigates to a real view.
 *
 * Cronología, Mapa, Relaciones and Familias are the records views reused as they are:
 * they work on `persons`, `events` and `relationships`, which this vault fills with
 * characters. Only the timeline needed adapting — it orders by the in-world year, since
 * an invented calendar leaves the Earth sort key empty.
 *
 * Its data is exported because Settings renders this same grouping when users reorder
 * or hide sections; keeping one list prevents the configurator and sidebar drifting.
 */
export const WORLDBUILDING_GROUPS: WorldbuildingGroup[] = [
  { id: 'explore', label: 'Explorar', items: [
    { label: 'Enciclopedia', icon: 'book', view: 'encyclopedia' },
    { label: 'Personajes', icon: 'users', view: 'characters' },
    { label: 'Lugares', icon: 'map', view: 'places' },
    { label: 'Facciones', icon: 'network', view: 'factions' },
    { label: 'Culturas', icon: 'languages', view: 'cultures' },
    { label: 'Cronología', icon: 'clock', view: 'timeline' },
    { label: 'Mapa', icon: 'map', view: 'map' },
    { label: 'Relaciones', icon: 'network', view: 'relations' },
    { label: 'Familias', icon: 'tree', view: 'tree' },
    { label: 'Dinastías', icon: 'shield', view: 'dynasties' },
  ] },
  { id: 'analyze', label: 'Analizar', items: [
    { label: 'Chat del mundo', icon: 'chat', view: 'worldChat' },
    { label: 'Reglas del mundo', icon: 'lock', view: 'rules' },
    { label: 'Conflictos', icon: 'scale', view: 'conflicts' },
    { label: 'Arcos narrativos', icon: 'route', view: 'arcs' },
    { label: 'Continuidad', icon: 'check', view: 'continuity' },
    { label: 'Preguntas abiertas', icon: 'help', view: 'questions' },
  ] },
  { id: 'create', label: 'Crear', items: [
    { label: 'Notas', icon: 'notebook', view: 'notes' },
    { label: 'Escenas', icon: 'image', view: 'scenes' },
    { label: 'Manuscrito', icon: 'edit', view: 'manuscript' },
  ] },
];

export function WorldbuildingSidebar({
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  activeView: string;
  onNavigate: (view: WorldbuildingView) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  return (
    <div data-testid="worldbuilding-sidebar" className="flex flex-col gap-1">
      {WORLDBUILDING_GROUPS.map((group) => {
        const items = orderSidebarItems(
          group.items.map((item) => ({ ...item, id: item.view })),
          sidebarOrder,
        )
          .filter((item) => !sidebarHidden.includes(item.id));
        if (items.length === 0) return null;
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
                    ? 'bg-indigo-600 text-white'
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
