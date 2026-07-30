import { v4 as uuid } from 'uuid';
import type {
  ProsopNetworkEdge,
  ProsopNetworkEdgeInput,
  ProsopNetworkLayer,
  ProsopNetworkLayerInput,
  ProsopNetworksWorkspace,
} from '@shared/prosopography';
import { prosopFingerprint } from '@shared/prosopography';
import { prosopNetworkMetrics } from '@shared/prosopographyAnalysis';
import { getDb } from './database';
import { ensureProsopStudy } from './prosopStudyRepo';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function edge(row: Record<string, unknown>): ProsopNetworkEdge {
  const edgeId = String(row.edge_id);
  return {
    edgeId,
    layerId: String(row.layer_id),
    sourcePersonId: String(row.source_person_id),
    targetPersonId: String(row.target_person_id),
    relationTermId: row.relation_term_id == null ? null : String(row.relation_term_id),
    date: {
      display: row.date_display == null ? null : String(row.date_display),
      startSort: row.date_start_sort == null ? null : Number(row.date_start_sort),
      endSort: row.date_end_sort == null ? null : Number(row.date_end_sort),
    },
    weight: Number(row.weight),
    origin: row.origin as ProsopNetworkEdge['origin'],
    derivationFingerprint: row.derivation_fingerprint == null ? null : String(row.derivation_fingerprint),
    status: row.status as ProsopNetworkEdge['status'],
    factoidIds: (
      getDb()
        .prepare('SELECT factoid_id FROM prosop_network_edge_factoids WHERE edge_id=? ORDER BY factoid_id')
        .all(edgeId) as Array<{ factoid_id: string }>
    ).map((item) => item.factoid_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function layer(row: Record<string, unknown>): ProsopNetworkLayer {
  return {
    layerId: String(row.layer_id),
    studyId: String(row.study_id),
    name: String(row.name),
    kind: String(row.kind),
    derivationRule: row.derivation_rule_json == null ? null : JSON.parse(String(row.derivation_rule_json)),
    directionality: row.directionality as ProsopNetworkLayer['directionality'],
    weightPolicy: String(row.weight_policy),
    color: String(row.color),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getProsopNetworksWorkspace(): ProsopNetworksWorkspace {
  const db = getDb();
  const layers = (db.prepare('SELECT * FROM prosop_network_layers ORDER BY name').all() as Record<string, unknown>[])
    .map(layer)
    .map((item) => ({
      ...item,
      edges: (
        db
          .prepare('SELECT * FROM prosop_network_edges WHERE layer_id=? ORDER BY created_at')
          .all(item.layerId) as Record<string, unknown>[]
      ).map(edge),
    }));
  const personIds = (
    db
      .prepare("SELECT person_id FROM prosop_person_profiles WHERE identity_status!='merged' ORDER BY person_id")
      .all() as Array<{ person_id: string }>
  ).map((item) => item.person_id);
  return { layers, metrics: prosopNetworkMetrics(personIds, layers.flatMap((item) => item.edges)) };
}

export function saveProsopNetworkLayer(input: ProsopNetworkLayerInput): ProsopNetworkLayer {
  if (!input.name.trim()) throw new Error('La capa necesita un nombre.');
  const db = getDb();
  const study = ensureProsopStudy();
  const ts = now();
  const layerId = input.layerId ?? id('pnl');
  const existing = db
    .prepare('SELECT created_at FROM prosop_network_layers WHERE layer_id=?')
    .get(layerId) as { created_at: string } | undefined;
  db.prepare(
    `INSERT INTO prosop_network_layers
      (layer_id, study_id, name, kind, derivation_rule_json, directionality,
       weight_policy, color, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(layer_id) DO UPDATE SET
       name=excluded.name,
       kind=excluded.kind,
       derivation_rule_json=excluded.derivation_rule_json,
       directionality=excluded.directionality,
       weight_policy=excluded.weight_policy,
       color=excluded.color,
       updated_at=excluded.updated_at`
  ).run(
    layerId,
    study.studyId,
    input.name.trim(),
    input.kind,
    input.derivationRule == null ? null : JSON.stringify(input.derivationRule),
    input.directionality ?? 'undirected',
    input.weightPolicy ?? 'count',
    input.color ?? '#2563eb',
    existing?.created_at ?? ts,
    ts
  );
  return getProsopNetworksWorkspace().layers.find((item) => item.layerId === layerId)!;
}

export function saveProsopNetworkEdge(input: ProsopNetworkEdgeInput): ProsopNetworkEdge {
  if (input.sourcePersonId === input.targetPersonId) throw new Error('Una arista necesita dos personas distintas.');
  if (input.origin === 'explicit' && !input.factoidIds.length) {
    throw new Error('Una relación explícita necesita evidencia documental.');
  }
  if (input.origin === 'derived' && !input.derivationFingerprint) {
    throw new Error('Una relación derivada necesita una huella de derivación.');
  }
  const db = getDb();
  const ts = now();
  const edgeId = input.edgeId ?? id('pne');
  const existing = db
    .prepare('SELECT created_at FROM prosop_network_edges WHERE edge_id=?')
    .get(edgeId) as { created_at: string } | undefined;
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO prosop_network_edges
        (edge_id, layer_id, source_person_id, target_person_id, relation_term_id, date_display,
         date_start_sort, date_end_sort, weight, origin, derivation_fingerprint, status,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?)
       ON CONFLICT(edge_id) DO UPDATE SET
         source_person_id=excluded.source_person_id,
         target_person_id=excluded.target_person_id,
         relation_term_id=excluded.relation_term_id,
         date_display=excluded.date_display,
         date_start_sort=excluded.date_start_sort,
         date_end_sort=excluded.date_end_sort,
         weight=excluded.weight,
         origin=excluded.origin,
         derivation_fingerprint=excluded.derivation_fingerprint,
         status='active',
         updated_at=excluded.updated_at`
    ).run(
      edgeId,
      input.layerId,
      input.sourcePersonId,
      input.targetPersonId,
      input.relationTermId ?? null,
      input.date?.display ?? null,
      input.date?.startSort ?? null,
      input.date?.endSort ?? null,
      input.weight ?? 1,
      input.origin,
      input.derivationFingerprint ?? null,
      existing?.created_at ?? ts,
      ts
    );
    db.prepare('DELETE FROM prosop_network_edge_factoids WHERE edge_id=?').run(edgeId);
    const insert = db.prepare(
      "INSERT INTO prosop_network_edge_factoids (edge_id, factoid_id, role) VALUES (?,?,'supports')"
    );
    input.factoidIds.forEach((factoidId) => insert.run(edgeId, factoidId));
  });
  run();
  return getProsopNetworksWorkspace()
    .layers.flatMap((item) => item.edges)
    .find((item) => item.edgeId === edgeId)!;
}

export function deriveProsopCooccurrenceLayer(layerId: string): ProsopNetworkLayer {
  const db = getDb();
  const layerRow = db
    .prepare('SELECT * FROM prosop_network_layers WHERE layer_id=?')
    .get(layerId) as Record<string, unknown> | undefined;
  if (!layerRow) throw new Error('Capa no encontrada.');
  const groups = db.prepare(
    `SELECT e.entity_id AS person_id, s.factoid_id
       FROM prosop_statement_entities e
       JOIN prosop_statements s ON s.statement_id=e.statement_id
      WHERE e.entity_kind='person' AND s.status='reviewed'
      ORDER BY s.factoid_id, e.entity_id`
  ).all() as Array<{ person_id: string; factoid_id: string }>;
  const byFactoid = new Map<string, string[]>();
  groups.forEach((item) => {
    const list = byFactoid.get(item.factoid_id) ?? [];
    if (!list.includes(item.person_id)) list.push(item.person_id);
    byFactoid.set(item.factoid_id, list);
  });
  const pairs = new Map<string, { source: string; target: string; factoids: string[] }>();
  for (const [factoidId, people] of byFactoid) {
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const [source, target] = [people[i], people[j]].sort();
        const key = `${source}\0${target}`;
        const pair = pairs.get(key) ?? { source, target, factoids: [] };
        pair.factoids.push(factoidId);
        pairs.set(key, pair);
      }
    }
  }
  const fingerprint = prosopFingerprint({ engine: 'prosop-cooccurrence-1', pairs: [...pairs] });
  const run = db.transaction(() => {
    db.prepare("UPDATE prosop_network_edges SET status='retired',updated_at=? WHERE layer_id=? AND origin='derived'")
      .run(now(), layerId);
    for (const pair of pairs.values()) {
      saveProsopNetworkEdge({
        layerId,
        sourcePersonId: pair.source,
        targetPersonId: pair.target,
        origin: 'derived',
        weight: pair.factoids.length,
        derivationFingerprint: fingerprint,
        factoidIds: pair.factoids,
      });
    }
  });
  run();
  return getProsopNetworksWorkspace().layers.find((item) => item.layerId === layerId)!;
}
