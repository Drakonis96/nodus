// Nodus Convert — the batch file-conversion workspace.
//
// The page leads with what it accepts: a dropzone and the catalogue of supported
// formats, grouped by family. Once files are in, it answers with everything it
// can do with *those* files, in a single searchable menu split by category —
// instead of asking the user to guess a category first. The job runs in main and
// streams progress here; it survives navigation via the shared background-jobs
// store (TOOLKIT_JOB_KEY), so leaving and returning re-attaches.
//
// The operation menu is portaled to document.body because the app shell's <main>
// is overflow-hidden and would clip an inline popover (the Databases in-cell
// dropdown landmine). The remaining <select> elements stay native on purpose:
// their popups are rendered by the OS and are never clipped either.
import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/ui';
import { t, tr, tx } from '../i18n';
import {
  TOOLKIT_CATEGORIES,
  TOOLKIT_OPS,
  defaultOptions,
  fileExtLower,
  jobCurrentFile,
  jobOverallProgress,
  opsForInputs,
  type ToolkitJobProgress,
  type ToolkitOp,
  type ToolkitOpId,
  type ToolkitOptionField,
} from '@shared/toolkitTypes';
import type { ToolkitFileProgress, ToolkitJobRequest, ToolkitJobResult } from '@shared/types';
import {
  TOOLKIT_JOB_KEY,
  clearBackgroundJob,
  getBackgroundJob,
  startToolkitJob,
  subscribeBackgroundJob,
  type ToolkitConvertJob,
} from '../backgroundJobs';

type OptionValue = string | number | boolean;

function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

/** Accent- and case-insensitive haystack, so "imagenes" matches "Imágenes". */
function norm(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Every extension any operation accepts — seeds the native file picker. */
const ALL_INPUT_EXTS = [...new Set(TOOLKIT_OPS.flatMap((op) => op.inputExts))].sort();

/** What the converter accepts, per family, for the "supported formats" panel.
 *  `anyFile` marks a family that also has an operation accepting any file at all
 *  (checksums), which no extension list can express. */
const FORMAT_GROUPS = TOOLKIT_CATEGORIES.map((category) => {
  const ops = TOOLKIT_OPS.filter((op) => op.category === category.id);
  return {
    id: category.id,
    label: category.label,
    exts: [...new Set(ops.flatMap((op) => op.inputExts))].sort(),
    anyFile: ops.some((op) => op.inputExts.length === 0),
  };
});

/**
 * Viewport coordinates for a menu anchored under `ref`, flipping above when there
 * is no room below. Deliberately local rather than dbGrid's equivalent: that
 * module pulls the Markdown renderer into whatever imports it, and this view is
 * lazily loaded precisely to stay small.
 */
function useAnchoredMenu(open: boolean, ref: RefObject<HTMLElement | null>) {
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const compute = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 300);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const flip = below < 220 && above > below;
      const maxHeight = Math.max(180, Math.min(460, flip ? above : below));
      setCoords({ top: flip ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6, left, width, maxHeight });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, ref]);
  return coords;
}

