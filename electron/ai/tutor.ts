import { v4 as uuid } from 'uuid';
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  TutorPlan,
  TutorPlanRequest,
  TutorRoute,
  TutorStepRequest,
  TutorStepResponse,
  TutorStop,
  TutorStopKind,
} from '@shared/types';
import { getDb } from '../db/database';
import { aggregateGaps } from '../db/gapsRepo';
import { getEdgeDetail, getIdeaDetail } from '../db/ideasRepo';
import { buildIdeaGraph, getContradictions } from '../graph/graphService';
import { completeJson, completeText, completeTextStream } from './aiClient';

// The plan is built from the SAME graph the user sees, so node ids returned by the
// model can be spotlighted directly in Cytoscape. We send a compact projection and
// cap the volume so even large corpora stay within a long-context window.
const STATEMENT_CLIP = 200;
const MAX_IDEAS = 600;
const MAX_CONNECTIONS = 900;
const MAX_GAPS = 30;
const MAX_CONTRADICTIONS = 30;
const STEP_MEMBER_IDEAS = 24;
const MAX_PLAN_REPAIR_ATTEMPTS = 2;

const EDGE_TYPE_LABELS: Record<string, string> = {
  contains: 'contiene',
  extends: 'extiende',
  variant_of: 'variante de',
  refines: 'refina',
  contradicts: 'contradice',
  applies_to: 'aplica a',
  shares_method: 'comparte método',
  precondition_of: 'precondición de',
  measures_same: 'mide lo mismo',
  supports: 'apoya',
  refutes: 'refuta',
};

const STOP_KINDS = new Set<TutorStopKind>(['theme', 'idea', 'connection']);

interface PlanResult {
  overview?: string;
  routes?: Array<{
    id?: string;
    title?: string;
    description?: string;
    weight?: number;
    weightLabel?: string;
    themes?: string[];
    stops?: Array<{
      id?: string;
      kind?: string;
      title?: string;
      focus?: string;
      nodeIds?: string[];
      edgeId?: string | null;
    }>;
  }>;
}

function isPlanResult(v: unknown): v is PlanResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as PlanResult).routes);
}

function clip(text: string, max = STATEMENT_CLIP): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** The conclusion, not the beginning, is what a following stop needs to link to. */
function clipTail(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(-max) : clean;
}

/**
 * A streamed model can occasionally emit a literal continuation marker despite
 * the prompt. It has no semantic value in a separately displayed Tutor stop.
 */
function normalizeStepNarration(text: string): string {
  const normalized = text
    .trim()
    .replace(/^(?:\s*(?:…|\.\.\.))+\s*/u, '')
    .replace(/(?:\s*(?:…|\.\.\.))+\s*$/u, '')
    .trim();
  return normalized || text.trim();
}

function yearRange(years: number[]): string | null {
  const valid = years.filter((y) => Number.isFinite(y));
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return min === max ? String(min) : `${min}–${max}`;
}

