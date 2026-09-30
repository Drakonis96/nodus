/**
 * Source tree for the guide composer: course → subject → folder → unit (topic and
 * subtopics) → source. It extends the Research Chat tree with units, because a
 * guide is naturally written unit by unit, and every group node can be ticked as
 * a whole so the selection keeps meaning "this unit" when new material is added.
 */
import type { StudySearchScope } from '../studySearch';
import { normalizeSourceQuery, studyOrganizationPaths, type StudySourceOrganization } from '../studySourceTree';
import { preferredRecordingTranscripts } from './selection';
import type { CompleteGuideCatalogSource, CompleteGuideSelection, CompleteGuideSelectionNode } from './types';

export interface CompleteGuideTreeNode {
  /** `course:<id>`, `subject:<id>`, `folder:<id>`, `topic:<id>` or `unplaced`. */
  id: string;
  kind: 'root' | 'course' | 'subject' | 'folder' | 'topic' | 'unplaced';
  entityId?: string;
  title: string;
  children: CompleteGuideTreeNode[];
  sources: CompleteGuideCatalogSource[];
  /** Every readable source below this node (deduplicated). */
  sourceKeys: string[];
}

const emptyScope = (): StudySearchScope => ({ courseId: null, subjectId: null, folderId: null, topicId: null });

export function buildCompleteGuideTree(
  catalog: CompleteGuideCatalogSource[],
  organization: StudySourceOrganization,
  options: { query?: string; unplacedLabel: string },
): CompleteGuideTreeNode {
  const paths = studyOrganizationPaths(organization);
  const node = (id: string, kind: CompleteGuideTreeNode['kind'], title: string, entityId?: string): CompleteGuideTreeNode => ({ id, kind, title, entityId, children: [], sources: [], sourceKeys: [] });
  const root = node('root', 'root', '');
  const nodes = new Map<string, CompleteGuideTreeNode>([['root', root]]);
  const positions = new Map<string, number>();
  for (const course of organization.courses) { nodes.set(`course:${course.id}`, node(`course:${course.id}`, 'course', course.name, course.id)); positions.set(`course:${course.id}`, course.position); }
  for (const subject of organization.subjects) { nodes.set(`subject:${subject.id}`, node(`subject:${subject.id}`, 'subject', subject.name, subject.id)); positions.set(`subject:${subject.id}`, subject.position); }
  for (const folder of organization.folders) { nodes.set(`folder:${folder.id}`, node(`folder:${folder.id}`, 'folder', folder.name, folder.id)); positions.set(`folder:${folder.id}`, folder.position); }
  for (const topic of organization.topics) { nodes.set(`topic:${topic.id}`, node(`topic:${topic.id}`, 'topic', topic.name, topic.id)); positions.set(`topic:${topic.id}`, topic.position); }
  const unplaced = node('unplaced', 'unplaced', options.unplacedLabel);

  const attach = (childId: string, parentIds: Array<string | null | undefined>) => {
    const child = nodes.get(childId)!;
    const parent = parentIds.map((id) => (id ? nodes.get(id) : undefined)).find((candidate) => candidate && candidate !== child) ?? root;
    parent.children.push(child);
  };
  const cycles = <T extends { id: string }>(items: T[], parentOf: (item: T) => string | null) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const cyclic = new Set<string>();
    for (const item of items) {
      const seen = new Set<string>([item.id]);
      let parent = parentOf(item);
      while (parent) {
        if (seen.has(parent)) { cyclic.add(item.id); break; }
        seen.add(parent);
        const next = byId.get(parent);
        parent = next ? parentOf(next) : null;
      }
    }
    return cyclic;
  };
  const cyclicFolders = cycles(organization.folders, (folder) => folder.parentId);
  const cyclicTopics = cycles(organization.topics, (topic) => topic.parentId);
  for (const subject of organization.subjects) attach(`subject:${subject.id}`, [`course:${subject.courseId}`]);
  for (const course of organization.courses) attach(`course:${course.id}`, []);
  for (const folder of organization.folders) {
    const scope = paths.resolve({ ...emptyScope(), courseId: folder.courseId, subjectId: folder.subjectId, folderId: folder.id });
    attach(`folder:${folder.id}`, [
      !cyclicFolders.has(folder.id) && folder.parentId ? `folder:${folder.parentId}` : null,
      scope.subjectId ? `subject:${scope.subjectId}` : null,
      scope.courseId ? `course:${scope.courseId}` : null,
    ]);
  }
  for (const topic of organization.topics) {
    attach(`topic:${topic.id}`, [
      !cyclicTopics.has(topic.id) && topic.parentId ? `topic:${topic.parentId}` : null,
      topic.folderId ? `folder:${topic.folderId}` : null,
      `subject:${topic.subjectId}`,
    ]);
  }

  const query = normalizeSourceQuery(options.query ?? '');
  // One lecture, one entry: alternative transcripts of a recording are not offered.
  const preferred = new Set([...preferredRecordingTranscripts(catalog).values()].map((item) => item.sourceKey));
  const visible = catalog.filter((item) => item.kind !== 'transcript' || !item.recordingId || !item.available || preferred.has(item.sourceKey));
  for (const source of visible) {
    const locations = source.placements.length ? source.placements : [emptyScope()];
    const intrinsic = normalizeSourceQuery([source.title, source.fileName ?? ''].join(' ')).includes(query);
    const placed = new Set<string>();
    for (const location of locations) {
      const scope = paths.resolve(location);
      if (!intrinsic && !normalizeSourceQuery(paths.label(scope)).includes(query)) continue;
      const parent = (scope.topicId ? nodes.get(`topic:${scope.topicId}`) : undefined)
        ?? (scope.folderId ? nodes.get(`folder:${scope.folderId}`) : undefined)
        ?? (scope.subjectId ? nodes.get(`subject:${scope.subjectId}`) : undefined)
        ?? (scope.courseId ? nodes.get(`course:${scope.courseId}`) : undefined)
        ?? unplaced;
      if (placed.has(parent.id)) continue;
      placed.add(parent.id);
      parent.sources.push(source);
    }
  }
  if (unplaced.sources.length) root.children.push(unplaced);

  const prune = query !== '';
  const finish = (group: CompleteGuideTreeNode): boolean => {
    group.children = group.children.filter(finish).sort((a, b) => (a.kind === 'unplaced' ? 1 : 0) - (b.kind === 'unplaced' ? 1 : 0)
      || (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0)
      || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
    group.sources.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
    group.sourceKeys = [...new Set([...group.sources.filter((source) => source.available).map((source) => source.sourceKey), ...group.children.flatMap((child) => child.sourceKeys)])];
    return !prune || group.sources.length > 0 || group.children.length > 0;
  };
  finish(root);
  return root;
}

