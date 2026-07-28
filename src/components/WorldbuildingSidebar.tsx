import { Icon } from './ui';
import { t } from '../i18n';

/** Views the worldbuilding vault has already wired up. */
export type WorldbuildingView = 'encyclopedia' | 'continuity' | 'conflicts' | 'arcs' | 'rules' | 'questions' | 'worldChat' | 'manuscript' | 'characters' | 'places' | 'factions' | 'cultures' | 'dynasties' | 'scenes' | 'timeline' | 'tree' | 'map' | 'relations' | 'notes';

interface WorldbuildingItem { label: string; icon: string; view?: WorldbuildingView }
interface WorldbuildingGroup { label: string; items: WorldbuildingItem[] }

/**
 * The world-builder's workspace. Items with a `view` navigate; the rest are the
 * sections this vault has been announced with and are rendered disabled, so the shape
 * of the finished product stays visible while it is being built one section at a time.
 *
 * Cronología, Mapa, Relaciones and Familias are the records views reused as they are:
 * they work on `persons`, `events` and `relationships`, which this vault fills with
 * characters. Only the timeline needed adapting — it orders by the in-world year, since
 * an invented calendar leaves the Earth sort key empty.
 *
 * Unlike the teaching sidebar, the unbuilt items do NOT open a feedback thread: there
 * are eighteen of them, and eighteen permanent GitHub issues is a heavier promise than
 * the roadmap needs right now. Promoting one to a thread later is a one-line change
 * (give it a `topic` and reuse ROADMAP_THREADS).
 */
export const WORLDBUILDING_GROUPS: WorldbuildingGroup[] = [
  { label: 'Explorar', items: [
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
  { label: 'Analizar', items: [
    { label: 'Chat del mundo', icon: 'chat', view: 'worldChat' },
    { label: 'Reglas del mundo', icon: 'lock', view: 'rules' },
    { label: 'Conflictos', icon: 'scale', view: 'conflicts' },
    { label: 'Arcos narrativos', icon: 'route', view: 'arcs' },
    { label: 'Continuidad', icon: 'check', view: 'continuity' },
    { label: 'Preguntas abiertas', icon: 'help', view: 'questions' },
  ] },
  { label: 'Crear', items: [
    { label: 'Notas', icon: 'notebook', view: 'notes' },
    { label: 'Escenas', icon: 'image', view: 'scenes' },
    { label: 'Manuscrito', icon: 'edit', view: 'manuscript' },
  ] },
];

export function WorldbuildingSidebar({
  activeView,
  onNavigate,
}: {
  activeView: string;
  onNavigate: (view: WorldbuildingView) => void;
}) {
  return (
    <div data-testid="worldbuilding-sidebar" className="flex flex-col gap-1">
      {WORLDBUILDING_GROUPS.map((group) => (
        <section key={group.label} className="mt-2 flex flex-col gap-1">
          <h2 className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            {t(group.label)}
          </h2>
          {group.items.map((item) => item.view ? (
            <button
              key={item.label}
              data-tour={`nav-${item.view}`}
              onClick={() => onNavigate(item.view!)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                activeView === item.view
                  ? 'bg-indigo-600 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
            </button>
          ) : (
            <button
              key={item.label}
              type="button"
              disabled
              aria-disabled="true"
              title={t('Disponible próximamente')}
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-600 opacity-70"
            >
              <Icon name={item.icon} className="opacity-70" />
              {t(item.label)}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
