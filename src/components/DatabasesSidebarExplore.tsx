import { Icon } from './ui';
import { t } from '../i18n';
import type { DatabaseSummary } from '@shared/types';

/**
 * The database list in the Explore section of the databases sidebar. Height-capped and
 * scrollable so a long list doesn't push the other groups off-screen. Searching lives
 * in the dedicated "Buscar" section (its own view), not here.
 */
export function DatabasesSidebarExplore({
  databases,
  activeId,
  isActiveView,
  onOpen,
}: {
  databases: DatabaseSummary[];
  activeId: string | null;
  isActiveView: boolean;
  onOpen: (id: string) => void;
}) {
  if (databases.length === 0) {
    return <p className="px-3 py-1 text-xs text-neutral-600">{t('Aún no hay bases de datos.')}</p>;
  }
  return (
    <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-0.5">
      {databases.map((db) => (
        <button
          key={db.id}
          onClick={() => onOpen(db.id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            isActiveView && activeId === db.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'
          }`}
        >
          <Icon name={db.icon || 'table'} className="shrink-0 opacity-70" />
          <span className="flex-1 truncate">{db.name}</span>
        </button>
      ))}
    </div>
  );
}
