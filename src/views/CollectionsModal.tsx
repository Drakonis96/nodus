import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ZoteroCollection, ZoteroItem, WorkView, AppSettings, ModelRef } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { VirtualList } from '../components/VirtualList';

const ITEM_TYPES = ['journalArticle', 'book', 'bookSection', 'conferencePaper', 'thesis', 'preprint', 'report'];
const ZOTERO_ITEM_ROW_HEIGHT = 58;

// Session-level cache of collection items so re-selecting doesn't re-hit the API.
const itemCache = new Map<string, ZoteroItem[]>();

function CollectionNode({
  col,
  depth,
  selectedKey,
  onSelect,
}: {
  col: ZoteroCollection;
  depth: number;
  selectedKey: string | null;
  onSelect: (c: ZoteroCollection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ZoteroCollection[] | null>(null);
  const [loading, setLoading] = useState(false);

  const expand = async () => {
    if (!open && children === null) {
      setLoading(true);
      setChildren(await window.nodus.zoteroChildCollections(col.key).catch(() => []));
      setLoading(false);
    }
    setOpen((o) => !o);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-sm hover:bg-neutral-800 ${
          selectedKey === col.key ? 'bg-neutral-800 text-white' : 'text-neutral-300'
        }`}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <button onClick={expand} className="w-4 text-neutral-500">
          {loading ? '…' : open ? '▾' : '▸'}
        </button>
        <span className="flex-1 truncate" onClick={() => onSelect(col)}>
          {col.name}
        </span>
        <span className="text-[10px] text-neutral-600" title="ítems directos · subcolecciones">
          {col.itemCount}
          {col.subCount ? ` · ${col.subCount}▸` : ''}
        </span>
      </div>
      {open &&
        children?.map((c) => (
          <CollectionNode key={c.key} col={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} />
        ))}
    </div>
  );
}

export function CollectionsModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const readTag = settings.readTag;
  const [roots, setRoots] = useState<ZoteroCollection[]>([]);
  const [selected, setSelected] = useState<ZoteroCollection | null>(null);
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [worksByKey, setWorksByKey] = useState<Map<string, WorkView>>(new Map());
  const [recursive, setRecursive] = useState(true);
  const [scanModel, setScanModel] = useState<ModelRef | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [onlyTag, setOnlyTag] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unscanned' | 'light' | 'deep'>('all');

  useEffect(() => {
    void window.nodus.zoteroCollections().then(setRoots);
    void window.nodus.listWorks({ includeArchived: true }).then((ws) => {
      setWorksByKey(new Map(ws.map((w) => [w.zotero_key, w])));
    });
  }, []);

  const loadItems = useCallback(
    async (col: ZoteroCollection, force = false) => {
      setSelected(col);
      const cacheKey = `${col.key}:${recursive ? 'r' : 'd'}`;
      if (!force && itemCache.has(cacheKey)) {
        setItems(itemCache.get(cacheKey)!);
        return;
      }
      setLoadingItems(true);
      // Include subcollection items by default so a parent collection isn't shown empty.
      const data = await window.nodus.zoteroCollectionItems(col.key, { recursive }).catch(() => []);
      itemCache.set(cacheKey, data);
      setItems(data);
      setLoadingItems(false);
    },
    [recursive]
  );

  // Reload the selected collection's items when the recursive toggle changes.
  useEffect(() => {
    if (selected) void loadItems(selected, true);
  }, [recursive, selected, loadItems]);

  const statusOf = useCallback((key: string): 'unscanned' | 'light' | 'deep' => {
    const w = worksByKey.get(key);
    if (!w) return 'unscanned';
    if (w.deep_status === 'done') return 'deep';
    if (w.light_status === 'done') return 'light';
    return 'unscanned';
  }, [worksByKey]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const min = yearMin ? parseInt(yearMin) : null;
    const max = yearMax ? parseInt(yearMax) : null;
    const readTagLower = readTag.toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hit =
          it.title.toLowerCase().includes(q) ||
          it.creators.some((c) => (c.lastName ?? c.name ?? '').toLowerCase().includes(q)) ||
          String(it.year ?? '').includes(q) ||
          (it.abstract ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (types.size && !types.has(it.itemType)) return false;
      if (min != null && (it.year ?? 0) < min) return false;
      if (max != null && (it.year ?? 9999) > max) return false;
      if (onlyTag && !it.tags.some((t) => t.toLowerCase() === readTagLower)) return false;
      if (statusFilter !== 'all' && statusOf(it.key) !== statusFilter) return false;
      return true;
    });
  }, [items, onlyTag, readTag, search, statusFilter, statusOf, types, yearMax, yearMin]);

  const refreshWorks = async () => {
    const ws = await window.nodus.listWorks({ includeArchived: true });
    setWorksByKey(new Map(ws.map((w) => [w.zotero_key, w])));
  };

  const ensureWorks = async (itemsToEnsure: ZoteroItem[]) => {
    const missing = itemsToEnsure.filter((it) => !worksByKey.has(it.key));
    if (missing.length) await window.nodus.ingestZoteroItems(missing);
    const ws = await window.nodus.listWorks({ includeArchived: true });
    const next = new Map(ws.map((w) => [w.zotero_key, w]));
    setWorksByKey(next);
    return next;
  };

  const analyzeFiltered = async () => {
    const nextWorks = await ensureWorks(filtered);
    const ids = filtered.map((it) => nextWorks.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.setManualDeepBulk(ids, true, scanModel);
    await refreshWorks();
  };

  const analyzeFilteredBoth = async () => {
    const nextWorks = await ensureWorks(filtered);
    const ids = filtered.map((it) => nextWorks.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.analyzeBothBulk(ids, scanModel);
    await refreshWorks();
  };

  const deselectAllFiltered = async () => {
    const ids = filtered.map((it) => worksByKey.get(it.key)?.nodus_id).filter((x): x is string => !!x);
    if (ids.length) await window.nodus.setManualDeepBulk(ids, false);
    await refreshWorks();
  };

  const toggleItem = async (it: ZoteroItem) => {
    const nextWorks = worksByKey.has(it.key) ? worksByKey : await ensureWorks([it]);
    const w = nextWorks.get(it.key);
    if (!w) return;
    await window.nodus.setManualDeep(w.nodus_id, !w.manual_deep, scanModel);
    await refreshWorks();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="font-semibold">Colecciones de Zotero</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Tree */}
          <div className="w-72 border-r border-neutral-800 overflow-y-auto p-2">
            {roots.map((c) => (
              <CollectionNode key={c.key} col={c} depth={0} selectedKey={selected?.key ?? null} onSelect={loadItems} />
            ))}
            {roots.length === 0 && <div className="text-neutral-500 text-sm p-2">Sin colecciones.</div>}
          </div>

          {/* Items */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="p-3 border-b border-neutral-800 space-y-2">
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  className="input flex-1 min-w-[160px]"
                  placeholder="Buscar título, autor, año, abstract…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <input className="input w-20" placeholder="Año min" value={yearMin} onChange={(e) => setYearMin(e.target.value)} />
                <input className="input w-20" placeholder="Año max" value={yearMax} onChange={(e) => setYearMax(e.target.value)} />
                <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                  <option value="all">Todos</option>
                  <option value="unscanned">Sin escanear</option>
                  <option value="light">Ligero</option>
                  <option value="deep">Profundo</option>
                </select>
                <label className="text-xs flex items-center gap-1 text-neutral-400">
                  <input type="checkbox" checked={onlyTag} onChange={(e) => setOnlyTag(e.target.checked)} /> solo tag
                </label>
                <label className="text-xs flex items-center gap-1 text-neutral-400" title="Incluir ítems de subcolecciones">
                  <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> subcolecciones
                </label>
                <span className="text-xs text-neutral-500">Escanear con:</span>
                <ModelPicker settings={settings} value={scanModel} onChange={setScanModel} compact />
              </div>
              <div className="flex gap-1 flex-wrap">
                {ITEM_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      const next = new Set(types);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      setTypes(next);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded ${
                      types.has(t) ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <div className="flex-1" />
                <button className="btn btn-ghost text-xs" title="Analizar ideas de los ítems filtrados" onClick={analyzeFiltered}>
                  <Icon name="bulb" size={14} /> Ideas
                </button>
                <button className="btn btn-primary text-xs" title="Analizar temas y luego ideas de los ítems filtrados" onClick={analyzeFilteredBoth}>
                  <Icon name="layers" size={14} /> Ambos
                </button>
                <button className="btn btn-ghost text-xs" onClick={deselectAllFiltered}>
                  <Icon name="x" size={14} /> Deseleccionar
                </button>
                {selected && (
                  <button className="btn btn-ghost text-xs" title="Recargar ítems" onClick={() => loadItems(selected, true)}>
                    <Icon name="refresh" size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0">
              {loadingItems && <div className="p-4 text-neutral-500 text-sm">Cargando ítems…</div>}
              {!loadingItems && !selected && (
                <div className="p-4 text-neutral-500 text-sm">Selecciona una colección.</div>
              )}
              {!loadingItems && selected && (
                <VirtualList
                  items={filtered}
                  itemHeight={ZOTERO_ITEM_ROW_HEIGHT}
                  getKey={(it) => it.key}
                  className="h-full"
                  empty={<div className="p-4 text-neutral-500 text-sm">No hay ítems con los filtros actuales.</div>}
                  renderItem={(it) => {
                  const w = worksByKey.get(it.key);
                  const st = statusOf(it.key);
                  return (
                    <div className="flex h-full items-center gap-3 border-b border-neutral-800/60 px-4">
                      <input
                        type="checkbox"
                        checked={!!w?.manual_deep}
                        onChange={() => void toggleItem(it)}
                        title={w ? 'Analizar ideas de esta obra' : 'Incorporar a Nodus y analizar ideas'}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm">{it.title}</div>
                        <div className="text-xs text-neutral-500">
                          {(it.creators[0]?.lastName ?? it.creators[0]?.name ?? '—')}
                          {it.creators.length > 1 ? ' et al.' : ''} · {it.year ?? 's.f.'} · {it.itemType}
                        </div>
                      </div>
                      <Badge color={st === 'deep' ? 'indigo' : st === 'light' ? 'green' : 'neutral'}>{st}</Badge>
                      {w?.deep_trigger === 'tag' && <span title="tag">🏷</span>}
                      {w?.deep_trigger === 'manual' && <span title="manual">✦</span>}
                      {w?.deep_trigger === 'both' && <span title="ambos">🏷✦</span>}
                    </div>
                  );
                  }}
                />
              )}
            </div>
            <div className="px-4 py-1.5 border-t border-neutral-800 text-xs text-neutral-500">
              {filtered.length} de {items.length} ítems
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
