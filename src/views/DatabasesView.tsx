import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AiBadge, Icon } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import {
  ADD_COLUMN_WIDTH,
  CheckboxCell,
  chipStyle,
  defaultColumnWidth,
  GUTTER_WIDTH,
  LongTextCell,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  OPTION_COLORS,
  ROW_HEIGHT,
  TextCell,
  useAnchoredCoords,
} from '../components/dbGrid';
import { confirm, toast } from '../components/feedback';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';
import {
  attachmentKind,
  availableColumnTypes,
  columnTypeDef,
  decodeMultiSelect,
  encodeMultiSelect,
  RELATION_TARGET_KINDS,
  ROLLUP_FUNCTIONS,
  type RollupFunction,
} from '@shared/databases';
import { AI_COLUMN_PRESETS } from '@shared/databaseAi';
import { matchFilesToRows } from '@shared/databaseBulk';
import {
  applyDatabaseFilter,
  sortDatabaseRows,
  isFilterActive,
  operatorsForType,
  isColumnFilterable,
  opNeedsValue,
  opLabel,
  type DatabaseFilterState,
  type DatabaseSavedView,
  type FilterCondition,
  type FilterGroup,
  type SortRule,
} from '@shared/databaseFilters';
import type {
  DatabaseAttachment,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRelation,
  DatabaseRow,
  DatabaseSelectOption,
  RelationTarget,
  RelationTargetKind,
} from '@shared/types';

/** A one-line preview string for a cell, used by "fit to content" width estimation. */
function cellPreview(col: DatabaseColumn, row: DatabaseRow): string {
  const raw = row.cells[col.id] ?? null;
  if (col.type === 'select') return col.options.find((o) => o.id === raw)?.label ?? '';
  if (col.type === 'multi_select')
    return decodeMultiSelect(raw)
      .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
      .join(' ');
  if (col.type === 'attachment' || col.type === 'ai_image') return (row.attachments?.[col.id] ?? []).map((a) => a.fileName ?? '').join(' ');
  return raw ?? '';
}

export interface DatabasesViewProps {
  databaseId: string | null;
  /** Called after any change that affects the sidebar list or row counts. */
  onDatabasesChanged: () => void | Promise<unknown>;
  onCreateDatabase: () => void;
  /** A row to open in the record modal on arrival (from the search view). */
  initialRowId?: string | null;
  /** Called once the initialRowId has been consumed, so the parent can clear it. */
  onConsumeInitialRow?: () => void;
}

