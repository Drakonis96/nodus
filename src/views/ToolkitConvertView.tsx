// Nodus Convert — the batch file-conversion workspace. Categories on the left,
// a dropzone + file list and the operation's options on the right. The job runs
// in main and streams progress here; it survives navigation via the shared
// background-jobs store (TOOLKIT_JOB_KEY), so leaving and returning re-attaches.
//
// Native <select> elements are used on purpose: their popups render natively and
// are never clipped by an `overflow-hidden` ancestor (the Databases portal
// landmine), so no portalling is needed here.
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import {
  TOOLKIT_CATEGORIES,
  TOOLKIT_OPS,
  defaultOptions,
  opsForInputs,
  type ToolkitCategory,
  type ToolkitJobProgress,
  type ToolkitOp,
  type ToolkitOpId,
  type ToolkitOptionField,
} from '@shared/toolkitTypes';
import type { ToolkitFileProgress } from '@shared/types';
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

/** Extensions to seed the file picker for a category: [] (any) when any op in it
 *  accepts any file, else the union of the category's accepted extensions. */
function pickerExtensions(category: ToolkitCategory): string[] {
  const ops = TOOLKIT_OPS.filter((op) => op.category === category);
  if (ops.some((op) => op.inputExts.length === 0)) return [];
  return [...new Set(ops.flatMap((op) => op.inputExts))];
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

export function ToolkitConvertView({ onBack }: { onBack: () => void }) {
  const [category, setCategory] = useState<ToolkitCategory>('documents');
  const [files, setFiles] = useState<string[]>([]);
  const [opId, setOpId] = useState<ToolkitOpId | null>(null);
  const [outputFormat, setOutputFormat] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, OptionValue>>({});
  const [mergedName, setMergedName] = useState('');
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [openOnDone, setOpenOnDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState<ToolkitConvertJob | null>(() => getBackgroundJob(TOOLKIT_JOB_KEY));

  // Re-attach to any in-flight/finished job when this view mounts.
  useEffect(() => subscribeBackgroundJob<ToolkitConvertJob['request'], ToolkitJobProgress, ToolkitConvertJob['result']>(
    TOOLKIT_JOB_KEY,
    (current) => setJob(current as ToolkitConvertJob | null),
  ), []);

  const availableOps = useMemo(() => opsForInputs(files, category), [files, category]);
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
    }
  }, [selectedOp, opId]);

  const running = job?.status === 'running';
  const progress = job?.progress ?? null;

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
    const picked = await window.nodus.pickToolkitFiles(pickerExtensions(category));
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
      openFolderOnDone: openOnDone,
    });
  };

  const cancel = () => {
    if (progress?.jobId) void window.nodus.cancelToolkitJob(progress.jobId);
  };

  const setOption = (key: string, value: OptionValue) => setOptions((prev) => ({ ...prev, [key]: value }));

  return (
    <div data-testid="toolkit-convert-page" className="mx-auto flex max-w-5xl flex-col gap-6">
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

      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        {/* Category rail */}
        <nav className="flex flex-row flex-wrap gap-2 md:flex-col">
          {TOOLKIT_CATEGORIES.map((c) => {
            const active = c.id === category;
            return (
              <button
                key={c.id}
                data-testid={`toolkit-cat-${c.id}`}
                onClick={() => setCategory(c.id)}
                className={`h-9 min-h-9 rounded-lg px-3 text-left text-sm transition-colors ${
                  active
                    ? 'bg-amber-100 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/60'
                }`}
              >
                {t(c.label)}
              </button>
            );
          })}
        </nav>

        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-4">
          <button
            data-testid="toolkit-dropzone"
            onClick={addFiles}
            onDragOver={(e) => {
              e.preventDefault();
              if (!running) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-8 text-center text-sm transition-colors ${
              dragOver
                ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-900/20 dark:text-amber-200'
                : 'border-neutral-300 bg-neutral-50 text-neutral-500 hover:border-amber-400 hover:text-amber-700 dark:border-neutral-700 dark:bg-neutral-900/30 dark:hover:border-amber-500/60'
            }`}
          >
            <Icon name="upload" size={20} className="shrink-0" />
            <span className="font-medium">{t('Arrastra archivos aquí o haz clic para elegir')}</span>
            <span className="text-xs">{t('Se admiten varios archivos para procesar en lote.')}</span>
          </button>

          {files.length > 0 && (
            <ul className="flex flex-col divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {files.map((path) => {
                const fp = progressByPath.get(path);
                return (
                  <li key={path} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Icon name="file" size={15} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200" title={path}>
                      {basename(path)}
                    </span>
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
          )}

          {/* Operation + options */}
          {files.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              {availableOps.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  {t('Ninguna operación de esta categoría admite los archivos añadidos.')}
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('Operación')}</span>
                    <select
                      data-testid="toolkit-op-select"
                      className="h-9 min-h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      value={selectedOp?.id ?? ''}
                      onChange={(e) => setOpId(e.target.value as ToolkitOpId)}
                    >
                      {availableOps.map((op) => (
                        <option key={op.id} value={op.id}>
                          {t(op.label)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedOp && selectedOp.outputs.length > 1 && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('Formato de salida')}</span>
                      <select
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
            <p className="text-xs text-neutral-500">
              {progress.finished
                ? progress.cancelled
                  ? t('Trabajo cancelado.')
                  : t('Trabajo terminado.')
                : `${progress.done}/${progress.total}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
