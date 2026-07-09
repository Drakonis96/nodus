import type {
  ProjectDetail,
  ProjectLinkKind,
  ProjectSection,
  ProjectSectionRole,
  ProjectSectionStatus,
} from './types';

export type ProjectGuideStepId = 'brief' | 'coverage' | 'materials' | 'outline' | 'manuscript' | 'review';
export type ProjectGuideStepStatus = 'done' | 'current' | 'blocked';
export type ProjectGuideAction =
  | 'edit_brief'
  | 'mark_coverage'
  | 'mark_materials'
  | 'mark_outline'
  | 'import_chapter'
  | 'review_chapter';

export interface ProjectGuideStep {
  id: ProjectGuideStepId;
  title: string;
  summary: string;
  description: string;
  evidence: string;
  status: ProjectGuideStepStatus;
  action: ProjectGuideAction;
  actionLabel: string;
  sectionRoles: ProjectSectionRole[];
}

export interface ProjectGuide {
  title: string;
  subtitle: string;
  completion: number;
  doneCount: number;
  totalCount: number;
  nextStep: ProjectGuideStep | null;
  steps: ProjectGuideStep[];
}

const ACTIVE_SECTION_STATUSES = new Set<ProjectSectionStatus>(['in_progress', 'review', 'ready']);
const SOURCE_LINK_KINDS = new Set<ProjectLinkKind>(['work', 'idea', 'gap', 'debate', 'note', 'tutor_route', 'writing_draft']);
const OUTLINE_ROLES: ProjectSectionRole[] = ['debates', 'gaps', 'drafts'];

