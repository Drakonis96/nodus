import type { FilterNode } from './databaseQuery';
import type { DatabaseChartViewConfig } from './databaseViewConfig';

export const DATABASE_CHART_POINT_LIMIT = 200;
export const DATABASE_MAP_MARKER_LIMIT = 500;
export const DATABASE_FEED_LIMIT = 200;

export interface DatabaseChartQuery {
  databaseId: string;
  xColumnId: string;
  yColumnId?: string | null;
  seriesColumnId?: string | null;
  aggregation: DatabaseChartViewConfig['chart']['aggregation'];
  type: DatabaseChartViewConfig['chart']['type'];
  filter?: FilterNode | null;
  limit?: number;
}

export interface DatabaseChartPoint {
  key: string;
  label: string;
  seriesKey: string;
  seriesLabel: string;
  value: number;
  rowCount: number;
  xNumber: number | null;
  yNumber: number | null;
  /** Exact filter which opens the rows behind this aggregate. */
  drilldownFilter: FilterNode;
}

export interface DatabaseChartResult {
  points: DatabaseChartPoint[];
  totalGroups: number;
  truncated: boolean;
  revision: number;
  nullRows: number;
}

export interface DatabaseMapQuery {
  databaseId: string;
  locationColumnId: string;
  filter?: FilterNode | null;
  limit?: number;
}

export interface DatabaseMapMarker {
  id: string;
  rowId: string;
  title: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface DatabaseMapResult {
  markers: DatabaseMapMarker[];
  totalCount: number;
  truncated: boolean;
  revision: number;
}

export interface DatabaseMapCluster {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  markerIds: string[];
}

export interface DatabaseFeedQuery {
  databaseId: string;
  dateColumnId?: string | null;
  includePageChanges?: boolean;
  filter?: FilterNode | null;
  limit?: number;
}

export interface DatabaseFeedItem {
  id: string;
  rowId: string;
  pageId: string | null;
  title: string;
  occurredAt: string;
  kind: 'date' | 'created' | 'edited';
  actor: string;
  summary: string;
}

export interface DatabaseFeedResult {
  items: DatabaseFeedItem[];
  totalCount: number;
  truncated: boolean;
  revision: number;
}

export interface DatabaseChartExportInput {
  databaseId: string;
  title: string;
  svg: string;
  format: 'svg' | 'png';
}

/** Grid clustering is deterministic, zoom-independent and never merges across the antimeridian. */
export function clusterDatabaseMapMarkers(markers: DatabaseMapMarker[], cellDegrees = 8): DatabaseMapCluster[] {
  const size = Math.min(45, Math.max(.25, Number(cellDegrees) || 8));
  const buckets = new Map<string, DatabaseMapMarker[]>();
  for (const marker of markers) {
    if (!Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude)
      || marker.latitude < -90 || marker.latitude > 90 || marker.longitude < -180 || marker.longitude > 180) continue;
    const key = `${Math.floor((marker.latitude + 90) / size)}:${Math.floor((marker.longitude + 180) / size)}`;
    const bucket = buckets.get(key) ?? []; bucket.push(marker); buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => {
    const ordered = [...bucket].sort((left, right) => left.id.localeCompare(right.id));
    return {
      id: `cluster:${key}`,
      latitude: ordered.reduce((sum, marker) => sum + marker.latitude, 0) / ordered.length,
      longitude: ordered.reduce((sum, marker) => sum + marker.longitude, 0) / ordered.length,
      count: ordered.length,
      markerIds: ordered.map((marker) => marker.id),
    };
  }).sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}

/**
 * Clusters markers in projected screen space. Cluster positions are snapped to
 * cell centres so adjacent interactive targets keep a predictable separation
 * even when the source coordinates sit on opposite sides of a cell boundary.
 */
