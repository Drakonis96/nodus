/**
 * Pure expansion of a guide's source selection. It runs over the same organization
 * data the tree shows, so what the student ticks is exactly what the engine reads:
 * a folder includes its subfolders and the units filed in them, a unit includes its
 * subunits, and a subject or course includes everything resolved below it.
 */
import type { StudySearchScope } from '../studySearch';
import { studyOrganizationPaths, type StudySourceOrganization } from '../studySourceTree';
import type {
  CompleteGuideCatalogSource,
  CompleteGuideResolvedSelection,
  CompleteGuideResolvedSource,
  CompleteGuideSelection,
} from './types';

const TRANSCRIPT_PREFERENCE: Record<string, number> = { corrected: 0, literal: 1, notes: 2 };

function descendants(rootId: string, parentOf: Map<string, string | null>): Set<string> {
  const children = new Map<string, string[]>();
  for (const [id, parent] of parentOf) {
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(id);
    children.set(parent, list);
  }
  const found = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (found.has(id)) continue; // tolerate legacy cycles
    found.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return found;
}

/** Which transcript of each recording a guide reads: corrected, else literal, else notes. */
export function preferredRecordingTranscripts<T extends Pick<CompleteGuideCatalogSource, 'kind' | 'recordingId' | 'transcriptKind' | 'available' | 'sourceKey'>>(sources: T[]): Map<string, T> {
  const best = new Map<string, T>();
  const rank = (item: T) => TRANSCRIPT_PREFERENCE[item.transcriptKind ?? 'literal'] ?? 3;
  for (const source of sources) {
    if (source.kind !== 'transcript' || !source.recordingId || !source.available) continue;
    const current = best.get(source.recordingId);
    if (!current || rank(source) < rank(current)) best.set(source.recordingId, source);
  }
  return best;
}

export function resolveCompleteGuideSelection(
  selection: CompleteGuideSelection,
  catalog: CompleteGuideCatalogSource[],
  organization: StudySourceOrganization,
): CompleteGuideResolvedSelection {
  const paths = studyOrganizationPaths(organization);
  const folderParents = new Map(organization.folders.map((folder) => [folder.id, folder.parentId]));
  const topicParents = new Map(organization.topics.map((topic) => [topic.id, topic.parentId]));
  const topicFolder = new Map(organization.topics.map((topic) => [topic.id, topic.folderId]));

  const courseIds = new Set<string>();
  const subjectIds = new Set<string>();
  const folderIds = new Set<string>();
  const topicIds = new Set<string>();
  const explicitKeys = new Set<string>();
  for (const node of selection.nodes) {
    if (node.kind === 'course') courseIds.add(node.id);
    else if (node.kind === 'subject') subjectIds.add(node.id);
    else if (node.kind === 'folder') for (const id of descendants(node.id, folderParents)) folderIds.add(id);
    else if (node.kind === 'topic') for (const id of descendants(node.id, topicParents)) topicIds.add(id);
    else explicitKeys.add(node.id);
  }
  // Units filed inside a selected folder belong to it, and so do their subunits.
  for (const [topicId, folderId] of topicFolder) {
    if (folderId && folderIds.has(folderId)) for (const id of descendants(topicId, topicParents)) topicIds.add(id);
  }

  const matches = (scope: StudySearchScope): boolean => {
    const resolved = paths.resolve(scope);
    return Boolean((resolved.courseId && courseIds.has(resolved.courseId))
      || (resolved.subjectId && subjectIds.has(resolved.subjectId))
      || (resolved.folderId && folderIds.has(resolved.folderId))
      || (resolved.topicId && topicIds.has(resolved.topicId)));
  };

  const excluded = new Set(selection.excludedSourceKeys);
  const picked: CompleteGuideResolvedSource[] = [];
  for (const source of catalog) {
    if (excluded.has(source.sourceKey)) continue;
    const matchedPlacements = source.placements.filter(matches).map((scope) => paths.resolve(scope));
    if (!matchedPlacements.length && !explicitKeys.has(source.sourceKey)) continue;
    picked.push({ ...source, matchedPlacements: matchedPlacements.length ? matchedPlacements : source.placements.map((scope) => paths.resolve(scope)) });
  }
  const pickedKeys = new Set(picked.map((source) => source.sourceKey));
  const unavailable: CompleteGuideResolvedSelection['unavailable'] = [];
  for (const key of explicitKeys) {
    if (!pickedKeys.has(key) && !excluded.has(key)) unavailable.push({ sourceKey: key, title: key, reason: 'missing' });
  }

  // A recording can have literal, corrected and notes transcripts: they are one
  // lecture, so read the best available one once and report the others.
  const superseded: CompleteGuideResolvedSelection['superseded'] = [];
  const bestByRecording = preferredRecordingTranscripts(picked);
  const sources: CompleteGuideResolvedSource[] = [];
  for (const source of picked) {
    if (source.kind === 'transcript' && source.recordingId && source.available) {
      const kept = bestByRecording.get(source.recordingId)!;
      if (kept.sourceKey !== source.sourceKey) {
        superseded.push({ sourceKey: source.sourceKey, title: source.title, keptSourceKey: kept.sourceKey });
        continue;
      }
    }
    if (!source.available) {
      unavailable.push({ sourceKey: source.sourceKey, title: source.title, reason: source.unavailableReason ?? 'no_content' });
      continue;
    }
    sources.push(source);
  }

  const subjects = new Set<string>();
  const courses = new Set<string>();
  for (const source of sources) {
    const first = source.matchedPlacements[0];
    if (first?.subjectId) subjects.add(first.subjectId);
    if (first?.courseId) courses.add(first.courseId);
  }
  return { sources, unavailable, superseded, subjectIds: [...subjects], courseIds: [...courses] };
}
