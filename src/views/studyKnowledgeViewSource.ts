import type {
  EdgeDetail,
  EdgeType,
  GraphData,
  GraphEdge,
  IdeaConnection,
  IdeaDetail,
  IdeaListItem,
  IdeaPageRequest,
  IdeaType,
  StudyIdeaDetail,
  StudyIdeaRelationType,
  StudyIdeaSummary,
  StudyIdeaType,
} from '@shared/types';
import { t } from '../i18n';
import { buildEdgeNote } from '../notes';
import type { KnowledgeViewSource } from './knowledgeViewSource';

const STUDY_TYPE_LABEL: Record<StudyIdeaType, string> = {
  concept: 'Concepto',
  definition: 'Definición',
  principle: 'Principio',
  process: 'Proceso',
  cause: 'Causa',
  consequence: 'Consecuencia',
  example: 'Ejemplo',
  debate: 'Debate',
};

function ideaType(type: StudyIdeaType): IdeaType {
  if (type === 'process') return 'method';
  if (type === 'cause' || type === 'consequence' || type === 'example') return 'finding';
  if (type === 'debate') return 'claim';
  return 'construct';
}

function edgeType(type: StudyIdeaRelationType): EdgeType {
  if (type === 'supports') return 'supports';
  if (type === 'contrasts') return 'contradicts';
  if (type === 'causes' || type === 'depends_on') return 'precondition_of';
  if (type === 'part_of') return 'contains';
  if (type === 'applies') return 'applies_to';
  return 'variant_of';
}

function listItem(idea: StudyIdeaSummary): IdeaListItem {
  return {
    id: idea.id,
    label: idea.label,
    type: ideaType(idea.type),
    statement: idea.statement,
    workCount: idea.sourceCount,
    themes: [t(STUDY_TYPE_LABEL[idea.type])],
    maxConfidence: idea.evidenceCount > 0 ? 1 : 0.5,
    connectionCount: idea.connectionCount,
  };
}

function detail(idea: StudyIdeaDetail | null): IdeaDetail | null {
  if (!idea) return null;
  return {
    idea: {
      global_id: idea.id,
      type: ideaType(idea.type),
      label: idea.label,
      statement: idea.statement,
      created_at: idea.createdAt,
    },
    occurrences: [],
    evidence: idea.evidence.map((evidence) => ({
      id: evidence.id,
      global_id: idea.id,
      nodus_id: `study:${evidence.sourceKind}:${evidence.sourceId}`,
      quote: evidence.quote,
      location: evidence.location || null,
      kind: 'explicit',
    })),
  };
}

function connection(idea: StudyIdeaDetail, item: StudyIdeaDetail['connections'][number]): IdeaConnection | null {
  if (!item.otherId || !item.otherLabel) return null;
  return {
    edge: {
      id: item.id,
      source: item.fromId,
      target: item.toId,
      type: edgeType(item.type),
      basis: item.type === 'related' ? 'inferred' : 'explicit',
      confidence: item.confidence,
    },
    node: {
      id: item.otherId,
      label: item.otherLabel,
      type: 'construct',
      statement: '',
      workCount: 0,
      themes: [],
      maxConfidence: item.confidence,
      connectionCount: 0,
    },
  };
}

async function graphData(subjectId: string): Promise<GraphData> {
  const [graph, ideas] = await Promise.all([
    window.nodus.getStudyKnowledgeGraph(subjectId),
    window.nodus.listStudyIdeas(subjectId),
  ]);
  const summaries = new Map(ideas.map((idea) => [idea.id, idea]));
  const usedTypes = [...new Set(ideas.map((idea) => idea.type))];
  const themeId = (type: StudyIdeaType) => `theme:study:${subjectId}:${type}`;
  const themeNodes: GraphData['nodes'] = usedTypes.map((type) => ({
    id: themeId(type),
    label: t(STUDY_TYPE_LABEL[type]),
    type: 'theme',
    createdAt: ideas.filter((idea) => idea.type === type).map((idea) => idea.createdAt).sort()[0] ?? null,
    workCount: ideas.filter((idea) => idea.type === type).length,
    read: true,
    themes: [t(STUDY_TYPE_LABEL[type])],
    years: [],
    authors: [],
    maxConfidence: 1,
  }));
  const nodes: GraphData['nodes'] = graph.nodes.map((node) => {
    const summary = summaries.get(node.id);
    return {
      id: node.id,
      label: node.label,
      type: ideaType(node.type),
      createdAt: summary?.createdAt ?? null,
      statement: node.statement,
      workCount: summary?.sourceCount ?? node.evidenceCount,
      read: true,
      themes: [t(STUDY_TYPE_LABEL[node.type])],
      years: [],
      authors: [],
      maxConfidence: node.evidenceCount > 0 ? 1 : 0.5,
    };
  });
  const edges: GraphEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edgeType(edge.type),
    basis: edge.type === 'related' ? 'inferred' : 'explicit',
    confidence: edge.confidence,
  }));
  for (const idea of ideas) {
    edges.push({
      id: `study-theme:${idea.id}`,
      source: themeId(idea.type),
      target: idea.id,
      type: 'contains',
      basis: 'explicit',
      confidence: 1,
    });
  }
  return { nodes: [...themeNodes, ...nodes], edges };
}

