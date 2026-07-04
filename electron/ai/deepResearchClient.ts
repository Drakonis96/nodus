import type {
  DeepResearchMeta,
  DeepResearchRequest,
  DeepResearchReport,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
  WritingWorkshopSnapshot,
} from '@shared/types';
import { buildWritingWorkshopSnapshot } from './writingWorkshop';
import {
  applyCitationPolicy,
  assembleMarkdown,
  buildCitationCatalog,
  buildReferences,
  buildSnapshotMaps,
  collectCitedWorkIds,
  countWords,
  resolveSectionPlan,
  resolveTargetPages,
  WORDS_PER_PAGE,
  type CitationCatalog,
  type DeepResearchPlanSection,
} from './deepResearchCore';

// ─────────────────────────────────────────────────────────────────────────────
// Client-driven Deep Research (Option B).
//
// Instead of Nodus's configured model writing the report, the MCP *client's* own
// model articulates and drafts it. Nodus stays the grounding authority:
//  1. buildDeepResearchBrief() prepares a self-contained "writing kit" — the
//     corpus materials with verbatim citation tokens, the target scope, and the
//     method + citation policy. The calling model then writes the report itself.
//  2. assembleClientDeepResearchReport() takes that written markdown back and
//     enforces the same citation contract as the in-app pipeline: hallucinated
//     citations are stripped, labels canonicalised, the References/bibliography
//     built from really-cited works, and the whole thing shaped into the standard
//     Writing-Workshop draft so export/save/render all work unchanged.
//
// This needs no MCP "sampling" support, so it works with any MCP client.
// ─────────────────────────────────────────────────────────────────────────────

/** The one dependency on the outside world — injected so the shaping is testable without DB/embeddings. */
export type SnapshotBuilder = (brief: WritingWorkshopBrief) => Promise<WritingWorkshopSnapshot>;

function briefFor(request: DeepResearchRequest): WritingWorkshopBrief {
  return {
    kind: 'deep_research',
    objective: request.objective,
    audience: request.audience,
    tone: 'academic',
    language: request.language ?? 'es',
  };
}

export interface DeepResearchBrief {
  mode: 'client';
  objective: string;
  language: 'es' | 'en' | 'fr';
  audience?: string;
  targetPages: { min: number; max: number };
  sections: { target: number; hardCap: number; mode: 'auto' | 'user' };
  materials: CitationCatalog;
  citationPolicy: string[];
  method: string[];
  /** The tool the writer must call with its finished draft to validate + assemble. */
  finalizeWith: string;
}

/**
 * Option B, step 1 — the writing kit for the caller's model. Ranks the corpus for
 * the objective (may use the configured embeddings for retrieval only) but never
 * writes prose. Returns every citable token the writer is allowed to use.
 */
export async function buildDeepResearchBrief(
  request: DeepResearchRequest,
  buildSnapshot: SnapshotBuilder = buildWritingWorkshopSnapshot
): Promise<DeepResearchBrief> {
  const language = request.language ?? 'es';
  const snapshot = await buildSnapshot(briefFor(request));
  const targetPages = resolveTargetPages(request.targetLength ?? 'adaptive', snapshot);
  const sectionPlan = resolveSectionPlan(targetPages, request.sectionLimit ?? 'auto');
  return {
    mode: 'client',
    objective: request.objective,
    language,
    audience: request.audience,
    targetPages,
    sections: { target: sectionPlan.target, hardCap: sectionPlan.hardCap, mode: sectionPlan.mode },
    materials: buildCitationCatalog(snapshot),
    citationPolicy: [
      'Cita CADA afirmación sustantiva con un token del catálogo, copiado EXACTAMENTE (incluido el enlace nodus://) y colocado entre paréntesis.',
      'Usa SOLO los tokens de `materials`. Cualquier cita que no esté en el catálogo será eliminada al ensamblar: no inventes autores, obras, años ni ids.',
      'Puedes citar el mismo token varias veces. No añadas una sección de Referencias ni bibliografía: Nodus la construye a partir de las obras realmente citadas.',
    ],
    method: [
      `El cuerpo debe ocupar entre ${targetPages.min} y ${targetPages.max} páginas (~${WORDS_PER_PAGE} palabras/página), repartidas en torno a ${sectionPlan.target} secciones (máximo ${sectionPlan.hardCap}).`,
      'Prefiere POCAS secciones LARGAS y profundas antes que muchas cortas: cada sección agrupa varias ideas afines y las relaciona (continuidad, tensiones, consecuencias), no una idea por sección.',
      'Reparte TODAS las ideas relevantes del catálogo entre las secciones. Sitúa los huecos y contradicciones donde aporten tensión argumental. Cierra con una síntesis.',
      'Empieza cada sección con un encabezado Markdown "## Título". No incluyas el resumen, las limitaciones ni las referencias en `sectionsMarkdown`: pásalos como campos aparte a la herramienta de ensamblado.',
      `Cuando termines de redactar, llama a \`${'nodus_finalize_deep_research'}\` con tu markdown para validar las citas, construir las referencias y (si quieres) guardar el borrador.`,
    ],
    finalizeWith: 'nodus_finalize_deep_research',
  };
}

