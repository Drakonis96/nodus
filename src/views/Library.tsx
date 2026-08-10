import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  WorkView,
  WorkFilter,
  CorpusHealthBucketId,
  QueueItem,
  WorkEmbeddingStatus,
  WorkPassageStatus,
  VaultAnalysisReuseKind,
  VaultAnalysisReuseResult,
  VaultType,
  ZoteroTag,
  CollectionFacet,
  WorkSortKey,
} from '@shared/types';
import { Icon } from '../components/ui';
import { confirm, toast } from '../components/feedback';
import { WorkGraphModal } from './WorkGraphModal';
import { WorkIdeasModal } from './WorkIdeasModal';
import { WorkStatusModal } from './WorkStatusModal';
import { DuplicatesModal } from './DuplicatesModal';
import { LibraryDocumentReader } from './LibraryDocumentReader';
import { VirtualList } from '../components/VirtualList';
import { anchorStyle, useAnchoredCoords } from '../components/dbGrid';
import { useDataRefresh, useDismissableLayer, useScanComplete } from '../hooks';
import { deriveWorkStatus, queueItemsByWork, type StepId, type WorkReadiness, type WorkStatus } from '../libraryStatus';
import {
  ASSISTANT_CONTEXTS,
  type LibraryNavigationTarget,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';
import { getVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';

const LIBRARY_ROW_HEIGHT = 64;
const LIBRARY_PAGE_SIZE = 200;
// Title and authors get the room the five pipeline-status columns used to take:
// checkbox, title, authors, year, theme(s), ideas, status, actions.
const LIBRARY_GRID_TEMPLATE =
  '2rem minmax(18rem,2fr) minmax(10rem,1fr) 4.5rem minmax(9rem,1fr) 5rem 11rem 8.5rem';

type StatusFlag = 'deep' | 'summary' | 'ideas' | 'passages' | '!deep' | '!summary' | '!ideas' | '!passages';

/**
 * Columns the table can be ordered by. Only keys the backend can express in SQL
 * are offered: it sorts the WHOLE library before paging, whereas a client-side
 * sort would only reorder the 200 rows already on screen — which reads as "the
 * most incomplete works" while actually being "the most incomplete of this page".
 * Readiness has no SQL expression, so the Status column is filtered, not sorted.
 */
type SortKey = Extract<WorkSortKey, 'title' | 'authors' | 'year' | 'themes' | 'ideas'>;
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

// Counts default to descending (most first); text columns to ascending. A third
// click clears back to the default backend order (year desc, title asc).
const NUMERIC_SORT_KEYS = new Set<SortKey>(['year', 'ideas']);
const initialSortDir = (key: SortKey): 'asc' | 'desc' => (NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc');

/**
 * How each readiness value is presented. Kept in this file, with display-shaped
 * values, so the i18n coverage scan follows it from the `t()` call below.
 */
const READINESS_LABEL: Record<WorkReadiness, string> = {
  unstarted: 'Sin analizar',
  running: 'Analizando…',
  failed: 'Con fallos',
  noText: 'Sin texto',
  abstractOnly: 'Solo abstract',
  incomplete: 'Incompleto',
  ready: 'Listo',
};

const READINESS_TONE: Record<WorkReadiness, string> = {
  // Reuses utilities that already have a light-mode remap in index.css.
  unstarted: 'border-neutral-700 text-neutral-400',
  running: 'border-amber-700/60 bg-amber-900/20 text-amber-300',
  failed: 'border-red-700/60 bg-red-900/20 text-red-300',
  noText: 'border-neutral-700 bg-neutral-900/40 text-neutral-400',
  abstractOnly: 'border-amber-700/60 bg-amber-900/20 text-amber-300',
  incomplete: 'border-amber-700/60 bg-amber-900/20 text-amber-300',
  ready: 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300',
};

const READINESS_ICON: Record<WorkReadiness, string> = {
  unstarted: 'minus',
  running: 'clock',
  failed: 'x',
  // Nodus never got to see the text of this work.
  noText: 'eyeOff',
  abstractOnly: 'file',
  incomplete: 'alert',
  ready: 'check',
};

/**
 * Why a work can never reach "ready", when that is the case. Written as literal
 * `t()` calls rather than a lookup map: the i18n coverage scan follows literals
 * at the call site, and a map read through a variable slips past it — which ships
 * Spanish to every other language with nothing failing.
 */
function readinessHint(readiness: WorkReadiness): string | null {
  if (readiness === 'noText') {
    return t('Nodus no encontró texto que leer. Añade el PDF o EPUB en Zotero y vuelve a analizar.');
  }
  if (readiness === 'abstractOnly') {
    return t('El análisis solo pudo usar el abstract, así que esta obra no tendrá texto citable. Añade el PDF o EPUB en Zotero y vuelve a analizar.');
  }
  return null;
}

/** Human label for a corpus-health bucket, matching the notice text on Home. */
function healthBucketLabel(id: CorpusHealthBucketId): string {
  switch (id) {
    case 'withoutText':
      return t('Sin texto');
    case 'lightOnly':
      return t('Solo análisis ligero');
    case 'deepPriority':
      return t('Prioritarias por analizar');
    case 'pdfsToRecover':
      return t('Recuperar texto');
  }
}

type StatusDimension = 'deep' | 'summary' | 'ideas' | 'passages';

const STATUS_FLAGS: { dim: StatusDimension; title: string; label: string; negLabel: string; desc: string; negDesc: string }[] = [
  { dim: 'deep', title: 'Análisis profundo', label: 'Análisis profundo hecho', negLabel: 'Análisis profundo NO hecho', desc: 'deep_status = done', negDesc: 'deep_status != done' },
  { dim: 'summary', title: 'Resumen', label: 'Resumen hecho', negLabel: 'Resumen NO hecho', desc: 'summary_status = done', negDesc: 'summary_status != done' },
  { dim: 'ideas', title: 'Ideas', label: 'Ideas extraídas', negLabel: 'Sin ideas extraídas', desc: 'tiene al menos una idea', negDesc: 'no tiene ninguna idea' },
  { dim: 'passages', title: 'Pasajes', label: 'Pasajes completos', negLabel: 'Pasajes incompletos', desc: 'todos los fragmentos indexados y actuales', negDesc: 'faltan fragmentos o están obsoletos' },
];

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
  setDimension,
  onClear,
}: {
  value: StatusFlag[];
  setDimension: (dim: StatusDimension, state: 'off' | 'pos' | 'neg') => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissableLayer<HTMLDivElement>({
    open,
    onDismiss: () => setOpen(false),
    group: 'library-filters',
  });

  const active = value.length > 0;

  const currentFor = (dim: StatusDimension): 'off' | 'pos' | 'neg' => {
    if (value.includes(dim)) return 'pos';
    if (value.includes(`!${dim}` as StatusFlag)) return 'neg';
    return 'off';
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`library-filter-button tone-indigo btn border gap-1.5 ${active ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon name="list" /> {t('Estado')}
        {active && (
          <span className="library-filter-count tone-indigo rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold">{value.length}</span>
        )}
        <Icon name="chevronDown" size={13} className="opacity-70" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('Filtrar por estado')}
          className="library-filter-popover absolute left-0 z-30 mt-2 w-[27rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-2 shadow-2xl"
        >
          <div className="mb-1 flex items-center justify-between gap-3 px-1.5 py-1">
            <div>
              <div className="text-xs font-medium text-neutral-300">{t('Estado de análisis')}</div>
              <div className="text-[11px] text-neutral-500">{t('Cada fila acepta sí, no o cualquiera.')}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost px-2 py-1 text-xs"
              disabled={!active}
              onClick={onClear}
            >
              {t('Limpiar')}
            </button>
          </div>
          {STATUS_FLAGS.map((s) => {
            const state = currentFor(s.dim);
            const stateClass = state === 'pos' ? 'is-pos bg-indigo-600/15' : state === 'neg' ? 'is-neg bg-red-600/15' : 'hover:bg-neutral-900';
            const borderClass = state === 'pos' ? 'is-pos border-indigo-400 bg-indigo-500' : state === 'neg' ? 'is-neg border-red-400 bg-red-500' : 'border-neutral-600';
            const textClass = state === 'pos' ? 'text-indigo-200' : state === 'neg' ? 'text-red-200' : 'text-neutral-200';
            return (
              <div
                key={s.dim}
                className={`library-status-option mb-1.5 flex items-start justify-between gap-3 rounded-md border border-transparent px-2.5 py-2 transition-colors ${stateClass}`}
              >
                <div className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      className={`library-status-indicator flex h-4 w-4 shrink-0 items-center justify-center rounded border text-white ${borderClass}`}
                    >
                      {state === 'pos' && <Icon name="check" size={12} />}
                      {state === 'neg' && <Icon name="x" size={12} />}
                    </span>
                    <span className={`block text-sm font-medium ${textClass}`}>{t(s.title)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{state === 'neg' ? t(s.negDesc) : t(s.desc)}</span>
                </div>
                <div className="inline-flex shrink-0 rounded-md border border-neutral-700 bg-neutral-950/50 p-0.5">
                  <button
                    type="button"
                    className={`library-status-choice rounded px-2 py-1 text-xs ${state === 'pos' ? 'is-active is-pos bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
                    onClick={() => setDimension(s.dim, 'pos')}
                  >
                    {t('Sí')}
                  </button>
                  <button
                    type="button"
                    className={`library-status-choice rounded px-2 py-1 text-xs ${state === 'neg' ? 'is-active is-neg bg-red-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
                    onClick={() => setDimension(s.dim, 'neg')}
                  >
                    {t('No')}
                  </button>
                  <button
                    type="button"
                    className={`library-status-choice rounded px-2 py-1 text-xs ${state === 'off' ? 'is-active bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800'}`}
                    onClick={() => setDimension(s.dim, 'off')}
                  >
                    {t('Cualquiera')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The one-click status filters. They run in SQL over the WHOLE library, so what
 * a preset returns is exactly what the pills say — see readinessFilters.ts.
 * 'running' is absent on purpose: it exists only in the live queue.
 */
const STATUS_PRESETS: Exclude<WorkReadiness, 'running'>[] = [
  'unstarted',
  'incomplete',
  'ready',
  'abstractOnly',
  'noText',
  'failed',
];

/** Short names for the five analysis steps, used by the status tooltip. */
const STEP_LABEL: Record<StepId, string> = {
  themes: 'Temas',
  ideas: 'Ideas',
  summary: 'Resumen',
  semantic: 'Búsqueda semántica',
  citable: 'Texto citable',
};

/**
 * The one status a reader actually needs: can I use this work yet? Clicking it
 * opens the per-step breakdown, which is where retrying an individual step lives.
 */
function StatusPill({ status, onClick }: { status: WorkStatus; onClick: () => void }) {
  const { readiness, missing } = status;
  const hint = readinessHint(readiness);
  const detail = hint
    ? hint
    : missing.length > 0
      ? `${t('Falta')}: ${missing.map((step) => t(STEP_LABEL[step])).join(', ')}`
      : t(READINESS_LABEL[readiness]);
  return (
    <button
      type="button"
      className={`library-status-pill inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80 ${READINESS_TONE[readiness]}`}
      title={`${detail}\n${t('Ver el detalle paso a paso')}`}
      onClick={onClick}
    >
      <Icon name={READINESS_ICON[readiness]} size={12} className="shrink-0" />
      <span className="truncate">{t(READINESS_LABEL[readiness])}</span>
      {readiness === 'incomplete' && (
        <span className="shrink-0 tabular-nums opacity-80">· {missing.length}</span>
      )}
    </button>
  );
}

/**
 * Overflow menu for the row's secondary actions. It is portaled to `document.body`
 * because the rows live inside a virtualised, clipping scroller — an in-flow menu
 * would be cut off by the row above it — and `useAnchoredCoords` re-measures on
 * scroll so the menu stays glued to its trigger instead of drifting away.
 */
function RowMenu({ label, items }: { label: string; items: { label: string; icon: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, 232, 232, 'below');
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="library-row-action library-row-action-neutral inline-flex h-7 w-7 items-center justify-center rounded-md text-base leading-none text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div role="menu" aria-label={label} className="library-row-menu fixed z-50 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-2xl" style={anchorStyle(coords)}>
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  <Icon name={item.icon} size={13} className="shrink-0 opacity-70" />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/** A clickable column header that cycles asc → desc → default on the shared sort. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      className={`group flex items-center gap-1 text-left font-medium hover:text-neutral-200 ${active ? 'text-neutral-100' : ''}`}
      onClick={() => onSort(sortKey)}
      title={t('Ordenar por esta columna')}
      aria-label={`${label} — ${t('Ordenar por esta columna')}`}
    >
      <span className="truncate">{label}</span>
      <Icon
        name={active && sort!.dir === 'asc' ? 'arrowUp' : 'arrowDown'}
        size={12}
        className={`shrink-0 ${active ? 'opacity-80' : 'opacity-0 group-hover:opacity-30'}`}
      />
    </button>
  );
}

export function Library({
  vaultId,
  target,
  vaultType,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
  onOpenArchive,
}: {
  vaultId: string | null;
  /** Incoming navigation that pre-applies a filter (e.g. a corpus-health bucket). */
  target?: LibraryNavigationTarget | null;
  vaultType?: VaultType;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenArchive?: () => void;
}) {
  // In records vaults the Library holds SECONDARY / published sources (books,
  // published genealogies, transcribed record collections) that can also be mined
  // for records; primary documents live in the Archive.
  const isRecordsVault = vaultType === 'genealogy' || vaultType === 'primary_sources';
  const [works, setWorks] = useState<WorkView[]>([]);
  const [totalWorks, setTotalWorks] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [filter, setFilter] = useState<WorkFilter>({});
  // Local, instantly-responsive text for the search box. It is debounced into
  // `filter.search` so keystrokes stay smooth even on large libraries.
  const [searchDraft, setSearchDraft] = useState('');
  const [availableZoteroTags, setAvailableZoteroTags] = useState<ZoteroTag[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [availableCollections, setAvailableCollections] = useState<CollectionFacet[]>([]);
  const [collectionFilterOpen, setCollectionFilterOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Map<string, WorkEmbeddingStatus>>(new Map());
  const [passageStatuses, setPassageStatuses] = useState<Map<string, WorkPassageStatus>>(new Map());
  const [reuseAnalysisFromVaults, setReuseAnalysisFromVaults] = useState(false);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [graphWork, setGraphWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [statusWork, setStatusWork] = useState<WorkView | null>(null);
  const [readerWork, setReaderWork] = useState<WorkView | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  // Live scan-queue items indexed by work. The persisted *_status fields go
  // 'pending' when a job is enqueued but never say whether it is waiting in line
  // or running right now, so this is the only way a row can show "Analizando…".
  const [queuedByWork, setQueuedByWork] = useState<Map<string, QueueItem[]>>(new Map());
  // Client-side ordering over the already-in-memory filtered set. `null` keeps
  // the backend order (year desc, title asc).
  const [sort, setSort] = useState<SortState | null>(null);
  const loadRequestRef = useRef(0);
  const tagFilterRef = useDismissableLayer<HTMLDivElement>({
    open: tagFilterOpen,
    onDismiss: () => setTagFilterOpen(false),
    group: 'library-filters',
  });
  const collectionFilterRef = useDismissableLayer<HTMLDivElement>({
    open: collectionFilterOpen,
    onDismiss: () => setCollectionFilterOpen(false),
    group: 'library-filters',
  });

  // Only the works list depends on the active filter, so typing in the search
  // box must reload nothing else. Keeping this isolated is what stops each
  // keystroke from firing five IPC round-trips against SQLite.
  const load = useCallback(async (force = true) => {
    const requestId = ++loadRequestRef.current;
    const cacheKey = `library:${JSON.stringify({ filter, pageOffset, sort })}`;
    if (!force) {
      const cached = getVaultQueryCache<{
        items: WorkView[];
        total: number;
        embeddings: WorkEmbeddingStatus[];
        passages: WorkPassageStatus[];
      }>(vaultId, cacheKey);
      if (cached) {
        setWorks(cached.items);
        setTotalWorks(cached.total);
        setEmbeddingStatuses(new Map(cached.embeddings.map((status) => [status.nodus_id, status])));
        setPassageStatuses(new Map(cached.passages.map((status) => [status.nodus_id, status])));
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    try {
      const page = await window.nodus.listWorksPage(filter, {
        offset: pageOffset,
        limit: LIBRARY_PAGE_SIZE,
        sort,
      });
      // A newer filter or refresh may have completed while this request was in
      // flight.  Never replace its results with stale rows.
      if (requestId !== loadRequestRef.current) return;
      if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
        setPageOffset(Math.max(0, Math.floor((page.total - 1) / LIBRARY_PAGE_SIZE) * LIBRARY_PAGE_SIZE));
        return;
      }
      setWorks(page.items);
      setTotalWorks(page.total);
      const ids = page.items.map((work) => work.nodus_id);
      const [statuses, passageIndexStatuses] = await Promise.all([
        window.nodus.getWorkEmbeddingStatuses(ids),
        window.nodus.getWorkPassageStatuses(ids),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setEmbeddingStatuses(new Map(statuses.map((status) => [status.nodus_id, status])));
      setPassageStatuses(new Map(passageIndexStatuses.map((status) => [status.nodus_id, status])));
      setVaultQueryCache(vaultId, cacheKey, {
        items: page.items,
        total: page.total,
        embeddings: statuses,
        passages: passageIndexStatuses,
      });
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [filter, pageOffset, sort, vaultId]);

  // Facets (tags, collections) and per-work index statuses are global — they do
  // not depend on the active filter. Load them once on mount and refresh only
  // when the underlying data actually changes, not on every filter change.
  const loadFacets = useCallback(async (force = true) => {
    if (!force) {
      const cached = getVaultQueryCache<{ tags: ZoteroTag[]; collections: CollectionFacet[] }>(vaultId, 'library:facets');
      if (cached) {
        setAvailableZoteroTags(cached.tags);
        setAvailableCollections(cached.collections);
        return;
      }
    }
    const [tags, collections] = await Promise.all([
      window.nodus.listZoteroTags(),
      window.nodus.listCollectionFacets(),
    ]);
    setAvailableZoteroTags(tags);
    setAvailableCollections(collections);
    setVaultQueryCache(vaultId, 'library:facets', { tags, collections });
  }, [vaultId]);

  useEffect(() => {
    void load(false);
  }, [load]);
  useEffect(() => {
    void loadFacets(false);
  }, [loadFacets]);

  // Stable reference so the event subscriptions below don't re-register on every
  // filter change (which happens on each debounced keystroke).
  const refreshAllRef = useRef<() => void>(() => {});
  refreshAllRef.current = () => {
    void load();
    void loadFacets();
  };
  useDataRefresh(() => refreshAllRef.current());
  // Once a queued analysis finishes, reapply the active tag/status predicate
  // without remounting the virtual list or losing the reader's scroll position.
  useScanComplete(() => refreshAllRef.current());
  useEffect(() => window.nodus.onPassageProgress((progress) => {
    if (!progress.running) refreshAllRef.current();
  }), []);
  // Seed from the current queue as well as subscribing: a reader arriving at the
  // Library mid-analysis would otherwise see nothing until the next queue event.
  useEffect(() => {
    let alive = true;
    void window.nodus.getQueue().then((progress) => {
      if (alive) setQueuedByWork(queueItemsByWork(progress.items));
    });
    const off = window.nodus.onQueueProgress((progress) => setQueuedByWork(queueItemsByWork(progress.items)));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Focus the list on a corpus-health bucket when the user clicks a health notice
  // on Home. The nonce re-triggers even if the same bucket is chosen twice. We
  // replace the whole filter so the list shows exactly the works that notice
  // counted, and clear any leftover search text.
  useEffect(() => {
    if (!target) return;
    setSearchDraft('');
    setFilter(target.healthBucket ? { healthBucket: target.healthBucket } : {});
  }, [target]);

  // Debounce the free-text search: push the draft into the filter only after the
  // user pauses, so a burst of keystrokes triggers one DB query instead of one
  // per character.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilter((f) => ((f.search ?? '') === searchDraft ? f : { ...f, search: searchDraft || undefined }));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchDraft]);

  const reuseSelectedAnalysis = async (ids: string[], skipKinds: VaultAnalysisReuseKind[]): Promise<string[]> => {
    if (!reuseAnalysisFromVaults || ids.length === 0) return ids;
    const result: VaultAnalysisReuseResult = await window.nodus.reuseVaultAnalysis(ids);
    const importedWorks = result.works.filter((work) => work.imported.length > 0);
    if (importedWorks.length > 0) {
      setReuseNotice(tx('Análisis reutilizado desde otras bóvedas para {n} obra(s).', { n: importedWorks.length }));
    } else {
      setReuseNotice(t('No se encontró análisis reutilizable en otras bóvedas para la selección.'));
    }
    const skipped = new Set(
      result.works
        .filter((work) => skipKinds.some((kind) => work.imported.includes(kind)))
        .map((work) => work.nodusId)
    );
    return ids.filter((id) => !skipped.has(id));
  };

  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light');
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep');
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true);
    }
    await load();
  };

  // Records lens: extract persons/places/events from a work's text into the tree.
  const scanRecords = async (w: WorkView) => {
    const r = await window.nodus.scanWorkRecords(w.nodus_id);
    if (r.noText) {
      toast(t('Esta obra no tiene texto para extraer registros.'), { tone: 'error' });
    } else {
      toast(
        t('Extraídos {p} personas y {e} eventos.').replace('{p}', String(r.persons)).replace('{e}', String(r.events)) +
          (r.suggestions ? ` ${t('{n} parentescos sugeridos.').replace('{n}', String(r.suggestions))}` : ''),
        { tone: 'success' }
      );
    }
  };

  const scanSelectedRecords = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    toast(tx('Extrayendo registros de {n} obra(s)…', { n: ids.length }));
    let persons = 0;
    let events = 0;
    for (const id of ids) {
      try {
        const r = await window.nodus.scanWorkRecords(id);
        if (!r.noText) {
          persons += r.persons;
          events += r.events;
        }
      } catch {
        /* skip a work that can't be resolved; the rest still run */
      }
    }
    toast(
      t('Extraídos {p} personas y {e} eventos de la Biblioteca.').replace('{p}', String(persons)).replace('{e}', String(events)),
      { tone: 'success' }
    );
  };

  // Full chain for a single work: themes → ideas → summary → index → relationships.
  const processFullWork = async (w: WorkView) => {
    await window.nodus.processFull(w.nodus_id);
    await load();
  };

  const summarizeWork = async (w: WorkView) => {
    await window.nodus.summarizeWork(w.nodus_id);
    await load();
  };

  const analyzeSelectedThemes = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['themes']);
    for (const id of pending) {
      await window.nodus.rescan(id, 'light');
    }
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedIdeas = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['ideas']);
    if (pending.length > 0) await window.nodus.setManualDeepBulk(pending, true);
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedBoth = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['ideas']);
    if (pending.length > 0) await window.nodus.analyzeBothBulk(pending);
    setSelected(new Set());
    await load();
  };

  // Full chain: themes → ideas → summary → index (ideas + passages) → discover relationships.
  const processFullSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['ideas']);
    if (pending.length > 0) await window.nodus.processFullBulk(pending);
    setSelected(new Set());
    await load();
  };

  const processFullLibrary = async () => {
    const ids: string[] = [];
    for (let offset = 0; offset < totalWorks; offset += 250) {
      const page = await window.nodus.listWorksPage(filter, { offset, limit: 250, sort: null });
      ids.push(...page.items.map((work) => work.nodus_id));
    }
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t('Procesar toda la biblioteca'),
      message: tx(
        'Procesar todo encadena para las {n} obra(s) filtrada(s): temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones. Es una operación larga que consume tokens del modelo seleccionado. ¿Continuar?',
        { n: ids.length }
      ),
      confirmLabel: t('Continuar'),
    });
    if (!ok) return;
    await window.nodus.processFullBulk(ids);
    setSelected(new Set());
    await load();
    toast(tx('Procesado completo en cola para {n} obra(s). Verás el progreso en la cola.', { n: ids.length }));
  };

  const summarizeSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['summary']);
    if (pending.length > 0) await window.nodus.summarizeBulk(pending);
    setSelected(new Set());
    await load();
  };

  const summarizeMissing = async () => {
    await window.nodus.summarizeAll();
    await load();
  };

  const reassignThemes = async () => {
    const ok = await confirm({
      title: t('Reasignar temas'),
      message: t('Reasignar temas vuelve a ejecutar el análisis ligero (título + abstract) sobre TODA la biblioteca para reconstruir los temas padre y agrupar las ideas existentes bajo ellos. Consume tokens del modelo seleccionado. ¿Continuar?'),
      confirmLabel: t('Continuar'),
    });
    if (!ok) return;
    const n = await window.nodus.reassignThemes();
    await load();
    toast(tx('Reasignación de temas en cola para {n} obra(s). Verás el progreso en la cola.', { n }));
  };

  const rescanAbstractOnly = async () => {
    const ok = await confirm({
      title: t('Reanalizar «solo abstract»'),
      message: t('Reanaliza las obras que solo se analizaron con el abstract (el PDF/EPUB no estaba disponible al analizarlas). Las que ya tengan el texto disponible en Zotero recuperarán el análisis completo; el resto se omiten sin coste. ¿Continuar?'),
      confirmLabel: t('Continuar'),
    });
    if (!ok) return;
    const n = await window.nodus.rescanDegraded();
    await load();
    if (n === 0) toast(t('No hay obras «solo abstract» para reanalizar.'), { tone: 'info' });
    else toast(tx('Reanálisis en cola para {n} obra(s) «solo abstract». Verás el progreso en la cola.', { n }));
  };

  const embedSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['ideaEmbeddings']);
    if (pending.length > 0) await window.nodus.startEmbedding(pending);
    setSelected(new Set());
  };

  const embedPending = async () => {
    await window.nodus.startEmbedding();
  };

  const indexSelectedPassages = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const pending = await reuseSelectedAnalysis(ids, ['passages']);
    if (pending.length > 0) await window.nodus.startPassageEmbedding(pending);
    setSelected(new Set());
    await load();
  };

  const indexAllPassages = async () => {
    await window.nodus.startPassageEmbedding();
  };

  const discoverBridges = async () => {
    await window.nodus.enqueueBridgeDiscovery();
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setReuseNotice(null);
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
  const selectedHealthBucket = filter.healthBucket ?? null;
  const selectedReadiness = filter.readiness ?? null;
  // Presets and the corpus-health buckets are both whole-corpus status filters;
  // letting them stack would mean two answers to the same question.
  const setReadiness = (readiness: Exclude<WorkReadiness, 'running'> | null) => {
    setPageOffset(0);
    setFilter((current) => ({ ...current, readiness: readiness ?? undefined, healthBucket: undefined }));
  };
  const searchValue = searchDraft;
  const hasActiveFilters =
    searchValue.trim().length > 0 ||
    selectedStatusFlags.length > 0 ||
    selectedZoteroTags.length > 0 ||
    selectedCollections.length > 0 ||
    selectedReadiness !== null ||
    selectedHealthBucket !== null;
  const clearHealthBucket = () => setFilter((c) => ({ ...c, healthBucket: undefined }));
  const toggleStatusFlag = (f: StatusFlag) =>
    setFilter((cur) => {
      const set = new Set(cur.statusFlags ?? []);
      const opposite = isNegated(f) ? dimensionOf(f) : (`!${dimensionOf(f)}` as StatusFlag);
      set.delete(opposite);
      if (set.has(f)) set.delete(f); else set.add(f);
      return { ...cur, statusFlags: [...set] };
    });
  const setStatusDimension = (dim: StatusDimension, state: 'off' | 'pos' | 'neg') =>
    setFilter((cur) => {
      const set = new Set(cur.statusFlags ?? []);
      set.delete(dim);
      set.delete(`!${dim}` as StatusFlag);
      if (state === 'pos') set.add(dim);
      else if (state === 'neg') set.add(`!${dim}` as StatusFlag);
      return { ...cur, statusFlags: [...set] };
    });
  const clearStatusFlags = () => setFilter((c) => ({ ...c, statusFlags: [] }));
  const clearAllFilters = () => {
    setFilter({});
    setSearchDraft('');
    setTagSearch('');
    setCollectionSearch('');
  };

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
  const selectAllVisible = () => {
    setReuseNotice(null);
    setSelected(new Set(works.map((work) => work.nodus_id)));
  };
  // Click a header: sort by it (default direction), flip direction on the second
  // click, and clear back to the backend order on the third.
  const cycleSort = (key: SortKey) =>
    setSort((cur) => {
      setPageOffset(0);
      const first = initialSortDir(key);
      if (!cur || cur.key !== key) return { key, dir: first };
      if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
      return null;
    });

  // Only the rendered list is reordered; selection, counts and batch actions keep
  // using `works` since they are order-independent.
  const sortedWorks = useMemo(() => {
    if (!sort) return works;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const value = (w: WorkView): number | string => {
      switch (sort.key) {
        case 'title':
          return w.title.toLocaleLowerCase();
        case 'authors':
          return (w.authors[0] ?? '').toLocaleLowerCase();
        case 'year':
          return w.year ?? Number.NEGATIVE_INFINITY;
        case 'themes':
          return (w.themes[0] ?? '').toLocaleLowerCase();
        case 'ideas':
          return w.ideaCount;
      }
    };
    return [...works].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      // Stable, predictable tiebreak so equal keys don't jitter between renders.
      return cmp !== 0 ? cmp * dir : a.title.localeCompare(b.title);
    });
  }, [works, sort]);

  /** One derived status per visible row, recomputed when its inputs move. */
  const statusByWork = useMemo(() => {
    const map = new Map<string, WorkStatus>();
    for (const w of works) {
      map.set(
        w.nodus_id,
        deriveWorkStatus(w, embeddingStatuses.get(w.nodus_id), passageStatuses.get(w.nodus_id), queuedByWork.get(w.nodus_id))
      );
    }
    return map;
  }, [works, embeddingStatuses, passageStatuses, queuedByWork]);

  if (readerWork) {
    return (
      <LibraryDocumentReader
        work={readerWork}
        onBack={() => setReaderWork(null)}
        onOpenAssistant={onOpenAssistant}
      />
    );
  }

  return (
    <div className="h-full flex flex-col p-6 min-h-0">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('Biblioteca')}</h1>
          <p className="text-sm text-neutral-500 mt-1">{tx('{n} obras visibles', { n: totalWorks })}</p>
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
            value={searchDraft}
            placeholder={t('Buscar título o autor…')}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <div className="relative" ref={tagFilterRef}>
            <button
              type="button"
              className={`library-filter-button zotero-tag-filter tone-indigo btn border gap-1.5 ${selectedZoteroTags.length ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setTagFilterOpen((open) => !open)}
              aria-expanded={tagFilterOpen}
              aria-haspopup="dialog"
            >
              <Icon name="tag" /> {t('Etiquetas Zotero')}
              {selectedZoteroTags.length > 0 && (
                <span className="library-filter-count zotero-tag-filter-count tone-indigo rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {selectedZoteroTags.length}
                </span>
              )}
            </button>
            {tagFilterOpen && (
              <div
                role="dialog"
                aria-label={t('Filtrar por etiquetas de Zotero')}
                className="library-filter-popover absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
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
          <div className="relative" ref={collectionFilterRef}>
            <button
              type="button"
              className={`library-filter-button collection-filter tone-cyan btn border gap-1.5 ${selectedCollections.length ? 'is-active border-cyan-700 bg-cyan-950/40 text-cyan-100' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setCollectionFilterOpen((open) => !open)}
              aria-expanded={collectionFilterOpen}
              aria-haspopup="dialog"
              disabled={availableCollections.length === 0}
              title={availableCollections.length === 0 ? t('Sincroniza para poder filtrar por colección.') : t('Filtrar por colección')}
            >
              <Icon name="folder" /> {t('Colección')}
              {selectedCollections.length > 0 && (
                <span className="library-filter-count tone-cyan rounded bg-cyan-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {selectedCollections.length}
                </span>
              )}
            </button>
            {collectionFilterOpen && (
              <div
                role="dialog"
                aria-label={t('Filtrar por colección')}
                className="library-filter-popover absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
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
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              onClick={clearAllFilters}
            >
              <Icon name="x" /> {t('Limpiar filtros')}
            </button>
          )}
          <div className="flex-1" />
        </div>
        {/* One-click status filters. These replaced a row of counters that showed
            the same information but could not be clicked, sitting next to a
            separate control that filtered by it. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`library-preset btn border px-2.5 py-1 text-xs ${
              selectedReadiness === null ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'
            }`}
            onClick={() => setReadiness(null)}
          >
            {t('Todo')}
          </button>
          {STATUS_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`library-preset btn border gap-1.5 px-2.5 py-1 text-xs ${
                selectedReadiness === preset
                  ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100'
                  : 'btn-ghost border-neutral-700'
              }`}
              onClick={() => setReadiness(selectedReadiness === preset ? null : preset)}
            >
              <Icon name={READINESS_ICON[preset]} size={12} className="opacity-70" />
              {t(READINESS_LABEL[preset])}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            className={`btn border px-2.5 py-1 text-xs ${
              advancedFiltersOpen || selectedStatusFlags.length > 0
                ? 'is-active border-neutral-600 bg-neutral-800 text-neutral-100'
                : 'btn-ghost border-neutral-700'
            }`}
            onClick={() => setAdvancedFiltersOpen((v) => !v)}
            aria-expanded={advancedFiltersOpen}
          >
            {t('Filtros avanzados')}
            {selectedStatusFlags.length > 0 && (
              <span className="ml-1.5 tabular-nums opacity-80">{selectedStatusFlags.length}</span>
            )}
          </button>
        </div>
        {advancedFiltersOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
            <StatusFlagsPicker
              value={selectedStatusFlags}
              setDimension={setStatusDimension}
              onClear={clearStatusFlags}
            />
            <span className="text-xs text-neutral-500">
              {t('Combina condiciones sueltas de la tubería de análisis. Los presets de arriba cubren los casos habituales.')}
            </span>
          </div>
        )}
        {selectedZoteroTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Etiquetas:')}</span>
            {selectedZoteroTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="library-active-chip tone-indigo zotero-tag-chip inline-flex items-center gap-1 rounded-md border border-indigo-800/70 bg-indigo-950/30 px-2 py-1 text-indigo-200 hover:bg-indigo-950/60"
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
                className="library-active-chip tone-cyan inline-flex items-center gap-1 rounded-md border border-cyan-800/70 bg-cyan-950/30 px-2 py-1 text-cyan-200 hover:bg-cyan-950/60"
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
        {selectedHealthBucket && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Salud del corpus:')}</span>
            <button
              type="button"
              className="library-active-chip tone-amber inline-flex items-center gap-1 rounded-md border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-200 hover:bg-amber-950/60"
              onClick={clearHealthBucket}
              title={`${t('Quitar')} ${healthBucketLabel(selectedHealthBucket)}`}
            >
              {healthBucketLabel(selectedHealthBucket)} <Icon name="x" size={12} />
            </button>
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
                  className={`library-active-chip ${neg ? 'tone-red' : 'tone-indigo'} inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:opacity-80 ${
                    neg
                      ? 'border-red-800/70 bg-red-950/30 text-red-200'
                      : 'border-indigo-800/70 bg-indigo-950/30 text-indigo-200'
                  }`}
                  onClick={() => toggleStatusFlag(flag)}
                  title={`${t('Quitar')} ${t(labelFor(flag))}`}
                >
                  {t(labelFor(flag))} <Icon name="x" size={12} />
                </button>
              );
            })}
            <span className="ml-1">{t('deben cumplir todas')}</span>
          </div>
        )}
      </div>

      {!loading && works.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>{tx('{n} resultados con los filtros actuales', { n: totalWorks })}</span>
          <button
            className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
            onClick={() => {
              setReuseNotice(null);
              if (allVisibleSelected) setSelected(new Set());
              else selectAllVisible();
            }}
          >
            <Icon name={allVisibleSelected ? 'x' : 'check'} size={13} />
            {allVisibleSelected ? t('Quitar selección') : tx('Seleccionar los {n} de esta página', { n: works.length })}
          </button>
          <button
            className="btn btn-primary px-2 py-1 text-xs"
            onClick={processFullLibrary}
            title={t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones para toda la biblioteca filtrada.')}
          >
            <Icon name="compass" size={13} /> {t('Procesar biblioteca')}
          </button>
        </div>
      )}

      {isRecordsVault && (
        <div className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/10 px-3 py-2 text-xs text-neutral-400">
          {t('En este modo la Biblioteca guarda fuentes secundarias o publicadas (libros, genealogías impresas, historias locales, colecciones de registros transcritas) importadas desde Zotero. Puedes extraer de ellas personas y eventos hacia el árbol con «Extraer personas y eventos». Los documentos originales (partidas, censos, cartas, fotos) van en el Archivo.')}
          {onOpenArchive && (
            <button className="ml-1 text-amber-400 hover:underline" onClick={onOpenArchive}>
              {t('Ir al Archivo')}
            </button>
          )}
        </div>
      )}

      {selectedVisibleIds.length > 0 && (
        <div className="mb-3 rounded-lg border border-indigo-800/70 bg-indigo-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-200">{tx('{n} seleccionadas', { n: selectedVisibleIds.length })}</span>
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          <label
            className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-indigo-800/70 bg-indigo-950/30 px-2.5 py-1.5 text-xs text-indigo-100"
            title={t('Busca coincidencias en otras bóvedas y, si encuentra ideas, embeddings, resúmenes o pasajes ya generados, los importa antes de usar IA.')}
          >
            <input
              type="checkbox"
              checked={reuseAnalysisFromVaults}
              onChange={(e) => {
                setReuseNotice(null);
                setReuseAnalysisFromVaults(e.target.checked);
              }}
            />
            <span className="min-w-0 leading-4">{t('Reutilizar análisis de otras bóvedas')}</span>
          </label>
          {reuseNotice && <span className="min-w-0 max-w-full text-xs text-indigo-200/80">{reuseNotice}</span>}
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          {/* One verb, with the scope spelled out. The partial verbs live in the
              menu: offering seven equally-weighted buttons was what made this bar
              read as seven unrelated decisions instead of one. */}
          <button
            className="btn btn-primary"
            onClick={processFullSelected}
            title={t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones.')}
          >
            <Icon name="compass" /> {tx('Analizar las {n} seleccionadas', { n: selectedVisibleIds.length })}
          </button>
          {/* Not a pipeline step in records vaults — it is what the view is for. */}
          {isRecordsVault && (
            <button
              className="btn btn-ghost border border-amber-700/70 text-amber-300"
              onClick={() => void scanSelectedRecords()}
              title={t('Extraer personas, lugares y eventos de estas obras hacia el árbol')}
            >
              <Icon name="users" /> {t('Extraer personas y eventos')}
            </button>
          )}
          <RowMenu
            label={t('Analizar solo un paso')}
            items={[
              { label: t('Analizar solo temas'), icon: 'tag', onClick: () => void analyzeSelectedThemes() },
              { label: t('Analizar solo ideas'), icon: 'bulb', onClick: () => void analyzeSelectedIdeas() },
              { label: t('Analizar temas e ideas'), icon: 'layers', onClick: () => void analyzeSelectedBoth() },
              { label: t('Generar resumen'), icon: 'wand', onClick: () => void summarizeSelected() },
              { label: t('Preparar búsqueda semántica'), icon: 'search', onClick: () => void embedSelected() },
              { label: t('Indexar texto citable'), icon: 'book', onClick: () => void indexSelectedPassages() },
            ]}
          />
          <div className="flex-1" />
          <button
            className="btn btn-ghost"
            onClick={() => {
              setReuseNotice(null);
              setSelected(new Set());
            }}
          >
            {t('Limpiar selección')}
          </button>
        </div>
      )}

      {reuseNotice && selectedVisibleIds.length === 0 && (
        <div className="mb-3 rounded-md border border-indigo-800/70 bg-indigo-950/20 px-3 py-2 text-xs text-indigo-200">
          {reuseNotice}
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
            icon="bulb"
            title={t('Reanalizar «solo abstract»')}
            description={t('Vuelve a analizar las obras cuyo análisis profundo solo usó el abstract porque el PDF/EPUB no estaba disponible. Las que ya tengan el texto recuperan el análisis completo; el resto se omiten sin coste.')}
            buttonLabel={t('Reanalizar')}
            onClick={rescanAbstractOnly}
          />
          {/* Two indexes, each named for what it gives the reader. There used to be
              five cards saying "Indexar", two of them called "todo" and meaning
              opposite things. */}
          <OperationCard
            icon="search"
            title={t('Preparar búsqueda semántica')}
            description={t('Genera los embeddings que faltan para poder encontrar ideas por significado. No regenera los existentes.')}
            buttonLabel={t('Preparar las que falten')}
            tone="cyan"
            onClick={embedPending}
          />
          <OperationCard
            icon="book"
            title={t('Indexar texto citable')}
            description={t('Indexa los fragmentos de texto completo que falten o estén obsoletos, en toda la biblioteca. No requiere análisis de ideas y los ya actuales se omiten.')}
            buttonLabel={t('Indexar lo que falte')}
            tone="cyan"
            onClick={indexAllPassages}
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
                  setReuseNotice(null);
                  if (e.target.checked) selectAllVisible();
                  else setSelected(new Set());
                }}
              />
          </div>
          <SortHeader label={t('Título')} sortKey="title" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Autores')} sortKey="authors" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Año')} sortKey="year" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Tema(s)')} sortKey="themes" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Ideas')} sortKey="ideas" sort={sort} onSort={cycleSort} />
          <div className="font-medium">{t('Estado')}</div>
          <div className="font-medium" data-tour="library-actions">{t('Acciones')}</div>
        </div>
        {loading ? (
          <div className="p-4 text-neutral-500">{t('Cargando...')}</div>
        ) : (
          <VirtualList
            items={sortedWorks}
            itemHeight={LIBRARY_ROW_HEIGHT}
            getKey={(w) => w.nodus_id}
            className="flex-1 min-h-0"
            empty={<div className="p-4 text-neutral-500">{t('No hay obras con los filtros actuales.')}</div>}
            renderItem={(w) => {
              const status = statusByWork.get(w.nodus_id);
              return (
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
                    title={t('Abrir lector limpio')}
                    onClick={() => setReaderWork(w)}
                  >
                    {w.title}
                  </button>
                </div>
                <div className="p-1 min-w-0 truncate text-neutral-400">
                  {w.authors[0] ?? '—'}
                  {w.authors.length > 1 ? ' et al.' : ''}
                </div>
                <div className="p-1 text-neutral-400">{w.year ?? '—'}</div>
                <div className="p-1 text-neutral-400 truncate">{w.themes.join(', ')}</div>
                <div className="p-1">
                  {w.ideaCount > 0 ? (
                    <button
                      className="tabular-nums text-neutral-300 hover:text-indigo-300 hover:underline"
                      title={tx('Ver las {n} ideas de esta obra', { n: w.ideaCount })}
                      onClick={() => setIdeasWork({ nodus_id: w.nodus_id, title: w.title })}
                    >
                      {w.ideaCount}
                    </button>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </div>
                <div className="min-w-0 p-1">
                  {status && <StatusPill status={status} onClick={() => setStatusWork(w)} />}
                </div>
                <div className="p-1 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <button
                      className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                      title={t('Analizar: temas, ideas, resumen, indexado y relaciones')}
                      onClick={() => processFullWork(w)}
                    >
                      {t('Analizar')}
                    </button>
                    <RowIconButton
                      title={t('Abrir lector limpio')}
                      icon="book"
                      tone="cyan"
                      onClick={() => setReaderWork(w)}
                    />
                    {/* The column is nullable in SQLite despite the non-null type, and demo
                        vaults carry synthetic keys that open nothing. */}
                    {w.zotero_key && (
                      <RowIconButton
                        title={t('Abrir en Zotero')}
                        icon="external"
                        tone="indigo"
                        onClick={() => window.nodus.openInZotero(w.zotero_key)}
                      />
                    )}
                    <RowMenu
                      label={t('Más acciones')}
                      items={[
                        {
                          label: t('Abrir lector limpio'),
                          icon: 'book',
                          onClick: () => setReaderWork(w),
                        },
                        ...(isRecordsVault
                          ? [{
                              label: t('Extraer personas y eventos'),
                              icon: 'users',
                              onClick: () => void scanRecords(w),
                            }]
                          : []),
                        { label: t('Analizar solo temas'), icon: 'tag', onClick: () => void analyzeThemes(w) },
                        {
                          label: w.deep_status === 'done' ? t('Reanalizar solo ideas') : t('Analizar solo ideas'),
                          icon: 'bulb',
                          onClick: () => void analyzeIdeas(w),
                        },
                        {
                          label: w.summary_status === 'done' ? t('Regenerar resumen') : t('Generar resumen'),
                          icon: 'wand',
                          onClick: () => void summarizeWork(w),
                        },
                        {
                          label: t('Grafo de ideas de la obra'),
                          icon: 'network',
                          disabled: w.deep_status !== 'done',
                          onClick: () => setGraphWork({ nodus_id: w.nodus_id, title: w.title }),
                        },
                        {
                          label: t('Ver esta obra en el grafo'),
                          icon: 'map',
                          onClick: () =>
                            onOpenGraph({
                              preset: 'reading',
                              workId: w.nodus_id,
                              workTitle: w.title,
                              zoteroKey: w.zotero_key,
                              label: `${t('Lectura:')} ${w.title}`,
                            }),
                        },
                        {
                          label: t('Preguntar al asistente'),
                          icon: 'chat',
                          onClick: () =>
                            onOpenAssistant({
                              title: `${t('Lectura:')} ${w.title}`,
                              selection: ASSISTANT_CONTEXTS.reading,
                              prompt:
                                `${t('Analiza esta lectura dentro del corpus: ideas extraídas, temas, huecos, contradicciones y próximas lecturas relacionadas.')}\n\n` +
                                `${w.title}\n${w.authors.join(', ')}${w.year ? ` (${w.year})` : ''}`,
                            }),
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
              );
            }}
          />
        )}
        {!loading && totalWorks > LIBRARY_PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-2 text-xs text-neutral-500">
            <span>
              {pageOffset + 1}–{Math.min(pageOffset + works.length, totalWorks)} / {totalWorks}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                disabled={pageOffset === 0}
                onClick={() => setPageOffset((offset) => Math.max(0, offset - LIBRARY_PAGE_SIZE))}
              >
                <Icon name="arrowLeft" size={13} /> {t('Anterior')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                disabled={pageOffset + works.length >= totalWorks}
                onClick={() => setPageOffset((offset) => offset + LIBRARY_PAGE_SIZE)}
              >
                {t('Siguiente')} <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
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
      {statusWork && statusByWork.get(statusWork.nodus_id) && (
        <WorkStatusModal
          work={statusWork}
          status={statusByWork.get(statusWork.nodus_id)!}
          onClose={() => setStatusWork(null)}
          onChanged={() => void load()}
        />
      )}
      {duplicatesOpen && <DuplicatesModal onClose={() => setDuplicatesOpen(false)} />}
    </div>
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
  tone?: 'neutral' | 'indigo' | 'cyan' | 'violet' | 'amber';
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
          : tone === 'amber'
            ? 'text-amber-400 hover:text-amber-300'
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
