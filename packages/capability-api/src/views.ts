import { LIMITS } from './limits';
import { SLUG, exactKeys, plainText } from './json';
import { isModelMimeType } from './models';
import { isAudioMimeType, isImageMimeType } from './media';

/** The only thing a worker may return for display. It is data, not markup: there is no
 *  HTML, no script, no CSS and no component reference anywhere in the tree, so a plugin
 *  cannot reach into the renderer even by accident. */

export type ViewTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ViewSpan {
  text: string;
  emphasis?: 'strong' | 'em' | 'code';
  /** Only https. Rendered as an external link, never auto-followed. */
  href?: string;
}

export type ViewNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; spans: ViewSpan[] }
  | { kind: 'list'; ordered?: boolean; items: ViewSpan[][] }
  | { kind: 'badges'; items: Array<{ label: string; tone?: ViewTone }> }
  | { kind: 'notice'; tone: ViewTone; title?: string; spans: ViewSpan[] }
  | { kind: 'svg'; svg: string; title: string; alt: string }
  | { kind: 'table'; caption?: string; columns: Array<{ label: string; align?: 'start' | 'end' }>; rows: Array<Array<string | number | null>> }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'links'; items: Array<{ href: string; label: string; description?: string }> }
  | { kind: 'details'; summary: string; children: ViewNode[] }
  | { kind: 'download'; attachmentId: string; label: string; name: string; mimeType: string; bytes: number }
  /** An interactive 3D model, drawn by the core viewer. The bytes were stored as an
   *  attachment and validated when the capability handed them over; this refers to them.
   *  `alt` is what a reader who cannot see it is told, and is not optional. */
  | { kind: 'model'; attachmentId: string; title: string; alt: string; name: string; mimeType: string; bytes: number }
  /** A raster the capability produced — a rendered plot, a frame, an export. Stored and
   *  checked like any other asset; the declared type must match the actual bytes. */
  | { kind: 'image'; attachmentId: string; title: string; alt: string; name: string; mimeType: string; bytes: number; width?: number; height?: number }
  /** Sound the capability produced or extracted. */
  | { kind: 'audio'; attachmentId: string; title: string; alt: string; name: string; mimeType: string; bytes: number }
  /** A formula. TeX in, rendered by the core; `alt` is what it says in words. */
  | { kind: 'math'; tex: string; display?: boolean; alt: string }
  /** Values, not a drawing: the capability states the data and the core draws it, so
   *  every chart in the application looks and behaves the same. */
  | { kind: 'chart'; chartType: ViewChartType; title: string; alt: string; xLabel?: string; yLabel?: string; series: ViewChartSeries[] }
  /** A hierarchy: a taxonomy, an ontology, a stemma, a classification. */
  | { kind: 'tree'; title?: string; alt: string; roots: ViewTreeItem[] }
  /** A text with labelled spans over it: entities, codings, uncertainties, clauses. */
  | { kind: 'passage'; title?: string; text: string; marks: ViewPassageMark[] }
  /** Two versions of a text, with the differences found by the core rather than
   *  described by the capability. */
  | { kind: 'comparison'; title?: string; before: { label: string; text: string }; after: { label: string; text: string }; granularity?: 'line' | 'word' }
  /** Geography. GeoJSON only, which has no mechanism for referring to anything outside
   *  itself — unlike every other spatial format, it is safe by construction. */
  | { kind: 'map'; title: string; alt: string; geojson: unknown; basemap?: boolean }
  /** Tiled imagery served over the IIIF Image API: a manuscript, a painting, a survey
   *  photograph. The tiles are fetched by the host from an origin the package was already
   *  permitted to reach, never by the page. */
  | { kind: 'imageTiles'; service: string; title: string; alt: string; width: number; height: number; tileSize?: number }
  | { kind: 'status'; state: 'ok' | 'pending' | 'failed'; label: string; description?: string };

export type ViewChartType = 'line' | 'bar' | 'area' | 'scatter';

export interface ViewChartSeries {
  label: string;
  /** `[x, y]` pairs. `x` may be a number or a category label; a series mixes neither. */
  points: Array<[number | string, number]>;
  tone?: ViewTone;
}

export interface ViewTreeItem {
  label: string;
  detail?: string;
  tone?: ViewTone;
  children?: ViewTreeItem[];
}

