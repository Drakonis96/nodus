import { getDb } from "../db/database";
import { getActiveVault } from "../vaults/vaultRegistry";
import type { GraphNode, GraphEdge } from "@shared/types";
import type {
  StellarPageRequest,
  StellarPage,
  StellarSession,
} from "@shared/stellarGraph";

const eligible = (id: string) =>
  `EXISTS (SELECT 1 FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id=${id} AND w.archived=0 AND w.deep_status='done')`;
const edgeScope = `${eligible("e.from_id")} AND ${eligible("e.to_id")} AND (e.source_work IS NULL OR EXISTS (SELECT 1 FROM works w WHERE w.nodus_id=e.source_work AND w.archived=0 AND w.deep_status='done'))`;
const edgeSelect = `SELECT e.id,e.from_id AS source,e.to_id AS target,e.type,e.basis,e.confidence,
 (SELECT f.verdict FROM edge_feedback f WHERE f.type=e.type AND f.verdict='confirmed' AND ((f.from_id=e.from_id AND f.to_id=e.to_id) OR (f.from_id=e.to_id AND f.to_id=e.from_id)) LIMIT 1) AS verdict FROM visible_edges e`;
function nodes(ids: string[]): GraphNode[] {
  if (!ids.length) return [];
  const db = getDb();
  const bind = JSON.stringify(ids);
  const ideas = db
    .prepare(
      `SELECT global_id AS id,label,statement,type FROM ideas WHERE global_id IN (SELECT value FROM json_each(?)) AND orphaned_at IS NULL AND ${eligible("ideas.global_id")}`,
    )
    .all(bind) as Pick<GraphNode, "id" | "label" | "statement" | "type">[];
  const works = db
    .prepare(
      `SELECT io.global_id,w.nodus_id,w.year,w.authors_json,w.read_tag,io.confidence FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id IN (SELECT value FROM json_each(?)) AND w.archived=0 AND w.deep_status='done'`,
    )
    .all(bind) as {
    global_id: string;
    nodus_id: string;
    year: number;
    authors_json: string;
    read_tag: number;
    confidence: number;
  }[];
  const byId = new Map<string, typeof works>();
  for (const w of works) {
    const list = byId.get(w.global_id) ?? [];
    list.push(w);
    byId.set(w.global_id, list);
  }
  return ideas.map((i) => {
    const ws = byId.get(i.id) ?? [];
    return {
      ...i,
      label: i.label || i.statement || i.id,
      workIds: [...new Set(ws.map((w) => w.nodus_id))],
      workCount: new Set(ws.map((w) => w.nodus_id)).size,
      read: ws.every((w) => w.read_tag === 1),
      themes: [],
      years: ws.map((w) => w.year).filter(Boolean),
      authors: [
        ...new Set(
          ws.flatMap((w) => {
            try {
              return JSON.parse(w.authors_json || "[]") as string[];
            } catch {
              return [];
            }
          }),
        ),
      ],
      maxConfidence: Math.max(0, ...ws.map((w) => w.confidence)),
    };
  });
}
export function stellarPage(req: StellarPageRequest): StellarPage {
  const db = getDb(),
    offset = Math.max(0, Math.floor(req.cursor || 0)),
    limit = Math.min(200, Math.max(1, Math.floor(req.limit || 200)));
  let ids: string[] = [],
    edges: GraphEdge[] = [],
    total = 0;
  if (req.kind === "elements") {
    ids = (req.nodeIds ?? []).slice(0, 200);
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${edgeScope} AND e.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify((req.edgeIds ?? []).slice(0, 200))) as GraphEdge[];
  } else if (req.kind === "neighbors") {
    const where = `${edgeScope} AND (e.from_id=? OR e.to_id=?)`;
    total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM visible_edges e WHERE ${where}`)
        .get(req.id, req.id) as { n: number }
    ).n;
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${where} ORDER BY CASE WHEN verdict='confirmed' THEN 0 WHEN e.basis='explicit' THEN 1 ELSE 2 END,e.confidence DESC,e.id LIMIT ? OFFSET ?`,
      )
      .all(req.id, req.id, limit, offset) as GraphEdge[];
  } else if (req.kind === "work") {
    const member = `SELECT io.global_id FROM idea_occurrences io WHERE io.nodus_id=?`;
    // Page nodes and edges independently with the same cursor; both exhaust before next=null.
    ids = (
      db
        .prepare(
          `SELECT i.global_id AS id FROM ideas i WHERE i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND i.global_id IN (${member}) ORDER BY i.global_id LIMIT ? OFFSET ?`,
        )
        .all(req.id, limit, offset) as { id: string }[]
    ).map((r) => r.id);
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member}) ORDER BY e.id LIMIT ? OFFSET ?`,
      )
      .all(req.id, req.id, limit, offset) as GraphEdge[];
    const n = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT global_id) AS n FROM idea_occurrences WHERE nodus_id=?`,
        )
        .get(req.id) as { n: number }
    ).n;
    const e = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM visible_edges e WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member})`,
        )
        .get(req.id, req.id) as { n: number }
    ).n;
    total = Math.max(n, e);
  } else {
    const query = `%${req.search || ""}%`;
    const where = `i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND (i.label LIKE ? OR i.statement LIKE ?) ${req.author ? "AND EXISTS (SELECT 1 FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id=i.global_id AND w.authors_json LIKE ?)" : ""}`;
    const args: unknown[] = [query, query];
    if (req.author) args.push(`%${req.author}%`);
    total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ideas i WHERE ${where}`)
        .get(...args) as { n: number }
    ).n;
    ids = (
      db
        .prepare(
          `SELECT i.global_id AS id FROM ideas i WHERE ${where} ORDER BY i.label,i.global_id LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset) as { id: string }[]
    ).map((r) => r.id);
  }
  ids = [...new Set([...ids, ...edges.flatMap((e) => [e.source, e.target])])];
  return {
    nodes: nodes(ids),
    edges,
    total,
    next:
      req.kind === "elements" || offset + limit >= total
        ? null
        : offset + limit,
  };
}
export function getStellarSession(key: string) {
  const row = getDb()
    .prepare("SELECT state FROM stellar_sessions WHERE context=?")
    .get(key) as { state: string } | undefined;
  return {
    vaultId: getActiveVault().id,
    session: row ? (JSON.parse(row.state) as StellarSession) : null,
  };
}
export function saveStellarSession(
  vaultId: string,
  key: string,
  state: StellarSession,
) {
  if (getActiveVault().id !== vaultId) return;
  if (state.version !== 1) throw new Error("Unsupported canvas session");
  getDb()
    .prepare(
      "INSERT INTO stellar_sessions(context,state,updated_at) VALUES(?,?,?) ON CONFLICT(context) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
    )
    .run(key, JSON.stringify(state), new Date().toISOString());
}
