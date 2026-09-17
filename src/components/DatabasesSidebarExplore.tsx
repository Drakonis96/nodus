import { Icon } from './ui';
import { t } from '../i18n';
import type { DatabaseSummary } from '@shared/types';

/**
 * The database list in the Explore section of the databases sidebar. Height-capped and
 * scrollable so a long list doesn't push the other groups off-screen. Searching lives
 * in the dedicated "Buscar" section (its own view), not here.
 */
export function DatabasesSidebarExplore({
  compact = false,
  databases,
  activeId,
  isActiveView,
  onOpen,
}: {
  compact?: boolean;
  databases: DatabaseSummary[];
  activeId: string | null;
  isActiveView: boolean;
  onOpen: (id: string) => void;
}) {
  if (databases.length === 0) {
    return compact ? null : <p className="px-3 py-1 text-xs text-neutral-600">{t('Aún no hay bases de datos.')}</p>;
  }
  return (
    <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-0.5">
      {databases.map((db) => (
        <button
          key={db.id}
          onClick={() => onOpen(db.id)}
          aria-label={compact ? db.name : undefined}
          title={compact ? db.name : undefined}
          className={`flex items-center rounded-lg py-2 text-left text-sm transition-colors ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${
            isActiveView && activeId === db.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'
          }`}
        >
          <Icon name={db.icon || 'table'} className="shrink-0 opacity-70" />
          <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{db.name}</span>
        </button>
      ))}
    </div>
  );
}
