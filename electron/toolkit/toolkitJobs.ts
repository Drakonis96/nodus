// Nodus Toolkit — the job engine. Deliberately Electron-free (like databasesRepo):
// it takes an operation registry and a request, runs every input through the op,
// and owns the parts that must never go wrong regardless of the operation:
//
//   • Output naming — never overwrite an original or a file this job just wrote;
//     collisions get an incremental " (2)", " (3)" suffix.
//   • Atomic writes — write to a temp file, then rename into place, so a crash or
//     cancellation never leaves a half-written output.
//   • Cancellation — cooperative, checked between files and (via the context) between
//     pages; a cancelled file leaves no `.tmp` behind and stops the batch.
//   • Error isolation — one failing input is recorded and the batch continues.
//   • Progress — a monotonic snapshot pushed after every state change.
//
// Because it is Electron-free it is unit-tested directly (scripts/test-toolkit-jobs.mjs)
// with fake operations; the real IPC layer in electron/ipc.ts wraps it and forwards
// progress to the renderer.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type {
  ToolkitJobRequest,
  ToolkitJobResult,
  ToolkitJobProgress,
  ToolkitFileProgress,
  ToolkitOpId,
  ToolkitProduced,
} from '@shared/toolkitTypes';
import { toolkitOp } from '@shared/toolkitTypes';
import { buildZip, type ZipEntry } from './zip';

/** Cooperative cancellation flag; ops read `cancelled` between units of work. */
export interface ToolkitSignal {
  cancelled: boolean;
}

export interface ToolkitRunContext {
  request: ToolkitJobRequest;
  outputFormat: string | null;
  options: Record<string, string | number | boolean>;
  signal: ToolkitSignal;
  /** Report within-file progress 0..1 (or null when unknown). */
  onPageProgress: (pct: number | null) => void;
}

export interface ToolkitOpImpl {
  arity: 'each' | 'merge';
  /** For `each`, `inputs` holds a single path; for `merge`, all of them. */
  run: (inputs: string[], ctx: ToolkitRunContext) => Promise<ToolkitProduced[]>;
}

export type ToolkitOpRegistry = Partial<Record<ToolkitOpId, ToolkitOpImpl>>;

export interface RunJobOptions {
  signal?: ToolkitSignal;
  onProgress?: (progress: ToolkitJobProgress) => void;
}

class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

function baseNameNoExt(filePath: string): string {
  const base = path.basename(filePath);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function sanitizeBaseName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'salida';
}

/**
 * Resolve a non-colliding absolute output path. `taken` holds paths already
 * produced by this same job (not yet necessarily on disk when merge/perPage runs
 * fast), so two outputs in one batch never race onto the same name.
 */
function resolveOutputPath(
  dir: string,
  baseName: string,
  suffix: string,
  ext: string,
  taken: Set<string>,
): string {
  const safeBase = sanitizeBaseName(baseName) + suffix;
  const candidate = (n: number): string => {
    const stem = n <= 1 ? safeBase : `${safeBase} (${n})`;
    return path.join(dir, `${stem}.${ext}`);
  };
  let n = 1;
  let out = candidate(n);
  while (taken.has(out) || fs.existsSync(out)) {
    n += 1;
    out = candidate(n);
  }
  taken.add(out);
  return out;
}

/** Non-colliding entry name within a zip (in-memory namespace, no disk check). */
function resolveEntryName(baseName: string, suffix: string, ext: string, taken: Set<string>): string {
  const safeBase = sanitizeBaseName(baseName) + suffix;
  const candidate = (n: number): string => `${n <= 1 ? safeBase : `${safeBase} (${n})`}.${ext}`;
  let n = 1;
  let name = candidate(n);
  while (taken.has(name)) name = candidate(++n);
  taken.add(name);
  return name;
}

