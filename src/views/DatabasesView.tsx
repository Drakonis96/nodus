import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AiBadge, Icon } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { VirtualList } from '../components/VirtualList';
import { DatabaseTaskWorkspace } from '../components/DatabaseTaskWorkspace';
import { DatabaseAutomationWorkspace } from '../components/DatabaseAutomationWorkspace';
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
  rollupResultKind,
  type DatabaseCalculationProgress,
  type RollupFunction,
} from '@shared/databases';
import { AI_COLUMN_PRESETS } from '@shared/databaseAi';
import { matchFilesToRows, summarizeMatches, codeTemplateToRegex } from '@shared/databaseBulk';
import { comparisonSourceColumns, isComparisonSource } from '@shared/databaseComparison';
import type { CsvImportPlanData } from '@shared/databaseCsv';
import type { NotionImportReport } from '@shared/notionImport';
import {
  isFilterActive,
  operatorsForColumn,
  opNeedsValue,
  opLabel,
  type DatabaseFilterState,
  type DatabaseSavedView,
  type DatabaseViewRevision,
  type FilterCondition,
  type FilterGroup,
  type SortRule,
} from '@shared/databaseFilters';
import { databaseFilterStateToNode, type DatabaseRowPage } from '@shared/databaseQuery';
import {
  parseRectangularClipboard,
  serializeRectangularClipboard,
  type DatabaseAggregateResult,
  type DatabaseCellPatch,
} from '@shared/databaseTableOps';
import {
  defaultDatabaseViewConfig,
  legacyFilterFromViewConfig,
  normalizeDatabaseViewConfig,
  withViewProperties,
  type DatabaseViewConfig,
  type DatabaseViewLayout,
} from '@shared/databaseViewConfig';
import {
  ARITHMETIC_OPS,
  COLUMN_STAT_FNS,
  FORMULA_RECIPES,
  comparableType,
  emptyFormula,
  formulaResultKind,
  formulaRecipeToExpression,
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
import {
  FORMULA_EXPRESSION_FUNCTIONS,
  formulaExpressionResultKind,
  parseFormulaExpression,
} from '@shared/databaseFormulaExpression';
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
import { PageBlockEditor } from '../components/pages/PageBlockEditor';
import { DatabaseCalendarView, DatabaseTimelineView } from '../components/DatabaseTemporalViews';
import { DatabaseChartView, DatabaseDashboardView, DatabaseFeedView, DatabaseMapView } from '../components/DatabaseVisualizationViews';
import {
  databasePropertyPlainText,
  decodeDatabaseButton,
  decodeDatabaseDate,
  decodeDatabaseLocation,
  decodeDatabasePeople,
  encodeDatabaseDate,
  encodeDatabaseLocation,
  encodeDatabasePeople,
  isReadOnlyDatabaseProperty,
  type DatabaseDateValue,
  type DatabaseLocationValue,
  type DatabasePersonReference,
} from '@shared/databaseProperties';

/** A one-line preview string for a cell, used by "fit to content" width estimation. */
function cellPreview(col: DatabaseColumn, row: DatabaseRow): string {
  const raw = row.cells[col.id] ?? null;
  if (col.type === 'select' || col.type === 'status') return col.options.find((o) => o.id === raw)?.label ?? '';
  if (col.type === 'multi_select')
    return decodeMultiSelect(raw)
      .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
      .join(' ');
  if (col.type === 'attachment' || col.type === 'files' || col.type === 'ai_image') return (row.attachments?.[col.id] ?? []).map((a) => a.fileName ?? '').join(' ');
  if (col.type === 'rollup') return row.rollups?.[col.id] ?? '';
  return databasePropertyPlainText(col.type, raw);
}

function clipboardInputForColumn(column: DatabaseColumn, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (column.type === 'select' || column.type === 'status') {
    return column.options.find((option) => (option.label ?? '').localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0)?.id ?? trimmed;
  }
  if (column.type === 'multi_select') {
    const ids = trimmed.split(/[,;]\s*/).filter(Boolean).map((label) =>
      column.options.find((option) => (option.label ?? '').localeCompare(label, undefined, { sensitivity: 'accent' }) === 0)?.id ?? label,
    );
    return encodeMultiSelect(ids);
  }
  if (column.type === 'checkbox') return /^(1|true|sí|si|yes|x|✓)$/i.test(trimmed) ? '1' : '0';
  return value;
}

type GridCoordinate = { row: number; column: number };

function databaseViewQueryGroups(config: DatabaseViewConfig) {
  if (config.layout !== 'board') return config.groups;
  return [config.groupBy, config.subgroupBy, ...config.groups].filter((group): group is NonNullable<typeof group> => Boolean(group));
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
  const [rowPages, setRowPages] = useState<DatabaseRowPage[]>([]);
  const [stats, setStats] = useState<{ rowCount: number; vaultTotal: number; percent: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrollAnchor, setScrollAnchor] = useState<{ token: number; items: number } | null>(null);
  const [calculation, setCalculation] = useState<DatabaseCalculationProgress | null>(null);
  const [viewMode, setViewMode] = useState<DatabaseViewLayout>('table');
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filter, setFilter] = useState<DatabaseFilterState>({ conjunction: 'and', conditions: [] });
  const [sorts, setSorts] = useState<SortRule[]>([]);
  const [views, setViews] = useState<DatabaseSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewConfig, setViewConfig] = useState<DatabaseViewConfig>(() => defaultDatabaseViewConfig('table'));
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [taskWorkspaceOpen, setTaskWorkspaceOpen] = useState(false);
  const [automationWorkspaceOpen, setAutomationWorkspaceOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [gridAnchor, setGridAnchor] = useState<GridCoordinate | null>(null);
  const [gridFocus, setGridFocus] = useState<GridCoordinate | null>(null);
  const [bulkColumnId, setBulkColumnId] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [aggregates, setAggregates] = useState<DatabaseAggregateResult | null>(null);
  const querySerial = useRef(0);
  const viewRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = viewRootRef.current;
    if (!root) return;
    if (openRowId || viewSettingsOpen || taskWorkspaceOpen || automationWorkspaceOpen) root.setAttribute('inert', '');
    else root.removeAttribute('inert');
    return () => root.removeAttribute('inert');
  }, [automationWorkspaceOpen, openRowId, taskWorkspaceOpen, viewSettingsOpen]);
  useEffect(() => {
    // The automation workspace is rendered into document.body. Inerting only the
    // database view leaves the global header focusable underneath its backdrop and
    // makes accessibility tools evaluate text after the backdrop has reduced its
    // effective contrast. Keep the complete application tree out of the accessibility
    // and focus trees while the portalled dialog is open; the portal itself remains a
    // sibling of #root and therefore fully interactive.
    if (!automationWorkspaceOpen) return;
    const appRoot = document.getElementById('root');
    if (!appRoot) return;
    const hadInert = appRoot.hasAttribute('inert');
    const previousAriaHidden = appRoot.getAttribute('aria-hidden');
    appRoot.setAttribute('inert', '');
    appRoot.setAttribute('aria-hidden', 'true');
    return () => {
      if (!hadInert) appRoot.removeAttribute('inert');
      if (previousAriaHidden == null) appRoot.removeAttribute('aria-hidden');
      else appRoot.setAttribute('aria-hidden', previousAriaHidden);
    };
  }, [automationWorkspaceOpen]);
  const filterNode = useMemo(() => databaseFilterStateToNode(filter), [filter]);
  const rows = useMemo(() => rowPages.flatMap((page) => page.rows), [rowPages]);
  const filteredRowCount = rowPages[0]?.totalCount ?? 0;

  const load = useCallback(async (id: string) => {
    const serial = ++querySerial.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [d, page, s] = await Promise.all([
        window.nodus.getDatabaseDetail(id),
        window.nodus.queryDatabaseRows({ databaseId: id, filter: filterNode, sorts, groups: databaseViewQueryGroups(viewConfig), limit: 200 }),
        window.nodus.databaseStats(id),
      ]);
      if (serial !== querySerial.current) return;
      setDetail(d);
      setRowPages([page]);
      setStats(s);
    } catch (error) {
      if (serial === querySerial.current) setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (serial === querySerial.current) setLoading(false);
    }
  }, [filterNode, sorts, viewConfig]);

  useEffect(() => {
    if (!databaseId) {
      setDetail(null);
      setRowPages([]);
      setStats(null);
      return;
    }
    void load(databaseId);
  }, [databaseId, load]);

  useEffect(() => {
    if (!databaseId) {
      setCalculation(null);
      return;
    }
    void window.nodus.getDatabaseCalculationStatus(databaseId).then(setCalculation);
    return window.nodus.onDatabaseCalculationProgress((progress) => {
      if (progress.databaseId !== databaseId) return;
      setCalculation(progress);
      if (progress.status === 'completed') void load(databaseId);
    });
  }, [databaseId, load]);

  // Deep-link from the search view: open a specific row's record on arrival.
  useEffect(() => {
    if (initialRowId) {
      setOpenRowId(initialRowId);
      onConsumeInitialRow?.();
    }
  }, [initialRowId, onConsumeInitialRow]);

  const columns = detail?.columns ?? [];
  const configuredView = useMemo(
    () => withViewProperties({ ...viewConfig, filter: filterNode, sorts }, columns.map((column) => column.id)),
    [columns, filterNode, sorts, viewConfig],
  );
  const visibleColumns = useMemo(() => {
    const byId = new Map(columns.map((column) => [column.id, column]));
    return configuredView.properties
      .filter((property) => property.visible)
      .sort((left, right) => left.order - right.order)
      .flatMap((property) => {
        const column = byId.get(property.columnId);
        return column ? [column] : [];
      });
  }, [columns, configuredView.properties]);
  const hasAttachmentColumn = columns.some((c) => c.type === 'attachment' || c.type === 'files');
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
    setViewConfig(defaultDatabaseViewConfig('table'));
    setViewMode('table');
    setSelectedRowIds(new Set());
    setGridAnchor(null);
    setGridFocus(null);
    void reloadViews();
  }, [databaseId, reloadViews]);

  const applyView = useCallback((v: DatabaseSavedView | null) => {
    setActiveViewId(v?.id ?? null);
    setFilter(v?.filter ?? { conjunction: 'and', conditions: [] });
    setSorts(v?.sorts ?? []);
    setViewConfig(v?.config ?? defaultDatabaseViewConfig('table'));
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
    const config = normalizeDatabaseViewConfig({ ...configuredView, layout: viewMode, filter: filterNode, sorts });
    const v = await window.nodus.createDatabaseView(databaseId, { name: name.trim(), layout: viewMode, filter, sorts, config });
    await reloadViews();
    setActiveViewId(v.id);
    setViewConfig(v.config);
  }, [configuredView, databaseId, viewMode, filter, filterNode, sorts, reloadViews]);
  const updateActiveView = useCallback(async () => {
    if (!activeViewId) return;
    const active = views.find((view) => view.id === activeViewId);
    const config = normalizeDatabaseViewConfig({ ...configuredView, layout: viewMode, filter: filterNode, sorts });
    await window.nodus.updateDatabaseView(activeViewId, {
      layout: viewMode,
      filter,
      sorts,
      config,
      expectedRevision: active?.revision,
    });
    await reloadViews();
    setViewConfig(config);
    toast(t('Vista actualizada.'));
  }, [activeViewId, configuredView, filter, filterNode, reloadViews, sorts, viewMode, views]);
  const removeView = useCallback(
    async (id: string) => {
      await window.nodus.deleteDatabaseView(id);
      if (activeViewId === id) applyView(null);
      await reloadViews();
    },
    [activeViewId, applyView, reloadViews]
  );

  // Filtering and ordering happen in SQLite. Only a bounded page window reaches React.
  const visibleRows = rows;

  const gridRange = useMemo(() => {
    if (!gridAnchor || !gridFocus) return null;
    return {
      rowStart: Math.min(gridAnchor.row, gridFocus.row),
      rowEnd: Math.max(gridAnchor.row, gridFocus.row),
      columnStart: Math.min(gridAnchor.column, gridFocus.column),
      columnEnd: Math.max(gridAnchor.column, gridFocus.column),
    };
  }, [gridAnchor, gridFocus]);

  useEffect(() => {
    if (!databaseId || viewMode !== 'table' || (configuredView.layout === 'table' && !configuredView.showCalculations)) {
      setAggregates(null);
      return;
    }
    let canceled = false;
    void window.nodus.aggregateDatabaseRows({
      databaseId,
      filter: filterNode,
      columnIds: visibleColumns.map((column) => column.id),
    }).then((result) => { if (!canceled) setAggregates(result); }).catch(() => { if (!canceled) setAggregates(null); });
    return () => { canceled = true; };
  }, [configuredView, databaseId, filterNode, visibleColumns, viewMode]);

  const applyBulkChanges = useCallback(async (changes: DatabaseCellPatch[]) => {
    if (!databaseId || changes.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await window.nodus.setDatabaseCellsBulk({
        databaseId,
        changes,
        expectedRevision: rowPages[0]?.revision,
      });
      const updated = new Map(result.rows.map((row) => [row.id, row]));
      setRowPages((pages) => pages.map((page) => ({
        ...page,
        revision: result.revision,
        rows: page.rows.map((row) => updated.get(row.id) ?? row),
      })));
      await load(databaseId);
      toast(tx('{n} celdas actualizadas.', { n: result.cellsChanged }));
    } catch (error) {
      toast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : String(error));
      await load(databaseId);
    } finally {
      setBulkBusy(false);
    }
  }, [databaseId, load, rowPages]);

  const applySelectedRows = useCallback(() => {
    const column = columns.find((candidate) => candidate.id === bulkColumnId);
    if (!column || selectedRowIds.size === 0 || isReadOnlyDatabaseProperty(column.type)) return;
    const raw = clipboardInputForColumn(column, bulkValue);
    void applyBulkChanges([...selectedRowIds].map((rowId) => ({ rowId, columnId: column.id, raw })));
  }, [applyBulkChanges, bulkColumnId, bulkValue, columns, selectedRowIds]);

  const selectGridCell = useCallback((row: number, column: number, extend: boolean) => {
    const coordinate = { row, column };
    if (!extend || !gridAnchor) setGridAnchor(coordinate);
    setGridFocus(coordinate);
  }, [gridAnchor]);

  const handleGridCopy = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches('input,textarea,select,[contenteditable="true"]') || !gridRange) return;
    const matrix: string[][] = [];
    for (let rowIndex = gridRange.rowStart; rowIndex <= gridRange.rowEnd; rowIndex += 1) {
      const row = visibleRows[rowIndex];
      if (!row) continue;
      matrix.push(visibleColumns.slice(gridRange.columnStart, gridRange.columnEnd + 1).map((column) => cellPreview(column, row)));
    }
    event.clipboardData.setData('text/plain', serializeRectangularClipboard(matrix));
    event.preventDefault();
  }, [gridRange, visibleColumns, visibleRows]);

  const handleGridPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches('input,textarea,select,[contenteditable="true"]') || !gridFocus) return;
    const matrix = parseRectangularClipboard(event.clipboardData.getData('text/plain'));
    const changes: DatabaseCellPatch[] = [];
    matrix.forEach((clipboardRow, rowOffset) => clipboardRow.forEach((value, columnOffset) => {
      const row = visibleRows[gridFocus.row + rowOffset];
      const column = visibleColumns[gridFocus.column + columnOffset];
      if (!row || !column || isReadOnlyDatabaseProperty(column.type)) return;
      changes.push({ rowId: row.id, columnId: column.id, raw: clipboardInputForColumn(column, value) });
    }));
    if (changes.length > 0) {
      event.preventDefault();
      window.dispatchEvent(new Event('nodus:database-grid-paste'));
      void applyBulkChanges(changes);
    }
  }, [applyBulkChanges, gridFocus, visibleColumns, visibleRows]);

  const loadAdjacentPage = useCallback(async (direction: 'forward' | 'backward') => {
    if (!databaseId || loading || loadingPage || rowPages.length === 0) return;
    const boundary = direction === 'forward' ? rowPages[rowPages.length - 1] : rowPages[0];
    const cursor = direction === 'forward' ? boundary.nextCursor : boundary.previousCursor;
    if (!cursor) return;
    setLoadingPage(true);
    setLoadError(null);
    try {
      const page = await window.nodus.queryDatabaseRows({
        databaseId,
        filter: filterNode,
        sorts,
        groups: databaseViewQueryGroups(configuredView),
        cursor,
        direction,
        limit: 200,
      });
      if (direction === 'forward' && rowPages.length >= 5) {
        setScrollAnchor((anchor) => ({ token: (anchor?.token ?? 0) + 1, items: -rowPages[0].rows.length }));
      } else if (direction === 'backward') {
        setScrollAnchor((anchor) => ({ token: (anchor?.token ?? 0) + 1, items: page.rows.length }));
      }
      setRowPages((current) => {
        const next = direction === 'forward' ? [...current, page] : [page, ...current];
        if (direction === 'forward' && next.length > 5) return next.slice(-5);
        if (direction === 'backward') {
          return next.slice(0, 5);
        }
        return next;
      });
    } catch (error) {
      // A concurrent edit invalidates the revision-bound cursor by design. Restarting the
      // query is safer than silently duplicating or omitting a row.
      if (/cambió|cursor/i.test(String(error))) await load(databaseId);
      else setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingPage(false);
    }
  }, [configuredView, databaseId, filterNode, load, loading, loadingPage, rowPages, sorts]);

  const onVisibleRange = useCallback(({ start, end, total }: { start: number; end: number; total: number }) => {
    if (end >= total - 30) void loadAdjacentPage('forward');
    else if (start <= 20) void loadAdjacentPage('backward');
  }, [loadAdjacentPage]);

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
    const [d, page] = await Promise.all([
      window.nodus.getDatabaseDetail(databaseId),
      window.nodus.queryDatabaseRows({ databaseId, filter: filterNode, sorts, groups: databaseViewQueryGroups(configuredView), limit: 200 }),
    ]);
    setDetail(d);
    setRowPages([page]);
  }, [configuredView, databaseId, filterNode, sorts]);

  const addRow = useCallback(async () => {
    if (!databaseId) return;
    await window.nodus.createDatabaseRow(databaseId);
    await load(databaseId);
    void refreshStats();
    void onDatabasesChanged();
    notifyDataChanged();
  }, [databaseId, load, refreshStats, onDatabasesChanged]);

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (!(await confirm({ title: t('Eliminar fila'), message: t('¿Eliminar esta fila?'), danger: true }))) return;
      await window.nodus.deleteDatabaseRow(rowId);
      if (databaseId) await load(databaseId);
      void refreshStats();
      void onDatabasesChanged();
      notifyDataChanged();
    },
    [databaseId, load, refreshStats, onDatabasesChanged]
  );

  const refreshRow = useCallback(async (rowId: string) => {
    const updated = await window.nodus.getDatabaseRow(rowId);
    if (updated) {
      setRowPages((pages) => pages.map((page) => ({
        ...page,
        rows: page.rows.map((row) => (row.id === rowId ? updated : row)),
      })));
    }
  }, []);

  // Columns configured to auto-recompute when their row changes.
  const autoAiColumns = useMemo(() => columns.filter((c) => c.type === 'ai' && c.config.aiAuto), [columns]);

  const setCell = useCallback(
    async (rowId: string, columnId: string, raw: string | null) => {
      // Optimistic local update, then persist.
      setRowPages((pages) => pages.map((page) => ({
        ...page,
        rows: page.rows.map((row) => (row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: raw } } : row)),
      })));
      const updated = await window.nodus.setDatabaseCell(rowId, columnId, raw);
      if (updated) {
        setRowPages((pages) => pages.map((page) => ({
          ...page,
          rows: page.rows.map((row) => (row.id === rowId ? updated : row)),
        })));
      }
      // Fire any auto AI columns (opt-in per column), then refresh the row.
      const auto = autoAiColumns.filter((c) => c.id !== columnId);
      if (auto.length > 0) {
        await Promise.all(auto.map((c) => window.nodus.runDatabaseAiCell(rowId, c.id).catch(() => undefined)));
        await refreshRow(rowId);
      }
      if (databaseId) await load(databaseId);
    },
    [autoAiColumns, databaseId, load, refreshRow]
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

  const recalculate = useCallback(async () => {
    if (!databaseId || calculation?.status === 'queued' || calculation?.status === 'running') return;
    const { jobId } = await window.nodus.recalculateDatabase(databaseId);
    setCalculation({ jobId, databaseId, status: 'queued', done: 0, total: 0, message: null });
  }, [calculation?.status, databaseId]);

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
  const viewPropertiesById = useMemo(
    () => new Map(configuredView.properties.map((property) => [property.columnId, property])),
    [configuredView.properties],
  );
  const patchViewProperty = useCallback((columnId: string, patch: Partial<(typeof configuredView.properties)[number]>) => {
    setViewConfig((current) => {
      const normalized = withViewProperties(current, columns.map((column) => column.id));
      return {
        ...normalized,
        properties: normalized.properties.map((property) => property.columnId === columnId ? { ...property, ...patch } : property),
      };
    });
  }, [columns]);
  const widthOf = useCallback(
    (col: DatabaseColumn) =>
      widthOverrides[col.id]
      ?? viewPropertiesById.get(col.id)?.width
      ?? (typeof col.config.width === 'number' ? col.config.width : defaultColumnWidth(col.type)),
    [viewPropertiesById, widthOverrides]
  );
  const persistWidth = useCallback(
    async (col: DatabaseColumn, w: number) => {
      if (activeViewId) {
        patchViewProperty(col.id, { width: w });
        return;
      }
      await window.nodus.updateDatabaseColumn(col.id, { config: { ...col.config, width: w } });
      await reloadColumns();
    },
    [activeViewId, patchViewProperty, reloadColumns]
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
      if (activeViewId) {
        patchViewProperty(col.id, { width: w });
        return;
      }
      void window.nodus
        .updateDatabaseColumn(col.id, { config: { ...col.config, width: w, fitContent: true } })
        .then(reloadColumns);
    },
    [activeViewId, patchViewProperty, rows, reloadColumns]
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
      if (activeViewId) {
        patchViewProperty(col.id, { width: null });
        return;
      }
      const { width: _width, fitContent: _fitContent, ...rest } = col.config;
      await window.nodus.updateDatabaseColumn(col.id, { config: rest });
      await reloadColumns();
    },
    [activeViewId, patchViewProperty, reloadColumns]
  );

  const baseRowHeight = configuredView.rowHeight === 'compact' ? 30 : configuredView.rowHeight === 'tall' ? 56 : ROW_HEIGHT;
  const fittedColumns = useMemo(
    () => visibleColumns.filter((col) => configuredView.wrap || Boolean(col.config.fitContent)),
    [configuredView.wrap, visibleColumns],
  );
  const rowHeightOf = useCallback(
    (row: DatabaseRow) =>
      fittedColumns.reduce(
        (height, col) =>
          Math.max(height, wrappedCellHeight(cellPreview(col, row), widthOf(col), col.type === 'ai' ? 30 : 0)),
        baseRowHeight
      ),
    [baseRowHeight, fittedColumns, widthOf]
  );
  const reorderColumn = useCallback(
    async (fromId: string, toId: string) => {
      if (fromId === toId || !databaseId) return;
      const ids = visibleColumns.map((c) => c.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      if (activeViewId) {
        setViewConfig((current) => {
          const normalized = withViewProperties(current, columns.map((column) => column.id));
          const moving = normalized.properties.find((property) => property.columnId === fromId);
          const target = normalized.properties.find((property) => property.columnId === toId);
          if (!moving || !target) return current;
          const ordered = [...normalized.properties].sort((left, right) => left.order - right.order);
          const fromIndex = ordered.findIndex((property) => property.columnId === fromId);
          const targetIndex = ordered.findIndex((property) => property.columnId === toId);
          ordered.splice(targetIndex, 0, ordered.splice(fromIndex, 1)[0]);
          return { ...normalized, properties: ordered.map((property, order) => ({ ...property, order })) };
        });
      } else {
        await window.nodus.reorderDatabaseColumns(databaseId, columns.map((column) => column.id).sort((left, right) => ids.indexOf(left) - ids.indexOf(right)));
        await reloadColumns();
      }
    },
    [activeViewId, columns, databaseId, reloadColumns, visibleColumns]
  );

  const totalWidth = GUTTER_WIDTH + visibleColumns.reduce((sum, c) => sum + widthOf(c), 0) + ADD_COLUMN_WIDTH;
  const frozenLeftById = new Map<string, number>();
  let frozenLeft = GUTTER_WIDTH;
  for (const column of visibleColumns) {
    if (!viewPropertiesById.get(column.id)?.frozen) continue;
    frozenLeftById.set(column.id, frozenLeft);
    frozenLeft += widthOf(column);
  }

  if (databaseId && !detail && loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="database-initial-loading" role="status">
        <Icon name="sync" size={28} className="animate-spin text-indigo-500" />
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('Cargando…')}</p>
      </div>
    );
  }

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
    <div
      ref={viewRootRef}
      className={`h-full flex flex-col${openRowId ? ' modal-background-inert' : ''}`}
      data-testid="database-view"
      aria-hidden={openRowId || viewSettingsOpen || taskWorkspaceOpen || automationWorkspaceOpen ? true : undefined}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={detail.database.icon || 'table'} className="text-indigo-400 shrink-0" size={20} />
          <DatabaseTitle name={detail.database.name} onRename={renameDatabase} />
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 shrink-0">
            {detail.database.shortId}
          </span>
          {stats && (
            <span className="text-xs text-neutral-600 dark:text-neutral-300 shrink-0 whitespace-nowrap">
              {stats.rowCount.toLocaleString()} {t('entradas')} <span className="text-neutral-600 dark:text-neutral-400">({stats.percent}%)</span>
              {filterActive && <span className="ml-1">· {tx('{n} filtradas', { n: filteredRowCount })}</span>}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-[1rem]" />
        <div className="flex items-center gap-1.5 shrink-0">
          <FilterButton columns={columns} filter={filter} onChange={setFilter} />
          <SortButton columns={columns} sorts={sorts} onChange={setSorts} />
          <button
            className="btn btn-ghost gap-1.5"
            data-testid="database-view-settings-button"
            onClick={() => setViewSettingsOpen(true)}
            title={t('Configurar vista')}
          >
            <Icon name="settings" size={14} />
          </button>
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
            <button
              className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('list')}
              title={t('Lista')}
            >
              <Icon name="list" size={14} />
            </button>
            <button
              className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'board' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('board')}
              title={t('Tablero')}
            >
              <Icon name="table" size={14} />
            </button>
            <button
              className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('calendar')}
              title={t('Calendario')}
              data-testid="database-calendar-mode"
            >
              <Icon name="calendar" size={14} />
            </button>
            <button
              className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'timeline' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
              onClick={() => setViewMode('timeline')}
              title={t('Timeline')}
              data-testid="database-timeline-mode"
            >
              <Icon name="clock" size={14} />
            </button>
            <button className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'chart' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`} onClick={() => setViewMode('chart')} title={t('Gráfico')} data-testid="database-chart-mode"><Icon name="chartBar" size={14} /></button>
            <button className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'map' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`} onClick={() => setViewMode('map')} title={t('Mapa')} data-testid="database-map-mode"><Icon name="mapPin" size={14} /></button>
            <button className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'feed' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`} onClick={() => setViewMode('feed')} title={t('Feed')} data-testid="database-feed-mode"><Icon name="list" size={14} /></button>
            <button className={`border-l border-neutral-700 px-2 py-1 flex items-center ${viewMode === 'dashboard' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`} onClick={() => setViewMode('dashboard')} title={t('Dashboard')} data-testid="database-dashboard-mode"><Icon name="grid" size={14} /></button>
          </div>
          {hasAttachmentColumn && (
            <button className="btn btn-ghost gap-1.5" title={t('Subida masiva de archivos')} onClick={() => setBulkOpen(true)}>
              <Icon name="upload" />
            </button>
          )}
          {columns.some((column) => column.type === 'formula' || column.type === 'rollup') && (
            <button
              className="btn btn-ghost"
              title={t('Recalcular fórmulas y rollups')}
              disabled={calculation?.status === 'queued' || calculation?.status === 'running'}
              onClick={() => void recalculate()}
            >
              <Icon name="refresh" className={calculation?.status === 'running' ? 'animate-spin' : ''} />
            </button>
          )}
          <button className="btn btn-primary gap-1.5" onClick={() => void addRow()}>
            <Icon name="plus" /> {t('Nueva fila')}
          </button>
          <button className="btn btn-ghost gap-1.5" data-testid="database-task-workspace-button" title={t('Proyectos, plantillas y sprints')} onClick={() => setTaskWorkspaceOpen(true)}>
            <Icon name="check" />
          </button>
          <button className="btn btn-ghost gap-1.5" data-testid="database-automation-workspace-button" title={t('Automatizaciones y formularios')} onClick={() => setAutomationWorkspaceOpen(true)}>
            <Icon name="wand" />
          </button>
          <ExportButton databaseId={databaseId} />
          <button className="btn btn-ghost text-red-400" title={t('Eliminar base de datos')} onClick={() => void deleteDatabase()}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {loadError && (
        <div data-testid="database-query-error" role="alert" className="mx-4 mt-2 flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <Icon name="warning" size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={loadError}>{t('No se pudieron cargar las filas.')}</span>
          <button className="btn btn-ghost h-7 shrink-0 px-2" onClick={() => void load(databaseId)}>{t('Reintentar')}</button>
        </div>
      )}

      {calculation && (calculation.status === 'queued' || calculation.status === 'running') && (
        <div className="mx-4 mt-2 flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100" role="status">
          <Icon name="sync" size={14} className="animate-spin shrink-0" />
          <span className="min-w-0 flex-1">{t('Actualizando fórmulas y rollups…')}</span>
          {calculation.total > 0 && <span>{Math.min(100, Math.round((calculation.done / calculation.total) * 100))}%</span>}
          <button className="btn btn-ghost h-7 px-2" onClick={() => void window.nodus.cancelDatabaseCalculation(calculation.jobId)}>{t('Cancelar')}</button>
        </div>
      )}

      {/* Saved-view tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-neutral-800 overflow-x-auto">
        <button
          className={`text-xs px-2 py-1 rounded shrink-0 ${activeViewId === null ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-700 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100'}`}
          onClick={() => applyView(null)}
        >
          {t('Todas')}
        </button>
        {views.map((v) => (
          <div key={v.id} className="flex items-center group/vtab shrink-0">
            <button
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${activeViewId === v.id ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-700 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100'}`}
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
        <button className="text-xs px-1.5 py-1 rounded text-neutral-700 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100 shrink-0" title={t('Guardar vista actual')} onClick={() => void saveAsView()}>
          <Icon name="plus" size={12} />
        </button>
        {activeViewId && (
          <button className="shrink-0 rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-neutral-800" onClick={() => void updateActiveView()}>
            {t('Actualizar vista')}
          </button>
        )}
      </div>

      {selectedRowIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100" data-testid="database-bulk-toolbar">
          <strong>{tx('{n} filas seleccionadas', { n: selectedRowIds.size })}</strong>
          <select className="input h-8 min-w-40" aria-label={t('Propiedad para edición masiva')} value={bulkColumnId} onChange={(event) => setBulkColumnId(event.target.value)}>
            <option value="">{t('Elegir propiedad…')}</option>
            {columns.filter((column) => !isReadOnlyDatabaseProperty(column.type)).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
          </select>
          <input className="input h-8 min-w-44 flex-1" aria-label={t('Valor para edición masiva')} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder={t('Nuevo valor; vacío borra')} />
          <button className="btn btn-primary h-8" disabled={bulkBusy || !bulkColumnId} onClick={applySelectedRows}>{bulkBusy ? t('Aplicando…') : t('Aplicar a todas')}</button>
          <button className="btn btn-ghost h-8" onClick={() => setSelectedRowIds(new Set())}>{t('Cancelar selección')}</button>
        </div>
      )}

      {/* Table */}
      {viewMode === 'table' && (
        <div className="flex-1 min-h-0 overflow-x-auto" data-tour="db-table" data-testid="database-table" onCopy={handleGridCopy} onPaste={handleGridPaste}>
          <div style={{ minWidth: totalWidth }} className="h-full flex flex-col">
            {/* Header row */}
            <div className="flex border-b border-neutral-800 bg-neutral-900/40 sticky top-0 z-10">
              <div style={{ width: GUTTER_WIDTH, left: 0 }} className="shrink-0 sticky z-20 grid place-items-center bg-neutral-50 dark:bg-neutral-950">
                <input
                  type="checkbox"
                  className="h-6 w-6 cursor-pointer"
                  aria-label={t('Seleccionar filas cargadas')}
                  checked={visibleRows.length > 0 && visibleRows.every((row) => selectedRowIds.has(row.id))}
                  ref={(element) => { if (element) element.indeterminate = selectedRowIds.size > 0 && !visibleRows.every((row) => selectedRowIds.has(row.id)); }}
                  onChange={(event) => setSelectedRowIds(event.target.checked ? new Set(visibleRows.map((row) => row.id)) : new Set())}
                />
              </div>
              {visibleColumns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  column={col}
                  columns={columns}
                  rows={rows}
                  width={widthOf(col)}
                  stickyLeft={frozenLeftById.get(col.id)}
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
              itemHeight={fittedColumns.length > 0 ? rowHeightOf : baseRowHeight}
              getKey={(r) => r.id}
              onRangeChange={onVisibleRange}
              anchorAdjustment={scrollAnchor}
              empty={
                <div className="p-8 text-center text-sm text-neutral-500">
                  {columns.length === 0
                    ? t('Añade una columna para empezar.')
                    : filterActive && (stats?.rowCount ?? 0) > 0
                      ? t('Ninguna fila coincide con los filtros.')
                      : t('Sin filas todavía. Añade la primera.')}
                </div>
              }
              renderItem={(row, rowIndex) => (
                <div className={`flex border-b border-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-900/40 group ${selectedRowIds.has(row.id) ? 'bg-indigo-50 dark:bg-indigo-950/25' : ''}`} style={{ minHeight: baseRowHeight, height: '100%' }}>
                  <div style={{ width: GUTTER_WIDTH, left: 0 }} className="shrink-0 sticky z-20 flex items-center justify-center gap-1 bg-white group-hover:bg-neutral-50 dark:bg-neutral-950 dark:group-hover:bg-neutral-900">
                    <input
                      type="checkbox"
                      className="h-6 w-6 shrink-0 cursor-pointer"
                      aria-label={tx('Seleccionar {name}', { name: rowTitle(row, columns) })}
                      checked={selectedRowIds.has(row.id)}
                      onChange={(event) => setSelectedRowIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.id); else next.delete(row.id);
                        return next;
                      })}
                    />
                    <button
                      className="grid h-6 w-6 shrink-0 place-items-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-500 hover:bg-neutral-800 hover:text-indigo-400 transition-opacity"
                      title={t('Abrir ficha')}
                      onClick={() => setOpenRowId(row.id)}
                    >
                      <Icon name="external" size={13} />
                    </button>
                    <button
                      className="grid h-6 w-6 shrink-0 place-items-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-500 hover:bg-neutral-800 hover:text-red-400 transition-opacity"
                      title={t('Eliminar fila')}
                      onClick={() => void deleteRow(row.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                  {visibleColumns.map((col, columnIndex) => (
                    <Cell
                      key={col.id}
                      column={col}
                      columns={columns}
                      width={widthOf(col)}
                      stickyLeft={frozenLeftById.get(col.id)}
                      value={row.cells[col.id] ?? null}
                      rollup={row.rollups?.[col.id] ?? ''}
                      formulaColor={row.formulaColors?.[col.id]}
                      formulaError={row.formulaErrors?.[col.id]}
                      rowId={row.id}
                      attachments={row.attachments?.[col.id] ?? []}
                      wrap={configuredView.wrap || Boolean(col.config.fitContent)}
                      onChange={(raw) => void setCell(row.id, col.id, raw)}
                      onOptionsChanged={reloadColumns}
                      onAttachmentsChanged={() => void refreshRow(row.id)}
                      selected={Boolean(gridRange && rowIndex >= gridRange.rowStart && rowIndex <= gridRange.rowEnd && columnIndex >= gridRange.columnStart && columnIndex <= gridRange.columnEnd)}
                      onSelect={(extend) => selectGridCell(rowIndex, columnIndex, extend)}
                    />
                  ))}
                  <div style={{ width: ADD_COLUMN_WIDTH }} className="shrink-0" />
                </div>
              )}
            />
            {aggregates && (
              <div className="flex min-h-8 shrink-0 border-t border-neutral-300 bg-neutral-50 text-[11px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300" data-testid="database-table-aggregates">
                <div style={{ width: GUTTER_WIDTH, left: 0 }} className="sticky z-20 shrink-0 bg-neutral-50 px-2 py-2 font-medium dark:bg-neutral-950">Σ</div>
                {visibleColumns.map((column) => <AggregateCell key={column.id} width={widthOf(column)} column={column} aggregate={aggregates.columns.find((item) => item.columnId === column.id)} />)}
                <div style={{ width: ADD_COLUMN_WIDTH }} className="shrink-0" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery */}
      {viewMode === 'gallery' && (
        <GalleryView
          rows={visibleRows}
          columns={columns}
          config={configuredView.layout === 'gallery' ? configuredView : null}
          onOpen={(id) => setOpenRowId(id)}
          onRangeChange={onVisibleRange}
          anchorAdjustment={scrollAnchor}
        />
      )}

      {viewMode === 'list' && (
        <DatabaseListView
          rows={visibleRows}
          columns={columns}
          config={configuredView.layout === 'list' ? configuredView : null}
          onOpen={(id) => setOpenRowId(id)}
          onRangeChange={onVisibleRange}
          anchorAdjustment={scrollAnchor}
        />
      )}

      {viewMode === 'board' && (
        <DatabaseBoardView
          rows={visibleRows}
          totalCount={filteredRowCount}
          columns={columns}
          config={configuredView.layout === 'board' ? configuredView : null}
          onOpen={(id) => setOpenRowId(id)}
          onMove={(rowId, columnId, raw) => applyBulkChanges([{ rowId, columnId, raw }])}
          onLoadMore={() => void loadAdjacentPage('forward')}
          loadingMore={loadingPage}
        />
      )}

      {viewMode === 'calendar' && (
        <DatabaseCalendarView
          databaseId={databaseId}
          columns={columns}
          config={configuredView.layout === 'calendar' ? configuredView : null}
          onOpen={(id) => setOpenRowId(id)}
          onChanged={() => void load(databaseId)}
        />
      )}

      {viewMode === 'timeline' && (
        <DatabaseTimelineView
          databaseId={databaseId}
          columns={columns}
          config={configuredView.layout === 'timeline' ? configuredView : null}
          onOpen={(id) => setOpenRowId(id)}
          onChanged={() => void load(databaseId)}
        />
      )}

      {viewMode === 'chart' && <DatabaseChartView databaseId={databaseId} columns={columns} config={configuredView.layout === 'chart' ? configuredView : null} onOpen={(id) => setOpenRowId(id)} />}
      {viewMode === 'map' && <DatabaseMapView databaseId={databaseId} columns={columns} config={configuredView.layout === 'map' ? configuredView : null} onOpen={(id) => setOpenRowId(id)} />}
      {viewMode === 'feed' && <DatabaseFeedView databaseId={databaseId} columns={columns} config={configuredView.layout === 'feed' ? configuredView : null} onOpen={(id) => setOpenRowId(id)} />}
      {viewMode === 'dashboard' && <DatabaseDashboardView databaseId={databaseId} columns={columns} config={configuredView.layout === 'dashboard' ? configuredView : null} views={views} onOpen={(id) => setOpenRowId(id)} />}

      {viewSettingsOpen && (
        <DatabaseViewSettingsModal
          activeView={views.find((view) => view.id === activeViewId) ?? null}
          views={views}
          columns={columns}
          config={configuredView}
          onClose={() => setViewSettingsOpen(false)}
          onApply={(config) => {
            setViewConfig(config);
            setFilter(legacyFilterFromViewConfig(config));
            setSorts(config.sorts);
            setViewMode(config.layout);
          }}
          onReload={reloadViews}
          onSelect={applyView}
        />
      )}

      {taskWorkspaceOpen && databaseId && (
        <DatabaseTaskWorkspace databaseId={databaseId} columns={columns} onClose={() => setTaskWorkspaceOpen(false)} onChanged={() => void load(databaseId)} />
      )}

      {automationWorkspaceOpen && databaseId && (
        <DatabaseAutomationWorkspace databaseId={databaseId} columns={columns} onClose={() => setAutomationWorkspaceOpen(false)} onChanged={() => void load(databaseId)} />
      )}

      {(loading || loadingPage) && <div className="px-4 py-1 text-xs text-neutral-600">{t('Cargando…')}</div>}

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

// ── Versioned view settings ─────────────────────────────────────────────────

const DATABASE_VIEW_LAYOUTS: Array<{ id: DatabaseViewLayout; label: string }> = [
  { id: 'table', label: 'Tabla' },
  { id: 'gallery', label: 'Galería' },
  { id: 'list', label: 'Lista' },
  { id: 'board', label: 'Tablero' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'chart', label: 'Gráfico' },
  { id: 'map', label: 'Mapa' },
  { id: 'feed', label: 'Feed' },
  { id: 'dashboard', label: 'Dashboard' },
];

function DatabaseViewSettingsModal({
  activeView,
  views,
  columns,
  config,
  onClose,
  onApply,
  onReload,
  onSelect,
}: {
  activeView: DatabaseSavedView | null;
  views: DatabaseSavedView[];
  columns: DatabaseColumn[];
  config: DatabaseViewConfig;
  onClose: () => void;
  onApply: (config: DatabaseViewConfig) => void;
  onReload: () => Promise<void>;
  onSelect: (view: DatabaseSavedView | null) => void;
}) {
  const [draft, setDraft] = useState(() => withViewProperties(config, columns.map((column) => column.id)));
  const [name, setName] = useState(activeView?.name ?? t('Vista sin guardar'));
  const [revisions, setRevisions] = useState<DatabaseViewRevision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = !activeView || activeView.ownerActorId === 'local' || activeView.editPermission !== 'owner';

  useEffect(() => {
    setDraft(withViewProperties(config, columns.map((column) => column.id)));
    setName(activeView?.name ?? t('Vista sin guardar'));
  }, [activeView?.id, columns, config]);
  useEffect(() => {
    if (!activeView) {
      setRevisions([]);
      return;
    }
    void window.nodus.listDatabaseViewRevisions(activeView.id).then((items) => {
      setRevisions(items);
      setSelectedRevision(items[0]?.revision ?? null);
    });
  }, [activeView]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patchDraft = (patch: Record<string, unknown>) => {
    setDraft((current) => normalizeDatabaseViewConfig({ ...current, ...patch }));
  };
  const setLayout = (layout: DatabaseViewLayout) => {
    setDraft((current) => withViewProperties(normalizeDatabaseViewConfig({ ...current, layout }), columns.map((column) => column.id)));
  };
  const setProperty = (columnId: string, patch: Partial<(typeof draft.properties)[number]>) => {
    setDraft((current) => ({
      ...current,
      properties: current.properties.map((property) => property.columnId === columnId ? { ...property, ...patch } : property),
    }));
  };
  const moveProperty = (columnId: string, delta: -1 | 1) => {
    setDraft((current) => {
      const ordered = [...current.properties].sort((left, right) => left.order - right.order);
      const index = ordered.findIndex((property) => property.columnId === columnId);
      const target = Math.max(0, Math.min(ordered.length - 1, index + delta));
      if (index < 0 || index === target) return current;
      ordered.splice(target, 0, ordered.splice(index, 1)[0]);
      return { ...current, properties: ordered.map((property, order) => ({ ...property, order })) };
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeDatabaseViewConfig(draft);
      if (activeView) {
        const updated = await window.nodus.updateDatabaseView(activeView.id, {
          name: name.trim() || activeView.name,
          layout: normalized.layout,
          filter: legacyFilterFromViewConfig(normalized),
          sorts: normalized.sorts,
          config: normalized,
          scope: normalized.scope,
          ownerActorId: normalized.ownerActorId,
          editPermission: normalized.editPermission,
          sourceViewId: normalized.sourceViewId,
          expectedRevision: activeView.revision,
        });
        if (updated) onSelect(updated);
        await onReload();
      } else {
        onApply(normalized);
      }
      onApply(normalized);
      toast(t('Configuración de vista guardada.'));
      onClose();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (linked: boolean) => {
    if (!activeView) return;
    setBusy(true);
    setError(null);
    try {
      const created = linked
        ? await window.nodus.linkDatabaseView(activeView.id, `${activeView.name} — ${t('enlazada')}`, 'personal')
        : await window.nodus.duplicateDatabaseView(activeView.id);
      await onReload();
      if (created) onSelect(created);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (delta: -1 | 1) => {
    if (!activeView) return;
    const ids = views.map((view) => view.id);
    const index = ids.indexOf(activeView.id);
    const target = Math.max(0, Math.min(ids.length - 1, index + delta));
    if (index < 0 || index === target) return;
    ids.splice(target, 0, ids.splice(index, 1)[0]);
    setBusy(true);
    try {
      await window.nodus.reorderDatabaseViews(activeView.databaseId, ids);
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!activeView || selectedRevision == null) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await window.nodus.restoreDatabaseViewRevision(activeView.id, selectedRevision, activeView.revision);
      if (restored) {
        onSelect(restored);
        onApply(restored.config);
      }
      await onReload();
      toast(t('Revisión restaurada como una revisión nueva.'));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const columnSelect = (value: string | null, onChange: (value: string | null) => void, testId: string) => (
    <select className="input h-9" aria-label={t('Propiedad')} data-testid={testId} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{t('Sin propiedad')}</option>
      {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
    </select>
  );

  const renderLayoutSettings = () => {
    if (draft.layout === 'table') return (
      <ViewToggle label={t('Mostrar cálculos de pie')} checked={draft.showCalculations} onChange={(showCalculations) => patchDraft({ showCalculations })} />
    );
    if (draft.layout === 'list') return (
      <ViewToggle label={t('Mostrar iconos')} checked={draft.showIcons} onChange={(showIcons) => patchDraft({ showIcons })} />
    );
    if (draft.layout === 'gallery') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <ViewSelect label={t('Portada')} value={draft.cover.kind} onChange={(kind) => patchDraft({ cover: { ...draft.cover, kind } })} options={[
          ['none', t('Sin portada')], ['page_cover', t('Portada de página')], ['page_content', t('Contenido de página')], ['property', t('Propiedad de archivo')],
        ]} />
        {draft.cover.kind === 'property' && <label className="grid gap-1 text-xs"><span>{t('Propiedad de portada')}</span>{columnSelect(draft.cover.columnId ?? null, (columnId) => patchDraft({ cover: { ...draft.cover, columnId } }), 'view-cover-property')}</label>}
        <ViewSelect label={t('Ajuste de imagen')} value={draft.cover.fit} onChange={(fit) => patchDraft({ cover: { ...draft.cover, fit } })} options={[["cover", t('Rellenar')], ["contain", t('Ajustar')]]} />
        <ViewSelect label={t('Tamaño de tarjeta')} value={draft.cardSize} onChange={(cardSize) => patchDraft({ cardSize })} options={[["small", t('Pequeño')], ["medium", t('Mediano')], ["large", t('Grande')]]} />
      </div>
    );
    if (draft.layout === 'board') {
      const grouped = columns.find((column) => column.id === draft.groupBy?.columnId);
      const limitGroups = [
        ...(grouped?.type === 'select' || grouped?.type === 'status' ? grouped.options.map((option) => ({ id: option.id, label: option.label })) : []),
        { id: '__empty__', label: t('Sin grupo') },
      ];
      return <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>{t('Agrupar por')}</span>{columnSelect(draft.groupBy?.columnId ?? null, (columnId) => patchDraft({ groupBy: columnId ? { columnId, dir: 'asc' } : null }), 'view-board-group')}</label>
        <label className="grid gap-1 text-xs"><span>{t('Subagrupar por')}</span>{columnSelect(draft.subgroupBy?.columnId ?? null, (columnId) => patchDraft({ subgroupBy: columnId ? { columnId, dir: 'asc' } : null }), 'view-board-subgroup')}</label>
        <ViewSelect label={t('Tamaño de tarjeta')} value={draft.cardSize} onChange={(cardSize) => patchDraft({ cardSize })} options={[["small", t('Pequeño')], ["medium", t('Mediano')], ["large", t('Grande')]]} />
        <ViewToggle label={t('Ocultar grupos vacíos')} checked={draft.hideEmptyGroups} onChange={(hideEmptyGroups) => patchDraft({ hideEmptyGroups })} />
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs">{t('Límites por grupo')}</span>
          <div className="grid gap-2 rounded-lg border border-neutral-200 p-2 sm:grid-cols-2 dark:border-neutral-800">
            {limitGroups.map((group) => <label key={group.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{group.label}</span><input className="input h-8 w-24" type="number" min="0" placeholder={t('Sin límite')} value={draft.groupLimits[group.id] ?? ''} onChange={(event) => patchDraft({ groupLimits: { ...draft.groupLimits, [group.id]: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) } })} /></label>)}
          </div>
        </div>
      </div>;
    }
    if (draft.layout === 'calendar') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>{t('Fecha inicial')}</span>{columnSelect(draft.dateColumnId, (dateColumnId) => patchDraft({ dateColumnId }), 'view-calendar-date')}</label>
        <label className="grid gap-1 text-xs"><span>{t('Fecha final')}</span>{columnSelect(draft.endDateColumnId, (endDateColumnId) => patchDraft({ endDateColumnId }), 'view-calendar-end-date')}</label>
        <ViewSelect label={t('Escala')} value={draft.scale} onChange={(scale) => patchDraft({ scale })} options={[["month", t('Mes')], ["week", t('Semana')], ["day", t('Día')]]} />
        <ViewSelect label={t('La semana empieza')} value={String(draft.weekStartsOn)} onChange={(weekStartsOn) => patchDraft({ weekStartsOn: Number(weekStartsOn) })} options={[["1", t('Lunes')], ["0", t('Domingo')]]} />
      </div>
    );
    if (draft.layout === 'timeline') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>{t('Fecha inicial')}</span>{columnSelect(draft.startColumnId, (startColumnId) => patchDraft({ startColumnId }), 'view-timeline-start')}</label>
        <label className="grid gap-1 text-xs"><span>{t('Fecha final')}</span>{columnSelect(draft.endColumnId, (endColumnId) => patchDraft({ endColumnId }), 'view-timeline-end')}</label>
        <ViewSelect label={t('Escala')} value={draft.scale} onChange={(scale) => patchDraft({ scale })} options={['hours','days','weeks','months','quarters','years'].map((value) => [value, t(value)] as [string, string])} />
        <label className="grid gap-1 text-xs"><span>{t('Dependencias')}</span>{columnSelect(draft.dependencyColumnId, (dependencyColumnId) => patchDraft({ dependencyColumnId }), 'view-timeline-dependency')}</label>
        <ViewToggle label={t('Mostrar tabla lateral')} checked={draft.showSideTable} onChange={(showSideTable) => patchDraft({ showSideTable })} />
      </div>
    );
    if (draft.layout === 'chart') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <ViewSelect label={t('Tipo de gráfico')} value={draft.chart.type} onChange={(type) => patchDraft({ chart: { ...draft.chart, type } })} options={['bar','line','area','donut','scatter'].map((value) => [value, t(value)] as [string, string])} />
        <ViewSelect label={t('Agregación')} value={draft.chart.aggregation} onChange={(aggregation) => patchDraft({ chart: { ...draft.chart, aggregation } })} options={['count','sum','average','min','max'].map((value) => [value, t(value)] as [string, string])} />
        <label className="grid gap-1 text-xs"><span>{t('Eje X')}</span>{columnSelect(draft.chart.xColumnId, (xColumnId) => patchDraft({ chart: { ...draft.chart, xColumnId } }), 'view-chart-x')}</label>
        <label className="grid gap-1 text-xs"><span>{t('Eje Y')}</span>{columnSelect(draft.chart.yColumnId, (yColumnId) => patchDraft({ chart: { ...draft.chart, yColumnId } }), 'view-chart-y')}</label>
        <label className="grid gap-1 text-xs"><span>{t('Serie')}</span>{columnSelect(draft.chart.seriesColumnId, (seriesColumnId) => patchDraft({ chart: { ...draft.chart, seriesColumnId } }), 'view-chart-series')}</label>
      </div>
    );
    if (draft.layout === 'map') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>{t('Ubicación')}</span>{columnSelect(draft.locationColumnId, (locationColumnId) => patchDraft({ locationColumnId }), 'view-map-location')}</label>
        <ViewToggle label={t('Agrupar marcadores cercanos')} checked={draft.cluster} onChange={(cluster) => patchDraft({ cluster })} />
      </div>
    );
    if (draft.layout === 'feed') return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span>{t('Fecha')}</span>{columnSelect(draft.dateColumnId, (dateColumnId) => patchDraft({ dateColumnId }), 'view-feed-date')}</label>
        <ViewToggle label={t('Incluir cambios de página')} checked={draft.includePageChanges} onChange={(includePageChanges) => patchDraft({ includePageChanges })} />
      </div>
    );
    if (draft.layout === 'dashboard') return (
      <div className="grid gap-2 rounded-xl border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800" data-testid="view-dashboard-widgets">
        {views.filter((view) => view.id !== activeView?.id && view.layout !== 'dashboard').map((view, index) => {
          const selected = draft.widgets.some((widget) => widget.viewId === view.id);
          return <label key={view.id} className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={selected} onChange={(event) => patchDraft({ widgets: event.target.checked
            ? [...draft.widgets, { id: `widget-${view.id}`, viewId: view.id, x: index % 2 * 6, y: Math.floor(index / 2) * 4, width: 6, height: 4 }]
            : draft.widgets.filter((widget) => widget.viewId !== view.id) })} /><span className="min-w-0 flex-1 truncate">{view.name}</span><span className="text-neutral-500">{t(DATABASE_VIEW_LAYOUTS.find((layout) => layout.id === view.layout)?.label ?? view.layout)}</span></label>;
        })}
        {views.filter((view) => view.id !== activeView?.id && view.layout !== 'dashboard').length === 0 && <p className="sm:col-span-2 text-xs text-neutral-500">{t('Crea otras vistas para componer el dashboard.')}</p>}
      </div>
    );
    return <p className="text-xs text-neutral-500">{t('El dashboard guardará aquí su cuadrícula versionada de widgets.')}</p>;
  };

  return createPortal(
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="database-view-settings-title" className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950" data-testid="database-view-settings">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="settings" className="text-indigo-500" />
          <div className="min-w-0 flex-1">
            <h2 id="database-view-settings-title" className="truncate font-semibold">{t('Configurar vista')}</h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Diseño, propiedades y acceso se guardan juntos y se pueden restaurar.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
        </header>

        <div
          className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5"
          role="region"
          aria-label={t('Opciones de configuración de la vista')}
          tabIndex={0}
        >
          {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
          {!canEdit && <div role="alert" data-testid="view-no-permission" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('No tienes permiso para editar esta vista.')}</div>}

          <fieldset disabled={!canEdit} className="contents">
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs"><span>{t('Nombre de la vista')}</span><input className="input h-9" value={name} disabled={!activeView || !canEdit} onChange={(event) => setName(event.target.value)} /></label>
            <ViewSelect label={t('Diseño')} value={draft.layout} onChange={(layout) => setLayout(layout as DatabaseViewLayout)} options={DATABASE_VIEW_LAYOUTS.map((layout) => [layout.id, t(layout.label)])} testId="view-layout-select" />
            <ViewSelect label={t('Altura de fila')} value={draft.rowHeight} onChange={(rowHeight) => patchDraft({ rowHeight })} options={[["compact", t('Compacta')], ["medium", t('Media')], ["tall", t('Alta')]]} />
            <ViewSelect label={t('Densidad')} value={draft.density} onChange={(density) => patchDraft({ density })} options={[["compact", t('Compacta')], ["comfortable", t('Cómoda')], ["spacious", t('Espaciosa')]]} />
            <ViewSelect label={t('Abrir páginas')} value={draft.openMode} onChange={(openMode) => patchDraft({ openMode })} options={[["center", t('Modal centrado')], ["side", t('Panel lateral')], ["full_page", t('Página completa')]]} />
            <ViewToggle label={t('Ajustar contenido en varias líneas')} checked={draft.wrap} onChange={(wrap) => patchDraft({ wrap })} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Configuración del diseño')}</h3>
            {renderLayoutSettings()}
          </section>

          {'cardPropertyIds' in draft && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Propiedades de tarjeta')}</h3>
              <div className="grid gap-2 rounded-xl border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800">
                {columns.filter((column) => column.type !== 'title').map((column) => <label key={column.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.cardPropertyIds.includes(column.id)} onChange={(event) => patchDraft({ cardPropertyIds: event.target.checked ? [...draft.cardPropertyIds, column.id] : draft.cardPropertyIds.filter((id) => id !== column.id) })} /><span className="truncate">{column.name}</span></label>)}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Propiedades')}</h3>
              <span className="text-xs text-neutral-600 dark:text-neutral-300">{draft.properties.filter((property) => property.visible).length}/{draft.properties.length} {t('visibles')}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800" data-testid="view-property-list">
              {[...draft.properties].sort((left, right) => left.order - right.order).map((property, index, ordered) => {
                const column = columns.find((candidate) => candidate.id === property.columnId);
                if (!column) return null;
                return (
                  <div key={property.columnId} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 last:border-b-0 sm:flex-nowrap dark:border-neutral-800">
                    <span className="min-w-0 basis-full truncate text-sm sm:flex-1 sm:basis-auto">{column.name}</span>
                    <label className="flex h-6 w-6 items-center justify-center gap-1 text-xs sm:h-auto sm:w-auto"><input type="checkbox" checked={property.visible} onChange={(event) => setProperty(property.columnId, { visible: event.target.checked })} /><span className="sr-only sm:not-sr-only">{t('Visible')}</span></label>
                    <label className="flex h-6 w-6 items-center justify-center gap-1 text-xs sm:h-auto sm:w-auto"><input type="checkbox" checked={property.frozen} onChange={(event) => setProperty(property.columnId, { frozen: event.target.checked })} /><span className="sr-only sm:not-sr-only">{t('Congelar')}</span></label>
                    <input className="input h-8 w-20" aria-label={tx('Ancho de {name}', { name: column.name })} type="number" min={64} max={800} placeholder={t('Auto')} value={property.width ?? ''} onChange={(event) => setProperty(property.columnId, { width: event.target.value ? Number(event.target.value) : null })} />
                    <button className="btn btn-ghost h-8 w-8 p-0" disabled={index === 0} aria-label={tx('Subir {name}', { name: column.name })} onClick={() => moveProperty(property.columnId, -1)}><Icon name="arrowDown" className="rotate-180" /></button>
                    <button className="btn btn-ghost h-8 w-8 p-0" disabled={index === ordered.length - 1} aria-label={tx('Bajar {name}', { name: column.name })} onClick={() => moveProperty(property.columnId, 1)}><Icon name="arrowDown" /></button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-neutral-200 p-4 sm:grid-cols-2 dark:border-neutral-800">
            <ViewSelect label={t('Visibilidad')} value={draft.scope} onChange={(scope) => patchDraft({ scope })} options={[["shared", t('Compartida')], ["personal", t('Personal')]]} />
            <ViewSelect label={t('Quién puede editar')} value={draft.editPermission} onChange={(editPermission) => patchDraft({ editPermission })} options={[["owner", t('Sólo propietario')], ["editors", t('Editores')], ["everyone", t('Todos con acceso')]]} />
            {activeView && <>
              <button className="btn btn-ghost justify-center gap-2 border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void duplicate(false)}><Icon name="plus" /> {t('Duplicar vista')}</button>
              <button className="btn btn-ghost justify-center gap-2 border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void duplicate(true)}><Icon name="link" /> {t('Crear vista enlazada')}</button>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <button className="btn btn-ghost min-w-0 flex-1 whitespace-normal" disabled={busy || views[0]?.id === activeView.id} onClick={() => void reorder(-1)}>{t('Mover a la izquierda')}</button>
                <button className="btn btn-ghost min-w-0 flex-1 whitespace-normal" disabled={busy || views[views.length - 1]?.id === activeView.id} onClick={() => void reorder(1)}>{t('Mover a la derecha')}</button>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <select className="input h-9 w-full min-w-0 flex-1" aria-label={t('Historial de revisiones')} value={selectedRevision ?? ''} onChange={(event) => setSelectedRevision(Number(event.target.value))}>
                  {revisions.map((revision) => <option key={revision.id} value={revision.revision}>v{revision.revision} · {t(revision.reason)} · {new Date(revision.createdAt).toLocaleString()}</option>)}
                </select>
                <button className="btn btn-ghost gap-1 border border-neutral-300 dark:border-neutral-700" disabled={busy || selectedRevision == null} onClick={() => void restore()}><Icon name="undo" /> {t('Restaurar')}</button>
              </div>
            </>}
          </section>
          </fieldset>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary gap-2 disabled:opacity-50" data-testid="save-view-settings" disabled={busy || !canEdit} onClick={() => void save()}><Icon name={busy ? 'sync' : 'check'} className={busy ? 'animate-spin' : ''} /> {t('Guardar')}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ViewSelect({ label, value, options, onChange, testId }: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return <label className="grid gap-1 text-xs"><span>{label}</span><select className="input h-9" data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}

function ViewToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
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
  if (column.type === 'select' || column.type === 'status' || column.type === 'multi_select') {
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
  const sortable = columns.filter((c) => c.type !== 'attachment' && c.type !== 'files' && c.type !== 'ai_image' && c.type !== 'relation');
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
  const attachColumns = columns.filter((c) => c.type === 'attachment' || c.type === 'files');
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

function AggregateCell({ width, column, aggregate }: {
  width: number;
  column: DatabaseColumn;
  aggregate?: DatabaseAggregateResult['columns'][number];
}) {
  if (!aggregate) return <div style={{ width }} className="shrink-0 border-r border-neutral-200 px-2 py-2 dark:border-neutral-900">—</div>;
  const numeric = aggregate.numericCount > 0;
  const label = numeric && aggregate.sum != null
    ? `${t('Suma')} ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(aggregate.sum)}`
    : `${aggregate.nonEmpty.toLocaleString()} ${t('con valor')}`;
  const title = numeric
    ? `${t('Promedio')}: ${aggregate.average == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(aggregate.average)} · ${t('Mínimo')}: ${String(aggregate.min ?? '—')} · ${t('Máximo')}: ${String(aggregate.max ?? '—')}`
    : `${column.name}: ${aggregate.nonEmpty}/${aggregate.count}`;
  return <div style={{ width }} className="shrink-0 truncate border-r border-neutral-200 px-2 py-2 dark:border-neutral-900" title={title}>{label}</div>;
}

/** The first title column's value for a row (the card/record heading). */
function rowTitle(row: DatabaseRow, columns: DatabaseColumn[]): string {
  const titleCol = columns.find((c) => c.type === 'title') ?? columns[0];
  return titleCol ? (row.cells[titleCol.id] ?? '').trim() || t('Sin título') : t('Sin título');
}

/** The first image attachment across the row's attachment / AI-image columns, for the cover. */
function coverAttachment(row: DatabaseRow, columns: DatabaseColumn[], preferredColumnId?: string | null): DatabaseAttachment | null {
  const ordered = preferredColumnId
    ? [...columns.filter((column) => column.id === preferredColumnId), ...columns.filter((column) => column.id !== preferredColumnId)]
    : columns;
  for (const col of ordered) {
    if (col.type !== 'attachment' && col.type !== 'files' && col.type !== 'ai_image') continue;
    const img = (row.attachments?.[col.id] ?? []).find((a) => attachmentKind(a.mimeType) === 'image');
    if (img) return img;
  }
  return null;
}

const GALLERY_COLS_MIN = 3;
const GALLERY_COLS_MAX = 15;
/** `gap-3` in pixels — the virtualizer needs the real spacing to place rows. */
const GALLERY_GAP_PX = 12;
/** The card's fixed text block below the square image (`h-[4.25rem]`). */
const GALLERY_CARD_TEXT_PX = 68;

function GalleryView({
  rows,
  columns,
  config,
  onOpen,
  onRangeChange,
  anchorAdjustment,
}: {
  rows: DatabaseRow[];
  columns: DatabaseColumn[];
  config: Extract<DatabaseViewConfig, { layout: 'gallery' }> | null;
  onOpen: (rowId: string) => void;
  onRangeChange: (range: { start: number; end: number; total: number }) => void;
  anchorAdjustment: { token: number; items: number } | null;
}) {
  // Up to a couple of select/multi-select chips per card, for a quick scan.
  const selectedCardIds = new Set(config?.cardPropertyIds ?? []);
  const chipCols = columns
    .filter((column) => selectedCardIds.size > 0 ? selectedCardIds.has(column.id) : column.type === 'select' || column.type === 'status' || column.type === 'multi_select')
    .slice(0, 4);
  // View-owned defaults replace the old localStorage settings, so switching views restores
  // the saved card scale and image fit instead of leaking the last gallery's choices.
  const initialColumns = config?.cardSize === 'small' ? 8 : config?.cardSize === 'large' ? 3 : GALLERY_COLS_MIN;
  const [cols, setCols] = useState<number>(initialColumns);
  const [fit, setFit] = useState<'cover' | 'contain'>(config?.cover.fit ?? 'cover');
  useEffect(() => setCols(config?.cardSize === 'small' ? 8 : config?.cardSize === 'large' ? 3 : GALLERY_COLS_MIN), [config?.cardSize]);
  useEffect(() => setFit(config?.cover.fit ?? 'cover'), [config?.cover.fit]);

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
                anchorAdjustment={anchorAdjustment ? {
                  token: anchorAdjustment.token,
                  items: Math.sign(anchorAdjustment.items) * Math.ceil(Math.abs(anchorAdjustment.items) / cols),
                } : null}
                onRangeChange={({ start, end, total }) => onRangeChange({
                  start: start * cols,
                  end: Math.min(rows.length, end * cols),
                  total: Math.max(rows.length, total * cols),
                })}
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
                      <GalleryCard
                        key={row.id}
                        row={row}
                        columns={columns}
                        chipCols={chipCols}
                        fit={fit}
                        coverColumnId={config?.cover.kind === 'property' ? config.cover.columnId : null}
                        onOpen={() => onOpen(row.id)}
                      />
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
  coverColumnId,
  onOpen,
}: {
  row: DatabaseRow;
  columns: DatabaseColumn[];
  chipCols: DatabaseColumn[];
  fit: 'cover' | 'contain';
  coverColumnId?: string | null;
  onOpen: () => void;
}) {
  const cover = coverAttachment(row, columns, coverColumnId);
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
                  <span key={`${col.id}-${o.id}`} className="db-option-chip text-[10px] px-1.5 py-0.5 rounded border truncate max-w-full" style={chipStyle(o.color)}>
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

// ── List + board views ──────────────────────────────────────────────────────

function DatabaseListView({ rows, columns, config, onOpen, onRangeChange, anchorAdjustment }: {
  rows: DatabaseRow[];
  columns: DatabaseColumn[];
  config: Extract<DatabaseViewConfig, { layout: 'list' }> | null;
  onOpen: (rowId: string) => void;
  onRangeChange: (range: { start: number; end: number; total: number }) => void;
  anchorAdjustment: { token: number; items: number } | null;
}) {
  const shownIds = new Set(config?.properties.filter((property) => property.visible).map((property) => property.columnId) ?? []);
  const secondary = columns.filter((column) => column.type !== 'title' && (shownIds.size === 0 || shownIds.has(column.id))).slice(0, 3);
  const height = config?.density === 'compact' ? 42 : config?.density === 'spacious' ? 68 : 54;
  return <div className="min-h-0 flex-1 p-3" data-testid="database-list-view">
    <VirtualList
      items={rows}
      itemHeight={height}
      getKey={(row) => row.id}
      className="h-full rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      anchorAdjustment={anchorAdjustment}
      onRangeChange={onRangeChange}
      empty={<div className="p-8 text-center text-sm text-neutral-500">{t('Sin filas todavía. Añade la primera.')}</div>}
      renderItem={(row) => <button className="flex h-full w-full items-center gap-3 border-b border-neutral-200 px-3 text-left hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-neutral-900 dark:hover:bg-neutral-900" onClick={() => onOpen(row.id)}>
        {config?.showIcons !== false && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Icon name="table" size={14} /></span>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{rowTitle(row, columns)}</span>
        <span className="hidden min-w-0 flex-[2] items-center justify-end gap-3 text-xs text-neutral-500 sm:flex">
          {secondary.map((column) => <span key={column.id} className="max-w-44 truncate"><span className="sr-only">{column.name}: </span>{cellPreview(column, row) || '—'}</span>)}
        </span>
        <Icon name="chevronRight" size={13} className="shrink-0 text-neutral-400" />
      </button>}
    />
  </div>;
}

interface DatabaseBoardLane {
  key: string;
  raw: string | null;
  label: string;
  color: string | null;
  rows: DatabaseRow[];
}

function DatabaseBoardView({ rows, totalCount, columns, config, onOpen, onMove, onLoadMore, loadingMore }: {
  rows: DatabaseRow[];
  totalCount: number;
  columns: DatabaseColumn[];
  config: Extract<DatabaseViewConfig, { layout: 'board' }> | null;
  onOpen: (rowId: string) => void;
  onMove: (rowId: string, columnId: string, raw: string | null) => Promise<unknown>;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const groupable = columns.filter((column) => column.type === 'status' || column.type === 'select' || column.type === 'person');
  const groupColumn = columns.find((column) => column.id === config?.groupBy?.columnId && groupable.includes(column)) ?? groupable[0];
  const [dragLane, setDragLane] = useState<string | null>(null);
  const cardIds = new Set(config?.cardPropertyIds ?? []);
  const cardColumns = columns.filter((column) => column.id !== groupColumn?.id && column.type !== 'title' && (cardIds.size === 0 || cardIds.has(column.id))).slice(0, 4);
  const cardHeight = config?.cardSize === 'small' ? 70 : config?.cardSize === 'large' ? 126 : 94;

  const lanes = useMemo<DatabaseBoardLane[]>(() => {
    if (!groupColumn) return [];
    const laneByKey = new Map<string, DatabaseBoardLane>();
    if (groupColumn.type === 'select' || groupColumn.type === 'status') {
      for (const option of groupColumn.options) laneByKey.set(option.id, { key: option.id, raw: option.id, label: option.label, color: option.color, rows: [] });
    }
    const empty: DatabaseBoardLane = { key: '__empty__', raw: null, label: t('Sin grupo'), color: null, rows: [] };
    laneByKey.set(empty.key, empty);
    for (const row of rows) {
      const raw = row.cells[groupColumn.id] ?? null;
      let key = raw || empty.key;
      let label = raw || empty.label;
      if (groupColumn.type === 'person' && raw) {
        const person = decodeDatabasePeople(raw)[0];
        key = person?.id ?? raw;
        label = person?.label ?? raw;
        if (!laneByKey.has(key)) laneByKey.set(key, { key, raw, label, color: null, rows: [] });
      }
      const lane = laneByKey.get(key) ?? empty;
      lane.rows.push(row);
    }
    return [...laneByKey.values()].filter((lane) => !config?.hideEmptyGroups || lane.rows.length > 0);
  }, [config?.hideEmptyGroups, groupColumn, rows]);

  if (!groupColumn) return <div className="grid min-h-0 flex-1 place-items-center p-8 text-center text-sm text-neutral-500" data-testid="database-board-empty-config">
    <div><Icon name="table" size={30} className="mx-auto mb-3 text-neutral-400" /><p>{t('Añade una propiedad Status, Select o Persona para usar el tablero.')}</p></div>
  </div>;

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="database-board-view">
    <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 text-xs dark:border-neutral-800">
      <span>{tx('Agrupado por {name}', { name: groupColumn.name })} · {rows.length.toLocaleString()}/{totalCount.toLocaleString()}</span>
      {rows.length < totalCount && <button className="btn btn-ghost h-8" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t('Cargando…') : t('Cargar más tarjetas')}</button>}
    </div>
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {lanes.map((lane) => {
        const limit = config?.groupLimits[lane.key] ?? null;
        const full = limit != null && lane.rows.length >= limit;
        return <section
          key={lane.key}
          className={`flex min-w-[270px] max-w-[330px] flex-1 flex-col rounded-xl border bg-neutral-100/70 dark:bg-neutral-900/60 ${dragLane === lane.key ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-neutral-200 dark:border-neutral-800'}`}
          aria-label={lane.label}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('text/db-row')) { event.preventDefault(); setDragLane(lane.key); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragLane(null); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragLane(null);
            const rowId = event.dataTransfer.getData('text/db-row');
            if (!rowId || (full && !lane.rows.some((row) => row.id === rowId))) {
              if (full) toast(t('Este grupo ha alcanzado su límite.'));
              return;
            }
            void onMove(rowId, groupColumn.id, lane.raw);
          }}
        >
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 px-3 text-xs dark:border-neutral-800">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-400" style={lane.color ? { backgroundColor: lane.color } : undefined} />
            <strong className="min-w-0 flex-1 truncate">{lane.label}</strong>
            <span className="tabular-nums text-neutral-500">{lane.rows.length}{limit != null ? `/${limit}` : ''}</span>
          </header>
          <VirtualList
            items={lane.rows}
            itemHeight={cardHeight + 8}
            getKey={(row) => row.id}
            className="min-h-0 flex-1 p-2"
            overscan={4}
            empty={<div className="grid h-24 place-items-center px-3 text-center text-xs text-neutral-500">{t('Suelta una tarjeta aquí')}</div>}
            renderItem={(row) => <article
              draggable
              data-testid="board-card"
              className="mb-2 flex cursor-grab flex-col gap-2 overflow-hidden rounded-lg border border-neutral-200 bg-white p-3 shadow-sm active:cursor-grabbing dark:border-neutral-800 dark:bg-neutral-950"
              style={{ height: cardHeight }}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/db-row', row.id); }}
              onDragEnd={() => setDragLane(null)}
            >
              <button className="truncate text-left text-sm font-medium hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-indigo-300" onClick={() => onOpen(row.id)}>{rowTitle(row, columns)}</button>
              <div className="min-h-0 space-y-1 overflow-hidden text-[11px] text-neutral-500">
                {cardColumns.map((column) => <div key={column.id} className="flex gap-2"><span className="w-20 shrink-0 truncate">{column.name}</span><span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{cellPreview(column, row) || '—'}</span></div>)}
              </div>
            </article>}
          />
        </section>;
      })}
    </div>
  </div>;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    setRow(await window.nodus.getDatabaseRow(rowId));
  }, [rowId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(() => {
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);
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

  return createPortal(
    <div className="database-record-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-2 sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        className="database-record-modal card-modal w-full max-w-4xl flex flex-col max-h-[96vh] overflow-hidden sm:max-h-[92vh]"
        data-testid="database-record-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || databaseName}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="database-record-header flex items-center gap-2 border-b border-neutral-200 px-3 py-3 dark:border-neutral-800 sm:px-5">
          <span className="text-xs text-neutral-700 dark:text-neutral-300">{databaseName}</span>
          <div className="flex-1" />
          <button className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" onClick={onClose} title={t('Cerrar')} aria-label={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
          <h2 className="text-xl font-semibold mb-5 leading-tight">{title || t('Sin título')}</h2>
          {!row ? (
            <p className="text-sm text-neutral-500">{t('Cargando…')}</p>
          ) : (
            <div className="space-y-0.5">
              {columns.map((col) => {
                const def = columnTypeDef(col.type);
                return (
                  <div key={col.id} className="database-record-row flex flex-col items-stretch gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/40 sm:flex-row sm:items-start sm:gap-4 sm:px-2">
                    <label className="flex w-full shrink-0 items-center gap-1.5 pt-1 text-xs text-neutral-700 dark:text-neutral-300 sm:w-36 sm:pt-2">
                      <Icon name={def.icon} size={12} className="opacity-60 shrink-0" />
                      <span className="truncate">{col.name}</span>
                    </label>
                    <div className="database-record-field flex min-h-[2.25rem] min-w-0 flex-1 items-center rounded-md border border-neutral-200 bg-white transition-colors hover:border-neutral-300 focus-within:border-indigo-400 dark:border-neutral-800/70 dark:bg-neutral-900/30 dark:hover:border-neutral-700/80 dark:focus-within:border-indigo-700">
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
          {row && <PageBlockEditor rowId={rowId} />}
        </div>
      </div>
    </div>,
    document.body
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
  if (col.type === 'attachment' || col.type === 'files') {
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
  if (col.type === 'checkbox') return <CheckboxCell value={value} onChange={onChange} align="start" label={col.name} />;
  if (col.type === 'select' || col.type === 'status') return <SelectCell column={col} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi={false} />;
  if (col.type === 'multi_select') return <SelectCell column={col} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi />;
  if (col.type === 'ai') return <AiCell column={col} rowId={row.id} value={value} onChange={onChange} onRan={onAttachmentsChanged} wrap />;
  if (col.type === 'relation') return <RelationCell column={col} rowId={row.id} />;
  if (col.type === 'rollup') return <RollupCell value={row.rollups?.[col.id] ?? ''} />;
  if (col.type === 'comparison')
    return <ComparisonCell column={col} columns={columns} rowId={row.id} value={value} onRan={onAttachmentsChanged} large />;
  if (col.type === 'formula')
    return <FormulaCell column={col} value={value} color={row.formulaColors?.[col.id]} error={row.formulaErrors?.[col.id]} large />;
  if (col.type === 'number') return <NumberPropertyCell column={col} value={value} onChange={onChange} />;
  if (col.type === 'date') return <DatePropertyCell column={col} value={value} onChange={onChange} large />;
  if (col.type === 'time') return <TextCell value={value} onChange={onChange} inputType="time" />;
  if (col.type === 'person') return <PeoplePropertyCell column={col} value={value} onChange={onChange} large />;
  if (col.type === 'location') return <LocationPropertyCell column={col} value={value} onChange={onChange} large />;
  if (isReadOnlyDatabaseProperty(col.type)) return <ReadOnlyPropertyCell column={col} value={value} />;
  if (col.type === 'button') return <ButtonPropertyCell column={col} rowId={row.id} value={value} onRan={onAttachmentsChanged} />;
  if (col.type === 'url' || col.type === 'email' || col.type === 'phone') {
    return <TextCell value={value} onChange={onChange} inputType={col.type === 'phone' ? 'tel' : col.type} />;
  }
  return <LongTextCell value={value} onChange={onChange} markdown={col.type === 'text' || col.type === 'rich_text'} />;
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
  stickyLeft,
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
  stickyLeft?: number;
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
      style={{ width, left: stickyLeft }}
      className={`shrink-0 relative border-r border-neutral-800 ${stickyLeft == null ? '' : 'sticky z-20 bg-neutral-50 dark:bg-neutral-950'} ${dragOver ? 'border-l-2 border-l-indigo-500' : ''}`}
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
          <div className="absolute z-30 top-full left-0 mt-1 w-64 card-modal p-1 text-sm">
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
            {['number', 'date', 'unique_id', 'button'].includes(column.type) && (
              <PropertyColumnConfig column={column} onChanged={onChanged} />
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

function PropertyColumnConfig({ column, onChanged }: { column: DatabaseColumn; onChanged: () => void }) {
  const save = async (patch: Record<string, unknown>) => {
    await window.nodus.updateDatabaseColumn(column.id, { config: { ...column.config, ...patch } });
    onChanged();
  };
  if (column.type === 'number') return <div className="mt-1 space-y-1 border-t border-neutral-800 px-2 py-2 text-xs">
    <label className="block">{t('Formato numérico')}<select className="input mt-1 w-full text-xs" value={String(column.config.numberFormat ?? 'plain')}
      onChange={(event) => void save({ numberFormat: event.target.value })}>
      <option value="plain">{t('Número')}</option><option value="integer">{t('Entero')}</option><option value="decimal">{t('Decimal')}</option>
      <option value="currency">{t('Moneda')}</option><option value="percent">{t('Porcentaje')}</option><option value="progress">{t('Progreso')}</option>
    </select></label>
    {column.config.numberFormat === 'currency' && <label className="block">{t('Moneda')}<input className="input mt-1 w-full text-xs" defaultValue={String(column.config.numberCurrency ?? 'EUR')}
      onBlur={(event) => void save({ numberCurrency: event.target.value.trim().toUpperCase() || 'EUR' })} /></label>}
    {column.config.numberFormat === 'progress' && <label className="block">{t('Valor máximo')}<input className="input mt-1 w-full text-xs" type="number" min="0.000001" defaultValue={Number(column.config.progressMaximum ?? 100)}
      onBlur={(event) => void save({ progressMaximum: Math.max(0.000001, Number(event.target.value) || 100) })} /></label>}
    <label className="block">{t('Decimales')}<input className="input mt-1 w-full text-xs" type="number" min="0" max="8" defaultValue={Number(column.config.numberDecimals ?? 2)}
      onBlur={(event) => void save({ numberDecimals: Math.min(8, Math.max(0, Number(event.target.value) || 0)) })} /></label>
  </div>;
  if (column.type === 'date') return <div className="mt-1 space-y-2 border-t border-neutral-800 px-2 py-2 text-xs">
    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(column.config.dateIncludeTime)}
      onChange={(event) => void save({ dateIncludeTime: event.target.checked })} />{t('Incluir hora por defecto')}</label>
    <label className="block">{t('Zona horaria predeterminada')}<input className="input mt-1 w-full text-xs" defaultValue={String(column.config.dateTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}
      onBlur={(event) => void save({ dateTimeZone: event.target.value.trim() })} /></label>
  </div>;
  if (column.type === 'unique_id') return <div className="mt-1 grid grid-cols-[1fr_72px] gap-2 border-t border-neutral-800 px-2 py-2 text-xs">
    <label>{t('Prefijo')}<input className="input mt-1 w-full text-xs" maxLength={24} defaultValue={String(column.config.uniqueIdPrefix ?? '')}
      onBlur={(event) => void save({ uniqueIdPrefix: event.target.value.slice(0, 24) })} /></label>
    <label>{t('Dígitos')}<input className="input mt-1 w-full text-xs" type="number" min="1" max="12" defaultValue={Number(column.config.uniqueIdPadding ?? 4)}
      onBlur={(event) => void save({ uniqueIdPadding: Math.min(12, Math.max(1, Number(event.target.value) || 4)) })} /></label>
  </div>;
  return <div className="mt-1 space-y-1 border-t border-neutral-800 px-2 py-2 text-xs">
    <label className="block">{t('Etiqueta del botón')}<input className="input mt-1 w-full text-xs" defaultValue={String(column.config.buttonLabel ?? t('Ejecutar'))}
      onBlur={(event) => void save({ buttonLabel: event.target.value.trim() || t('Ejecutar') })} /></label>
    <label className="block">{t('Color')}<input className="mt-1 h-8 w-full" type="color" defaultValue={String(column.config.buttonColor ?? '#4f46e5')}
      onChange={(event) => void save({ buttonColor: event.target.value })} /></label>
  </div>;
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
            {column.type === 'status' && <select className="input w-20 shrink-0 px-1 py-0.5 text-[10px]" value={opt.group ?? 'pending'}
              aria-label={tx('Grupo de {name}', { name: opt.label })}
              onChange={async (event) => { await window.nodus.updateDatabaseOption(opt.id, { group: event.target.value as DatabaseSelectOption['group'] }); onChanged(); }}>
              <option value="pending">{t('Pendiente')}</option><option value="in_progress">{t('En curso')}</option><option value="complete">{t('Completo')}</option>
            </select>}
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
  const [type, setType] = useState<DatabaseColumnType>('rich_text');
  const submit = async () => {
    await onAdd(name.trim() || t('Columna'), type);
    setName('');
    setType('rich_text');
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
  stickyLeft,
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
  selected,
  onSelect,
}: {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  width: number;
  stickyLeft?: number;
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
  selected?: boolean;
  onSelect?: (extend: boolean) => void;
}) {
  return (
    <div
      data-testid="database-cell"
      data-row-id={rowId}
      data-column-id={column.id}
      style={{ width, left: stickyLeft }}
      className={`shrink-0 h-full border-r border-neutral-900 overflow-hidden outline-none ${stickyLeft == null ? '' : 'sticky z-10 bg-white group-hover:bg-neutral-50 dark:bg-neutral-950 dark:group-hover:bg-neutral-900'} ${selected ? 'ring-2 ring-inset ring-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40' : ''}`}
      tabIndex={0}
      aria-selected={selected || undefined}
      onMouseDown={(event) => onSelect?.(event.shiftKey)}
    >
      {column.type === 'formula' ? (
        <FormulaCell column={column} value={value} color={formulaColor} error={formulaError} wrap={wrap} />
      ) : column.type === 'comparison' ? (
        <ComparisonCell column={column} columns={columns} rowId={rowId} value={value} onRan={onAttachmentsChanged} wrap={wrap} />
      ) : column.type === 'checkbox' ? (
        <CheckboxCell value={value} onChange={onChange} label={column.name} />
      ) : column.type === 'select' || column.type === 'status' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi={false} wrap={wrap} />
      ) : column.type === 'multi_select' ? (
        <SelectCell column={column} value={value} onChange={onChange} onOptionsChanged={onOptionsChanged} multi wrap={wrap} />
      ) : column.type === 'attachment' || column.type === 'files' ? (
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
        <NumberPropertyCell column={column} value={value} onChange={onChange} wrap={wrap} />
      ) : column.type === 'date' ? (
        <DatePropertyCell column={column} value={value} onChange={onChange} />
      ) : column.type === 'time' ? (
        <TextCell value={value} onChange={onChange} inputType="time" wrap={wrap} />
      ) : column.type === 'person' ? (
        <PeoplePropertyCell column={column} value={value} onChange={onChange} />
      ) : column.type === 'location' ? (
        <LocationPropertyCell column={column} value={value} onChange={onChange} />
      ) : isReadOnlyDatabaseProperty(column.type) ? (
        <ReadOnlyPropertyCell column={column} value={value} />
      ) : column.type === 'button' ? (
        <ButtonPropertyCell column={column} rowId={rowId} value={value} onRan={onAttachmentsChanged} />
      ) : column.type === 'url' || column.type === 'email' || column.type === 'phone' ? (
        <TextCell value={value} onChange={onChange} inputType={column.type === 'phone' ? 'tel' : column.type} wrap={wrap} />
      ) : (
        <LongTextCell value={value} onChange={onChange} markdown={column.type === 'text' || column.type === 'rich_text'} wrap={wrap} />
      )}
    </div>
  );
}

function formatNumberProperty(column: DatabaseColumn, value: string | null): string {
  const number = value == null ? null : Number(value);
  if (number == null || !Number.isFinite(number)) return '';
  const decimals = Math.min(8, Math.max(0, Math.trunc(Number(column.config.numberDecimals ?? 2))));
  const format = column.config.numberFormat ?? 'plain';
  if (format === 'integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number);
  if (format === 'currency') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(column.config.numberCurrency ?? 'EUR'),
        minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(number);
    } catch { return `${number.toFixed(decimals)} ${String(column.config.numberCurrency ?? 'EUR')}`; }
  }
  if (format === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: decimals }).format(number);
  if (format === 'progress') {
    const maximum = Math.max(0.000001, Number(column.config.progressMaximum ?? 100));
    return `${Math.max(0, Math.min(100, (number / maximum) * 100)).toFixed(decimals)}%`;
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: format === 'decimal' ? decimals : 12 }).format(number);
}

/** Keep Escape local to a property popover instead of closing the parent record modal. */
function usePropertyPopoverEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, open]);
}

function NumberPropertyCell({ column, value, onChange, wrap = false }: {
  column: DatabaseColumn; value: string | null; onChange: (raw: string | null) => void; wrap?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== value) onChange(next);
  };
  if (editing) return <input type="number" className="h-full w-full bg-transparent px-2 text-right text-sm outline-none"
    autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }} />;
  const display = formatNumberProperty(column, value);
  const progress = column.config.numberFormat === 'progress' && value != null
    ? Math.max(0, Math.min(100, (Number(value) / Math.max(0.000001, Number(column.config.progressMaximum ?? 100))) * 100)) : null;
  return <button className={`relative h-full w-full overflow-hidden px-2 text-right text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/40 ${wrap ? 'whitespace-normal' : 'truncate'}`}
    onClick={() => setEditing(true)} aria-label={`${column.name}: ${display || t('Sin contenido')}`}>
    {progress != null && <span className="absolute inset-y-1 left-1 rounded bg-indigo-500/20" style={{ width: `calc(${progress}% - 8px)` }} aria-hidden="true" />}
    <span className="relative">{display || ' '}</span>
  </button>;
}

function DatePropertyCell({ column, value, onChange, large = false }: {
  column: DatabaseColumn; value: string | null; onChange: (raw: string | null) => void; large?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  usePropertyPopoverEscape(open, close);
  const initial = decodeDatabaseDate(value);
  const [draft, setDraft] = useState<DatabaseDateValue>(() => initial ?? {
    start: '', end: null, includeTime: Boolean(column.config.dateIncludeTime),
    timeZone: String(column.config.dateTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
    reminderMinutes: null, recurrence: null,
  });
  useEffect(() => setDraft(decodeDatabaseDate(value) ?? { start: '', end: null,
    includeTime: Boolean(column.config.dateIncludeTime), timeZone: String(column.config.dateTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
    reminderMinutes: null, recurrence: null }), [column.config.dateIncludeTime, column.config.dateTimeZone, value]);
  const ref = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, ref, large ? 420 : 360, 320, 'below');
  const save = () => { onChange(encodeDatabaseDate(draft)); setOpen(false); };
  const display = initial ? [initial.start.replace('T', ' '), initial.end?.replace('T', ' ')].filter(Boolean).join(' – ') : '';
  return <div className="h-full w-full">
    <button ref={ref} className="h-full w-full truncate px-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
      onClick={() => setOpen((current) => !current)} aria-label={`${column.name}: ${display || t('Sin contenido')}`}>{display || ' '}</button>
    {open && coords && createPortal(<>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div className="card-modal fixed z-50 space-y-2 p-3 text-xs" style={anchorStyle(coords)} role="dialog" aria-label={t('Configurar fecha')}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.includeTime)}
          onChange={(event) => setDraft((current) => ({ ...current, includeTime: event.target.checked }))} />{t('Incluir hora')}</label>
        <label className="block">{t('Inicio')}<input className="input mt-1 w-full" type={draft.includeTime ? 'datetime-local' : 'date'} value={draft.start}
          onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} /></label>
        <label className="block">{t('Fin opcional')}<input className="input mt-1 w-full" type={draft.includeTime ? 'datetime-local' : 'date'} value={draft.end ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value || null }))} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label>{t('Zona horaria')}<input className="input mt-1 w-full" value={draft.timeZone ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, timeZone: event.target.value || null }))} /></label>
          <label>{t('Recordatorio (min)')}<input className="input mt-1 w-full" type="number" min="0" value={draft.reminderMinutes ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, reminderMinutes: event.target.value ? Number(event.target.value) : null }))} /></label>
        </div>
        <label className="block">{t('Recurrencia')}<select className="input mt-1 w-full" value={draft.recurrence ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, recurrence: (event.target.value || null) as DatabaseDateValue['recurrence'] }))}>
          <option value="">{t('Sin recurrencia')}</option><option value="daily">{t('Diaria')}</option><option value="weekly">{t('Semanal')}</option>
          <option value="monthly">{t('Mensual')}</option><option value="yearly">{t('Anual')}</option>
        </select></label>
        <div className="flex justify-between"><button className="btn btn-ghost text-xs" onClick={() => { onChange(null); setOpen(false); }}>{t('Vaciar')}</button>
          <button className="btn btn-primary text-xs" onClick={save}>{t('Guardar')}</button></div>
      </div>
    </>, document.body)}
  </div>;
}

function PeoplePropertyCell({ column, value, onChange, large = false }: {
  column: DatabaseColumn; value: string | null; onChange: (raw: string | null) => void; large?: boolean;
}) {
  const people = decodeDatabasePeople(value);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  usePropertyPopoverEscape(open, close);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'person' | 'group'>('person');
  const ref = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, ref, large ? 400 : 320, 300, 'below');
  const write = (next: DatabasePersonReference[]) => onChange(encodeDatabasePeople(next));
  const add = () => { const name = label.trim(); if (!name) return; write([...people, { id: `${kind}:${name.toLocaleLowerCase()}`, label: name, kind }]); setLabel(''); };
  return <div className="h-full w-full">
    <button ref={ref} className="flex h-full w-full items-center gap-1 overflow-hidden px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
      onClick={() => setOpen((current) => !current)} aria-label={`${column.name}: ${people.map((person) => person.label).join(', ') || t('Sin contenido')}`}>{people.map((person) => <span key={`${person.kind}:${person.id}`} className="db-option-chip truncate rounded border px-1.5 py-0.5 text-xs">{person.kind === 'group' ? '👥' : '●'} {person.label}</span>)}</button>
    {open && coords && createPortal(<><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="card-modal fixed z-50 p-2" style={anchorStyle(coords)}>
      <div className="mb-2 flex flex-wrap gap-1">{people.map((person) => <button key={`${person.kind}:${person.id}`} className="db-option-chip rounded border px-1.5 py-1 text-xs"
        onClick={() => write(people.filter((candidate) => candidate !== person))}>{person.label} ×</button>)}</div>
      <div className="flex gap-1"><select className="input w-24 text-xs" value={kind} onChange={(event) => setKind(event.target.value as 'person' | 'group')}>
        <option value="person">{t('Persona')}</option><option value="group">{t('Grupo')}</option></select>
        <input className="input min-w-0 flex-1 text-xs" value={label} placeholder={t('Nombre')}
          onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); }} />
        <button className="btn btn-primary px-2" onClick={add} aria-label={t('Añadir')} title={t('Añadir')}><Icon name="plus" size={12} /></button></div>
    </div></>, document.body)}
  </div>;
}

function LocationPropertyCell({ column, value, onChange, large = false }: {
  column: DatabaseColumn; value: string | null; onChange: (raw: string | null) => void; large?: boolean;
}) {
  const current = decodeDatabaseLocation(value);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  usePropertyPopoverEscape(open, close);
  const [draft, setDraft] = useState<DatabaseLocationValue>(() => current ?? { name: '', address: null, latitude: null, longitude: null });
  useEffect(() => setDraft(decodeDatabaseLocation(value) ?? { name: '', address: null, latitude: null, longitude: null }), [value]);
  const ref = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, ref, large ? 420 : 360, 320, 'below');
  return <div className="h-full w-full"><button ref={ref} className="h-full w-full truncate px-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/40"
    onClick={() => setOpen((state) => !state)} aria-label={`${column.name}: ${current?.name || t('Sin contenido')}`}>{current ? `⌖ ${current.name}` : ' '}</button>
    {open && coords && createPortal(<><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="card-modal fixed z-50 space-y-2 p-3 text-xs" style={anchorStyle(coords)} role="dialog" aria-label={t('Editar ubicación')}>
      <label className="block">{t('Lugar')}<input className="input mt-1 w-full" value={draft.name} onChange={(event) => setDraft((item) => ({ ...item, name: event.target.value }))} /></label>
      <label className="block">{t('Dirección')}<input className="input mt-1 w-full" value={draft.address ?? ''} onChange={(event) => setDraft((item) => ({ ...item, address: event.target.value || null }))} /></label>
      <div className="grid grid-cols-2 gap-2"><label>{t('Latitud')}<input className="input mt-1 w-full" type="number" value={draft.latitude ?? ''} onChange={(event) => setDraft((item) => ({ ...item, latitude: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>{t('Longitud')}<input className="input mt-1 w-full" type="number" value={draft.longitude ?? ''} onChange={(event) => setDraft((item) => ({ ...item, longitude: event.target.value ? Number(event.target.value) : null }))} /></label></div>
      <div className="flex justify-end"><button className="btn btn-primary text-xs" onClick={() => { onChange(encodeDatabaseLocation(draft)); setOpen(false); }}>{t('Guardar')}</button></div>
    </div></>, document.body)}
  </div>;
}

function ReadOnlyPropertyCell({ column, value }: { column: DatabaseColumn; value: string | null }) {
  let display = value ?? '';
  if (column.type === 'created_by' || column.type === 'last_edited_by') display = decodeDatabasePeople(value).map((person) => person.label).join(', ');
  if ((column.type === 'created_time' || column.type === 'last_edited_time') && value) {
    const date = new Date(value); display = Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
  }
  return <span className={`block w-full truncate px-2 text-sm text-neutral-700 dark:text-neutral-300 ${column.type === 'unique_id' ? 'font-mono' : ''}`}
    title={display}>{display || '—'}</span>;
}

function ButtonPropertyCell({ column, rowId, value, onRan }: {
  column: DatabaseColumn; rowId: string; value: string | null; onRan: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const state = decodeDatabaseButton(value);
  const label = String(column.config.buttonLabel ?? t('Ejecutar'));
  const execute = async () => {
    if (busy) return; setBusy(true);
    try {
      const runs = await window.nodus.runDatabaseButtonAutomation(column.id, rowId);
      const failed = runs.find((run) => run.status === 'failed'); if (failed) throw new Error(failed.error || t('La ejecución ha fallado.'));
      onRan(); toast(t('Botón ejecutado.'));
    } catch (cause) {
      toast((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
    } finally { setBusy(false); }
  };
  return <button className="btn btn-primary mx-1 h-7 max-w-full truncate px-2 text-xs" aria-busy={busy}
    style={column.config.buttonColor ? { backgroundColor: String(column.config.buttonColor) } : undefined}
    disabled={busy} onClick={() => void execute()}
    title={state.lastClickedAt ? tx('Ejecutado {n} veces', { n: state.clicks }) : label}><Icon name={busy ? 'sync' : 'play'} className={busy ? 'animate-spin' : ''} size={11} />{label}</button>;
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
        <span className="db-option-chip text-xs px-1.5 py-0.5 rounded border max-w-full truncate" style={chipStyle(option.color)}>
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
  const filtered = qLower ? column.options.filter((o) => (o.label ?? '').toLowerCase().includes(qLower)) : column.options;
  const exactMatch = column.options.some((o) => (o.label ?? '').toLowerCase() === qLower);
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
            <span key={opt.id} className="db-option-chip text-xs px-1.5 py-0.5 rounded border whitespace-nowrap" style={chipStyle(opt.color)}>
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
                  <span key={opt.id} className="db-option-chip text-xs pl-1.5 pr-1 py-0.5 rounded border flex items-center gap-1" style={chipStyle(opt.color)}>
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
                    <span className="db-option-chip px-1.5 py-0.5 rounded border" style={chipStyle(nextColor)}>
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
      setAttachmentCols((d?.columns ?? []).filter((c) => c.type === 'attachment' || c.type === 'files'));
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
            menu
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
  const [inverseColumns, setInverseColumns] = useState<DatabaseColumn[]>([]);
  useEffect(() => {
    void window.nodus.listDatabases().then((d) => setDatabases(d.map((x) => ({ id: x.id, name: x.name }))));
  }, []);
  useEffect(() => {
    if (kind !== 'db_row' || !targetDb) { setInverseColumns([]); return; }
    void window.nodus.getDatabaseDetail(targetDb).then((detail) => setInverseColumns(
      (detail?.columns ?? []).filter((candidate) => candidate.type === 'relation'
        && candidate.config.relationTargetKind === 'db_row'
        && candidate.config.relationTargetDatabaseId === column.databaseId),
    ));
  }, [kind, targetDb, column.databaseId]);
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
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {kind === 'db_row' && targetDb && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 pt-2 pb-1">{t('Cardinalidad')}</div>
          <select
            className="input w-full text-xs"
            value={String(column.config.relationCardinality ?? 'many')}
            onChange={(e) => void save({ relationCardinality: e.target.value })}
            aria-label={t('Cardinalidad')}
          >
            <option value="many">{t('Varias páginas')}</option>
            <option value="one">{t('Una página')}</option>
          </select>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 pt-2 pb-1">{t('Relación inversa')}</div>
          <select
            className="input w-full text-xs"
            value={String(column.config.relationInverseColumnId ?? '')}
            onChange={(e) => void save({ relationInverseColumnId: e.target.value || undefined })}
            aria-label={t('Relación inversa')}
          >
            <option value="">{t('Sin propiedad inversa')}</option>
            {inverseColumns.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
          <p className="text-[10px] leading-snug text-neutral-500 mt-1">
            {inverseColumns.length ? t('Los enlaces nuevos se reflejarán en ambas bases.') : t('Crea primero una relación compatible en la base de destino.')}
          </p>
          <button
            className="btn btn-ghost border border-neutral-700 w-full mt-2 text-xs"
            onClick={async () => { await window.nodus.cleanupBrokenDatabaseRelations(column.databaseId); onChanged(); }}
          >
            {t('Limpiar relaciones rotas')}
          </button>
        </>
      )}
    </div>
  );
}

function RelationCell({ column, rowId }: { column: DatabaseColumn; rowId: string }) {
  const [rels, setRels] = useState<DatabaseRelation[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RelationTarget[]>([]);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
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
    try {
      setRelationError(null);
      if (repairingId) await window.nodus.repairDatabaseRelation(repairingId, target.id, target.vaultId ?? null);
      else await window.nodus.addDatabaseRelation(rowId, column.id, kind, target.id, target.vaultId ?? null);
      setRepairingId(null); setQuery(''); await load();
    } catch (error) {
      setRelationError(error instanceof Error ? error.message : String(error));
    }
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
        aria-label={column.name}
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
                        {r.broken && (
                          <button
                            className="rounded px-1 text-[10px] font-medium hover:bg-amber-500/20 focus-visible:outline focus-visible:outline-2"
                            onClick={() => { setRepairingId(r.id); setQuery(''); }}
                            aria-label={t('Reparar relación')}
                          >
                            {t('Reparar')}
                          </button>
                        )}
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
                  placeholder={repairingId ? t('Buscar destino de sustitución…') : t('Buscar…')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {repairingId && (
                  <div className="flex items-center justify-between rounded border border-amber-700/50 bg-amber-500/10 px-2 py-1 mb-1 text-[11px] text-amber-300">
                    <span>{t('Selecciona el destino correcto para reparar el enlace.')}</span>
                    <button onClick={() => setRepairingId(null)} aria-label={t('Cancelar')}><Icon name="x" size={12} /></button>
                  </div>
                )}
                {relationError && <p role="alert" className="rounded border border-red-700/50 bg-red-500/10 px-2 py-1 mb-1 text-[11px] text-red-300">{relationError}</p>}
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
      {hint && <p className="text-[11px] leading-snug text-neutral-400">{hint}</p>}
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

function AdvancedFormulaEditor({
  spec,
  columns,
  onChange,
}: {
  spec: Extract<FormulaSpec, { kind: 'expression' }>;
  columns: DatabaseColumn[];
  onChange: (spec: FormulaSpec) => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const update = (source: string) => {
    try {
      const ast = parseFormulaExpression(source);
      onChange({ kind: 'expression', source, ast, resultKind: formulaExpressionResultKind(ast, columns) });
    } catch (error) {
      onChange({ ...spec, source, parseError: error instanceof Error ? error.message : String(error) });
    }
  };
  const insert = (snippet: string) => {
    const node = editor.current;
    const start = node?.selectionStart ?? spec.source.length;
    const end = node?.selectionEnd ?? start;
    const source = `${spec.source.slice(0, start)}${snippet}${spec.source.slice(end)}`;
    update(source);
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + snippet.length, start + snippet.length); });
  };
  return (
    <FormulaField
      label={t('Expresión segura')}
      hint={t('Solo admite propiedades, operadores y funciones de la lista. No ejecuta JavaScript.')}
    >
      <textarea
        ref={editor}
        className="input min-h-28 w-full resize-y font-mono text-xs leading-relaxed"
        value={spec.source}
        onChange={(event) => update(event.target.value)}
        spellCheck={false}
        aria-label={t('Expresión de fórmula')}
        aria-invalid={Boolean(spec.parseError)}
        data-testid="formula-expression-editor"
      />
      <div className="flex flex-wrap gap-1" aria-label={t('Autocompletar propiedades')}>
        {columns.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[10px] text-neutral-300 hover:border-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            onClick={() => insert(`property("${candidate.id}")`)}
            title={candidate.id}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <div className="max-h-20 overflow-y-auto rounded border border-neutral-800 p-1.5 flex flex-wrap gap-1" aria-label={t('Autocompletar funciones')}>
        {FORMULA_EXPRESSION_FUNCTIONS.filter((name) => name !== 'property').map((name) => (
          <button
            key={name}
            type="button"
            className="min-h-6 min-w-6 rounded px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-600/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            onClick={() => insert(`${name}()`)}
          >
            {name}()
          </button>
        ))}
      </div>
      {spec.parseError ? (
        <p role="alert" className="rounded border border-red-800/60 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">{spec.parseError}</p>
      ) : (
        <p className="flex items-center gap-1 text-[11px] text-emerald-400"><Icon name="check" size={12} /> {t('Sintaxis y tipos válidos')}</p>
      )}
      <p className="text-[10px] leading-relaxed text-neutral-500">
        {t('Ejemplo')}: <code>if(property("estado") == "hecho", upper("listo"), dateAdd(date("2026-01-01"), 7, "days"))</code>
      </p>
    </FormulaField>
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
        config: {
          ...column.config,
          formula: spec ?? undefined,
          formulaCompiledAst: spec ? formulaRecipeToExpression(spec) : undefined,
          formulaColors: colors,
          formulaDecimals: decimals,
        },
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
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* One column of FormulaFields, one gap between them: the whole body reads as a single
            form rather than a stack of differently-spaced widgets. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <FormulaField label={t('¿Qué quieres calcular?')}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                    <span className="text-[10px] leading-tight text-neutral-400">{t(r.hint)}</span>
                  </button>
                );
              })}
            </div>
          </FormulaField>

          {spec?.kind === 'arithmetic' && <ArithmeticEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'columnStat' && <ColumnStatEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'ifThen' && <IfThenEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'concat' && <ConcatEditor spec={spec} columns={others} onChange={setSpec} />}
          {spec?.kind === 'expression' && <AdvancedFormulaEditor spec={spec} columns={others} onChange={setSpec} />}

          {spec && resultIsNumber && (
            <FormulaField label={t('Decimales a mostrar')} hint={t('Solo cambia cómo se ve: el valor guardado mantiene toda su precisión.')}>
              <select className="input w-32 text-xs" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} aria-label={t('Decimales a mostrar')}>
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
                  <p className="text-xs text-neutral-400">{t('Añade filas para ver el resultado.')}</p>
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
                  <p className="pt-2 border-t border-neutral-800 text-[10px] leading-snug text-neutral-400">{describeFormula(spec, columns, t)}</p>
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
        aria-label={t('Columna o número')}
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
          aria-label={t('Número fijo')}
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
        <select className="input w-full text-xs" value={spec.op} onChange={(e) => onChange({ ...spec, op: e.target.value as typeof spec.op })} aria-label={t('Operación')}>
          {ARITHMETIC_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </FormulaField>
      <FormulaField label={t('Con estas columnas o números')}>
        <FormulaBox>
          {spec.operands.length === 0 && <p className="text-[11px] text-neutral-400">{t('Todavía no has añadido nada.')}</p>}
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
        {rules.length === 0 && <p className="text-[11px] text-neutral-400">{t('El resultado se muestra sin color.')}</p>}
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
              .filter((c) => c.type !== 'title' && c.type !== 'attachment' && c.type !== 'files' && c.type !== 'ai_image' && c.type !== 'relation')
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
          <p className="mt-1 text-[10px] text-neutral-500">
            {tx('Resultado materializado como {type}', { type: t(rollupResultKind(fn) === 'number' ? 'Número'
              : rollupResultKind(fn) === 'date' ? 'Fecha' : rollupResultKind(fn) === 'json' ? 'JSON' : 'Texto') })}
          </p>
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

export function NotionImportReportModal({ report, onClose }: { report: NotionImportReport; onClose: () => void }) {
  const meaningful = report.notices.filter((notice) => notice.kind !== 'transformed');
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notion-import-report-title"
        data-testid="notion-import-report"
        className="card-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <Icon name="check" size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="notion-import-report-title" className="font-semibold">{t('Importación de Notion completada')}</h2>
            <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">{report.sourceFile}</p>
          </div>
          <button className="ml-auto rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['databases', t('Bases de datos'), report.databases], ['rows', t('Filas'), report.rows],
              ['pages', t('Páginas'), report.pages + report.rowPages], ['assets', t('Archivos'), report.assets],
            ].map(([key, label, value]) => (
              <div key={String(key)} data-testid={`notion-import-metric-${key}`} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
                <div className="text-2xl font-semibold tabular-nums">{value}</div>
                <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{label}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
            {tx('Se conservaron {n} páginas de fila y se deduplicaron {a} archivos.', {
              n: report.rowPages.toLocaleString(), a: report.deduplicatedAssets.toLocaleString(),
            })}
          </p>
          <h3 className="mt-5 text-sm font-medium">{t('Informe de compatibilidad')}</h3>
          <div className="mt-2 space-y-2">
            {meaningful.map((notice, index) => (
              <div key={`${notice.kind}:${notice.source}:${index}`} className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
                notice.kind === 'omitted'
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                  : 'border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300'
              }`}>
                <div className="font-medium">{notice.source}{notice.count > 1 ? ` · ${notice.count}` : ''}</div>
                <div>{notice.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <footer className="flex justify-end border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-primary" onClick={onClose}>{t('Continuar')}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export type { CsvImportPlanData };

/** Every type a column can be imported as. relation/rollup need a target, so they are
 *  configured after the import from the grid's own type picker. */
const IMPORTABLE_TYPES: DatabaseColumnType[] = [
  'title',
  'rich_text',
  'text',
  'number',
  'date',
  'time',
  'select',
  'status',
  'multi_select',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'location',
  'attachment',
  'files',
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