const PLAN_SYSTEM = `Eres el Tutor de Nodus: un compañero de investigación que guía al usuario, paso a paso,
por su propio grafo de ideas y temas extraído de sus lecturas. Recibes el grafo COMPLETO
(temas, ideas tipadas, conexiones reales entre ideas, contradicciones y huecos) y diseñas
RECORRIDOS GUIADOS (rutas) para que, avanzando con flechas anterior/siguiente, el usuario
comprenda todo su mapa como una LECTURA GUIADA, no como una lista de puntos sueltos.

OBJETIVO:
- Cada ruta es un HILO ARGUMENTAL continuo: una secuencia de paradas que se explican luego como
  un discurso progresivo de principio a fin. Ordena las paradas para que cada una prepare la
  siguiente, encadenándolas a través de las conexiones REALES del grafo (sigue las aristas:
  extiende, apoya, contradice, aplica a, precondición de…). Empieza por lo más central/fundacional
  y avanza hacia lo más específico o hacia los debates y huecos.
- Indica el PESO de cada ruta (1 a 5) y una etiqueta corta ("línea principal", "debate central",
  "rama secundaria"…). Ordena las rutas de mayor a menor peso.

COBERTURA (prioridad máxima):
- Prioriza la cobertura COMPLETA y significativa del grafo. Recorre TODOS los nodos relevantes y
  conectados que hagan falta para explicar bien la estructura, las conexiones y los temas. Incluye
  paradas de conexión cuando una relación sea importante para entender el encadenamiento.
- NO hay número máximo de paradas. Si una línea tiene muchas ideas relacionadas, haz una ruta
  LARGA con todas ellas en vez de resumir. Es un error grave dejar fuera ideas o conexiones
  relevantes por brevedad: prefiere una ruta extensa y exhaustiva.
- Solo omite un nodo cuando sea claramente redundante (otra idea casi idéntica ya incluida),
  irrelevante o no aporte nada nuevo. Entre todas las rutas, la unión de paradas debe cubrir la
  inmensa mayoría de las ideas y temas; reparte sin repetir el mismo nodo en exceso.

REGLAS DE IDS (estrictas):
- "nodeIds" debe contener ids que aparezcan EXACTAMENTE en el grafo recibido. Las ideas usan su
  global_id; los temas usan el formato "theme:<id>".
- kind = "theme": un único id de tema. kind = "idea": uno o varios ids de idea (normalmente uno).
  kind = "connection": EXACTAMENTE los dos ids de los extremos y, en "edgeId", el id de la
  conexión recibida que los une.
- No inventes ids ni conexiones. Si dudas de una conexión, usa una parada de idea normal.

ESTILO:
- Todo en español. "overview" describe el mapa a vista de pájaro (cuántos temas/ideas hay, qué
  líneas pesan más y qué rutas se ofrecen), en 1-2 párrafos. Puede usar Markdown ligero.
- "title"/"focus" son breves y NO deben mencionar números de parada ni fórmulas de navegación; la
  explicación larga y fluida se generará después, parada a parada.

SALIDA: EXCLUSIVAMENTE JSON válido con esta forma:
{
  "overview": "…",
  "routes": [
    {
      "title": "…",
      "description": "…",
      "weight": 1-5,
      "weightLabel": "…",
      "themes": ["…"],
      "stops": [
        { "kind": "theme|idea|connection", "title": "…", "focus": "…",
          "nodeIds": ["…"], "edgeId": "<id de conexión o null>" }
      ]
    }
  ]
}`;

const PROMPT_MODE_RULE = `\n\nMODO DIRIGIDO: el usuario ha indicado QUÉ quiere repasar (ver "objetivo_del_usuario").
Genera 1-3 rutas centradas en ese objetivo (la primera, la más ajustada y con mayor peso),
seleccionando del grafo TODAS las ideas, temas y conexiones pertinentes (no solo unas pocas) y
encadenándolas como un discurso continuo. Si el objetivo toca muchas ideas conectadas, haz una
ruta larga que las recorra todas. La "overview" debe explicar cómo has interpretado su petición.`;

const OVERVIEW_MODE_RULE = `\n\nMODO PANORÁMICO: ofrece varias rutas (normalmente 3-9, según el tamaño real del grafo) que,
EN CONJUNTO, cubran todo el grafo. La unión de sus paradas debe alcanzar la inmensa mayoría de
ideas y temas enviados. Empieza por la(s) ruta(s) de mayor peso (las líneas centrales del corpus) y
sigue con ramas secundarias, debates (contradicciones) y huecos. Cada ruta debe ser tan extensa
como haga falta para recorrer sus nodos relevantes; no resumas dejando ideas fuera. La "overview"
debe mencionar todo lo importante a vista de pájaro.`;

const PLAN_REPAIR_SYSTEM = `${PLAN_SYSTEM}

TAREA DE REVISIÓN:
El plan anterior dejó fuera nodos que Nodus ha auditado como relevantes. Debes devolver un PLAN COMPLETO NUEVO,
no un parche. Integra los nodos omitidos dentro de rutas argumentales con sentido de principio a fin: puedes
alargar rutas existentes, partir una ruta comprimida en varias o crear nuevas rutas temáticas. No crees una ruta
llamada "cobertura", "restante", "auditoría" ni una lista residual. Todo debe estar integrado como itinerarios
interpretativos de la IA.

OBLIGATORIO:
- Usa los ids de "nodos_omitidos" como paradas normales dentro de rutas coherentes.
- Mantén las reglas estrictas de ids y conexiones.
- Prefiere varias rutas largas con sentido antes que pocas rutas comprimidas.
- Devuelve EXCLUSIVAMENTE el JSON completo con overview y routes.`;