export function createStudyKnowledgeViewSource(subjectId: string, openEvidence?: KnowledgeViewSource['openEvidence']): KnowledgeViewSource {
  const createStudyNote = async (title: string, contentMarkdown: string) => {
    const workspace = await window.nodus.getStudyWorkspace();
    const subject = workspace.subjects.find((item) => item.id === subjectId);
    await window.nodus.createStudyDocument({
      title,
      kind: 'apunte',
      contentMarkdown,
      placement: { courseId: subject?.courseId ?? null, subjectId },
    });
    window.dispatchEvent(new Event('nodus:study-workspace-changed'));
  };
  return {
    key: `study:${subjectId}`,
    capabilities: {
      authors: false,
      readingState: false,
      tutor: false,
      manageThemes: false,
      audit: false,
      duplicates: false,
    },
    async listIdeasPage(request: IdeaPageRequest) {
      let items = (await window.nodus.listStudyIdeas(subjectId, request.search)).map(listItem);
      if (request.type) items = items.filter((item) => item.type === request.type);
      items.sort((a, b) => {
        if (request.sort === 'type') return a.type.localeCompare(b.type) || a.label.localeCompare(b.label);
        if (request.sort === 'works') return b.workCount - a.workCount || a.label.localeCompare(b.label);
        if (request.sort === 'connections') return b.connectionCount - a.connectionCount || a.label.localeCompare(b.label);
        if (request.sort === 'confidence') return b.maxConfidence - a.maxConfidence || a.label.localeCompare(b.label);
        return a.label.localeCompare(b.label);
      });
      const total = items.length;
      return { items: items.slice(request.offset, request.offset + request.limit), total, offset: request.offset, limit: request.limit };
    },
    getIdeaDetail: async (id) => detail(await window.nodus.getStudyIdeaDetail(id)),
    async listIdeaConnections(id) {
      const idea = await window.nodus.getStudyIdeaDetail(id);
      return idea ? idea.connections.map((item) => connection(idea, item)).filter((item): item is IdeaConnection => Boolean(item)) : [];
    },
    async getEdgeDetail(id): Promise<EdgeDetail | null> {
      const graph = await window.nodus.getStudyKnowledgeGraph(subjectId);
      if (id.startsWith('study-theme:')) {
        const ideaId = id.slice('study-theme:'.length);
        const idea = await window.nodus.getStudyIdeaDetail(ideaId);
        if (!idea) return null;
        return {
          edge: {
            id,
            from_id: `theme:study:${subjectId}:${idea.type}`,
            to_id: idea.id,
            type: 'contains',
            basis: 'explicit',
            confidence: 1,
            source_work: null,
          },
          fromLabel: t(STUDY_TYPE_LABEL[idea.type]),
          toLabel: idea.label,
          explanation: t('Clasificación conceptual dentro de la asignatura.'),
          evidence: [],
        };
      }
      const edge = graph.edges.find((item) => item.id === id);
      if (!edge) return null;
      const fromLabel = graph.nodes.find((node) => node.id === edge.source)?.label ?? '';
      const toLabel = graph.nodes.find((node) => node.id === edge.target)?.label ?? '';
      return {
        edge: {
          id: edge.id,
          from_id: edge.source,
          to_id: edge.target,
          type: edgeType(edge.type),
          basis: edge.type === 'related' ? 'inferred' : 'explicit',
          confidence: edge.confidence,
          source_work: null,
        },
        fromLabel,
        toLabel,
        explanation: edge.basis,
        evidence: [],
      };
    },
    getGraph: () => graphData(subjectId),
    getGraphOverview: () => graphData(subjectId),
    getGraphTheme: () => graphData(subjectId),
    deleteIdea: (id) => window.nodus.deleteStudyIdea(id),
    subscribe: (refresh) => window.nodus.onStudyKnowledgeChanged(refresh),
    openEvidence,
    saveIdea: async (idea) => {
      const evidence = idea.evidence.map((item) => `> “${item.quote}”${item.location ? ` — ${item.location}` : ''}`).join('\n\n');
      await createStudyNote(idea.idea.label, `# ${idea.idea.label}\n\n${idea.idea.statement}${evidence ? `\n\n## ${t('Evidencia anclada')}\n\n${evidence}` : ''}`);
    },
    saveEdge: async (edge) => createStudyNote(`${edge.fromLabel} → ${edge.toLabel}`, buildEdgeNote(edge)),
  };
}
