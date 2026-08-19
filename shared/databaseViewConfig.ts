import type { DatabaseFilterState, SortRule } from './databaseFilters';
import { databaseFilterStateToNode, type FilterNode, type GroupRule } from './databaseQuery';

export const DATABASE_VIEW_CONFIG_VERSION = 2 as const;

export type DatabaseViewLayout =
  | 'table'
  | 'gallery'
  | 'list'
  | 'board'
  | 'calendar'
  | 'timeline'
  | 'chart'
  | 'map'
  | 'feed'
  | 'dashboard';

export type DatabaseViewDensity = 'compact' | 'comfortable' | 'spacious';
export type DatabaseViewOpenMode = 'center' | 'side' | 'full_page';
export type DatabaseViewScope = 'personal' | 'shared';
export type DatabaseViewEditPermission = 'owner' | 'editors' | 'everyone';

export interface DatabaseViewPropertyConfig {
  columnId: string;
  visible: boolean;
  order: number;
  width: number | null;
  frozen: boolean;
}

export interface DatabaseViewCoverConfig {
  kind: 'none' | 'page_cover' | 'page_content' | 'property';
  columnId?: string | null;
  fit: 'cover' | 'contain';
}

export interface DatabaseViewCommonConfig {
  version: typeof DATABASE_VIEW_CONFIG_VERSION;
  layout: DatabaseViewLayout;
  properties: DatabaseViewPropertyConfig[];
  rowHeight: 'compact' | 'medium' | 'tall';
  wrap: boolean;
  density: DatabaseViewDensity;
  openMode: DatabaseViewOpenMode;
  filter: FilterNode | null;
  sorts: SortRule[];
  groups: GroupRule[];
  scope: DatabaseViewScope;
  ownerActorId: string;
  editPermission: DatabaseViewEditPermission;
  /** A linked view starts from this snapshot without mutating its source. */
  sourceViewId: string | null;
}

export interface DatabaseTableViewConfig extends DatabaseViewCommonConfig {
  layout: 'table';
  showCalculations: boolean;
}

export interface DatabaseGalleryViewConfig extends DatabaseViewCommonConfig {
  layout: 'gallery';
  cover: DatabaseViewCoverConfig;
  cardPropertyIds: string[];
  cardSize: 'small' | 'medium' | 'large';
}

export interface DatabaseListViewConfig extends DatabaseViewCommonConfig {
  layout: 'list';
  showIcons: boolean;
}

export interface DatabaseBoardViewConfig extends DatabaseViewCommonConfig {
  layout: 'board';
  groupBy: GroupRule | null;
  subgroupBy: GroupRule | null;
  cardPropertyIds: string[];
  cardSize: 'small' | 'medium' | 'large';
  hideEmptyGroups: boolean;
  /** Raw group value -> maximum cards. Null or a missing key means unlimited. */
  groupLimits: Record<string, number | null>;
}

export interface DatabaseCalendarViewConfig extends DatabaseViewCommonConfig {
  layout: 'calendar';
  dateColumnId: string | null;
  endDateColumnId: string | null;
  scale: 'month' | 'week' | 'day';
  weekStartsOn: 0 | 1;
}

export interface DatabaseTimelineViewConfig extends DatabaseViewCommonConfig {
  layout: 'timeline';
  startColumnId: string | null;
  endColumnId: string | null;
  scale: 'hours' | 'days' | 'weeks' | 'months' | 'quarters' | 'years';
  showSideTable: boolean;
  dependencyColumnId: string | null;
}

export interface DatabaseChartViewConfig extends DatabaseViewCommonConfig {
  layout: 'chart';
  chart: {
    type: 'bar' | 'line' | 'area' | 'donut' | 'scatter';
    xColumnId: string | null;
    yColumnId: string | null;
    aggregation: 'count' | 'sum' | 'average' | 'min' | 'max';
    seriesColumnId: string | null;
  };
}

export interface DatabaseMapViewConfig extends DatabaseViewCommonConfig {
  layout: 'map';
  locationColumnId: string | null;
  cluster: boolean;
  cardPropertyIds: string[];
}

