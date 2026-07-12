import { useMemo, useState } from 'react';
import type { ArchiveItem, Person } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Link an archive document to one or more tree members. Shows the linked people as
 * chips and a searchable picker to add more. Clicks are contained so it can live in
 * a table row without triggering the row's own click.
 */
export function PersonLinkPicker({
  item,
  persons,
  onChanged,
  compact = false,
}: {
  item: ArchiveItem;
  persons: Person[];
  onChanged: () => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const linkedIds = useMemo(() => new Set(item.linkedPersons.map((p) => p.personId)), [item.linkedPersons]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return persons
      .filter((p) => !linkedIds.has(p.personId) && (!query || p.displayName.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [persons, linkedIds, q]);

  const link = async (personId: string) => {
    await window.nodus.linkArchivePerson(item.itemId, personId);
    setQ('');
    await onChanged();
  };
  const unlink = async (personId: string) => {
    await window.nodus.unlinkArchivePerson(item.itemId, personId);
    await onChanged();
  };

  return (
    <div onClick={(e) => e.stopPropagation()} className="min-w-[10rem]">
      <div className="flex flex-wrap items-center gap-1">
        {item.linkedPersons.map((p) => (
          <span key={p.personId} className="flex items-center gap-1 rounded-full bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-200">
            {p.displayName}
            <button onClick={() => void unlink(p.personId)} className="text-indigo-400/70 hover:text-indigo-200" title={t('Desvincular')}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-dashed border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          {compact ? '+' : `+ ${t('vincular')}`}
        </button>
      </div>
      {open && (
        <div className="mt-1.5 w-52 rounded-md border border-neutral-800 bg-neutral-950 p-1.5 shadow-xl">
          <input
            className="input h-7 w-full text-xs"
            placeholder={t('Buscar miembro…')}
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="mt-1 max-h-48 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-1 py-2 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>
            ) : (
              results.map((p) => (
                <button
                  key={p.personId}
                  onClick={() => void link(p.personId)}
                  className="block w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  {p.displayName}
                  {p.birthDate ? <span className="text-neutral-500"> · {p.birthDate}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
