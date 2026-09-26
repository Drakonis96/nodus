import { useEffect, useState } from 'react';
import type { StudyWorkspace } from '@shared/studyOrg';
import { studentFullName, type TeachingGroup, type TeachingStudent } from '@shared/teachingGroups';
import {
  buildAttendanceExport,
  dayRange,
  isDayKey,
  isWeekend,
  parseDayKey,
  weekdayIndex,
  type AttendanceExportGroup,
  type AttendanceExportLabels,
} from '@shared/teachingAttendance';
import { Icon, ModalBackdrop, Spinner } from './ui';
import { t, tx, errorText, getActiveLang } from '../i18n';

type Scope = 'course' | 'subject' | 'group' | 'student';
type Period = 'week' | 'month' | 'year' | 'range';

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

/** Every header and code of the file, in the interface language. */
function exportLabels(): AttendanceExportLabels {
  const lang = getActiveLang();
  return {
    course: t('Curso'),
    subject: t('Asignatura'),
    group: t('Grupo'),
    code: t('Identificador'),
    student: t('Alumno'),
    present: t('Asiste'),
    justified: t('Falta justificada'),
    unjustified: t('Falta injustificada'),
    late: t('Retraso'),
    recorded: t('Días registrados'),
    rate: t('% asistencia'),
    summarySheet: t('Resumen'),
    holidayCode: t('Festivo'),
    // Short codes for the day columns; the legend is the column headers of the totals.
    codes: { present: t('A'), justified: t('FJ'), unjustified: t('FI'), late: t('R') },
    formatDay: (day) =>
      `${t(WEEKDAY_SHORT[weekdayIndex(day)])} ${parseDayKey(day).toLocaleDateString(lang, { day: '2-digit', month: '2-digit' })}`,
  };
}

/**
 * Attendance export: which students (a course, a subject, a group or one student),
 * which days (the visible week or month, the whole academic year, or a range), and
 * how (CSV or XLSX, day by day or totals only, with or without names).
 */