export interface ViewPassageMark {
  /** Character offsets into the passage text, half-open. Marks that overlap are allowed
   *  through — resolving them is a rendering decision, and the core makes it the same
   *  way for every package: the one that starts first wins the overlap. */
  start: number;
  end: number;
  label: string;
  tone?: ViewTone;
}

export interface ViewDocumentV1 {
  schemaVersion: 1;
  title?: string;
  /** Read by screen readers in place of the whole document when it is a drawing. */
  summary: string;
  nodes: ViewNode[];
}

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'];

function validateSpans(input: unknown, budget: { nodes: number }): ViewSpan[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new Error('Invalid view spans.');
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !exactKeys(raw, ['text', 'emphasis', 'href'])) throw new Error('Invalid view span.');
    const span = raw as ViewSpan;
    if (typeof span.text !== 'string' || !span.text.length || span.text.length > LIMITS.viewTextChars) throw new Error('Invalid view span text.');
    if (span.emphasis !== undefined && !['strong', 'em', 'code'].includes(span.emphasis)) throw new Error('Invalid view span emphasis.');
    if (span.href !== undefined) assertHttps(span.href);
    budget.nodes += 1;
    return structuredClone(span);
  });
}

const ATTACHMENT = /^[a-z0-9][a-z0-9-]{7,63}$/;

const safeFileName = (value: unknown) =>
  plainText(value, 200) && !String(value).includes('/') && !String(value).includes('\\') && !String(value).includes('..');

/** GeoJSON, and only GeoJSON.
 *
 *  It is the one spatial format with no way to name anything outside itself — no external
 *  buffers, no linked imagery, no styling that could fetch — so validating it is a matter
 *  of shape and size rather than of provenance. Everything the map draws is in this
 *  object. */
function validateGeoJson(input: unknown, budget: { nodes: number }): unknown {
  const counted = { features: 0, positions: 0 };

  const position = (value: unknown): void => {
    if (!Array.isArray(value) || value.length < 2 || value.length > 3) throw new Error('Invalid map position.');
    const [longitude, latitude, altitude] = value;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Invalid map position.');
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error('A map position is off the Earth.');
    if (altitude !== undefined && !Number.isFinite(altitude)) throw new Error('Invalid map position.');
    if (++counted.positions > LIMITS.geoPositions) throw new Error('The map has more points than the viewer will draw.');
  };

  const coordinates = (value: unknown, depth: number): void => {
    if (depth === 0) return position(value);
    if (!Array.isArray(value)) throw new Error('Invalid map coordinates.');
    for (const entry of value) coordinates(entry, depth - 1);
  };

  const geometry = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map geometry.');
    const shape = value as { type?: unknown; coordinates?: unknown; geometries?: unknown };
    const depths: Record<string, number> = {
      Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3,
    };
    if (shape.type === 'GeometryCollection') {
      if (!Array.isArray(shape.geometries) || shape.geometries.length > LIMITS.geoFeatures) throw new Error('Invalid map geometry collection.');
      for (const child of shape.geometries) geometry(child);
      return;
    }
    const depth = depths[String(shape.type)];
    if (depth === undefined) throw new Error(`Unsupported map geometry: ${String(shape.type)}.`);
    coordinates(shape.coordinates, depth);
  };

  const feature = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map feature.');
    const entry = value as { type?: unknown; geometry?: unknown; properties?: unknown };
    if (entry.type !== 'Feature') throw new Error('Invalid map feature.');
    if (++counted.features > LIMITS.geoFeatures) throw new Error('The map has more features than the viewer will draw.');
    if (entry.geometry !== null) geometry(entry.geometry);
    if (entry.properties !== undefined && entry.properties !== null) {
      if (typeof entry.properties !== 'object' || Array.isArray(entry.properties)) throw new Error('Invalid map feature properties.');
      // Properties are shown as text beside a shape, so they are held to the same rule as
      // any other text a capability supplies.
      for (const [key, property] of Object.entries(entry.properties as Record<string, unknown>)) {
        if (!plainText(key, 120)) throw new Error('Invalid map feature property.');
        if (property === null || typeof property === 'number' || typeof property === 'boolean') continue;
        if (!plainText(property, 2_000)) throw new Error('Invalid map feature property.');
      }
    }
  };

  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid map data.');
  const value = input as { type?: unknown; features?: unknown };
  if (value.type === 'FeatureCollection') {
    if (!Array.isArray(value.features) || !value.features.length) throw new Error('Invalid map data.');
    for (const entry of value.features) feature(entry);
  } else if (value.type === 'Feature') {
    feature(value);
  } else {
    geometry(value);
  }

  budget.nodes += counted.features;
  return structuredClone(input);
}