/** Write bytes to a sibling temp file, then rename into place (atomic on same fs). */
function writeAtomic(targetPath: string, data: Uint8Array): void {
  const tmp = `${targetPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one toolkit job to completion. Never throws for per-file failures — those
 * are captured on the file's result — but does reject if the request itself is
 * invalid (unknown operation, too few inputs).
 */
export async function runToolkitJob(
  jobId: string,
  request: ToolkitJobRequest,
  registry: ToolkitOpRegistry,
  options: RunJobOptions = {},
): Promise<ToolkitJobResult> {
  const signal: ToolkitSignal = options.signal ?? { cancelled: false };
  const spec = toolkitOp(request.opId);
  const impl = registry[request.opId];
  if (!spec || !impl) throw new Error(`Operación desconocida: ${request.opId}`);
  if (request.inputPaths.length < (spec.minInputs ?? 1)) {
    throw new Error('No hay suficientes archivos para esta operación.');
  }

  const outputExt = (spec.outputs.find((o) => o.format === request.outputFormat) ?? spec.outputs[0]).ext;

  const files: ToolkitFileProgress[] = request.inputPaths.map((inputPath) => ({
    inputPath,
    status: 'pending',
    pct: null,
    outputPaths: [],
    error: null,
  }));

  let activeIndex = -1;
  let done = 0;
  const total = files.length;
  const emit = (finished = false): void => {
    options.onProgress?.({
      jobId,
      files: files.map((f) => ({ ...f, outputPaths: [...f.outputPaths] })),
      activeIndex,
      done,
      total,
      cancelled: signal.cancelled,
      finished,
    });
  };
  emit();

  const outputDirFor = (inputPath: string): string => request.outputDir || path.dirname(inputPath);

  const makeCtx = (index: number): ToolkitRunContext => ({
    request,
    outputFormat: request.outputFormat,
    options: request.options,
    signal,
    onPageProgress: (pct) => {
      files[index].pct = pct;
      emit();
    },
  });

  // Operations produce in-memory outputs; the engine materialises them at the end,
  // either as loose files or packaged into a single zip. Collect them alongside the
  // identity (destination dir + fallback base name) the naming will need.
  interface Pending {
    fileIndex: number;
    dir: string;
    base: string;
    out: ToolkitProduced;
  }
  const pending: Pending[] = [];
  const contributed = new Set<number>();
  const collect = (produced: ToolkitProduced[], fileIndex: number, dir: string, base: string): void => {
    for (const out of produced) {
      pending.push({ fileIndex, dir, base, out });
      contributed.add(fileIndex);
    }
  };

  if (impl.arity === 'merge') {
    // One logical unit → one (or a few) named outputs. Attribute them to file 0;
    // the rest are marked done for progress. Any failure fails every input.
    activeIndex = 0;
    for (const f of files) f.status = 'processing';
    emit();
    try {
      if (signal.cancelled) throw new CancelledError();
      const produced = await impl.run(request.inputPaths, makeCtx(0));
      if (signal.cancelled) throw new CancelledError();
      collect(produced, 0, outputDirFor(request.inputPaths[0]), request.mergedName?.trim() || baseNameNoExt(request.inputPaths[0]));
      for (const f of files) {
        f.status = 'done';
        f.pct = 1;
      }
      done = total;
    } catch (error) {
      const cancelled = signal.cancelled || error instanceof CancelledError;
      for (const f of files) {
        f.status = cancelled ? 'cancelled' : 'error';
        f.error = cancelled ? null : errorMessage(error);
      }
    }
  } else {
    // arity === 'each': one run per input, error-isolated.
    for (let i = 0; i < files.length; i++) {
      if (signal.cancelled) {
        files[i].status = 'cancelled';
        continue;
      }
      activeIndex = i;
      files[i].status = 'processing';
      files[i].pct = null;
      emit();
      try {
        const produced = await impl.run([files[i].inputPath], makeCtx(i));
        if (signal.cancelled) {
          files[i].status = 'cancelled';
          files[i].pct = null;
          continue;
        }
        collect(produced, i, outputDirFor(files[i].inputPath), baseNameNoExt(files[i].inputPath));
        files[i].status = 'done';
        files[i].pct = 1;
        done += 1;
      } catch (error) {
        if (signal.cancelled || error instanceof CancelledError) {
          files[i].status = 'cancelled';
          files[i].pct = null;
        } else {
          files[i].status = 'error';
          files[i].error = errorMessage(error);
        }
      }
      emit();
    }
  }
  activeIndex = -1;

  // Materialise the collected outputs: one zip, or loose files.
  let zipPath: string | null = null;
  if (request.zipOutput && pending.length > 0) {
    const takenNames = new Set<string>();
    const entries: ZipEntry[] = pending.map((p) => ({
      name: resolveEntryName(p.out.suggestedBaseName ?? p.base, p.out.suffix ?? '', p.out.ext || outputExt, takenNames),
      data: p.out.data,
    }));
    const zipDir = request.outputDir || path.dirname(request.inputPaths[0]);
    const zipBase = request.zipName?.trim() || (request.inputPaths.length === 1 ? baseNameNoExt(request.inputPaths[0]) : 'nodus-convert');
    zipPath = resolveOutputPath(zipDir, zipBase, '', 'zip', new Set());
    writeAtomic(zipPath, buildZip(entries));
    for (const idx of contributed) files[idx].outputPaths = [zipPath];
  } else {
    const takenPaths = new Set<string>();
    for (const p of pending) {
      const target = resolveOutputPath(p.dir, p.out.suggestedBaseName ?? p.base, p.out.suffix ?? '', p.out.ext || outputExt, takenPaths);
      writeAtomic(target, p.out.data);
      files[p.fileIndex].outputPaths.push(target);
    }
  }

  emit(true);
  return { jobId, files, cancelled: signal.cancelled, zipPath };
}

/** Convenience for tests and one-off callers that just want a temp directory. */
export function makeToolkitTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-toolkit-'));
}
