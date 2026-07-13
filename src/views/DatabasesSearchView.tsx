import { useEffect, useState } from 'react';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import type { DatabaseRowHit, DatabaseSearchHit } from '@shared/types';

/**
 * The dedicated Databases search view (its own sidebar section, like the academic /
 * genealogy vaults' Buscar). Searches every database by name AND inside the rows'
 * content, and lists database- and row-level results. Clicking a database opens it;
 * clicking a row opens it in the database and pops its record.
 */
export function DatabasesSearchView({ onOpenDatabase }: { onOpenDatabase: (databaseId: string, rowId?: string) => void }) {
  const [query, setQuery] = useState('');
  const [dbHits, setDbHits] = useState<DatabaseSearchHit[]>([]);
  const [rowHits, setRowHits] = useState<DatabaseRowHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setDbHits([]);
      setRowHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [dbs, rows] = await Promise.all([window.nodus.searchDatabases(q, true), window.nodus.searchDatabaseRows(q, 80)]);
        if (!cancelled) {
          setDbHits(dbs);
          setRowHits(rows);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const empty = hasQuery && !loading && dbHits.length === 0 && rowHits.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold">
          <Icon name="search" size={20} /> {t('Buscar')}
        </h1>
        <p className="mb-4 text-sm text-neutral-500">{t('Busca en todas tus bases de datos: por nombre y dentro del contenido de las filas.')}</p>

        <div className="relative mb-5">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input input-with-leading-icon w-full py-2 text-sm"
            autoFocus
            placeholder={t('Escribe para buscar…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {!hasQuery && <p className="text-sm text-neutral-600">{t('Empieza a escribir para ver resultados.')}</p>}
        {loading && <p className="text-sm text-neutral-500">{t('Buscando…')}</p>}
        {empty && <p className="text-sm text-neutral-500">{t('Sin coincidencias.')}</p>}

        {dbHits.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Bases de datos')}</h2>
            <div className="flex flex-col gap-1">
              {dbHits.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onOpenDatabase(d.id)}
                  className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left transition-colors hover:border-indigo-600/70 hover:bg-neutral-900"
                >
                  <Icon name={d.icon || 'table'} className="shrink-0 opacity-70" />
                  <span className="flex-1 truncate text-sm">{d.name}</span>
                  <span className="shrink-0 text-[10px] text-neutral-500">{d.shortId}</span>
                  {d.contentMatches > 0 && (
                    <span className="shrink-0 rounded-full bg-indigo-600/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                      {tx('{n} en el contenido', { n: d.contentMatches })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {rowHits.length > 0 && (
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Filas')}</h2>
            <div className="flex flex-col gap-1">
              {rowHits.map((r) => (
                <button
                  key={r.rowId}
                  onClick={() => onOpenDatabase(r.databaseId, r.rowId)}
                  className="rounded-lg border border-neutral-800 px-3 py-2 text-left transition-colors hover:border-indigo-600/70 hover:bg-neutral-900"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="truncate font-medium">{r.title || t('Sin título')}</span>
                    <span className="shrink-0 text-[10px] text-neutral-500">{r.databaseName}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500">
                    <span className="text-neutral-600">{r.columnName}: </span>
                    {r.snippet}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