export function AttendanceExportModal({
  group,
  groups,
  workspace,
  visibleDays,
  mode,
  includeWeekend: initialWeekend,
  onClose,
  onDone,
}: {
  group: TeachingGroup;
  groups: TeachingGroup[];
  workspace: StudyWorkspace;
  visibleDays: string[];
  mode: 'week' | 'month';
  includeWeekend: boolean;
  onClose: () => void;
  onDone: (path: string) => void;
}) {
  const subjectOf = (id: string) => workspace.subjects.find((s) => s.id === id) ?? null;
  const [scope, setScope] = useState<Scope>('group');
  const [courseId, setCourseId] = useState(subjectOf(group.subjectId)?.courseId ?? workspace.courses[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(group.subjectId);
  const [groupId, setGroupId] = useState(group.id);
  const [studentId, setStudentId] = useState(group.students?.[0]?.id ?? '');
  const [roster, setRoster] = useState<TeachingStudent[]>(group.students ?? []);
  // '' = every academic year; 'none' = the groups that have none.
  const [yearId, setYearId] = useState(group.academicYearId ?? 'none');
  const [period, setPeriod] = useState<Period>(mode);
  const [from, setFrom] = useState(visibleDays[0]);
  const [to, setTo] = useState(visibleDays[visibleDays.length - 1]);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [layout, setLayout] = useState<'detail' | 'summary'>('detail');
  const [pseudonymOnly, setPseudonymOnly] = useState(false);
  const [includeWeekend, setIncludeWeekend] = useState(initialWeekend);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The student list follows the group chosen for the "one student" scope.
  useEffect(() => {
    if (scope !== 'student') return;
    if (groupId === group.id) {
      setRoster(group.students ?? []);
      setStudentId((current) => (group.students ?? []).some((s) => s.id === current) ? current : group.students?.[0]?.id ?? '');
      return;
    }
    let active = true;
    void window.nodus.getTeachingGroup(groupId).then((detail) => {
      if (!active) return;
      setRoster(detail.students ?? []);
      setStudentId(detail.students?.[0]?.id ?? '');
    }).catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [scope, groupId, group]);

  const year = workspace.academicYears.find((y) => y.id === (scope === 'group' || scope === 'student'
    ? groups.find((g) => g.id === groupId)?.academicYearId
    : yearId)) ?? null;
  const inYear = (g: TeachingGroup) => !yearId || (yearId === 'none' ? g.academicYearId === null : g.academicYearId === yearId);

  const scopedGroups = (): TeachingGroup[] => {
    if (scope === 'course') return groups.filter((g) => subjectOf(g.subjectId)?.courseId === courseId && inYear(g));
    if (scope === 'subject') return groups.filter((g) => g.subjectId === subjectId && inYear(g));
    return groups.filter((g) => g.id === groupId);
  };

  const range = (): [string, string] | null => {
    if (period === 'week' || period === 'month') return [visibleDays[0], visibleDays[visibleDays.length - 1]];
    if (period === 'year') return year ? [year.startDate, year.endDate] : null;
    return isDayKey(from) && isDayKey(to) ? [from, to] : null;
  };

  const scopeName = (): string => {
    if (scope === 'course') return workspace.courses.find((c) => c.id === courseId)?.name ?? '';
    if (scope === 'subject') return subjectOf(subjectId)?.name ?? '';
    const g = groups.find((entry) => entry.id === groupId);
    if (scope === 'group') return g?.name ?? '';
    const student = roster.find((s) => s.id === studentId);
    return student ? studentFullName(student) || student.pseudonymCode : '';
  };

  const run = async () => {
    setError('');
    const bounds = range();
    const targets = scopedGroups();
    if (!bounds) {
      setError(t('Elige un periodo válido.'));
      return;
    }
    if (!targets.length || (scope === 'student' && !studentId)) {
      setError(t('No hay alumnado en esa selección.'));
      return;
    }
    setBusy(true);
    try {
      const data = await window.nodus.getAttendanceExportData({ groupIds: targets.map((g) => g.id), from: bounds[0], to: bounds[1] });
      const days = dayRange(bounds[0], bounds[1]).filter((day) => includeWeekend || !isWeekend(day));
      const exportGroups: AttendanceExportGroup[] = data.map((entry) => {
        const subject = subjectOf(entry.group.subjectId);
        return {
          groupName: entry.group.name,
          subjectName: subject?.name ?? '',
          courseName: workspace.courses.find((c) => c.id === subject?.courseId)?.name ?? '',
          students: entry.students.map((s) => ({ id: s.id, code: s.pseudonymCode, name: studentFullName(s) })),
          records: entry.records,
          holidays: entry.holidays,
        };
      });
      const tables = buildAttendanceExport(exportGroups, {
        days,
        layout,
        pseudonymOnly,
        studentId: scope === 'student' ? studentId : null,
        labels: exportLabels(),
      });
      if (!tables.sheets.length) {
        setError(t('No hay alumnado en esa selección.'));
        return;
      }
      // The file name never carries a student's name when names were left out.
      const who = scope === 'student' && pseudonymOnly ? roster.find((s) => s.id === studentId)?.pseudonymCode ?? '' : scopeName();
      const saved = await window.nodus.exportAttendance(format, tables, `${t('Asistencia')} ${who} ${bounds[0]} ${bounds[1]}`.trim());
      if (saved) onDone(saved.path);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const yearChoices = (
    <label className="block text-xs font-medium">
      {t('Curso académico')}
      <select className="input mt-1 w-full" data-testid="attendance-export-year" value={yearId} onChange={(e) => setYearId(e.target.value)}>
        {workspace.academicYears.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        <option value="none">{t('Sin curso académico')}</option>
        <option value="">{t('Todos los cursos académicos')}</option>
      </select>
    </label>
  );

  return (
    <ModalBackdrop onClose={() => { if (!busy) onClose(); }} zIndex={160}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Exportar asistencia')} data-testid="attendance-export-modal">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600/15 text-indigo-300"><Icon name="download" /></span>
          <div>
            <h2 className="text-base font-semibold">{t('Exportar asistencia')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Elige qué alumnado, qué días y en qué formato.')}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block text-xs font-medium">
            {t('Ámbito')}
            <select className="input mt-1 w-full" data-testid="attendance-export-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="course">{t('Un curso')}</option>
              <option value="subject">{t('Una asignatura')}</option>
              <option value="group">{t('Un grupo')}</option>
              <option value="student">{t('Un alumno')}</option>
            </select>
          </label>

          {scope === 'course' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium">
                {t('Curso')}
                <select className="input mt-1 w-full" data-testid="attendance-export-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  {workspace.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              {yearChoices}
            </div>
          )}
          {scope === 'subject' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium">
                {t('Asignatura')}
                <select className="input mt-1 w-full" data-testid="attendance-export-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  {workspace.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              {yearChoices}
            </div>
          )}
          {(scope === 'group' || scope === 'student') && (
            <div className={`grid gap-3 ${scope === 'student' ? 'sm:grid-cols-2' : ''}`}>
              <label className="block text-xs font-medium">
                {t('Grupo')}
                <select className="input mt-1 w-full" data-testid="attendance-export-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {`${g.name} · ${subjectOf(g.subjectId)?.name ?? ''}${g.academicYearId ? ` · ${workspace.academicYears.find((y) => y.id === g.academicYearId)?.label ?? ''}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              {scope === 'student' && (
                <label className="block text-xs font-medium">
                  {t('Alumno')}
                  <select className="input mt-1 w-full" data-testid="attendance-export-student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                    {roster.map((s) => <option key={s.id} value={s.id}>{studentFullName(s) || s.pseudonymCode}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <label className="block text-xs font-medium">
            {t('Periodo')}
            <select className="input mt-1 w-full" data-testid="attendance-export-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="week">{t('La semana visible')}</option>
              <option value="month">{t('El mes visible')}</option>
              <option value="year" disabled={!year}>{year ? tx('Curso académico completo ({label})', { label: year.label }) : t('Curso académico completo')}</option>
              <option value="range">{t('Rango de fechas')}</option>
            </select>
          </label>
          {period === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium">
                {t('Desde')}
                <input type="date" className="input mt-1 w-full" data-testid="attendance-export-from" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block text-xs font-medium">
                {t('Hasta')}
                <input type="date" className="input mt-1 w-full" data-testid="attendance-export-to" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              {t('Formato')}
              <select className="input mt-1 w-full" data-testid="attendance-export-format" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv')}>
                <option value="xlsx">XLSX</option>
                <option value="csv">CSV</option>
              </select>
            </label>
            <label className="block text-xs font-medium">
              {t('Contenido')}
              <select className="input mt-1 w-full" data-testid="attendance-export-layout" value={layout} onChange={(e) => setLayout(e.target.value as 'detail' | 'summary')}>
                <option value="detail">{t('Detalle por día')}</option>
                <option value="summary">{t('Solo resumen')}</option>
              </select>
            </label>
          </div>

          <div className="grid gap-1.5 text-xs">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" className="accent-indigo-400" data-testid="attendance-export-pseudonym" checked={pseudonymOnly} onChange={(e) => setPseudonymOnly(e.target.checked)} />
              {t('Solo identificadores (sin nombres)')}
            </label>
            {layout === 'detail' && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="accent-indigo-400" data-testid="attendance-export-weekend" checked={includeWeekend} onChange={(e) => setIncludeWeekend(e.target.checked)} />
                {t('Incluir fin de semana')}
              </label>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-500" data-testid="attendance-export-error">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button type="button" className="btn btn-primary" data-testid="attendance-export-run" onClick={() => { if (!busy) void run(); }}>
            {busy ? <Spinner label={t('Generando…')} /> : <><Icon name="download" />{t('Descargar')}</>}
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
