import type { ModelRef } from './types';

export type StudyKnowledgeSourceKind = 'material' | 'document';
export type StudyIdeaType = 'concept' | 'definition' | 'principle' | 'process' | 'cause' | 'consequence' | 'example' | 'debate';
export type StudyIdeaRelationType = 'related' | 'supports' | 'contrasts' | 'causes' | 'depends_on' | 'part_of' | 'applies';
export type StudyKnowledgeJobStatus = 'pending' | 'analyzing' | 'relating' | 'done' | 'error' | 'unavailable';

export interface StudyIdeaEvidence {
  id: string;
  quote: string;
  location: string;
  sourceKind: StudyKnowledgeSourceKind;
  sourceId: string;
  sourceTitle: string;
}

export interface StudyIdeaSummary {
  id: string;
  subjectId: string;
  type: StudyIdeaType;
  label: string;
  statement: string;
  evidenceCount: number;
  sourceCount: number;
  connectionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyIdeaDetail extends StudyIdeaSummary {
  evidence: StudyIdeaEvidence[];
  connections: StudyIdeaConnection[];
}

export interface StudyIdeaConnection {
  id: string;
  subjectId: string;
  fromId: string;
  toId: string;
  type: StudyIdeaRelationType;
  basis: string;
  confidence: number;
  otherId?: string;
  otherLabel?: string;
}

export interface StudyKnowledgeGraphNode {
  id: string;
  label: string;
  statement: string;
  type: StudyIdeaType;
  evidenceCount: number;
  connectionCount: number;
}

export interface StudyKnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: StudyIdeaRelationType;
  basis: string;
  confidence: number;
}

export interface StudyKnowledgeGraph {
  subjectId: string;
  nodes: StudyKnowledgeGraphNode[];
  edges: StudyKnowledgeGraphEdge[];
}

export interface StudyKnowledgeJob {
  subjectId: string;
  sourceKind: StudyKnowledgeSourceKind;
  sourceId: string;
  status: StudyKnowledgeJobStatus;
  phase: string;
  sourceHash: string;
  model: ModelRef | null;
  error: string | null;
  updatedAt: string;
}

export interface StudyKnowledgeProgress {
  pending: number;
  running: number;
  done: number;
  errors: number;
  currentTitle: string | null;
}

export interface ExtractedStudyIdea {
  key: string;
  type: StudyIdeaType;
  label: string;
  statement: string;
  role: 'principal' | 'secondary';
  confidence: number;
  evidence: Array<{ quote: string; location: string }>;
}

export interface ExtractedStudyRelation {
  from: string;
  to: string;
  type: StudyIdeaRelationType;
  basis: string;
  confidence: number;
}

export interface StudyKnowledgeExtraction {
  ideas: ExtractedStudyIdea[];
  relations: ExtractedStudyRelation[];
}

export interface StudyAssessmentKnowledgeContext {
  ideas: StudyIdeaSummary[];
  connections: StudyIdeaConnection[];
  outline: string;
  embeddingAvailable: boolean;
}
