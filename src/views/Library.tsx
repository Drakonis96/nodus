import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  WorkView,
  WorkFilter,
  DeepStatus,
  LightStatus,
  SummaryStatus,
  AppSettings,
  ModelRef,
  WorkEmbeddingStatus,
  WorkPassageStatus,
  ZoteroTag,
  CollectionFacet,
} from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { WorkGraphModal } from './WorkGraphModal';
import { WorkIdeasModal } from './WorkIdeasModal';
import { DuplicatesModal } from './DuplicatesModal';
import { ModelPicker } from '../components/ModelPicker';
import { VirtualList } from '../components/VirtualList';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';

const LIBRARY_ROW_HEIGHT = 64;
const LIBRARY_GRID_TEMPLATE =
  '2rem minmax(18rem,2fr) minmax(9rem,1fr) 4.5rem minmax(8rem,1fr) 5.25rem 6.25rem 5.75rem 5.75rem 5.75rem 14.5rem';

type StatusFlag = 'deep' | 'summary' | 'ideas' | 'passages' | '!deep' | '!summary' | '!ideas' | '!passages';

type StatusDimension = 'deep' | 'summary' | 'ideas' | 'passages';

const STATUS_FLAGS: { dim: StatusDimension; label: string; negLabel: string; desc: string; negDesc: string }[] = [
  { dim: 'deep', label: 'Análisis profundo hecho', negLabel: 'Análisis profundo NO hecho', desc: 'deep_status = done', negDesc: 'deep_status != done' },
  { dim: 'summary', label: 'Resumen hecho', negLabel: 'Resumen NO hecho', desc: 'summary_status = done', negDesc: 'summary_status != done' },
  { dim: 'ideas', label: 'Ideas extraídas', negLabel: 'Sin ideas extraídas', desc: 'tiene al menos una idea', negDesc: 'no tiene ninguna idea' },
  { dim: 'passages', label: 'Pasajes completos', negLabel: 'Pasajes incompletos', desc: 'todos los fragmentos indexados y actuales', negDesc: 'faltan fragmentos o están obsoletos' },
];

function flagFor(dim: StatusDimension, neg: boolean): StatusFlag {
  return (neg ? `!${dim}` : dim) as StatusFlag;
}

function isNegated(f: StatusFlag): boolean {
  return f.startsWith('!');
}

function dimensionOf(f: StatusFlag): StatusDimension {
  return (isNegated(f) ? f.slice(1) : f) as StatusDimension;
}

function labelFor(f: StatusFlag): string {
  const meta = STATUS_FLAGS.find((s) => s.dim === dimensionOf(f));
  return meta ? (isNegated(f) ? meta.negLabel : meta.label) : f;
}

