import { v4 as uuid } from 'uuid';
import type { ModelRef, TutorMode, TutorPlan, TutorRoute, TutorSavedRoute } from '@shared/types';
import { getDb } from './database';

interface SavedRouteRow {
  route_id: string;
  plan_id: string;
  generated_at: string;
  updated_at: string;
  last_played_at: string | null;
  mode: TutorMode;
  prompt: string;
  model_json: string | null;
  overview: string;
  total_themes: number;
  total_ideas: number;
  total_connections: number;
  route_json: string;
  rating: number | null;
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ModelRef;
  } catch {
    return null;
  }
}

function toSavedRoute(row: SavedRouteRow): TutorSavedRoute | null {
  try {
    return {
      id: row.route_id,
      planId: row.plan_id,
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
      lastPlayedAt: row.last_played_at,
      mode: row.mode,
      prompt: row.prompt,
      model: parseModel(row.model_json),
      overview: row.overview,
      totalThemes: row.total_themes,
      totalIdeas: row.total_ideas,
      totalConnections: row.total_connections,
      route: JSON.parse(row.route_json) as TutorRoute,
      rating: row.rating,
    };
  } catch {
    return null;
  }
}

export function saveTutorPlan(plan: TutorPlan, model: ModelRef | null): void {
  const db = getDb();
  const planId = uuid();
  const now = new Date().toISOString();
  const insert = db.transaction(() => {
    for (const route of plan.routes) {
      db.prepare(
        `INSERT OR REPLACE INTO tutor_saved_routes (
           route_id, plan_id, generated_at, updated_at, last_played_at,
           mode, prompt, model_json, overview, total_themes, total_ideas,
           total_connections, route_json, rating
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        route.id,
        planId,
        plan.generatedAt,
        now,
        plan.mode,
        plan.prompt,
        model ? JSON.stringify(model) : null,
        plan.overview,
        plan.totalThemes,
        plan.totalIdeas,
        plan.totalConnections,
        JSON.stringify(route)
      );
    }
  });
  insert();
}

export function listTutorRoutes(): TutorSavedRoute[] {
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM tutor_saved_routes
       ORDER BY
         COALESCE(last_played_at, generated_at) DESC,
         generated_at DESC`
    )
    .all() as SavedRouteRow[];
  return rows.map(toSavedRoute).filter((route): route is TutorSavedRoute => route !== null);
}

export function getTutorRoute(routeId: string): TutorSavedRoute | null {
  const row = getDb().prepare('SELECT * FROM tutor_saved_routes WHERE route_id = ?').get(routeId) as SavedRouteRow | undefined;
  return row ? toSavedRoute(row) : null;
}

export function rateTutorRoute(routeId: string, rating: number | null): TutorSavedRoute | null {
  const cleanRating = rating == null ? null : Math.max(1, Math.min(5, Math.round(rating)));
  getDb()
    .prepare('UPDATE tutor_saved_routes SET rating = ?, updated_at = ? WHERE route_id = ?')
    .run(cleanRating, new Date().toISOString(), routeId);
  return getTutorRoute(routeId);
}

export function markTutorRoutePlayed(routeId: string): TutorSavedRoute | null {
  const now = new Date().toISOString();
  getDb()
    .prepare('UPDATE tutor_saved_routes SET last_played_at = ?, updated_at = ? WHERE route_id = ?')
    .run(now, now, routeId);
  return getTutorRoute(routeId);
}
