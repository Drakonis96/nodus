/**
 * A minimal, safe chart spec the database chat/analysis can emit and the app renders
 * natively (no code execution). The model returns a fenced ```chart block with this
 * JSON; the renderer parses it out of the Markdown. Pure so parsing/validation is
 * unit-tested.
 */

export interface ChartSpecItem {
  label: string;
  value: number;
  color?: string | null;
}

export interface ChartSpec {
  type: 'bar' | 'pie';
  title?: string;
  items: ChartSpecItem[];
}

export function isChartSpec(v: unknown): v is ChartSpec {
  if (!v || typeof v !== 'object') return false;
  const s = v as ChartSpec;
  return (
    (s.type === 'bar' || s.type === 'pie') &&
    Array.isArray(s.items) &&
    s.items.every((it) => it && typeof it.label === 'string' && typeof it.value === 'number' && Number.isFinite(it.value))
  );
}

export type ChatSegment = { kind: 'md'; text: string } | { kind: 'chart'; spec: ChartSpec };

const CHART_BLOCK_RE = /```chart\s*\n([\s\S]*?)```/g;

/**
 * Split an assistant message into ordered segments: Markdown prose and any valid
 * ```chart blocks (invalid blocks are dropped). Preserves order so charts render
 * inline where the model placed them.
 */
export function parseChatSegments(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  CHART_BLOCK_RE.lastIndex = 0;
  while ((m = CHART_BLOCK_RE.exec(text))) {
    const before = text.slice(lastIndex, m.index);
    if (before.trim()) segments.push({ kind: 'md', text: before });
    let spec: unknown = null;
    try {
      spec = JSON.parse(m[1].trim());
    } catch {
      spec = null;
    }
    if (isChartSpec(spec)) segments.push({ kind: 'chart', spec });
    else if (m[0].trim()) segments.push({ kind: 'md', text: m[0] }); // keep unparseable block as text
    lastIndex = m.index + m[0].length;
  }
  const rest = text.slice(lastIndex);
  if (rest.trim()) segments.push({ kind: 'md', text: rest });
  if (segments.length === 0) segments.push({ kind: 'md', text });
  return segments;
}