/** Compact, id-stable projection of the idea graph for the planner. */
function buildPlanContext(graph: GraphData): {
  payload: Record<string, unknown>;
  validNodeIds: Set<string>;
  edgesById: Map<string, GraphEdge>;
  plannedIdeaIds: Set<string>;
  plannedThemeIds: Set<string>;
  truncated: boolean;
  totals: { themes: number; ideas: number; connections: number };
} {
  const themeNodes = graph.nodes.filter((n) => n.type === 'theme');
  const ideaNodes = graph.nodes.filter((n) => n.type !== 'theme');
  const validNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Idea membership per theme (from "contains" edges) for compact theme summaries.
  const ideasByTheme = new Map<string, string[]>();
  const labelById = new Map<string, string>(graph.nodes.map((n) => [n.id, n.label]));
  for (const e of graph.edges) {
    if (e.type !== 'contains') continue;
    const list = ideasByTheme.get(e.source) ?? [];
    list.push(e.target);
    ideasByTheme.set(e.source, list);
  }

  const cappedIdeas = [...ideaNodes]
    .sort((a, b) => b.workCount - a.workCount || b.maxConfidence - a.maxConfidence)
    .slice(0, MAX_IDEAS);
  const ideasTruncated = ideaNodes.length > cappedIdeas.length;

  const connections = graph.edges.filter((e) => e.type !== 'contains' && validNodeIds.has(e.source) && validNodeIds.has(e.target));
  const cappedConnections = [...connections]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CONNECTIONS);
  const connectionsTruncated = connections.length > cappedConnections.length;

  const edgesById = new Map<string, GraphEdge>(cappedConnections.map((e) => [e.id, e]));
  const plannedIdeaIds = new Set(cappedIdeas.map((n) => n.id));
  const plannedThemeIds = new Set(themeNodes.map((n) => n.id));

  const themes = themeNodes.map((t) => ({
    id: t.id,
    label: t.label,
    work_count: t.workCount,
    idea_ids: (ideasByTheme.get(t.id) ?? []).slice(0, 40),
    sample_works: themeSampleWorks(t.id),
  }));

  const ideas = cappedIdeas.map((n: GraphNode) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    statement: clip(n.statement ?? ''),
    themes: n.themes,
    works: n.workCount,
    years: yearRange(n.years),
    authors: n.authors.slice(0, 3),
  }));

  const connectionsPayload = cappedConnections.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    from_label: labelById.get(e.source) ?? e.source,
    to_label: labelById.get(e.target) ?? e.target,
    type: e.type,
    type_label: EDGE_TYPE_LABELS[e.type] ?? e.type,
    basis: e.basis,
    confidence: e.confidence,
  }));

  const contradictions = getContradictions()
    .slice(0, MAX_CONTRADICTIONS)
    .map((d) => ({
      edge_id: d.edge.id,
      from: d.edge.from_id,
      to: d.edge.to_id,
      from_label: d.fromLabel,
      to_label: d.toLabel,
      explanation: clip(d.explanation ?? '', 240),
    }));

  const gaps = aggregateGaps()
    .slice(0, MAX_GAPS)
    .map((g) => ({ kind: g.kind, statement: clip(g.statement, 220), works: g.count }));

  return {
    payload: {
      resumen: {
        temas: themeNodes.length,
        ideas: ideaNodes.length,
        conexiones: connections.length,
      },
      temas: themes,
      ideas,
      conexiones: connectionsPayload,
      contradicciones: contradictions,
      huecos: gaps,
    },
    validNodeIds,
    edgesById,
    plannedIdeaIds,
    plannedThemeIds,
    truncated: ideasTruncated || connectionsTruncated,
    totals: { themes: themeNodes.length, ideas: ideaNodes.length, connections: connections.length },
  };
}

function themeSampleWorks(themeNodeId: string): { title: string; year: number | null; status: string }[] {
  const themeId = themeNodeId.startsWith('theme:') ? themeNodeId.slice('theme:'.length) : themeNodeId;
  const rows = getDb()
    .prepare(
      `SELECT w.title, w.year, w.deep_status AS status
       FROM work_themes wt
       JOIN works w ON w.nodus_id = wt.nodus_id
       WHERE wt.theme_id = ?
         AND w.archived = 0
       ORDER BY
         CASE w.deep_status WHEN 'done' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
         w.year DESC,
         w.title ASC
       LIMIT 6`
    )
    .all(themeId) as { title: string; year: number | null; status: string }[];
  return rows.map((r) => ({ title: clip(r.title, 120), year: r.year, status: r.status }));
}