export interface DatabaseFeedViewConfig extends DatabaseViewCommonConfig {
  layout: 'feed';
  dateColumnId: string | null;
  includePageChanges: boolean;
  cardPropertyIds: string[];
}

export interface DatabaseDashboardViewConfig extends DatabaseViewCommonConfig {
  layout: 'dashboard';
  widgets: Array<{
    id: string;
    viewId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export type DatabaseViewConfig =
  | DatabaseTableViewConfig
  | DatabaseGalleryViewConfig
  | DatabaseListViewConfig
  | DatabaseBoardViewConfig
  | DatabaseCalendarViewConfig
  | DatabaseTimelineViewConfig
  | DatabaseChartViewConfig
  | DatabaseMapViewConfig
  | DatabaseFeedViewConfig
  | DatabaseDashboardViewConfig;

const LAYOUTS = new Set<DatabaseViewLayout>([
  'table', 'gallery', 'list', 'board', 'calendar', 'timeline', 'chart', 'map', 'feed', 'dashboard',
]);
const EMPTY_FILTER: DatabaseFilterState = { conjunction: 'and', conditions: [] };

function asLayout(value: unknown): DatabaseViewLayout {
  return typeof value === 'string' && LAYOUTS.has(value as DatabaseViewLayout) ? value as DatabaseViewLayout : 'table';
}

function common(layout: DatabaseViewLayout): DatabaseViewCommonConfig {
  return {
    version: DATABASE_VIEW_CONFIG_VERSION,
    layout,
    properties: [],
    rowHeight: 'medium',
    wrap: false,
    density: 'comfortable',
    openMode: 'center',
    filter: null,
    sorts: [],
    groups: [],
    scope: 'shared',
    ownerActorId: 'local',
    editPermission: 'editors',
    sourceViewId: null,
  };
}

export function defaultDatabaseViewConfig(layout: DatabaseViewLayout = 'table'): DatabaseViewConfig {
  const base = common(layout);
  switch (layout) {
    case 'gallery': return { ...base, layout, cover: { kind: 'page_content', fit: 'cover' }, cardPropertyIds: [], cardSize: 'medium' };
    case 'list': return { ...base, layout, showIcons: true };
    case 'board': return { ...base, layout, groupBy: null, subgroupBy: null, cardPropertyIds: [], cardSize: 'medium', hideEmptyGroups: false, groupLimits: {} };
    case 'calendar': return { ...base, layout, dateColumnId: null, endDateColumnId: null, scale: 'month', weekStartsOn: 1 };
    case 'timeline': return { ...base, layout, startColumnId: null, endColumnId: null, scale: 'weeks', showSideTable: true, dependencyColumnId: null };
    case 'chart': return { ...base, layout, chart: { type: 'bar', xColumnId: null, yColumnId: null, aggregation: 'count', seriesColumnId: null } };
    case 'map': return { ...base, layout, locationColumnId: null, cluster: true, cardPropertyIds: [] };
    case 'feed': return { ...base, layout, dateColumnId: null, includePageChanges: true, cardPropertyIds: [] };
    case 'dashboard': return { ...base, layout, widgets: [] };
    default: return { ...base, layout: 'table', showCalculations: true };
  }
}

function safeFilter(value: unknown, legacy: DatabaseFilterState): FilterNode | null {
  if (value && typeof value === 'object' && ((value as { type?: unknown }).type === 'condition' || (value as { type?: unknown }).type === 'group')) {
    return value as FilterNode;
  }
  return databaseFilterStateToNode(legacy ?? EMPTY_FILTER);
}

/**
 * Reads every historical shape into a complete v2 discriminated config. Unknown keys
 * are deliberately ignored: a corrupt or newer view cannot inject executable state.
 */
export function normalizeDatabaseViewConfig(
  value: unknown,
  legacy?: { layout?: unknown; filter?: DatabaseFilterState; sorts?: SortRule[] },
): DatabaseViewConfig {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const layout = asLayout(raw.layout ?? legacy?.layout);
  const result = defaultDatabaseViewConfig(layout) as DatabaseViewConfig & Record<string, unknown>;
  const propertyRows = Array.isArray(raw.properties) ? raw.properties : [];
  result.properties = propertyRows.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const p = entry as Record<string, unknown>;
    if (typeof p.columnId !== 'string' || !p.columnId) return [];
    return [{
      columnId: p.columnId,
      visible: p.visible !== false,
      order: Number.isFinite(p.order) ? Math.max(0, Math.floor(Number(p.order))) : index,
      width: Number.isFinite(p.width) ? Math.min(800, Math.max(64, Math.floor(Number(p.width)))) : null,
      frozen: p.frozen === true,
    }];
  });
  result.rowHeight = raw.rowHeight === 'compact' || raw.rowHeight === 'tall' ? raw.rowHeight : 'medium';
  result.wrap = raw.wrap === true;
  result.density = raw.density === 'compact' || raw.density === 'spacious' ? raw.density : 'comfortable';
  result.openMode = raw.openMode === 'side' || raw.openMode === 'full_page' ? raw.openMode : 'center';
  result.filter = safeFilter(raw.filter, legacy?.filter ?? EMPTY_FILTER);
  result.sorts = Array.isArray(raw.sorts) ? raw.sorts as SortRule[] : legacy?.sorts ?? [];
  result.groups = Array.isArray(raw.groups) ? (raw.groups as GroupRule[]).slice(0, 2) : [];
  result.scope = raw.scope === 'personal' ? 'personal' : 'shared';
  result.ownerActorId = typeof raw.ownerActorId === 'string' && raw.ownerActorId ? raw.ownerActorId : 'local';
  result.editPermission = raw.editPermission === 'owner' || raw.editPermission === 'everyone' ? raw.editPermission : 'editors';
  result.sourceViewId = typeof raw.sourceViewId === 'string' && raw.sourceViewId ? raw.sourceViewId : null;

