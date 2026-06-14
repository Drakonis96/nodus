export interface PerfContext {
  nodusId?: string | null;
  title?: string | null;
}

export type PerfMeta = Record<string, string | number | boolean | null | undefined>;

function shortTitle(title?: string | null): string {
  if (!title) return '';
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

function formatMeta(meta?: PerfMeta): string {
  if (!meta) return '';
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function perfLog(phase: string, durationMs: number, ctx: PerfContext = {}, meta?: PerfMeta): void {
  const target = [ctx.nodusId, shortTitle(ctx.title)].filter(Boolean).join(' ');
  const targetPart = target ? ` ${target}` : '';
  console.log(`[perf][deep] ${phase}${targetPart} ${Math.round(durationMs)}ms${formatMeta(meta)}`);
}

export function startPerf(phase: string, ctx: PerfContext = {}, meta?: PerfMeta): (extra?: PerfMeta) => void {
  const start = Date.now();
  let logged = false;
  return (extra?: PerfMeta) => {
    if (logged) return;
    logged = true;
    perfLog(phase, Date.now() - start, ctx, { ...meta, ...extra });
  };
}

export async function measurePerf<T>(
  phase: string,
  ctx: PerfContext,
  fn: () => Promise<T>,
  meta?: PerfMeta
): Promise<T> {
  const done = startPerf(phase, ctx, meta);
  try {
    const result = await fn();
    done();
    return result;
  } catch (e) {
    done({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