export function DatabasesView({ databaseId, onDatabasesChanged, onCreateDatabase, initialRowId, onConsumeInitialRow }: DatabasesViewProps) {
  const [detail, setDetail] = useState<DatabaseDetail | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [stats, setStats] = useState<{ rowCount: number; vaultTotal: number; percent: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'gallery'>('table');
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filter, setFilter] = useState<DatabaseFilterState>({ conjunction: 'and', conditions: [] });
  const [sorts, setSorts] = useState<SortRule[]>([]);
  const [views, setViews] = useState<DatabaseSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [d, r, s] = await Promise.all([
        window.nodus.getDatabaseDetail(id),
        window.nodus.listDatabaseRows(id, { sort: 'position' }),
        window.nodus.databaseStats(id),
      ]);
      setDetail(d);
      setRows(r);
      setStats(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!databaseId) {
      setDetail(null);
      setRows([]);
      setStats(null);
      return;
    }
    void load(databaseId);
  }, [databaseId, load]);

  // Deep-link from the search view: open a specific row's record on arrival.
  useEffect(() => {
    if (initialRowId) {
      setOpenRowId(initialRowId);
      onConsumeInitialRow?.();
    }
  }, [initialRowId, onConsumeInitialRow]);

  const columns = detail?.columns ?? [];
  const hasAttachmentColumn = columns.some((c) => c.type === 'attachment');
  const filterActive = isFilterActive(filter);

  const reloadViews = useCallback(async () => {
    if (!databaseId) {
      setViews([]);
      return;
    }
    setViews(await window.nodus.listDatabaseViews(databaseId));
  }, [databaseId]);
  // Reset the active filter/sort/view when the open database changes.
  useEffect(() => {
    setFilter({ conjunction: 'and', conditions: [] });
    setSorts([]);
    setActiveViewId(null);
    void reloadViews();
  }, [databaseId, reloadViews]);

  const applyView = useCallback((v: DatabaseSavedView | null) => {
    setActiveViewId(v?.id ?? null);
    setFilter(v?.filter ?? { conjunction: 'and', conditions: [] });
    setSorts(v?.sorts ?? []);
    if (v) setViewMode(v.layout);
  }, []);
  const saveAsView = useCallback(async () => {
    if (!databaseId) return;
    const name = window.prompt(t('Nombre de la vista'), t('Nueva vista'));
    if (!name || !name.trim()) return;
    const v = await window.nodus.createDatabaseView(databaseId, { name: name.trim(), layout: viewMode, filter, sorts });
    await reloadViews();
    setActiveViewId(v.id);
  }, [databaseId, viewMode, filter, sorts, reloadViews]);
  const updateActiveView = useCallback(async () => {
    if (!activeViewId) return;
    await window.nodus.updateDatabaseView(activeViewId, { layout: viewMode, filter, sorts });
    await reloadViews();
    toast(t('Vista actualizada.'));
  }, [activeViewId, viewMode, filter, sorts, reloadViews]);
  const removeView = useCallback(
    async (id: string) => {
      await window.nodus.deleteDatabaseView(id);
      if (activeViewId === id) applyView(null);
      await reloadViews();
    },
    [activeViewId, applyView, reloadViews]
  );

  // Client-side filter + sort over the loaded rows.
  const visibleRows = useMemo(
    () => sortDatabaseRows(applyDatabaseFilter(rows, columns, filter), columns, sorts),
    [rows, columns, filter, sorts]
  );

  // Refresh + toast when a bulk upload (possibly running in the background) finishes.
  useEffect(() => {
    if (!databaseId) return;
    return window.nodus.onDatabaseBulkProgress((p) => {
      if (p.databaseId === databaseId && p.finished) {
        void load(databaseId);
        toast(tx('Subida masiva: {a} de {m} archivos adjuntados.', { a: p.attached, m: p.matched }));
      }
    });
  }, [databaseId, load]);

  // Refresh the rows when a batch AI-column run reaches its last row.
  useEffect(() => {
    if (!databaseId) return;
    return window.nodus.onDatabaseAiProgress((p) => {
      if (p.total > 0 && p.done >= p.total) void load(databaseId);
    });
  }, [databaseId, load]);

  const refreshStats = useCallback(async () => {
    if (!databaseId) return;
    setStats(await window.nodus.databaseStats(databaseId));
  }, [databaseId]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const reloadColumns = useCallback(async () => {
    if (!databaseId) return;
    setDetail(await window.nodus.getDatabaseDetail(databaseId));
  }, [databaseId]);

  // Structural column changes (add/change-type/delete, relation & rollup config) can
  // change derived cell values (rollups, relation counts), so reload rows too.
  const reloadColumnsAndRows = useCallback(async () => {
    if (!databaseId) return;
    const [d, r] = await Promise.all([
      window.nodus.getDatabaseDetail(databaseId),
      window.nodus.listDatabaseRows(databaseId, { sort: 'position' }),
    ]);
    setDetail(d);
    setRows(r);
  }, [databaseId]);

  const addRow = useCallback(async () => {
    if (!databaseId) return;
    const row = await window.nodus.createDatabaseRow(databaseId);
    setRows((prev) => [...prev, row]);
    void refreshStats();
    void onDatabasesChanged();
    notifyDataChanged();
  }, [databaseId, refreshStats, onDatabasesChanged]);

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (!(await confirm({ title: t('Eliminar fila'), message: t('¿Eliminar esta fila?'), danger: true }))) return;
      await window.nodus.deleteDatabaseRow(rowId);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      void refreshStats();
      void onDatabasesChanged();
      notifyDataChanged();
    },
    [refreshStats, onDatabasesChanged]
  );

  const refreshRow = useCallback(async (rowId: string) => {
    const updated = await window.nodus.getDatabaseRow(rowId);
    if (updated) setRows((prev) => prev.map((r) => (r.id === rowId ? updated : r)));
  }, []);

  // Columns configured to auto-recompute when their row changes.
  const autoAiColumns = useMemo(() => columns.filter((c) => c.type === 'ai' && c.config.aiAuto), [columns]);

  const setCell = useCallback(
    async (rowId: string, columnId: string, raw: string | null) => {
      // Optimistic local update, then persist.
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [columnId]: raw } } : r)));
      const updated = await window.nodus.setDatabaseCell(rowId, columnId, raw);
      if (updated) setRows((prev) => prev.map((r) => (r.id === rowId ? updated : r)));
      // Fire any auto AI columns (opt-in per column), then refresh the row.
      const auto = autoAiColumns.filter((c) => c.id !== columnId);
      if (auto.length > 0) {
        await Promise.all(auto.map((c) => window.nodus.runDatabaseAiCell(rowId, c.id).catch(() => undefined)));
        await refreshRow(rowId);
      }
    },
    [autoAiColumns, refreshRow]
  );

  const renameDatabase = useCallback(
    async (name: string) => {
      if (!databaseId) return;
      const updated = await window.nodus.renameDatabase(databaseId, name);
      if (updated) setDetail((prev) => (prev ? { ...prev, database: updated } : prev));
      void onDatabasesChanged();
    },
    [databaseId, onDatabasesChanged]
  );

  const deleteDatabase = useCallback(async () => {
    if (!databaseId || !detail) return;
    const ok = await confirm({
      title: t('Eliminar base de datos'),
      message: tx('¿Eliminar la base de datos «{name}»? Se borrarán todas sus filas y columnas.', {
        name: detail.database.name,
      }),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteDatabase(databaseId);
    await onDatabasesChanged();
    notifyDataChanged();
  }, [databaseId, detail, onDatabasesChanged]);

  const addColumn = useCallback(
    async (name: string, type: DatabaseColumnType) => {
      if (!databaseId) return;
      await window.nodus.createDatabaseColumn(databaseId, name, type);
      await reloadColumnsAndRows();
    },
    [databaseId, reloadColumnsAndRows]
  );

  // ── Column widths (resize / fit) + reorder ─────────────────────────────────
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>({});
  const widthOf = useCallback(
    (col: DatabaseColumn) =>
      widthOverrides[col.id] ?? (typeof col.config.width === 'number' ? col.config.width : defaultColumnWidth(col.type)),
    [widthOverrides]
  );
  const persistWidth = useCallback(
    async (col: DatabaseColumn, w: number) => {
      await window.nodus.updateDatabaseColumn(col.id, { config: { ...col.config, width: w } });
      await reloadColumns();
    },
    [reloadColumns]
  );
  const startResize = useCallback(
    (col: DatabaseColumn, startX: number) => {
      const startW = widthOf(col);
      const clamp = (w: number) => Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, w));
      const onMove = (e: MouseEvent) => setWidthOverrides((prev) => ({ ...prev, [col.id]: clamp(startW + (e.clientX - startX)) }));
      const onUp = (e: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        void persistWidth(col, clamp(startW + (e.clientX - startX)));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [widthOf, persistWidth]
  );
  const fitColumn = useCallback(
    (col: DatabaseColumn) => {
      const maxLen = rows.reduce((m, r) => Math.max(m, cellPreview(col, r).length), col.name.length);
      const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, maxLen * 8 + 48));
      setWidthOverrides((prev) => ({ ...prev, [col.id]: w }));
      void persistWidth(col, w);
    },
    [rows, persistWidth]
  );
  const reorderColumn = useCallback(
    async (fromId: string, toId: string) => {
      if (fromId === toId || !databaseId) return;
      const ids = columns.map((c) => c.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await window.nodus.reorderDatabaseColumns(databaseId, ids);
      await reloadColumns();
    },
    [columns, databaseId, reloadColumns]
  );

  const totalWidth = GUTTER_WIDTH + columns.reduce((sum, c) => sum + widthOf(c), 0) + ADD_COLUMN_WIDTH;

  if (!databaseId || !detail) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
        <Icon name="table" size={40} className="text-neutral-600" />
        <div>
          <h2 className="text-lg font-semibold">{t('Selecciona o crea una base de datos')}</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {t('Las bases de datos aparecen en la barra lateral. Crea la primera para empezar.')}
          </p>
        </div>
        <button className="btn btn-primary gap-1.5" onClick={onCreateDatabase}>
          <Icon name="plus" /> {t('Nueva base de datos')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={detail.database.icon || 'table'} className="text-indigo-400 shrink-0" size={20} />
          <DatabaseTitle name={detail.database.name} onRename={renameDatabase} />
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 shrink-0">
            {detail.database.shortId}
          </span>
          {stats && (
            <span className="text-xs text-neutral-500 shrink-0 whitespace-nowrap">
              {stats.rowCount.toLocaleString()} {t('entradas')} <span className="opacity-70">({stats.percent}%)</span>
              {filterActive && <span className="ml-1">· {tx('{n} filtradas', { n: visibleRows.length })}</span>}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-[1rem]" />
        <div className="flex items-center gap-1.5 shrink-0">
          <FilterButton columns={columns} filter={filter} onChange={setFilter} />
          <SortButton columns={columns} sorts={sorts} onChange={setSorts} />
          <div className="flex items-center rounded-lg border border-neutral-700 overflow-hidden">
            <button
              className={`px-2 py-1 flex items-center ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('table')}
              title={t('Tabla')}
            >
              <Icon name="list" size={14} />
            </button>
            <button
              className={`px-2 py-1 flex items-center ${viewMode === 'gallery' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('gallery')}
              title={t('Galería')}
            >
              <Icon name="grid" size={14} />
            </button>
          </div>
          {hasAttachmentColumn && (
            <button className="btn btn-ghost gap-1.5" title={t('Subida masiva de archivos')} onClick={() => setBulkOpen(true)}>
              <Icon name="upload" />
            </button>
          )}
          <button className="btn btn-primary gap-1.5" onClick={() => void addRow()}>
            <Icon name="plus" /> {t('Nueva fila')}
          </button>
          <ExportButton databaseId={databaseId} />
          <button className="btn btn-ghost text-red-400" title={t('Eliminar base de datos')} onClick={() => void deleteDatabase()}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {/* Saved-view tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-neutral-800 overflow-x-auto">
        <button
          className={`text-xs px-2 py-1 rounded shrink-0 ${activeViewId === null ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
          onClick={() => applyView(null)}
        >
          {t('Todas')}
        </button>
        {views.map((v) => (
          <div key={v.id} className="flex items-center group/vtab shrink-0">
            <button
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${activeViewId === v.id ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
              onClick={() => applyView(v)}
            >
              <Icon name={v.layout === 'gallery' ? 'grid' : 'list'} size={11} className="opacity-60" />
              {v.name}
            </button>
            {activeViewId === v.id && (
              <button
                className="opacity-0 group-hover/vtab:opacity-100 text-neutral-600 hover:text-red-400 ml-0.5"
                title={t('Eliminar vista')}
                onClick={() => void removeView(v.id)}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        ))}
        <button className="text-xs px-1.5 py-1 rounded text-neutral-500 hover:text-neutral-300 shrink-0" title={t('Guardar vista actual')} onClick={() => void saveAsView()}>
          <Icon name="plus" size={12} />
        </button>
        {activeViewId && (
          <button className="text-xs px-2 py-1 rounded text-indigo-400 hover:bg-neutral-800 shrink-0" onClick={() => void updateActiveView()}>
            {t('Actualizar vista')}
          </button>
        )}
      </div>

      {/* Table */}
      {viewMode === 'table' && (
        <div className="flex-1 min-h-0 overflow-x-auto" data-tour="db-table">
          <div style={{ minWidth: totalWidth }} className="h-full flex flex-col">
            {/* Header row */}
            <div className="flex border-b border-neutral-800 bg-neutral-900/40 sticky top-0 z-10">
              <div style={{ width: GUTTER_WIDTH }} className="shrink-0" />
              {columns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  column={col}
                  width={widthOf(col)}
                  onChanged={reloadColumnsAndRows}
                  onResizeStart={(x) => startResize(col, x)}
                  onFit={() => fitColumn(col)}
                  onReorder={reorderColumn}
                />
              ))}
              <AddColumnButton onAdd={addColumn} />
            </div>

            {/* Body */}
            <VirtualList
              className="flex-1 min-h-0"
              items={visibleRows}
              itemHeight={ROW_HEIGHT}
              getKey={(r) => r.id}
              empty={
                <div className="p-8 text-center text-sm text-neutral-500">
                  {columns.length === 0
                    ? t('Añade una columna para empezar.')
                    : filterActive && rows.length > 0
                      ? t('Ninguna fila coincide con los filtros.')
                      : t('Sin filas todavía. Añade la primera.')}
                </div>
              }
              renderItem={(row) => (
                <div className="flex border-b border-neutral-900 hover:bg-neutral-900/40 group" style={{ height: ROW_HEIGHT }}>
                  <div style={{ width: GUTTER_WIDTH }} className="shrink-0 flex items-center justify-center gap-1">
                    <button
                      className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-indigo-400 transition-opacity"
                      title={t('Abrir ficha')}
                      onClick={() => setOpenRowId(row.id)}
                    >
                      <Icon name="external" size={13} />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity"
                      title={t('Eliminar fila')}
                      onClick={() => void deleteRow(row.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                  {columns.map((col) => (
                    <Cell
                      key={col.id}
                      column={col}
                      width={widthOf(col)}
                      value={row.cells[col.id] ?? null}
                      rollup={row.rollups?.[col.id] ?? ''}
                      rowId={row.id}
                      attachments={row.attachments?.[col.id] ?? []}
                      onChange={(raw) => void setCell(row.id, col.id, raw)}
                      onOptionsChanged={reloadColumns}
                      onAttachmentsChanged={() => void refreshRow(row.id)}
                    />
                  ))}
                  <div style={{ width: ADD_COLUMN_WIDTH }} className="shrink-0" />
                </div>
              )}
            />
          </div>
        </div>
      )}

      {/* Gallery */}
      {viewMode === 'gallery' && (
        <GalleryView rows={visibleRows} columns={columns} onOpen={(id) => setOpenRowId(id)} />
      )}

      {loading && <div className="px-4 py-1 text-xs text-neutral-600">{t('Cargando…')}</div>}

      {openRowId && detail && (
        <RecordModal
          databaseName={detail.database.name}
          columns={columns}
          rowId={openRowId}
          onClose={() => setOpenRowId(null)}
          onChanged={() => {
            void refreshRow(openRowId);
            void reloadColumns();
          }}
        />
      )}

      {bulkOpen && databaseId && (
        <BulkUploadModal
          databaseId={databaseId}
          columns={columns}
          rows={rows}
          onClose={() => setBulkOpen(false)}
          onDone={() => void load(databaseId)}
        />
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

function ExportButton({ databaseId }: { databaseId: string }) {
  const [open, setOpen] = useState(false);
  const doExport = async (format: 'csv' | 'xlsx' | 'json') => {
    setOpen(false);
    const res = await window.nodus.exportDatabase(databaseId, format);
    if (!res.canceled && res.path) toast(tx('Exportado a {p}', { p: res.path }));
  };
  return (
    <div className="relative">
      <button className="btn btn-ghost gap-1.5" title={t('Exportar')} onClick={() => setOpen((v) => !v)}>
        <Icon name="download" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full right-0 mt-1 w-40 card-modal p-1 text-sm">
            {(['csv', 'xlsx', 'json'] as const).map((f) => (
              <button key={f} className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 flex items-center gap-2" onClick={() => void doExport(f)}>
                <Icon name="download" size={13} className="opacity-60" />
                {f === 'csv' ? 'CSV' : f === 'xlsx' ? 'Excel (XLSX)' : 'JSON'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Filter + sort ─────────────────────────────────────────────────────────────

function newFilterCondition(filterable: DatabaseColumn[]): FilterCondition {
  const col = filterable[0];
  return { id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, columnId: col.id, op: operatorsForType(col.type)[0], value: null };
}

/** One condition row (column · operator · value), reused at the top level and in groups. */
function ConditionRow({
  cond,
  first,
  conjunction,
  filterable,
  byId,
  onUpdate,
  onRemove,
  onToggleConjunction,
}: {
  cond: FilterCondition;
  first: boolean;
  conjunction: 'and' | 'or';
  filterable: DatabaseColumn[];
  byId: Map<string, DatabaseColumn>;
  onUpdate: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
  onToggleConjunction: () => void;
}) {
  const col = byId.get(cond.columnId);
  const ops = col ? operatorsForType(col.type) : [];
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-[11px] text-neutral-500 text-right shrink-0">
        {first ? (
          t('Donde')
        ) : (
          <button className="text-indigo-400 hover:underline" onClick={onToggleConjunction}>
            {conjunction === 'and' ? t('Y') : t('O')}
          </button>
        )}
      </span>
      <select
        className="input text-xs flex-1 min-w-0"
        value={cond.columnId}
        onChange={(e) => {
          const nc = byId.get(e.target.value);
          onUpdate({ columnId: e.target.value, op: nc ? operatorsForType(nc.type)[0] : cond.op, value: null });
        }}
      >
        {filterable.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input text-xs w-32" value={cond.op} onChange={(e) => onUpdate({ op: e.target.value as FilterCondition['op'] })}>
        {ops.map((op) => (
          <option key={op} value={op}>
            {t(opLabel(op))}
          </option>
        ))}
      </select>
      {col && opNeedsValue(cond.op) && <FilterValueInput column={col} cond={cond} onChange={(value) => onUpdate({ value })} />}
      <button className="text-neutral-600 hover:text-red-400 shrink-0" onClick={onRemove}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function FilterButton({
  columns,
  filter,
  onChange,
}: {
  columns: DatabaseColumn[];
  filter: DatabaseFilterState;
  onChange: (f: DatabaseFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const filterable = columns.filter((c) => isColumnFilterable(c.type));
  const byId = new Map(columns.map((c) => [c.id, c]));
  const groups = filter.groups ?? [];
  const activeCount = filter.conditions.length + groups.reduce((n, g) => n + g.conditions.length, 0);
  const toggleTop = () => onChange({ ...filter, conjunction: filter.conjunction === 'and' ? 'or' : 'and' });

  // Top-level conditions
  const addCondition = () => filterable[0] && onChange({ ...filter, conditions: [...filter.conditions, newFilterCondition(filterable)] });
  const updateCond = (id: string, patch: Partial<FilterCondition>) =>
    onChange({ ...filter, conditions: filter.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCond = (id: string) => onChange({ ...filter, conditions: filter.conditions.filter((c) => c.id !== id) });

  // Groups
  const setGroups = (next: FilterGroup[]) => onChange({ ...filter, groups: next });
  const addGroup = () =>
    filterable[0] &&
    setGroups([...groups, { id: `fg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, conjunction: 'and', conditions: [newFilterCondition(filterable)] }]);
  const patchGroup = (gid: string, patch: Partial<FilterGroup>) => setGroups(groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)));
  const removeGroup = (gid: string) => setGroups(groups.filter((g) => g.id !== gid));
  const updateGroupCond = (g: FilterGroup, cid: string, patch: Partial<FilterCondition>) =>
    patchGroup(g.id, { conditions: g.conditions.map((c) => (c.id === cid ? { ...c, ...patch } : c)) });
  const removeGroupCond = (g: FilterGroup, cid: string) => {
    const conds = g.conditions.filter((c) => c.id !== cid);
    if (conds.length === 0) removeGroup(g.id);
    else patchGroup(g.id, { conditions: conds });
  };

  return (
    <div className="relative">
      <button className={`btn btn-ghost gap-1.5 ${activeCount > 0 ? 'text-indigo-400' : ''}`} title={t('Filtrar')} onClick={() => setOpen((v) => !v)}>
        <Icon name="gap" size={15} /> {activeCount > 0 ? activeCount : ''}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full right-0 mt-1 w-[30rem] max-w-[90vw] card-modal p-2 text-sm max-h-[70vh] overflow-y-auto">
            {activeCount === 0 && <p className="px-1 py-2 text-xs text-neutral-500">{t('Sin filtros. Añade una condición.')}</p>}
            <div className="flex flex-col gap-1.5">
              {filter.conditions.map((cond, i) => (
                <ConditionRow
                  key={cond.id}
                  cond={cond}
                  first={i === 0}
                  conjunction={filter.conjunction}
                  filterable={filterable}
                  byId={byId}
                  onUpdate={(p) => updateCond(cond.id, p)}
                  onRemove={() => removeCond(cond.id)}
                  onToggleConjunction={toggleTop}
                />
              ))}
            </div>
            {groups.map((g, gi) => (
              <div key={g.id} className="mt-2 rounded-lg border border-neutral-700/70 p-2 bg-neutral-900/30">
                <div className="flex items-center gap-2 mb-1.5 text-[11px] text-neutral-500">
                  {filter.conditions.length > 0 || gi > 0 ? (
                    <button className="text-indigo-400 hover:underline" onClick={toggleTop}>
                      {filter.conjunction === 'and' ? t('Y') : t('O')}
                    </button>
                  ) : (
                    t('Donde')
                  )}
                  <span className="uppercase tracking-wide">{t('Grupo')}</span>
                  <div className="flex-1" />
                  <button className="text-neutral-600 hover:text-red-400" title={t('Eliminar grupo')} onClick={() => removeGroup(g.id)}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.conditions.map((cond, ci) => (
                    <ConditionRow
                      key={cond.id}
                      cond={cond}
                      first={ci === 0}
                      conjunction={g.conjunction}
                      filterable={filterable}
                      byId={byId}
                      onUpdate={(p) => updateGroupCond(g, cond.id, p)}
                      onRemove={() => removeGroupCond(g, cond.id)}
                      onToggleConjunction={() => patchGroup(g.id, { conjunction: g.conjunction === 'and' ? 'or' : 'and' })}
                    />
                  ))}
                </div>
                <button
                  className="btn btn-ghost py-1 px-2 text-xs gap-1 mt-1.5"
                  onClick={() => patchGroup(g.id, { conditions: [...g.conditions, newFilterCondition(filterable)] })}
                >
                  <Icon name="plus" size={11} /> {t('Añadir condición')}
                </button>
              </div>
            ))}
            <div className="flex justify-between mt-2 flex-wrap gap-2">
              <div className="flex gap-1">
                <button className="btn btn-ghost py-1 px-2 text-xs gap-1" onClick={addCondition} disabled={filterable.length === 0}>
                  <Icon name="plus" size={12} /> {t('Añadir filtro')}
                </button>
                <button className="btn btn-ghost py-1 px-2 text-xs gap-1" onClick={addGroup} disabled={filterable.length === 0}>
                  <Icon name="plus" size={12} /> {t('Añadir grupo')}
                </button>
              </div>
              {activeCount > 0 && (
                <button className="btn btn-ghost py-1 px-2 text-xs text-neutral-500" onClick={() => onChange({ conjunction: 'and', conditions: [] })}>
                  {t('Limpiar')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterValueInput({ column, cond, onChange }: { column: DatabaseColumn; cond: FilterCondition; onChange: (v: string | string[]) => void }) {
  if (column.type === 'select' || column.type === 'multi_select') {
    const selected = Array.isArray(cond.value) ? cond.value : cond.value ? [cond.value] : [];
    return (
      <select
        className="input text-xs w-32"
        value={selected[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      >
        <option value="">{t('—')}</option>
        {column.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : column.type === 'time' ? 'time' : 'text';
  return (
    <input
      className="input text-xs w-32"
      type={inputType}
      value={typeof cond.value === 'string' ? cond.value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SortButton({ columns, sorts, onChange }: { columns: DatabaseColumn[]; sorts: SortRule[]; onChange: (s: SortRule[]) => void }) {
  const [open, setOpen] = useState(false);
  const sortable = columns.filter((c) => c.type !== 'attachment' && c.type !== 'ai_image' && c.type !== 'relation');
  const add = () => {
    const col = sortable.find((c) => !sorts.some((s) => s.columnId === c.id)) ?? sortable[0];
    if (col) onChange([...sorts, { columnId: col.id, dir: 'asc' }]);
  };
  return (
    <div className="relative">
      <button className={`btn btn-ghost gap-1.5 ${sorts.length > 0 ? 'text-indigo-400' : ''}`} title={t('Ordenar')} onClick={() => setOpen((v) => !v)}>
        <Icon name="arrowDown" size={15} /> {sorts.length > 0 ? sorts.length : ''}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full right-0 mt-1 w-80 card-modal p-2 text-sm">
            {sorts.length === 0 && <p className="px-1 py-2 text-xs text-neutral-500">{t('Sin ordenación.')}</p>}
            <div className="flex flex-col gap-1.5">
              {sorts.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <select
                    className="input text-xs flex-1 min-w-0"
                    value={s.columnId}
                    onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, columnId: e.target.value } : x)))}
                  >
                    {sortable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-ghost py-1 px-2 text-xs"
                    onClick={() => onChange(sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x)))}
                  >
                    {s.dir === 'asc' ? t('Ascendente') : t('Descendente')}
                  </button>
                  <button className="text-neutral-600 hover:text-red-400 shrink-0" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost py-1 px-2 text-xs gap-1 mt-2" onClick={add} disabled={sortable.length === 0}>
              <Icon name="plus" size={12} /> {t('Añadir orden')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Bulk file upload ──────────────────────────────────────────────────────────

function BulkUploadModal({
  databaseId,
  columns,
  rows,
  onClose,
  onDone,
}: {
  databaseId: string;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const refColumns = columns.filter((c) => c.type === 'title' || c.type === 'text');
  const attachColumns = columns.filter((c) => c.type === 'attachment');
  const [refId, setRefId] = useState(refColumns[0]?.id ?? '');
  const [attId, setAttId] = useState(attachColumns[0]?.id ?? '');
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => window.nodus.onDatabaseBulkProgress((p) => {
    if (p.databaseId === databaseId) setProgress({ done: p.done, total: p.total });
  }), [databaseId]);

  const matches = useMemo(
    () => (refId ? matchFilesToRows(files.map((f) => f.name), rows.map((r) => ({ rowId: r.id, refValue: r.cells[refId] ?? null }))) : []),
    [files, refId, rows]
  );
  const matched = matches.filter((m) => m.rowId).length;

  const pick = async () => {
    const picked = await window.nodus.pickBulkDatabaseFiles();
    if (picked.length) setFiles(picked);
  };
  const run = async (background: boolean) => {
    if (!refId || !attId || files.length === 0) return;
    setRunning(true);
    if (background) {
      void window.nodus.bulkAttachDatabaseFiles(databaseId, refId, attId, files);
      toast(t('Subida en segundo plano…'));
      onClose();
      return;
    }
    await window.nodus.bulkAttachDatabaseFiles(databaseId, refId, attId, files);
    setRunning(false);
    onDone();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card-modal w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <Icon name="upload" size={16} className="text-indigo-400" />
          <h2 className="font-semibold">{t('Subida masiva de archivos')}</h2>
          <div className="flex-1" />
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            {t('Sube muchos archivos y se emparejarán con las filas comparando el nombre del archivo con una columna de referencia.')}
          </p>
          <button className="btn btn-ghost border border-neutral-700 gap-1.5 self-start" onClick={() => void pick()}>
            <Icon name="folderPlus" /> {files.length ? tx('{n} archivos elegidos', { n: files.length }) : t('Elegir archivos')}
          </button>
          <div>
            <label className="text-xs text-neutral-500">{t('Columna de referencia (nombre del archivo)')}</label>
            <select className="input w-full mt-1" value={refId} onChange={(e) => setRefId(e.target.value)}>
              {refColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">{t('Columna de adjuntos (destino)')}</label>
            <select className="input w-full mt-1" value={attId} onChange={(e) => setAttId(e.target.value)}>
              {attachColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {files.length > 0 && (
            <p className="text-xs text-neutral-400">{tx('{m} de {n} archivos coinciden con una fila.', { m: matched, n: files.length })}</p>
          )}
          {progress && (
            <div className="h-2 rounded bg-neutral-800 overflow-hidden">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button className="btn btn-ghost" onClick={onClose} disabled={running}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-ghost border border-neutral-700" onClick={() => void run(true)} disabled={running || matched === 0 || !attId}>
            {t('En segundo plano')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => void run(false)} disabled={running || matched === 0 || !attId}>
            <Icon name={running ? 'sync' : 'upload'} size={14} className={running ? 'animate-spin' : ''} /> {t('Subir')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gallery view ──────────────────────────────────────────────────────────────

/** The first title column's value for a row (the card/record heading). */
function rowTitle(row: DatabaseRow, columns: DatabaseColumn[]): string {
  const titleCol = columns.find((c) => c.type === 'title') ?? columns[0];
  return titleCol ? (row.cells[titleCol.id] ?? '').trim() || t('Sin título') : t('Sin título');
}

/** The first image attachment across the row's attachment / AI-image columns, for the cover. */
function coverAttachment(row: DatabaseRow, columns: DatabaseColumn[]): DatabaseAttachment | null {
  for (const col of columns) {
    if (col.type !== 'attachment' && col.type !== 'ai_image') continue;
    const img = (row.attachments?.[col.id] ?? []).find((a) => attachmentKind(a.mimeType) === 'image');
    if (img) return img;
  }
  return null;
}

const GALLERY_COLS_MIN = 5;
const GALLERY_COLS_MAX = 15;

function GalleryView({
  rows,
  columns,
  onOpen,
}: {
  rows: DatabaseRow[];
  columns: DatabaseColumn[];
  onOpen: (rowId: string) => void;
}) {
  // Up to a couple of select/multi-select chips per card, for a quick scan.
  const chipCols = columns.filter((c) => c.type === 'select' || c.type === 'multi_select').slice(0, 2);
  // Cards per row (5–15) and how images fill their square, persisted locally.
  const [cols, setCols] = useState<number>(() => {
    const v = Number(localStorage.getItem('nodus.db.galleryCols'));
    return v >= GALLERY_COLS_MIN && v <= GALLERY_COLS_MAX ? v : GALLERY_COLS_MIN;
  });
  const [fit, setFit] = useState<'cover' | 'contain'>(() => (localStorage.getItem('nodus.db.galleryFit') === 'contain' ? 'contain' : 'cover'));
  useEffect(() => localStorage.setItem('nodus.db.galleryCols', String(cols)), [cols]);
  useEffect(() => localStorage.setItem('nodus.db.galleryFit', fit), [fit]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-neutral-500">{t('Sin filas todavía. Añade la primera.')}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 mb-3 text-xs text-neutral-400">
            <div className="inline-flex items-center gap-1.5">
              <span>{t('Imagen')}</span>
              <div className="inline-flex rounded-md border border-neutral-700 overflow-hidden">
                <button
                  className={`px-2 py-1 ${fit === 'cover' ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}`}
                  onClick={() => setFit('cover')}
                  title={t('La imagen rellena el cuadro (recorta)')}
                >
                  {t('Rellenar')}
                </button>
                <button
                  className={`px-2 py-1 border-l border-neutral-700 ${fit === 'contain' ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}`}
                  onClick={() => setFit('contain')}
                  title={t('La imagen se ajusta al cuadro (se ve completa)')}
                >
                  {t('Ajustar')}
                </button>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <span>{t('Columnas')}</span>
              <button
                className="w-6 h-6 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
                disabled={cols <= GALLERY_COLS_MIN}
                onClick={() => setCols((c) => Math.max(GALLERY_COLS_MIN, c - 1))}
              >
                −
              </button>
              <span className="w-5 text-center tabular-nums text-neutral-200">{cols}</span>
              <button
                className="w-6 h-6 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
                disabled={cols >= GALLERY_COLS_MAX}
                onClick={() => setCols((c) => Math.min(GALLERY_COLS_MAX, c + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div className="grid gap-3 items-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {rows.map((row) => (
              <GalleryCard key={row.id} row={row} columns={columns} chipCols={chipCols} fit={fit} onOpen={() => onOpen(row.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GalleryCard({
  row,
  columns,
  chipCols,
  fit,
  onOpen,
}: {
  row: DatabaseRow;
  columns: DatabaseColumn[];
  chipCols: DatabaseColumn[];
  fit: 'cover' | 'contain';
  onOpen: () => void;
}) {
  const cover = coverAttachment(row, columns);
  const url = useAttachmentImageUrl(cover ?? ({ id: '', mimeType: null, hasBlob: false } as DatabaseAttachment));
  return (
    <button
      className="card p-0 overflow-hidden text-left hover:border-indigo-600/70 transition-colors flex flex-col"
      onClick={onOpen}
    >
      {/* Fixed square so every card is the same size, regardless of image (or none). */}
      <div className="aspect-square shrink-0 bg-neutral-900/60 flex items-center justify-center overflow-hidden">
        {cover && url ? (
          <img src={url} alt="" className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} />
        ) : (
          <Icon name="table" size={26} className="text-neutral-700" />
        )}
      </div>
      <div className="p-2.5 min-w-0">
        <div className="font-medium text-sm truncate">{rowTitle(row, columns)}</div>
        {chipCols.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 max-h-[3.5rem] overflow-hidden">
            {chipCols.flatMap((col) => {
              const ids = col.type === 'multi_select' ? decodeMultiSelect(row.cells[col.id] ?? null) : row.cells[col.id] ? [row.cells[col.id]!] : [];
              return ids
                .map((id) => col.options.find((o) => o.id === id))
                .filter((o): o is DatabaseSelectOption => Boolean(o))
                .map((o) => (
                  <span key={`${col.id}-${o.id}`} className="text-[10px] px-1.5 py-0.5 rounded border truncate max-w-full" style={chipStyle(o.color)}>
                    {o.label}
                  </span>
                ));
            })}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Record detail modal ───────────────────────────────────────────────────────

function RecordModal({
  databaseName,
  columns,
  rowId,
  onClose,
  onChanged,
}: {
  databaseName: string;
  columns: DatabaseColumn[];
  rowId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<DatabaseRow | null>(null);
  const load = useCallback(async () => {
    setRow(await window.nodus.getDatabaseRow(rowId));
  }, [rowId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't steal Escape from an inner editor/popover (a cell being edited).
      const el = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setCell = async (columnId: string, raw: string | null) => {
    setRow((prev) => (prev ? { ...prev, cells: { ...prev.cells, [columnId]: raw } } : prev));
    await window.nodus.setDatabaseCell(rowId, columnId, raw);
    onChanged();
  };
  const afterAttachments = async () => {
    await load();
    onChanged();
  };

  const title = row ? rowTitle(row, columns) : '';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="card-modal w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <span className="text-xs text-neutral-500">{databaseName}</span>
          <div className="flex-1" />
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-xl font-semibold mb-5 leading-tight">{title || t('Sin título')}</h2>
          {!row ? (
            <p className="text-sm text-neutral-500">{t('Cargando…')}</p>
          ) : (
            <div className="space-y-0.5">
              {columns.map((col) => {
                const def = columnTypeDef(col.type);
                return (
                  <div key={col.id} className="flex items-start gap-4 rounded-lg px-2 py-1.5 hover:bg-neutral-900/40 transition-colors">
                    <label className="w-36 shrink-0 pt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                      <Icon name={def.icon} size={12} className="opacity-60 shrink-0" />
                      <span className="truncate">{col.name}</span>
                    </label>
                    <div className="flex-1 min-w-0 rounded-md border border-neutral-800/70 bg-neutral-900/30 min-h-[2.25rem] flex items-center hover:border-neutral-700/80 focus-within:border-neutral-600 transition-colors">
                      <RecordField
                        col={col}
                        row={row}
                        onChange={(raw) => void setCell(col.id, raw)}
                        onOptionsChanged={onChanged}
                        onAttachmentsChanged={() => void afterAttachments()}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One field in the record modal — reuses the table cell editors in a form layout. */
function RecordField({
  col,
  row,
  onChange,
  onOptionsChanged,
  onAttachmentsChanged,
}: {
  col: DatabaseColumn;
  row: DatabaseRow;
  onChange: (raw: string | null) => void;
  onOptionsChanged: () => void;
  onAttachmentsChanged: () => void;
}) {
  const value = row.cells[col.id] ?? null;
  if (col.type === 'attachment') {
    return (
      <AttachmentCell
        rowId={row.id}
        columnId={col.id}
        attachments={row.attachments?.[col.id] ?? []}
        onChanged={onAttachmentsChanged}
        large
      />
    );
  }
  if (col.type === 'ai_image') {
    return (
      <AiImageCell column={col} rowId={row.id} attachments={row.attachments?.[col.id] ?? []} onChanged={onAttachmentsChanged} large />
    );
  }
  if (col.type === 'checkbox') return <CheckboxCell value={value} onChange={onChange} align="start" />;
  if (col.type === 'select') return <SelectCell column={col} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi={false} />;
  if (col.type === 'multi_select') return <SelectCell column={col} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi />;
  if (col.type === 'ai') return <AiCell column={col} rowId={row.id} value={value} onRan={onAttachmentsChanged} />;
  if (col.type === 'relation') return <RelationCell column={col} rowId={row.id} />;
  if (col.type === 'rollup') return <RollupCell value={row.rollups?.[col.id] ?? ''} />;
  if (col.type === 'number' || col.type === 'date' || col.type === 'time')
    return <TextCell value={value} onChange={onChange} inputType={col.type} />;
  return <LongTextCell value={value} onChange={onChange} markdown={col.type === 'text'} />;
}

// ── Editable database title ──────────────────────────────────────────────────

function DatabaseTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  if (editing) {
    return (
      <input
        className="input font-semibold text-base"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== name) onRename(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(name);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button className="text-base font-semibold hover:text-indigo-400 truncate max-w-[40ch]" onClick={() => setEditing(true)} title={t('Renombrar')}>
      {name}
    </button>
  );
}

// ── Column header + menu ──────────────────────────────────────────────────────

function ColumnHeader({
  column,
  width,
  onChanged,
  onResizeStart,
  onFit,
  onReorder,
}: {
  column: DatabaseColumn;
  width: number;
  onChanged: () => void;
  onResizeStart: (clientX: number) => void;
  onFit: () => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const def = columnTypeDef(column.type);

  const rename = async () => {
    const name = window.prompt(t('Nombre de la columna'), column.name);
    if (name && name.trim()) {
      await window.nodus.updateDatabaseColumn(column.id, { name: name.trim() });
      onChanged();
    }
    setMenuOpen(false);
  };
  const changeType = async (type: DatabaseColumnType) => {
    await window.nodus.updateDatabaseColumn(column.id, { type });
    onChanged();
    setMenuOpen(false);
  };
  const remove = async () => {
    setMenuOpen(false);
    if (await confirm({ title: t('Eliminar columna'), message: tx('¿Eliminar la columna «{name}»?', { name: column.name }), danger: true })) {
      await window.nodus.deleteDatabaseColumn(column.id);
      onChanged();
    }
  };

  return (
    <div
      style={{ width }}
      className={`shrink-0 relative border-r border-neutral-800 ${dragOver ? 'border-l-2 border-l-indigo-500' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/db-col', column.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/db-col')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const from = e.dataTransfer.getData('text/db-col');
        if (from) onReorder(from, column.id);
      }}
    >
      <button
        className="w-full h-full flex items-center gap-1.5 px-2 py-2 text-left text-xs font-medium text-neutral-300 hover:bg-neutral-800/60"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon name={def.icon} size={12} className="opacity-60 shrink-0" />
        <span className="truncate flex-1">{column.name}</span>
        <Icon name="chevronDown" size={12} className="opacity-40 shrink-0" />
      </button>
      {/* Resize handle: drag to set width, double-click to fit to content. */}
      <div
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-500/40"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e.clientX);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFit();
        }}
        title={t('Arrastra para redimensionar; doble clic para ajustar')}
      />
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute z-30 top-full left-0 mt-1 w-56 card-modal p-1 text-sm">
            <button className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 flex items-center gap-2" onClick={rename}>
              <Icon name="edit" size={13} /> {t('Renombrar')}
            </button>
            <button
              className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 flex items-center gap-2"
              onClick={() => {
                onFit();
                setMenuOpen(false);
              }}
            >
              <Icon name="fit" size={13} /> {t('Ajustar al contenido')}
            </button>
            {column.type === 'ai' && <AiColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'ai_image' && <AiImageColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'relation' && <RelationColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'rollup' && <RollupColumnConfig column={column} onChanged={onChanged} />}
            {def.hasOptions && (
              <OptionsManager column={column} onChanged={onChanged} />
            )}
            <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-500">{t('Cambiar tipo')}</div>
            <div className="max-h-48 overflow-y-auto">
              {availableColumnTypes().map((tdef) => (
                <button
                  key={tdef.id}
                  className={`w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 flex items-center gap-2 ${
                    tdef.id === column.type ? 'text-indigo-400' : ''
                  }`}
                  onClick={() => void changeType(tdef.id)}
                >
                  <Icon name={tdef.icon} size={13} className="opacity-60" /> {t(tdef.label)}
                </button>
              ))}
            </div>
            <div className="border-t border-neutral-800 mt-1 pt-1">
              <button className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 text-red-400 flex items-center gap-2" onClick={remove}>
                <Icon name="trash" size={13} /> {t('Eliminar columna')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OptionsManager({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const [adding, setAdding] = useState('');
  const add = async () => {
    const label = adding.trim();
    if (!label) return;
    const color = OPTION_COLORS[column.options.length % OPTION_COLORS.length];
    await window.nodus.addDatabaseOption(column.id, label, color);
    setAdding('');
    onChanged();
  };
  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Opciones')}</div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {column.options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-1">
            <button
              className="w-4 h-4 rounded-full border shrink-0"
              style={{ backgroundColor: opt.color ?? '#6b7280', borderColor: opt.color ?? '#6b7280' }}
              title={t('Cambiar color')}
              onClick={async () => {
                const idx = OPTION_COLORS.indexOf(opt.color ?? '');
                const next = OPTION_COLORS[(idx + 1) % OPTION_COLORS.length];
                await window.nodus.updateDatabaseOption(opt.id, { color: next });
                onChanged();
              }}
            />
            <input
              className="input flex-1 py-0.5 text-xs min-w-0"
              defaultValue={opt.label}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                if (v && v !== opt.label) {
                  await window.nodus.updateDatabaseOption(opt.id, { label: v });
                  onChanged();
                }
              }}
            />
            <button
              className="text-neutral-600 hover:text-red-400 shrink-0"
              title={t('Eliminar')}
              onClick={async () => {
                await window.nodus.deleteDatabaseOption(opt.id);
                onChanged();
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        <input
          className="input flex-1 py-1 text-xs"
          placeholder={t('Añadir opción')}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn btn-ghost py-1 px-2" onClick={() => void add()}>
          <Icon name="plus" size={13} />
        </button>
      </div>
    </div>
  );
}

function AddColumnButton({ onAdd }: { onAdd: (name: string, type: DatabaseColumnType) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseColumnType>('text');
  const submit = async () => {
    await onAdd(name.trim() || t('Columna'), type);
    setName('');
    setType('text');
    setOpen(false);
  };
  return (
    <div style={{ width: ADD_COLUMN_WIDTH }} className="shrink-0 relative">
      <button
        className="w-full h-full flex items-center justify-center text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
        title={t('Añadir columna')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="plus" size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full right-0 mt-1 w-60 card-modal p-2 text-sm">
            <label className="text-[10px] uppercase tracking-wide text-neutral-500">{t('Nombre de la columna')}</label>
            <input
              className="input w-full mt-1"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 mt-2 block">{t('Tipo')}</label>
            <select className="input w-full mt-1" value={type} onChange={(e) => setType(e.target.value as DatabaseColumnType)}>
              {availableColumnTypes().map((tdef) => (
                <option key={tdef.id} value={tdef.id}>
                  {t(tdef.label)}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary" onClick={() => void submit()}>
                {t('Añadir')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Cells ─────────────────────────────────────────────────────────────────────

function Cell({
  column,
  width,
  value,
  rollup,
  rowId,
  attachments,
  onChange,
  onOptionsChanged,
  onAttachmentsChanged,
}: {
  column: DatabaseColumn;
  width: number;
  value: string | null;
  rollup?: string;
  rowId: string;
  attachments: DatabaseAttachment[];
  onChange: (raw: string | null) => void;
  onOptionsChanged: () => void;
  onAttachmentsChanged: () => void;
}) {
  return (
    <div style={{ width }} className="shrink-0 border-r border-neutral-900 overflow-hidden">
      {column.type === 'checkbox' ? (
        <CheckboxCell value={value} onChange={onChange} />
      ) : column.type === 'select' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi={false} />
      ) : column.type === 'multi_select' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi />
      ) : column.type === 'attachment' ? (
        <AttachmentCell rowId={rowId} columnId={column.id} attachments={attachments} onChanged={onAttachmentsChanged} />
      ) : column.type === 'ai_image' ? (
        <AiImageCell column={column} rowId={rowId} attachments={attachments} onChanged={onAttachmentsChanged} />
      ) : column.type === 'ai' ? (
        <AiCell column={column} rowId={rowId} value={value} onRan={onAttachmentsChanged} />
      ) : column.type === 'relation' ? (
        <RelationCell column={column} rowId={rowId} />
      ) : column.type === 'rollup' ? (
        <RollupCell value={rollup ?? ''} />
      ) : column.type === 'number' ? (
        <TextCell value={value} onChange={onChange} inputType="number" align="right" />
      ) : column.type === 'date' ? (
        <TextCell value={value} onChange={onChange} inputType="date" />
      ) : column.type === 'time' ? (
        <TextCell value={value} onChange={onChange} inputType="time" />
      ) : (
        <LongTextCell value={value} onChange={onChange} markdown={column.type === 'text'} />
      )}
    </div>
  );
}

/** One option row inside the select dropdown: click to (de)select, "···" opens a
 *  Notion-style menu to rename / recolor / delete the option itself. */
function SelectOptionRow({
  option,
  selected,
  onToggle,
  onChanged,
}: {
  option: DatabaseSelectOption;
  selected: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState(option.label);
  useEffect(() => setName(option.label), [option.label]);
  const dotRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(menuOpen, dotRef, 208, 208, 'below');

  const rename = async () => {
    const label = name.trim();
    if (label && label !== option.label) {
      await window.nodus.updateDatabaseOption(option.id, { label });
      onChanged();
    }
  };
  const setColor = async (color: string) => {
    await window.nodus.updateDatabaseOption(option.id, { color });
    onChanged();
    setMenuOpen(false);
  };
  const del = async () => {
    await window.nodus.deleteDatabaseOption(option.id);
    onChanged();
    setMenuOpen(false);
  };

  return (
    <div className="group/opt flex items-center rounded hover:bg-neutral-800">
      <button className="flex-1 min-w-0 text-left px-1.5 py-1 flex items-center gap-2" onClick={onToggle}>
        <span className="text-xs px-1.5 py-0.5 rounded border max-w-full truncate" style={chipStyle(option.color)}>
          {option.label}
        </span>
        {selected && <Icon name="check" size={13} className="text-indigo-400 ml-auto shrink-0" />}
      </button>
      <button
        ref={dotRef}
        className="shrink-0 px-1.5 py-1 text-neutral-500 hover:text-neutral-200 opacity-0 group-hover/opt:opacity-100"
        onClick={() => setMenuOpen((v) => !v)}
        title={t('Editar opción')}
      >
        <Icon name="palette" size={13} />
      </button>
      {menuOpen && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => void rename().then(() => setMenuOpen(false))} />
            <div className="fixed z-[61] card-modal p-2 text-sm" style={{ top: coords.top, left: coords.left, width: coords.width }}>
              <input
                className="input w-full py-1 text-xs mb-2"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename().then(() => setMenuOpen(false));
                  if (e.key === 'Escape') setMenuOpen(false);
                }}
              />
              <button
                className="w-full text-left px-1.5 py-1 rounded hover:bg-neutral-800 flex items-center gap-2 text-neutral-300 mb-2"
                onClick={() => void del()}
              >
                <Icon name="trash" size={13} /> {t('Eliminar')}
              </button>
              <div className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-neutral-500">{t('Colores')}</div>
              <div className="grid grid-cols-4 gap-1">
                {OPTION_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`h-6 rounded border ${option.color === c ? 'ring-2 ring-white/70' : ''}`}
                    style={{ backgroundColor: `${c}33`, borderColor: c }}
                    onClick={() => void setColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

function SelectCell({
  column,
  value,
  onChange,
  onOptionsChanged,
  multi,
}: {
  column: DatabaseColumn;
  value: string | null;
  onChange: (raw: string | null) => void;
  onOptionsChanged: () => void;
  multi: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const optionById = useMemo(() => new Map(column.options.map((o) => [o.id, o])), [column.options]);
  const selectedIds = multi ? decodeMultiSelect(value) : value ? [value] : [];
  const selected = selectedIds.map((id) => optionById.get(id)).filter((o): o is DatabaseSelectOption => Boolean(o));

  const qLower = query.trim().toLowerCase();
  const filtered = qLower ? column.options.filter((o) => o.label.toLowerCase().includes(qLower)) : column.options;
  const exactMatch = column.options.some((o) => o.label.toLowerCase() === qLower);
  const nextColor = OPTION_COLORS[column.options.length % OPTION_COLORS.length];

  const setValue = (ids: string[]) => onChange(multi ? encodeMultiSelect(ids) : ids[0] ?? null);

  const toggle = (id: string) => {
    if (multi) {
      const set = new Set(selectedIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      setValue([...set]);
    } else {
      setValue(value === id ? [] : [id]);
      setOpen(false);
    }
    setQuery('');
  };

  const createAndSelect = async () => {
    const label = query.trim();
    if (!label) return;
    const opt = await window.nodus.addDatabaseOption(column.id, label, nextColor);
    onOptionsChanged();
    if (multi) setValue([...selectedIds, opt.id]);
    else {
      setValue([opt.id]);
      setOpen(false);
    }
    setQuery('');
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) toggle(filtered[0].id);
      else if (qLower && !exactMatch) void createAndSelect();
    }
  };

  // The dropdown is portaled to <body> (the cell is overflow-hidden); it stays
  // glued to the cell on scroll. See useAnchoredCoords.
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, 256, 256, 'below');

  return (
    <div className="w-full h-full">
      <button
        ref={btnRef}
        className="w-full h-full px-2 flex items-center gap-1 overflow-hidden hover:bg-neutral-800/40"
        onClick={() => setOpen((v) => !v)}
      >
        {selected.length === 0 ? (
          <span className="text-neutral-600 text-sm">{' '}</span>
        ) : (
          selected.map((opt) => (
            <span key={opt.id} className="text-xs px-1.5 py-0.5 rounded border whitespace-nowrap" style={chipStyle(opt.color)}>
              {opt.label}
            </span>
          ))
        )}
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 card-modal p-2 text-sm"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
            {/* Selected values as removable chips (Notion-style). */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selected.map((opt) => (
                  <span key={opt.id} className="text-xs pl-1.5 pr-1 py-0.5 rounded border flex items-center gap-1" style={chipStyle(opt.color)}>
                    {opt.label}
                    <button className="opacity-70 hover:opacity-100" onClick={() => toggle(opt.id)}>
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="input w-full py-1 text-xs mb-1"
              autoFocus
              placeholder={t('Selecciona una opción o crea una')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            <div className="max-h-48 overflow-y-auto">
              {filtered.map((opt) => (
                <SelectOptionRow
                  key={opt.id}
                  option={opt}
                  selected={selectedIds.includes(opt.id)}
                  onToggle={() => toggle(opt.id)}
                  onChanged={onOptionsChanged}
                />
              ))}
              {qLower && !exactMatch && (
                <button
                  className="w-full text-left px-1.5 py-1 rounded hover:bg-neutral-800 flex items-center gap-2 text-neutral-300"
                  onClick={() => void createAndSelect()}
                >
                  <Icon name="plus" size={12} className="opacity-60" />
                  <span className="truncate">
                    {t('Crear')}{' '}
                    <span className="px-1.5 py-0.5 rounded border" style={chipStyle(nextColor)}>
                      {query.trim()}
                    </span>
                  </span>
                </button>
              )}
              {filtered.length === 0 && !qLower && <p className="px-1.5 py-1 text-xs text-neutral-500">{t('Sin opciones')}</p>}
            </div>
          </div>
          </>,
          document.body
        )}
    </div>
  );
}

// ── AI columns ────────────────────────────────────────────────────────────────

function AiCell({ column, rowId, value, onRan }: { column: DatabaseColumn; rowId: string; value: string | null; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPrompt = Boolean(String(column.config.aiPrompt ?? '').trim());
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.nodus.runDatabaseAiCell(rowId, column.id);
      onRan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full h-full flex items-center gap-1 px-2 group/ai">
      <span className={`flex-1 truncate text-sm ${value == null ? 'text-neutral-600' : ''}`} title={error ?? value ?? ''}>
        {value ? value.replace(/\s+/g, ' ') : hasPrompt ? '' : t('Configura el prompt →')}
      </span>
      <button
        className="shrink-0 opacity-60 group-hover/ai:opacity-100 text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
        title={error ?? t('Generar con IA')}
        onClick={() => void run()}
        disabled={busy || !hasPrompt}
      >
        <Icon name={busy ? 'sync' : 'wand'} size={14} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

function AiColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const [prompt, setPrompt] = useState(String(column.config.aiPrompt ?? ''));
  const [auto, setAuto] = useState(Boolean(column.config.aiAuto));
  const [sourceId, setSourceId] = useState(String(column.config.aiSourceColumnId ?? ''));
  const [attachmentCols, setAttachmentCols] = useState<DatabaseColumn[]>([]);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(
    () => window.nodus.onDatabaseAiProgress((p) => setRunProgress({ done: p.done, total: p.total })),
    []
  );
  const runAll = async () => {
    setRunProgress({ done: 0, total: 0 });
    try {
      await window.nodus.runDatabaseAiColumn(column.databaseId, column.id);
    } finally {
      setRunProgress(null);
    }
  };
  useEffect(() => {
    void window.nodus.getDatabaseDetail(column.databaseId).then((d) => setAttachmentCols((d?.columns ?? []).filter((c) => c.type === 'attachment')));
  }, [column.databaseId]);
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Prompt de IA')}</div>
      <textarea
        className="input w-full text-xs min-h-[3rem]"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => void save({ aiPrompt: prompt })}
        placeholder={t('Ej.: resume el contenido de esta fila')}
      />
      <div className="flex flex-wrap gap-1 mt-1">
        {AI_COLUMN_PRESETS.map((p) => (
          <button
            key={p.id}
            className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 hover:bg-neutral-800"
            onClick={() => {
              const prompt = t(p.prompt);
              setPrompt(prompt);
              void save({ aiPrompt: prompt });
            }}
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      {attachmentCols.length > 0 && (
        <>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 mt-2 block">{t('Fuente (imagen/archivo)')}</label>
          <select
            className="input w-full text-xs mt-1"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              void save({ aiSourceColumnId: e.target.value || undefined });
            }}
          >
            <option value="">{t('Ninguna')}</option>
            {attachmentCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="flex items-center gap-2 mt-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            void save({ aiAuto: e.target.checked });
          }}
        />
        {t('Recalcular al cambiar la fila')}
      </label>
      <button
        className="btn btn-ghost border border-neutral-700 w-full gap-1.5 mt-2 text-xs"
        onClick={() => void runAll()}
        disabled={runProgress != null || !prompt.trim()}
      >
        <Icon name={runProgress != null ? 'sync' : 'wand'} size={13} className={runProgress != null ? 'animate-spin' : ''} />
        {runProgress != null && runProgress.total > 0
          ? tx('Ejecutando… {d}/{t}', { d: runProgress.done, t: runProgress.total })
          : t('Ejecutar en todas las filas')}
      </button>
    </div>
  );
}

// ── AI image columns ──────────────────────────────────────────────────────────

function AiImageCell({
  column,
  rowId,
  attachments,
  onChanged,
  large = false,
}: {
  column: DatabaseColumn;
  rowId: string;
  attachments: DatabaseAttachment[];
  onChanged: () => void;
  large?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPrompt = Boolean(String(column.config.aiPrompt ?? '').trim());
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.nodus.generateDatabaseAiImage(rowId, column.id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (att: DatabaseAttachment) => {
    await window.nodus.deleteDatabaseAttachment(att.id);
    onChanged();
  };
  const btnBox = large ? 'w-24 h-24' : 'w-7 h-7';
  return (
    <div className={`w-full ${large ? 'flex-wrap py-1' : 'h-full overflow-x-auto'} px-1.5 flex items-center gap-1.5`}>
      {attachments.map((att) => (
        <AttachmentThumb key={att.id} att={att} large={large} onRemove={() => void remove(att)} />
      ))}
      <button
        className={`shrink-0 ${btnBox} rounded flex items-center justify-center text-indigo-400 border border-dashed border-neutral-700 hover:bg-neutral-800 hover:text-indigo-300 disabled:opacity-40`}
        title={error ?? (hasPrompt ? (attachments.length ? t('Regenerar imagen') : t('Generar imagen con IA')) : t('Configura el prompt primero'))}
        onClick={() => void generate()}
        disabled={busy || !hasPrompt}
      >
        <Icon name={busy ? 'sync' : attachments.length ? 'sync' : 'wand'} size={large ? 18 : 14} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

function AiImageColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const [prompt, setPrompt] = useState(String(column.config.aiPrompt ?? ''));
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => window.nodus.onDatabaseAiProgress((p) => setRunProgress({ done: p.done, total: p.total })), []);
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  const runAll = async () => {
    setRunProgress({ done: 0, total: 0 });
    try {
      await window.nodus.generateDatabaseAiImageColumn(column.databaseId, column.id);
    } finally {
      setRunProgress(null);
    }
  };
  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Prompt de imagen')}</div>
      <textarea
        className="input w-full text-xs min-h-[3rem]"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => void save({ aiPrompt: prompt })}
        placeholder={t('Ej.: retrato ilustrado de esta persona en estilo acuarela')}
      />
      <p className="text-[10px] text-neutral-500 mt-1">{t('Se usa el proveedor de imagen configurado en Ajustes → Proveedores.')}</p>
      <button
        className="btn btn-ghost border border-neutral-700 w-full gap-1.5 mt-2 text-xs"
        onClick={() => void runAll()}
        disabled={runProgress != null || !prompt.trim()}
      >
        <Icon name={runProgress != null ? 'sync' : 'image'} size={13} className={runProgress != null ? 'animate-spin' : ''} />
        {runProgress != null && runProgress.total > 0
          ? tx('Generando… {d}/{t}', { d: runProgress.done, t: runProgress.total })
          : t('Generar en todas las filas')}
      </button>
    </div>
  );
}

// ── Relation columns ──────────────────────────────────────────────────────────

function RelationColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const kind = (column.config.relationTargetKind as RelationTargetKind) ?? 'db_row';
  const targetDb = String(column.config.relationTargetDatabaseId ?? '');
  const [databases, setDatabases] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void window.nodus.listDatabases().then((d) => setDatabases(d.map((x) => ({ id: x.id, name: x.name }))));
  }, []);
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Relacionar con')}</div>
      <select className="input w-full text-xs" value={kind} onChange={(e) => void save({ relationTargetKind: e.target.value })}>
        {RELATION_TARGET_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {t(k.label)}
          </option>
        ))}
      </select>
      {kind === 'db_row' && (
        <select className="input w-full text-xs mt-1" value={targetDb} onChange={(e) => void save({ relationTargetDatabaseId: e.target.value || undefined })}>
          <option value="">{t('Elige una base de datos…')}</option>
          {databases.filter((d) => d.id !== column.databaseId).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function RelationCell({ column, rowId }: { column: DatabaseColumn; rowId: string }) {
  const [rels, setRels] = useState<DatabaseRelation[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RelationTarget[]>([]);
  const kind = (column.config.relationTargetKind as RelationTargetKind) ?? 'db_row';
  const targetDb = column.config.relationTargetDatabaseId as string | undefined;
  const missingTargetDb = kind === 'db_row' && !targetDb;

  const load = useCallback(() => window.nodus.listDatabaseRelations(rowId, column.id).then(setRels), [rowId, column.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!open || missingTargetDb) return;
    let live = true;
    void window.nodus.searchDatabaseRelationTargets(kind, query, targetDb).then((r) => {
      if (live) setResults(r);
    });
    return () => {
      live = false;
    };
  }, [open, query, kind, targetDb, missingTargetDb]);

  const add = async (target: RelationTarget) => {
    await window.nodus.addDatabaseRelation(rowId, column.id, kind, target.id, target.vaultId ?? null);
    setQuery('');
    await load();
  };
  const remove = async (id: string) => {
    await window.nodus.removeDatabaseRelation(id);
    await load();
  };
  const selectedIds = new Set(rels.map((r) => r.targetId));

  // Portaled dropdown (see SelectCell) so it escapes the cell's overflow-hidden clip.
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, 288, 288, 'below');

  return (
    <div className="w-full h-full">
      <button
        ref={btnRef}
        className="w-full h-full px-2 flex items-center gap-1 overflow-hidden hover:bg-neutral-800/40"
        onClick={() => setOpen((v) => !v)}
      >
        {rels.length === 0 ? (
          <span className="text-neutral-600 text-sm">{' '}</span>
        ) : (
          rels.map((r) => (
            <span
              key={r.id}
              title={r.broken ? t('No se pudo resolver (¿entidad o vault eliminado?)') : r.vaultName || undefined}
              className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${
                r.broken ? 'border-amber-700/60 bg-amber-600/10 text-amber-300' : 'border-indigo-700/60 bg-indigo-600/15 text-indigo-300'
              }`}
            >
              {r.broken && '⚠ '}
              {r.label}
            </span>
          ))
        )}
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 card-modal p-2 text-sm"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
            {missingTargetDb ? (
              <p className="text-xs text-neutral-500 px-1 py-1">{t('Configura la base de datos destino en la cabecera de la columna.')}</p>
            ) : (
              <>
                {rels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {rels.map((r) => (
                      <span
                        key={r.id}
                        title={r.broken ? t('No se pudo resolver (¿entidad o vault eliminado?)') : r.vaultName || undefined}
                        className={`text-xs pl-1.5 pr-1 py-0.5 rounded border flex items-center gap-1 ${
                          r.broken ? 'border-amber-700/60 bg-amber-600/10 text-amber-300' : 'border-indigo-700/60 bg-indigo-600/15 text-indigo-300'
                        }`}
                      >
                        {r.broken && '⚠ '}
                        {r.label}
                        <button className="opacity-70 hover:opacity-100" onClick={() => void remove(r.id)}>
                          <Icon name="x" size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="input w-full py-1 text-xs mb-1"
                  autoFocus
                  placeholder={t('Buscar…')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="max-h-48 overflow-y-auto">
                  {results.filter((r) => !selectedIds.has(r.id)).map((r) => (
                    <button
                      key={`${r.vaultId ?? ''}:${r.id}`}
                      className="w-full text-left px-1.5 py-1 rounded hover:bg-neutral-800 flex items-center gap-2"
                      onClick={() => void add(r)}
                    >
                      <Icon name="link" size={12} className="opacity-50 shrink-0" />
                      <span className="flex-1 min-w-0 truncate">{r.label}</span>
                      {r.sublabel && <span className="shrink-0 text-[10px] text-neutral-500 truncate max-w-[45%]">{r.sublabel}</span>}
                    </button>
                  ))}
                  {results.length === 0 && <p className="px-1.5 py-1 text-xs text-neutral-500">{t('Sin resultados')}</p>}
                </div>
              </>
            )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

// ── Rollup columns ─────────────────────────────────────────────────────────────

/** Read-only cell showing a rollup's computed value (aggregated from related rows). */
function RollupCell({ value }: { value: string }) {
  return (
    <div className="w-full h-full px-2 flex items-center overflow-hidden text-sm text-neutral-300">
      <span className="truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

/** Column-header config for a rollup: a db_row relation on this DB → a property on the
 *  related DB → an aggregation. Mirrors Notion's rollup. */
function RollupColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const [relCols, setRelCols] = useState<DatabaseColumn[]>([]);
  const [targetCols, setTargetCols] = useState<DatabaseColumn[]>([]);
  const relId = String(column.config.rollupRelationColumnId ?? '');
  const targetId = String(column.config.rollupTargetColumnId ?? '__title__');
  const fn = (column.config.rollupFunction as RollupFunction) ?? 'show';
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  useEffect(() => {
    void window.nodus.getDatabaseDetail(column.databaseId).then((d) => {
      if (d)
        setRelCols(
          d.columns.filter((c) => c.type === 'relation' && c.config.relationTargetKind === 'db_row' && Boolean(c.config.relationTargetDatabaseId))
        );
    });
  }, [column.databaseId]);
  useEffect(() => {
    const rel = relCols.find((c) => c.id === relId);
    const targetDb = rel?.config.relationTargetDatabaseId as string | undefined;
    if (!targetDb) {
      setTargetCols([]);
      return;
    }
    void window.nodus.getDatabaseDetail(targetDb).then((d) => setTargetCols(d?.columns ?? []));
  }, [relId, relCols]);
  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Rollup')}</div>
      <label className="text-[10px] text-neutral-500">{t('A través de la relación')}</label>
      <select className="input w-full text-xs" value={relId} onChange={(e) => void save({ rollupRelationColumnId: e.target.value || undefined })}>
        <option value="">{t('Elige una columna de relación…')}</option>
        {relCols.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {relCols.length === 0 && <p className="mt-1 text-[10px] text-neutral-600">{t('Crea antes una columna de relación con otra base de datos.')}</p>}
      {relId && (
        <>
          <label className="mt-2 block text-[10px] text-neutral-500">{t('Propiedad')}</label>
          <select className="input w-full text-xs" value={targetId} onChange={(e) => void save({ rollupTargetColumnId: e.target.value })}>
            <option value="__title__">{t('Título')}</option>
            {targetCols
              .filter((c) => c.type !== 'title' && c.type !== 'rollup' && c.type !== 'attachment' && c.type !== 'ai_image' && c.type !== 'relation')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <label className="mt-2 block text-[10px] text-neutral-500">{t('Cálculo')}</label>
          <select className="input w-full text-xs" value={fn} onChange={(e) => void save({ rollupFunction: e.target.value })}>
            {ROLLUP_FUNCTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {t(f.label)}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

// ── Attachments ───────────────────────────────────────────────────────────────

/** Object URL for an image attachment's blob (fetched on demand, revoked on unmount). */
function useAttachmentImageUrl(att: DatabaseAttachment): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachmentKind(att.mimeType) !== 'image' || !att.hasBlob) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objUrl: string | null = null;
    void window.nodus.getDatabaseAttachmentBlob(att.id).then((bytes) => {
      if (!bytes || revoked) return;
      objUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: att.mimeType ?? 'image/png' }));
      setUrl(objUrl);
    });
    return () => {
      revoked = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [att.id, att.mimeType, att.hasBlob]);
  return url;
}

/** Human-readable file size, e.g. "1.4 MB". */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / 1024 ** i;
  return `${i === 0 ? n : Math.round(n * 10) / 10} ${units[i]}`;
}

/** Metadata panel for one attachment: name, size, type, provenance, extracted text. */
function AttachmentInfoModal({ att, onClose }: { att: DatabaseAttachment; onClose: () => void }) {
  const rows: { label: string; value: string }[] = [
    { label: t('Nombre del archivo'), value: att.fileName ?? '—' },
    { label: t('Tipo de archivo'), value: att.mimeType ?? t('desconocido') },
    { label: t('Tamaño'), value: formatBytes(att.bytes) },
    { label: t('Añadido'), value: new Date(att.createdAt).toLocaleString() },
    { label: t('Origen del archivo'), value: att.aiGenerated ? t('Generado con IA') : t('Subido por el usuario') },
  ];
  if (att.contentHash) rows.push({ label: t('Hash'), value: `${att.contentHash.slice(0, 16)}…` });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card-modal w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <Icon name="info" size={16} className="text-indigo-400" />
          <h2 className="font-semibold truncate">{att.fileName ?? t('Adjunto')}</h2>
          <div className="flex-1" />
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
            {rows.map((r) => (
              <Fragment key={r.label}>
                <dt className="text-neutral-500">{r.label}</dt>
                <dd className="text-neutral-200 break-words">{r.value}</dd>
              </Fragment>
            ))}
          </dl>
          {att.aiPrompt && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{t('Prompt usado')}</div>
              <p className="text-xs text-neutral-300 whitespace-pre-wrap bg-neutral-900/60 rounded p-2 border border-neutral-800">{att.aiPrompt}</p>
            </div>
          )}
          {att.description && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{t('Descripción')}</div>
              <p className="text-xs text-neutral-300 whitespace-pre-wrap">{att.description}</p>
            </div>
          )}
          {att.extractedText && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{t('Texto extraído')}</div>
              <p className="text-xs text-neutral-400 whitespace-pre-wrap max-h-40 overflow-y-auto bg-neutral-900/60 rounded p-2 border border-neutral-800">{att.extractedText}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button
            className="btn btn-ghost gap-1.5"
            onClick={() => {
              void window.nodus.downloadDatabaseAttachment(att.id).then((r) => {
                if (!r.canceled && r.path) toast(tx('Descargado en {p}', { p: r.path }));
              });
            }}
          >
            <Icon name="download" size={14} /> {t('Descargar')}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {t('Cerrar')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AttachmentThumb({ att, onRemove, large = false }: { att: DatabaseAttachment; onRemove: () => void; large?: boolean }) {
  const url = useAttachmentImageUrl(att);
  const kind = attachmentKind(att.mimeType);
  const [info, setInfo] = useState(false);
  const box = large ? 'w-24 h-24' : 'w-7 h-7';
  const download = async () => {
    const r = await window.nodus.downloadDatabaseAttachment(att.id);
    if (!r.canceled && r.path) toast(tx('Descargado en {p}', { p: r.path }));
  };
  const iconBtn =
    'flex w-3.5 h-3.5 rounded-full bg-neutral-900 border border-neutral-600 items-center justify-center text-neutral-300';
  return (
    <div className="group/att relative shrink-0">
      {kind === 'image' && url ? (
        <img src={url} alt={att.fileName ?? ''} title={att.fileName ?? ''} className={`${box} rounded object-cover border border-neutral-700`} />
      ) : (
        <span
          className={`inline-flex items-center gap-1 ${large ? 'w-24 h-24 flex-col justify-center text-center px-2' : 'max-w-[9rem] px-1.5 py-0.5'} rounded border border-neutral-700 bg-neutral-800/60 text-[11px] text-neutral-300`}
          title={att.fileName ?? ''}
        >
          <Icon name={kind === 'pdf' ? 'book' : 'archive'} size={large ? 20 : 11} className="opacity-60 shrink-0" />
          <span className="truncate max-w-full">{att.fileName ?? t('archivo')}</span>
        </span>
      )}
      {att.aiGenerated && kind === 'image' && url && <AiBadge size="sm" corner="bottom-left" />}
      {/* Hover actions: info · download · remove. */}
      <div className="absolute -top-1 -right-1 hidden group-hover/att:flex items-center gap-0.5">
        <button className={`${iconBtn} hover:text-indigo-300`} onClick={() => setInfo(true)} title={t('Información')}>
          <Icon name="info" size={9} />
        </button>
        <button className={`${iconBtn} hover:text-emerald-300`} onClick={() => void download()} title={t('Descargar')}>
          <Icon name="download" size={9} />
        </button>
        <button className={`${iconBtn} hover:text-red-400`} onClick={onRemove} title={t('Quitar')}>
          <Icon name="x" size={9} />
        </button>
      </div>
      {info && <AttachmentInfoModal att={att} onClose={() => setInfo(false)} />}
    </div>
  );
}

function AttachmentCell({
  rowId,
  columnId,
  attachments,
  onChanged,
  large = false,
}: {
  rowId: string;
  columnId: string;
  attachments: DatabaseAttachment[];
  onChanged: () => void;
  large?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try {
      await window.nodus.pickAndAttachDatabaseFiles(rowId, columnId);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (att: DatabaseAttachment) => {
    const ok = await confirm({
      title: t('Eliminar adjunto'),
      message: att.fileName ? tx('¿Eliminar «{name}»? Esta acción no se puede deshacer.', { name: att.fileName }) : t('¿Eliminar este adjunto? Esta acción no se puede deshacer.'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteDatabaseAttachment(att.id);
    onChanged();
  };
  const addBox = large ? 'w-24 h-24' : 'w-7 h-7';
  return (
    <div className={`w-full ${large ? 'flex-wrap py-1' : 'h-full overflow-x-auto'} px-1.5 flex items-center gap-1.5`}>
      {attachments.map((att) => (
        <AttachmentThumb key={att.id} att={att} large={large} onRemove={() => void remove(att)} />
      ))}
      <button
        className={`shrink-0 ${addBox} rounded flex items-center justify-center text-neutral-500 border border-dashed border-neutral-700 hover:bg-neutral-800 hover:text-neutral-300`}
        title={t('Adjuntar archivos')}
        onClick={() => void pick()}
        disabled={busy}
      >
        <Icon name={busy ? 'sync' : 'plus'} size={large ? 18 : 14} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

// ── CSV import ────────────────────────────────────────────────────────────────

export interface CsvImportPlanData {
  fileName: string;
  headers: string[];
  rows: string[][];
  suggestedTypes: DatabaseColumnType[];
}

const IMPORTABLE_TYPES: DatabaseColumnType[] = ['title', 'text', 'number', 'date', 'time', 'select', 'multi_select', 'checkbox'];

export function CsvImportModal({
  plan,
  onClose,
  onImported,
}: {
  plan: CsvImportPlanData;
  onClose: () => void;
  onImported: (databaseId: string) => void;
}) {
  const [name, setName] = useState(plan.fileName.replace(/\.[^.]+$/, '') || t('Base de datos importada'));
  const [types, setTypes] = useState<DatabaseColumnType[]>(plan.suggestedTypes);
  const [busy, setBusy] = useState(false);

  const importNow = async () => {
    setBusy(true);
    try {
      const db = await window.nodus.createDatabaseFromCsv(name.trim() || t('Base de datos importada'), plan.headers, plan.rows, types);
      onImported(db.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card-modal w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <Icon name="upload" size={16} className="text-indigo-400" />
          <h2 className="font-semibold">{t('Importar CSV')}</h2>
          <div className="flex-1" />
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="text-xs text-neutral-500">{t('Nombre de la base de datos')}</label>
          <input className="input w-full mt-1 mb-4" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-neutral-500 mb-2">
            {tx('{n} columnas · {r} filas. Asigna un tipo a cada columna:', { n: plan.headers.length, r: plan.rows.length })}
          </p>
          <div className="flex flex-col gap-2">
            {plan.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm" title={h}>
                  {h}
                </span>
                <select
                  className="input text-xs w-44"
                  value={types[i]}
                  onChange={(e) => setTypes((prev) => prev.map((t2, j) => (j === i ? (e.target.value as DatabaseColumnType) : t2)))}
                >
                  {IMPORTABLE_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(columnTypeDef(ty).label)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => void importNow()} disabled={busy}>
            <Icon name={busy ? 'sync' : 'upload'} size={14} className={busy ? 'animate-spin' : ''} /> {t('Importar')}
          </button>
        </div>
      </div>
    </div>
  );
}
