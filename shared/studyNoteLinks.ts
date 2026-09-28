// A Workspace note linked to where it belongs in a study or teaching vault: a course,
// subject, folder or topic, or a specific material. The note is not copied: it keeps
// living in the Workspace, and each link only says where else it should be seen.
import type { NoteKind } from './types';
import type { StudySourceOrganization } from './studySourceTree';
import { studyOrganizationPaths } from './studySourceTree';

/** The part of the note a place needs to list it without loading the whole Workspace. */
export interface StudyLinkedNoteSummary {
  id: string;
  title: string;
  kind: NoteKind;
  excerpt: string;
  tags: string[];
  updatedAt: string;
}

/**
 * A location link stores its path already resolved (like a study placement), so a note
 * linked to a topic also shows in that topic's folder, subject and course. A material
 * link carries only the material.
 */
export interface StudyNoteLink {
  id: string;
  noteId: string;
  courseId: string | null;
  subjectId: string | null;
  folderId: string | null;
  topicId: string | null;
  materialId: string | null;
  /** The material's title, for labels drawn where the materials are not loaded. */
  materialTitle: string | null;
  note: StudyLinkedNoteSummary;
  createdAt: string;
  updatedAt: string;
}

export type StudyNoteLinkInput =
  | { noteId: string; courseId?: string | null; subjectId?: string | null; folderId?: string | null; topicId?: string | null; materialId?: never }
  | { noteId: string; materialId: string };

/** Every field narrows; an empty filter lists every live link in the vault. */
export interface StudyNoteLinkFilter {
  noteId?: string;
  courseId?: string;
  subjectId?: string;
  folderId?: string;
  topicId?: string;
  materialId?: string;
}

export type StudyNoteLinkTargetKind = 'course' | 'subject' | 'folder' | 'topic' | 'material';

/** The place a link points at: its most specific level. */
export function studyNoteLinkTarget(link: Pick<StudyNoteLink, 'courseId' | 'subjectId' | 'folderId' | 'topicId' | 'materialId'>): { kind: StudyNoteLinkTargetKind; id: string } | null {
  if (link.materialId) return { kind: 'material', id: link.materialId };
  if (link.topicId) return { kind: 'topic', id: link.topicId };
  if (link.folderId) return { kind: 'folder', id: link.folderId };
  if (link.subjectId) return { kind: 'subject', id: link.subjectId };
  if (link.courseId) return { kind: 'course', id: link.courseId };
  return null;
}

/** Whether the link makes its note appear in `target` (the target itself or a container of it). */
export function studyNoteLinkShowsIn(link: StudyNoteLink, target: { kind: StudyNoteLinkTargetKind; id: string }): boolean {
  if (target.kind === 'material') return link.materialId === target.id;
  if (link.materialId) return false;
  if (target.kind === 'course') return link.courseId === target.id;
  if (target.kind === 'subject') return link.subjectId === target.id;
  if (target.kind === 'folder') return link.folderId === target.id;
  return link.topicId === target.id;
}

/** One entry per note, with every link that brought it, in first-linked order. */
export function groupStudyNoteLinks(links: readonly StudyNoteLink[]): Array<{ note: StudyLinkedNoteSummary; links: StudyNoteLink[] }> {
  const byNote = new Map<string, { note: StudyLinkedNoteSummary; links: StudyNoteLink[] }>();
  for (const link of links) {
    const entry = byNote.get(link.noteId);
    if (entry) entry.links.push(link);
    else byNote.set(link.noteId, { note: link.note, links: [link] });
  }
  return [...byNote.values()];
}

/** "Course / Subject / Folder / Topic", or the material's title. Empty when nothing resolves. */
export function studyNoteLinkLabel(link: StudyNoteLink, organization: StudySourceOrganization | null): string {
  if (link.materialId) return link.materialTitle ?? '';
  if (!organization) return '';
  return studyOrganizationPaths(organization).label({
    courseId: link.courseId, subjectId: link.subjectId, folderId: link.folderId, topicId: link.topicId,
  });
}