export function buildProjectGuide(detail: ProjectDetail): ProjectGuide {
  const briefText = detail.project.brief.trim();
  const briefReady = briefText.length > 0 || Boolean(detail.project.researchQuestionId);
  const coverageReady =
    sectionReady(detail, 'coverage') ||
    detail.links.some((link) => link.kind === 'research_question' && link.role !== 'discarded') ||
    Boolean(detail.project.researchQuestionId);
  const sourceLinks = detail.links.filter((link) => SOURCE_LINK_KINDS.has(link.kind) && link.role !== 'discarded');
  const materialsReady = sourceLinks.length > 0 || sectionReady(detail, 'literature');
  const outlineSignals = OUTLINE_ROLES.filter((role) => sectionReady(detail, role) || linksForRole(detail, role).length > 0);
  const outlineReady = outlineSignals.length >= 2;
  const manuscriptWords = detail.chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const manuscriptReady = detail.chapters.length > 0;
  const manuscriptSection = sectionForRole(detail.sections, 'manuscript');
  const reviewReady =
    detail.stats.suggestions > 0 ||
    detail.stats.appliedSuggestions > 0 ||
    manuscriptSection?.status === 'review' ||
    manuscriptSection?.status === 'ready' ||
    detail.project.status === 'done';

  const definitions: Array<Omit<ProjectGuideStep, 'status'> & { ready: boolean }> = [
    {
      id: 'brief',
      title: 'Brief y pregunta',
      summary: 'Objetivo, alcance y criterio de lectura definidos.',
      description:
        'Define el objetivo, el alcance, la pregunta principal y el criterio de selección de fuentes. Este texto aparece en la cabecera del proyecto, se envía como contexto a la IA al generar sugerencias y se incluye en la exportación.',
      evidence: briefReady ? compactEvidence(briefText || detail.project.researchQuestionId || 'Pregunta vinculada') : 'Pendiente',
      action: 'edit_brief',
      actionLabel: 'Editar brief',
      sectionRoles: ['brief'],
      ready: briefReady,
    },
    {
      id: 'coverage',
      title: 'Cobertura',
      summary: 'Pregunta principal conectada con la cobertura del corpus.',
      description:
        'Vincula tu pregunta de investigación con el corpus: indica qué áreas ya están cubiertas y qué falta por explorar. Marcar este paso como en curso activa la sección de cobertura en el proyecto.',
      evidence: coverageReady ? sectionEvidence(detail, 'coverage', 'Cobertura en curso') : 'Sin cobertura marcada',
      action: 'mark_coverage',
      actionLabel: 'Marcar cobertura',
      sectionRoles: ['coverage'],
      ready: coverageReady,
    },
    {
      id: 'materials',
      title: 'Corpus y materiales',
      summary: 'Obras, ideas, notas, huecos o borradores listos para integrarse.',
      description:
        'Añade obras, ideas, notas, huecos, debates y borradores al proyecto. Estos materiales son los que la IA usará para proponer inserciones con citas verificables en el manuscrito.',
      evidence: materialsReady
        ? sourceLinks.length > 0
          ? `${sourceLinks.length} material(es) vinculados`
          : sectionEvidence(detail, 'literature', 'Materiales en curso')
        : 'Sin materiales activos',
      action: 'mark_materials',
      actionLabel: 'Preparar materiales',
      sectionRoles: ['literature'],
      ready: materialsReady,
    },
    {
      id: 'outline',
      title: 'Estructura argumental',
      summary: 'Debates, huecos y borradores organizados antes de intervenir el texto.',
      description:
        'Organiza los debates, huecos y borradores que estructurarán el argumento antes de redactar los capítulos. Puedes activar cada bloque por separado para marcar que está listo para usarse.',
      evidence: outlineReady ? `${outlineSignals.length} bloque(s) de estructura activos` : 'Estructura pendiente',
      action: 'mark_outline',
      actionLabel: 'Preparar estructura',
      sectionRoles: OUTLINE_ROLES,
      ready: outlineReady,
    },
    {
      id: 'manuscript',
      title: 'Manuscrito',
      summary: 'Capítulo o artículo importado como texto editable y versionado.',
      description:
        'Importa un capítulo o artículo como texto editable. Nodus lo versiona automáticamente y permite aplicar sugerencias sobre el borrador.',
      evidence: manuscriptReady ? `${detail.chapters.length} capítulo(s), ${manuscriptWords} palabra(s)` : 'Sin capítulo importado',
      action: 'import_chapter',
      actionLabel: 'Subir capítulo',
      sectionRoles: ['manuscript'],
      ready: manuscriptReady,
    },
    {
      id: 'review',
      title: 'Revisión y salida',
      summary: 'Relaciones, sugerencias verificables y exportación final.',
      description:
        'Genera sugerencias verificables contra el corpus y revisa las citas del manuscrito antes de exportar o cerrar el proyecto.',
      evidence: reviewReady
        ? detail.stats.suggestions > 0 || detail.stats.appliedSuggestions > 0
          ? `${detail.stats.suggestions} sugerencia(s), ${detail.stats.appliedSuggestions} aplicada(s)`
          : sectionEvidence(detail, 'manuscript', 'Revisión registrada')
        : 'Sin revisión registrada',
      action: 'review_chapter',
      actionLabel: 'Revisar capítulo',
      sectionRoles: ['manuscript'],
      ready: reviewReady,
    },
  ];

  const firstOpenIndex = definitions.findIndex((step) => !step.ready);
  const steps = definitions.map(({ ready, ...step }, index): ProjectGuideStep => ({
    ...step,
    status: ready ? 'done' : index === firstOpenIndex ? 'current' : 'blocked',
  }));
  const doneCount = definitions.filter((step) => step.ready).length;
  const totalCount = definitions.length;

  return {
    title: guideTitle(detail.project.kind),
    subtitle: definitions[firstOpenIndex]?.summary ?? 'Proyecto listo para revisar, exportar o cerrar.',
    completion: Math.round((doneCount / totalCount) * 100),
    doneCount,
    totalCount,
    nextStep: steps.find((step) => step.status === 'current') ?? null,
    steps,
  };
}

function sectionForRole(sections: ProjectSection[], role: ProjectSectionRole): ProjectSection | null {
  return sections.find((section) => section.role === role) ?? null;
}

function sectionReady(detail: ProjectDetail, role: ProjectSectionRole): boolean {
  const section = sectionForRole(detail.sections, role);
  return Boolean(section && ACTIVE_SECTION_STATUSES.has(section.status));
}

function linksForRole(detail: ProjectDetail, role: ProjectSectionRole) {
  const ids = new Set(detail.sections.filter((section) => section.role === role).map((section) => section.id));
  return detail.links.filter((link) => link.sectionId && ids.has(link.sectionId) && link.role !== 'discarded');
}

function sectionEvidence(detail: ProjectDetail, role: ProjectSectionRole, fallback: string): string {
  const section = sectionForRole(detail.sections, role);
  if (!section) return fallback;
  const links = linksForRole(detail, role).length;
  const prefix = section.status === 'ready' ? 'Lista' : section.status === 'review' ? 'En revisión' : 'En curso';
  return links > 0 ? `${prefix}, ${links} vínculo(s)` : prefix;
}

function guideTitle(kind: ProjectDetail['project']['kind']): string {
  if (kind === 'article') return 'Flujo guiado de artículo';
  if (kind === 'thesis') return 'Flujo guiado de tesis';
  return 'Flujo guiado de manuscrito';
}

function compactEvidence(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 87)}...`;
}
