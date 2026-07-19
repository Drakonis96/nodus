import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/studyOrg';
import type { AppSettings } from '@shared/types';
import { MAX_GROUP_SIZE, clampExpectedSize, type TeachingGroup } from '@shared/teachingGroups';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { LongTextCell, TextCell } from '../components/dbGrid';
import { t, tx, errorText, getActiveLang } from '../i18n';

/**
 * Student groups (teaching vault).
 *
 * A group is one subject's class list for one academic year — which is what makes a
 * new year start empty instead of inheriting last year's students. The roster reuses
 * the database grid's cell editors so it looks and edits exactly like every other
 * table in the app.
 *
 * The identifier column is not decoration: it is the handle a teacher copies to ask
 * the AI about one student without typing their name. It lives in its own column
 * rather than on the name, because the name cell is an editable field and a click
 * there has to mean "edit".
 */
export function TeachingGroupsView() {
  const [groups, setGroups] = useState<TeachingGroup[]>([]);
  const [group, setGroup] = useState<TeachingGroup | null>(null);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TeachingGroup | null>(null);

  const reload = useCallback(async () => setGroups(await window.nodus.listTeachingGroups()), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [list, ws, cfg] = await Promise.all([
          window.nodus.listTeachingGroups(),
          window.nodus.getStudyWorkspace(),
          window.nodus.getSettings(),
        ]);
        if (!active) return;
        setGroups(list);
        setWorkspace(ws);
        setSettings(cfg);
      } catch (cause) {
        if (active) setError(errorText(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const subjectName = (id: string) => workspace?.subjects.find((s) => s.id === id)?.name ?? t('Sin asignatura');
  const yearLabel = (id: string | null) =>
    id ? workspace?.academicYears.find((y) => y.id === id)?.label ?? '—' : t('Sin curso académico');

  const refreshGroup = async (id: string) => {
    const next = await window.nodus.getTeachingGroup(id);
    setGroup(next);
    void reload();
  };

  const guard = async (run: () => Promise<void>) => {
    try { await run(); } catch (cause) { setError(errorText(cause)); }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setMessage(tx('Identificador {code} copiado. Úsalo para preguntar a la IA por este alumno.', { code }));
  };

  const togglePrivacy = async () => {
    const next = !(settings?.studentPseudonymsEnabled ?? true);
    await window.nodus.updateSettings({ studentPseudonymsEnabled: next });
    setSettings(await window.nodus.getSettings());
    setMessage(next ? t('La IA verá identificadores en lugar de nombres.') : t('La IA verá los nombres reales del alumnado.'));
  };

  const filtered = useMemo(
    () => groups.filter((g) =>
      (!subjectFilter || g.subjectId === subjectFilter) &&
      (!yearFilter || (yearFilter === 'none' ? g.academicYearId === null : g.academicYearId === yearFilter))),
    [groups, subjectFilter, yearFilter],
  );

  if (loading) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando grupos…')} /></div>;

  /* ------------------------------------------------------------ group list --- */
  if (!group) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="groups-list">
        <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">{t('Organización')}</p>
              <h1 className="text-xl font-semibold">{t('Grupos')}</h1>
              <p className="mt-1 text-xs text-neutral-500">{t('Listados de alumnado por asignatura y curso académico.')}</p>
            </div>
            <button
              data-testid="group-new"
              className="btn btn-primary"
              disabled={!workspace?.subjects.length}
              title={workspace?.subjects.length ? undefined : t('Crea antes una asignatura.')}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" />{t('Nuevo grupo')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select className="input h-8 min-w-44 text-xs" data-testid="group-filter-subject" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
              <option value="">{t('Todas las asignaturas')}</option>
              {workspace?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="input h-8 min-w-44 text-xs" data-testid="group-filter-year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="">{t('Todos los cursos académicos')}</option>
              {workspace?.academicYears.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              <option value="none">{t('Sin curso académico')}</option>
            </select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="px-5 pt-3 text-sm text-red-500">{error}</p>}
          {message && <p className="px-5 pt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
          {filtered.length === 0 ? (
            <div className="mx-auto mt-12 max-w-md rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-800">
              <Icon name="users" size={26} className="mx-auto mb-3 text-neutral-400" />
              <p className="text-sm text-neutral-500">
                {workspace?.subjects.length
                  ? t('Todavía no has creado ningún grupo.')
                  : t('Crea primero una asignatura en Cursos, asignaturas y grupos.')}
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[760px] border-collapse text-xs" data-testid="group-table" data-tour="group-table">
              <thead className="study-browser-table-head sticky top-0 z-10">
                <tr className="text-left">
                  <th className="w-[300px] px-4 py-2 font-medium">{t('Grupo')}</th>
                  <th className="px-3 py-2 font-medium">{t('Asignatura')}</th>
                  <th className="px-3 py-2 font-medium">{t('Curso académico')}</th>
                  <th className="px-3 py-2 font-medium">{t('Alumnado')}</th>
                  <th className="px-3 py-2 font-medium">{t('Actualizado')}</th>
                  <th className="w-[60px] px-3 py-2 text-right font-medium">{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    data-testid={`group-row-${entry.id}`}
                    className="cursor-pointer border-b border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800/60 dark:hover:bg-neutral-900/40"
                    onClick={() => void guard(async () => setGroup(await window.nodus.getTeachingGroup(entry.id)))}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex max-w-[290px] items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-300"><Icon name="users" size={15} /></span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-200">{entry.name}</span>
                          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-600">{entry.shortId}</span>
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-neutral-500">{subjectName(entry.subjectId)}</td>
                    <td className="px-3 py-2.5 text-neutral-500">{yearLabel(entry.academicYearId)}</td>
                    <td className="px-3 py-2.5 text-neutral-500">{entry.studentCount ?? 0}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">{new Date(entry.updatedAt).toLocaleDateString(getActiveLang())}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        className="btn btn-ghost h-7 w-7 p-0 text-red-500"
                        title={t('Eliminar')}
                        aria-label={t('Eliminar')}
                        onClick={(event) => { event.stopPropagation(); setPendingDelete(entry); }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {creating && workspace && (
          <NewGroupModal
            workspace={workspace}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              await guard(async () => {
                const created = await window.nodus.createTeachingGroup(input);
                setCreating(false);
                await reload();
                setGroup(created);
              });
            }}
          />
        )}
        {pendingDelete && (
          <ConfirmModal
            title={t('Eliminar grupo')}
            message={t('Se eliminará este grupo y su listado de alumnado. Esta acción no se puede deshacer.')}
            confirmLabel={t('Eliminar')}
            danger
            onConfirm={async () => {
              await window.nodus.deleteTeachingGroup(pendingDelete.id);
              setPendingDelete(null);
              void reload();
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </div>
    );
  }

  /* ------------------------------------------------------- roster (detail) --- */
  const students = group.students ?? [];
  const anonymised = settings?.studentPseudonymsEnabled ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="group-detail">
      <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-ghost h-8 w-8 p-0" title={t('Volver')} aria-label={t('Volver')} data-testid="group-back" onClick={() => { setGroup(null); void reload(); }}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <div className="mr-auto min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              {subjectName(group.subjectId)} · {yearLabel(group.academicYearId)}
            </p>
            <h1 className="truncate text-xl font-semibold">{group.name}</h1>
            <p className="mt-1 text-xs text-neutral-500">{tx('{n} alumnos en el listado.', { n: students.length })}</p>
          </div>
          <button className="btn btn-ghost h-8" data-testid="group-import" onClick={() => setImporting(true)}>
            <Icon name="copy" size={13} />{t('Importar de otro grupo')}
          </button>
        </div>

        {/* Privacy state, where the data is — not buried three screens away in Settings. */}
        <button
          type="button"
          data-testid="group-privacy-toggle"
          onClick={() => void guard(togglePrivacy)}
          title={t('Cambiar en Ajustes › IA')}
          className={`mt-3 flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[11px] ${
            anonymised
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300'
          }`}
        >
          <Icon name={anonymised ? 'lock' : 'alert'} size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">
              {anonymised ? t('La IA no verá los nombres del alumnado.') : t('La IA verá los nombres reales del alumnado.')}
            </span>{' '}
            {anonymised
              ? t('Se sustituyen por identificadores. No cubre transcripción de audio, análisis de imágenes ni embeddings.')
              : t('Los nombres se enviarán tal cual al proveedor de IA.')}
          </span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error && <p className="pb-3 text-sm text-red-500">{error}</p>}
        {message && <p className="pb-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}

        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-xs" data-testid="student-table">
            <thead className="study-browser-table-head">
              <tr className="text-left">
                {/* All widths are percentages on purpose. Mixing px with % under
                    table-fixed overflows: the fixed columns are added ON TOP of the
                    percentage share, so the last column gets clipped on a wide window. */}
                <th className="w-[5%] px-3 py-2 font-medium">#</th>
                <th className="w-[13%] px-3 py-2 font-medium">{t('Identificador')}</th>
                <th className="w-[19%] px-3 py-2 font-medium">{t('Nombre')}</th>
                <th className="w-[23%] px-3 py-2 font-medium">{t('Apellidos')}</th>
                <th className="px-3 py-2 font-medium">{t('Comentarios')}</th>
                <th className="w-[9%] px-3 py-2 text-right font-medium">{t('Acciones')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student, index) => (
                <tr key={student.id} data-testid={`student-row-${student.id}`} className="border-t border-neutral-200 dark:border-neutral-800/60">
                  <td className="px-3 py-1 text-neutral-500">{index + 1}</td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      data-testid={`student-code-${student.id}`}
                      onClick={() => void guard(() => copyCode(student.pseudonymCode))}
                      title={t('Copiar identificador')}
                      aria-label={tx('Copiar el identificador {code}', { code: student.pseudonymCode })}
                      className="rounded-md bg-indigo-600/15 px-2 py-1 font-mono text-[10px] text-indigo-300 hover:bg-indigo-600/20"
                    >
                      {student.pseudonymCode}
                    </button>
                  </td>
                  <td className="h-9 px-0 py-0">
                    <TextCell
                      value={student.givenNames || null}
                      inputType="text"
                      onChange={(raw) => void guard(async () => {
                        await window.nodus.updateTeachingStudent(student.id, { givenNames: raw ?? '' });
                        await refreshGroup(group.id);
                      })}
                    />
                  </td>
                  <td className="h-9 px-0 py-0">
                    <TextCell
                      value={student.surnames || null}
                      inputType="text"
                      onChange={(raw) => void guard(async () => {
                        await window.nodus.updateTeachingStudent(student.id, { surnames: raw ?? '' });
                        await refreshGroup(group.id);
                      })}
                    />
                  </td>
                  <td className="h-9 px-0 py-0">
                    <LongTextCell
                      value={student.comments || null}
                      markdown={false}
                      emptyLabel={t('Añadir comentario')}
                      onChange={(raw) => void guard(async () => {
                        await window.nodus.updateTeachingStudent(student.id, { comments: raw ?? '' });
                        await refreshGroup(group.id);
                      })}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="btn btn-ghost h-7 w-7 p-0 text-red-500"
                      title={t('Eliminar alumno')}
                      aria-label={t('Eliminar alumno')}
                      onClick={() => void guard(async () => {
                        await window.nodus.deleteTeachingStudent(student.id);
                        await refreshGroup(group.id);
                      })}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {students.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-neutral-500">{t('Este grupo todavía no tiene alumnado.')}</p>
          )}
        </div>

        <button
          className="btn btn-primary mt-3"
          data-testid="student-add"
          disabled={students.length >= MAX_GROUP_SIZE}
          onClick={() => void guard(async () => {
            await window.nodus.addTeachingStudent(group.id, 1);
            await refreshGroup(group.id);
          })}
        >
          <Icon name="plus" />{t('Añadir alumno')}
        </button>
      </div>

      {importing && (
        <ImportModal
          groups={groups.filter((g) => g.id !== group.id)}
          subjectName={subjectName}
          yearLabel={yearLabel}
          onCancel={() => setImporting(false)}
          onImport={async (sourceId) => {
            await guard(async () => {
              await window.nodus.importStudentsFromGroup(group.id, sourceId);
              setImporting(false);
              await refreshGroup(group.id);
              setMessage(t('Alumnado importado. Los comentarios no se copian: son propios de cada asignatura.'));
            });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ modals --- */

function NewGroupModal({
  workspace,
  onCancel,
  onCreate,
}: {
  workspace: StudyWorkspace;
  onCancel: () => void;
  onCreate: (input: { name: string; subjectId: string; academicYearId: string | null; expectedSize: number }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState(workspace.subjects[0]?.id ?? '');
  const [academicYearId, setAcademicYearId] = useState(workspace.academicYears[0]?.id ?? '');
  const [size, setSize] = useState('0');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await onCreate({
      name: name.trim() || t('Grupo'),
      subjectId,
      academicYearId: academicYearId || null,
      expectedSize: clampExpectedSize(size),
    });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4">
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Nuevo grupo')} data-testid="group-new-modal">
        <h2 className="text-base font-semibold">{t('Nuevo grupo')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t('El grupo pertenece a una asignatura y a un curso académico: el año siguiente empezará con el listado vacío.')}</p>

        <label className="mt-4 block text-xs font-medium">{t('Nombre del grupo')}</label>
        <input className="input mt-1 w-full" data-testid="group-name" autoFocus value={name} placeholder={t('Por ejemplo, 1º ESO A')} onChange={(e) => setName(e.target.value)} />

        <label className="mt-3 block text-xs font-medium">{t('Asignatura')}</label>
        <select className="input mt-1 w-full" data-testid="group-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {workspace.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label className="mt-3 block text-xs font-medium">{t('Curso académico')}</label>
        <select className="input mt-1 w-full" data-testid="group-year" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
          {workspace.academicYears.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          <option value="">{t('Sin curso académico')}</option>
        </select>

        <label className="mt-3 block text-xs font-medium">{t('Total de alumnos')}</label>
        <input
          className="input mt-1 w-full"
          data-testid="group-size"
          type="number"
          min={0}
          max={MAX_GROUP_SIZE}
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-neutral-500">{t('Se crearán esas filas vacías para que rellenes el listado. Podrás añadir o quitar después.')}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-testid="group-create" disabled={busy || !subjectId} onClick={() => void submit()}>
            {busy ? t('Creando…') : t('Crear grupo')}
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportModal({
  groups,
  subjectName,
  yearLabel,
  onCancel,
  onImport,
}: {
  groups: TeachingGroup[];
  subjectName: (id: string) => string;
  yearLabel: (id: string | null) => string;
  onCancel: () => void;
  onImport: (sourceId: string) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(groups[0]?.id ?? '');

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4">
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Importar de otro grupo')} data-testid="group-import-modal">
        <h2 className="text-base font-semibold">{t('Importar de otro grupo')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t('Se copiarán los nombres y apellidos al final de este listado. Es una copia: editar un grupo no cambia el otro.')}</p>

        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">{t('No hay otros grupos de los que importar.')}</p>
        ) : (
          <select className="input mt-4 w-full" data-testid="group-import-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {`${g.name} · ${subjectName(g.subjectId)} · ${yearLabel(g.academicYearId)}`}
              </option>
            ))}
          </select>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-testid="group-import-confirm" disabled={!sourceId} onClick={() => void onImport(sourceId)}>
            {t('Importar')}
          </button>
        </div>
      </section>
    </div>
  );
}
