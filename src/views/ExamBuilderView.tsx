import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyWorkspace } from '@shared/studyOrg';
import {
  EXAM_EXPORT_CONTENTS,
  EXAM_LANGUAGES,
  effectiveExamLanguage,
  EXAM_QUESTION_TYPE_DEFS,
  EXAM_SUBQUESTION_TYPE_DEFS,
  MAX_EXAM_LOGOS,
  defaultExamQuestion,
  distributeSectionPoints,
  examQuestionTypeDef,
  examTotalPoints,
  groupExamQuestions,
  isExamSection,
  resizeExamOptions,
  validateExam,
  type ExamBlock,
  type ExamExportContent,
  type ExamLanguage,
  type ExamQuestion,
  type ExamQuestionType,
  type TeachingExam,
  type TeachingExamDetail,
  type TeachingLogo,
} from '@shared/teachingExams';
import { nextIdFor } from '@shared/sequentialIds';
import { renderExamHtml } from '@shared/examHtml';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { t, tx, errorText, getActiveLang } from '../i18n';

const LANGUAGE_LABELS: Record<ExamLanguage, string> = {
  es: 'Español',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  'pt-BR': 'Português (Brasil)',
};

/** Small labelled field so every panel keeps identical label/really-input rhythm. */
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-neutral-500 ${wide ? 'sm:col-span-2' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
      <input type="checkbox" className="accent-indigo-500" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function ExamBuilderView() {
  const [exams, setExams] = useState<TeachingExam[]>([]);
  const [exam, setExam] = useState<TeachingExamDetail | null>(null);
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);
  const [exportContent, setExportContent] = useState<ExamExportContent>('exam');
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [showHeaderPanel, setShowHeaderPanel] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  /** Id of the section whose "add sub-question" menu is open, if any. */
  const [sectionMenu, setSectionMenu] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TeachingExam | null>(null);
  const [message, setMessage] = useState('');

  const reloadList = useCallback(async () => {
    const list = await window.nodus.listTeachingExams();
    setExams(list);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [list, ws] = await Promise.all([window.nodus.listTeachingExams(), window.nodus.getStudyWorkspace()]);
        if (!active) return;
        setExams(list);
        setWorkspace(ws);
      } catch (cause) {
        if (active) setError(errorText(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const openExam = async (id: string) => {
    try {
      setExam(await window.nodus.getTeachingExam(id));
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const patchExam = async (patch: Parameters<typeof window.nodus.updateTeachingExam>[1]) => {
    if (!exam) return;
    try {
      const next = await window.nodus.updateTeachingExam(exam.id, patch);
      setExam(next);
      void reloadList();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const patchQuestion = async (id: string, patch: Parameters<typeof window.nodus.updateTeachingExamQuestion>[1]) => {
    if (!exam) return;
    try {
      const updated = await window.nodus.updateTeachingExamQuestion(id, patch);
      // Functional update on purpose. `exam` here is the snapshot from the render that
      // started this call, and an AI generation takes seconds: rebuilding the exam from
      // it silently reverted everything typed into other questions in the meantime.
      setExam((prev) => (prev ? { ...prev, questions: prev.questions.map((question) => (question.id === id ? updated : question)) } : prev));
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const createExam = async () => {
    try {
      const created = await window.nodus.createTeachingExam({ title: t('Examen sin título'), language: getActiveLang() as ExamLanguage });
      await reloadList();
      setExam(created);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const addQuestion = async (type: ExamQuestionType, parentId: string | null = null) => {
    if (!exam) return;
    setAddOpen(false);
    try {
      const created = await window.nodus.addTeachingExamQuestion(exam.id, { ...defaultExamQuestion(type), parentId });
      setExam({ ...exam, questions: [...exam.questions, created] });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const removeQuestion = async (id: string) => {
    if (!exam) return;
    try {
      await window.nodus.deleteTeachingExamQuestion(id);
      // Deleting a section cascades in the database; drop its sub-questions here too so
      // the list does not show orphans until the next reload.
      setExam({
        ...exam,
        questions: exam.questions
          .filter((question) => question.id !== id && question.parentId !== id)
          .map((question, index) => ({ ...question, position: index })),
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  /**
   * Move a question among its own siblings — inside its section, or among the top-level
   * exercises — by swapping the two flat positions. Reordering the whole flat list
   * instead would let a sub-question drift out of its section.
   */
  const moveQuestion = async (question: ExamQuestion, delta: number) => {
    if (!exam) return;
    const flat = [...exam.questions].sort((a, b) => a.position - b.position);
    const inScope = flat.filter((entry) =>
      question.parentId ? entry.parentId === question.parentId : !entry.parentId || isExamSection(entry.type)
    );
    const index = inScope.findIndex((entry) => entry.id === question.id);
    const swapWith = inScope[index + delta];
    if (!swapWith) return;
    const ids = flat.map((entry) => entry.id);
    const a = ids.indexOf(question.id);
    const b = ids.indexOf(swapWith.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    const byId = new Map(exam.questions.map((entry) => [entry.id, entry]));
    setExam({ ...exam, questions: ids.map((id, position) => ({ ...byId.get(id)!, position })) });
    try {
      await window.nodus.reorderTeachingExamQuestions(exam.id, ids);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  /**
   * Set what a whole exercise is worth: the mark is split across its sub-questions in
   * quarter-point steps. The section itself never stores points, so the exercise total
   * and the sum of its parts cannot drift apart on the printed paper.
   */
  const setSectionTotal = async (block: ExamBlock, total: number) => {
    // `NaN` is what an empty field reads as, and it used to fall through to
    // `Math.max(0, NaN)` and zero every sub-question. Nothing typed is nothing to do.
    if (!exam || !block.questions.length || !Number.isFinite(total)) return;
    const shares = distributeSectionPoints(Math.max(0, total), block.questions.length);
    setExam((prev) => (prev ? {
      ...prev,
      questions: prev.questions.map((entry) => {
        const position = block.questions.findIndex((child) => child.question.id === entry.id);
        return position >= 0 ? { ...entry, points: shares[position] } : entry;
      }),
    } : prev));
    try {
      await Promise.all(
        block.questions.map((child, position) => window.nodus.updateTeachingExamQuestion(child.question.id, { points: shares[position] }))
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const generateQuestion = async (question: ExamQuestion, regenerate: boolean) => {
    if (!exam) return;
    const instruction = question.aiPrompt.trim();
    if (!instruction) {
      setError(t('Escribe qué quieres que genere la IA para esta pregunta.'));
      return;
    }
    setBusyQuestionId(question.id);
    setError('');
    try {
      const result = await window.nodus.generateExamQuestion({
        type: question.type,
        instruction,
        subjectId: exam.subjectId,
        courseId: exam.courseId,
        language: exam.language,
        optionCount: question.options.length || undefined,
        avoidPrompt: regenerate ? question.prompt : undefined,
      });
      await patchQuestion(question.id, {
        prompt: result.question.prompt,
        options: result.question.options,
        pairs: result.question.pairs,
        items: result.question.items,
        imageCaption: result.question.imageCaption,
        solution: result.question.solution,
        generatedBy: 'ai',
      });
      setMessage(result.sourceCount
        ? t('Pregunta generada a partir de los materiales de la asignatura.')
        : t('Pregunta generada sin materiales de referencia.'));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyQuestionId(null);
    }
  };

  const pickImage = async (kind: 'logo' | 'figure', questionId?: string) => {
    if (!exam) return;
    try {
      const picked = await window.nodus.pickExamImage(kind);
      if (!picked) return;
      if (kind === 'logo') {
        await patchExam({ logos: [...exam.logos, { dataUrl: picked.dataUrl, name: picked.name }].slice(0, MAX_EXAM_LOGOS) });
      } else if (questionId) {
        await patchQuestion(questionId, { imageDataUrl: picked.dataUrl });
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const exportExam = async (format: 'docx' | 'pdf') => {
    if (!exam) return;
    // `validateExam` documents itself as blocking export, and nothing enforced it: a
    // paper with an image question and no image printed a blank box for the student.
    const blocking = validateExam(exam, exam.questions);
    if (blocking.length > 0) {
      setError(tx('Revisa {n} avisos antes de exportar.', { n: blocking.length }));
      return;
    }
    setExporting(format);
    setError('');
    try {
      const result = await window.nodus.exportTeachingExam(exam.id, format, { content: exportContent });
      if (result) setMessage(t('Examen descargado.'));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setExporting(null);
    }
  };

  const subjects = workspace?.subjects ?? [];
  const issues = useMemo(() => (exam ? validateExam(exam, exam.questions) : []), [exam]);
  const blocks = useMemo(() => (exam ? groupExamQuestions(exam.questions) : []), [exam]);
  // Section statements are not questions: they must not count towards the target the
  // teacher set, nor towards the "N questions" summary.
  const questionCount = useMemo(
    () => (exam ? exam.questions.filter((question) => !isExamSection(question.type)).length : 0),
    [exam]
  );
  // The preview shows the document exactly as it will print: the teacher's chosen
  // language if they set one, otherwise the interface language.
  // `lang` is in the dependency list because `getActiveLang()` is read INSIDE the memo.
  // Without it the preview kept rendering in the previous language after a switch while
  // the exported file used the new one — and this project has no exhaustive-deps rule
  // to catch that.
  const lang = getActiveLang();
  const previewExam = useMemo(
    () => (exam ? { ...exam, language: effectiveExamLanguage(exam, lang) } : null),
    [exam, lang]
  );
  const previewHtml = useMemo(
    () => (previewExam ? renderExamHtml(previewExam, previewExam.questions, { forPreview: true, content: exportContent }) : ''),
    [previewExam, exportContent]
  );

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (loading) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando exámenes…')} /></div>;

  /* ------------------------------------------------------- exam list ---- */
  if (!exam) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="exam-builder-list">
        <header className="border-b border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{t('Evaluación')}</p>
              <h1 className="text-xl font-semibold">{t('Exámenes')}</h1>
              <p className="mt-1 text-xs text-neutral-500">{t('Construye el examen pregunta a pregunta y descárgalo en Word o PDF.')}</p>
            </div>
            <button data-testid="exam-new" data-tour="exam-new" className="btn btn-primary" onClick={() => void createExam()}><Icon name="plus" />{t('Nuevo examen')}</button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          {exams.length === 0 ? (
            <div className="mx-auto mt-10 max-w-md rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-800">
              <Icon name="notebook" size={26} className="mx-auto mb-3 text-neutral-400" />
              <p className="text-sm text-neutral-500">{t('Todavía no has creado ningún examen.')}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tour="exam-list">
              {exams.map((item) => {
                const subject = subjects.find((entry) => entry.id === item.subjectId);
                return (
                  <article key={item.id} className="card p-4 transition-colors hover:border-indigo-700/60">
                    <button className="block w-full text-left" onClick={() => void openExam(item.id)}>
                      <span className="block truncate text-sm font-semibold">{item.title}</span>
                      <span className="mt-1 block truncate text-xs text-neutral-500">{subject?.name ?? t('Sin asignatura')}</span>
                      <span className="mt-2 block text-[10px] uppercase tracking-wider text-neutral-600">{item.shortId}</span>
                    </button>
                    <div className="mt-3 flex items-center gap-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                      <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => void window.nodus.duplicateTeachingExam(item.id).then(reloadList)}><Icon name="copy" size={12} />{t('Duplicar')}</button>
                      <button className="btn btn-ghost ml-auto h-7 w-7 p-0 text-red-500" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={() => setPendingDelete(item)}><Icon name="trash" size={13} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        {pendingDelete && (
          <ConfirmModal
            title={t('Eliminar examen')}
            message={t('Se eliminará este examen y todas sus preguntas. Esta acción no se puede deshacer.')}
            confirmLabel={t('Eliminar')}
            danger
            onConfirm={async () => {
              await window.nodus.deleteTeachingExam(pendingDelete.id);
              setPendingDelete(null);
              void reloadList();
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </div>
    );
  }

  /* ---------------------------------------------------- exam builder ---- */
  const header = exam.header;
  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="exam-builder">
      <header className="border-b border-neutral-200 bg-white px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost h-8 px-2" onClick={() => setExam(null)} aria-label={t('Volver')} title={t('Volver')}><Icon name="chevronLeft" /></button>
          <input
            data-testid="exam-title"
            className="input h-9 min-w-56 flex-1 text-sm font-semibold"
            value={exam.title}
            onChange={(event) => setExam({ ...exam, title: event.target.value })}
            onBlur={(event) => void patchExam({ title: event.target.value })}
            aria-label={t('Título del examen')}
          />
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            {t('Asignatura')}
            <select
              data-testid="exam-subject"
              className="input h-9 min-w-40 text-xs"
              value={exam.subjectId ?? ''}
              onChange={(event) => {
                const subjectId = event.target.value || null;
                const subject = subjects.find((entry) => entry.id === subjectId);
                void patchExam({ subjectId, courseId: subject?.courseId ?? null, header: { subjectName: subject?.name ?? header.subjectName } });
              }}
            >
              <option value="">{t('Sin asignatura')}</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            {t('Idioma')}
            <select
              className="input h-9 text-xs"
              value={effectiveExamLanguage(exam, getActiveLang())}
              onChange={(event) => void patchExam({ language: event.target.value as ExamLanguage, languageLocked: true })}
              aria-label={t('Idioma del examen')}
              title={exam.languageLocked ? t('Idioma elegido para este examen') : t('Sigue el idioma de la interfaz hasta que elijas uno')}
            >
              {EXAM_LANGUAGES.map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
            </select>
            {exam.languageLocked && (
              <button className="btn btn-ghost h-9 px-2" title={t('Volver a seguir el idioma de la interfaz')} aria-label={t('Volver a seguir el idioma de la interfaz')} onClick={() => void patchExam({ languageLocked: false })}>
                <Icon name="refresh" size={12} />
              </button>
            )}
          </label>
          <button className="btn btn-ghost h-9" disabled={exporting !== null || issues.length > 0}
            title={issues.length > 0 ? t('Resuelve los avisos para poder exportar.') : undefined}
            onClick={() => void exportExam('docx')} data-testid="exam-export-docx">
            {exporting === 'docx' ? <Icon name="sync" className="animate-spin" /> : <Icon name="download" />}Word
          </button>
          <button className="btn btn-primary h-9" disabled={exporting !== null || issues.length > 0}
            title={issues.length > 0 ? t('Resuelve los avisos para poder exportar.') : undefined}
            onClick={() => void exportExam('pdf')} data-testid="exam-export-pdf">
            {exporting === 'pdf' ? <Icon name="sync" className="animate-spin" /> : <Icon name="download" />}PDF
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
          <span>{questionCount} {t('preguntas')} · {examTotalPoints(exam.questions)} {t('puntos')}</span>
          <label className="flex items-center gap-1">
            {t('Descargar')}
            <select data-testid="exam-export-content" className="input h-8 min-w-[11rem] text-xs" value={exportContent} onChange={(event) => setExportContent(event.target.value as ExamExportContent)} aria-label={t('Contenido de la descarga')}>
              {EXAM_EXPORT_CONTENTS.map((value) => (
                <option key={value} value={value}>
                  {value === 'exam' ? t('Solo el examen') : value === 'examWithKey' ? t('Examen y solucionario') : t('Solo el solucionario')}
                </option>
              ))}
            </select>
          </label>
          {issues.length > 0 && <span className="text-amber-600 dark:text-amber-400"><Icon name="alert" size={12} /> {issues.length} {t('avisos')}</span>}
          {message && <span className="text-emerald-600 dark:text-emerald-400">{message}</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* -------- editor column -------- */}
        <div className="min-h-0 overflow-y-auto border-r border-neutral-200 p-5 dark:border-neutral-800">
          <section className="card p-4">
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setShowHeaderPanel((value) => !value)} aria-expanded={showHeaderPanel}>
              <Icon name="chevronRight" size={12} className={`transition-transform ${showHeaderPanel ? 'rotate-90' : ''}`} />
              <h2 className="text-sm font-semibold">{t('Encabezado del examen')}</h2>
            </button>
            {showHeaderPanel && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t('Centro o institución')}>
                  <input className="input w-full" value={header.institution} onChange={(event) => setExam({ ...exam, header: { ...header, institution: event.target.value } })} onBlur={(event) => void patchExam({ header: { institution: event.target.value } })} />
                </Field>
                <Field label={t('Título que aparece en el examen')}>
                  <input className="input w-full" value={header.examTitle} onChange={(event) => setExam({ ...exam, header: { ...header, examTitle: event.target.value } })} onBlur={(event) => void patchExam({ header: { examTitle: event.target.value } })} />
                </Field>
                <Field label={t('Asignatura (como se imprime)')}>
                  <input className="input w-full" value={header.subjectName} onChange={(event) => setExam({ ...exam, header: { ...header, subjectName: event.target.value } })} onBlur={(event) => void patchExam({ header: { subjectName: event.target.value } })} />
                </Field>
                <Field label={t('Profesor o profesores')}>
                  <input className="input w-full" value={header.teachers} onChange={(event) => setExam({ ...exam, header: { ...header, teachers: event.target.value } })} onBlur={(event) => void patchExam({ header: { teachers: event.target.value } })} />
                </Field>
                <Field label={t('Grupo')}>
                  <input className="input w-full" value={header.groupLabel} onChange={(event) => setExam({ ...exam, header: { ...header, groupLabel: event.target.value } })} onBlur={(event) => void patchExam({ header: { groupLabel: event.target.value } })} />
                </Field>
                <Field label={t('Fecha')}>
                  <input className="input w-full" value={header.dateText} onChange={(event) => setExam({ ...exam, header: { ...header, dateText: event.target.value } })} onBlur={(event) => void patchExam({ header: { dateText: event.target.value } })} />
                </Field>
                <Field label={t('Duración (minutos)')}>
                  <input className="input w-full" type="number" min="0" value={header.durationMinutes ?? ''} onChange={(event) => setExam({ ...exam, header: { ...header, durationMinutes: event.target.value ? Number(event.target.value) : null } })} onBlur={(event) => void patchExam({ header: { durationMinutes: event.target.value ? Number(event.target.value) : null } })} />
                </Field>
                <Field label={t('Instrucciones')} wide>
                  <textarea className="input min-h-16 w-full resize-y" value={header.instructions} onChange={(event) => setExam({ ...exam, header: { ...header, instructions: event.target.value } })} onBlur={(event) => void patchExam({ header: { instructions: event.target.value } })} />
                </Field>
                <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
                  <Toggle checked={header.showStudentName} onChange={(value) => void patchExam({ header: { showStudentName: value } })} label={t('Nombre y apellidos')} />
                  <Toggle checked={header.showStudentId} onChange={(value) => void patchExam({ header: { showStudentId: value } })} label={t('DNI / expediente')} />
                  <Toggle checked={header.showGroup} onChange={(value) => void patchExam({ header: { showGroup: value } })} label={t('Grupo')} />
                  <Toggle checked={header.showDate} onChange={(value) => void patchExam({ header: { showDate: value } })} label={t('Fecha')} />
                  <Toggle checked={header.showGradeBox} onChange={(value) => void patchExam({ header: { showGradeBox: value } })} label={t('Casilla de calificación')} />
                  <Toggle checked={header.showPoints} onChange={(value) => void patchExam({ header: { showPoints: value } })} label={t('Mostrar puntuación')} />
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-neutral-500">{t('Logotipos (máximo 2)')}</span>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {exam.logos.map((logo, index) => (
                      <span key={`${logo.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-neutral-200 p-1.5 dark:border-neutral-800">
                        <img src={logo.dataUrl} alt="" className="h-8 w-auto max-w-24 object-contain" />
                        <button className="text-neutral-500 hover:text-red-500" title={t('Quitar')} aria-label={t('Quitar')} onClick={() => void patchExam({ logos: exam.logos.filter((_, i) => i !== index) })}><Icon name="x" size={12} /></button>
                      </span>
                    ))}
                    {exam.logos.length < MAX_EXAM_LOGOS && (
                      <button data-testid="exam-add-logo" className="btn btn-ghost h-8 text-xs" onClick={() => setLogoPickerOpen(true)}><Icon name="image" size={13} />{t('Añadir logotipo')}</button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="mt-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t('Preguntas')}</h2>
            <span className="text-xs text-neutral-500">{questionCount}/{exam.targetQuestionCount}</span>
            <label className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
              {t('Total previsto')}
              <input className="input h-7 w-16 text-xs" type="number" min="1" max="100" value={exam.targetQuestionCount} onChange={(event) => setExam({ ...exam, targetQuestionCount: Number(event.target.value) })} onBlur={(event) => void patchExam({ targetQuestionCount: Number(event.target.value) })} />
            </label>
          </div>

          <div className="mt-3 space-y-3">
            {blocks.map((block, blockIndex) => {
              const cardFor = (question: ExamQuestion, number: string, canUp: boolean, canDown: boolean) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  number={number}
                  canMoveUp={canUp}
                  canMoveDown={canDown}
                  busy={busyQuestionId === question.id}
                  issues={issues.filter((issue) => issue.questionId === question.id)}
                  onPatch={(patch) => void patchQuestion(question.id, patch)}
                  onLocalChange={(next) => setExam({ ...exam, questions: exam.questions.map((entry) => (entry.id === question.id ? next : entry)) })}
                  onGenerate={(regenerate) => void generateQuestion(question, regenerate)}
                  onPickImage={() => void pickImage('figure', question.id)}
                  onMove={(delta) => void moveQuestion(question, delta)}
                  onDelete={() => void removeQuestion(question.id)}
                />
              );
              if (!block.section) {
                const only = block.questions[0];
                return only ? cardFor(only.question, only.number, blockIndex > 0, blockIndex < blocks.length - 1) : null;
              }
              return (
                <section key={block.section.id} className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.04] p-2.5" data-testid={`exam-section-${block.number}`}>
                  {cardFor(block.section, block.number, blockIndex > 0, blockIndex < blocks.length - 1)}
                  <div className="mt-2.5 flex items-center gap-2 pl-3">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Preguntas del enunciado')}</span>
                    <label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-500" title={t('Se reparte entre las preguntas de este enunciado')}>
                      {t('Total del enunciado')}
                      {/* Uncontrolled and committed on blur: writing on every keystroke
                          meant typing "10" over "4" passed through 1 first, and clearing
                          the field to retype it zeroed every sub-question. `key` remounts
                          it when the real total changes elsewhere, so it stays truthful. */}
                      <input
                        data-testid={`exam-section-total-${block.number}`}
                        className="input h-6 w-16 px-1.5 text-xs"
                        type="number"
                        min="0"
                        step="0.25"
                        disabled={!block.questions.length}
                        key={`section-total-${block.number}-${block.points}`}
                        defaultValue={block.points}
                        onBlur={(event) => {
                          if (event.target.value.trim() === '') return;
                          void setSectionTotal(block, Number(event.target.value));
                        }}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                      />
                    </label>
                  </div>
                  <div className="mt-2 space-y-2 border-l-2 border-indigo-500/20 pl-3">
                    {block.questions.map((entry, childIndex) =>
                      cardFor(entry.question, entry.number, childIndex > 0, childIndex < block.questions.length - 1)
                    )}
                    {!block.questions.length && (
                      <p className="py-1 text-[11px] text-neutral-500">{t('Añade al menos una pregunta dentro del enunciado.')}</p>
                    )}
                    <div className="relative">
                      <button
                        data-testid={`exam-section-add-${block.number}`}
                        className="btn btn-ghost h-7 w-full text-xs"
                        onClick={() => setSectionMenu((current) => (current === block.section!.id ? null : block.section!.id))}
                      >
                        <Icon name="plus" size={11} />{t('Añadir pregunta a este enunciado')}
                      </button>
                      {sectionMenu === block.section.id && (
                        <div className="card-modal absolute bottom-full left-0 z-20 mb-2 w-full p-2">
                          <div className="grid gap-1 sm:grid-cols-2">
                            {EXAM_SUBQUESTION_TYPE_DEFS.map((def) => (
                              <button
                                key={def.id}
                                data-testid={`exam-subtype-${def.id}`}
                                className="flex items-start gap-2 rounded-lg p-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                onClick={() => { setSectionMenu(null); void addQuestion(def.id, block.section!.id); }}
                              >
                                <Icon name={def.icon} size={14} className="mt-0.5 text-indigo-400" />
                                <span>
                                  <span className="block text-xs font-medium">{t(def.label)}</span>
                                  <span className="block text-[10px] leading-4 text-neutral-500">{t(def.description)}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <div className="relative mt-4">
            <button data-testid="exam-add-question" className="btn btn-primary w-full" onClick={() => setAddOpen((value) => !value)}>
              <Icon name="plus" />{t('Añadir pregunta')}
            </button>
            {addOpen && (
              <div className="card-modal absolute bottom-full left-0 z-20 mb-2 w-full p-2" data-testid="exam-type-menu">
                <div className="grid gap-1 sm:grid-cols-2">
                  {EXAM_QUESTION_TYPE_DEFS.map((def) => (
                    <button key={def.id} data-testid={`exam-type-${def.id}`} className="flex items-start gap-2 rounded-lg p-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => void addQuestion(def.id)}>
                      <Icon name={def.icon} size={14} className="mt-0.5 text-indigo-400" />
                      <span>
                        <span className="block text-xs font-medium">{t(def.label)}</span>
                        <span className="block text-[10px] leading-4 text-neutral-500">{t(def.description)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {logoPickerOpen && (
        <LogoLibraryModal
          onClose={() => setLogoPickerOpen(false)}
          onPick={async (logo) => {
            setLogoPickerOpen(false);
            await patchExam({ logos: [...exam.logos, { dataUrl: logo.dataUrl, name: logo.name }].slice(0, MAX_EXAM_LOGOS) });
          }}
          onError={setError}
        />
      )}

      {/* -------- live preview -------- */}
        <div className="hidden min-h-0 flex-col bg-neutral-100 dark:bg-neutral-900 lg:flex">
          <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
            <Icon name="book" size={13} />{t('Vista previa')}
          </div>
          <iframe
            data-testid="exam-preview"
            title={t('Vista previa')}
            className="min-h-0 flex-1 border-0 bg-neutral-100"
            sandbox=""
            srcDoc={previewHtml}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ question card ---- */

function QuestionCard({
  question,
  number,
  canMoveUp,
  canMoveDown,
  busy,
  issues,
  onPatch,
  onLocalChange,
  onGenerate,
  onPickImage,
  onMove,
  onDelete,
}: {
  question: ExamQuestion;
  /** `3` or `3.2` — the number the printed paper will show. */
  number: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  issues: Array<{ message: string }>;
  onPatch: (patch: Partial<ExamQuestion>) => void;
  onLocalChange: (next: ExamQuestion) => void;
  onGenerate: (regenerate: boolean) => void;
  onPickImage: () => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const def = examQuestionTypeDef(question.type);
  const section = def.isSection === true;
  const local = (patch: Partial<ExamQuestion>) => onLocalChange({ ...question, ...patch });

  return (
    <article className={section ? 'card border-transparent bg-transparent p-0 shadow-none' : 'card p-3'} data-testid={`exam-question-${number}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-indigo-600/15 px-1 text-[11px] font-semibold text-indigo-300">{number}</span>
        <span className="flex items-center gap-1 text-xs font-medium"><Icon name={def.icon} size={12} />{t(def.label)}</span>
        {question.generatedBy === 'ai' && <span className="rounded-full bg-indigo-600/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-indigo-300">{t('IA')}</span>}
        {/* A section's mark is the sum of its sub-questions, so it has no points field. */}
        {!section && (
          <label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-500">
            {t('Puntos')}
            <input className="input h-6 w-14 px-1.5 text-xs" type="number" min="0" step="0.25" value={question.points}
              onChange={(event) => local({ points: Number(event.target.value) })}
              onBlur={(event) => onPatch({ points: Number(event.target.value) })} />
          </label>
        )}
        <button className={`btn btn-ghost h-6 w-6 p-0 ${section ? 'ml-auto' : ''}`} disabled={!canMoveUp} title={t('Subir')} aria-label={t('Subir')} onClick={() => onMove(-1)}><Icon name="chevronUp" size={12} /></button>
        <button className="btn btn-ghost h-6 w-6 p-0" disabled={!canMoveDown} title={t('Bajar')} aria-label={t('Bajar')} onClick={() => onMove(1)}><Icon name="chevronDown" size={12} /></button>
        <button className="btn btn-ghost h-6 w-6 p-0 text-red-500" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={onDelete}><Icon name="trash" size={12} /></button>
      </div>

      <textarea
        data-testid={`exam-question-prompt-${number}`}
        className="input mt-2 min-h-16 w-full resize-y text-sm"
        placeholder={section ? t('Escribe el texto, el caso o la fuente común…') : t('Escribe el enunciado o genéralo con IA…')}
        value={question.prompt}
        onChange={(event) => local({ prompt: event.target.value })}
        onBlur={(event) => onPatch({ prompt: event.target.value })}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          data-testid={`exam-question-ai-${number}`}
          className="input h-8 min-w-40 flex-1 text-xs"
          placeholder={t('Indica a la IA qué debe preguntar…')}
          value={question.aiPrompt}
          onChange={(event) => local({ aiPrompt: event.target.value })}
          onBlur={(event) => onPatch({ aiPrompt: event.target.value })}
        />
        <button className="btn btn-ghost h-8 text-xs" disabled={busy} onClick={() => onGenerate(false)}>
          {busy ? <Icon name="sync" size={12} className="animate-spin" /> : <Icon name="wand" size={12} />}{t('Generar')}
        </button>
        {question.prompt.trim() && (
          <button className="btn btn-ghost h-8 text-xs" disabled={busy} onClick={() => onGenerate(true)} title={t('Generar una alternativa distinta')}>
            <Icon name="refresh" size={12} />{t('Regenerar')}
          </button>
        )}
      </div>

      {/* type-specific editors */}
      {def.needsOptions && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2 text-[10px] text-neutral-500">
            {t('Opciones')}
            {/* Uncontrolled, committed on blur. Resizing on every keystroke meant typing
                "10" over "4" was read as "1" first, clamped to 2, and options 3 and 4
                were deleted with whatever had been written in them. */}
            <input className="input h-6 w-14 px-1.5 text-xs" type="number" min="2" max="10"
              key={`options-${question.id}-${question.options.length}`}
              defaultValue={question.options.length}
              onBlur={(event) => {
                if (event.target.value.trim() === '') return;
                onPatch({ options: resizeExamOptions(question.options, Number(event.target.value)) });
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <span>{t('Marca la correcta')}</span>
          </div>
          {question.options.map((option, optionIndex) => (
            <div key={option.id} className="flex items-center gap-2">
              <input type="radio" name={`correct-${question.id}`} className="accent-indigo-500" checked={option.correct}
                onChange={() => onPatch({ options: question.options.map((entry, i) => ({ ...entry, correct: i === optionIndex })) })} />
              <input className="input h-7 flex-1 text-xs" value={option.text} placeholder={`${t('Opción')} ${optionIndex + 1}`}
                onChange={(event) => local({ options: question.options.map((entry, i) => (i === optionIndex ? { ...entry, text: event.target.value } : entry)) })}
                onBlur={(event) => onPatch({ options: question.options.map((entry, i) => (i === optionIndex ? { ...entry, text: event.target.value } : entry)) })} />
            </div>
          ))}
        </div>
      )}

      {def.needsPairs && (
        <div className="mt-2 space-y-1">
          <span className="text-[10px] text-neutral-500">{t('Parejas para relacionar')}</span>
          {question.pairs.map((pair, pairIndex) => (
            <div key={pair.id} className="flex items-center gap-2">
              <input className="input h-7 flex-1 text-xs" value={pair.left} placeholder={t('Columna A')}
                onChange={(event) => local({ pairs: question.pairs.map((entry, i) => (i === pairIndex ? { ...entry, left: event.target.value } : entry)) })}
                onBlur={(event) => onPatch({ pairs: question.pairs.map((entry, i) => (i === pairIndex ? { ...entry, left: event.target.value } : entry)) })} />
              <Icon name="network" size={11} className="shrink-0 text-neutral-500" />
              <input className="input h-7 flex-1 text-xs" value={pair.right} placeholder={t('Columna B')}
                onChange={(event) => local({ pairs: question.pairs.map((entry, i) => (i === pairIndex ? { ...entry, right: event.target.value } : entry)) })}
                onBlur={(event) => onPatch({ pairs: question.pairs.map((entry, i) => (i === pairIndex ? { ...entry, right: event.target.value } : entry)) })} />
              <button className="btn btn-ghost h-7 w-7 p-0 text-red-500" title={t('Quitar')} aria-label={t('Quitar')} onClick={() => onPatch({ pairs: question.pairs.filter((_, i) => i !== pairIndex) })}><Icon name="x" size={11} /></button>
            </div>
          ))}
          <button className="btn btn-ghost h-7 text-xs" onClick={() => onPatch({ pairs: [...question.pairs, { id: nextIdFor('P', question.pairs), left: '', right: '' }] })}><Icon name="plus" size={11} />{t('Añadir pareja')}</button>
        </div>
      )}

      {def.needsItems && (
        <div className="mt-2 space-y-1">
          <span className="text-[10px] text-neutral-500">{t('Elementos en el orden correcto')}</span>
          {question.items.map((item, itemIndex) => (
            <div key={itemIndex} className="flex items-center gap-2">
              <span className="w-4 text-center text-[10px] text-neutral-500">{itemIndex + 1}</span>
              <input className="input h-7 flex-1 text-xs" value={item}
                onChange={(event) => local({ items: question.items.map((entry, i) => (i === itemIndex ? event.target.value : entry)) })}
                onBlur={(event) => onPatch({ items: question.items.map((entry, i) => (i === itemIndex ? event.target.value : entry)) })} />
              <button className="btn btn-ghost h-7 w-7 p-0 text-red-500" title={t('Quitar')} aria-label={t('Quitar')} onClick={() => onPatch({ items: question.items.filter((_, i) => i !== itemIndex) })}><Icon name="x" size={11} /></button>
            </div>
          ))}
          <button className="btn btn-ghost h-7 text-xs" onClick={() => onPatch({ items: [...question.items, ''] })}><Icon name="plus" size={11} />{t('Añadir elemento')}</button>
        </div>
      )}

      {(def.needsImage || def.allowsImage) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {question.imageDataUrl ? (
            <>
              <img src={question.imageDataUrl} alt="" className="h-16 w-auto max-w-40 rounded border border-neutral-200 object-contain dark:border-neutral-800" />
              <button className="btn btn-ghost h-7 text-xs text-red-500" onClick={() => onPatch({ imageDataUrl: null })}><Icon name="x" size={11} />{t('Quitar imagen')}</button>
            </>
          ) : (
            <button data-testid={`exam-question-image-${number}`} className="btn btn-ghost h-8 text-xs" onClick={onPickImage}><Icon name="image" size={13} />{t('Insertar imagen')}</button>
          )}
          <input className="input h-7 min-w-32 flex-1 text-xs" placeholder={t('Pie de imagen')} value={question.imageCaption}
            onChange={(event) => local({ imageCaption: event.target.value })}
            onBlur={(event) => onPatch({ imageCaption: event.target.value })} />
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {issues.map((issue) => <li key={issue.message} className="text-[10px] text-amber-600 dark:text-amber-400"><Icon name="alert" size={10} /> {t(issue.message)}</li>)}
        </ul>
      )}
    </article>
  );
}

/* -------------------------------------------------- logo library picker ---- */

/**
 * Two ways to put a crest on an exam: reuse one already in the vault's library, or
 * import a new file — which is downscaled on the way in and added to the library, so
 * the next exam only needs one click.
 */
function LogoLibraryModal({
  onClose,
  onPick,
  onError,
}: {
  onClose: () => void;
  onPick: (logo: TeachingLogo) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [logos, setLogos] = useState<TeachingLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLogos(await window.nodus.listTeachingLogos());
    } catch (cause) {
      onError(errorText(cause));
    }
  }, [onError]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const importNew = async () => {
    setImporting(true);
    try {
      const added = await window.nodus.importTeachingLogo();
      if (added) {
        await reload();
        await onPick(added);
      }
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) onClose(); }}>
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-label={t('Logotipos')} data-testid="logo-library">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600/15 text-indigo-300"><Icon name="image" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t('Logotipos')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Reutiliza un logotipo de tu biblioteca o sube uno nuevo. Se guardará para los próximos exámenes.')}</p>
          </div>
          <button className="btn btn-ghost h-7 w-7 p-0" onClick={onClose} disabled={importing} aria-label={t('Cerrar')}><Icon name="x" size={13} /></button>
        </div>

        <div className="mt-4 min-h-24">
          {loading ? (
            <div className="grid h-24 place-items-center"><Spinner /></div>
          ) : logos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-xs text-neutral-500 dark:border-neutral-800">
              {t('Tu biblioteca de logotipos está vacía.')}
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {logos.map((logo) => (
                <div key={logo.id} className="group relative rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                  <button
                    data-testid={`logo-pick-${logo.id}`}
                    className="grid h-14 w-full place-items-center"
                    title={logo.name}
                    onClick={() => void onPick(logo)}
                  >
                    <img src={logo.dataUrl} alt={logo.name} className="max-h-14 max-w-full object-contain" />
                  </button>
                  <span className="mt-1 block truncate text-center text-[9px] text-neutral-500">{logo.name}</span>
                  <button
                    className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-neutral-500 hover:text-red-500 group-hover:block"
                    title={t('Quitar de la biblioteca')}
                    aria-label={t('Quitar de la biblioteca')}
                    onClick={() => void window.nodus.deleteTeachingLogo(logo.id).then(reload).catch((cause) => onError(errorText(cause)))}
                  >
                    <Icon name="trash" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={importing}>{t('Cancelar')}</button>
          <button data-testid="logo-import" className="btn btn-primary" disabled={importing} onClick={() => void importNew()}>
            {importing ? <><Icon name="sync" className="animate-spin" />{t('Importando…')}</> : <><Icon name="plus" />{t('Subir nuevo')}</>}
          </button>
        </div>
      </section>
    </div>
  );
}