function weightLabelFor(weight: number): string {
  if (weight >= 5) return 'línea principal';
  if (weight >= 4) return 'línea destacada';
  if (weight >= 3) return 'línea relevante';
  if (weight >= 2) return 'rama secundaria';
  return 'ruta de apoyo';
}

/** Validate/repair a model stop against the real graph; returns null to drop it. */
function sanitizeStop(
  raw: NonNullable<NonNullable<PlanResult['routes']>[number]['stops']>[number],
  validNodeIds: Set<string>,
  edgesById: Map<string, GraphEdge>
): TutorStop | null {
  const kind: TutorStopKind = STOP_KINDS.has(raw.kind as TutorStopKind) ? (raw.kind as TutorStopKind) : 'idea';
  let nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.filter((id) => typeof id === 'string' && validNodeIds.has(id)) : [];
  let edgeId: string | null = typeof raw.edgeId === 'string' && edgesById.has(raw.edgeId) ? raw.edgeId : null;

  if (kind === 'connection') {
    // Prefer the declared edge; otherwise try to find a real edge between the two nodes.
    if (edgeId) {
      const edge = edgesById.get(edgeId)!;
      nodeIds = [edge.source, edge.target];
    } else if (nodeIds.length >= 2) {
      const [a, b] = nodeIds;
      const match = [...edgesById.values()].find(
        (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)
      );
      if (match) {
        edgeId = match.id;
        nodeIds = [match.source, match.target];
      }
    }
  }

  nodeIds = Array.from(new Set(nodeIds)).slice(0, kind === 'connection' ? 2 : 4);
  if (nodeIds.length === 0) return null;

  return {
    id: uuid(),
    kind,
    title: clip(raw.title ?? '', 120) || 'Parada',
    focus: clip(raw.focus ?? '', 240),
    nodeIds,
    edgeId,
  };
}

function routeCoverage(routes: TutorRoute[]): { ideas: Set<string>; themes: Set<string> } {
  const ideas = new Set<string>();
  const themes = new Set<string>();
  for (const route of routes) {
    for (const stop of route.stops) {
      for (const id of stop.nodeIds) {
        if (id.startsWith('theme:')) themes.add(id);
        else ideas.add(id);
      }
    }
  }
  return { ideas, themes };
}

function sanitizeRoutes(result: PlanResult, validNodeIds: Set<string>, edgesById: Map<string, GraphEdge>): TutorRoute[] {
  const routes: TutorRoute[] = [];
  for (const rawRoute of result.routes ?? []) {
    const stops = (rawRoute.stops ?? [])
      .map((s) => sanitizeStop(s, validNodeIds, edgesById))
      .filter((s): s is TutorStop => s !== null);
    if (stops.length === 0) continue;
    const weight = Math.max(1, Math.min(5, Math.round(Number(rawRoute.weight) || 3)));
    routes.push({
      id: uuid(),
      title: clip(rawRoute.title ?? '', 140) || 'Recorrido',
      description: clip(rawRoute.description ?? '', 600),
      weight,
      weightLabel: clip(rawRoute.weightLabel ?? '', 40) || weightLabelFor(weight),
      themes: Array.isArray(rawRoute.themes)
        ? rawRoute.themes.filter((t): t is string => typeof t === 'string').slice(0, 8)
        : [],
      stops,
    });
  }
  return routes.sort((a, b) => b.weight - a.weight);
}

function routesAsPlanResult(overview: string, routes: TutorRoute[]): PlanResult {
  return {
    overview,
    routes: routes.map((route) => ({
      title: route.title,
      description: route.description,
      weight: route.weight,
      weightLabel: route.weightLabel,
      themes: route.themes,
      stops: route.stops.map((stop) => ({
        kind: stop.kind,
        title: stop.title,
        focus: stop.focus,
        nodeIds: stop.nodeIds,
        edgeId: stop.edgeId,
      })),
    })),
  };
}