export interface ClientFinalizeInput {
  objective: string;
  language?: 'es' | 'en' | 'fr';
  audience?: string;
  /** The body the caller's model wrote: `## ` sections only, no Resumen/Referencias. */
  sectionsMarkdown: string;
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}

function outlineFromMarkdown(markdown: string): WritingWorkshopSection[] {
  const sections: WritingWorkshopSection[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(markdown)) !== null) {
    index += 1;
    sections.push({ id: `s${index}`, title: match[1].trim(), purpose: '', keyClaims: [], sources: [] });
  }
  return sections;
}

/**
 * Option B, step 2 — take the caller-written markdown and enforce Nodus's citation
 * contract, then assemble the same report shape the in-app pipeline produces. No
 * provider/writing model is used here beyond rebuilding the retrieval snapshot.
 */
export async function assembleClientDeepResearchReport(
  input: ClientFinalizeInput,
  buildSnapshot: SnapshotBuilder = buildWritingWorkshopSnapshot
): Promise<DeepResearchReport> {
  const language = input.language ?? 'es';
  const request: DeepResearchRequest = { objective: input.objective, language, audience: input.audience };
  const brief = briefFor(request);
  const snapshot = await buildSnapshot(brief);
  const maps = buildSnapshotMaps(snapshot);

  // Enforce the citation contract on the caller's prose.
  const { markdown: cleanedBody, cited } = applyCitationPolicy(input.sectionsMarkdown ?? '', maps);
  const citedWorkIds = collectCitedWorkIds(cited, maps);
  const references = buildReferences(citedWorkIds, maps);

  const limitations = (input.limitations ?? []).map((s) => s.trim()).filter(Boolean);
  const nextSteps = (input.nextSteps ?? []).map((s) => s.trim()).filter(Boolean);
  const abstract = (input.abstract ?? '').trim();
  const title = (input.title ?? '').trim() || input.objective;

  const syntheticSection: DeepResearchPlanSection = {
    id: 's-client',
    title,
    purpose: '',
    keyClaims: [],
    ideaIds: [],
    workIds: [],
    gapIds: [],
    contradictionIds: [],
    passageIds: [],
  };
  const draftMarkdown = assembleMarkdown(
    [{ section: syntheticSection, markdown: cleanedBody }],
    references,
    { title, abstract, limitations, nextSteps },
    language
  );

  const matrix: WritingWorkshopMatrixRow[] = [...cited.ideas]
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is NonNullable<typeof idea> => !!idea)
    .slice(0, 60)
    .map((idea) => ({
      claim: (idea.statement || idea.label).slice(0, 240),
      role: idea.type === 'method' ? 'method' : 'support',
      sourceLabel: idea.works[0]?.authors[0] ?? 'Fuente del corpus',
      citation: `nodus://idea/${encodeURIComponent(idea.id)}`,
      evidence: idea.evidenceCount > 0 ? `${idea.evidenceCount} evidencia(s) ancladas en el corpus.` : 'Idea derivada del corpus.',
      notes: idea.workCount > 1 ? `Sostenida por ${idea.workCount} obras.` : 'Una obra de respaldo.',
    }));

  const words = countWords(cleanedBody);
  const pages = Math.max(1, Math.round(words / WORDS_PER_PAGE));

  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief,
    selection: {
      ideaIds: [...cited.ideas],
      themeIds: [],
      gapIds: [...cited.gaps],
      contradictionIds: [...cited.contradictions],
      workIds: [...citedWorkIds],
      passageIds: [...cited.passages],
      tutorRouteIds: [],
    },
    title,
    abstract,
    outline: outlineFromMarkdown(cleanedBody),
    draftMarkdown,
    matrix,
    bibliography: references,
    nextSteps,
    limitations,
    stats: {
      selectedIdeas: cited.ideas.size,
      selectedThemes: 0,
      selectedGaps: cited.gaps.size,
      selectedContradictions: cited.contradictions.size,
      selectedWorks: citedWorkIds.size,
      selectedPassages: cited.passages.size,
      selectedTutorRoutes: 0,
      contextChars: draftMarkdown.length,
      truncated: false,
    },
  };

  const meta: DeepResearchMeta = {
    sections: draft.outline.length,
    words,
    pages,
    ideasCovered: cited.ideas.size,
    ideasConsidered: snapshot.ideas.length,
    worksCited: citedWorkIds.size,
    targetPages: resolveTargetPages('adaptive', snapshot),
    stoppedReason: null,
  };

  return { draft, meta };
}