export function clusterDatabaseMapMarkersForViewport(
  markers: DatabaseMapMarker[],
  viewportWidth: number,
  viewportHeight: number,
  cellPixels = 52,
): DatabaseMapCluster[] {
  const width = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1);
  const height = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1);
  const size = Math.max(48, Math.min(160, Number(cellPixels) || 52));
  const buckets = new Map<string, DatabaseMapMarker[]>();
  for (const marker of markers) {
    if (!Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude)
      || marker.latitude < -90 || marker.latitude > 90 || marker.longitude < -180 || marker.longitude > 180) continue;
    const x = Math.min(width - Number.EPSILON, Math.max(0, (marker.longitude + 180) / 360 * width));
    const y = Math.min(height - Number.EPSILON, Math.max(0, (90 - marker.latitude) / 180 * height));
    const key = `${Math.floor(y / size)}:${Math.floor(x / size)}`;
    const bucket = buckets.get(key) ?? []; bucket.push(marker); buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => {
    const ordered = [...bucket].sort((left, right) => left.id.localeCompare(right.id));
    const [row, column] = key.split(':').map(Number);
    const x = Math.min(width, (column + .5) * size);
    const y = Math.min(height, (row + .5) * size);
    return {
      id: `viewport-cluster:${key}`,
      latitude: 90 - y / height * 180,
      longitude: x / width * 360 - 180,
      count: ordered.length,
      markerIds: ordered.map((marker) => marker.id),
    };
  }).sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}

export function escapeVisualizationXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

export function renderDatabaseChartSvg(title: string, points: DatabaseChartPoint[], type: DatabaseChartQuery['type'], width = 960, height = 540): string {
  const safeWidth = Math.max(320, Math.min(4096, Math.floor(width)));
  const safeHeight = Math.max(220, Math.min(2160, Math.floor(height)));
  const margin = { left: 72, right: 28, top: 58, bottom: 74 };
  const plotWidth = safeWidth - margin.left - margin.right; const plotHeight = safeHeight - margin.top - margin.bottom;
  const values = points.map((point) => Number.isFinite(point.value) ? point.value : 0);
  const min = type === 'scatter' ? Math.min(0, ...values) : 0; const max = Math.max(1, ...values);
  const palette = ['#4f46e5','#db2777','#059669','#d97706','#7c3aed','#0891b2','#dc2626','#65a30d'];
  const x = (index: number) => margin.left + (index + .5) * plotWidth / Math.max(1, points.length);
  const y = (value: number) => margin.top + plotHeight - (value - min) / Math.max(1e-9, max - min) * plotHeight;
  const labelStep = Math.max(1, Math.ceil(points.length / 12));
  const labels = points.map((point, index) => index % labelStep === 0
    ? `<text x="${x(index)}" y="${safeHeight - 34}" text-anchor="middle" font-size="11" fill="#52525b">${escapeVisualizationXml(point.label.slice(0, 24))}</text>` : '').join('');
  let marks = '';
  if (type === 'bar') {
    const barWidth = Math.max(2, plotWidth / Math.max(1, points.length) * .72);
    marks = points.map((point, index) => `<rect x="${x(index) - barWidth / 2}" y="${y(point.value)}" width="${barWidth}" height="${Math.max(1, margin.top + plotHeight - y(point.value))}" rx="3" fill="${palette[index % palette.length]}"><title>${escapeVisualizationXml(`${point.label}: ${point.value}`)}</title></rect>`).join('');
  } else if (type === 'donut') {
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1; let offset = 0;
    marks = points.map((point, index) => { const length = Math.max(0, point.value) / total * 100; const result = `<circle cx="${safeWidth / 2}" cy="${margin.top + plotHeight / 2}" r="${Math.min(plotWidth, plotHeight) * .32}" fill="none" stroke="${palette[index % palette.length]}" stroke-width="44" pathLength="100" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${safeWidth / 2} ${margin.top + plotHeight / 2})"><title>${escapeVisualizationXml(`${point.label}: ${point.value}`)}</title></circle>`; offset += length; return result; }).join('');
  } else {
    const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
    if (type === 'area') marks = `<polygon points="${margin.left},${margin.top + plotHeight} ${coordinates} ${margin.left + plotWidth},${margin.top + plotHeight}" fill="#4f46e533"/><polyline points="${coordinates}" fill="none" stroke="#4f46e5" stroke-width="3"/>`;
    else if (type === 'line') marks = `<polyline points="${coordinates}" fill="none" stroke="#4f46e5" stroke-width="3"/>`;
    marks += points.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="${type === 'scatter' ? 5 : 3}" fill="${palette[index % palette.length]}"><title>${escapeVisualizationXml(`${point.label}: ${point.value}`)}</title></circle>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="${escapeVisualizationXml(title)}"><rect width="100%" height="100%" fill="#fafafa"/><text x="${margin.left}" y="34" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#18181b">${escapeVisualizationXml(title)}</text><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#a1a1aa"/>${marks}${type === 'donut' ? '' : labels}</svg>`;
}
