export const STUDY_DOCUMENT_KINDS = [
  'apunte',
  'manual',
  'libro',
  'articulo',
  'presentacion',
  'grabacion',
  'transcripcion',
  'banco',
  'test',
  'examen',
] as const;

export type StudyDocumentKind = (typeof STUDY_DOCUMENT_KINDS)[number];
export type StudyEntityKind = 'course' | 'subject' | 'topic' | 'folder' | 'document';
export type StudyLifecycleAction = 'archive' | 'restore' | 'trash' | 'recover';

export interface StudyBaseEntity {
  id: string;
  shortId: string;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyNamedEntity extends StudyBaseEntity {
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  emoji: string | null;
  imageData: string | null;
  year: number | null;
  favorite: boolean;
}

export type StudyCourse = StudyNamedEntity;

export interface StudySubject extends StudyNamedEntity {
  courseId: string;
}

export interface StudyTopic extends StudyNamedEntity {
  subjectId: string;
  folderId: string | null;
  parentId: string | null;
}

export interface StudyFolder extends StudyNamedEntity {
  parentId: string | null;
  courseId: string | null;
  subjectId: string | null;
}

export interface StudyDocument extends StudyBaseEntity {
  title: string;
  kind: StudyDocumentKind;
  contentMarkdown: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  emoji: string | null;
  imageData: string | null;
  year: number | null;
  favorite: boolean;
  pinned: boolean;
  locked: boolean;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  embeddingTextHash: string | null;
}

export interface StudyPlacement extends StudyBaseEntity {
  documentId: string;
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  folderId: string | null;
}

export type StudyTag = StudyNamedEntity;

export interface StudyDocumentTag extends StudyBaseEntity {
  documentId: string;
  tagId: string;
}

export type StudyTemplateKind = 'organization' | 'subject' | 'document';

export interface StudyTemplate extends StudyNamedEntity {
  kind: StudyTemplateKind;
  content: StudyTemplateContent;
}

export interface StudyTemplateTopic {
  name: string;
  description?: string | null;
  children?: StudyTemplateTopic[];
}

export interface StudyTemplateSubject {
  name: string;
  description?: string | null;
  topics?: StudyTemplateTopic[];
}

export interface StudyTemplateContent {
  course?: { name?: string; description?: string | null; subjects?: StudyTemplateSubject[] };
  subject?: StudyTemplateSubject;
  document?: { title?: string; kind?: StudyDocumentKind; contentMarkdown?: string };
}

export interface StudyWorkspace {
  courses: StudyCourse[];
  subjects: StudySubject[];
  topics: StudyTopic[];
  folders: StudyFolder[];
  documents: StudyDocument[];
  placements: StudyPlacement[];
  tags: StudyTag[];
  documentTags: StudyDocumentTag[];
  templates: StudyTemplate[];
}

export interface StudyPlacementInput {
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  folderId?: string | null;
  position?: number;
}

export interface CreateStudyCourseInput {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  emoji?: string | null;
  imageData?: string | null;
  year?: number | null;
}

export interface CreateStudySubjectInput extends CreateStudyCourseInput {
  courseId: string;
}

export interface CreateStudyTopicInput extends CreateStudyCourseInput {
  subjectId: string;
  folderId?: string | null;
  parentId?: string | null;
}

export interface CreateStudyFolderInput extends CreateStudyCourseInput {
  parentId?: string | null;
  courseId?: string | null;
  subjectId?: string | null;
}

export interface StudyEntityMoveInput {
  courseId?: string | null;
  subjectId?: string | null;
  folderId?: string | null;
  parentId?: string | null;
}

export interface CreateStudyDocumentInput {
  title: string;
  kind?: StudyDocumentKind;
  contentMarkdown?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  emoji?: string | null;
  imageData?: string | null;
  year?: number | null;
  placement?: StudyPlacementInput | null;
}

export interface CreateStudyTagInput {
  name: string;
  color?: string | null;
  icon?: string | null;
}

export interface CreateStudyTemplateInput {
  name: string;
  kind: StudyTemplateKind;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  content: StudyTemplateContent;
}

export interface StudyWorkspaceOptions {
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export interface StudyTreeTopic extends StudyTopic {
  children: StudyTreeTopic[];
  documents: StudyDocument[];
}

export interface StudyTreeSubject extends StudySubject {
  topics: StudyTreeTopic[];
  documents: StudyDocument[];
}

export interface StudyTreeCourse extends StudyCourse {
  subjects: StudyTreeSubject[];
  documents: StudyDocument[];
}

export function normalizeStudyName(value: string, fallback = 'Sin título'): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function createStudyShortId(prefix: string, id: string): string {
  return `${prefix.toUpperCase()}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function isStudyEntityVisible(
  entity: Pick<StudyBaseEntity, 'archivedAt' | 'deletedAt'>,
  options: StudyWorkspaceOptions = {},
): boolean {
  if (!options.includeDeleted && entity.deletedAt) return false;
  if (!options.includeArchived && entity.archivedAt) return false;
  return true;
}

export function studyPlacementKey(input: StudyPlacementInput): string {
  return [input.courseId ?? '', input.subjectId ?? '', input.topicId ?? '', input.folderId ?? ''].join(':');
}

export function buildStudyTree(workspace: StudyWorkspace): StudyTreeCourse[] {
  const docsByTarget = new Map<string, StudyDocument[]>();
  const docById = new Map(workspace.documents.map((document) => [document.id, document]));
  for (const placement of workspace.placements) {
    const document = docById.get(placement.documentId);
    if (!document) continue;
    const keys = [
      placement.topicId && `topic:${placement.topicId}`,
      placement.subjectId && `subject:${placement.subjectId}`,
      placement.courseId && `course:${placement.courseId}`,
    ].filter(Boolean) as string[];
    const key = keys[0];
    if (!key) continue;
    const bucket = docsByTarget.get(key) ?? [];
    if (!bucket.some((candidate) => candidate.id === document.id)) bucket.push(document);
    docsByTarget.set(key, bucket);
  }

  const topicChildren = new Map<string, StudyTreeTopic[]>();
  const topicNodes = new Map<string, StudyTreeTopic>();
  for (const topic of workspace.topics) {
    topicNodes.set(topic.id, { ...topic, children: [], documents: docsByTarget.get(`topic:${topic.id}`) ?? [] });
  }
  for (const topic of topicNodes.values()) {
    if (topic.parentId && topicNodes.has(topic.parentId)) {
      topicNodes.get(topic.parentId)!.children.push(topic);
    } else {
      const bucket = topicChildren.get(topic.subjectId) ?? [];
      bucket.push(topic);
      topicChildren.set(topic.subjectId, bucket);
    }
  }

  const subjectsByCourse = new Map<string, StudyTreeSubject[]>();
  for (const subject of workspace.subjects) {
    const node: StudyTreeSubject = {
      ...subject,
      topics: topicChildren.get(subject.id) ?? [],
      documents: docsByTarget.get(`subject:${subject.id}`) ?? [],
    };
    const bucket = subjectsByCourse.get(subject.courseId) ?? [];
    bucket.push(node);
    subjectsByCourse.set(subject.courseId, bucket);
  }

  const byPosition = <T extends { position: number; name?: string; title?: string }>(a: T, b: T) =>
    a.position - b.position || (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '');
  const sortTopics = (topics: StudyTreeTopic[]) => {
    topics.sort(byPosition);
    for (const topic of topics) {
      topic.children.sort(byPosition);
      sortTopics(topic.children);
      topic.documents.sort(byPosition);
    }
  };

  const courses = workspace.courses.map((course) => ({
    ...course,
    subjects: subjectsByCourse.get(course.id) ?? [],
    documents: docsByTarget.get(`course:${course.id}`) ?? [],
  }));
  courses.sort(byPosition);
  for (const course of courses) {
    course.subjects.sort(byPosition);
    course.documents.sort(byPosition);
    for (const subject of course.subjects) {
      subject.documents.sort(byPosition);
      sortTopics(subject.topics);
    }
  }
  return courses;
}