function StatusFlagsPicker({
  value,
  onToggle,
}: {
  value: StatusFlag[];
  onToggle: (flag: StatusFlag) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = value.length > 0;

  const currentFor = (dim: StatusDimension): 'off' | 'pos' | 'neg' => {
    if (value.includes(dim)) return 'pos';
    if (value.includes(`!${dim}` as StatusFlag)) return 'neg';
    return 'off';
  };

  const cycle = (dim: StatusDimension) => {
    const cur = currentFor(dim);
    if (cur === 'off') onToggle(dim);
    else if (cur === 'pos') { onToggle(dim); onToggle(flagFor(dim, true)); }
    else onToggle(flagFor(dim, true));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`btn border gap-1.5 ${active ? 'border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon name="list" /> {t('Estado')}
        {active && (
          <span className="rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold">{value.length}</span>
        )}
        <Icon name="chevronDown" size={13} className="opacity-70" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('Filtrar por estado')}
          className="absolute left-0 z-30 mt-2 w-[24rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl"
        >
          {STATUS_FLAGS.map((s) => {
            const state = currentFor(s.dim);
            const bgClass = state === 'pos' ? 'bg-indigo-600/15' : state === 'neg' ? 'bg-red-600/15' : 'hover:bg-neutral-900';
            const borderClass = state === 'pos' ? 'border-indigo-400 bg-indigo-500' : state === 'neg' ? 'border-red-400 bg-red-500' : 'border-neutral-600';
            const textClass = state === 'pos' ? 'text-indigo-200' : state === 'neg' ? 'text-red-200' : 'text-neutral-200';
            return (
              <button
                key={s.dim}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${bgClass}`}
                onClick={() => cycle(s.dim)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-white ${borderClass}`}
                >
                  {state === 'pos' && <Icon name="check" size={12} />}
                  {state === 'neg' && <Icon name="x" size={12} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${textClass}`}>
                    {state === 'neg' ? t(s.negLabel) : t(s.label)}
                  </span>
                  <span className="block text-xs text-neutral-500">{state === 'neg' ? t(s.negDesc) : t(s.desc)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lightBadge(s: LightStatus) {
  if (s === 'done') return <Badge color="green">{t('ligero')} ✓</Badge>;
  if (s === 'none') return <Badge color="neutral">—</Badge>;
  if (s === 'failed') return <Badge color="red">{t('ligero')} ✕</Badge>;
  return <Badge color="neutral">{t('ligero')}…</Badge>;
}

function deepBadge(s: DeepStatus) {
  switch (s) {
    case 'done':
      return <Badge color="indigo">{t('profundo')} ✓</Badge>;
    case 'pending':
      return <Badge color="amber">{t('profundo')}…</Badge>;
    case 'failed':
      return <Badge color="red">{t('profundo')} ✕</Badge>;
    case 'skipped_no_text':
      return <Badge color="amber" title={t('Sin texto disponible')}>{t('sin texto')}</Badge>;
    default:
      return <Badge color="neutral">—</Badge>;
  }
}

function summaryBadge(s: SummaryStatus) {
  switch (s) {
    case 'done':
      return <Badge color="indigo">{t('resumen')} ✓</Badge>;
    case 'pending':
      return <Badge color="amber">{t('resumen')}…</Badge>;
    case 'failed':
      return <Badge color="red">{t('resumen')} ✕</Badge>;
    case 'skipped_no_text':
      return <Badge color="amber" title={t('Sin texto disponible')}>{t('sin texto')}</Badge>;
    default:
      return <Badge color="neutral">—</Badge>;
  }
}

function triggerBadge(w: WorkView) {
  if (!w.deep_trigger) return null;
  if (w.deep_trigger === 'tag') return <span title={t('Por tag')}>🏷</span>;
  if (w.deep_trigger === 'manual') return <span title={t('Manual')}>✦</span>;
  return (
    <span title={t('Tag + manual')}>
      🏷✦
    </span>
  );
}

function embeddingBadge(status: WorkEmbeddingStatus | undefined) {
  if (!status || status.totalIdeas === 0) return <Badge color="neutral">—</Badge>;
  if (status.complete) return <Badge color="cyan">✓ {status.embeddedIdeas}</Badge>;
  return (
    <Badge color="amber" title={tx('{a}/{b} ideas indexadas', { a: status.embeddedIdeas, b: status.totalIdeas })}>
      {status.embeddedIdeas}/{status.totalIdeas}
    </Badge>
  );
}

function passageBadge(status: WorkPassageStatus | undefined) {
  if (!status || status.status === 'missing') return <Badge color="neutral">—</Badge>;
  if (status.status === 'complete') return <Badge color="green">✓ {status.totalPassages}</Badge>;
  return <Badge color="amber" title={t('El texto o el modelo de embeddings cambió.')}>{t('obsoleto')}</Badge>;
}

export function Library({
  settings,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
}: {
  settings: AppSettings;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [works, setWorks] = useState<WorkView[]>([]);
  const [filter, setFilter] = useState<WorkFilter>({});
  const [availableZoteroTags, setAvailableZoteroTags] = useState<ZoteroTag[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [availableCollections, setAvailableCollections] = useState<CollectionFacet[]>([]);
  const [collectionFilterOpen, setCollectionFilterOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanModel, setScanModel] = useState<ModelRef | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Map<string, WorkEmbeddingStatus>>(new Map());
  const [passageStatuses, setPassageStatuses] = useState<Map<string, WorkPassageStatus>>(new Map());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);
  const [graphWork, setGraphWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const initialLoadRef = useRef(true);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (initialLoadRef.current) setLoading(true);
    try {
      const [w, tags, statuses, passageIndexStatuses, collections] = await Promise.all([
        window.nodus.listWorks(filter),
        window.nodus.listZoteroTags(),
        window.nodus.getWorkEmbeddingStatuses(),
        window.nodus.getWorkPassageStatuses(),
        window.nodus.listCollectionFacets(),
      ]);
      // A newer filter or refresh may have completed while this request was in
      // flight.  Never replace its results with stale rows.
      if (requestId !== loadRequestRef.current) return;
      setWorks(w);
      setAvailableZoteroTags(tags);
      setEmbeddingStatuses(new Map(statuses.map((s) => [s.nodus_id, s])));
      setPassageStatuses(new Map(passageIndexStatuses.map((s) => [s.nodus_id, s])));
      setAvailableCollections(collections);
    } finally {
      if (requestId === loadRequestRef.current) {
        initialLoadRef.current = false;
        setLoading(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataRefresh(load);
  // Once a queued analysis finishes, reapply the active tag/status predicate
  // without remounting the virtual list or losing the reader's scroll position.
  useScanComplete(() => void load());
  useEffect(() => window.nodus.onPassageProgress((progress) => {
    if (!progress.running) void load();
  }), [load]);

  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light', scanModel);
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep', scanModel);
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true, scanModel);
    }
    await load();
  };

  const analyzeBoth = async (w: WorkView) => {
    await window.nodus.analyzeBoth(w.nodus_id, scanModel);
    await load();
  };

  // Full chain for a single work: themes → ideas → summary → index → relationships.
  const processFullWork = async (w: WorkView) => {
    await window.nodus.processFull(w.nodus_id, scanModel);
    await load();
  };

  const summarizeWork = async (w: WorkView) => {
    await window.nodus.summarizeWork(w.nodus_id, scanModel);
    await load();
  };

  const analyzeSelectedThemes = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    for (const id of ids) {
      await window.nodus.rescan(id, 'light', scanModel);
    }
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedIdeas = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    await window.nodus.setManualDeepBulk(ids, true, scanModel);
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedBoth = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    await window.nodus.analyzeBothBulk(ids, scanModel);
    setSelected(new Set());
    await load();
  };

  // Full chain: themes → ideas → summary → index (ideas + passages) → discover relationships.
  const processFullSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    await window.nodus.processFullBulk(ids, scanModel);
    setSelected(new Set());
    await load();
  };

  const processFullLibrary = async () => {
    const ids = works.map((w) => w.nodus_id);
    if (ids.length === 0) return;
    const ok = window.confirm(
      tx(
        'Procesar todo encadena para las {n} obra(s) filtrada(s): temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones. Es una operación larga que consume tokens del modelo seleccionado. ¿Continuar?',
        { n: ids.length }
      )
    );
    if (!ok) return;
    await window.nodus.processFullBulk(ids, scanModel);
    setSelected(new Set());
    await load();
    window.alert(tx('Procesado completo en cola para {n} obra(s). Verás el progreso en la cola.', { n: ids.length }));
  };

  const summarizeSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    await window.nodus.summarizeBulk(ids, scanModel);
    setSelected(new Set());
    await load();
  };

  const summarizeMissing = async () => {
    await window.nodus.summarizeAll(scanModel);
    await load();
  };

  const reassignThemes = async () => {
    const ok = window.confirm(
      t('Reasignar temas vuelve a ejecutar el análisis ligero (título + abstract) sobre TODA la biblioteca para reconstruir los temas padre y agrupar las ideas existentes bajo ellos. Consume tokens del modelo seleccionado. ¿Continuar?')
    );
    if (!ok) return;
    const n = await window.nodus.reassignThemes(scanModel);
    await load();
    window.alert(tx('Reasignación de temas en cola para {n} obra(s). Verás el progreso en la cola.', { n }));
  };

  const embedWork = async (nodusId: string) => {
    await window.nodus.startEmbedding([nodusId]);
  };

  const embedSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    await window.nodus.startEmbedding(ids);
    setSelected(new Set());
  };

  const embedPending = async () => {
    await window.nodus.startEmbedding();
  };

  const indexPassageWork = async (nodusId: string) => {
    await window.nodus.startPassageEmbedding([nodusId]);
  };

  const indexMissingPassages = async () => {
    const ids = works
      .filter((work) => passageStatuses.get(work.nodus_id)?.status !== 'complete')
      .map((work) => work.nodus_id);
    if (ids.length > 0) await window.nodus.startPassageEmbedding(ids);
  };

  const indexAllPassages = async () => {
    await window.nodus.startPassageEmbedding();
  };

  const doReindexAll = async () => {
    setConfirmReindex(false);
    await window.nodus.reindexAll();
  };

  const needsEmbedding = (w: WorkView) => {
    const s = embeddingStatuses.get(w.nodus_id);
    return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
  };

  const needsPassageIndex = (w: WorkView) =>
    passageStatuses.get(w.nodus_id)?.status !== 'complete';

  const discoverBridges = async () => {
    await window.nodus.enqueueBridgeDiscovery(scanModel);
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedZoteroTags = filter.zoteroTags ?? [];
  const visibleZoteroTags = useMemo(() => {
    const query = tagSearch.trim().toLocaleLowerCase();
    return query ? availableZoteroTags.filter((tag) => tag.label.toLocaleLowerCase().includes(query)) : availableZoteroTags;
  }, [availableZoteroTags, tagSearch]);

  const toggleZoteroTag = (label: string) => {
    setFilter((current) => {
      const selected = current.zoteroTags ?? [];
      const normalized = label.toLocaleLowerCase();
      const exists = selected.some((tag) => tag.toLocaleLowerCase() === normalized);
      return {
        ...current,
        zoteroTags: exists ? selected.filter((tag) => tag.toLocaleLowerCase() !== normalized) : [...selected, label],
      };
    });
  };

  const clearZoteroTags = () => {
    setFilter((current) => ({ ...current, zoteroTags: [], zoteroTagMode: 'any' }));
    setTagSearch('');
  };

  const selectedCollections = filter.collections ?? [];
  const collectionNameByKey = useMemo(
    () => new Map(availableCollections.map((c) => [c.key, c.name])),
    [availableCollections]
  );
  const visibleCollections = useMemo(() => {
    const query = collectionSearch.trim().toLocaleLowerCase();
    return query ? availableCollections.filter((c) => c.name.toLocaleLowerCase().includes(query)) : availableCollections;
  }, [availableCollections, collectionSearch]);

  const toggleCollection = (key: string) => {
    setFilter((current) => {
      const selected = current.collections ?? [];
      const exists = selected.includes(key);
      return { ...current, collections: exists ? selected.filter((k) => k !== key) : [...selected, key] };
    });
  };

  const clearCollections = () => {
    setFilter((current) => ({ ...current, collections: [], collectionMode: 'any' }));
    setCollectionSearch('');
  };

  const selectedStatusFlags = filter.statusFlags ?? [];
  const toggleStatusFlag = (f: StatusFlag) =>
    setFilter((cur) => {
      const set = new Set(cur.statusFlags ?? []);
      const opposite = isNegated(f) ? dimensionOf(f) : (`!${dimensionOf(f)}` as StatusFlag);
      set.delete(opposite);
      if (set.has(f)) set.delete(f); else set.add(f);
      return { ...cur, statusFlags: [...set] };
    });
  const _clearStatusFlags = () => setFilter((c) => ({ ...c, statusFlags: [] }));

  // A batch action must only operate on the current result set.  Otherwise a
  // selection made before changing a tag/status filter can silently enqueue
  // works that are no longer visible.
  const selectedVisibleIds = useMemo(
    () => works.filter((work) => selected.has(work.nodus_id)).map((work) => work.nodus_id),
    [selected, works]
  );
  useEffect(() => {
    const visibleIds = new Set(works.map((work) => work.nodus_id));
    setSelected((current) => {
      let changed = current.size !== selectedVisibleIds.length;
      if (!changed) {
        for (const id of current) {
          if (!visibleIds.has(id)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? new Set(selectedVisibleIds) : current;
    });
  }, [selectedVisibleIds, works]);

  const allVisibleSelected = works.length > 0 && selectedVisibleIds.length === works.length;
  const selectAllVisible = () => setSelected(new Set(works.map((work) => work.nodus_id)));
  const summary = useMemo(() => {
    const pendingEmbeddings = works.filter((w) => {
      const s = embeddingStatuses.get(w.nodus_id);
      return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
    }).length;
    return {
      withoutThemes: works.filter((w) => w.light_status === 'none').length,
      themesDone: works.filter((w) => w.light_status === 'done').length,
      ideasDone: works.filter((w) => w.deep_status === 'done').length,
      summariesDone: works.filter((w) => w.summary_status === 'done').length,
      failed: works.filter((w) => w.light_status === 'failed' || w.deep_status === 'failed' || w.summary_status === 'failed').length,
      pendingEmbeddings,
    };
  }, [embeddingStatuses, works]);

  return (
    <div className="h-full flex flex-col p-6 min-h-0">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Biblioteca')}</h1>
          <p className="text-sm text-neutral-500 mt-1">{tx('{n} obras visibles', { n: works.length })}</p>
        </div>
        <div className="flex-1" />
        <button
          className={`btn border border-neutral-700 gap-1.5 ${advancedOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <Icon name="wand" /> {t('Operaciones')}
        </button>
        <button className="btn btn-ghost border border-neutral-700" onClick={onOpenCollections}>
          <Icon name="folder" /> {t('Colecciones')}
        </button>
      </div>

      <div className="card p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input"
            placeholder={t('Buscar título o autor…')}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          <StatusFlagsPicker
            value={selectedStatusFlags}
            onToggle={toggleStatusFlag}
          />
          <div className="relative">
            <button
              type="button"
              className={`zotero-tag-filter btn border gap-1.5 ${selectedZoteroTags.length ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setTagFilterOpen((open) => !open)}
              aria-expanded={tagFilterOpen}
              aria-haspopup="dialog"
            >
              <Icon name="tag" /> {t('Etiquetas Zotero')}
              {selectedZoteroTags.length > 0 && (
                <span className="zotero-tag-filter-count rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {selectedZoteroTags.length}
                </span>
              )}
            </button>
            {tagFilterOpen && (
              <div
                role="dialog"
                aria-label={t('Filtrar por etiquetas de Zotero')}
                className="absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="input min-w-0 flex-1"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder={t('Buscar etiqueta…')}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={selectedZoteroTags.length === 0}
                    onClick={clearZoteroTags}
                  >
                    {t('Limpiar')}
                  </button>
                </div>
                {selectedZoteroTags.length > 1 && (
                  <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
                    {t('Combinar etiquetas')}
                    <select
                      className="input py-1 text-xs"
                      value={filter.zoteroTagMode ?? 'any'}
                      onChange={(e) => setFilter((current) => ({ ...current, zoteroTagMode: e.target.value as 'any' | 'all' }))}
                    >
                      <option value="any">{t('Cualquiera')}</option>
                      <option value="all">{t('Todas')}</option>
                    </select>
                  </label>
                )}
                <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {visibleZoteroTags.map((tag) => {
                    const checked = selectedZoteroTags.some((selected) => selected.toLocaleLowerCase() === tag.label.toLocaleLowerCase());
                    return (
                      <button
                        key={tag.label}
                        type="button"
                        className={`zotero-tag-option flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                          checked ? 'is-selected bg-indigo-950/50 text-indigo-100' : 'text-neutral-300'
                        }`}
                        onClick={() => toggleZoteroTag(tag.label)}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-neutral-600'
                          }`}
                        >
                          {checked && <Icon name="check" size={12} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                        <span className="text-xs tabular-nums text-neutral-500">{tag.workCount}</span>
                      </button>
                    );
                  })}
                  {availableZoteroTags.length === 0 && (
                    <p className="px-2 py-3 text-xs leading-relaxed text-neutral-500">
                      {t('Aún no hay etiquetas guardadas. Pulsa “Actualizar” para leer las etiquetas de las colecciones monitorizadas en Zotero.')}
                    </p>
                  )}
                  {availableZoteroTags.length > 0 && visibleZoteroTags.length === 0 && (
                    <p className="px-2 py-3 text-xs text-neutral-500">{t('No hay etiquetas que coincidan.')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              className={`collection-filter btn border gap-1.5 ${selectedCollections.length ? 'is-active border-cyan-700 bg-cyan-950/40 text-cyan-100' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setCollectionFilterOpen((open) => !open)}
              aria-expanded={collectionFilterOpen}
              aria-haspopup="dialog"
              disabled={availableCollections.length === 0}
              title={availableCollections.length === 0 ? t('Sincroniza para poder filtrar por colección.') : t('Filtrar por colección')}
            >
              <Icon name="folder" /> {t('Colección')}
              {selectedCollections.length > 0 && (
                <span className="rounded bg-cyan-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {selectedCollections.length}
                </span>
              )}
            </button>
            {collectionFilterOpen && (
              <div
                role="dialog"
                aria-label={t('Filtrar por colección')}
                className="absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="input min-w-0 flex-1"
                    value={collectionSearch}
                    onChange={(e) => setCollectionSearch(e.target.value)}
                    placeholder={t('Buscar colección…')}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={selectedCollections.length === 0}
                    onClick={clearCollections}
                  >
                    {t('Limpiar')}
                  </button>
                </div>
                {selectedCollections.length > 1 && (
                  <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
                    {t('Combinar colecciones')}
                    <select
                      className="input py-1 text-xs"
                      value={filter.collectionMode ?? 'any'}
                      onChange={(e) => setFilter((current) => ({ ...current, collectionMode: e.target.value as 'any' | 'all' }))}
                    >
                      <option value="any">{t('Cualquiera')}</option>
                      <option value="all">{t('Todas')}</option>
                    </select>
                  </label>
                )}
                <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {visibleCollections.map((collection) => {
                    const checked = selectedCollections.includes(collection.key);
                    return (
                      <button
                        key={collection.key}
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                          checked ? 'bg-cyan-950/50 text-cyan-100' : 'text-neutral-300'
                        }`}
                        style={{ paddingLeft: `${0.5 + collection.depth * 0.85}rem` }}
                        onClick={() => toggleCollection(collection.key)}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? 'border-cyan-400 bg-cyan-500 text-white' : 'border-neutral-600'
                          }`}
                        >
                          {checked && <Icon name="check" size={12} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                        <span className="text-xs tabular-nums text-neutral-500">{collection.workCount}</span>
                      </button>
                    );
                  })}
                  {availableCollections.length === 0 && (
                    <p className="px-2 py-3 text-xs leading-relaxed text-neutral-500">
                      {t('Aún no hay colecciones. Pulsa “Sincronizar” para leer la estructura de colecciones de Zotero.')}
                    </p>
                  )}
                  {availableCollections.length > 0 && visibleCollections.length === 0 && (
                    <p className="px-2 py-3 text-xs text-neutral-500">{t('No hay colecciones que coincidan.')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-neutral-500">{t('Modelo para análisis')}</span>
          <ModelPicker settings={settings} value={scanModel} onChange={setScanModel} compact />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <SummaryPill label={t('temas hechos')} value={summary.themesDone} />
          <SummaryPill label={t('sin temas')} value={summary.withoutThemes} />
          <SummaryPill label={t('ideas hechas')} value={summary.ideasDone} />
          <SummaryPill label={t('resúmenes hechos')} value={summary.summariesDone} tone="violet" />
          <SummaryPill label={t('embeddings pendientes')} value={summary.pendingEmbeddings} tone="cyan" />
          {summary.failed > 0 && <SummaryPill label={t('fallos')} value={summary.failed} tone="red" />}
        </div>
        {selectedZoteroTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Etiquetas:')}</span>
            {selectedZoteroTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="zotero-tag-chip inline-flex items-center gap-1 rounded-md border border-indigo-800/70 bg-indigo-950/30 px-2 py-1 text-indigo-200 hover:bg-indigo-950/60"
                onClick={() => toggleZoteroTag(tag)}
                title={`${t('Quitar')} ${tag}`}
              >
                {tag} <Icon name="x" size={12} />
              </button>
            ))}
            {selectedZoteroTags.length > 1 && (
              <span className="ml-1">
                {filter.zoteroTagMode === 'all' ? t('deben estar todas') : t('basta cualquiera')}
              </span>
            )}
          </div>
        )}
        {selectedCollections.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Colecciones:')}</span>
            {selectedCollections.map((key) => (
              <button
                key={key}
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-cyan-800/70 bg-cyan-950/30 px-2 py-1 text-cyan-200 hover:bg-cyan-950/60"
                onClick={() => toggleCollection(key)}
                title={`${t('Quitar')} ${collectionNameByKey.get(key) ?? key}`}
              >
                {collectionNameByKey.get(key) ?? key} <Icon name="x" size={12} />
              </button>
            ))}
            {selectedCollections.length > 1 && (
              <span className="ml-1">
                {filter.collectionMode === 'all' ? t('deben estar todas') : t('basta cualquiera')}
              </span>
            )}
          </div>
        )}
        {selectedStatusFlags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Estado:')}</span>
            {selectedStatusFlags.map((flag) => {
              const neg = isNegated(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:opacity-80 ${
                    neg
                      ? 'border-red-800/70 bg-red-950/30 text-red-200'
                      : 'border-indigo-800/70 bg-indigo-950/30 text-indigo-200'
                  }`}
                  onClick={() => toggleStatusFlag(flag)}
                  title={`${t('Quitar')} ${labelFor(flag)}`}
                >
                  {labelFor(flag)} <Icon name="x" size={12} />
                </button>
              );
            })}
            <span className="ml-1">{t('deben cumplir todas')}</span>
          </div>
        )}
      </div>

      {!loading && works.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>{tx('{n} resultados con los filtros actuales', { n: works.length })}</span>
          <button
            className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
            onClick={() => (allVisibleSelected ? setSelected(new Set()) : selectAllVisible())}
          >
            <Icon name={allVisibleSelected ? 'x' : 'check'} size={13} />
            {allVisibleSelected ? t('Quitar selección') : tx('Seleccionar los {n} filtrados', { n: works.length })}
          </button>
          <button
            className="btn btn-primary px-2 py-1 text-xs"
            onClick={processFullLibrary}
            title={t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones para toda la biblioteca filtrada.')}
          >
            <Icon name="compass" size={13} /> {t('Procesar biblioteca')}
          </button>
          <span className="text-neutral-600">{t('Después elige Temas, Ideas o Ambos.')}</span>
        </div>
      )}

      {selectedVisibleIds.length > 0 && (
        <div className="mb-3 rounded-lg border border-indigo-800/70 bg-indigo-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-200">{tx('{n} seleccionadas', { n: selectedVisibleIds.length })}</span>
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          <button
            className="btn btn-primary"
            onClick={processFullSelected}
            title={t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones.')}
          >
            <Icon name="compass" /> {t('Procesar todo')}
          </button>
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedThemes}>
            <Icon name="tag" /> {t('Temas')}
          </button>
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedIdeas}>
            <Icon name="bulb" /> {t('Ideas')}
          </button>
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedBoth}>
            <Icon name="layers" /> {t('Temas + ideas')}
          </button>
          <button className="btn btn-ghost border border-violet-800 text-violet-300" onClick={summarizeSelected}>
            <Icon name="wand" /> {t('Generar resumen')}
          </button>
          <button className="btn btn-ghost border border-cyan-800 text-cyan-300" onClick={embedSelected}>
            <Icon name="search" /> {t('Indexar')}
          </button>
          <button className="btn btn-ghost border border-green-800 text-green-300" onClick={() => void window.nodus.startPassageEmbedding(selectedVisibleIds)}>
            <Icon name="book" /> {t('Indexar pasajes')}
          </button>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            {t('Limpiar selección')}
          </button>
        </div>
      )}

      {advancedOpen && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-4">
          <OperationCard
            icon="wand"
            title={t('Generar resúmenes faltantes')}
            description={t('Crea resúmenes de orientación independientes a partir de ideas, evidencia, temas y abstract. No son evidencia citable.')}
            buttonLabel={t('Generar resúmenes faltantes')}
            tone="violet"
            onClick={summarizeMissing}
          />
          <OperationCard
            icon="wand"
            title={t('Reasignar temas')}
            description={t('Reconstruye los temas padre de toda la biblioteca con análisis ligero. Útil tras cambiar criterios temáticos.')}
            buttonLabel={t('Reasignar')}
            onClick={reassignThemes}
          />
          <OperationCard
            icon="search"
            title={t('Indexar pendientes')}
            description={t('Genera embeddings para las ideas que aún no los tienen. No regenera los existentes.')}
            buttonLabel={t('Indexar pendientes')}
            tone="cyan"
            onClick={embedPending}
          />
          <OperationCard
            icon="book"
            title={t('Procesar pasajes faltantes')}
            description={t('Indexa fragmentos de texto completo en las obras que faltan o están obsoletas. No requiere análisis de ideas; el texto se mantiene como evidencia citable.')}
            buttonLabel={t('Procesar faltantes')}
            tone="cyan"
            onClick={indexMissingPassages}
          />
          <OperationCard
            icon="book"
            title={t('Pasajes (texto completo)')}
            description={t('Recorre toda la biblioteca y actualiza solo los índices que hayan cambiado. Los ya actuales se omiten.')}
            buttonLabel={t('Indexar todo')}
            tone="cyan"
            onClick={indexAllPassages}
          />
          <OperationCard
            icon="search"
            title={t('Reindexar todo')}
            description={t('Borra todos los embeddings y los regenera desde cero. Útil tras cambiar de modelo de embeddings.')}
            buttonLabel={t('Reindexar todo')}
            tone="cyan"
            onClick={() => setConfirmReindex(true)}
          />
          <OperationCard
            icon="compass"
            title={t('Descubrir relaciones')}
            description={t('Usa embeddings e IA para validar puentes semánticos entre ideas que aún no están conectadas. El progreso se muestra en la cola.')}
            buttonLabel={t('Descubrir')}
            tone="violet"
            onClick={discoverBridges}
          />
          <OperationCard
            icon="copy"
            title={t('Buscar y fusionar duplicados')}
            description={t('Detecta obras repetidas (mismo DOI, o mismo título, año y autores) y te deja revisarlas y fusionarlas conservando una sola copia. La misma obra en varias colecciones de Zotero no se duplica.')}
            buttonLabel={t('Revisar duplicados')}
            tone="violet"
            onClick={() => setDuplicatesOpen(true)}
          />
        </div>
      )}

      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden text-sm">
        <div
          className="grid items-center bg-neutral-900 text-neutral-400 border-b border-neutral-800 px-2 py-2 text-left text-xs"
          style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
        >
          <div className="font-medium">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                title={tx('Seleccionar los {n} resultados filtrados', { n: works.length })}
                aria-label={tx('Seleccionar los {n} resultados filtrados', { n: works.length })}
                onChange={(e) => {
                  if (e.target.checked) selectAllVisible();
                  else setSelected(new Set());
                }}
              />
          </div>
          <div className="font-medium">{t('Título')}</div>
          <div className="font-medium">{t('Autores')}</div>
          <div className="font-medium">{t('Año')}</div>
          <div className="font-medium">{t('Tema(s)')}</div>
          <div className="font-medium">{t('Ligero')}</div>
          <div className="font-medium">{t('Profundo')}</div>
          <div className="font-medium">{t('Resumen')}</div>
          <div className="font-medium">{t('Embeddings')}</div>
          <div className="font-medium">{t('Pasajes')}</div>
          <div className="font-medium" data-tour="library-actions">{t('Acciones')}</div>
        </div>
        {loading ? (
          <div className="p-4 text-neutral-500">{t('Cargando...')}</div>
        ) : (
          <VirtualList
            items={works}
            itemHeight={LIBRARY_ROW_HEIGHT}
            getKey={(w) => w.nodus_id}
            className="flex-1 min-h-0"
            empty={<div className="p-4 text-neutral-500">{t('No hay obras con los filtros actuales.')}</div>}
            renderItem={(w) => (
              <div
                className="grid h-full items-center border-b border-neutral-800/70 px-2 hover:bg-neutral-900/50"
                style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
              >
                <div className="p-1">
                  <input
                    type="checkbox"
                    checked={selected.has(w.nodus_id)}
                    onChange={(e) => toggleSelected(w.nodus_id, e.target.checked)}
                  />
                </div>
                <div className="min-w-0 p-1">
                  <button
                    className="block w-full truncate text-left hover:text-indigo-300 hover:underline"
                    title={t('Ver las ideas de esta obra')}
                    onClick={() => setIdeasWork({ nodus_id: w.nodus_id, title: w.title })}
                  >
                    {w.title}
                  </button>
                  <div className="text-[10px] text-neutral-600 font-mono">{w.nodus_id.slice(0, 8)}</div>
                </div>
                <div className="p-1 min-w-0 truncate text-neutral-400">
                  {w.authors[0] ?? '—'}
                  {w.authors.length > 1 ? ' et al.' : ''}
                </div>
                <div className="p-1 text-neutral-400">{w.year ?? '—'}</div>
                <div className="p-1 text-neutral-400 truncate">{w.themes.join(', ')}</div>
                <div className="p-1">{lightBadge(w.light_status)}</div>
                <div className="p-1 whitespace-nowrap">
                  {deepBadge(w.deep_status)} {triggerBadge(w)}
                </div>
                <div className="p-1 whitespace-nowrap">
                  {passageBadge(passageStatuses.get(w.nodus_id))}
                  {needsPassageIndex(w) && (
                    <button
                      className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-green-400 hover:text-green-300"
                      title={t('Indexar pasajes de esta obra')}
                      onClick={() => indexPassageWork(w.nodus_id)}
                    >
                      <Icon name="book" size={11} />
                    </button>
                  )}
                </div>
                <div className="p-1 whitespace-nowrap">{summaryBadge(w.summary_status)}</div>
                <div className="p-1 whitespace-nowrap">
                  {embeddingBadge(embeddingStatuses.get(w.nodus_id))}
                  {needsEmbedding(w) && (
                    <button
                      className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
                      title={t('Indexar embeddings de esta obra')}
                      onClick={() => embedWork(w.nodus_id)}
                    >
                      <Icon name="search" size={11} />
                    </button>
                  )}
                </div>
                <div className="p-1 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <RowIconButton
                      title={t('Procesar todo: temas, ideas, resumen, indexado y relaciones')}
                      icon="compass"
                      tone="indigo"
                      onClick={() => processFullWork(w)}
                    />
                    <RowIconButton title={t('Ver las ideas de esta obra')} icon="list" onClick={() => setIdeasWork({ nodus_id: w.nodus_id, title: w.title })} />
                    <RowIconButton title={t('Analizar temas')} icon="tag" onClick={() => analyzeThemes(w)} />
                    <RowIconButton title={w.deep_status === 'done' ? t('Reanalizar ideas') : t('Analizar ideas')} icon="bulb" onClick={() => analyzeIdeas(w)} />
                    <RowIconButton title={t('Analizar temas e ideas')} icon="layers" onClick={() => analyzeBoth(w)} />
                    <RowIconButton
                      title={w.summary_status === 'done' ? t('Regenerar resumen') : t('Generar resumen')}
                      icon="wand"
                      tone="violet"
                      onClick={() => summarizeWork(w)}
                    />
                    <RowIconButton
                      title={
                        w.deep_status === 'done'
                          ? t('Ver el grafo de ideas de esta obra')
                          : t('Requiere análisis profundo para ver el grafo de ideas')
                      }
                      icon="network"
                      tone="cyan"
                      disabled={w.deep_status !== 'done'}
                      onClick={() => setGraphWork({ nodus_id: w.nodus_id, title: w.title })}
                    />
                    <RowIconButton
                      title={t('Ver esta obra en el grafo')}
                      icon="map"
                      tone="cyan"
                      onClick={() =>
                        onOpenGraph({
                          preset: 'reading',
                          workId: w.nodus_id,
                          workTitle: w.title,
                          zoteroKey: w.zotero_key,
                          label: `${t('Lectura:')} ${w.title}`,
                        })
                      }
                    />
                    <RowIconButton
                      title={t('Preguntar al asistente sobre esta obra')}
                      icon="wand"
                      tone="violet"
                      onClick={() =>
                        onOpenAssistant({
                          title: `${t('Lectura:')} ${w.title}`,
                          selection: ASSISTANT_CONTEXTS.reading,
                          prompt:
                            `${t('Analiza esta lectura dentro del corpus: ideas extraídas, temas, huecos, contradicciones y próximas lecturas relacionadas.')}\n\n` +
                            `${w.title}\n${w.authors.join(', ')}${w.year ? ` (${w.year})` : ''}`,
                        })
                      }
                    />
                    <RowIconButton title={t('Abrir en Zotero')} icon="external" tone="indigo" onClick={() => window.nodus.openInZotero(w.zotero_key)} />
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </div>
      {confirmReindex && (
        <ConfirmModal
          title={t('Reindexar todos los embeddings')}
          message={t('Se borrarán TODOS los embeddings existentes y se regenerarán desde cero. Esto consumirá tokens del proveedor de embeddings configurado. ¿Continuar?')}
          confirmLabel={t('Reindexar todo')}
          danger
          onConfirm={() => void doReindexAll()}
          onCancel={() => setConfirmReindex(false)}
        />
      )}
      {graphWork && <WorkGraphModal work={graphWork} onClose={() => setGraphWork(null)} />}
      {ideasWork && (
        <WorkIdeasModal
          work={ideasWork}
          onClose={() => setIdeasWork(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(w) => {
            setIdeasWork(null);
            setGraphWork(w);
          }}
        />
      )}
      {duplicatesOpen && <DuplicatesModal onClose={() => setDuplicatesOpen(false)} />}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'cyan' | 'red' | 'violet';
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'red'
        ? 'border-red-900/70 text-red-300'
        : tone === 'violet'
          ? 'border-violet-900/70 text-violet-300'
        : 'border-neutral-800 text-neutral-400';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${toneClass}`}>
      <span className="font-semibold tabular-nums text-neutral-100">{value}</span>
      {label}
    </span>
  );
}

function OperationCard({
  icon,
  title,
  description,
  buttonLabel,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  tone?: 'neutral' | 'cyan' | 'violet';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'violet'
        ? 'border-violet-900/70 text-violet-300'
        : 'border-neutral-800 text-neutral-300';
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}>
          <Icon name={icon} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <button className="btn btn-ghost border border-neutral-700 mt-auto" disabled={disabled} onClick={onClick}>
        {buttonLabel}
      </button>
    </section>
  );
}

function RowIconButton({
  title,
  icon,
  tone = 'neutral',
  disabled = false,
  onClick,
}: {
  title: string;
  icon: string;
  tone?: 'neutral' | 'indigo' | 'cyan' | 'violet';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'indigo'
      ? 'text-indigo-400 hover:text-indigo-300'
      : tone === 'cyan'
        ? 'text-cyan-400 hover:text-cyan-300'
        : tone === 'violet'
          ? 'text-violet-400 hover:text-violet-300'
          : 'text-neutral-400 hover:text-neutral-100';
  return (
    <button
      className={`library-row-action ${tone === 'neutral' ? 'library-row-action-neutral' : ''} inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${toneClass}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
