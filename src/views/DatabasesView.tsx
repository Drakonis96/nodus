import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AiBadge, Icon } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
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
  anchorStyle,
  useAnchoredCoords,
  wrappedCellHeight,
} from '../components/dbGrid';
import { confirm, promptText, toast } from '../components/feedback';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';
import {
  clearBackgroundJob,
  databaseAiImageColumnJobKey,
  databaseAiImageCellJobKey,
  databaseAiTextColumnJobKey,
  databaseAiTextCellJobKey,
  databaseComparisonCellJobKey,
  databaseComparisonColumnJobKey,
  getBackgroundJob,
  startDatabaseAiImageColumnJob,
  startDatabaseAiImageCellJob,
  startDatabaseAiTextColumnJob,
  startDatabaseAiTextCellJob,
  startDatabaseComparisonCellJob,
  startDatabaseComparisonColumnJob,
  subscribeBackgroundJob,
  type DatabaseAiColumnJob,
  type DatabaseAiImageCellJob,
  type DatabaseAiTextCellJob,
  type DatabaseComparisonCellJob,
  type DatabaseComparisonColumnJob,
} from '../backgroundJobs';
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
import { matchFilesToRows, summarizeMatches, codeTemplateToRegex } from '@shared/databaseBulk';
import { comparisonSourceColumns, isComparisonSource } from '@shared/databaseComparison';
import type { CsvImportPlanData } from '@shared/databaseCsv';
import {
  applyDatabaseFilter,
  sortDatabaseRows,
  isFilterActive,
  operatorsForColumn,
  opNeedsValue,
  opLabel,
  type DatabaseFilterState,
  type DatabaseSavedView,
  type FilterCondition,
  type FilterGroup,
  type SortRule,
} from '@shared/databaseFilters';
import {
  ARITHMETIC_OPS,
  COLUMN_STAT_FNS,
  FORMULA_RECIPES,
  comparableType,
  emptyFormula,
  formulaResultKind,
  isNumericSource,
  validateFormula,
  type ConcatPart,
  type FormulaColorRule,
  type FormulaKind,
  type FormulaOperand,
  type FormulaOutput,
  type FormulaRule,
  type FormulaSpec,
} from '@shared/databaseFormula';
import { computeFormulas, describeFormula } from '@shared/databaseFormulaEval';
import type {
  DatabaseAttachment,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRelation,
  DatabaseRow,
  DatabaseSelectOption,
  AppSettings,
  ImageProvider,
  ImageModelInfo,
  ModelRef,
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
  if (col.type === 'rollup') return row.rollups?.[col.id] ?? '';
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
    // Electron has no window.prompt (it returns null without showing anything), so this
    // button did nothing at all until it asked through the app's own dialog.
    const name = await promptText({
      title: t('Guardar vista'),
      message: t('La vista recuerda el diseño, los filtros y el orden que tienes ahora.'),
      initial: t('Nueva vista'),
    });
    if (!name) return;
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
      void window.nodus
        .updateDatabaseColumn(col.id, { config: { ...col.config, width: w, fitContent: true } })
        .then(reloadColumns);
    },
    [rows, reloadColumns]
  );
  /**
   * Forget a column's stored width so it falls back to the default for its type. Fitting to
   * content writes a width computed from the data, and until this existed there was no way
   * back from it — dragging could approximate the old size but never restore it.
   */
  const resetColumnWidth = useCallback(
    async (col: DatabaseColumn) => {
      setWidthOverrides((prev) => {
        const next = { ...prev };
        delete next[col.id];
        return next;
      });
      const { width: _width, fitContent: _fitContent, ...rest } = col.config;
      await window.nodus.updateDatabaseColumn(col.id, { config: rest });
      await reloadColumns();
    },
    [reloadColumns]
  );

  const fittedColumns = useMemo(() => columns.filter((col) => Boolean(col.config.fitContent)), [columns]);
  const rowHeightOf = useCallback(
    (row: DatabaseRow) =>
      fittedColumns.reduce(
        (height, col) =>
          Math.max(height, wrappedCellHeight(cellPreview(col, row), widthOf(col), col.type === 'ai' ? 30 : 0)),
        ROW_HEIGHT
      ),
    [fittedColumns, widthOf]
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
                  columns={columns}
                  rows={rows}
                  width={widthOf(col)}
                  onChanged={reloadColumnsAndRows}
                  onResizeStart={(x) => startResize(col, x)}
                  onFit={() => fitColumn(col)}
                  onResetWidth={() => void resetColumnWidth(col)}
                  onReorder={reorderColumn}
                />
              ))}
              <AddColumnButton onAdd={addColumn} />
            </div>

            {/* Body. overflow-x-hidden matters: VirtualList sets overflow-y, which CSS promotes
                the other axis to `auto`, so once the vertical scrollbar appears it eats ~15px of
                width, the rows no longer fit, and a SECOND horizontal scrollbar shows up under
                the one this container already provides. Only the outer div scrolls sideways. */}
            <VirtualList
              className="flex-1 min-h-0 overflow-x-hidden"
              items={visibleRows}
              itemHeight={fittedColumns.length > 0 ? rowHeightOf : ROW_HEIGHT}
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
                <div className="flex border-b border-neutral-900 hover:bg-neutral-900/40 group" style={{ minHeight: ROW_HEIGHT, height: '100%' }}>
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
                      columns={columns}
                      width={widthOf(col)}
                      value={row.cells[col.id] ?? null}
                      rollup={row.rollups?.[col.id] ?? ''}
                      formulaColor={row.formulaColors?.[col.id]}
                      formulaError={row.formulaErrors?.[col.id]}
                      rowId={row.id}
                      attachments={row.attachments?.[col.id] ?? []}
                      wrap={Boolean(col.config.fitContent)}
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

export function newFilterCondition(filterable: DatabaseColumn[]): FilterCondition {
  const col = filterable[0];
  return { id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, columnId: col.id, op: operatorsForColumn(col)[0], value: null };
}

/**
 * One condition row (column · operator · value), reused at the top level, in filter groups
 * and by the formula editor's "Si… entonces…" rules — so a condition is written the same way
 * everywhere in the app and is only learned once.
 */
