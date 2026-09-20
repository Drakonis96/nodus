import type { StudyAssistantSourceOption } from './studyAssistant';
import type { StudySearchKind, StudySearchScope } from './studySearch';
import type { StudyWorkspace } from './studyOrg';

export type StudySourceOrganization = Pick<StudyWorkspace, 'courses' | 'subjects' | 'folders' | 'topics'>;
export interface StudySourceGroup {
  id: string;
  kind: 'root' | 'course' | 'subject' | 'folder' | 'unplaced';
  entityId?: string;
  title: string;
  scope: StudySearchScope;
  groups: StudySourceGroup[];
  sources: StudyAssistantSourceOption[];
  sourceKeys: string[];
}
export const normalizeSourceQuery = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
const emptyScope = (): StudySearchScope => ({ courseId: null, subjectId: null, folderId: null, topicId: null });

/** The hierarchy is shared by source selection and location dialogs. It resolves
 * legacy placements with only a topic/subject id without rewriting user data. */
export function studyOrganizationPaths(workspace: StudySourceOrganization) {
  const courses = new Map(workspace.courses.map((item) => [item.id, item]));
  const subjects = new Map(workspace.subjects.map((item) => [item.id, item]));
  const folders = new Map(workspace.folders.map((item) => [item.id, item]));
  const topics = new Map(workspace.topics.map((item) => [item.id, item]));
  const resolve = (scope: StudySearchScope): StudySearchScope => {
    const topic = scope.topicId ? topics.get(scope.topicId) : undefined;
    const folderId = scope.folderId ?? topic?.folderId ?? null;
    const folder = folderId ? folders.get(folderId) : undefined;
    const subjectId = scope.subjectId ?? topic?.subjectId ?? folder?.subjectId ?? null;
    return { ...scope, folderId, subjectId, courseId: scope.courseId ?? (subjectId ? subjects.get(subjectId)?.courseId : null) ?? folder?.courseId ?? null };
  };
  const folderChain = (id: string | null): string[] => {
    const chain: string[] = []; const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id); const folder = folders.get(id); if (!folder) break;
      chain.unshift(folder.name); id = folder.parentId;
    }
    return chain;
  };
  const topicChain = (id: string | null): string[] => {
    const chain: string[] = []; const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id); const topic = topics.get(id); if (!topic) break;
      chain.unshift(topic.name); id = topic.parentId;
    }
    return chain;
  };
  const label = (input: StudySearchScope) => {
    const scope = resolve(input);
    return [scope.courseId ? courses.get(scope.courseId)?.name : '', scope.subjectId ? subjects.get(scope.subjectId)?.name : '',
      ...folderChain(scope.folderId), ...topicChain(scope.topicId)].filter(Boolean).join(' / ');
  };
  return { resolve, label };
}

export function buildStudySourceTree(sources: StudyAssistantSourceOption[], workspace: StudySourceOrganization, options: {
  query: string; kind: StudySearchKind | 'all'; onlySelected: boolean; selected: ReadonlySet<string>; unplacedLabel: string;
}): StudySourceGroup {
  const paths = studyOrganizationPaths(workspace);
  const node = (id: string, kind: StudySourceGroup['kind'], title: string, scope = emptyScope(), entityId?: string): StudySourceGroup => ({ id, kind, title, scope, entityId, groups: [], sources: [], sourceKeys: [] });
  const root = node('root', 'root', '');
  const nodes = new Map<string, StudySourceGroup>([['root', root]]);
  for (const course of workspace.courses) nodes.set(`course:${course.id}`, node(`course:${course.id}`, 'course', course.name, { ...emptyScope(), courseId: course.id }, course.id));
  for (const subject of workspace.subjects) nodes.set(`subject:${subject.id}`, node(`subject:${subject.id}`, 'subject', subject.name, { ...emptyScope(), courseId: subject.courseId, subjectId: subject.id }, subject.id));
  for (const folder of workspace.folders) nodes.set(`folder:${folder.id}`, node(`folder:${folder.id}`, 'folder', folder.name, paths.resolve({ ...emptyScope(), courseId: folder.courseId, subjectId: folder.subjectId, folderId: folder.id }), folder.id));
  const unplaced = node('unplaced', 'unplaced', options.unplacedLabel);
  nodes.set(unplaced.id, unplaced);
  const folderParents = new Map(workspace.folders.map((f) => [f.id, f.parentId]));
  for (const group of nodes.values()) {
    if (group === root) continue;
    const parentFolder = group.kind === 'folder' ? folderParents.get(group.entityId!) : null;
    let parent = (parentFolder ? nodes.get(`folder:${parentFolder}`) : undefined)
      ?? (group.kind === 'folder' && group.scope.subjectId ? nodes.get(`subject:${group.scope.subjectId}`) : undefined)
      ?? (group.kind !== 'course' && group.scope.courseId ? nodes.get(`course:${group.scope.courseId}`) : undefined) ?? root;
    // Defensive fallback for legacy malformed folder cycles.
    const seen = new Set<string>([group.entityId ?? '']); let ancestor = parentFolder;
    while (ancestor) { if (seen.has(ancestor)) { parent = root; break; } seen.add(ancestor); ancestor = folderParents.get(ancestor); }
    parent.groups.push(group);
  }
  const query = normalizeSourceQuery(options.query);
  for (const source of sources) {
    if ((options.kind !== 'all' && source.kind !== options.kind) || (options.onlySelected && !options.selected.has(source.sourceKey))) continue;
    const locations = source.placements?.length ? source.placements : [source.placements ? emptyScope() : source.scope];
    const intrinsicMatch = normalizeSourceQuery([source.title, source.fileName, ...(source.tags ?? [])].join(' ')).includes(query);
    const assigned = new Set<string>();
    for (const location of locations) {
      const scope = paths.resolve(location);
      if (!intrinsicMatch && !normalizeSourceQuery(paths.label(scope)).includes(query)) continue;
      const parent = (scope.folderId ? nodes.get(`folder:${scope.folderId}`) : undefined)
        ?? (scope.subjectId ? nodes.get(`subject:${scope.subjectId}`) : undefined)
        ?? (scope.courseId ? nodes.get(`course:${scope.courseId}`) : undefined) ?? unplaced;
      if (!assigned.has(parent.id)) { parent.sources.push(source); assigned.add(parent.id); }
    }
  }
  const prune = query !== '' || options.kind !== 'all' || options.onlySelected;
  const finish = (group: StudySourceGroup): boolean => {
    group.groups = group.groups.filter(finish).sort((a, b) => a.title.localeCompare(b.title));
    group.sources.sort((a, b) => a.title.localeCompare(b.title));
    group.sourceKeys = [...new Set([...group.sources.filter((s) => s.available !== false).map((s) => s.sourceKey), ...group.groups.flatMap((g) => g.sourceKeys)])];
    const matchingEmptyFolder = group.kind === 'folder' && query !== '' && options.kind === 'all' && !options.onlySelected
      && normalizeSourceQuery(paths.label(group.scope)).includes(query);
    return !prune || matchingEmptyFolder || group.sources.length > 0 || group.groups.length > 0;
  };
  finish(root); return root;
}

export function toggleStudySourceKeys(current: string[], keys: string[]): string[] {
  const selected = new Set(current); const remove = keys.length > 0 && keys.every((key) => selected.has(key));
  for (const key of keys) { if (remove) selected.delete(key); else selected.add(key); }
  return [...selected];
}