function assertHttps(href: unknown): void {
  let url: URL;
  try { url = new URL(String(href)); } catch { throw new Error('Invalid view link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('View links must be https.');
}

function validateNode(input: unknown, budget: { nodes: number }, depth: number): ViewNode {
  if (++budget.nodes > LIMITS.viewNodes) throw new Error('View document is too large.');
  if (depth > LIMITS.viewDepth) throw new Error('View document is too deeply nested.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid view node.');
  const node = input as ViewNode;
  switch (node.kind) {
    case 'heading':
      if (!exactKeys(node, ['kind', 'level', 'text']) || ![1, 2, 3, 4].includes(node.level) || !plainText(node.text, 300)) throw new Error('Invalid view heading.');
      return { kind: 'heading', level: node.level, text: node.text };
    case 'paragraph':
      if (!exactKeys(node, ['kind', 'spans'])) throw new Error('Invalid view paragraph.');
      return { kind: 'paragraph', spans: validateSpans(node.spans, budget) };
    case 'list':
      if (!exactKeys(node, ['kind', 'ordered', 'items']) && !exactKeys(node, ['kind', 'items'])) throw new Error('Invalid view list.');
      if (!Array.isArray(node.items) || !node.items.length || node.items.length > 200) throw new Error('Invalid view list items.');
      return { kind: 'list', ...(node.ordered ? { ordered: true } : {}), items: node.items.map(item => validateSpans(item, budget)) };
    case 'badges':
      if (!exactKeys(node, ['kind', 'items']) || !Array.isArray(node.items) || !node.items.length || node.items.length > 40) throw new Error('Invalid view badges.');
      return { kind: 'badges', items: node.items.map(item => {
        if (!item || !exactKeys(item, ['label', 'tone']) && !exactKeys(item, ['label'])) throw new Error('Invalid view badge.');
        if (!plainText(item.label, 80) || (item.tone !== undefined && !TONES.includes(item.tone))) throw new Error('Invalid view badge.');
        return structuredClone(item);
      }) };
    case 'notice':
      if (!exactKeys(node, ['kind', 'tone', 'title', 'spans']) && !exactKeys(node, ['kind', 'tone', 'spans'])) throw new Error('Invalid view notice.');
      if (!TONES.includes(node.tone) || (node.title !== undefined && !plainText(node.title, 200))) throw new Error('Invalid view notice.');
      return { kind: 'notice', tone: node.tone, ...(node.title ? { title: node.title } : {}), spans: validateSpans(node.spans, budget) };
    case 'svg':
      // Accepted as a string only. The core sanitizer is still the thing that decides
      // what reaches the DOM; this check only bounds it and keeps the contract honest.
      if (!exactKeys(node, ['kind', 'svg', 'title', 'alt']) || typeof node.svg !== 'string'
        || !node.svg.trim().startsWith('<svg') || node.svg.length > LIMITS.viewSvgChars
        || !plainText(node.title, 200) || !plainText(node.alt, 1_000)) throw new Error('Invalid view svg.');
      return { kind: 'svg', svg: node.svg, title: node.title, alt: node.alt };
    case 'table': {
      if (!exactKeys(node, ['kind', 'caption', 'columns', 'rows']) && !exactKeys(node, ['kind', 'columns', 'rows'])) throw new Error('Invalid view table.');
      if (!Array.isArray(node.columns) || !node.columns.length || node.columns.length > LIMITS.viewTableColumns
        || !Array.isArray(node.rows) || node.rows.length > LIMITS.viewTableRows
        || (node.caption !== undefined && !plainText(node.caption, 300))) throw new Error('Invalid view table.');
      for (const column of node.columns) {
        if (!column || !exactKeys(column, ['label', 'align']) && !exactKeys(column, ['label'])
          || !plainText(column.label, 120) || (column.align !== undefined && !['start', 'end'].includes(column.align))) throw new Error('Invalid view table column.');
      }
      for (const row of node.rows) {
        if (!Array.isArray(row) || row.length !== node.columns.length
          || row.some(cell => cell !== null && typeof cell !== 'number' && (typeof cell !== 'string' || cell.length > 2_000))) throw new Error('Invalid view table row.');
      }
      budget.nodes += node.rows.length;
      if (budget.nodes > LIMITS.viewNodes + LIMITS.viewTableRows) throw new Error('View document is too large.');
      return structuredClone(node);
    }
    case 'code':
      if (!exactKeys(node, ['kind', 'language', 'text']) && !exactKeys(node, ['kind', 'text'])) throw new Error('Invalid view code block.');
      if (typeof node.text !== 'string' || !node.text.length || node.text.length > LIMITS.viewTextChars
        || (node.language !== undefined && !SLUG.test(node.language))) throw new Error('Invalid view code block.');
      return structuredClone(node);
    case 'links':
      if (!exactKeys(node, ['kind', 'items']) || !Array.isArray(node.items) || !node.items.length || node.items.length > 200) throw new Error('Invalid view links.');
      return { kind: 'links', items: node.items.map(item => {
        if (!item || !exactKeys(item, ['href', 'label', 'description']) && !exactKeys(item, ['href', 'label'])) throw new Error('Invalid view link.');
        assertHttps(item.href);
        if (!plainText(item.label, 300) || (item.description !== undefined && !plainText(item.description, 500))) throw new Error('Invalid view link.');
        return structuredClone(item);
      }) };
    case 'details':
      if (!exactKeys(node, ['kind', 'summary', 'children']) || !plainText(node.summary, 300)
        || !Array.isArray(node.children) || !node.children.length) throw new Error('Invalid view details block.');
      return { kind: 'details', summary: node.summary, children: node.children.map(child => validateNode(child, budget, depth + 1)) };
    case 'download':
      // Bytes are never inline: the worker stored an attachment first and refers to it.
      if (!exactKeys(node, ['kind', 'attachmentId', 'label', 'name', 'mimeType', 'bytes'])
        || !ATTACHMENT.test(String(node.attachmentId)) || !plainText(node.label, 200)
        || !safeFileName(node.name)
        || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(String(node.mimeType))
        || !Number.isInteger(node.bytes) || node.bytes < 0) throw new Error('Invalid view download.');
      return structuredClone(node);
    case 'model':
      // Same rule as a download: bytes are never inline. What is different is that the
      // core will open this one, so the format it claims has to be one the core opens.
      if (!exactKeys(node, ['kind', 'attachmentId', 'title', 'alt', 'name', 'mimeType', 'bytes'])
        || !ATTACHMENT.test(String(node.attachmentId)) || !plainText(node.title, 200)
        || !plainText(node.alt, 1_000) || !safeFileName(node.name)
        || !isModelMimeType(node.mimeType)
        || !Number.isInteger(node.bytes) || node.bytes < 1 || node.bytes > LIMITS.modelBytes) throw new Error('Invalid view model.');
      return structuredClone(node);
    case 'image':
      if (!exactKeys(node, ['kind', 'attachmentId', 'title', 'alt', 'name', 'mimeType', 'bytes', 'width', 'height'])
        && !exactKeys(node, ['kind', 'attachmentId', 'title', 'alt', 'name', 'mimeType', 'bytes'])) throw new Error('Invalid view image.');
      if (!ATTACHMENT.test(String(node.attachmentId)) || !plainText(node.title, 200) || !plainText(node.alt, 1_000)
        || !safeFileName(node.name) || !isImageMimeType(node.mimeType)
        || !Number.isInteger(node.bytes) || node.bytes < 1 || node.bytes > LIMITS.imageBytes
        || (node.width !== undefined && (!Number.isInteger(node.width) || node.width < 1 || node.width > 100_000))
        || (node.height !== undefined && (!Number.isInteger(node.height) || node.height < 1 || node.height > 100_000))) throw new Error('Invalid view image.');
      return structuredClone(node);

    case 'audio':
      if (!exactKeys(node, ['kind', 'attachmentId', 'title', 'alt', 'name', 'mimeType', 'bytes'])
        || !ATTACHMENT.test(String(node.attachmentId)) || !plainText(node.title, 200) || !plainText(node.alt, 1_000)
        || !safeFileName(node.name) || !isAudioMimeType(node.mimeType)
        || !Number.isInteger(node.bytes) || node.bytes < 1 || node.bytes > LIMITS.audioBytes) throw new Error('Invalid view audio.');
      return structuredClone(node);

    case 'math':
      // TeX is data here, not markup: the core's renderer decides what it draws, and it
      // is given no way to reach a macro, a file or a script.
      if (!exactKeys(node, ['kind', 'tex', 'display', 'alt']) && !exactKeys(node, ['kind', 'tex', 'alt'])) throw new Error('Invalid view formula.');
      if (typeof node.tex !== 'string' || !node.tex.trim() || node.tex.length > LIMITS.mathChars
        || !plainText(node.alt, 1_000)
        || (node.display !== undefined && typeof node.display !== 'boolean')) throw new Error('Invalid view formula.');
      return structuredClone(node);

    case 'chart': {
      if (!exactKeys(node, ['kind', 'chartType', 'title', 'alt', 'xLabel', 'yLabel', 'series'])
        && !exactKeys(node, ['kind', 'chartType', 'title', 'alt', 'series'])) throw new Error('Invalid view chart.');
      if (!['line', 'bar', 'area', 'scatter'].includes(node.chartType) || !plainText(node.title, 200) || !plainText(node.alt, 1_000)
        || (node.xLabel !== undefined && !plainText(node.xLabel, 120))
        || (node.yLabel !== undefined && !plainText(node.yLabel, 120))
        || !Array.isArray(node.series) || !node.series.length || node.series.length > LIMITS.chartSeries) throw new Error('Invalid view chart.');
      let points = 0;
      for (const series of node.series) {
        if (!series || !exactKeys(series, ['label', 'points', 'tone']) && !exactKeys(series, ['label', 'points'])
          || !plainText(series.label, 120) || (series.tone !== undefined && !TONES.includes(series.tone))
          || !Array.isArray(series.points) || !series.points.length) throw new Error('Invalid chart series.');
        points += series.points.length;
        if (points > LIMITS.chartPoints) throw new Error('The chart has more points than the viewer will draw.');
        // One kind of x per series: a chart that mixed categories and numbers would have
        // no honest axis.
        const categorical = typeof series.points[0][0] === 'string';
        for (const point of series.points) {
          if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid chart point.');
          const [x, y] = point;
          if (categorical ? !plainText(x, 120) : !Number.isFinite(x)) throw new Error('Invalid chart point.');
          if (!Number.isFinite(y)) throw new Error('Invalid chart point.');
        }
      }
      budget.nodes += points;
      return structuredClone(node);
    }

    case 'tree': {
      if (!exactKeys(node, ['kind', 'title', 'alt', 'roots']) && !exactKeys(node, ['kind', 'alt', 'roots'])) throw new Error('Invalid view tree.');
      if ((node.title !== undefined && !plainText(node.title, 200)) || !plainText(node.alt, 1_000)
        || !Array.isArray(node.roots) || !node.roots.length) throw new Error('Invalid view tree.');
      const counted = { items: 0 };
      const walkTree = (items: unknown, level: number): ViewTreeItem[] => {
        if (!Array.isArray(items) || items.length > LIMITS.treeNodes) throw new Error('Invalid view tree.');
        if (level > LIMITS.treeDepth) throw new Error('The tree is deeper than the viewer will draw.');
        return items.map(raw => {
          if (++counted.items > LIMITS.treeNodes) throw new Error('The tree has more entries than the viewer will draw.');
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid tree entry.');
          const item = raw as ViewTreeItem;
          if (!exactKeys(item, ['label', 'detail', 'tone', 'children']) && !exactKeys(item, ['label', 'detail', 'children'])
            && !exactKeys(item, ['label', 'tone', 'children']) && !exactKeys(item, ['label', 'children'])
            && !exactKeys(item, ['label', 'detail', 'tone']) && !exactKeys(item, ['label', 'detail'])
            && !exactKeys(item, ['label', 'tone']) && !exactKeys(item, ['label'])) throw new Error('Invalid tree entry.');
          if (!plainText(item.label, 300) || (item.detail !== undefined && !plainText(item.detail, 500))
            || (item.tone !== undefined && !TONES.includes(item.tone))) throw new Error('Invalid tree entry.');
          return {
            label: item.label,
            ...(item.detail !== undefined ? { detail: item.detail } : {}),
            ...(item.tone !== undefined ? { tone: item.tone } : {}),
            ...(item.children !== undefined ? { children: walkTree(item.children, level + 1) } : {}),
          };
        });
      };
      const roots = walkTree(node.roots, 1);
      budget.nodes += counted.items;
      return { kind: 'tree', ...(node.title !== undefined ? { title: node.title } : {}), alt: node.alt, roots };
    }

    case 'passage': {
      if (!exactKeys(node, ['kind', 'title', 'text', 'marks']) && !exactKeys(node, ['kind', 'text', 'marks'])) throw new Error('Invalid view passage.');
      if ((node.title !== undefined && !plainText(node.title, 200))
        || typeof node.text !== 'string' || !node.text.length || node.text.length > LIMITS.passageChars
        || !Array.isArray(node.marks) || node.marks.length > LIMITS.passageMarks) throw new Error('Invalid view passage.');
      const marks = node.marks.map(raw => {
        if (!raw || !exactKeys(raw, ['start', 'end', 'label', 'tone']) && !exactKeys(raw, ['start', 'end', 'label'])) throw new Error('Invalid passage mark.');
        const mark = raw as ViewPassageMark;
        // Offsets into the text this node carries, and nowhere else: a mark that ran past
        // the end would either be dropped silently or read something that is not there.
        if (!Number.isInteger(mark.start) || !Number.isInteger(mark.end) || mark.start < 0
          || mark.end <= mark.start || mark.end > node.text.length
          || !plainText(mark.label, 120) || (mark.tone !== undefined && !TONES.includes(mark.tone))) throw new Error('Invalid passage mark.');
        return structuredClone(mark);
      });
      budget.nodes += marks.length;
      return { kind: 'passage', ...(node.title !== undefined ? { title: node.title } : {}), text: node.text, marks };
    }

    case 'comparison': {
      if (!exactKeys(node, ['kind', 'title', 'before', 'after', 'granularity'])
        && !exactKeys(node, ['kind', 'before', 'after', 'granularity'])
        && !exactKeys(node, ['kind', 'title', 'before', 'after'])
        && !exactKeys(node, ['kind', 'before', 'after'])) throw new Error('Invalid view comparison.');
      if (node.title !== undefined && !plainText(node.title, 200)) throw new Error('Invalid view comparison.');
      if (node.granularity !== undefined && !['line', 'word'].includes(node.granularity)) throw new Error('Invalid view comparison.');
      for (const side of [node.before, node.after]) {
        if (!side || !exactKeys(side, ['label', 'text']) || !plainText(side.label, 120)
          || typeof side.text !== 'string' || side.text.length > LIMITS.comparisonChars) throw new Error('Invalid comparison side.');
      }
      return structuredClone(node);
    }

    case 'map':
      if (!exactKeys(node, ['kind', 'title', 'alt', 'geojson', 'basemap']) && !exactKeys(node, ['kind', 'title', 'alt', 'geojson'])) throw new Error('Invalid view map.');
      if (!plainText(node.title, 200) || !plainText(node.alt, 1_000)
        || (node.basemap !== undefined && typeof node.basemap !== 'boolean')) throw new Error('Invalid view map.');
      return { ...structuredClone(node), geojson: validateGeoJson(node.geojson, budget) };

    case 'imageTiles':
      if (!exactKeys(node, ['kind', 'service', 'title', 'alt', 'width', 'height', 'tileSize'])
        && !exactKeys(node, ['kind', 'service', 'title', 'alt', 'width', 'height'])) throw new Error('Invalid view tiled image.');
      assertHttps(node.service);
      if (!plainText(node.title, 200) || !plainText(node.alt, 1_000)
        || !Number.isInteger(node.width) || node.width < 1 || node.width > 2_000_000
        || !Number.isInteger(node.height) || node.height < 1 || node.height > 2_000_000
        || (node.tileSize !== undefined && (!Number.isInteger(node.tileSize) || node.tileSize < 64 || node.tileSize > LIMITS.tilePixels))) throw new Error('Invalid view tiled image.');
      // A query or a fragment on a IIIF service base is either a mistake or an attempt to
      // smuggle something onto the end of every tile request built from it.
      if (/[?#]/.test(String(node.service))) throw new Error('A tiled image service takes no query or fragment.');
      return structuredClone(node);

    case 'status':
      if (!exactKeys(node, ['kind', 'state', 'label', 'description']) && !exactKeys(node, ['kind', 'state', 'label'])) throw new Error('Invalid view status.');
      if (!['ok', 'pending', 'failed'].includes(node.state) || !plainText(node.label, 200)
        || (node.description !== undefined && !plainText(node.description, 500))) throw new Error('Invalid view status.');
      return structuredClone(node);
    default:
      throw new Error('Unsupported view node.');
  }
}

export function validateViewDocument(input: unknown): ViewDocumentV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'title', 'summary', 'nodes']) && !exactKeys(input, ['schemaVersion', 'summary', 'nodes'])) throw new Error('Invalid view document.');
  const value = input as ViewDocumentV1;
  if (value.schemaVersion !== 1 || !plainText(value.summary, 1_000)
    || (value.title !== undefined && !plainText(value.title, 300))
    || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error('Invalid view document.');
  const budget = { nodes: 0 };
  return {
    schemaVersion: 1,
    ...(value.title ? { title: value.title } : {}),
    summary: value.summary,
    nodes: value.nodes.map(node => validateNode(node, budget, 0)),
  };
}

/** Plain-text reading of a view, used for accessibility fallbacks and for the projection
 *  a capability may hand back to the model. Drawings contribute their alt text, not markup. */
const treeToText = (items: ViewTreeItem[], level: number): string[] =>
  items.flatMap(item => [
    `${'  '.repeat(level)}- ${[item.label, item.detail].filter(Boolean).join(' — ')}`,
    ...treeToText(item.children ?? [], level + 1),
  ]);

export function viewToText(document: ViewDocumentV1): string {
  const spans = (items: ViewSpan[]) => items.map(span => span.text).join('');
  const walk = (nodes: ViewNode[]): string[] => nodes.flatMap(node => {
    switch (node.kind) {
      case 'heading': return [`${'#'.repeat(node.level)} ${node.text}`];
      case 'paragraph': return [spans(node.spans)];
      case 'list': return node.items.map((item, index) => `${node.ordered ? `${index + 1}.` : '-'} ${spans(item)}`);
      case 'badges': return [node.items.map(item => item.label).join(' · ')];
      case 'notice': return [[node.title, spans(node.spans)].filter(Boolean).join(': ')];
      case 'svg': return [`[${node.title}] ${node.alt}`];
      case 'table': return [node.columns.map(column => column.label).join(' | '), ...node.rows.map(row => row.map(cell => cell ?? '').join(' | '))];
      case 'code': return [node.text];
      case 'links': return node.items.map(item => `${item.label}: ${item.href}`);
      case 'details': return [node.summary, ...walk(node.children)];
      case 'download': return [`${node.label} (${node.name}, ${node.bytes} bytes)`];
      case 'model': return [`[${node.title}] ${node.alt}`];
      case 'image': return [`[${node.title}] ${node.alt}`];
      case 'audio': return [`[${node.title}] ${node.alt}`];
      case 'math': return [node.alt];
      case 'chart': return [`[${node.title}] ${node.alt}`, ...node.series.map(series => `${series.label}: ${series.points.map(([x, y]) => `${x}=${y}`).join(', ')}`)];
      case 'tree': return [...(node.title ? [node.title] : []), ...treeToText(node.roots, 0)];
      // The marks are what the passage is for, so they are named alongside what they
      // cover rather than dropped in favour of the raw text.
      case 'passage': return [...(node.title ? [node.title] : []), node.text,
        ...node.marks.map(mark => `${mark.label}: ${node.text.slice(mark.start, mark.end)}`)];
      case 'comparison': return [...(node.title ? [node.title] : []), `${node.before.label}:`, node.before.text, `${node.after.label}:`, node.after.text];
      case 'map': return [`[${node.title}] ${node.alt}`];
      case 'imageTiles': return [`[${node.title}] ${node.alt}`];
      case 'status': return [[node.label, node.description].filter(Boolean).join(' — ')];
    }
  });
  return [document.title, ...walk(document.nodes)].filter(Boolean).join('\n');
}