function missingCoverage(
  routes: TutorRoute[],
  graph: GraphData,
  plannedIdeaIds: Set<string>,
  plannedThemeIds: Set<string>
): { missingIdeas: GraphNode[]; missingThemes: GraphNode[] } {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const covered = routeCoverage(routes);
  const missingIdeas = [...plannedIdeaIds]
    .filter((id) => !covered.ideas.has(id))
    .map((id) => nodeById.get(id))
    .filter((node): node is GraphNode => node !== undefined && node.type !== 'theme');
  const missingThemes = [...plannedThemeIds]
    .filter((id) => !covered.themes.has(id))
    .map((id) => nodeById.get(id))
    .filter((node): node is GraphNode => node !== undefined && node.type === 'theme');
  return { missingIdeas, missingThemes };
}

function compactMissingNode(node: GraphNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    statement: clip(node.statement ?? '', 180),
    themes: node.themes.slice(0, 4),
    works: node.workCount,
    authors: node.authors.slice(0, 3),
  };
}

async function repairPlanCoverage(params: {
  graphPayload: Record<string, unknown>;
  previous: PlanResult;
  missingIdeas: GraphNode[];
  missingThemes: GraphNode[];
  request: TutorPlanRequest;
}): Promise<PlanResult> {
  const user = JSON.stringify(
    {
      objetivo_del_usuario: params.request.mode === 'prompt' ? params.request.prompt ?? '' : null,
      grafo: params.graphPayload,
      plan_anterior: params.previous,
      nodos_omitidos: {
        temas: params.missingThemes.map(compactMissingNode),
        ideas: params.missingIdeas.map(compactMissingNode),
      },
    },
    null,
    0
  );

  return completeJson<PlanResult>(
    { system: PLAN_REPAIR_SYSTEM, user, temperature: 0.2, maxTokens: 14000 },
    isPlanResult,
    params.request.model
  );
}

export async function buildTutorPlan(request: TutorPlanRequest): Promise<TutorPlan> {
  const graph = buildIdeaGraph();
  if (graph.nodes.length === 0) {
    throw new Error('El grafo aún no tiene ideas. Analiza algunas obras antes de iniciar el modo Tutor.');
  }

  const { payload, validNodeIds, edgesById, plannedIdeaIds, plannedThemeIds, truncated, totals } = buildPlanContext(graph);
  const mode = request.mode === 'prompt' ? 'prompt' : 'overview';
  const prompt = (request.prompt ?? '').trim().slice(0, 2000);
  const system = `${PLAN_SYSTEM}${mode === 'prompt' ? PROMPT_MODE_RULE : OVERVIEW_MODE_RULE}`;

  const user = JSON.stringify(
    mode === 'prompt'
      ? { objetivo_del_usuario: prompt, grafo: payload }
      : {
          grafo: payload,
          auditoria_cobertura: {
            temas_a_integrar: plannedThemeIds.size,
            ideas_a_integrar: plannedIdeaIds.size,
            minimo_orientativo_de_paradas: Math.min(120, plannedThemeIds.size + plannedIdeaIds.size),
            criterio:
              'Si tu respuesta queda muy por debajo de este mínimo, faltarán nodos y deberás rediseñar rutas más largas antes de responder.',
          },
        },
    null,
    0
  );

  const result = await completeJson<PlanResult>(
    { system, user, temperature: 0.3, maxTokens: 14000 },
    isPlanResult,
    request.model
  );

  let finalResult = result;
  let routes = sanitizeRoutes(finalResult, validNodeIds, edgesById);

  if (mode === 'overview') {
    for (let attempt = 0; attempt < MAX_PLAN_REPAIR_ATTEMPTS; attempt++) {
      const missing = missingCoverage(routes, graph, plannedIdeaIds, plannedThemeIds);
      if (missing.missingIdeas.length === 0 && missing.missingThemes.length === 0) break;
      const repaired = await repairPlanCoverage({
        graphPayload: payload,
        previous: routesAsPlanResult(finalResult.overview ?? '', routes),
        missingIdeas: missing.missingIdeas,
        missingThemes: missing.missingThemes,
        request,
      });
      const repairedRoutes = sanitizeRoutes(repaired, validNodeIds, edgesById);
      if (repairedRoutes.length > 0) {
        finalResult = repaired;
        routes = repairedRoutes;
      }
    }
  }

  if (routes.length === 0) {
    throw new Error('El Tutor no pudo trazar un recorrido válido sobre el grafo actual. Inténtalo de nuevo.');
  }

  const coveredIdeas = routeCoverage(routes).ideas;

  const plan: TutorPlan = {
    generatedAt: new Date().toISOString(),
    mode,
    prompt,
    overview: (finalResult.overview ?? '').trim() || 'Recorrido guiado por tu grafo de ideas.',
    totalThemes: totals.themes,
    totalIdeas: totals.ideas,
    totalConnections: totals.connections,
    coveredIdeas: coveredIdeas.size,
    routes,
    truncated,
  };
  return plan;
}

