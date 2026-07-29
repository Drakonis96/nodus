import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TestimonyCode,
  TestimonyContrast,
  TestimonyContrastFilters,
  TestimonyContrastResult,
  TestimonyFragment,
  TestimonyInterviewRow,
} from '@shared/types';
import { formatTimecode } from '@shared/testimonies';
import { buildTestimonyLink, testimonyLinkMarkdown } from '@shared/testimonyDeepLinks';
import { TRANSCRIPT_KIND_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../components/ui';
import { confirm, promptText, toast } from '../components/feedback';
import { useDataRefresh } from '../hooks';
import { AccessBadge } from '../components/testimonies/AccessBadge';
import { t, tx } from '../i18n';

type ContrastMode = 'parallel' | 'byTheme' | 'matrix';

/**
 * Contrastes: poner uno al lado de otro lo que varias personas cuentan sobre lo mismo.
 *
 * LO QUE ESTA PANTALLA NO HACE es lo que la define. No decide cuál relato es verdadero,
 * no puntúa credibilidad y no resuelve contradicciones — las muestra con su contexto y su
 * minuto, y la interpretación la escribe el investigador en el memo, que después puede
 * convertirse en nota con todas sus referencias.
 *
 * FUNCIONA SIN IA (decisión 17 del plan). Filtros, columnas, matriz y memo son consultas
 * y texto humano. Un contraste que dependiera de un modelo sería un contraste que no se
 * puede reproducir ni auditar dentro de cinco años.
 *
 * LAS AUSENCIAS SE MARCAN, NO SE INTERPRETAN. Que una entrevista seleccionada no aporte
 * ningún fragmento puede significar que no lo vivió, que no se le preguntó o que decidió
 * no contarlo: tres cosas que se parecen mucho en una base de datos y nada fuera de ella.
 */
export function TestimonyContrastsView() {
  const [interviews, setInterviews] = useState<TestimonyInterviewRow[]>([]);
  const [codes, setCodes] = useState<TestimonyCode[]>([]);
  const [saved, setSaved] = useState<TestimonyContrast[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TestimonyContrastFilters>({});
  const [mode, setMode] = useState<ContrastMode>('parallel');
  const [result, setResult] = useState<TestimonyContrastResult | null>(null);
  const [running, setRunning] = useState(false);

  const reloadCatalog = useCallback(async () => {
    const [rows, catalog, contrasts] = await Promise.all([
      window.nodus.listTestimonyInterviews({}),
      window.nodus.listTestimonyCodes(),
      window.nodus.listTestimonyContrasts(),
    ]);
    setInterviews(rows);
    setCodes(catalog);
    setSaved(contrasts);
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);
  useDataRefresh(reloadCatalog);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setResult(await window.nodus.runTestimonyContrast(filters));
    } finally {
      setRunning(false);
    }
  }, [filters]);

  useEffect(() => {
    void run();
  }, [run]);

  const active = useMemo(() => saved.find((entry) => entry.id === activeId) ?? null, [saved, activeId]);
  const pinnedIds = useMemo(() => new Set(active?.pinned.map((item) => item.annotationId) ?? []), [active]);

  const byId = useMemo(() => new Map(interviews.map((row) => [row.id, row])), [interviews]);
  const codeById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);

  const selectedInterviews = filters.interviewIds ?? [];
  const selectedCodes = filters.codeIds ?? [];

  const toggle = (key: 'interviewIds' | 'codeIds', id: string): void => {
    const current = filters[key] ?? [];
    const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    setFilters({ ...filters, [key]: next.length ? next : undefined });
  };

  const saveContrast = async (): Promise<void> => {
    if (active) {
      await window.nodus.updateTestimonyContrast(active.id, { filters });
      await reloadCatalog();
      toast(t('Contraste actualizado.'));
      return;
    }
    const title = await promptText({ title: t('Guardar contraste'), initial: t('Contraste sin título') });
    if (!title) return;
    const created = await window.nodus.createTestimonyContrast({ title, filters });
    setActiveId(created.id);
    await reloadCatalog();
  };

  const openSaved = async (contrast: TestimonyContrast): Promise<void> => {
    setActiveId(contrast.id);
    setFilters(contrast.filters);
    setMode(contrast.filters.mode ?? 'parallel');
  };

  /**
   * Convertir el contraste en una nota.
   *
   * Es el único destino de una síntesis: una interpretación se guarda donde se puede
   * discutir y editar, con todos sus enlaces de vuelta al minuto, no como un campo del
   * contraste que después nadie sabría si escribió una persona o una máquina.
   */
  const sendToNotes = async (): Promise<void> => {
    if (!result) return;
    const fragments = active && pinnedIds.size > 0
      ? result.fragments.filter((fragment) => pinnedIds.has(fragment.annotationId))
      : result.fragments;
    const title = active?.title ?? t('Contraste sin título');
    const lines: string[] = [`# ${title}`, ''];
    if (active?.memoMarkdown) lines.push(active.memoMarkdown, '');
    for (const fragment of fragments) {
      lines.push(`## ${fragment.speakerName} · ${fragment.interviewTitle} · ${formatTimecode(fragment.tStart)}`);
      lines.push(`> ${fragment.text}`);
      if (fragment.codes.length > 0) lines.push(`**Códigos:** ${fragment.codes.map((code) => code.label).join(', ')}`);
      lines.push(testimonyLinkMarkdown(t('Abrir el fragmento en su minuto'), {
        target: 'interview',
        id: fragment.interviewId,
        transcriptId: fragment.transcriptId,
        annotationId: fragment.annotationId,
        t: fragment.tStart,
      }));
      lines.push('');
    }
    if (result.silentInterviewIds.length > 0) {
      lines.push(`**${t('Sin fragmentos sobre esto')}:** ${result.silentInterviewIds.map((id) => byId.get(id)?.title ?? id).join(', ')}`);
      lines.push('');
      lines.push(`_${t('Que una entrevista no aporte nada puede significar que no se vivió, que no se preguntó o que se decidió no contarlo. Nodus no lo interpreta.')}_`);
    }
    const note = await window.nodus.createNote({ title, content: lines.join('\n') });
    for (const fragment of fragments) {
      await window.nodus.addNoteLink(note.id, 'testimony_annotation', fragment.annotationId, fragment.text.slice(0, 120));
      await window.nodus.addNoteLink(note.id, 'testimony_interview', fragment.interviewId, fragment.interviewTitle);
    }
    if (active) await window.nodus.addNoteLink(note.id, 'testimony_contrast', active.id, active.title);
    toast(t('Nota creada con todos los fragmentos y sus enlaces.'));
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="testimony-contrasts">
      <header className="border-b border-neutral-200 px-6 pb-3 pt-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">{t('Contrastes')}</h1>
          <span className="text-xs text-neutral-500">
            {tx('{n} fragmentos', { n: result?.fragments.length ?? 0 })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-neutral-300 dark:border-neutral-700">
              {(['parallel', 'byTheme', 'matrix'] as ContrastMode[]).map((value) => (
                <button
                  key={value}
                  data-testid={`testimony-contrast-mode-${value}`}
                  onClick={() => setMode(value)}
                  className={`px-2.5 py-1.5 text-xs ${mode === value ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
                >
                  {t(value === 'parallel' ? 'Paralelo' : value === 'byTheme' ? 'Por tema' : 'Matriz')}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" data-testid="testimony-contrast-save" onClick={() => void saveContrast()}>
              <Icon name="save" /> {active ? t('Actualizar') : t('Guardar contraste')}
            </button>
            <button
              className="btn btn-primary"
              data-testid="testimony-contrast-to-notes"
              disabled={!result || result.fragments.length === 0}
              onClick={() => void sendToNotes()}
            >
              <Icon name="notebook" /> {t('Crear nota')}
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4 overflow-y-auto border-b border-neutral-200 p-4 dark:border-neutral-800 lg:border-b-0 lg:border-r">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Entrevistas')}</h2>
            <div className="mt-2 space-y-1" data-testid="testimony-contrast-interviews">
              {interviews.map((row) => (
                <label key={row.id} className="flex cursor-pointer items-start gap-2 text-xs leading-5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    data-testid={`testimony-contrast-interview-${row.shortId}`}
                    checked={selectedInterviews.includes(row.id)}
                    onChange={() => toggle('interviewIds', row.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-700 dark:text-neutral-200">{row.title}</span>
                    <span className="block truncate text-[10px] text-neutral-500">
                      {row.narratorNames.join(', ') || row.shortId}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Códigos y temas')}</h2>
            <div className="mt-2 flex flex-wrap gap-1" data-testid="testimony-contrast-codes">
              {codes.length === 0 && <span className="text-[11px] text-neutral-500">{t('Todavía no hay códigos.')}</span>}
              {codes.map((code) => (
                <button
                  key={code.id}
                  data-testid={`testimony-contrast-code-${code.normalizedLabel.replace(/\s+/g, '-')}`}
                  onClick={() => toggle('codeIds', code.id)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    selectedCodes.includes(code.id)
                      ? 'border-indigo-500 bg-indigo-600 text-white'
                      : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'
                  }`}
                >
                  {code.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <input
              className="input w-full text-xs"
              placeholder={t('Buscar en los fragmentos…')}
              data-testid="testimony-contrast-search"
              value={filters.search ?? ''}
              onChange={(event) => setFilters({ ...filters, search: event.target.value || undefined })}
            />
            <label className="flex items-start gap-2 text-[11px] leading-4 text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                className="mt-0.5"
                data-testid="testimony-contrast-reviewed-only"
                checked={Boolean(filters.reviewedOnly)}
                onChange={(event) => setFilters({ ...filters, reviewedOnly: event.target.checked || undefined })}
              />
              <span>{t('Solo versiones corregidas, revisadas o aprobadas: comparar transcripciones automáticas sin revisar es comparar errores de reconocimiento.')}</span>
            </label>
            {(selectedInterviews.length > 0 || selectedCodes.length > 0 || filters.search) && (
              <button className="btn btn-ghost w-full text-xs" onClick={() => { setFilters({}); setActiveId(null); }}>
                <Icon name="x" /> {t('Empezar de cero')}
              </button>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Contrastes guardados')}</h2>
            <ul className="mt-2 space-y-1" data-testid="testimony-saved-contrasts">
              {saved.length === 0 && <li className="text-[11px] text-neutral-500">{t('Ninguno todavía.')}</li>}
              {saved.map((contrast) => (
                <li key={contrast.id} className="flex items-center gap-1">
                  <button
                    className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs ${
                      activeId === contrast.id ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    }`}
                    data-testid={`testimony-saved-${contrast.shortId}`}
                    onClick={() => void openSaved(contrast)}
                  >
                    {contrast.title}
                  </button>
                  <button
                    className="btn btn-ghost h-6 px-1 text-rose-500"
                    title={t('Eliminar contraste')}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('Eliminar contraste'),
                        message: t('Se elimina la configuración guardada. Los fragmentos y las notas no se tocan.'),
                        confirmLabel: t('Eliminar'),
                        danger: true,
                      });
                      if (!ok) return;
                      await window.nodus.deleteTestimonyContrast(contrast.id);
                      if (activeId === contrast.id) setActiveId(null);
                      await reloadCatalog();
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="min-h-0 overflow-auto p-4">
          {running && <p className="text-sm text-neutral-500">{t('Cargando...')}</p>}

          {!running && result && result.fragments.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
              {selectedInterviews.length === 0 && selectedCodes.length === 0
                ? t('Elige dos o más entrevistas y un código para ponerlas una al lado de otra.')
                : t('Ningún fragmento coincide con esta selección.')}
            </p>
          )}

          {!running && result && result.fragments.length > 0 && (
            <>
              {result.sharedCodeIds.length > 0 && (
                <p className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-[11px] text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/25 dark:text-emerald-300" data-testid="testimony-shared-codes">
                  {t('Códigos presentes en TODAS las entrevistas seleccionadas')}:{' '}
                  {result.sharedCodeIds.map((id) => codeById.get(id)?.label ?? id).join(', ')}
                </p>
              )}

              {result.silentInterviewIds.length > 0 && (
                <p className="mb-3 rounded-lg border border-neutral-300 p-2 text-[11px] leading-5 text-neutral-500 dark:border-neutral-700" data-testid="testimony-silences">
                  <strong>{t('Sin fragmentos sobre esto')}:</strong>{' '}
                  {result.silentInterviewIds.map((id) => byId.get(id)?.title ?? id).join(', ')}
                  <br />
                  {t('Puede significar que no se vivió, que no se preguntó o que se decidió no contarlo. Nodus no lo interpreta por ti.')}
                </p>
              )}

              {mode === 'parallel' && (
                <ParallelView
                  result={result}
                  interviews={byId}
                  pinned={pinnedIds}
                  onPin={active ? (annotationId, pin) => void window.nodus.pinTestimonyFragment(active.id, annotationId, pin).then(reloadCatalog) : undefined}
                />
              )}
              {mode === 'byTheme' && (
                <ThemeView
                  result={result}
                  codes={codeById}
                  pinned={pinnedIds}
                  onPin={active ? (annotationId, pin) => void window.nodus.pinTestimonyFragment(active.id, annotationId, pin).then(reloadCatalog) : undefined}
                />
              )}
              {mode === 'matrix' && <MatrixView result={result} interviews={byId} codes={codeById} />}
            </>
          )}

          {active && (
            <section className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Memo del contraste')}</h3>
              <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                {t('Lo que TÚ concluyes de esta comparación. Nodus pone los fragmentos uno al lado de otro; interpretarlos es tu trabajo.')}
              </p>
              <textarea
                className="input mt-2 w-full text-xs"
                rows={4}
                data-testid="testimony-contrast-memo"
                defaultValue={active.memoMarkdown ?? ''}
                onBlur={(event) => void window.nodus.updateTestimonyContrast(active.id, { memoMarkdown: event.target.value || null }).then(reloadCatalog)}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentCard({
  fragment,
  pinned,
  onPin,
}: {
  fragment: TestimonyFragment;
  pinned: boolean;
  onPin?: (annotationId: string, pin: boolean) => void;
}) {
  return (
    <article
      className={`rounded-lg border p-2 text-xs ${pinned ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700/60 dark:bg-indigo-950/25' : 'border-neutral-200 dark:border-neutral-800'}`}
      data-testid={`testimony-fragment-${fragment.shortId}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-200">{fragment.speakerName}</span>
        <span>{fragment.interviewShortId}</span>
        <a
          href={buildTestimonyLink({ target: 'interview', id: fragment.interviewId, annotationId: fragment.annotationId, t: fragment.tStart })}
          className="text-indigo-400"
          onClick={(event) => event.preventDefault()}
          title={t('Abrir en contexto')}
        >
          {formatTimecode(fragment.tStart)}
        </a>
        <span title={t('Versión de la transcripción citada')}>{t(TRANSCRIPT_KIND_LABEL[fragment.transcriptKind])}</span>
        <AccessBadge level={fragment.accessLevel} compact />
        {fragment.linkStatus === 'needs_review' && (
          <span className="rounded-full border border-amber-400 px-1 text-amber-600 dark:text-amber-400">{t('Pendiente de revisar')}</span>
        )}
        {onPin && (
          <button
            className="ml-auto btn btn-ghost h-5 px-1"
            title={pinned ? t('Soltar') : t('Fijar')}
            data-testid={`testimony-pin-${fragment.shortId}`}
            onClick={() => onPin(fragment.annotationId, !pinned)}
          >
            <Icon name={pinned ? 'star' : 'plus'} size={10} className={pinned ? 'text-amber-400' : ''} />
          </button>
        )}
      </div>
      <p className="mt-1 italic leading-5 text-neutral-700 dark:text-neutral-200">«{fragment.text}»</p>
      {fragment.memo && <p className="mt-1 text-[10px] text-neutral-500">{fragment.memo}</p>}
      {fragment.codes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {fragment.codes.map((code) => (
            <span
              key={code.id}
              className="rounded-full border px-1.5 text-[10px]"
              style={code.color ? { borderColor: code.color, color: code.color } : undefined}
            >
              {code.label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Una columna por entrevista: la forma de leer «qué dijo cada uno sobre esto». */
function ParallelView({
  result,
  interviews,
  pinned,
  onPin,
}: {
  result: TestimonyContrastResult;
  interviews: Map<string, TestimonyInterviewRow>;
  pinned: Set<string>;
  onPin?: (annotationId: string, pin: boolean) => void;
}) {
  const columns = useMemo(() => {
    const map = new Map<string, TestimonyFragment[]>();
    for (const fragment of result.fragments) {
      const list = map.get(fragment.interviewId) ?? [];
      list.push(fragment);
      map.set(fragment.interviewId, list);
    }
    return [...map.entries()];
  }, [result]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="testimony-parallel">
      {columns.map(([interviewId, fragments]) => (
        <div key={interviewId} className="min-w-[280px] flex-1 space-y-2">
          <h3 className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">
            {interviews.get(interviewId)?.title ?? interviewId}
          </h3>
          <p className="truncate text-[10px] text-neutral-500">
            {interviews.get(interviewId)?.narratorNames.join(', ')}
          </p>
          {fragments.map((fragment) => (
            <FragmentCard key={fragment.annotationId} fragment={fragment} pinned={pinned.has(fragment.annotationId)} onPin={onPin} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Agrupado por código: la forma de leer «qué se ha dicho sobre este tema». */
function ThemeView({
  result,
  codes,
  pinned,
  onPin,
}: {
  result: TestimonyContrastResult;
  codes: Map<string, TestimonyCode>;
  pinned: Set<string>;
  onPin?: (annotationId: string, pin: boolean) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, TestimonyFragment[]>();
    for (const fragment of result.fragments) {
      const keys = fragment.codes.length > 0 ? fragment.codes.map((code) => code.id) : ['__none__'];
      for (const key of keys) {
        const list = map.get(key) ?? [];
        list.push(fragment);
        map.set(key, list);
      }
    }
    return [...map.entries()];
  }, [result]);

  return (
    <div className="space-y-4" data-testid="testimony-by-theme">
      {groups.map(([codeId, fragments]) => (
        <section key={codeId}>
          <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">
            {codeId === '__none__' ? t('Sin código') : codes.get(codeId)?.label ?? codeId}
            <span className="ml-2 font-normal text-neutral-500">{fragments.length}</span>
          </h3>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {fragments.map((fragment) => (
              <FragmentCard
                key={`${codeId}-${fragment.annotationId}`}
                fragment={fragment}
                pinned={pinned.has(fragment.annotationId)}
                onPin={onPin}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Temas en filas, entrevistas en columnas: dónde hay material y dónde no lo hay. */
function MatrixView({
  result,
  interviews,
  codes,
}: {
  result: TestimonyContrastResult;
  interviews: Map<string, TestimonyInterviewRow>;
  codes: Map<string, TestimonyCode>;
}) {
  const codeIds = useMemo(() => [...new Set(result.matrix.map((cell) => cell.codeId))], [result]);
  const interviewIds = useMemo(
    () => [...new Set([...result.matrix.map((cell) => cell.interviewId), ...result.silentInterviewIds])],
    [result],
  );
  const counts = useMemo(
    () => new Map(result.matrix.map((cell) => [`${cell.codeId}::${cell.interviewId}`, cell.count])),
    [result],
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800" data-testid="testimony-matrix">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t('Código o tema')}</th>
            {interviewIds.map((id) => (
              <th key={id} scope="col" className="max-w-[160px] truncate px-3 py-2 text-left font-medium">
                {interviews.get(id)?.title ?? id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codeIds.map((codeId) => (
            <tr key={codeId} className="border-t border-neutral-200 dark:border-neutral-800">
              <th scope="row" className="px-3 py-2 text-left font-medium text-neutral-700 dark:text-neutral-200">
                {codes.get(codeId)?.label ?? codeId}
              </th>
              {interviewIds.map((interviewId) => {
                const count = counts.get(`${codeId}::${interviewId}`) ?? 0;
                return (
                  <td key={interviewId} className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {count > 0 ? count : <span className="text-neutral-400 dark:text-neutral-600" title={t('Sin fragmentos: una ausencia, no una negación')}>—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
