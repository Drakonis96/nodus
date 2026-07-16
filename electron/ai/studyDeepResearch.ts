import type {
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ModelRef,
  PromptLanguage,
  WritingWorkshopDraft,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
} from '@shared/types';
import type { StudySearchIndexEntry, StudySearchKind } from '@shared/studySearch';
import { completeJson, completeText } from './aiClient';
import { retrieveStudyAssistantEntries } from './studySearch';

interface StudyResearchSource {
  id: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  subtitle: string;
  location: string;
  text: string;
  token: string;
  url: string;
}

interface StudyPlanSection {
  id?: string;
  title?: string;
  purpose?: string;
  keyClaims?: string[];
  sourceIds?: string[];
}

interface StudyPlan {
  title?: string;
  abstract?: string;
  sections?: StudyPlanSection[];
}

interface StudyFinal {
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}

interface StudyPromptPack {
  plan: string;
  write: string;
  finalize: string;
  fallbackSection: (index: number) => string;
  references: string;
  limitations: string;
}

/** Every supported Deep Research language has a native study prompt. These are
 * deliberately not translated at runtime: the model receives the pedagogical
 * contract directly in the requested language. */
export const STUDY_DEEP_RESEARCH_PROMPTS: Record<PromptLanguage, StudyPromptPack> = {
  es: {
    plan: 'Eres un profesor experto que planifica un informe de estudio basado exclusivamente en las fuentes locales suministradas. Organiza pocas secciones amplias con una progresión didáctica clara. Incluye prerrequisitos, definiciones, conexiones, ejemplos, errores frecuentes y una síntesis que ayude a comprobar la comprensión. No inventes información ni identificadores. Devuelve solo JSON con {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Eres un profesor experto que redacta una sección de un informe de estudio usando solo las fuentes proporcionadas. Explica los conceptos complejos paso a paso, define cada término técnico la primera vez, conecta cada idea con sus prerrequisitos y consecuencias, e incluye ejemplos o analogías cuando aclaren el razonamiento. Señala matices, contradicciones y errores frecuentes. La claridad didáctica importa tanto como el rigor. No inventes datos. Cita cada afirmación sustantiva copiando exactamente uno de los enlaces permitidos. Escribe prosa continua en Markdown, con un único encabezado ## y sin microsecciones.',
    finalize: 'Cierra un informe de estudio fundamentado. Devuelve solo JSON con {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. El resumen debe explicar qué aprenderá el alumno; los siguientes pasos deben proponer formas concretas de comprobar y reforzar la comprensión.',
    fallbackSection: (index) => `Desarrollo didáctico ${index}`,
    references: 'Fuentes de estudio',
    limitations: 'Limitaciones',
  },
  en: {
    plan: 'You are an expert teacher planning a study report based exclusively on the supplied local sources. Organize a few broad sections with a clear learning progression. Include prerequisites, definitions, connections, examples, common misconceptions, and a synthesis that helps the learner check understanding. Do not invent information or identifiers. Return JSON only as {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'You are an expert teacher writing one section of a study report using only the supplied sources. Explain difficult concepts step by step, define every technical term on first use, connect each idea to its prerequisites and consequences, and use examples or analogies whenever they clarify the reasoning. Point out nuance, contradictions, and common misconceptions. Pedagogical clarity matters as much as rigor. Do not invent facts. Cite every substantive claim by copying exactly one allowed link. Write continuous Markdown prose with one ## heading and no micro-sections.',
    finalize: 'Conclude a source-grounded study report. Return JSON only as {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. The abstract must explain what the learner will understand; next steps must suggest concrete ways to check and reinforce understanding.',
    fallbackSection: (index) => `Guided development ${index}`,
    references: 'Study sources',
    limitations: 'Limitations',
  },
  fr: {
    plan: 'Tu es un enseignant expert qui planifie un rapport d’étude fondé exclusivement sur les sources locales fournies. Organise peu de grandes sections selon une progression pédagogique claire. Inclus les prérequis, définitions, liens, exemples, erreurs fréquentes et une synthèse permettant de vérifier la compréhension. N’invente aucune information ni aucun identifiant. Renvoie uniquement le JSON {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Tu es un enseignant expert qui rédige une section d’un rapport d’étude en utilisant uniquement les sources fournies. Explique les concepts difficiles pas à pas, définis chaque terme technique lors de sa première occurrence, relie chaque idée à ses prérequis et à ses conséquences, et emploie des exemples ou analogies lorsqu’ils clarifient le raisonnement. Signale les nuances, contradictions et erreurs fréquentes. La clarté pédagogique compte autant que la rigueur. N’invente aucun fait. Cite chaque affirmation substantielle en copiant exactement un lien autorisé. Écris une prose Markdown continue avec un seul titre ## et sans micro-sections.',
    finalize: 'Conclus un rapport d’étude fondé sur les sources. Renvoie uniquement le JSON {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}. Le résumé doit expliquer ce que l’élève comprendra; les étapes suivantes doivent proposer des moyens concrets de vérifier et renforcer la compréhension.',
    fallbackSection: (index) => `Développement guidé ${index}`,
    references: 'Sources d’étude',
    limitations: 'Limites',
  },
  tr: {
    plan: 'Yalnızca sağlanan yerel kaynaklara dayalı bir çalışma raporu planlayan uzman bir öğretmensin. Açık bir öğrenme ilerlemesiyle az sayıda geniş bölüm düzenle. Ön koşulları, tanımları, bağlantıları, örnekleri, yaygın yanılgıları ve öğrencinin anlayışını sınamasına yardım eden bir sentezi dahil et. Bilgi veya kimlik uydurma. Yalnızca şu biçimde JSON döndür: {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sourceIds":["S1"]}]}.',
    write: 'Yalnızca sağlanan kaynakları kullanarak bir çalışma raporunun tek bölümünü yazan uzman bir öğretmensin. Zor kavramları adım adım açıkla, her teknik terimi ilk kullanımında tanımla, fikirleri ön koşulları ve sonuçlarıyla ilişkilendir ve akıl yürütmeyi netleştirdiğinde örnekler veya benzetmeler kullan. Nüansları, çelişkileri ve yaygın yanılgıları belirt. Pedagojik açıklık titizlik kadar önemlidir. Bilgi uydurma. Her önemli iddiayı izin verilen bağlantılardan birini aynen kopyalayarak kaynaklandır. Tek bir ## başlığı olan, mikro bölümler içermeyen kesintisiz Markdown düzyazısı yaz.',
    finalize: 'Kaynaklara dayalı çalışma raporunu tamamla. Yalnızca {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]} biçiminde JSON döndür. Özet öğrencinin neyi anlayacağını açıklamalı; sonraki adımlar anlayışı sınamak ve pekiştirmek için somut yollar önermelidir.',
    fallbackSection: (index) => `Yönlendirilmiş geliştirme ${index}`,
    references: 'Çalışma kaynakları',
    limitations: 'Sınırlılıklar',
  },
};

