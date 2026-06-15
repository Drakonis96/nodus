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

const EDGE_TYPE_LABELS: Record<string, string> = {
  contains: 'contiene',
  extends: 'extiende',
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
comprenda todo su mapa con sentido.

OBJETIVO:
- Diseña rutas que recorran las ideas siguiendo una LÓGICA real: de lo más central/fundacional
  a lo más específico, encadenando paradas a través de las conexiones que existen en el grafo.
- Indica el PESO de cada ruta (1 a 5) y una etiqueta corta ("línea principal", "debate central",
  "rama secundaria"…). Ordena las rutas de mayor a menor peso.
- COBERTURA: entre todas las rutas debéis mencionar la inmensa mayoría de ideas y temas
  importantes. No dejes fuera lo relevante; reparte las ideas entre rutas sin repetir en exceso.
- Cada parada (stop) se ancla a nodos REALES del grafo mediante sus ids.

REGLAS DE IDS (estrictas):
- "nodeIds" debe contener ids que aparezcan EXACTAMENTE en el grafo recibido. Las ideas usan su
  global_id; los temas usan el formato "theme:<id>".
- kind = "theme": un único id de tema. kind = "idea": uno o varios ids de idea (normalmente uno).
  kind = "connection": EXACTAMENTE los dos ids de los extremos y, en "edgeId", el id de la
  conexión recibida que los une.
- No inventes ids ni conexiones. Si dudas de una conexión, usa una parada de idea normal.

ESTILO:
- Todo en español. "overview" es una bienvenida (1-2 párrafos) que describe el mapa, cuántos
  temas/ideas hay, qué líneas pesan más y qué rutas se ofrecen.
- "title"/"focus" breves; la explicación larga se generará después, parada a parada.
- Cada ruta: entre 4 y 16 paradas.

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
seleccionando del grafo SOLO las ideas, temas y conexiones pertinentes y encadenándolas con
lógica. La "overview" debe explicar cómo has interpretado su petición y qué recorrido propones.`;

const OVERVIEW_MODE_RULE = `\n\nMODO PANORÁMICO: ofrece 2-5 rutas que, en conjunto, cubran todo el grafo. Empieza por la(s)
ruta(s) de mayor peso (las líneas centrales del corpus) y sigue con ramas secundarias, debates
(contradicciones) y huecos. La "overview" debe mencionar todo lo importante a vista de pájaro.`;

/** Compact, id-stable projection of the idea graph for the planner. */
function buildPlanContext(graph: GraphData): {
  payload: Record<string, unknown>;
  validNodeIds: Set<string>;
  edgesById: Map<string, GraphEdge>;
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

  const themes = themeNodes.map((t) => ({
    id: t.id,
    label: t.label,
    work_count: t.workCount,
    idea_ids: (ideasByTheme.get(t.id) ?? []).slice(0, 40),
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
    truncated: ideasTruncated || connectionsTruncated,
    totals: { themes: themeNodes.length, ideas: ideaNodes.length, connections: connections.length },
  };
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

export async function buildTutorPlan(request: TutorPlanRequest): Promise<TutorPlan> {
  const graph = buildIdeaGraph();
  if (graph.nodes.length === 0) {
    throw new Error('El grafo aún no tiene ideas. Analiza algunas obras antes de iniciar el modo Tutor.');
  }

  const { payload, validNodeIds, edgesById, truncated, totals } = buildPlanContext(graph);
  const mode = request.mode === 'prompt' ? 'prompt' : 'overview';
  const prompt = (request.prompt ?? '').trim().slice(0, 2000);
  const system = `${PLAN_SYSTEM}${mode === 'prompt' ? PROMPT_MODE_RULE : OVERVIEW_MODE_RULE}`;

  const user = JSON.stringify(
    mode === 'prompt' ? { objetivo_del_usuario: prompt, grafo: payload } : { grafo: payload },
    null,
    0
  );

  const result = await completeJson<PlanResult>(
    { system, user, temperature: 0.3, maxTokens: 5000 },
    isPlanResult,
    request.model
  );

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
  routes.sort((a, b) => b.weight - a.weight);

  if (routes.length === 0) {
    throw new Error('El Tutor no pudo trazar un recorrido válido sobre el grafo actual. Inténtalo de nuevo.');
  }

  const coveredIdeas = new Set<string>();
  for (const route of routes) {
    for (const stop of route.stops) {
      for (const id of stop.nodeIds) if (!id.startsWith('theme:')) coveredIdeas.add(id);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode,
    prompt,
    overview: (result.overview ?? '').trim() || 'Recorrido guiado por tu grafo de ideas.',
    totalThemes: totals.themes,
    totalIdeas: totals.ideas,
    totalConnections: totals.connections,
    coveredIdeas: coveredIdeas.size,
    routes,
    truncated,
  };
}

// ── Step narration ───────────────────────────────────────────────────────────

function themeMembers(themeNodeId: string): { label: string; members: { label: string; statement: string }[]; works: number } {
  const themeId = themeNodeId.startsWith('theme:') ? themeNodeId.slice('theme:'.length) : themeNodeId;
  const db = getDb();
  const theme = db.prepare('SELECT label FROM themes WHERE theme_id = ?').get(themeId) as { label: string } | undefined;
  const members = db
    .prepare(
      `SELECT DISTINCT i.label, i.statement
       FROM idea_theme_links it JOIN ideas i ON i.global_id = it.global_id
       WHERE it.theme_id = ?
       ORDER BY i.label ASC
       LIMIT ?`
    )
    .all(themeId, STEP_MEMBER_IDEAS) as { label: string; statement: string }[];
  const works = (db.prepare('SELECT COUNT(*) AS c FROM work_themes WHERE theme_id = ?').get(themeId) as { c: number }).c;
  return {
    label: theme?.label ?? themeNodeId,
    members: members.map((m) => ({ label: m.label, statement: clip(m.statement, 160) })),
    works,
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
    .map((d) => ({
      tipo_idea: d.idea.type,
      etiqueta: d.idea.label,
      enunciado: clip(d.idea.statement, 360),
      obras: d.occurrences.slice(0, 4).map((o) => ({
        titulo: o.work.title,
        autores: o.work.authors.slice(0, 3),
        anio: o.work.year,
        rol: o.role,
        desarrollo: clip(o.development, 280),
      })),
      evidencia: d.evidence.slice(0, 4).map((e) => ({ cita: clip(e.quote, 280), ubicacion: e.location })),
    }));
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
    'Explica en español, con rigor académico y tono cercano y didáctico, la PARADA ACTUAL del recorrido.',
    'Apóyate únicamente en el contexto recibido (ideas, obras, evidencia, conexiones); no inventes datos.',
    'Conecta con la parada anterior cuando exista y anticipa brevemente la siguiente cuando aporte continuidad.',
    'Sé conciso pero sustancioso: 1-3 párrafos. No uses encabezados markdown grandes (#). Puedes usar negritas o citas.',
    stopIndex === 0
      ? 'Es la primera parada: enmarca de qué trata este recorrido antes de entrar en la idea.'
      : '',
    stopIndex === total - 1 ? 'Es la última parada: cierra con una síntesis breve de lo recorrido.' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = JSON.stringify(
    {
      recorrido: { titulo: route.title, descripcion: route.description, peso: route.weight },
      panorama: clip(request.overview, 600),
      posicion: `Parada ${stopIndex + 1} de ${total}`,
      paradas_previas: (request.history ?? []).slice(-8),
      parada_anterior: prev ? prev.title : null,
      parada_actual: { titulo: stop.title, foco: stop.focus, contexto: resolveStopContext(stop) },
      parada_siguiente: next ? next.title : null,
    },
    null,
    0
  );

  return { system, user };
}

export async function answerTutorStep(request: TutorStepRequest): Promise<TutorStepResponse> {
  const { system, user } = buildStepPrompt(request);
  const explanation = await completeText({ system, user, temperature: 0.35, maxTokens: 1600 }, request.model);
  return { explanation: explanation.trim() };
}

export async function streamTutorStep(
  request: TutorStepRequest,
  onDelta: (delta: string) => void
): Promise<TutorStepResponse> {
  const { system, user } = buildStepPrompt(request);
  const explanation = await completeTextStream({ system, user, temperature: 0.35, maxTokens: 1600 }, onDelta, request.model);
  return { explanation: explanation.trim() };
}
