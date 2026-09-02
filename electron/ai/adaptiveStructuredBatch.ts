export interface AdaptiveBatchContext {
  splitDepth: number;
  /** Text clip selected only after a single item cannot fit normally. */
  textLimit: 2000 | 1200 | 600;
}

export interface AdaptiveBatchOptions<TItem, TResult> {
  items: TItem[];
  initialBatchSize: number;
  execute: (batch: TItem[], context: AdaptiveBatchContext) => Promise<TResult>;
  combine: (parts: TResult[]) => TResult;
  maxSplitDepth?: number;
  maxLeaves?: number;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function recoverable(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
  if (code === 'output_truncated' || code === 'invalid_json' || code === 'context_overflow' || code === 'timeout') return true;
  return /context|json|schema|esquema|truncad|límite de salida|maximum context/i.test(error instanceof Error ? error.message : String(error));
}

/** Execute structured items fail-closed. A root batch is never published until all
 * of its children validate; a one-item payload gets two bounded clipping attempts. */
export async function adaptiveStructuredBatch<TItem, TResult>(
  options: AdaptiveBatchOptions<TItem, TResult>,
): Promise<TResult> {
  const maxDepth = options.maxSplitDepth ?? 6;
  const maxLeaves = options.maxLeaves ?? 64;
  let leaves = 0;

  const visit = async (batch: TItem[], splitDepth: number, textLimit: 2000 | 1200 | 600): Promise<TResult> => {
    try {
      const result = await options.execute(batch, { splitDepth, textLimit });
      leaves += 1;
      if (leaves > maxLeaves) throw new Error(`La validación estructurada superó ${maxLeaves} sublotes.`);
      return result;
    } catch (error) {
      if (!recoverable(error)) throw error;
      const errorCode = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
      const timeoutDepth = errorCode === 'timeout' ? 1 : maxDepth;
      if (batch.length > 1 && splitDepth < timeoutDepth) {
        const middle = Math.ceil(batch.length / 2);
        const left = await visit(batch.slice(0, middle), splitDepth + 1, textLimit);
        const right = await visit(batch.slice(middle), splitDepth + 1, textLimit);
        return options.combine([left, right]);
      }
      if (batch.length === 1 && textLimit !== 600) {
        return visit(batch, splitDepth + 1, textLimit === 2000 ? 1200 : 600);
      }
      throw error;
    }
  };

  const roots = chunks(options.items, Math.max(1, options.initialBatchSize));
  const results: TResult[] = [];
  for (const root of roots) results.push(await visit(root, 0, 2000));
  return options.combine(results);
}
