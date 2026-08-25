import { Icon } from '../ui';
import { compassT } from '../../i18n.compass';
import type { CompassSession as CompassHistoryEntry } from './types';
import type { CompassResult } from './types';

export function CompassHistoryPanel({ entries, saved, onSelect, onSavedSelect, onDelete, onClear }: { entries: CompassHistoryEntry[]; saved: CompassResult[]; onSelect: (entry: CompassHistoryEntry) => void; onSavedSelect: (entry: CompassResult) => void; onDelete: (id: string) => void; onClear: () => void }) {
  return <aside className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/60" aria-label={compassT('Historial')}>
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{compassT('Historial')}</h2>{entries.length > 0 && <button type="button" className="text-[11px] text-neutral-500 hover:text-red-600" onClick={onClear}>{compassT('Borrar historial')}</button>}</div>
    {entries.length === 0 ? <p className="text-xs text-neutral-500">{compassT('No hay búsquedas todavía.')}</p> : <ul className="space-y-1">{entries.slice(0, 12).map((entry) => <li key={entry.searchId} className="group flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={() => onSelect(entry)}>{entry.query}</button><button type="button" className="hidden h-6 w-6 group-hover:grid place-items-center text-neutral-400 hover:text-red-600 sm:grid" aria-label={`${compassT('Borrar')} ${entry.query}`} onClick={() => onDelete(entry.searchId)}><Icon name="x" size={12} /></button></li>)}</ul>}
    {saved.length > 0 && <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800"><h3 className="mb-1 text-xs font-semibold">{compassT('Candidatos guardados')}</h3><ul className="space-y-1">{saved.slice(0, 8).map((entry) => <li key={entry.canonicalKey}><button type="button" className="w-full truncate rounded px-1 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={() => onSavedSelect(entry)}>{entry.title}</button></li>)}</ul></div>}
  </aside>;
}