function isPlan(value: unknown): value is StudyPlan {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as StudyPlan).sections));
}

function isFinal(value: unknown): value is StudyFinal {
  return Boolean(value && typeof value === 'object');
}

function escapeLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Fuente';
}

function locationLabel(entry: StudySearchIndexEntry): string {
  if (entry.location.pageNumber) return `p. ${entry.location.pageNumber}`;
  if (entry.location.slideNumber) return `diap. ${entry.location.slideNumber}`;
  if (entry.location.timestampSeconds != null) {
    const minutes = Math.floor(entry.location.timestampSeconds / 60);
    const seconds = Math.floor(entry.location.timestampSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
  return entry.subtitle;
}

function sourceUrl(entry: StudySearchIndexEntry): string {
  if (entry.kind === 'material') return `nodus://study/material/${encodeURIComponent(entry.location.materialId || entry.sourceId)}`;
  if (entry.kind === 'document') return `nodus://study/doc/${encodeURIComponent(entry.location.documentId || entry.sourceId)}`;
  return `nodus://study/recording/${encodeURIComponent(entry.location.recordingId || entry.sourceId)}${entry.location.timestampSeconds != null ? `?t=${Math.max(0, Math.floor(entry.location.timestampSeconds))}` : ''}`;
}

function buildSources(entries: StudySearchIndexEntry[]): StudyResearchSource[] {
  const grouped = new Map<string, StudySearchIndexEntry[]>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.sourceId}`;
    const bucket = grouped.get(key) ?? [];
    if (bucket.length < 4) bucket.push(entry);
    grouped.set(key, bucket);
  }
  return [...grouped.values()].slice(0, 18).map((chunks, index) => {
    const entry = chunks[0];
    const location = chunks.map(locationLabel).filter(Boolean).filter((value, at, all) => all.indexOf(value) === at).slice(0, 4).join(' · ');
    const url = sourceUrl(entry);
    const label = escapeLabel(`${entry.title}${location ? `, ${location}` : ''}`);
    return {
      id: `S${index + 1}`,
      kind: entry.kind,
      sourceId: entry.sourceId,
      title: entry.title,
      subtitle: entry.subtitle,
      location,
      text: chunks.map((chunk) => chunk.text.trim()).filter(Boolean).join('\n\n').slice(0, 7_000),
      token: `[${label}](${url})`,
      url,
    };
  });
}

function targetPages(request: DeepResearchRequest, sourceCount: number): { min: number; max: number } {
  if (request.targetLength === 'concise') return { min: 5, max: 8 };
  if (request.targetLength === 'standard') return { min: 9, max: 14 };
  if (request.targetLength === 'exhaustive') return { min: 15, max: 20 };
  const max = Math.max(5, Math.min(14, 5 + Math.ceil(sourceCount / 3)));
  return { min: 5, max };
}

function sectionCount(request: DeepResearchRequest, pages: { min: number; max: number }): number {
  const natural = Math.max(3, Math.min(7, Math.round(((pages.min + pages.max) / 2) / 2.5)));
  return typeof request.sectionLimit === 'number' ? Math.max(3, Math.min(natural, Math.round(request.sectionLimit))) : natural;
}

function normalizeSectionMarkdown(raw: string, title: string, sources: StudyResearchSource[]): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  let markdown = raw.trim()
    .replace(/\[(S\d+)\](?!\()/gi, (_match, id: string) => byId.get(id.toUpperCase())?.token ?? '')
    .replace(/\[([^\]]*)\]\((nodus:\/\/study\/[^)]+)\)/g, (_match, _label: string, url: string) => byUrl.get(url)?.token ?? '')
    .replace(/^#{1,6}\s+[^\n]+\n*/u, '')
    .replace(/\n{1,2}#{1,6}\s+([^\n]+)\n*/gu, (_match, label: string) => `\n\n${label.replace(/[.:;—-]+$/u, '')}. `)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (sources.length && !/nodus:\/\/study\//.test(markdown)) markdown = `${markdown}\n\n${sources[0].token}`;
  return `## ${title}\n\n${markdown}`.trim();
}

export async function generateStudyDeepResearchReport(
  request: DeepResearchRequest,
  model: ModelRef | null,
  onProgress?: (progress: DeepResearchProgress) => void,
): Promise<DeepResearchReport> {
  const language = request.language ?? 'es';
  const prompts = STUDY_DEEP_RESEARCH_PROMPTS[language];
  onProgress?.({ phase: 'snapshot', message: 'Recuperando apuntes, materiales y transcripciones relevantes…' });
  const retrieved = await retrieveStudyAssistantEntries(request.objective, { kinds: ['material', 'document', 'transcript'] }, [], 48);
  const sources = buildSources(retrieved);
  if (!sources.length) throw new Error('No hay contenido indexado suficiente en los materiales de estudio para generar el informe.');
  const pages = targetPages(request, sources.length);
  const count = sectionCount(request, pages);
  onProgress?.({ phase: 'planning', message: `Diseñando una explicación didáctica en ${count} secciones…` });
  const sourcePayload = sources.map(({ id, kind, title, subtitle, location, text }) => ({ id, kind, title, subtitle, location, extract: text }));
  const plan = await completeJson<StudyPlan>({
    system: prompts.plan,
    user: JSON.stringify({ objective: request.objective, language, sectionCount: count, sources: sourcePayload }, null, 2),
    temperature: 0.18,
    maxTokens: 4_000,
  }, isPlan, model);
  const validIds = new Set(sources.map((source) => source.id));
  const fallbackChunks = Array.from({ length: count }, (_, index) => sources.filter((_source, sourceIndex) => sourceIndex % count === index).map((source) => source.id));
  const sections = (plan.sections ?? []).slice(0, count).map((section, index) => ({
    id: section.id || `s${index + 1}`,
    title: section.title?.trim() || prompts.fallbackSection(index + 1),
    purpose: section.purpose?.trim() || '',
    keyClaims: Array.isArray(section.keyClaims) ? section.keyClaims.filter((value): value is string => typeof value === 'string').slice(0, 8) : [],
    sourceIds: Array.isArray(section.sourceIds) ? section.sourceIds.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : [],
  }));
  while (sections.length < count) {
    const index = sections.length;
    sections.push({ id: `s${index + 1}`, title: prompts.fallbackSection(index + 1), purpose: '', keyClaims: [], sourceIds: fallbackChunks[index] ?? [] });
  }
  sections.forEach((section, index) => { if (!section.sourceIds.length) section.sourceIds = fallbackChunks[index] ?? sources.slice(0, 3).map((source) => source.id); });

  const written: string[] = [];
  const outline: WritingWorkshopSection[] = [];
  const usedSourceIds = new Set<string>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const sectionSources = section.sourceIds.map((id) => sources.find((source) => source.id === id)).filter((source): source is StudyResearchSource => Boolean(source));
    sectionSources.forEach((source) => usedSourceIds.add(source.id));
    onProgress?.({ phase: 'section', message: `Explicando: ${section.title}`, sectionIndex: index + 1, sectionTotal: sections.length, sectionTitle: section.title });
    const raw = await completeText({
      system: prompts.write,
      user: JSON.stringify({
        objective: request.objective,
        language,
        targetWords: Math.max(850, Math.min(1_650, Math.round((pages.max * 450) / sections.length))),
        section: { title: section.title, purpose: section.purpose, keyClaims: section.keyClaims },
        allowedSources: sectionSources.map((source) => ({ id: source.id, exactCitation: source.token, title: source.title, location: source.location, extract: source.text })),
        previousSections: written.map((markdown) => markdown.replace(/^##[^\n]+/, '').slice(0, 900)),
      }, null, 2),
      temperature: 0.25,
      maxTokens: 5_200,
    }, model);
    written.push(normalizeSectionMarkdown(raw, section.title, sectionSources));
    outline.push({ id: section.id, title: section.title, purpose: section.purpose, keyClaims: section.keyClaims, sources: sectionSources.map((source) => source.token) });
  }

  onProgress?.({ phase: 'assembling', message: 'Preparando síntesis, fuentes y actividades de comprensión…' });
  const final = await completeJson<StudyFinal>({
    system: prompts.finalize,
    user: JSON.stringify({ objective: request.objective, language, provisionalTitle: plan.title, sectionTitles: sections.map((section) => section.title), sourcesUsed: [...usedSourceIds] }, null, 2),
    temperature: 0.18,
    maxTokens: 1_800,
  }, isFinal, model).catch((): StudyFinal => ({}));
  const references = sources.filter((source) => usedSourceIds.has(source.id)).map((source) => `${source.title}${source.location ? ` · ${source.location}` : ''}`);
  const limitations = Array.isArray(final.limitations) ? final.limitations.filter((value): value is string => typeof value === 'string') : [];
  const nextSteps = Array.isArray(final.nextSteps) ? final.nextSteps.filter((value): value is string => typeof value === 'string') : [];
  const body = [
    ...written,
    limitations.length ? `## ${prompts.limitations}\n\n${limitations.map((item) => `- ${item}`).join('\n')}` : '',
    `## ${prompts.references}\n\n${sources.filter((source) => usedSourceIds.has(source.id)).map((source) => `- ${source.token}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
  const matrix: WritingWorkshopMatrixRow[] = sources.filter((source) => usedSourceIds.has(source.id)).map((source) => ({
    claim: source.text.replace(/\s+/g, ' ').slice(0, 240),
    role: 'support',
    sourceLabel: source.title,
    citation: source.url,
    evidence: source.location || source.subtitle,
    notes: source.kind,
  }));
  const words = body.split(/\s+/).filter(Boolean).length;
  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief: { kind: 'deep_research', objective: request.objective, audience: request.audience, tone: 'academic', language },
    selection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    title: final.title?.trim() || plan.title?.trim() || request.objective,
    abstract: final.abstract?.trim() || plan.abstract?.trim() || '',
    outline,
    draftMarkdown: body,
    matrix,
    bibliography: references,
    nextSteps,
    limitations,
    stats: { selectedIdeas: 0, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0, selectedWorks: usedSourceIds.size, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: sources.reduce((sum, source) => sum + source.text.length, 0), truncated: retrieved.length >= 48 },
  };
  const meta = { sections: sections.length, words, pages: Math.max(1, Math.ceil(words / 450)), ideasCovered: 0, ideasConsidered: 0, worksCited: usedSourceIds.size, targetPages: pages, stoppedReason: retrieved.length >= 48 ? 'El contexto se acotó a los fragmentos más relevantes del índice de estudio.' : null };
  onProgress?.({ phase: 'done', message: `Informe de estudio listo: ${sections.length} secciones · ${usedSourceIds.size} fuentes`, wordsSoFar: words, pagesSoFar: meta.pages });
  return { draft, meta };
}