  if (layout === 'gallery' && raw.cover && typeof raw.cover === 'object') {
    const gallery = result as DatabaseGalleryViewConfig;
    gallery.cover = { ...gallery.cover, ...(raw.cover as Partial<DatabaseViewCoverConfig>) };
  }
  if ('cardPropertyIds' in result && Array.isArray(raw.cardPropertyIds)) result.cardPropertyIds = raw.cardPropertyIds.filter((id): id is string => typeof id === 'string');
  if ('cardSize' in result && (raw.cardSize === 'small' || raw.cardSize === 'large')) result.cardSize = raw.cardSize;
  if ('showCalculations' in result) result.showCalculations = raw.showCalculations !== false;
  if ('showIcons' in result) result.showIcons = raw.showIcons !== false;
  if ('groupBy' in result) result.groupBy = raw.groupBy && typeof raw.groupBy === 'object' ? raw.groupBy as GroupRule : null;
  if ('subgroupBy' in result) result.subgroupBy = raw.subgroupBy && typeof raw.subgroupBy === 'object' ? raw.subgroupBy as GroupRule : null;
  if ('hideEmptyGroups' in result) result.hideEmptyGroups = raw.hideEmptyGroups === true;
  if ('groupLimits' in result && raw.groupLimits && typeof raw.groupLimits === 'object' && !Array.isArray(raw.groupLimits)) {
    const limits: Array<[string, number | null]> = [];
    for (const [key, value] of Object.entries(raw.groupLimits as Record<string, unknown>)) {
      if (value == null) {
        limits.push([key, null]);
        continue;
      }
      const limit = Math.floor(Number(value));
      if (Number.isFinite(limit) && limit >= 0) limits.push([key, Math.min(1_000_000, limit)]);
    }
    result.groupLimits = Object.fromEntries(limits);
  }
  if ('dateColumnId' in result) result.dateColumnId = typeof raw.dateColumnId === 'string' ? raw.dateColumnId : null;
  if ('endDateColumnId' in result) result.endDateColumnId = typeof raw.endDateColumnId === 'string' ? raw.endDateColumnId : null;
  if ('startColumnId' in result) result.startColumnId = typeof raw.startColumnId === 'string' ? raw.startColumnId : null;
  if ('scale' in result && typeof raw.scale === 'string') (result as { scale: string }).scale = raw.scale;
  if ('weekStartsOn' in result) result.weekStartsOn = raw.weekStartsOn === 0 ? 0 : 1;
  if ('showSideTable' in result) result.showSideTable = raw.showSideTable !== false;
  if ('dependencyColumnId' in result) result.dependencyColumnId = typeof raw.dependencyColumnId === 'string' ? raw.dependencyColumnId : null;
  if (layout === 'chart' && raw.chart && typeof raw.chart === 'object') {
    const chart = result as DatabaseChartViewConfig;
    const value = raw.chart as Record<string, unknown>;
    chart.chart = {
      type: value.type === 'line' || value.type === 'area' || value.type === 'donut' || value.type === 'scatter' ? value.type : 'bar',
      xColumnId: typeof value.xColumnId === 'string' ? value.xColumnId : null,
      yColumnId: typeof value.yColumnId === 'string' ? value.yColumnId : null,
      aggregation: value.aggregation === 'sum' || value.aggregation === 'average' || value.aggregation === 'min' || value.aggregation === 'max' ? value.aggregation : 'count',
      seriesColumnId: typeof value.seriesColumnId === 'string' ? value.seriesColumnId : null,
    };
  }
  if ('locationColumnId' in result) result.locationColumnId = typeof raw.locationColumnId === 'string' ? raw.locationColumnId : null;
  if ('cluster' in result) result.cluster = raw.cluster !== false;
  if ('includePageChanges' in result) result.includePageChanges = raw.includePageChanges !== false;
  if ('widgets' in result && Array.isArray(raw.widgets)) result.widgets = raw.widgets.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const widget = entry as Record<string, unknown>;
    if (typeof widget.viewId !== 'string' || !widget.viewId) return [];
    const number = (value: unknown, fallback: number, min: number, max: number) => Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback;
    return [{ id: typeof widget.id === 'string' && widget.id ? widget.id : `widget-${index}`, viewId: widget.viewId,
      x: number(widget.x, 0, 0, 11), y: number(widget.y, index * 4, 0, 10_000),
      width: number(widget.width, 6, 1, 12), height: number(widget.height, 4, 1, 20) }];
  });
  return result;
}

