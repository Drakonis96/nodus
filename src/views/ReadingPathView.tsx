import { useCallback, useEffect, useState } from 'react';
import type { ReadingPathEntry } from '@shared/types';
import { Badge } from '../components/ui';
import { useScanComplete } from '../hooks';

export function ReadingPathView() {
  const [path, setPath] = useState<ReadingPathEntry[]>([]);

  const reload = useCallback(() => {
    void window.nodus.getReadingPath().then(setPath);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useScanComplete(reload);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Ruta de lectura</h1>
      <p className="text-sm text-neutral-400 mb-5">
        Orden recomendado: lo más seminal primero, resaltando lo que aún no has leído. ¿Por dónde empiezo?
      </p>

      <ol className="space-y-2">
        {path.map((e, i) => (
          <li key={e.nodus_id} className={`card p-3 flex gap-3 items-start ${e.read ? 'opacity-70' : ''}`}>
            <div className="text-lg font-mono text-neutral-600 w-8 text-right">{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{e.title}</span>
                {e.read ? <Badge color="indigo">leída</Badge> : <Badge color="amber">por leer</Badge>}
              </div>
              <div className="text-xs text-neutral-500">
                {e.authors[0] ?? '—'}
                {e.authors.length > 1 ? ' et al.' : ''} · {e.year ?? 's.f.'} · {e.themes.join(', ')}
              </div>
              <div className="text-xs text-neutral-400 mt-1">{e.reason}</div>
            </div>
          </li>
        ))}
        {path.length === 0 && <div className="text-neutral-500 text-sm">Sin obras todavía.</div>}
      </ol>
    </div>
  );
}