export type CompleteGuideCheckState = 'checked' | 'mixed' | 'unchecked';

export function completeGuideNodeState(node: Pick<CompleteGuideTreeNode, 'sourceKeys'>, selectedKeys: ReadonlySet<string>): CompleteGuideCheckState {
  if (!node.sourceKeys.length) return 'unchecked';
  const hits = node.sourceKeys.filter((key) => selectedKeys.has(key)).length;
  return hits === 0 ? 'unchecked' : hits === node.sourceKeys.length ? 'checked' : 'mixed';
}

export function completeGuideSelectionNode(node: CompleteGuideTreeNode): CompleteGuideSelectionNode | null {
  if (node.kind === 'root' || node.kind === 'unplaced' || !node.entityId) return null;
  return { kind: node.kind, id: node.entityId };
}

function collectDescendants(node: CompleteGuideTreeNode, into: Set<string>): void {
  into.add(node.id);
  for (const child of node.children) collectDescendants(child, into);
}

/**
 * Tick or untick a group. Ticking stores the group itself (so later material added
 * to the unit is included in "Crear otra versión"); unticking removes the group and
 * any of its descendants, and excludes its sources when an ancestor stays ticked.
 */
export function toggleCompleteGuideGroup(
  selection: CompleteGuideSelection,
  node: CompleteGuideTreeNode,
  selectedKeys: ReadonlySet<string>,
): CompleteGuideSelection {
  const inside = new Set<string>();
  collectDescendants(node, inside);
  const isInside = (entry: CompleteGuideSelectionNode) => entry.kind === 'source'
    ? node.sourceKeys.includes(entry.id)
    : inside.has(`${entry.kind}:${entry.id}`);
  const remaining = selection.nodes.filter((entry) => !isInside(entry));
  if (completeGuideNodeState(node, selectedKeys) === 'checked') {
    // Still selected through an ancestor: exclude this group's sources explicitly.
    const excluded = new Set(selection.excludedSourceKeys);
    for (const key of node.sourceKeys) excluded.add(key);
    return { nodes: remaining, excludedSourceKeys: [...excluded] };
  }
  const own = completeGuideSelectionNode(node);
  const nodes = own ? [...remaining, own] : [...remaining, ...node.sourceKeys.map((key) => ({ kind: 'source' as const, id: key }))];
  const keys = new Set(node.sourceKeys);
  return { nodes, excludedSourceKeys: selection.excludedSourceKeys.filter((key) => !keys.has(key)) };
}

export function toggleCompleteGuideSource(selection: CompleteGuideSelection, sourceKey: string, selectedKeys: ReadonlySet<string>): CompleteGuideSelection {
  if (selectedKeys.has(sourceKey)) {
    return {
      nodes: selection.nodes.filter((entry) => !(entry.kind === 'source' && entry.id === sourceKey)),
      excludedSourceKeys: [...new Set([...selection.excludedSourceKeys, sourceKey])],
    };
  }
  return {
    nodes: selection.nodes.some((entry) => entry.kind === 'source' && entry.id === sourceKey) ? selection.nodes : [...selection.nodes, { kind: 'source', id: sourceKey }],
    excludedSourceKeys: selection.excludedSourceKeys.filter((key) => key !== sourceKey),
  };
}