export function legacyFilterFromViewConfig(config: DatabaseViewConfig): DatabaseFilterState {
  const empty: DatabaseFilterState = { conjunction: 'and', conditions: [] };
  if (!config.filter || config.filter.type === 'condition') return empty;
  const convertGroup = (group: Extract<FilterNode, { type: 'group' }>): DatabaseFilterState => ({
    conjunction: group.operator,
    conditions: group.children.filter((child) => child.type === 'condition').map((child, index) => ({ ...child, id: `view-condition-${index}` })),
    groups: group.children.filter((child) => child.type === 'group').map((child, groupIndex) => ({
      id: `view-group-${groupIndex}`,
      conjunction: child.operator,
      conditions: child.children.filter((nested) => nested.type === 'condition').map((nested, index) => ({ ...nested, id: `view-nested-${groupIndex}-${index}` })),
    })),
  });
  return convertGroup(config.filter);
}

export function withViewProperties(config: DatabaseViewConfig, columnIds: string[]): DatabaseViewConfig {
  const current = new Map(config.properties.map((property) => [property.columnId, property]));
  const known = config.properties
    .filter((property) => columnIds.includes(property.columnId))
    .sort((left, right) => left.order - right.order)
    .map((property) => property.columnId);
  const orderedIds = [...known, ...columnIds.filter((columnId) => !current.has(columnId))];
  return {
    ...config,
    properties: orderedIds.map((columnId, order) => ({
      columnId,
      visible: current.get(columnId)?.visible ?? true,
      order,
      width: current.get(columnId)?.width ?? null,
      frozen: current.get(columnId)?.frozen ?? false,
    })),
  };
}