export function ConditionRow({
  cond,
  first,
  conjunction,
  filterable,
  byId,
  onUpdate,
  onRemove,
  onToggleConjunction,
  firstLabel,
  labelClass,
}: {
  cond: FilterCondition;
  first: boolean;
  conjunction: 'and' | 'or';
  filterable: DatabaseColumn[];
  byId: Map<string, DatabaseColumn>;
  onUpdate: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
  onToggleConjunction: () => void;
  /** Leading word for the first row ("Donde" in a filter, "Si" in a formula rule), translated. */
  firstLabel?: string;
  /** Gutter for that leading word; widen it so a row lines up with its neighbours. */
  labelClass?: string;
}) {
  const col = byId.get(cond.columnId);
  const ops = col ? operatorsForColumn(col) : [];
  return (
    <div className="flex items-center gap-1.5">
      <span className={labelClass ?? 'w-10 text-[11px] text-neutral-500 text-right shrink-0'}>
        {first ? (
          (firstLabel ?? t('Donde'))
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
          onUpdate({ columnId: e.target.value, op: nc ? operatorsForColumn(nc)[0] : cond.op, value: null });
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
      <button
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-red-400 hover:bg-neutral-800"
        title={t('Quitar')}
        onClick={onRemove}
      >
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
  const filterable = columns.filter((c) => operatorsForColumn(c).length > 0);
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
  // A formula column takes the input its result deserves — a number box for a numeric one.
  const ct = comparableType(column);
  const inputType = ct === 'number' ? 'number' : ct === 'date' ? 'date' : ct === 'time' ? 'time' : 'text';
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
  const [fuzzy, setFuzzy] = useState(false);
  const [codeTemplate, setCodeTemplate] = useState('');
  const [ocr, setOcr] = useState(false);
  const [describe, setDescribe] = useState(false);

  useEffect(() => window.nodus.onDatabaseBulkProgress((p) => {
    if (p.databaseId === databaseId) setProgress({ done: p.done, total: p.total });
  }), [databaseId]);

  const matches = useMemo(
    () =>
      refId
        ? matchFilesToRows(
            files.map((f) => f.name),
            rows.map((r) => ({ rowId: r.id, refValue: r.cells[refId] ?? null })),
            { fuzzy, codePattern: codeTemplate.trim() ? codeTemplateToRegex(codeTemplate) : null }
          )
        : [],
    [files, refId, rows, fuzzy, codeTemplate]
  );
  const summary = useMemo(() => summarizeMatches(matches), [matches]);
  const matched = matches.length - summary.unmatched;
  const badTemplate = codeTemplate.trim().length > 0 && codeTemplateToRegex(codeTemplate) == null;

  const pick = async (mode: 'files' | 'folder') => {
    const picked = await window.nodus.pickBulkDatabaseFiles(mode);
    if (picked.length) setFiles(picked);
  };
  const run = async (background: boolean) => {
    if (!refId || !attId || files.length === 0) return;
    const opts = { ocr, describe, fuzzy, codeTemplate: codeTemplate.trim() || null };
    setRunning(true);
    if (background) {
      void window.nodus.bulkAttachDatabaseFiles(databaseId, refId, attId, files, opts);
      toast(t('Subida en segundo plano…'));
      onClose();
      return;
    }
    await window.nodus.bulkAttachDatabaseFiles(databaseId, refId, attId, files, opts);
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
            {t('Elige archivos o una carpeta completa. Nodus empareja cada archivo con su fila por el nombre exacto y, si no, por el código del catálogo que compartan (LV001-FG001).')}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void pick('files')}>
              <Icon name="folderPlus" /> {t('Elegir archivos')}
            </button>
            <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void pick('folder')}>
              <Icon name="folderPlus" /> {t('Elegir carpeta')}
            </button>
            {files.length > 0 && <span className="text-xs text-neutral-500 self-center">{tx('{n} archivos', { n: files.length.toLocaleString() })}</span>}
          </div>
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
          <div>
            <label className="text-xs text-neutral-500">{t('Código en el nombre (opcional)')}</label>
            <input
              className={`input w-full mt-1 ${badTemplate ? 'border-red-500' : ''}`}
              placeholder={t('Ej.: @@###-@@### · # dígito, @ letra, * cualquier cosa')}
              value={codeTemplate}
              onChange={(e) => setCodeTemplate(e.target.value)}
            />
            <p className="text-[11px] text-neutral-600 mt-1">
              {badTemplate ? t('Ese patrón no es válido.') : t('Déjalo vacío para detectar el código automáticamente.')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} />
            {t('Emparejar también por parecido del nombre (menos preciso)')}
          </label>
          {summary.fuzzyDeclined && (
            <p className="text-[11px] text-amber-400 -mt-1.5">
              {t('Hay demasiados archivos sin pareja para compararlos por parecido. Revisa la columna de referencia o el código.')}
            </p>
          )}
          <div className="border-t border-neutral-800 pt-3">
            <p className="text-xs text-neutral-500 mb-2">{t('Al adjuntar, además de guardar el archivo:')}</p>
            <label className="flex items-center gap-2 text-xs text-neutral-400 mb-1.5">
              <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
              {t('Extraer el texto (OCR)')}
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={describe} onChange={(e) => setDescribe(e.target.checked)} />
              {t('Describir cada imagen con IA')}
            </label>
            {(ocr || describe) && files.length > 200 && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                {tx('Con {n} archivos esto puede tardar horas. Puedes adjuntarlos ahora y hacerlo después por columnas.', {
                  n: files.length.toLocaleString(),
                })}
              </p>
            )}
          </div>
          {files.length > 0 && (
            <div className="text-xs text-neutral-400">
              <p>{tx('{m} de {n} archivos coinciden con una fila.', { m: matched.toLocaleString(), n: files.length.toLocaleString() })}</p>
              <p className="text-[11px] text-neutral-600 mt-0.5">
                {tx('Por nombre exacto: {e} · por código: {c} · por parecido: {f} · sin pareja: {u}', {
                  e: summary.exact.toLocaleString(),
                  c: summary.code.toLocaleString(),
                  f: summary.fuzzy.toLocaleString(),
                  u: summary.unmatched.toLocaleString(),
                })}
              </p>
              {summary.unmatched > 0 && (
                <p className="text-[11px] text-neutral-600 mt-0.5 truncate" title={matches.filter((m) => !m.rowId).map((m) => m.fileName).join(', ')}>
                  {tx('Sin pareja: {list}', { list: matches.filter((m) => !m.rowId).slice(0, 3).map((m) => m.fileName).join(', ') })}
                </p>
              )}
            </div>
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
/** `gap-3` in pixels — the virtualizer needs the real spacing to place rows. */
const GALLERY_GAP_PX = 12;
/** The card's fixed text block below the square image (`h-[4.25rem]`). */
const GALLERY_CARD_TEXT_PX = 68;

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

  // Available width, so the virtualized row height can be derived from the real
  // card size. Cards are `aspect-square` plus a fixed text block, so once the
  // width is known every grid row is exactly the same height.
  //
  // The element is held in state rather than a ref: a ref callback's return
  // value is ignored on React 18, so disconnecting the observer has to happen
  // in an effect or it would leak one observer per gallery mount.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    if (!gridEl) return;
    const update = () => setGridWidth(gridEl.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl]);

  // One virtual item per grid ROW, not per card: the gallery previously mounted
  // every card at once, and each one fires an IPC call for its thumbnail and
  // holds a Blob URL. At 7,000 rows that flooded the main process and pinned
  // hundreds of megabytes of encoded images.
  const rowGroups = useMemo(() => {
    const groups: DatabaseRow[][] = [];
    for (let index = 0; index < rows.length; index += cols) groups.push(rows.slice(index, index + cols));
    return groups;
  }, [rows, cols]);

  const cardWidth = gridWidth > 0 ? (gridWidth - GALLERY_GAP_PX * (cols - 1)) / cols : 0;
  const groupHeight = cardWidth + GALLERY_CARD_TEXT_PX + GALLERY_GAP_PX;

  return (
    <div className="flex-1 min-h-0 flex flex-col p-4">
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
          {/* Measured by the ref; the list only renders once a real width is known
              so the row height is never derived from a zero-width layout pass. */}
          <div ref={setGridEl} className="flex-1 min-h-0">
            {gridWidth > 0 && (
              <VirtualList
                items={rowGroups}
                itemHeight={groupHeight}
                getKey={(_group, index) => index}
                className="h-full"
                renderItem={(group) => (
                  <div
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      height: groupHeight - GALLERY_GAP_PX,
                      marginBottom: GALLERY_GAP_PX,
                    }}
                  >
                    {group.map((row) => (
                      <GalleryCard key={row.id} row={row} columns={columns} chipCols={chipCols} fit={fit} onOpen={() => onOpen(row.id)} />
                    ))}
                  </div>
                )}
              />
            )}
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
      data-testid="gallery-card"
      className="card p-0 overflow-hidden text-left hover:border-indigo-600/70 transition-colors flex flex-col"
      onClick={onOpen}
    >
      {/* Fixed square so every card is the same size, regardless of image (or none). */}
      {/* `w-full` is what actually makes the square square. `aspect-square` alone
          needs a definite width to derive its height from; as a column flex item
          with no image inside, it collapsed to the placeholder icon's 26px, so
          image-less cards were a third the height of the rest — contradicting the
          comment above. A definite width makes every card the same size for real,
          which is also what lets the gallery virtualize on a known row height. */}
      <div className="w-full aspect-square shrink-0 bg-neutral-900/60 flex items-center justify-center overflow-hidden">
        {cover && url ? (
          <img src={url} alt="" className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} />
        ) : (
          <Icon name="table" size={26} className="text-neutral-700" />
        )}
      </div>
      {/* Fixed height, not just a fixed square above it: a card with two rows of chips used to
          be taller than one with none, so the grid came out ragged. Every card is now the same
          box and the content is clipped inside it. */}
      <div className="p-2.5 min-w-0 h-[4.25rem] flex flex-col gap-1.5 overflow-hidden">
        <div className="font-medium text-sm truncate shrink-0">{rowTitle(row, columns)}</div>
        {chipCols.length > 0 && (
          <div className="flex flex-wrap gap-1 min-h-0 overflow-hidden">
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
    <div className="database-record-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="database-record-modal card-modal w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden"
        data-testid="database-record-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || databaseName}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="database-record-header flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
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
                  <div key={col.id} className="database-record-row flex items-start gap-4 rounded-lg px-2 py-1.5 hover:bg-neutral-900/40 transition-colors">
                    <label className="w-36 shrink-0 pt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                      <Icon name={def.icon} size={12} className="opacity-60 shrink-0" />
                      <span className="truncate">{col.name}</span>
                    </label>
                    <div className="database-record-field flex-1 min-w-0 rounded-md border border-neutral-800/70 bg-neutral-900/30 min-h-[2.25rem] flex items-center hover:border-neutral-700/80 focus-within:border-neutral-600 transition-colors">
                      <RecordField
                        col={col}
                        columns={columns}
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
  columns,
  row,
  onChange,
  onOptionsChanged,
  onAttachmentsChanged,
}: {
  col: DatabaseColumn;
  columns: DatabaseColumn[];
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
  if (col.type === 'ai') return <AiCell column={col} rowId={row.id} value={value} onChange={onChange} onRan={onAttachmentsChanged} wrap />;
  if (col.type === 'relation') return <RelationCell column={col} rowId={row.id} />;
  if (col.type === 'rollup') return <RollupCell value={row.rollups?.[col.id] ?? ''} />;
  if (col.type === 'comparison')
    return <ComparisonCell column={col} columns={columns} rowId={row.id} value={value} onRan={onAttachmentsChanged} large />;
  if (col.type === 'formula')
    return <FormulaCell column={col} value={value} color={row.formulaColors?.[col.id]} error={row.formulaErrors?.[col.id]} large />;
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
  columns,
  rows,
  width,
  onChanged,
  onResizeStart,
  onFit,
  onResetWidth,
  onReorder,
}: {
  column: DatabaseColumn;
  /** Siblings + rows: a formula is built out of the other columns and previewed on real rows. */
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  width: number;
  onChanged: () => void;
  onResizeStart: (clientX: number) => void;
  onFit: () => void;
  onResetWidth: () => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Lifted out of FormulaColumnConfig so switching the type can open the editor too.
  const [formulaOpen, setFormulaOpen] = useState(false);
  const def = columnTypeDef(column.type);

  const rename = async () => {
    setMenuOpen(false);
    // Same as the saved-view name: window.prompt is a no-op in Electron.
    const name = await promptText({ title: t('Renombrar columna'), initial: column.name });
    if (!name) return;
    await window.nodus.updateDatabaseColumn(column.id, { name: name.trim() });
    onChanged();
  };
  const changeType = async (type: DatabaseColumnType) => {
    await window.nodus.updateDatabaseColumn(column.id, { type });
    onChanged();
    setMenuOpen(false);
    // A formula does nothing until it has a recipe, so picking the type is really the first
    // step of building one: open the editor rather than leaving an inert column behind and
    // making the user find the button that configures it.
    if (type === 'formula' && !column.config.formula) setFormulaOpen(true);
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
      {/* Resize handle: drag to set width, double-click to fit to content. Straddles the
          column's own border (translate-x-1/2) instead of sitting inside it, so the line you
          grab is the line you see rather than one a few pixels to its left. */}
      <div
        className="absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize hover:bg-indigo-500/40"
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
            {/* Only offered once a width has actually been stored, so it appears exactly when
                there is something to undo — fitting to content had no way back otherwise. */}
            {typeof column.config.width === 'number' && (
              <button
                className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-800 flex items-center gap-2"
                onClick={() => {
                  onResetWidth();
                  setMenuOpen(false);
                }}
              >
                <Icon name="undo" size={13} /> {t('Restablecer ancho')}
              </button>
            )}
            {column.type === 'ai' && <AiColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'ai_image' && <AiImageColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'relation' && <RelationColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'rollup' && <RollupColumnConfig column={column} onChanged={onChanged} />}
            {column.type === 'comparison' && <ComparisonColumnConfig column={column} columns={columns} onChanged={onChanged} />}
            {column.type === 'formula' && (
              <FormulaColumnConfig
                column={column}
                columns={columns}
                onEdit={() => {
                  setMenuOpen(false);
                  setFormulaOpen(true);
                }}
              />
            )}
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
      {formulaOpen && (
        <FormulaEditorModal
          column={column}
          columns={columns}
          rows={rows}
          onClose={() => setFormulaOpen(false)}
          onSaved={() => {
            setFormulaOpen(false);
            onChanged();
          }}
        />
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
  columns,
  width,
  value,
  rollup,
  formulaColor,
  formulaError,
  rowId,
  attachments,
  wrap,
  onChange,
  onOptionsChanged,
  onAttachmentsChanged,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  width: number;
  value: string | null;
  rollup?: string;
  formulaColor?: string;
  formulaError?: string;
  rowId: string;
  attachments: DatabaseAttachment[];
  wrap: boolean;
  onChange: (raw: string | null) => void;
  onOptionsChanged: () => void;
  onAttachmentsChanged: () => void;
}) {
  return (
    <div style={{ width }} className="shrink-0 h-full border-r border-neutral-900 overflow-hidden">
      {column.type === 'formula' ? (
        <FormulaCell column={column} value={value} color={formulaColor} error={formulaError} wrap={wrap} />
      ) : column.type === 'comparison' ? (
        <ComparisonCell column={column} columns={columns} rowId={rowId} value={value} onRan={onAttachmentsChanged} wrap={wrap} />
      ) : column.type === 'checkbox' ? (
        <CheckboxCell value={value} onChange={onChange} />
      ) : column.type === 'select' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi={false} wrap={wrap} />
      ) : column.type === 'multi_select' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi wrap={wrap} />
      ) : column.type === 'attachment' ? (
        <AttachmentCell rowId={rowId} columnId={column.id} attachments={attachments} onChanged={onAttachmentsChanged} />
      ) : column.type === 'ai_image' ? (
        <AiImageCell column={column} rowId={rowId} attachments={attachments} onChanged={onAttachmentsChanged} />
      ) : column.type === 'ai' ? (
        <AiCell column={column} rowId={rowId} value={value} onChange={onChange} onRan={onAttachmentsChanged} wrap={wrap} />
      ) : column.type === 'relation' ? (
        <RelationCell column={column} rowId={rowId} />
      ) : column.type === 'rollup' ? (
        <RollupCell value={rollup ?? ''} wrap={wrap} />
      ) : column.type === 'number' ? (
        <TextCell value={value} onChange={onChange} inputType="number" align="right" wrap={wrap} />
      ) : column.type === 'date' ? (
        <TextCell value={value} onChange={onChange} inputType="date" wrap={wrap} />
      ) : column.type === 'time' ? (
        <TextCell value={value} onChange={onChange} inputType="time" wrap={wrap} />
      ) : (
        <LongTextCell value={value} onChange={onChange} markdown={column.type === 'text'} wrap={wrap} />
      )}
    </div>
  );
}

// ── Comparison columns ───────────────────────────────────────────────────────

/** Read-only result with a per-cell action to recompute this row. */
function ComparisonCell({
  column,
  columns,
  rowId,
  value,
  onRan,
  large = false,
  wrap = false,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  rowId: string;
  value: string | null;
  onRan: () => void;
  large?: boolean;
  wrap?: boolean;
}) {
  const jobKey = databaseComparisonCellJobKey(rowId, column.id);
  const [job, setJob] = useState<DatabaseComparisonCellJob | null>(() => getBackgroundJob(jobKey));
  const configured = comparisonSourceColumns(column, columns).length >= 2;
  const busy = job?.status === 'running';
  const error = job?.status === 'failed' ? job.error : null;
  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseComparisonCellJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onRan();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onRan]);
  const run = () => {
    clearBackgroundJob(jobKey);
    startDatabaseComparisonCellJob(rowId, column.id);
  };
  return (
    <div className={`w-full ${large ? 'min-h-8' : 'h-full'} flex items-center gap-1 group/comparison overflow-hidden`}>
      <span
        className={`flex-1 min-w-0 px-2 text-sm text-neutral-300 ${wrap ? 'whitespace-pre-wrap break-words py-1' : 'truncate'}`}
        title={value ?? t('Sin mayoría')}
      >
        {value || <span className="text-neutral-600">—</span>}
      </span>
      <button
        className="shrink-0 mr-2 opacity-60 group-hover/comparison:opacity-100 text-indigo-400 hover:text-indigo-300 disabled:opacity-30"
        title={error ?? (configured ? t('Comparar esta fila') : t('Elige al menos dos columnas'))}
        onClick={run}
        disabled={busy || !configured}
      >
        <Icon name={busy ? 'sync' : 'scale'} size={14} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

/** Source selector and whole-column action in the header menu. */
function ComparisonColumnConfig({
  column,
  columns,
  onChanged,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  onChanged: () => void;
}) {
  const candidates = columns.filter((candidate) => candidate.id !== column.id && isComparisonSource(candidate));
  const [selected, setSelected] = useState<string[]>(() => comparisonSourceColumns(column, columns).map((candidate) => candidate.id));
  const jobKey = databaseComparisonColumnJobKey(column.databaseId, column.id);
  const [job, setJob] = useState<DatabaseComparisonColumnJob | null>(() => getBackgroundJob(jobKey));
  const busy = job?.status === 'running';
  const runProgress = busy ? job.progress : null;
  useEffect(() => {
    setSelected(comparisonSourceColumns(column, columns).map((candidate) => candidate.id));
  }, [column, columns]);
  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseComparisonColumnJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onChanged();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onChanged]);

  const toggle = async (id: string) => {
    const next = selected.includes(id) ? selected.filter((sourceId) => sourceId !== id) : [...selected, id];
    setSelected(next);
    await window.nodus.updateDatabaseColumn(column.id, {
      config: { ...column.config, comparisonSourceColumnIds: next },
    });
    onChanged();
  };
  const runAll = () => {
    clearBackgroundJob(jobKey);
    startDatabaseComparisonColumnJob(column.databaseId, column.id);
  };

  return (
    <div className="px-2 py-1 border-t border-neutral-800 mt-1">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 py-1">{t('Columnas que comparar')}</div>
      <div className="max-h-32 overflow-y-auto space-y-0.5">
        {candidates.map((candidate) => (
          <label key={candidate.id} className="flex items-center gap-2 rounded px-1 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
            <input type="checkbox" checked={selected.includes(candidate.id)} onChange={() => void toggle(candidate.id)} />
            <span className="truncate">{candidate.name}</span>
          </label>
        ))}
      </div>
      {selected.length < 2 && <p className="mt-1 text-[10px] text-amber-400">{t('Elige al menos dos columnas')}</p>}
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        {t('Solo cuentan coincidencias exactas; los valores vacíos se ignoran.')}
      </p>
      <button
        className="btn btn-ghost border border-neutral-700 w-full gap-1.5 mt-2 text-xs"
        onClick={runAll}
        disabled={busy || selected.length < 2}
        title={job?.status === 'failed' ? job.error ?? undefined : undefined}
      >
        <Icon name={busy ? 'sync' : 'scale'} size={13} className={busy ? 'animate-spin' : ''} />
        {busy && runProgress && runProgress.total > 0
          ? tx('Ejecutando… {d}/{t}', { d: runProgress.done, t: runProgress.total })
          : busy ? t('Comparando…') : t('Comparar todas las filas')}
      </button>
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
            <div className="fixed z-[61] card-modal p-2 text-sm" style={anchorStyle(coords)}>
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
  wrap = false,
}: {
  column: DatabaseColumn;
  value: string | null;
  onChange: (raw: string | null) => void;
  onOptionsChanged: () => void;
  multi: boolean;
  wrap?: boolean;
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
        className={`w-full h-full px-2 flex items-center gap-1 overflow-hidden hover:bg-neutral-800/40 ${wrap ? 'flex-wrap content-center py-1' : ''}`}
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
              style={anchorStyle(coords)}
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

function AiCell({
  column,
  rowId,
  value,
  onChange,
  onRan,
  wrap = false,
}: {
  column: DatabaseColumn;
  rowId: string;
  value: string | null;
  onChange: (raw: string | null) => void;
  onRan: () => void;
  wrap?: boolean;
}) {
  const jobKey = databaseAiTextCellJobKey(rowId, column.id);
  const [job, setJob] = useState<DatabaseAiTextCellJob | null>(() => getBackgroundJob(jobKey));
  const hasPrompt = Boolean(String(column.config.aiPrompt ?? '').trim());
  const busy = job?.status === 'running';
  const error = job?.status === 'failed' ? job.error : null;

  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseAiTextCellJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onRan();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onRan]);

  const run = () => {
    clearBackgroundJob(jobKey);
    startDatabaseAiTextCellJob(rowId, column.id);
  };
  return (
    <div className="w-full h-full flex items-center gap-1 group/ai">
      <div className="flex-1 min-w-0 h-full">
        <LongTextCell
          value={value}
          onChange={onChange}
          markdown={false}
          wrap={wrap}
          emptyLabel={hasPrompt ? undefined : t('Configura el prompt →')}
        />
      </div>
      <button
        className="shrink-0 mr-2 opacity-60 group-hover/ai:opacity-100 text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
        title={error ?? t('Generar con IA')}
        onClick={run}
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
  const [model, setModel] = useState<ModelRef | null>(column.config.aiModel ?? null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [attachmentCols, setAttachmentCols] = useState<DatabaseColumn[]>([]);
  const jobKey = databaseAiTextColumnJobKey(column.databaseId, column.id);
  const [job, setJob] = useState<DatabaseAiColumnJob | null>(() => getBackgroundJob(jobKey));
  const running = job?.status === 'running';
  const runProgress = running ? job.progress : null;
  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseAiColumnJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onChanged();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onChanged]);
  const runAll = () => {
    clearBackgroundJob(jobKey);
    startDatabaseAiTextColumnJob(column.databaseId, column.id);
  };
  useEffect(() => {
    void Promise.all([window.nodus.getDatabaseDetail(column.databaseId), window.nodus.getSettings()]).then(([d, nextSettings]) => {
      setAttachmentCols((d?.columns ?? []).filter((c) => c.type === 'attachment'));
      setSettings(nextSettings);
    });
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
      {settings && (
        <>
          <label className="text-[10px] uppercase tracking-wide text-neutral-500 mt-2 block">{t('Modelo')}</label>
          <ModelPicker
            settings={settings}
            value={model}
            onChange={(nextModel) => {
              setModel(nextModel);
              void save({ aiModel: nextModel ?? undefined });
            }}
            compact
            disabled={running}
            emptyLabel={
              (settings.chatModel ?? settings.synthesisModel)?.model
                ? tx('Predeterminado ({model})', { model: (settings.chatModel ?? settings.synthesisModel)!.model })
                : t('Predeterminado')
            }
            className="w-full mt-1"
          />
        </>
      )}
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
        onClick={runAll}
        disabled={running || !prompt.trim()}
        title={job?.status === 'failed' ? job.error ?? undefined : undefined}
      >
        <Icon name={running ? 'sync' : 'wand'} size={13} className={running ? 'animate-spin' : ''} />
        {running && runProgress && runProgress.total > 0
          ? tx('Ejecutando… {d}/{t}', { d: runProgress.done, t: runProgress.total })
          : running ? t('Calculando…') : t('Ejecutar en todas las filas')}
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
  const jobKey = databaseAiImageCellJobKey(rowId, column.id);
  const [job, setJob] = useState<DatabaseAiImageCellJob | null>(() => getBackgroundJob(jobKey));
  const hasPrompt = Boolean(String(column.config.aiPrompt ?? '').trim());
  const busy = job?.status === 'running';
  const error = job?.status === 'failed' ? job.error : null;

  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseAiImageCellJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onChanged();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onChanged]);

  const generate = () => {
    clearBackgroundJob(jobKey);
    startDatabaseAiImageCellJob(rowId, column.id);
  };
  const remove = async (att: DatabaseAttachment) => {
    if (await removeStoredAttachment(att)) onChanged();
  };
  const btnBox = large ? 'w-24 h-24' : 'w-7 h-7';
  return (
    <div className={`w-full ${large ? 'flex-wrap py-1' : 'h-full overflow-x-auto'} px-1.5 flex items-center gap-1.5`}>
      {attachments.map((att) => (
        <div key={att.id} className="shrink-0 flex items-center gap-1">
          <AttachmentThumb att={att} large={large} onRemove={() => void remove(att)} />
          <AiImageAttachmentActions att={att} large={large} onRemove={() => void remove(att)} />
        </div>
      ))}
      <button
        className={`shrink-0 ${btnBox} rounded flex items-center justify-center text-indigo-400 border border-dashed border-neutral-700 hover:bg-neutral-800 hover:text-indigo-300 disabled:opacity-40`}
        title={error ?? (hasPrompt ? (attachments.length ? t('Regenerar imagen') : t('Generar imagen con IA')) : t('Configura el prompt primero'))}
        onClick={generate}
        disabled={busy || !hasPrompt}
      >
        <Icon name={busy ? 'sync' : attachments.length ? 'sync' : 'wand'} size={large ? 18 : 14} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

/** Visible asset management for generated images; preview actions remain available too. */
function AiImageAttachmentActions({
  att,
  onRemove,
  large,
}: {
  att: DatabaseAttachment;
  onRemove: () => void;
  large: boolean;
}) {
  const size = large ? 'w-9 h-9' : 'w-7 h-7';
  return (
    <div className={`shrink-0 flex ${large ? 'flex-col' : 'items-center'} gap-1`}>
      <button
        className={`btn btn-ghost ${size} p-0 text-indigo-400 hover:text-indigo-300`}
        title={t('Descargar')}
        aria-label={t('Descargar')}
        onClick={(event) => {
          event.stopPropagation();
          void downloadStoredAttachment(att);
        }}
      >
        <Icon name="download" size={large ? 15 : 13} />
      </button>
      <button
        className={`btn btn-ghost ${size} p-0 text-red-400 hover:text-red-300`}
        title={t('Eliminar')}
        aria-label={t('Eliminar')}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="trash" size={large ? 15 : 13} />
      </button>
    </div>
  );
}

function AiImageColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const [prompt, setPrompt] = useState(String(column.config.aiPrompt ?? ''));
  const [model, setModel] = useState<{ provider: ImageProvider; model: string } | null>(column.config.aiImageModel ?? null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const jobKey = databaseAiImageColumnJobKey(column.databaseId, column.id);
  const [job, setJob] = useState<DatabaseAiColumnJob | null>(() => getBackgroundJob(jobKey));
  const running = job?.status === 'running';
  const runProgress = running ? job.progress : null;
  useEffect(
    () => subscribeBackgroundJob(jobKey, (current) => setJob(current as DatabaseAiColumnJob | null)),
    [jobKey]
  );
  useEffect(() => {
    if (job?.status !== 'completed') return;
    onChanged();
    clearBackgroundJob(jobKey, job.id);
  }, [job, jobKey, onChanged]);
  useEffect(() => {
    let live = true;
    void Promise.all([window.nodus.getSettings(), window.nodus.listImageModels()])
      .then(([nextSettings, nextModels]) => {
        if (!live) return;
        setSettings(nextSettings);
        setModels(nextModels);
        setModelsError(null);
      })
      .catch((reason) => {
        if (!live) return;
        setModelsError(reason instanceof Error ? reason.message : String(reason));
        void window.nodus.getSettings().then((nextSettings) => {
          if (live) setSettings(nextSettings);
        });
      });
    return () => {
      live = false;
    };
  }, []);
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  const runAll = () => {
    clearBackgroundJob(jobKey);
    startDatabaseAiImageColumnJob(column.databaseId, column.id);
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
      <label className="text-[10px] uppercase tracking-wide text-neutral-500 mt-2 block">{t('Modelo')}</label>
      <select
        className="input w-full text-xs mt-1"
        value={model ? `${model.provider}::${model.model}` : ''}
        disabled={running || !settings}
        onChange={(event) => {
          const selected = models.find((candidate) => `${candidate.provider}::${candidate.id}` === event.target.value);
          const nextModel = selected ? { provider: selected.provider, model: selected.id } : null;
          setModel(nextModel);
          void save({ aiImageModel: nextModel ?? undefined });
        }}
      >
        <option value="">
          {settings?.imageModel
            ? tx('Predeterminado ({model})', { model: settings.imageModel })
            : t('Predeterminado')}
        </option>
        {model && !models.some((candidate) => candidate.provider === model.provider && candidate.id === model.model) && (
          <option value={`${model.provider}::${model.model}`}>{model.provider} · {model.model}</option>
        )}
        {models.map((candidate) => (
          <option key={`${candidate.provider}:${candidate.id}`} value={`${candidate.provider}::${candidate.id}`}>
            {candidate.provider} · {candidate.name}
          </option>
        ))}
      </select>
      {modelsError && <p className="text-[10px] text-red-400 mt-1">{modelsError}</p>}
      <button
        className="btn btn-ghost border border-neutral-700 w-full gap-1.5 mt-2 text-xs"
        onClick={runAll}
        disabled={running || !prompt.trim()}
        title={job?.status === 'failed' ? job.error ?? undefined : undefined}
      >
        <Icon name={running ? 'sync' : 'image'} size={13} className={running ? 'animate-spin' : ''} />
        {running && runProgress && runProgress.total > 0
          ? tx('Generando… {d}/{t}', { d: runProgress.done, t: runProgress.total })
          : running ? t('Generando…') : t('Generar en todas las filas')}
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
              style={anchorStyle(coords)}
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
function RollupCell({ value, wrap = false }: { value: string; wrap?: boolean }) {
  return (
    <div className="w-full h-full px-2 flex items-center overflow-hidden text-sm text-neutral-300">
      <span className={wrap ? 'whitespace-pre-wrap break-words py-1' : 'truncate'} title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * A formula's result. Read-only by nature — it is computed, so there is nothing to type into.
 * A colour from an "Si… entonces…" rule (or a colour rule) becomes a tinted pill, which is the
 * whole point of the traffic-light use case; an unrunnable formula says so instead of a blank.
 */
function FormulaCell({
  column,
  value,
  color,
  error,
  large = false,
  wrap = false,
}: {
  column: DatabaseColumn;
  value: string | null;
  color?: string;
  error?: string;
  large?: boolean;
  wrap?: boolean;
}) {
  const numeric = comparableType(column) === 'number';
  const text = value == null || value === '' ? '' : numeric ? formatFormulaNumber(value, column) : value;
  if (error) {
    return (
      <div className={`w-full ${large ? '' : 'h-full'} px-2 flex items-center gap-1 overflow-hidden text-xs text-amber-400`} title={error}>
        <Icon name="alert" size={12} className="shrink-0" />
        <span className={wrap ? 'whitespace-pre-wrap break-words py-1' : 'truncate'}>{t(error)}</span>
      </div>
    );
  }
  return (
    // Numbers stay right-aligned whether or not a rule painted them: a column where the
    // coloured values drift left and the rest stay right reads as two different columns.
    <div className={`w-full ${large ? '' : 'h-full'} px-2 flex items-center overflow-hidden text-sm ${numeric ? 'justify-end' : ''}`}>
      {color ? (
        <span
          className={`${wrap ? 'whitespace-pre-wrap break-words' : 'truncate'} rounded px-1.5 py-0.5 text-xs font-medium`}
          style={{ backgroundColor: `${color}26`, color }}
          title={text}
        >
          {text || '—'}
        </span>
      ) : (
        <span className={wrap ? 'whitespace-pre-wrap break-words py-1 text-neutral-300' : 'truncate text-neutral-300'} title={text}>
          {text || <span className="text-neutral-600">—</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Show a computed number at the column's chosen precision. The cell stores the true value —
 * rounding lives here so that a "% of total" still adds up to 100 no matter how few decimals
 * the user wants to look at.
 */
function formatFormulaNumber(raw: string, column: DatabaseColumn): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const decimals = typeof column.config.formulaDecimals === 'number' ? column.config.formulaDecimals : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ── Formula editor ────────────────────────────────────────────────────────────

const newId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Layout grammar for the formula editor. Every block in the modal is built from these, so the
 * fields line up in a single column, the leading words of stacked rows share one gutter, and
 * the spacing is decided once instead of per-component. Written down because the editor grew
 * one ad-hoc `w-24`/`w-36`/`mt-1.5` at a time and stopped looking like one screen.
 */
/** Leading word of a control row ("Si", "mostrar", "si no"), sized so rows align vertically. */
const FROW_LABEL = 'w-16 shrink-0 text-right text-[11px] text-neutral-500';
/** The trailing remove button of a repeatable row, so every row ends the same way. */
const FROW_REMOVE = 'shrink-0 w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-red-400 hover:bg-neutral-800';
/** A narrow leading select (kind pickers) — one width for all of them. */
const FSELECT_LEAD = 'input text-xs w-32 shrink-0';

/** One labelled control with an optional hint: the only way this modal presents a field. */
function FormulaField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-neutral-400">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-neutral-500">{hint}</p>}
    </div>
  );
}

/** A boxed group of rows (rules, operands, colours) — one border, one padding, everywhere. */
function FormulaBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5 flex flex-col gap-2">{children}</div>;
}

/** The single "add another one of these" button style. */
function FormulaAdd({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button className="btn btn-ghost border border-neutral-700 self-start gap-1 text-xs h-7 px-2" onClick={onClick}>
      <Icon name="plus" size={12} /> {children}
    </button>
  );
}

/** Why a recipe cannot be built yet — same shape wherever it appears. */
function FormulaNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-xs text-amber-400">
      <Icon name="alert" size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Column-header entry point: the builder itself needs room, so it opens a modal. */
function FormulaColumnConfig({ column, columns, onEdit }: { column: DatabaseColumn; columns: DatabaseColumn[]; onEdit: () => void }) {
  const spec = column.config.formula as FormulaSpec | undefined;
  const summary = spec ? describeFormula(spec, columns, t) : t('Sin fórmula todavía');
  return (
    <div className="px-2 py-1.5 border-t border-neutral-800">
      <button className="btn btn-ghost border border-neutral-700 w-full gap-1.5 text-xs" onClick={onEdit}>
        <Icon name="sigma" size={13} className="text-indigo-400" /> {spec ? t('Editar fórmula') : t('Crear fórmula')}
      </button>
      <p className="mt-1 text-[10px] text-neutral-500 line-clamp-2" title={summary}>
        {summary}
      </p>
    </div>
  );
}

/**
 * The visual formula builder. Everything here exists to keep the user out of a syntax:
 * they pick a recipe, then point at columns by name, and see the answer on their own rows
 * as they go. Nothing is typed that could be mistyped.
 */
function FormulaEditorModal({
  column,
  columns,
  rows,
  onClose,
  onSaved,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [spec, setSpec] = useState<FormulaSpec | null>((column.config.formula as FormulaSpec | undefined) ?? null);
  const [colors, setColors] = useState<FormulaColorRule[]>((column.config.formulaColors as FormulaColorRule[] | undefined) ?? []);
  const [decimals, setDecimals] = useState<number>(
    typeof column.config.formulaDecimals === 'number' ? column.config.formulaDecimals : 2
  );
  const [busy, setBusy] = useState(false);

  // Never let a formula read itself: it is the one column that cannot be an operand.
  const others = useMemo(() => columns.filter((c) => c.id !== column.id), [columns, column.id]);
  const problem = spec ? validateFormula(spec, columns) : t('Elige qué quieres calcular.');
  const resultIsNumber = spec ? formulaResultKind(spec) === 'number' : false;

  /**
   * A column statistic is the only recipe that looks past its own row, so it is the only one
   * that needs a copy of the whole table to preview. Keeping this out of the preview memo
   * matters: it is keyed on `spec`, and copying 7k rows on every keystroke in a rule's text
   * box is exactly the kind of lag this editor exists to avoid.
   */
  const statRows = useMemo(() => {
    const needsTable =
      spec?.kind === 'columnStat' ||
      others.some((c) => c.type === 'formula' && (c.config.formula as FormulaSpec | undefined)?.kind === 'columnStat');
    return needsTable ? rows.map((r) => ({ ...r, cells: { ...r.cells } })) : null;
  }, [spec?.kind, others, rows]);

  const preview = useMemo(() => {
    if (!spec || validateFormula(spec, columns)) return [];
    // Evaluate against copies so the real grid is untouched while the user is still deciding.
    const sample = rows.slice(0, 5).map((r) => ({ ...r, cells: { ...r.cells }, formulaColors: undefined, formulaErrors: undefined }));
    const draft: DatabaseColumn = {
      ...column,
      type: 'formula',
      config: { ...column.config, formula: spec, formulaColors: colors, formulaDecimals: decimals },
    };
    try {
      computeFormulas(sample, [...others, draft], statRows ?? sample);
    } catch {
      return [];
    }
    // Format exactly as the grid will, so the preview is a promise and not an approximation.
    return sample.map((r) => {
      const raw = r.cells[column.id] ?? null;
      return {
        title: rowTitle(r, columns),
        value: raw != null && raw !== '' && formulaResultKind(spec) === 'number' ? formatFormulaNumber(raw, draft) : raw,
        color: r.formulaColors?.[column.id],
      };
    });
  }, [spec, colors, decimals, rows, columns, others, column, statRows]);

  const save = async () => {
    setBusy(true);
    try {
      await window.nodus.updateDatabaseColumn(column.id, {
        config: { ...column.config, formula: spec ?? undefined, formulaColors: colors, formulaDecimals: decimals },
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card-modal w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-800">
          <Icon name="sigma" size={16} className="text-indigo-400" />
          <h2 className="font-semibold truncate">{tx('Fórmula: {name}', { name: column.name })}</h2>
          <div className="flex-1" />
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* One column of FormulaFields, one gap between them: the whole body reads as a single
            form rather than a stack of differently-spaced widgets. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <FormulaField label={t('¿Qué quieres calcular?')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FORMULA_RECIPES.map((r) => {
                const active = spec?.kind === r.id;
                return (
                  <button
                    key={r.id}
                    className={`flex h-full flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors ${
                      active ? 'border-indigo-500 bg-indigo-600/15' : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/40'
                    }`}
                    onClick={() => setSpec(active ? spec : emptyFormula(r.id as FormulaKind))}
                  >
                    <Icon name={r.icon} size={15} className={active ? 'text-indigo-400' : 'text-neutral-500'} />
                    <span className="text-xs font-medium">{t(r.label)}</span>
                    <span className="text-[10px] leading-tight text-neutral-500">{t(r.hint)}</span>
                  </button>
                );
              })}
            </div>
          </FormulaField>

          {spec?.kind === 'arithmetic' && <ArithmeticEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'columnStat' && <ColumnStatEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'ifThen' && <IfThenEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'concat' && <ConcatEditor spec={spec} columns={others} onChange={setSpec} />}

          {spec && resultIsNumber && (
            <FormulaField label={t('Decimales a mostrar')} hint={t('Solo cambia cómo se ve: el valor guardado mantiene toda su precisión.')}>
              <select className="input w-32 text-xs" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 6].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </FormulaField>
          )}

          {spec && spec.kind !== 'ifThen' && <ColorRulesEditor rules={colors} numeric={resultIsNumber} onChange={setColors} />}

          {spec && (
            <FormulaField label={t('Vista previa')}>
              <FormulaBox>
                {problem ? (
                  <p className="text-xs text-amber-400">{t(problem)}</p>
                ) : preview.length === 0 ? (
                  <p className="text-xs text-neutral-600">{t('Añade filas para ver el resultado.')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {preview.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 truncate text-neutral-500" title={p.title}>
                          {p.title || t('(sin título)')}
                        </span>
                        {p.value == null || p.value === '' ? (
                          <span className="text-neutral-600">—</span>
                        ) : p.color ? (
                          <span className="rounded px-1.5 py-0.5 font-medium" style={{ backgroundColor: `${p.color}26`, color: p.color }}>
                            {p.value}
                          </span>
                        ) : (
                          <span className="text-neutral-200">{p.value}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!problem && (
                  <p className="pt-2 border-t border-neutral-800 text-[10px] leading-snug text-neutral-500">{describeFormula(spec, columns, t)}</p>
                )}
              </FormulaBox>
            </FormulaField>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => void save()} disabled={busy || Boolean(problem)}>
            <Icon name={busy ? 'sync' : 'check'} size={14} className={busy ? 'animate-spin' : ''} /> {t('Guardar')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Pick a column, or type a fixed number — the two things an operand can be. */
function OperandPicker({
  operand,
  columns,
  onChange,
  onRemove,
}: {
  operand: FormulaOperand;
  columns: DatabaseColumn[];
  onChange: (o: FormulaOperand) => void;
  onRemove: () => void;
}) {
  const numeric = columns.filter(isNumericSource);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <select
        className="input text-xs flex-1 min-w-0"
        value={operand.kind === 'column' ? operand.columnId : '__number__'}
        onChange={(e) =>
          onChange(e.target.value === '__number__' ? { kind: 'number', value: 0 } : { kind: 'column', columnId: e.target.value })
        }
      >
        {numeric.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__number__">{t('Un número fijo…')}</option>
      </select>
      {operand.kind === 'number' && (
        <input
          type="number"
          className="input text-xs w-24 shrink-0"
          value={operand.value}
          onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) || 0 })}
        />
      )}
      <button className={FROW_REMOVE} onClick={onRemove} title={t('Quitar')}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function ArithmeticEditor({
  spec,
  columns,
  onChange,
}: {
  spec: Extract<FormulaSpec, { kind: 'arithmetic' }>;
  columns: DatabaseColumn[];
  onChange: (s: FormulaSpec) => void;
}) {
  const numeric = columns.filter(isNumericSource);
  const def = ARITHMETIC_OPS.find((o) => o.id === spec.op)!;
  const add = () => {
    const first = numeric[0];
    onChange({ ...spec, operands: [...spec.operands, first ? { kind: 'column', columnId: first.id } : { kind: 'number', value: 0 }] });
  };
  if (numeric.length === 0) {
    return <FormulaNotice>{t('No hay ninguna columna de número, casilla o fórmula con la que operar.')}</FormulaNotice>;
  }
  return (
    <>
      <FormulaField label={t('Operación')} hint={def.ordered && spec.operands.length > 2 ? t('Se aplica en orden, de arriba abajo.') : undefined}>
        <select className="input w-full text-xs" value={spec.op} onChange={(e) => onChange({ ...spec, op: e.target.value as typeof spec.op })}>
          {ARITHMETIC_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </FormulaField>
      <FormulaField label={t('Con estas columnas o números')}>
        <FormulaBox>
          {spec.operands.length === 0 && <p className="text-[11px] text-neutral-600">{t('Todavía no has añadido nada.')}</p>}
          {spec.operands.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {/* The operator sits in the same gutter as every other row's leading word. */}
              <span className={`${FROW_LABEL} font-medium`}>{i === 0 ? '' : def.symbol || '·'}</span>
              <div className="flex-1 min-w-0">
                <OperandPicker
                  operand={o}
                  columns={columns}
                  onChange={(next) => onChange({ ...spec, operands: spec.operands.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => onChange({ ...spec, operands: spec.operands.filter((_, j) => j !== i) })}
                />
              </div>
            </div>
          ))}
          <FormulaAdd onClick={add}>{t('Añadir columna o número')}</FormulaAdd>
        </FormulaBox>
      </FormulaField>
    </>
  );
}

function ColumnStatEditor({
  spec,
  columns,
  onChange,
}: {
  spec: Extract<FormulaSpec, { kind: 'columnStat' }>;
  columns: DatabaseColumn[];
  onChange: (s: FormulaSpec) => void;
}) {
  const numeric = columns.filter(isNumericSource);
  const fn = COLUMN_STAT_FNS.find((f) => f.id === spec.fn)!;
  if (numeric.length === 0) {
    return <FormulaNotice>{t('No hay ninguna columna de número, casilla o fórmula que medir.')}</FormulaNotice>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormulaField label={t('Medida')} hint={t(fn.hint)}>
        <select className="input w-full text-xs" value={spec.fn} onChange={(e) => onChange({ ...spec, fn: e.target.value as typeof spec.fn })}>
          {COLUMN_STAT_FNS.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.label)}
            </option>
          ))}
        </select>
      </FormulaField>
      <FormulaField label={t('De la columna')} hint={t('Siempre se calcula sobre toda la tabla, aunque haya filtros puestos.')}>
        <select className="input w-full text-xs" value={spec.columnId} onChange={(e) => onChange({ ...spec, columnId: e.target.value })}>
          <option value="">{t('Elige una columna…')}</option>
          {numeric.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormulaField>
    </div>
  );
}

/** Pick what a rule shows when it wins: fixed text, a fixed number, another column, or nothing. */
function OutputPicker({ output, columns, onChange }: { output: FormulaOutput; columns: DatabaseColumn[]; onChange: (o: FormulaOutput) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <select
        className={FSELECT_LEAD}
        value={output.kind}
        onChange={(e) => {
          const k = e.target.value as FormulaOutput['kind'];
          if (k === 'text') onChange({ kind: 'text', value: '' });
          else if (k === 'number') onChange({ kind: 'number', value: 0 });
          else if (k === 'column') onChange({ kind: 'column', columnId: columns[0]?.id ?? '' });
          else onChange({ kind: 'empty' });
        }}
      >
        <option value="text">{t('este texto')}</option>
        <option value="number">{t('este número')}</option>
        <option value="column">{t('otra columna')}</option>
        <option value="empty">{t('nada')}</option>
      </select>
      {output.kind === 'text' && (
        <input
          className="input text-xs flex-1 min-w-0"
          placeholder={t('Ej.: Reciente')}
          value={output.value}
          onChange={(e) => onChange({ kind: 'text', value: e.target.value })}
        />
      )}
      {output.kind === 'number' && (
        <input
          type="number"
          className="input text-xs w-24"
          value={output.value}
          onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) || 0 })}
        />
      )}
      {output.kind === 'column' && (
        <select className="input text-xs flex-1 min-w-0" value={output.columnId} onChange={(e) => onChange({ kind: 'column', columnId: e.target.value })}>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** A colour swatch that cycles the shared option palette, plus "no colour". */
function ColorDot({ color, onChange }: { color: string | null | undefined; onChange: (c: string | null) => void }) {
  const next = () => {
    if (!color) return onChange(OPTION_COLORS[0]);
    const i = OPTION_COLORS.indexOf(color);
    return onChange(i < 0 || i === OPTION_COLORS.length - 1 ? null : OPTION_COLORS[i + 1]);
  };
  return (
    <button
      className="shrink-0 w-5 h-5 rounded-full border border-neutral-700 flex items-center justify-center"
      style={color ? { backgroundColor: color } : undefined}
      title={color ? t('Cambiar color') : t('Sin color')}
      onClick={next}
    >
      {!color && <Icon name="palette" size={11} className="text-neutral-600" />}
    </button>
  );
}

function IfThenEditor({
  spec,
  columns,
  onChange,
}: {
  spec: Extract<FormulaSpec, { kind: 'ifThen' }>;
  columns: DatabaseColumn[];
  onChange: (s: FormulaSpec) => void;
}) {
  const filterable = columns.filter((c) => operatorsForColumn(c).length > 0);
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  if (filterable.length === 0) return <FormulaNotice>{t('No hay columnas sobre las que poner condiciones.')}</FormulaNotice>;

  const setRule = (id: string, patch: Partial<FormulaRule>) =>
    onChange({ ...spec, rules: spec.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRule = () =>
    onChange({
      ...spec,
      rules: [
        ...spec.rules,
        { id: newId('fr'), conjunction: 'and', conditions: [newFilterCondition(filterable)], output: { kind: 'text', value: '' }, color: null },
      ],
    });

  return (
    <FormulaField label={t('Reglas')} hint={t('Se comprueban en orden: gana la primera regla que se cumpla.')}>
      <div className="flex flex-col gap-2">
        {spec.rules.map((rule, i) => (
          <FormulaBox key={rule.id}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-indigo-400">{tx('Regla {n}', { n: i + 1 })}</span>
              <div className="flex-1" />
              <button
                className={FROW_REMOVE}
                title={t('Eliminar regla')}
                onClick={() => onChange({ ...spec, rules: spec.rules.filter((r) => r.id !== rule.id) })}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            {rule.conditions.map((c, ci) => (
              <ConditionRow
                key={c.id}
                cond={c}
                first={ci === 0}
                firstLabel={t('Si')}
                labelClass={FROW_LABEL}
                conjunction={rule.conjunction}
                filterable={filterable}
                byId={byId}
                onUpdate={(patch) => setRule(rule.id, { conditions: rule.conditions.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) })}
                onRemove={() => setRule(rule.id, { conditions: rule.conditions.filter((x) => x.id !== c.id) })}
                onToggleConjunction={() => setRule(rule.id, { conjunction: rule.conjunction === 'and' ? 'or' : 'and' })}
              />
            ))}
            <FormulaAdd onClick={() => setRule(rule.id, { conditions: [...rule.conditions, newFilterCondition(filterable)] })}>
              {t('Añadir condición')}
            </FormulaAdd>
            {/* The outcome shares the conditions' gutter, so "Si" and "mostrar" line up. */}
            <div className="flex items-center gap-1.5 pt-2 border-t border-neutral-800/70">
              <span className={FROW_LABEL}>{t('mostrar')}</span>
              <OutputPicker output={rule.output} columns={columns} onChange={(output) => setRule(rule.id, { output })} />
              <ColorDot color={rule.color} onChange={(color) => setRule(rule.id, { color })} />
            </div>
          </FormulaBox>
        ))}
        <FormulaAdd onClick={addRule}>{t('Añadir regla')}</FormulaAdd>
        <FormulaBox>
          <div className="flex items-center gap-1.5">
            <span className={FROW_LABEL}>{t('si no')}</span>
            <OutputPicker output={spec.otherwise} columns={columns} onChange={(otherwise) => onChange({ ...spec, otherwise })} />
            <ColorDot color={spec.otherwiseColor} onChange={(otherwiseColor) => onChange({ ...spec, otherwiseColor })} />
          </div>
        </FormulaBox>
      </div>
    </FormulaField>
  );
}

function ConcatEditor({
  spec,
  columns,
  onChange,
}: {
  spec: Extract<FormulaSpec, { kind: 'concat' }>;
  columns: DatabaseColumn[];
  onChange: (s: FormulaSpec) => void;
}) {
  const set = (i: number, part: ConcatPart) => onChange({ ...spec, parts: spec.parts.map((p, j) => (j === i ? part : p)) });
  return (
    <FormulaField label={t('Partes')} hint={t('Se unen en orden, tal cual. Añade un texto con un espacio o un guion para separarlos.')}>
      <FormulaBox>
        {spec.parts.length === 0 && <p className="text-[11px] text-neutral-600">{t('Todavía no has añadido nada.')}</p>}
        {spec.parts.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              className={FSELECT_LEAD}
              value={p.kind}
              onChange={(e) => set(i, e.target.value === 'text' ? { kind: 'text', value: ' ' } : { kind: 'column', columnId: columns[0]?.id ?? '' })}
            >
              <option value="column">{t('columna')}</option>
              <option value="text">{t('texto fijo')}</option>
            </select>
            {p.kind === 'column' ? (
              <select className="input text-xs flex-1 min-w-0" value={p.columnId} onChange={(e) => set(i, { kind: 'column', columnId: e.target.value })}>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input text-xs flex-1 min-w-0" value={p.value} onChange={(e) => set(i, { kind: 'text', value: e.target.value })} />
            )}
            <button className={FROW_REMOVE} title={t('Quitar')} onClick={() => onChange({ ...spec, parts: spec.parts.filter((_, j) => j !== i) })}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <FormulaAdd onClick={() => onChange({ ...spec, parts: [...spec.parts, { kind: 'column', columnId: columns[0]?.id ?? '' }] })}>
            {t('Añadir columna')}
          </FormulaAdd>
          <FormulaAdd onClick={() => onChange({ ...spec, parts: [...spec.parts, { kind: 'text', value: ' ' }] })}>{t('Añadir texto')}</FormulaAdd>
        </div>
      </FormulaBox>
    </FormulaField>
  );
}

/** Conditional formatting on the result — the colours an "Si… entonces…" gets from its rules. */
function ColorRulesEditor({ rules, numeric, onChange }: { rules: FormulaColorRule[]; numeric: boolean; onChange: (r: FormulaColorRule[]) => void }) {
  const ops: FilterCondition['op'][] = numeric
    ? ['gt', 'gte', 'lt', 'lte', 'equals', 'notEquals', 'isEmpty', 'notEmpty']
    : ['equals', 'notEquals', 'contains', 'notContains', 'isEmpty', 'notEmpty'];
  const set = (id: string, patch: Partial<FormulaColorRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <FormulaField label={t('Colores (opcional)')}>
      <FormulaBox>
        {rules.length === 0 && <p className="text-[11px] text-neutral-600">{t('El resultado se muestra sin color.')}</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5">
            {/* Not FROW_LABEL: this phrase is far longer than "Si"/"mostrar", and every row in
                this box carries the same one, so they line up on their own width. */}
            <span className="shrink-0 text-[11px] text-neutral-500">{t('Si el resultado')}</span>
            <select className="input text-xs w-32 shrink-0" value={r.op} onChange={(e) => set(r.id, { op: e.target.value as FormulaColorRule['op'] })}>
              {ops.map((op) => (
                <option key={op} value={op}>
                  {t(opLabel(op))}
                </option>
              ))}
            </select>
            {opNeedsValue(r.op) && (
              <input
                className="input text-xs flex-1 min-w-0"
                type={numeric ? 'number' : 'text'}
                value={r.value ?? ''}
                onChange={(e) => set(r.id, { value: e.target.value })}
              />
            )}
            <ColorDot color={r.color} onChange={(c) => set(r.id, { color: c ?? OPTION_COLORS[0] })} />
            <button className={FROW_REMOVE} title={t('Quitar')} onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
        <FormulaAdd onClick={() => onChange([...rules, { id: newId('cr'), op: numeric ? 'gt' : 'equals', value: '', color: OPTION_COLORS[0] }])}>
          {t('Añadir color')}
        </FormulaAdd>
      </FormulaBox>
    </FormulaField>
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

/**
 * Object URL for an image attachment's preview (fetched on demand, revoked on unmount). Reads
 * the downscaled thumb rather than the original: the grid and the gallery draw one of these
 * per visible row, and pulling full-size photos across IPC to fill a 28px box is what makes a
 * large catalogue crawl. The main process falls back to the original when there is no thumb.
 */
function useAttachmentImageUrl(att: DatabaseAttachment, full = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachmentKind(att.mimeType) !== 'image' || !att.hasBlob) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objUrl: string | null = null;
    // The preview wants the real photo; a grid of 400px thumbs does not.
    const bytes = full
      ? window.nodus.getDatabaseAttachmentBlob(att.id).then((b) => (b ? { bytes: b, mimeType: att.mimeType } : null))
      : window.nodus.getDatabaseAttachmentThumb(att.id);
    void bytes.then((res) => {
      if (!res || revoked) return;
      objUrl = URL.createObjectURL(new Blob([new Uint8Array(res.bytes)], { type: res.mimeType ?? 'image/png' }));
      setUrl(objUrl);
    });
    return () => {
      revoked = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [att.id, att.mimeType, att.hasBlob, full]);
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

async function downloadStoredAttachment(att: DatabaseAttachment): Promise<void> {
  const result = await window.nodus.downloadDatabaseAttachment(att.id);
  if (!result.canceled && result.path) toast(tx('Descargado en {p}', { p: result.path }));
}

/** One destructive path for both regular and AI-generated attachments. */
async function removeStoredAttachment(att: DatabaseAttachment): Promise<boolean> {
  const ok = await confirm({
    title: t('Eliminar adjunto'),
    message: att.fileName
      ? tx('¿Eliminar «{name}»? Esta acción no se puede deshacer.', { name: att.fileName })
      : t('¿Eliminar este adjunto? Esta acción no se puede deshacer.'),
    danger: true,
  });
  if (!ok) return false;
  await window.nodus.deleteDatabaseAttachment(att.id);
  return true;
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
            onClick={() => void downloadStoredAttachment(att)}
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

/**
 * One attachment in a cell or a record. Clicking it opens the preview, which is also where the
 * actions live: the hover buttons used to be 14px targets pinned OUTSIDE the thumb, so in a
 * 28px grid row the cell's own `overflow-hidden` clipped them and they could not be hit at all.
 * A file you can open is also the thing people try first.
 */
function AttachmentThumb({ att, onRemove, large = false }: { att: DatabaseAttachment; onRemove: () => void; large?: boolean }) {
  const url = useAttachmentImageUrl(att);
  const kind = attachmentKind(att.mimeType);
  const [preview, setPreview] = useState(false);
  const box = large ? 'w-24 h-24' : 'w-7 h-7';
  return (
    <>
      <button
        className="relative shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        title={att.fileName ?? t('Abrir archivo')}
        onClick={(e) => {
          e.stopPropagation();
          setPreview(true);
        }}
      >
        {kind === 'image' && url ? (
          <img src={url} alt={att.fileName ?? ''} className={`${box} rounded object-cover border border-neutral-700 hover:border-indigo-500 transition-colors`} />
        ) : (
          <span
            className={`inline-flex items-center gap-1 ${large ? 'w-24 h-24 flex-col justify-center text-center px-2' : 'max-w-[9rem] px-1.5 py-0.5'} rounded border border-neutral-700 hover:border-indigo-500 bg-neutral-800/60 text-[11px] text-neutral-300 transition-colors`}
          >
            <Icon name={kind === 'pdf' ? 'book' : 'archive'} size={large ? 20 : 11} className="opacity-60 shrink-0" />
            <span className="truncate max-w-full">{att.fileName ?? t('archivo')}</span>
          </span>
        )}
        {att.aiGenerated && kind === 'image' && url && <AiBadge size="sm" corner="bottom-left" />}
      </button>
      {preview && (
        <AttachmentPreview
          att={att}
          onClose={() => setPreview(false)}
          onRemove={() => {
            setPreview(false);
            onRemove();
          }}
        />
      )}
    </>
  );
}

/**
 * Full-size preview of an attachment. Normal-sized actions remain here, while AI image
 * cells also expose their essential actions directly beside the generated thumbnail.
 */
function AttachmentPreview({ att, onClose, onRemove }: { att: DatabaseAttachment; onClose: () => void; onRemove: () => void }) {
  const url = useAttachmentImageUrl(att, true);
  const kind = attachmentKind(att.mimeType);
  const [info, setInfo] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-6" onClick={onClose}>
      <div className="flex items-center gap-3 text-sm text-neutral-300 shrink-0" onClick={(e) => e.stopPropagation()}>
        <span className="truncate font-medium">{att.fileName ?? t('archivo')}</span>
        <span className="text-xs text-neutral-500 shrink-0">{formatBytes(att.bytes)}</span>
        <div className="flex-1" />
        <button className="btn btn-ghost gap-1.5 text-xs" onClick={() => setInfo(true)}>
          <Icon name="info" size={13} /> {t('Información')}
        </button>
        <button className="btn btn-ghost gap-1.5 text-xs" onClick={() => void downloadStoredAttachment(att)}>
          <Icon name="download" size={13} /> {t('Descargar')}
        </button>
        <button className="btn btn-ghost gap-1.5 text-xs text-red-400 hover:text-red-300" onClick={onRemove}>
          <Icon name="trash" size={13} /> {t('Quitar')}
        </button>
        <button className="text-neutral-400 hover:text-neutral-200 ml-1" onClick={onClose} title={t('Cerrar')}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center pt-4" onClick={onClose}>
        {kind === 'image' && url ? (
          <img src={url} alt={att.fileName ?? ''} className="max-w-full max-h-full object-contain rounded" onClick={(e) => e.stopPropagation()} />
        ) : (
          <div className="card flex flex-col items-center gap-3 p-8 text-neutral-400" onClick={(e) => e.stopPropagation()}>
            <Icon name={kind === 'pdf' ? 'book' : 'archive'} size={40} className="opacity-50" />
            <span className="text-sm">{t('Este archivo no se puede previsualizar. Descárgalo para abrirlo.')}</span>
          </div>
        )}
      </div>
      {info && <AttachmentInfoModal att={att} onClose={() => setInfo(false)} />}
    </div>,
    document.body
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
    if (await removeStoredAttachment(att)) onChanged();
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

export type { CsvImportPlanData };

/** Every type a column can be imported as. relation/rollup need a target, so they are
 *  configured after the import from the grid's own type picker. */
const IMPORTABLE_TYPES: DatabaseColumnType[] = [
  'title',
  'text',
  'number',
  'date',
  'time',
  'select',
  'multi_select',
  'checkbox',
  'attachment',
  'ai',
  'ai_image',
];

/** Sentinel for the type <select> when the user discards a column. */
const SKIP = '__skip__';

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
  const [types, setTypes] = useState<(DatabaseColumnType | null)[]>(plan.suggestedTypes);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.nodus.onCsvImportProgress((p) => setProgress({ done: p.done, total: p.total })), []);

  const kept = types.filter((ty) => ty != null).length;
  const titleCount = types.filter((ty) => ty === 'title').length;

  const importNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const db = await window.nodus.createDatabaseFromCsvToken(plan.token, name.trim() || t('Base de datos importada'), types);
      onImported(db.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card-modal w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
          <p className="text-xs text-neutral-500 mb-1">
            {tx('{n} columnas · {r} filas. Nodus ha sugerido un tipo para cada una; cámbialo o descarta las que no necesites.', {
              n: plan.headers.length,
              r: plan.rowCount.toLocaleString(),
            })}
          </p>
          <p className="text-xs text-neutral-600 mb-3">{tx('Se importarán {k} de {n} columnas.', { k: kept, n: plan.headers.length })}</p>
          {titleCount !== 1 && (
            <p className="text-xs text-amber-400 mb-3">
              {titleCount === 0
                ? t('Ninguna columna es el título: la cuadrícula no tendrá con qué identificar cada fila.')
                : t('Hay más de una columna de título. Solo la primera identificará la fila.')}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {plan.headers.map((h, i) => {
              const s = plan.suggestions[i];
              const skipped = types[i] == null;
              const changed = types[i] !== plan.suggestedTypes[i];
              const sample = plan.sampleRows.find((r) => (r[i] ?? '').trim())?.[i].trim() ?? '';
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 ${skipped ? 'opacity-40' : 'bg-neutral-900/40'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`truncate text-sm ${skipped ? 'line-through' : ''}`} title={h}>
                        {h}
                      </span>
                      {s.filled === 0 && <span className="text-[10px] text-neutral-500 shrink-0">{t('vacía')}</span>}
                    </div>
                    <div className="truncate text-[11px] text-neutral-500" title={sample}>
                      {skipped
                        ? t('Se descartará')
                        : changed
                          ? tx('Ej.: {v}', { v: sample })
                          : `${t(s.reason)}${sample ? ` · ${tx('Ej.: {v}', { v: sample })}` : ''}`}
                    </div>
                  </div>
                  {!skipped && s.dropped > 0 && (
                    <span className="text-[10px] text-amber-400 shrink-0" title={t('Valores que este tipo no puede representar')}>
                      {tx('{n} vacíos', { n: s.dropped })}
                    </span>
                  )}
                  <select
                    className="input text-xs w-40 shrink-0"
                    value={types[i] ?? SKIP}
                    onChange={(e) =>
                      setTypes((prev) =>
                        prev.map((t2, j) =>
                          j === i ? (e.target.value === SKIP ? null : (e.target.value as DatabaseColumnType)) : t2
                        )
                      )
                    }
                  >
                    {IMPORTABLE_TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(columnTypeDef(ty).label)}
                        {ty === plan.suggestedTypes[i] ? ` · ${t('sugerido')}` : ''}
                      </option>
                    ))}
                    <option value={SKIP}>{t('No importar')}</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-neutral-800">
          {error && <span className="text-xs text-red-400 flex-1 truncate">{error}</span>}
          {!error && busy && progress && (
            <span className="text-xs text-neutral-500 flex-1">
              {tx('Importando {d} de {n} filas…', { d: progress.done.toLocaleString(), n: progress.total.toLocaleString() })}
            </span>
          )}
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={() => void importNow()} disabled={busy || kept === 0}>
            <Icon name={busy ? 'sync' : 'upload'} size={14} className={busy ? 'animate-spin' : ''} /> {t('Importar')}
          </button>
        </div>
      </div>
    </div>
  );
}