function StatusPill({ status }: { status: ToolkitFileProgress['status'] }) {
  const map: Record<ToolkitFileProgress['status'], { label: string; cls: string }> = {
    pending: { label: t('Pendiente'), cls: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' },
    processing: { label: t('Procesando'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
    done: { label: t('Hecho'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
    error: { label: t('Error'), cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
    cancelled: { label: t('Cancelado'), cls: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' },
  };
  const { label, cls } = map[status];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

/** The catalogue of accepted inputs, shown before any file is added (and again
 *  when the added files match nothing) so the dropzone is never a blind guess. */
function SupportedFormats() {
  return (
    <section
      data-testid="toolkit-formats"
      className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/30"
    >
      <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t('Formatos admitidos')}</h2>
      <p className="mt-0.5 text-xs text-neutral-500">
        {t('Suelta tus archivos y Nodus te mostrará todo lo que puede hacer con ellos.')}
      </p>
      <dl className="mt-3 flex flex-col gap-2.5">
        {FORMAT_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500 sm:w-24 dark:text-neutral-400">
              {t(group.label)}
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {group.exts.map((ext) => (
                <span
                  key={ext}
                  className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[11px] uppercase text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                >
                  {ext}
                </span>
              ))}
              {group.anyFile && (
                <span className="rounded-md border border-dashed border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-600 dark:text-neutral-400">
                  {t('Cualquier archivo')}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The conversion menu: every operation the added files support, grouped by
 * category and filtered by a search box. Only compatible operations are ever
 * listed, so nothing offered here can fail on the chosen inputs.
 */
function OperationPicker({
  ops,
  value,
  onChange,
  disabled,
}: {
  ops: ToolkitOp[];
  value: ToolkitOp | null;
  onChange: (id: ToolkitOpId) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredMenu(open, btnRef);

  const groups = useMemo(() => {
    const needle = norm(query.trim());
    return TOOLKIT_CATEGORIES.map((category) => {
      const label = t(category.label);
      const items = ops
        .filter((op) => op.category === category.id)
        .filter((op) => {
          if (!needle) return true;
          const haystack = norm(
            [
              t(op.label),
              op.description ? t(op.description) : '',
              label,
              ...op.inputExts,
              ...op.outputs.map((out) => t(out.label)),
            ].join(' '),
          );
          return haystack.includes(needle);
        });
      return { id: category.id, label, items };
    }).filter((group) => group.items.length > 0);
  }, [ops, query]);

  // A flat view of what is on screen, so the arrow keys can walk across groups.
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Opening lands on the current choice rather than the first row — the list is
  // long enough that the selection would otherwise start off-screen. A search
  // narrows to the best match instead, so it goes back to the top.
  useEffect(() => {
    if (!open) return;
    const selected = query.trim() || !value ? -1 : flat.findIndex((op) => op.id === value.id);
    setActive(selected >= 0 ? selected : 0);
  }, [open, query]);
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (id: ToolkitOpId) => {
    onChange(id);
    close();
  };

  return (
    <>
      <button
        ref={btnRef}
        data-testid="toolkit-op-picker"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 min-h-9 w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-2.5 text-left text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-neutral-500'}`}>
          {value ? t(value.label) : t('Elige una conversión')}
        </span>
        <Icon name="chevronDown" size={14} className="shrink-0 opacity-60" />
      </button>

      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onClick={close} />
            <div
              data-testid="toolkit-op-menu"
              role="listbox"
              className="fixed z-[81] flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
              style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight }}
            >
              <div className="relative shrink-0 border-b border-neutral-200 p-2 dark:border-neutral-800">
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  data-testid="toolkit-op-search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Busca una conversión…')}
                  className="h-8 w-full rounded-lg border border-neutral-300 bg-white pl-7 pr-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      close();
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActive((i) => Math.min(i + 1, flat.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActive((i) => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' && flat[active]) {
                      e.preventDefault();
                      choose(flat[active].id);
                    }
                  }}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {flat.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-neutral-500">{t('Sin resultados')}</p>
                ) : (
                  groups.map((group) => (
                    <div key={group.id}>
                      <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        {group.label}
                      </p>
                      {group.items.map((op) => {
                        const isActive = flat[active]?.id === op.id;
                        const isSelected = value?.id === op.id;
                        return (
                          <button
                            key={op.id}
                            ref={isActive ? activeRef : undefined}
                            data-testid={`toolkit-op-${op.id}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setActive(flat.findIndex((item) => item.id === op.id))}
                            onClick={() => choose(op.id)}
                            className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                              isActive
                                ? 'bg-amber-100 dark:bg-amber-500/15'
                                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 text-sm text-neutral-800 dark:text-neutral-100">
                              <span className="min-w-0 flex-1 truncate">{t(op.label)}</span>
                              {isSelected && <Icon name="check" size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />}
                            </span>
                            {op.description && (
                              <span className="line-clamp-2 text-xs leading-snug text-neutral-500">{t(op.description)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function OptionInput({
  field,
  value,
  onChange,
}: {
  field: ToolkitOptionField;
  value: OptionValue;
  onChange: (value: OptionValue) => void;
}) {
  const inputCls =
    'h-9 min-h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  if (field.type === 'select') {
    return (
      <select className={inputCls} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {(field.choices ?? []).map((c) => (
          <option key={c.value} value={c.value}>
            {t(c.label)}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'boolean') {
    return (
      <label className="flex h-9 items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {t(field.label)}
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        className={inputCls}
        value={Number(value)}
        min={field.min}
        max={field.max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  return (
    <input
      type="text"
      className={inputCls}
      value={String(value)}
      placeholder={field.placeholder ? t(field.placeholder) : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The request of the job currently in the shared store, if any.
 *
 * Leaving this view unmounts it, but the conversion keeps running in the main
 * process and the job survives in the background store. Every field below seeds
 * itself from that request, so coming back mid-job (or after it finished) lands
 * the user on their batch — with the outputs still reachable through "Mostrar" —
 * instead of on the empty "drop files here" state with a stray progress card.
 */
function restoredRequest(): ToolkitJobRequest | null {
  return getBackgroundJob<ToolkitJobRequest, ToolkitJobProgress, ToolkitJobResult>(TOOLKIT_JOB_KEY)?.request ?? null;
}

export function ToolkitConvertView({ onBack }: { onBack: () => void }) {
  const [files, setFiles] = useState<string[]>(() => restoredRequest()?.inputPaths ?? []);
  const [opId, setOpId] = useState<ToolkitOpId | null>(() => restoredRequest()?.opId ?? null);
  const [outputFormat, setOutputFormat] = useState<string | null>(() => restoredRequest()?.outputFormat ?? null);
  const [options, setOptions] = useState<Record<string, OptionValue>>(() => restoredRequest()?.options ?? {});
  const [mergedName, setMergedName] = useState(() => restoredRequest()?.mergedName ?? '');
  const [zipName, setZipName] = useState(() => restoredRequest()?.zipName ?? '');
  // null = follow the smart default (zip when the job produces multiple files);
  // a restored job carries the choice it actually ran with.
  const [zipOverride, setZipOverride] = useState<boolean | null>(() => restoredRequest()?.zipOutput ?? null);
  const [outputDir, setOutputDir] = useState<string | null>(() => restoredRequest()?.outputDir ?? null);
  const [openOnDone, setOpenOnDone] = useState(() => restoredRequest()?.openFolderOnDone ?? false);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState<ToolkitConvertJob | null>(() => getBackgroundJob(TOOLKIT_JOB_KEY));

  // Re-attach to any in-flight/finished job when this view mounts.
  useEffect(() => subscribeBackgroundJob<ToolkitConvertJob['request'], ToolkitJobProgress, ToolkitConvertJob['result']>(
    TOOLKIT_JOB_KEY,
    (current) => setJob(current as ToolkitConvertJob | null),
  ), []);

  // Every operation the added files support, across all categories: the menu
  // groups them, so there is no category to pre-select any more.
  const availableOps = useMemo(() => opsForInputs(files), [files]);
  const selectedOp: ToolkitOp | null = useMemo(() => {
    if (!files.length) return null;
    return availableOps.find((op) => op.id === opId) ?? availableOps[0] ?? null;
  }, [availableOps, opId, files.length]);

  // Keep the chosen operation, target format and options coherent as inputs change.
  useEffect(() => {
    if (!selectedOp) {
      if (opId !== null) setOpId(null);
      return;
    }
    if (selectedOp.id !== opId) {
      setOpId(selectedOp.id);
      setOutputFormat(selectedOp.outputs[0]?.format ?? null);
      setOptions(defaultOptions(selectedOp));
      setZipOverride(null);
    }
  }, [selectedOp, opId]);

  // A job "produces multiple files" — and so defaults to a ZIP — when it processes
  // several inputs, or a single input fans out to many outputs (PDF→images, extract
  // images, split per page). merge operations always yield one file.
  const producesMultiple = useMemo(() => {
    if (!selectedOp || selectedOp.arity === 'merge') return false;
    if (files.length > 1) return true;
    if (selectedOp.id === 'pdf-to-images' || selectedOp.id === 'pdf-extract-images') return true;
    if (selectedOp.id === 'pdf-split' && options.mode === 'perPage') return true;
    return false;
  }, [selectedOp, files.length, options.mode]);
  const zipOutput = selectedOp?.arity === 'each' && (zipOverride ?? producesMultiple);

  const running = job?.status === 'running';
  const progress = job?.progress ?? null;

  const overallPct = progress ? jobOverallProgress(progress) : 0;
  // Both the ordinal and the name come from one source so they cannot disagree.
  const current = progress ? jobCurrentFile(progress) : null;

  // Counted from the result once there is one: it is the authoritative final list.
  const outcome = useMemo(() => {
    const files = job?.result?.files ?? progress?.files ?? [];
    return {
      done: files.filter((f) => f.status === 'done').length,
      errors: files.filter((f) => f.status === 'error').length,
    };
  }, [job?.result, progress]);

  const progressByPath = useMemo(() => {
    const map = new Map<string, ToolkitFileProgress>();
    for (const f of progress?.files ?? []) map.set(f.inputPath, f);
    for (const f of job?.result?.files ?? []) map.set(f.inputPath, f);
    return map;
  }, [progress, job?.result]);

  const addPaths = (paths: string[]) => {
    if (paths.length) setFiles((prev) => [...new Set([...prev, ...paths])]);
  };
  const addFiles = async () => {
    const picked = await window.nodus.pickToolkitFiles(ALL_INPUT_EXTS);
    addPaths(picked);
  };
  const removeFile = (path: string) => setFiles((prev) => prev.filter((p) => p !== path));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (running) return;
    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = window.nodus.getPathForDroppedFile(file);
      if (p) paths.push(p);
    }
    addPaths(paths);
  };

  const chooseOutputDir = async () => {
    const dir = await window.nodus.pickToolkitOutputDir();
    if (dir) setOutputDir(dir);
  };

  const canRun = Boolean(selectedOp) && files.length >= (selectedOp?.minInputs ?? 1) && !running;

  const run = () => {
    if (!selectedOp) return;
    clearBackgroundJob(TOOLKIT_JOB_KEY);
    startToolkitJob({
      opId: selectedOp.id,
      inputPaths: files,
      outputFormat,
      options,
      outputDir,
      mergedName: selectedOp.arity === 'merge' ? mergedName.trim() || null : null,
      zipOutput,
      zipName: zipOutput ? zipName.trim() || null : null,
      openFolderOnDone: openOnDone,
    });
  };

  const cancel = () => {
    if (progress?.jobId) void window.nodus.cancelToolkitJob(progress.jobId);
  };

  const setOption = (key: string, value: OptionValue) => setOptions((prev) => ({ ...prev, [key]: value }));

  const hasFiles = files.length > 0;

  return (
    <div data-testid="toolkit-convert-page" className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex items-center gap-3">
        <button
          data-testid="toolkit-back"
          className="btn btn-ghost h-9 min-h-9 justify-center px-2.5 py-0 leading-none"
          onClick={onBack}
          title={t('Volver a Herramientas')}
          aria-label={t('Volver a Herramientas')}
        >
          <Icon name="chevronLeft" className="shrink-0" />
        </button>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name="swap" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nodus Convert</h1>
          <p className="text-sm text-neutral-500">
            {t('Todo se procesa en tu equipo. Nunca se modifica el archivo original.')}
          </p>
        </div>
      </header>

      {/* Step 1 — drop the files. Stays a drop target once the list has content,
          just smaller, so more files can always be added the same way. */}
      <button
        data-testid="toolkit-dropzone"
        onClick={addFiles}
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center text-sm transition-colors ${
          hasFiles ? 'px-4 py-4' : 'px-4 py-12'
        } ${
          dragOver
            ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-900/20 dark:text-amber-200'
            : 'border-neutral-300 bg-neutral-50 text-neutral-500 hover:border-amber-400 hover:text-amber-700 dark:border-neutral-700 dark:bg-neutral-900/30 dark:hover:border-amber-500/60'
        }`}
      >
        <Icon name="upload" size={hasFiles ? 16 : 22} className="shrink-0" />
        <span className="font-medium">
          {hasFiles ? t('Añadir más archivos') : t('Arrastra archivos aquí o haz clic para elegir')}
        </span>
        {!hasFiles && <span className="text-xs">{t('Se admiten varios archivos para procesar en lote.')}</span>}
      </button>

      {(!hasFiles || availableOps.length === 0) && <SupportedFormats />}

      {hasFiles && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t('Archivos')}</h2>
            <span className="text-xs text-neutral-400">{files.length}</span>
            {!running && (
              <button
                data-testid="toolkit-clear-files"
                className="btn btn-ghost ml-auto h-7 min-h-7 px-2 text-xs text-neutral-500"
                onClick={() => setFiles([])}
              >
                {t('Quitar todos')}
              </button>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {files.map((path) => {
              const fp = progressByPath.get(path);
              const ext = fileExtLower(path);
              return (
                <li key={path} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Icon name="file" size={15} className="shrink-0 text-neutral-400" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-neutral-800 dark:text-neutral-200" title={path}>
                      {basename(path)}
                    </span>
                    {/* Why a file failed, instead of a bare red pill the user cannot
                        act on. tr() because the message comes from the main process. */}
                    {fp?.error && (
                      <span className="truncate text-xs text-rose-600 dark:text-rose-400" title={fp.error}>
                        {tr(fp.error)}
                      </span>
                    )}
                  </span>
                  {ext && (
                    <span className="shrink-0 rounded border border-neutral-200 px-1 font-mono text-[10px] uppercase text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                      {ext}
                    </span>
                  )}
                  {fp && <StatusPill status={fp.status} />}
                  {fp?.status === 'processing' && fp.pct != null && (
                    <span className="text-xs text-neutral-500">{Math.round(fp.pct * 100)}%</span>
                  )}
                  {fp?.outputPaths?.length ? (
                    <button
                      className="btn btn-ghost h-7 min-h-7 px-2 text-xs"
                      onClick={() => window.nodus.revealToolkitOutput(fp.outputPaths[0])}
                      title={t('Mostrar en el explorador')}
                    >
                      {t('Mostrar')}
                    </button>
                  ) : null}
                  {!running && (
                    <button
                      className="btn btn-ghost h-7 min-h-7 px-1.5 text-neutral-400"
                      onClick={() => removeFile(path)}
                      aria-label={t('Quitar')}
                      title={t('Quitar')}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Step 2 — pick what to do, then fine-tune it. */}
      {hasFiles && (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          {availableOps.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {t('Ninguna conversión admite los archivos añadidos. Revisa los formatos admitidos.')}
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('Operación')}</span>
                <OperationPicker
                  ops={availableOps}
                  value={selectedOp}
                  onChange={(id) => setOpId(id)}
                  disabled={running}
                />
              </label>

              {selectedOp && selectedOp.outputs.length > 1 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('Formato de salida')}</span>
                  <select
                    data-testid="toolkit-format-select"
                    className="h-9 min-h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                    value={outputFormat ?? ''}
                    onChange={(e) => setOutputFormat(e.target.value)}
                  >
                    {selectedOp.outputs.map((o) => (
                      <option key={o.format} value={o.format}>
                        {t(o.label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedOp?.description && (
                <p className="text-xs leading-relaxed text-neutral-500">{t(selectedOp.description)}</p>
              )}

              {selectedOp?.usesNetwork && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                  {t('La primera vez que uses un idioma de OCR, Nodus descarga sus datos de Tesseract una sola vez y los guarda en tu equipo. Es la única conexión de red del conversor.')}
                </p>
              )}

              {(selectedOp?.options ?? []).map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-sm">
                  {field.type !== 'boolean' && (
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{t(field.label)}</span>
                  )}
                  <OptionInput
                    field={field}
                    value={options[field.key] ?? field.default}
                    onChange={(value) => setOption(field.key, value)}
                  />
                </label>
              ))}

              {selectedOp?.arity === 'merge' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('Nombre del archivo combinado')}</span>
                  <input
                    type="text"
                    className="h-9 min-h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                    value={mergedName}
                    placeholder={t('salida')}
                    onChange={(e) => setMergedName(e.target.value)}
                  />
                </label>
              )}

              {selectedOp?.arity === 'each' && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={zipOutput}
                      onChange={(e) => setZipOverride(e.target.checked)}
                    />
                    {t('Empaquetar las salidas en un ZIP')}
                    {producesMultiple && zipOverride === null && (
                      <span className="text-xs text-neutral-400">{t('(recomendado para lotes)')}</span>
                    )}
                  </label>
                  {zipOutput && (
                    <input
                      type="text"
                      className="h-9 min-h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      value={zipName}
                      placeholder={t('Nombre del ZIP')}
                      onChange={(e) => setZipName(e.target.value)}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Destination + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost h-9 min-h-9 px-3 text-sm" onClick={chooseOutputDir}>
          <Icon name="folder" size={15} className="shrink-0" />
          <span className="max-w-[220px] truncate">
            {outputDir ? basename(outputDir) : t('Junto al original')}
          </span>
        </button>
        {outputDir && (
          <button className="btn btn-ghost h-9 min-h-9 px-2 text-xs text-neutral-400" onClick={() => setOutputDir(null)}>
            {t('Restablecer')}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={openOnDone} onChange={(e) => setOpenOnDone(e.target.checked)} />
          {t('Abrir la carpeta al terminar')}
        </label>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <button data-testid="toolkit-cancel" className="btn h-9 min-h-9 px-4 text-sm" onClick={cancel}>
              {t('Cancelar')}
            </button>
          ) : (
            <button
              data-testid="toolkit-run"
              className="btn btn-primary h-9 min-h-9 px-4 text-sm disabled:opacity-50"
              disabled={!canRun}
              onClick={run}
            >
              <Icon name="swap" size={15} className="shrink-0" />
              {t('Convertir')}
            </button>
          )}
        </div>
      </div>

      {progress && (
        <section
          data-testid="toolkit-progress"
          className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {progress.finished
                ? progress.cancelled
                  ? t('Trabajo cancelado.')
                  : t('Trabajo terminado.')
                : tx('Procesando {done} de {total}', {
                    done: current?.ordinal ?? Math.min(progress.done + 1, progress.total),
                    total: progress.total,
                  })}
            </span>
            <span className="ml-auto text-xs tabular-nums text-neutral-500">
              {Math.round(overallPct * 100)} %
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overallPct * 100)}
          >
            <div
              data-testid="toolkit-progress-fill"
              className={`h-full transition-all ${
                !progress.finished
                  ? 'bg-amber-500'
                  : progress.cancelled
                    ? 'bg-neutral-400 dark:bg-neutral-600'
                    : outcome.errors > 0
                      ? 'bg-rose-500'
                      : 'bg-emerald-500'
              }`}
              // A sliver of fill from the start, so the bar reads as "started" rather
              // than as an empty track the job never touched.
              style={{ width: `${Math.max(2, overallPct * 100)}%` }}
            />
          </div>
          <p className="truncate text-xs text-neutral-500">
            {progress.finished
              ? `${tx('{done} de {total} archivos convertidos', { done: outcome.done, total: progress.total })}${
                  outcome.errors > 0 ? ` · ${tx('{errors} con error', { errors: outcome.errors })}` : ''
                }`
              : current
                ? basename(current.file.inputPath)
                : ''}
          </p>
        </section>
      )}

      {job?.result?.zipPath && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200">
          <Icon name="archive" size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{basename(job.result.zipPath)}</span>
          <button
            className="btn btn-ghost h-7 min-h-7 px-2 text-xs"
            onClick={() => window.nodus.revealToolkitOutput(job.result!.zipPath!)}
          >
            {t('Mostrar')}
          </button>
        </div>
      )}
    </div>
  );
}