// ── Step narration ───────────────────────────────────────────────────────────

function themeMembers(themeNodeId: string): {
  label: string;
  members: { label: string; statement: string }[];
  works: number;
  sampleWorks: { title: string; year: number | null; status: string }[];
} {
  const themeId = themeNodeId.startsWith('theme:') ? themeNodeId.slice('theme:'.length) : themeNodeId;
  const db = getDb();
  const theme = db.prepare('SELECT label FROM themes WHERE theme_id = ?').get(themeId) as { label: string } | undefined;
  const members = db
    .prepare(
      `SELECT DISTINCT i.label, i.statement
       FROM idea_theme_links it
       JOIN ideas i ON i.global_id = it.global_id
       JOIN works w ON w.nodus_id = it.nodus_id
       WHERE it.theme_id = ?
         AND w.archived = 0
         AND w.deep_status = 'done'
       ORDER BY i.label ASC
       LIMIT ?`
    )
    .all(themeId, STEP_MEMBER_IDEAS) as { label: string; statement: string }[];
  const works = (
    db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM work_themes wt
         JOIN works w ON w.nodus_id = wt.nodus_id
         WHERE wt.theme_id = ?
           AND w.archived = 0`
      )
      .get(themeId) as { c: number }
  ).c;
  return {
    label: theme?.label ?? themeNodeId,
    members: members.map((m) => ({ label: m.label, statement: clip(m.statement, 160) })),
    works,
    sampleWorks: themeSampleWorks(themeNodeId),
  };
}

function resolveStopContext(stop: TutorStop): Record<string, unknown> {
  if (stop.kind === 'theme') {
    return { tipo: 'tema', tema: themeMembers(stop.nodeIds[0]) };
  }

  if (stop.kind === 'connection' && stop.edgeId) {
    const detail = getEdgeDetail(stop.edgeId);
    if (detail) {
      return {
        tipo: 'conexión',
        relacion: EDGE_TYPE_LABELS[detail.edge.type] ?? detail.edge.type,
        base: detail.edge.basis,
        confianza: detail.edge.confidence,
        explicacion: detail.explanation ?? null,
        de: detail.fromLabel,
        a: detail.toLabel,
        evidencia: detail.evidence.slice(0, 4).map((e) => ({ cita: clip(e.quote, 280), ubicacion: e.location })),
      };
    }
  }

  // idea (or a connection whose edge could not be resolved): describe the idea node(s).
  const ideas = stop.nodeIds
    .filter((id) => !id.startsWith('theme:'))
    .map((id) => getIdeaDetail(id))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => {
      const occurrences = d.occurrences.filter((o) => o.work.archived === 0 && o.work.deep_status === 'done');
      const doneWorkIds = new Set(occurrences.map((o) => o.nodus_id));
      return {
        tipo_idea: d.idea.type,
        etiqueta: d.idea.label,
        enunciado: clip(d.idea.statement, 360),
        obras: occurrences.slice(0, 4).map((o) => ({
          titulo: o.work.title,
          autores: o.work.authors.slice(0, 3),
          anio: o.work.year,
          rol: o.role,
          desarrollo: clip(o.development, 280),
        })),
        evidencia: d.evidence
          .filter((e) => doneWorkIds.has(e.nodus_id))
          .slice(0, 4)
          .map((e) => ({ cita: clip(e.quote, 280), ubicacion: e.location })),
      };
    });
  return { tipo: 'idea', ideas };
}

function buildStepPrompt(request: TutorStepRequest): { system: string; user: string } {
  const { route, stopIndex } = request;
  const stop = route.stops[stopIndex];
  if (!stop) throw new Error('Parada de recorrido inválida.');
  const total = route.stops.length;
  const prev = stopIndex > 0 ? route.stops[stopIndex - 1] : null;
  const next = stopIndex < total - 1 ? route.stops[stopIndex + 1] : null;

  const system = [
    'Eres el Tutor de Nodus, un compañero de investigación que guía al usuario por su grafo de ideas.',
    'Estás narrando UN ÚNICO recorrido como un discurso continuo, fluido y progresivo de principio a fin,',
    'no una lista de puntos sueltos. Ahora te toca redactar el fragmento que corresponde al nodo actual.',
    'Apóyate ÚNICAMENTE en el contexto recibido (ideas, obras, evidencia, conexiones); no inventes datos.',
    '',
    'CONTINUIDAD (muy importante):',
    '- Cada parada se muestra por separado en pantalla. Escribe por tanto un BLOQUE AUTÓNOMO y cerrado',
    '  que se entienda por sí solo, pero que prolongue el mismo argumento a través del SENTIDO',
    '  (conceptos y relaciones reales del grafo).',
    '- "cierre_previo_para_contexto" es una referencia semántica: NO es una frase que debas terminar ni',
    '  un texto que debas copiar. Empieza este bloque con una oración completa, gramatical y con mayúscula.',
    '- PROHIBIDO empezar o terminar con "…" / "...", con una oración cortada o con conectores que',
    '  dependan de una frase no visible ("pero…", "por ello…", "de ahí…", "frente a ello…").',
    '- Cierra el bloque con un párrafo y una idea completos. La siguiente parada enlazará después a partir',
    '  de ese cierre; nunca dejes una frase suspendida para que otra parada la complete.',
    '- NO repitas lo ya dicho ni vuelvas a presentar ideas anteriores; añade algo nuevo.',
    '- PROHIBIDO usar fórmulas de navegación o meta-comentarios sobre el recorrido. No escribas',
    '  "bienvenido", "empecemos", "en esta parada", "la primera/segunda/última parada", "seguimos con",',
    '  "a continuación veremos", "para terminar", "como vimos antes", ni números de parada. Habla SIEMPRE',
    '  del contenido (los conceptos), nunca de la mecánica del recorrido.',
    '- Las transiciones deben ser naturales y argumentales: nombra la relación que une ambos conceptos',
    '  (p. ej. "La distinción entre X e Y permite relacionar ambos conceptos."), no anuncies un cambio de parada.',
    stopIndex === 0
      ? 'Es el ARRANQUE del hilo: entra directamente en la materia y deja encuadrado el tema sin saludos ni preámbulos.'
      : 'Es un tramo INTERMEDIO del hilo: enlaza con el bloque anterior mediante una relación conceptual explícita, sin continuar literalmente su última frase.',
    stopIndex === total - 1
      ? 'Es el CIERRE del hilo: integra y cierra el argumento de forma natural, sin anunciar que es el final.'
      : '',
    '',
    'FORMATO: redacta en Markdown válido (puedes usar negritas, cursivas, listas, citas con ">",',
    'enlaces y código en línea cuando aporten). Evita encabezados de nivel 1 (#). 1-3 párrafos sustanciosos.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const user = JSON.stringify(
    {
      recorrido: { titulo: route.title, descripcion: route.description },
      panorama: clip(request.overview, 600),
      cierre_previo_para_contexto: request.previousText ? clipTail(request.previousText, 900) : null,
      ya_tratado: (request.history ?? []).slice(-12),
      nodo_anterior: prev ? prev.title : null,
      nodo_actual: { titulo: stop.title, foco: stop.focus, contexto: resolveStopContext(stop) },
      nodo_siguiente: next ? next.title : null,
    },
    null,
    0
  );

  return { system, user };
}

export async function answerTutorStep(request: TutorStepRequest): Promise<TutorStepResponse> {
  const { system, user } = buildStepPrompt(request);
  const explanation = await completeText({ system, user, temperature: 0.35, maxTokens: 1600 }, request.model);
  return { explanation: normalizeStepNarration(explanation) };
}

export async function streamTutorStep(
  request: TutorStepRequest,
  onDelta: (delta: string) => void
): Promise<TutorStepResponse> {
  const { system, user } = buildStepPrompt(request);
  const explanation = await completeTextStream({ system, user, temperature: 0.35, maxTokens: 1600 }, onDelta, request.model);
  return { explanation: normalizeStepNarration(explanation) };
}
