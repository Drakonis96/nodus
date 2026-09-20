// Deterministic IPC fixtures for the real Study/Teaching chat surface.
export function studySourceFixtures(count: number) {
  const timestamp = '2026-09-20T10:00:00Z';
  const base = { shortId: 'fixture', position: 0, archivedAt: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
  const scope = { courseId: null, subjectId: null, folderId: null, topicId: null };
  const workspace: any = { academicYears: [], courses: [], subjects: [], folders: [], topics: [], documents: [], placements: [], tags: [], documentTags: [], templates: [] };
  if (count > 1) {
    workspace.courses.push({ ...base, id: 'course', name: 'Bachillerato' });
    workspace.subjects.push({ ...base, id: 'chemistry', courseId: 'course', name: 'Química' }, { ...base, id: 'biology', courseId: 'course', name: 'Biología' });
    workspace.folders.push({ ...base, id: 'organic', name: 'Química orgánica', courseId: 'course', subjectId: 'chemistry', parentId: null },
      { ...base, id: 'revision', name: 'Preparación del examen', courseId: 'course', subjectId: 'chemistry', parentId: 'organic' },
      { ...base, id: 'general', name: 'Lecturas generales', courseId: null, subjectId: null, parentId: null });
  }
  const placement = (id: string, materialId: string, subjectId: string, folderId: string | null = null) => ({ ...base, ...scope, id, materialId, courseId: 'course', subjectId, folderId, documentId: null });
  const sources: any[] = Array.from({ length: count }, (_, index) => {
    const id = `material-${index + 1}`;
    const placements = count === 1 ? [] : [placement(`placement-${index}`, id, index % 2 ? 'biology' : 'chemistry', index % 2 ? null : 'revision')];
    if (count > 1 && index === 0) placements.push(placement('second-placement', id, 'biology'));
    return { ...base, sourceKey: `material:${id}`, sourceId: id, kind: 'material', title: index === 0 ? 'Fuente original' : `Manual ${String(index + 1).padStart(4, '0')}`, fileName: index === 0 ? 'Reacciones orgánicas.pdf' : `Lectura-${index + 1}.pdf`,
      subtitle: 'Material', scope: placements[0] ?? scope, placements, chunks: 4, available: true, tags: index === 0 ? ['Reacción', 'Examen'] : [], indexStatus: 'indexed' };
  });
  if (count > 1) {
    sources.push({ ...base, sourceId: 'unfiled', sourceKey: 'material:unfiled', title: 'Material sin clasificar', kind: 'material', scope, placements: [], chunks: 1, available: true },
      { ...base, sourceId: 'empty', sourceKey: 'material:empty', title: 'Audio sin transcribir', kind: 'material', scope, placements: [], chunks: 0, available: false, unavailableReason: 'no_content' },
      { ...base, sourceId: 'note', sourceKey: 'document:note', title: 'Apuntes de química', kind: 'document', scope: { ...scope, subjectId: 'chemistry' }, chunks: 2, available: true });
  }
  (window as any).studySourceFixture = { sources, workspace, moves: [] };
  return {
    getStudyWorkspace: async () => structuredClone(workspace),
    listStudyAssistantSources: async () => structuredClone(sources),
    getStudyMaterial: async (id: string) => { const source = sources.find((s) => s.sourceId === id); return structuredClone({ ...source, id, annotations: [], versions: [], fragmentLinks: [] }); },
    createStudyFolder: async (input: any) => {
      const parent = workspace.folders.find((f: any) => f.id === input.parentId);
      const folder = { ...base, id: `folder-${workspace.folders.length}`, parentId: null, courseId: null, subjectId: null, ...input, ...(parent ? { courseId: parent.courseId, subjectId: parent.subjectId } : {}) };
      workspace.folders.push(folder); return structuredClone(folder);
    },
    updateStudyEntity: async (_kind: string, id: string, patch: any) => Object.assign(workspace.folders.find((f: any) => f.id === id), patch),
    moveStudyMaterialPlacement: async (id: string, placementId: string, destination: any) => {
      if ((window as any).failMove) throw new Error('El destino ya no está disponible.');
      const source = sources.find((s) => s.sourceId === id);
      let link = source.placements.find((p: any) => p.id === placementId);
      if (!link) { link = { ...base, ...scope, id: 'new-placement', materialId: id }; source.placements.push(link); }
      Object.assign(link, destination); source.scope = source.placements[0];
      (window as any).studySourceFixture.moves.push({ id, placementId, destination });
      return structuredClone(link);
    },
  };
}
