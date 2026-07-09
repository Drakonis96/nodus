import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  ChapterExportFormat,
  ChapterRelationsProgress,
  ChapterRelationsResult,
  ChapterIdeaRelation,
  ChapterRelationType,
  ChapterSuggestionMode,
  ChapterSuggestionStatus,
  ManuscriptClaimCheck,
  ManuscriptClaimStatus,
  ManuscriptEvidenceCandidate,
  ManuscriptVerificationResult,
  Project,
  ProjectChapter,
  ProjectChapterVersion,
  ProjectDetail,
  ProjectExportFormat,
  ProjectInsertionSuggestion,
  ProjectKind,
  ProjectSectionRole,
  ProjectSectionStatus,
} from '@shared/types';
import { buildProjectGuide, type ProjectGuide, type ProjectGuideAction, type ProjectGuideStepStatus } from '@shared/projectGuide';
import { Icon } from '../components/ui';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { ProjectGuideStepModal } from '../components/ProjectGuideStepModal';
import { notifyDataChanged, useDataRefresh } from '../hooks';
import { t, tx } from '../i18n';

type ChapterTab = 'texto' | 'relaciones' | 'verificacion' | 'sugerencias' | 'versiones' | 'exportar';

const PROJECT_KIND_OPTIONS: { value: ProjectKind; label: string }[] = [
  { value: 'thesis', label: 'Tesis' },
  { value: 'article', label: 'Articulo' },
  { value: 'chapter', label: 'Capitulo' },
  { value: 'literature_review', label: 'Revision' },
  { value: 'theoretical_framework', label: 'Marco teorico' },
  { value: 'other', label: 'Otro' },
];

