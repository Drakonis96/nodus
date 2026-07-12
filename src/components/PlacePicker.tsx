import { useEffect, useRef, useState } from 'react';
import type { GazetteerPlace } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Autocomplete over the offline gazetteer (GeoNames-derived, bundled). As the user
 * types a place name, it lists real candidate places — municipality, state/province
 * and country — each carrying a stable unique id and coordinates, so a picked place
 * resolves to a single map point. Fully offline; no geocoding server.
 */
export function PlacePicker({
  onPick,
  autoFocus,
  placeholder,
}: {
  onPick: (place: GazetteerPlace) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GazetteerPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void window.nodus.searchGazetteer(q, 12).then((r) => {
        if (cancelled) return;
        setResults(r);
        setLoading(false);
        setOpen(true);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input h-8 w-full text-sm"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t('Buscar un lugar (municipio, ciudad…)')}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 p-1 shadow-xl">
          {loading && results.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-neutral-500">{t('Buscando…')}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-neutral-600">{t('Sin coincidencias. Prueba con el nombre en su idioma original.')}</p>
          ) : (
            results.map((p) => (
              <button
                key={p.gazetteerId}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800"
                onClick={() => {
                  onPick(p);
                  setQuery('');
                  setResults([]);
                  setOpen(false);
                }}
              >
                <Icon name="map" size={13} className="shrink-0 text-neutral-500" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-neutral-100">{p.name}</span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {[p.admin1, p.country].filter(Boolean).join(', ')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