export function ProjectsView({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapterMarkdown, setChapterMarkdown] = useState('');
  const [suggestions, setSuggestions] = useState<ProjectInsertionSuggestion[]>([]);
  const [versions, setVersions] = useState<ProjectChapterVersion[]>([]);
  const [relations, setRelations] = useState<ChapterRelationsResult | null>(null);
  const [relationsProgress, setRelationsProgress] = useState<ChapterRelationsProgress | null>(null);
  const [verification, setVerification] = useState<ManuscriptVerificationResult | null>(null);
  const [tab, setTab] = useState<ChapterTab>('texto');
  const [mode, setMode] = useState<ChapterSuggestionMode>('suggest');
  const [chapterExportFormat, setChapterExportFormat] = useState<ChapterExportFormat>('markdown');
  const [projectExportFormat, setProjectExportFormat] = useState<ProjectExportFormat>('markdown');
  const [newTitle, setNewTitle] = useState('');
  const [newBrief, setNewBrief] = useState('');
  const [newKind, setNewKind] = useState<ProjectKind>('thesis');
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);

  const selectedChapter = useMemo(
    () => detail?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? detail?.chapters[0] ?? null,
    [detail, selectedChapterId]
  );

  const manuscriptSection = useMemo(
    () => detail?.sections.find((section) => section.role === 'manuscript') ?? detail?.sections[0] ?? null,
    [detail]
  );

  const guide = useMemo(() => (detail ? buildProjectGuide(detail) : null), [detail]);

  const loadProjects = useCallback(async () => {
    const list = await window.nodus.listProjects();
    setProjects(list);
    setActiveId((current) => current ?? list[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      setSelectedChapterId(null);
      return;
    }
    const next = await window.nodus.getProject(id);
    setDetail(next);
    const firstChapter = next?.chapters[0] ?? null;
    setSelectedChapterId((current) => {
      if (current && next?.chapters.some((chapter) => chapter.id === current)) return current;
      return firstChapter?.id ?? null;
    });
  }, []);

  const loadChapterArtifacts = useCallback(async (chapter: ProjectChapter | null) => {
    if (!chapter) {
      setChapterMarkdown('');
      setSuggestions([]);
      setVersions([]);
      setRelations(null);
      setVerification(null);
      return;
    }
    setChapterMarkdown(chapter.currentMarkdown);
    setVerification(null);
    const [nextSuggestions, nextVersions, nextRelations] = await Promise.all([
      window.nodus.listProjectChapterSuggestions(chapter.id),
      window.nodus.listProjectChapterVersions(chapter.id),
      window.nodus.getChapterRelations(chapter.id),
    ]);
    setSuggestions(nextSuggestions);
    setVersions(nextVersions);
    setRelations(nextRelations);
  }, []);

  useEffect(() => {
    return window.nodus.onChapterRelationsProgress((p) => {
      if (selectedChapterId && p.chapterId === selectedChapterId) setRelationsProgress(p);
    });
  }, [selectedChapterId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);
  useDataRefresh(loadProjects);

  useEffect(() => {
    void loadDetail(activeId);
  }, [activeId, loadDetail]);

  useEffect(() => {
    void loadChapterArtifacts(selectedChapter);
  }, [selectedChapter, loadChapterArtifacts]);

  useEffect(() => {
    setEditingStepId(null);
  }, [detail?.project.id]);

  const refreshActiveProject = useCallback(async () => {
    await loadProjects();
    await loadDetail(activeId);
    if (selectedChapter) await loadChapterArtifacts(selectedChapter);
  }, [activeId, loadChapterArtifacts, loadDetail, loadProjects, selectedChapter]);

  const sectionByRole = useCallback(
    (role: ProjectSectionRole) => detail?.sections.find((section) => section.role === role) ?? null,
    [detail]
  );

  const createProject = async () => {
    if (!newTitle.trim()) return;
    setBusy('create');
    try {
      const created = await window.nodus.createProject({
        title: newTitle,
        kind: newKind,
        brief: newBrief,
        model: settings.defaultModel,
      });
      setNewTitle('');
      setNewBrief('');
      setActiveId(created.project.id);
      setMessage(t('Proyecto creado con carpeta y secciones en Notas.'));
      notifyDataChanged();
      await loadProjects();
    } finally {
      setBusy(null);
    }
  };

  const deleteActiveProject = async () => {
    if (!detail) return;
    const ok = window.confirm(
      tx('¿Eliminar el proyecto «{title}»? Se borrarán sus secciones, vínculos y capítulos. Las notas y carpetas creadas se conservan. Esta acción no se puede deshacer.', {
        title: detail.project.title,
      })
    );
    if (!ok) return;
    setBusy('delete-project');
    try {
      await window.nodus.deleteProject(detail.project.id);
      setActiveId(null);
      setDetail(null);
      setSelectedChapterId(null);
      setMessage(t('Proyecto eliminado.'));
      notifyDataChanged();
      await loadProjects();
    } finally {
      setBusy(null);
    }
  };

  const saveProjectBrief = async (brief: string) => {
    if (!detail) return;
    setBusy('save-brief');
    try {
      await window.nodus.updateProject({ id: detail.project.id, brief: brief.trim() });
      setEditingStepId(null);
      setMessage(t('Brief actualizado. El flujo guiado ya usa este objetivo.'));
      notifyDataChanged();
      await refreshActiveProject();
    } finally {
      setBusy(null);
    }
  };

  const updateSectionStatus = async (
    role: ProjectSectionRole,
    status: ProjectSectionStatus,
    successMessage: string
  ) => {
    const section = sectionByRole(role);
    if (!section) return;
    setBusy(`section-${role}`);
    try {
      await window.nodus.updateProjectSection({ id: section.id, status });
      setEditingStepId(null);
      setMessage(successMessage);
      notifyDataChanged();
      await refreshActiveProject();
    } finally {
      setBusy(null);
    }
  };

  const updateSectionStatuses = async (
    updates: { role: ProjectSectionRole; status: ProjectSectionStatus }[],
    successMessage: string
  ) => {
    const resolved = updates
      .map(({ role, status }) => {
        const section = sectionByRole(role);
        return section ? { id: section.id, status } : null;
      })
      .filter((item): item is { id: string; status: ProjectSectionStatus } => item !== null);
    if (resolved.length === 0) return;
    setBusy('section-batch');
    try {
      await Promise.all(resolved.map((item) => window.nodus.updateProjectSection(item)));
      setEditingStepId(null);
      setMessage(successMessage);
      notifyDataChanged();
      await refreshActiveProject();
    } finally {
      setBusy(null);
    }
  };

  const prepareOutline = async () => {
    if (!detail) return;
    const roles: ProjectSectionRole[] = ['debates', 'gaps', 'drafts'];
    const sections = roles.flatMap((role) => {
      const section = sectionByRole(role);
      return section ? [section] : [];
    });
    setBusy('section-outline');
    try {
      await Promise.all(sections.map((section) => window.nodus.updateProjectSection({ id: section.id, status: 'in_progress' })));
      setMessage(t('Estructura argumental preparada.'));
      notifyDataChanged();
      await refreshActiveProject();
    } finally {
      setBusy(null);
    }
  };

  const importChapter = async () => {
    if (!detail) return;
    setBusy('import');
    try {
      const chapter = await window.nodus.importProjectChapter({
        projectId: detail.project.id,
        sectionId: manuscriptSection?.id ?? null,
      });
      if (chapter) {
        setSelectedChapterId(chapter.id);
        setTab('texto');
        setMessage(t('Capitulo importado y guardado como nota vinculada.'));
        notifyDataChanged();
        await refreshActiveProject();
      }
    } finally {
      setBusy(null);
    }
  };

  const saveChapter = async () => {
    if (!selectedChapter) return;
    setBusy('save-chapter');
    try {
      const updated = await window.nodus.updateProjectChapter(selectedChapter.id, chapterMarkdown);
      if (updated) {
        setMessage(t('Capitulo guardado con version previa recuperable.'));
        notifyDataChanged();
        await refreshActiveProject();
      }
    } finally {
      setBusy(null);
    }
  };

  const generateSuggestions = async () => {
    if (!detail || !selectedChapter) return;
    setBusy('suggest');
    try {
      const next = await window.nodus.generateProjectSuggestions({
        projectId: detail.project.id,
        chapterId: selectedChapter.id,
        sectionId: selectedChapter.sectionId,
        mode,
        model: detail.project.model ?? settings.defaultModel,
        limit: 16,
      });
      setSuggestions(next);
      setTab('sugerencias');
      const blocked = next.filter((suggestion) => suggestion.status === 'blocked').length;
      setMessage(
        next.length === 0
          ? t('No se encontraron nuevas sugerencias verificables para este capítulo.')
          : blocked
            ? t('Sugerencias generadas. Algunas quedaron bloqueadas porque sus citas no son verificables.')
            : t('Sugerencias generadas con citas verificadas.')
      );
    } finally {
      setBusy(null);
    }
  };

  const analyzeRelations = async (force: boolean) => {
    if (!detail || !selectedChapter) return;
    setBusy('relations');
    setRelationsProgress(null);
    try {
      const result = await window.nodus.analyzeChapterRelations({
        chapterId: selectedChapter.id,
        model: detail.project.model ?? settings.defaultModel,
        force,
      });
      setRelations(result);
      setMessage(
        !result.available
          ? t('La búsqueda de relaciones necesita un proveedor de embeddings configurado en Ajustes.')
          : result.ideas.length === 0
            ? t('No se pudieron extraer ideas de este capítulo.')
            : tx('Analizadas {n} idea(s) del capítulo y sus relaciones con la biblioteca.', { n: result.ideas.length })
      );
    } finally {
      setBusy(null);
      setRelationsProgress(null);
    }
  };

  const verifyManuscript = async () => {
    if (!detail || !selectedChapter) return;
    setBusy('verify-manuscript');
    try {
      const result = await window.nodus.verifyManuscriptCitations({
        chapterId: selectedChapter.id,
        model: detail.project.model ?? settings.defaultModel,
        language: settings.uiLanguage,
        maxClaims: 80,
      });
      setVerification(result);
      setTab('verificacion');
      setMessage(
        !result.available
          ? t('No hay suficientes señales del corpus para verificar este capítulo.')
          : tx('Verificadas {n} afirmaciones; {m} necesitan cita.', {
              n: result.summary.checkedClaims,
              m: result.summary.missingCitations,
            })
      );
    } finally {
      setBusy(null);
    }
  };

  const updateSuggestion = async (suggestion: ProjectInsertionSuggestion, status: ChapterSuggestionStatus) => {
    const updated = await window.nodus.updateProjectSuggestionStatus(suggestion.id, status);
    if (updated) setSuggestions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  };

  const applySuggestions = async (ids: string[]) => {
    if (!selectedChapter || ids.length === 0) return;
    setBusy('apply');
    try {
      const updated = await window.nodus.applyProjectSuggestions({ chapterId: selectedChapter.id, suggestionIds: ids });
      if (updated) {
        setChapterMarkdown(updated.currentMarkdown);
        setMessage(t('Sugerencias aplicadas sobre una version nueva del borrador.'));
        notifyDataChanged();
        await refreshActiveProject();
      }
    } finally {
      setBusy(null);
    }
  };

  const restoreVersion = async (versionId: string) => {
    setBusy(`restore-${versionId}`);
    try {
      const chapter = await window.nodus.restoreProjectChapterVersion(versionId);
      if (chapter) {
        setChapterMarkdown(chapter.currentMarkdown);
        setMessage(t('Version restaurada. Se guardo una copia previa antes de restaurar.'));
        notifyDataChanged();
        await refreshActiveProject();
      }
    } finally {
      setBusy(null);
    }
  };

  const exportChapter = async () => {
    if (!selectedChapter) return;
    setBusy('export-chapter');
    try {
      const result = await window.nodus.exportProjectChapter({ chapterId: selectedChapter.id, format: chapterExportFormat });
      if (result) setMessage(`${t('Capitulo exportado:')} ${result.path}`);
    } finally {
      setBusy(null);
    }
  };

  const exportProjectFile = async () => {
    if (!detail) return;
    setBusy('export-project');
    try {
      const result = await window.nodus.exportProject({ projectId: detail.project.id, format: projectExportFormat });
      if (result) setMessage(`${t('Proyecto exportado:')} ${result.path}`);
    } finally {
      setBusy(null);
    }
  };

  const runGuideAction = (action: ProjectGuideAction) => {
    if (action === 'mark_coverage') {
      void updateSectionStatus('coverage', 'in_progress', t('Cobertura marcada como en curso.'));
      return;
    }
    if (action === 'mark_materials') {
      void updateSectionStatus('literature', 'in_progress', t('Materiales preparados para el estado de la cuestión.'));
      return;
    }
    if (action === 'mark_outline') {
      void prepareOutline();
      return;
    }
    if (action === 'import_chapter') {
      setEditingStepId(null);
      void importChapter();
      return;
    }
    if (action === 'review_chapter') {
      setEditingStepId(null);
      if (!selectedChapter) {
        void importChapter();
        return;
      }
      setTab('sugerencias');
      void generateSuggestions();
    }
  };

  const verifiedSuggestionIds = suggestions
    .filter((suggestion) => (suggestion.status === 'suggested' || suggestion.status === 'accepted') && !suggestion.blockedReason)
    .map((suggestion) => suggestion.id);

  return (
    <div className="h-full flex min-h-0 bg-neutral-950">
      <aside className="w-72 shrink-0 border-r border-neutral-800 p-3 flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('Proyectos')}</h2>
          <button className="btn btn-ghost text-xs gap-1.5" onClick={() => void loadProjects()}>
            <Icon name="sync" size={14} /> {t('Actualizar')}
          </button>
        </div>
        <div className="space-y-2">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`w-full text-left border rounded-lg p-3 transition-colors ${
                activeId === project.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:bg-neutral-900'
              }`}
              onClick={() => setActiveId(project.id)}
            >
              <div className="font-medium text-sm truncate">{project.title}</div>
              <div className="text-xs text-neutral-500 mt-1">{kindLabel(project.kind)} · {project.status}</div>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="text-sm text-neutral-500 border border-dashed border-neutral-800 rounded-lg p-4">
              {t('Aun no hay proyectos. Crea uno para vincular notas, materiales y capitulos.')}
            </div>
          )}
        </div>
        <div className="border border-neutral-800 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-neutral-300">{t('Nuevo proyecto')}</div>
          <input
            className="input w-full text-sm"
            placeholder={t('Titulo')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <select className="input w-full text-sm" value={newKind} onChange={(e) => setNewKind(e.target.value as ProjectKind)}>
            {PROJECT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </select>
          <textarea
            className="input w-full text-sm min-h-24"
            placeholder={t('Brief, objetivo o pregunta principal')}
            value={newBrief}
            onChange={(e) => setNewBrief(e.target.value)}
          />
          <button className="btn btn-primary w-full gap-1.5" onClick={createProject} disabled={busy === 'create' || !newTitle.trim()}>
            <Icon name={busy === 'create' ? 'sync' : 'folder'} className={busy === 'create' ? 'animate-spin' : ''} /> {t('Crear proyecto')}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!detail ? (
          <div className="h-full flex items-center justify-center text-neutral-500">{t('Selecciona o crea un proyecto.')}</div>
        ) : (
          <>
            <header className="border-b border-neutral-800 px-5 py-4 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-neutral-500">{kindLabel(detail.project.kind)}</div>
                <h1 className="text-xl font-semibold truncate">{detail.project.title}</h1>
                <p className="text-sm text-neutral-400 line-clamp-2 mt-1">{detail.project.brief || t('Sin brief definido.')}</p>
              </div>
              <div className="flex items-center gap-2">
                <select className="input text-xs" value={projectExportFormat} onChange={(e) => setProjectExportFormat(e.target.value as ProjectExportFormat)}>
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
                <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={exportProjectFile} disabled={busy === 'export-project'}>
                  <Icon name={busy === 'export-project' ? 'sync' : 'download'} className={busy === 'export-project' ? 'animate-spin' : ''} /> {t('Exportar proyecto')}
                </button>
                <button
                  className="btn btn-ghost border border-neutral-700 gap-1.5 text-red-300 hover:bg-red-950/40"
                  onClick={deleteActiveProject}
                  disabled={busy === 'delete-project'}
                  title={t('Eliminar proyecto')}
                >
                  <Icon name={busy === 'delete-project' ? 'sync' : 'trash'} className={busy === 'delete-project' ? 'animate-spin' : ''} /> {t('Eliminar')}
                </button>
              </div>
            </header>

            {message && (
              <div className="mx-5 mt-3 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-sm text-neutral-300 flex items-center gap-2">
                <Icon name="check" size={14} className="text-emerald-400" />
                <span className="flex-1">{message}</span>
                <button className="text-neutral-500 hover:text-neutral-200" onClick={() => setMessage(null)}>x</button>
              </div>
            )}

            {guide && (
              <ProjectGuidePanel
                guide={guide}
                busy={busy}
                onStepClick={(stepId) => setEditingStepId(stepId)}
              />
            )}
            {guide && editingStepId && (
              <ProjectGuideStepModal
                step={guide.steps.find((s) => s.id === editingStepId)!}
                detail={detail}
                busy={busy}
                onClose={() => setEditingStepId(null)}
                onSaveBrief={(brief) => void saveProjectBrief(brief)}
                onUpdateSections={(updates) =>
                  void updateSectionStatuses(
                    updates,
                    t('Sección actualizada. El flujo guiado refleja el cambio.')
                  )
                }
                onRunAction={(action) => runGuideAction(action)}
              />
            )}

            <div className="grid grid-cols-[minmax(220px,300px)_1fr] gap-0 flex-1 min-h-0">
              <section className="border-r border-neutral-800 p-4 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <Stat label={t('Secciones')} value={detail.stats.sections} />
                  <Stat label={t('Materiales')} value={detail.stats.links} />
                  <Stat label={t('Caps.')} value={detail.stats.chapters} />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{t('Secciones')}</h3>
                  <button className="btn btn-primary text-xs gap-1.5" onClick={importChapter} disabled={busy === 'import'}>
                    <Icon name={busy === 'import' ? 'sync' : 'upload'} className={busy === 'import' ? 'animate-spin' : ''} /> {t('Subir capitulo')}
                  </button>
                </div>
                <div className="space-y-2">
                  {detail.sections.map((section) => (
                    <div key={section.id} className="border border-neutral-800 rounded-lg p-3">
                      <div className="text-sm font-medium">{section.title}</div>
                      <div className="text-xs text-neutral-500">{section.role} · {section.status}</div>
                    </div>
                  ))}
                </div>
                <h3 className="text-sm font-semibold mt-5 mb-2">{t('Capitulos')}</h3>
                <div className="space-y-2">
                  {detail.chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      className={`w-full text-left border rounded-lg p-3 ${
                        selectedChapter?.id === chapter.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:bg-neutral-900'
                      }`}
                      onClick={() => {
                        setSelectedChapterId(chapter.id);
                        setTab('texto');
                      }}
                    >
                      <div className="text-sm font-medium truncate">{chapter.title}</div>
                      <div className="text-xs text-neutral-500">{chapter.wordCount} {t('palabras')} · {chapter.sourceFormat}</div>
                    </button>
                  ))}
                  {detail.chapters.length === 0 && (
                    <div className="text-sm text-neutral-500 border border-dashed border-neutral-800 rounded-lg p-4">
                      {t('Sube un capitulo para empezar a trabajar sobre el manuscrito.')}
                    </div>
                  )}
                </div>
              </section>

              <section className="min-w-0 min-h-0 flex flex-col">
                {!selectedChapter ? (
                  <div className="h-full flex items-center justify-center text-neutral-500">{t('No hay capitulo seleccionado.')}</div>
                ) : (
                  <>
                    <div className="border-b border-neutral-800 p-3 flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{selectedChapter.title}</div>
                        <div className="text-xs text-neutral-500">{selectedChapter.wordCount} {t('palabras')} · {selectedChapter.originalFileName ?? selectedChapter.sourceFormat}</div>
                      </div>
                      {(['texto', 'relaciones', 'verificacion', 'sugerencias', 'versiones', 'exportar'] as ChapterTab[]).map((item) => (
                        <button
                          key={item}
                          className={`btn text-xs ${tab === item ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
                          onClick={() => setTab(item)}
                        >
                          {tabLabel(item)}
                        </button>
                      ))}
                    </div>

                    {tab === 'texto' && (
                      <div className="flex-1 min-h-0 grid grid-cols-2">
                        <div className="border-r border-neutral-800 min-h-0 flex flex-col">
                          <div className="p-3 border-b border-neutral-800 flex items-center gap-2">
                            <button className="btn btn-primary gap-1.5" onClick={saveChapter} disabled={busy === 'save-chapter'}>
                              <Icon name={busy === 'save-chapter' ? 'sync' : 'check'} className={busy === 'save-chapter' ? 'animate-spin' : ''} /> {t('Guardar')}
                            </button>
                            <div className="text-xs text-neutral-500">{t('Editable. Cada guardado crea version previa.')}</div>
                          </div>
                          <textarea
                            className="flex-1 min-h-0 bg-neutral-950 text-neutral-100 p-4 outline-none resize-none font-mono text-sm leading-relaxed"
                            value={chapterMarkdown}
                            onChange={(e) => setChapterMarkdown(e.target.value)}
                          />
                        </div>
                        <div className="min-h-0 overflow-y-auto p-5">
                          <Markdown content={chapterMarkdown} onCitation={(c: MarkdownCitation) => setCitation(c)} />
                        </div>
                      </div>
                    )}

                    {tab === 'relaciones' && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        <div className="flex items-center gap-2 mb-4">
                          <button className="btn btn-primary gap-1.5" onClick={() => void analyzeRelations(true)} disabled={busy === 'relations'}>
                            <Icon name={busy === 'relations' ? 'sync' : 'network'} className={busy === 'relations' ? 'animate-spin' : ''} /> {t('Analizar relaciones')}
                          </button>
                          {busy === 'relations' && relationsProgress && (
                            <span className="text-xs text-neutral-400">
                              {relationsProgress.message}
                              {relationsProgress.total > 0 ? ` (${relationsProgress.current}/${relationsProgress.total})` : ''}
                            </span>
                          )}
                          {relations && relations.analyzed && busy !== 'relations' && (
                            <span className="text-xs text-neutral-500">
                              {tx('{n} ideas del capítulo', { n: relations.ideas.length })}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 mb-4 max-w-3xl">
                          {t('Extrae las ideas de este capítulo (no se añaden al grafo) y busca cómo se relacionan con tu biblioteca: ideas, notas, pasajes y obras.')}
                        </p>
                        <div className="space-y-3">
                          {(relations?.ideas ?? []).map(({ idea, relations: rels }) => (
                            <ChapterIdeaCard key={idea.id} idea={idea} relations={rels} onOpen={(c) => setCitation(c)} />
                          ))}
                          {(!relations || !relations.analyzed) && busy !== 'relations' && (
                            <div className="text-sm text-neutral-500 border border-dashed border-neutral-800 rounded-lg p-5">
                              {t('Analiza las relaciones para ver cómo conecta este capítulo con toda tu biblioteca.')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {tab === 'verificacion' && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                          <button className="btn btn-primary gap-1.5" onClick={() => void verifyManuscript()} disabled={busy === 'verify-manuscript'}>
                            <Icon name={busy === 'verify-manuscript' ? 'sync' : 'search'} className={busy === 'verify-manuscript' ? 'animate-spin' : ''} /> {t('Verificar citas')}
                          </button>
                          {verification && (
                            <span className="text-xs text-neutral-500">
                              {verification.aiReviewed ? t('Revisado con IA') : t('Revisión determinista')}
                            </span>
                          )}
                        </div>
                        <p className="mb-4 max-w-3xl text-xs text-neutral-500">
                          {t('Detecta afirmaciones del capítulo, comprueba si ya tienen cita y solo marca las que coinciden con ideas o pasajes del corpus.')}
                        </p>

                        {verification && (
                          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
                            <VerificationStat label={t('Afirmaciones')} value={verification.summary.checkedClaims} />
                            <VerificationStat label={t('Faltan citas')} value={verification.summary.missingCitations} tone="red" />
                            <VerificationStat label={t('Cubiertas')} value={verification.summary.covered} tone="green" />
                            <VerificationStat label={t('Aportación propia')} value={verification.summary.ownArguments} />
                            <VerificationStat label={t('Coincidencia débil')} value={verification.summary.weakMatches} tone="amber" />
                          </div>
                        )}

                        {verification?.warnings.length ? (
                          <div className="mb-4 space-y-2">
                            {verification.warnings.map((warning) => (
                              <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
                                <Icon name="alert" size={14} className="mt-0.5" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="space-y-3">
                          {verification?.claims.map((claim) => (
                            <ManuscriptClaimCard key={claim.id} claim={claim} onOpen={(target) => setCitation(target)} />
                          ))}
                          {!verification && busy !== 'verify-manuscript' && (
                            <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
                              {t('Verifica el capítulo contra tu corpus antes de cerrar el manuscrito o exportarlo.')}
                            </div>
                          )}
                          {verification && verification.claims.length === 0 && (
                            <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
                              {t('No se encontraron afirmaciones que requieran revisión de citas.')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {tab === 'sugerencias' && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        <div className="flex items-center gap-2 mb-4">
                          <select className="input text-sm" value={mode} onChange={(e) => setMode(e.target.value as ChapterSuggestionMode)}>
                            <option value="suggest">{t('Sugerir ubicacion')}</option>
                            <option value="insert">{t('Insertar en borrador')}</option>
                          </select>
                          <button className="btn btn-primary gap-1.5" onClick={generateSuggestions} disabled={busy === 'suggest'}>
                            <Icon name={busy === 'suggest' ? 'sync' : 'wand'} className={busy === 'suggest' ? 'animate-spin' : ''} /> {t('Generar sugerencias')}
                          </button>
                          <button
                            className="btn btn-ghost border border-neutral-700 gap-1.5"
                            onClick={() => applySuggestions(verifiedSuggestionIds)}
                            disabled={busy === 'apply' || verifiedSuggestionIds.length === 0 || mode !== 'insert'}
                            title={mode !== 'insert' ? t('Cambia a Insertar en borrador para aplicar automaticamente.') : undefined}
                          >
                            <Icon name={busy === 'apply' ? 'sync' : 'check'} className={busy === 'apply' ? 'animate-spin' : ''} /> {t('Aplicar todas verificadas')}
                          </button>
                        </div>
                        <div className="space-y-3">
                          {suggestions.map((suggestion) => (
                            <SuggestionCard
                              key={suggestion.id}
                              suggestion={suggestion}
                              onCitation={(c) => setCitation(c)}
                              onStatus={(status) => void updateSuggestion(suggestion, status)}
                              onApply={() => void applySuggestions([suggestion.id])}
                              canApply={mode === 'insert' && !suggestion.blockedReason && suggestion.status !== 'applied'}
                            />
                          ))}
                          {suggestions.length === 0 && (
                            <div className="text-sm text-neutral-500 border border-dashed border-neutral-800 rounded-lg p-5">
                              {t('Genera sugerencias para que Nodus proponga inserciones con citas verificables.')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {tab === 'versiones' && (
                      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                        {versions.map((version) => (
                          <div key={version.id} className="border border-neutral-800 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <div className="font-medium text-sm">{version.label}</div>
                                <div className="text-xs text-neutral-500">{new Date(version.createdAt).toLocaleString()}</div>
                              </div>
                              <button className="btn btn-ghost border border-neutral-700" onClick={() => void restoreVersion(version.id)} disabled={busy === `restore-${version.id}`}>
                                {t('Restaurar')}
                              </button>
                            </div>
                            <pre className="mt-3 max-h-36 overflow-hidden text-xs text-neutral-500 whitespace-pre-wrap">{version.markdown.slice(0, 900)}</pre>
                          </div>
                        ))}
                        {versions.length === 0 && <div className="text-sm text-neutral-500">{t('Aun no hay versiones guardadas.')}</div>}
                      </div>
                    )}

                    {tab === 'exportar' && (
                      <div className="flex-1 p-5">
                        <div className="max-w-md border border-neutral-800 rounded-lg p-4 space-y-3">
                          <div className="font-semibold">{t('Exportar capitulo actual')}</div>
                          <select className="input w-full" value={chapterExportFormat} onChange={(e) => setChapterExportFormat(e.target.value as ChapterExportFormat)}>
                            <option value="markdown">Markdown</option>
                            <option value="txt">TXT</option>
                            <option value="docx">DOCX</option>
                            <option value="pdf">PDF</option>
                          </select>
                          <button className="btn btn-primary gap-1.5" onClick={exportChapter} disabled={busy === 'export-chapter'}>
                            <Icon name={busy === 'export-chapter' ? 'sync' : 'download'} className={busy === 'export-chapter' ? 'animate-spin' : ''} /> {t('Exportar')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {citation && <SourceCitationModal target={citation} onClose={() => setCitation(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}

function VerificationStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'red' | 'green' | 'amber';
}) {
  const toneClass =
    tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200'
      : tone === 'green'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
}

const CLAIM_STATUS_ICON: Record<ManuscriptClaimStatus, string> = {
  missing_citation: 'alert',
  covered: 'check',
  own_argument: 'bulb',
  weak_match: 'search',
};

function claimStatusMeta(status: ManuscriptClaimStatus): { label: string; className: string } {
  switch (status) {
    case 'missing_citation':
      return {
        label: t('Falta cita'),
        className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200',
      };
    case 'covered':
      return {
        label: t('Cita cubierta'),
        className:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200',
      };
    case 'own_argument':
      return {
        label: t('Posible aportación propia'),
        className:
          'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:text-indigo-200',
      };
    case 'weak_match':
      return {
        label: t('Coincidencia débil'),
        className:
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200',
      };
  }
}

function ManuscriptClaimCard({
  claim,
  onOpen,
}: {
  claim: ManuscriptClaimCheck;
  onOpen: (citation: CitationTarget) => void;
}) {
  const meta = claimStatusMeta(claim.status);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-none">
      <div className="flex flex-wrap items-start gap-2">
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${meta.className}`}>
          <Icon name={CLAIM_STATUS_ICON[claim.status]} size={13} />
          {meta.label}
        </span>
        {claim.hasCitation && <span className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 dark:border-neutral-800">{t('Con cita')}</span>}
        <span className="ml-auto text-[11px] text-neutral-500">
          {tx('Párrafo {p} · frase {s}', { p: claim.paragraphIndex + 1, s: claim.sentenceIndex + 1 })}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">{claim.excerpt}</p>
      <p className="mt-2 text-xs text-neutral-500">{claim.rationale}</p>

      {claim.existingCitations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {claim.existingCitations.map((citation) => (
            <span key={citation} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {citation}
            </span>
          ))}
        </div>
      )}

      {claim.replacementHint && claim.status === 'missing_citation' && (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:text-indigo-200">
          <span className="font-medium">{t('Sugerencia')}:</span> <code>{claim.replacementHint}</code>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Candidatos de cita')}</div>
        {claim.suggestedCitations.length === 0 ? (
          <div className="text-xs text-neutral-500">{t('Sin citas sugeridas.')}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {claim.suggestedCitations.map((candidate) => (
              <EvidenceCandidateButton key={`${candidate.kind}:${candidate.refId}`} candidate={candidate} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceCandidateButton({
  candidate,
  onOpen,
}: {
  candidate: ManuscriptEvidenceCandidate;
  onOpen: (citation: CitationTarget) => void;
}) {
  const title = candidate.workTitle && candidate.workTitle !== candidate.label ? `${candidate.label} · ${candidate.workTitle}` : candidate.label;
  return (
    <button
      type="button"
      className="min-w-0 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:bg-neutral-900"
      onClick={() => onOpen({ kind: candidate.kind, id: candidate.refId })}
    >
      <div className="flex items-center gap-2">
        <Icon name={candidate.kind === 'idea' ? 'bulb' : 'quote'} size={13} className="text-indigo-500 dark:text-indigo-300" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">{title}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">{Math.round(candidate.score * 100)}%</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{candidate.snippet}</p>
      {candidate.pageLabel && <div className="mt-1 text-[11px] text-neutral-500">{candidate.pageLabel}</div>}
    </button>
  );
}

function ProjectGuidePanel({
  guide,
  busy,
  onStepClick,
}: {
  guide: ProjectGuide;
  busy: string | null;
  onStepClick: (stepId: string) => void;
}) {
  const disabled = Boolean(busy);

  return (
    <section className="mx-5 mt-3 rounded-lg border border-neutral-200 bg-white/95 p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70 dark:shadow-none">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon name="graduation" size={16} className="text-indigo-600 dark:text-indigo-300" />
            <h2 className="text-sm font-semibold">{t(guide.title)}</h2>
            <span className="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              {guide.doneCount}/{guide.totalCount}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">{t(guide.subtitle)}</p>
        </div>
        {guide.doneCount === guide.totalCount && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300">
              <Icon name="check" size={13} /> {t('Completado')}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${guide.completion}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-6">
        {guide.steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`min-w-0 rounded-md border px-2.5 py-2 text-left transition-opacity hover:opacity-90 ${guideStepClass(step.status)}`}
            onClick={() => onStepClick(step.id)}
            disabled={disabled}
            title={t(step.title)}
          >
            <div className="flex items-center gap-1.5">
              <Icon name={guideStepIcon(step.status)} size={13} />
              <span className="truncate text-xs font-medium">{t(step.title)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500">{step.evidence}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  onCitation,
  onStatus,
  onApply,
  canApply,
}: {
  suggestion: ProjectInsertionSuggestion;
  onCitation: (citation: MarkdownCitation) => void;
  onStatus: (status: ChapterSuggestionStatus) => void;
  onApply: () => void;
  canApply: boolean;
}) {
  return (
    <div className={`border rounded-lg p-4 ${suggestion.blockedReason ? 'border-amber-600/50 bg-amber-500/5' : 'border-neutral-800'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{suggestion.refLabel}</div>
          <div className="text-xs text-neutral-500">
            {suggestion.kind} · {suggestion.operation} · {suggestion.status} · {Math.round(suggestion.confidence * 100)}%
          </div>
        </div>
        <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={() => onStatus('accepted')} disabled={suggestion.status === 'accepted'}>
          {t('Aceptar')}
        </button>
        <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={() => onStatus('rejected')} disabled={suggestion.status === 'rejected'}>
          {t('Rechazar')}
        </button>
        <button className="btn btn-primary text-xs" onClick={onApply} disabled={!canApply}>
          {t('Aplicar')}
        </button>
      </div>
      {suggestion.blockedReason && <div className="mt-2 text-xs text-amber-300">{suggestion.blockedReason}</div>}
      <div className="mt-3 border border-neutral-800 rounded-lg p-3 bg-neutral-950">
        <Markdown content={suggestion.proposedText} onCitation={onCitation} />
      </div>
      <div className="mt-2 text-xs text-neutral-500">{suggestion.rationale}</div>
    </div>
  );
}

const RELATION_META: Record<ChapterRelationType, { label: string; color: string }> = {
  supports: { label: 'apoya', color: 'text-emerald-300 border-emerald-700/60 bg-emerald-900/20' },
  contradicts: { label: 'contradice', color: 'text-red-300 border-red-700/60 bg-red-900/20' },
  refines: { label: 'matiza', color: 'text-amber-300 border-amber-700/60 bg-amber-900/20' },
  extends: { label: 'amplía', color: 'text-cyan-300 border-cyan-700/60 bg-cyan-900/20' },
  related: { label: 'relacionada', color: 'text-neutral-300 border-neutral-700 bg-neutral-800/40' },
};

const RELATION_TARGET_ICON: Record<ChapterIdeaRelation['targetKind'], string> = {
  idea: 'bulb',
  note: 'notebook',
  passage: 'quote',
  work: 'book',
};

function ChapterIdeaCard({
  idea,
  relations,
  onOpen,
}: {
  idea: { type: string; label: string; statement: string };
  relations: ChapterIdeaRelation[];
  onOpen: (citation: CitationTarget) => void;
}) {
  const openTarget = (relation: ChapterIdeaRelation) => {
    if (relation.targetKind === 'note') return; // no citation viewer for notes
    onOpen({ kind: relation.targetKind, id: relation.targetId });
  };
  return (
    <div className="border border-neutral-800 rounded-lg p-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide rounded border border-indigo-700/60 bg-indigo-900/20 text-indigo-300 px-1.5 py-0.5">
          {idea.type}
        </span>
        <div className="font-semibold text-sm">{idea.label}</div>
      </div>
      <p className="text-sm text-neutral-400 mt-1">{idea.statement}</p>
      <div className="mt-3 space-y-1.5">
        {relations.length === 0 && (
          <div className="text-xs text-neutral-600">{t('Sin relaciones encontradas en la biblioteca.')}</div>
        )}
        {relations.map((relation) => {
          const meta = RELATION_META[relation.relation];
          const clickable = relation.targetKind !== 'note';
          return (
            <div
              key={relation.id}
              className={`flex items-start gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5 ${clickable ? 'cursor-pointer hover:border-neutral-700' : ''}`}
              onClick={() => clickable && openTarget(relation)}
            >
              <span className={`shrink-0 mt-0.5 text-[10px] rounded border px-1.5 py-0.5 ${meta.color}`}>{t(meta.label)}</span>
              <Icon name={RELATION_TARGET_ICON[relation.targetKind]} size={13} className="mt-1 shrink-0 text-neutral-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-neutral-100">{relation.targetLabel}</span>
                  {relation.targetSubtitle && <span className="shrink-0 truncate text-xs text-neutral-500">{relation.targetSubtitle}</span>}
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-neutral-600">{Math.round((relation.confidence || relation.similarity) * 100)}%</span>
                </div>
                {relation.rationale && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{relation.rationale}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kindLabel(kind: ProjectKind): string {
  return PROJECT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function guideStepIcon(status: ProjectGuideStepStatus): string {
  if (status === 'done') return 'check';
  if (status === 'current') return 'compass';
  return 'lock';
}

function guideStepClass(status: ProjectGuideStepStatus): string {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200';
  if (status === 'current') return 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-600/70 dark:bg-indigo-900/30 dark:text-indigo-100';
  return 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/70 dark:text-neutral-500';
}

function tabLabel(tab: ChapterTab): string {
  switch (tab) {
    case 'texto':
      return t('Texto');
    case 'relaciones':
      return t('Relaciones');
    case 'verificacion':
      return t('Verificación');
    case 'sugerencias':
      return t('Sugerencias');
    case 'versiones':
      return t('Versiones');
    case 'exportar':
      return t('Exportar');
  }
}
