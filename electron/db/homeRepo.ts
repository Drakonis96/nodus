import type { AcademicHomeStats, WorkEmbeddingStatus } from '@shared/types';
import { getWorkEmbeddingStatuses } from '../ai/embeddingPipeline';
import { getDb } from './database';
import { aggregateGaps } from './gapsRepo';
import { listGraphThemes } from './themesRepo';

type NumericRow = Record<string, number | null>;

function number(row: NumericRow, key: string): number {
  return Number(row[key] ?? 0);
}

export function summarizeEmbeddingStatuses(statuses: WorkEmbeddingStatus[]): {
  totalIdeas: number;
  embeddedIdeas: number;
  incompleteWorks: number;
} {
  let totalIdeas = 0;
  let embeddedIdeas = 0;
  let incompleteWorks = 0;
  for (const status of statuses) {
    totalIdeas += status.totalIdeas;
    embeddedIdeas += status.embeddedIdeas;
    if (status.totalIdeas > 0 && !status.complete) incompleteWorks += 1;
  }
  return { totalIdeas, embeddedIdeas, incompleteWorks };
}

/** Build Home's counters without constructing works, graph nodes, edges or gap details. */
export function getAcademicHomeStats(): AcademicHomeStats {
  const db = getDb();
  const works = db
    .prepare(
      `SELECT
         COUNT(*) AS totalWorks,
         SUM(CASE WHEN read_tag = 1 THEN 1 ELSE 0 END) AS readTaggedWorks,
         SUM(CASE WHEN manual_deep = 1 THEN 1 ELSE 0 END) AS manualDeepWorks,
         SUM(CASE WHEN read_tag != 1 THEN 1 ELSE 0 END) AS unreadWorks,
         SUM(CASE WHEN read_tag = 1 OR manual_deep = 1 OR deep_status = 'done' THEN 1 ELSE 0 END) AS deepTarget,
         SUM(CASE WHEN light_status = 'done' THEN 1 ELSE 0 END) AS lightDone,
         SUM(CASE WHEN light_status = 'pending' THEN 1 ELSE 0 END) AS lightPending,
         SUM(CASE WHEN light_status = 'none' THEN 1 ELSE 0 END) AS lightMissing,
         SUM(CASE WHEN deep_status = 'done' THEN 1 ELSE 0 END) AS deepDone,
         SUM(CASE WHEN deep_status = 'pending' THEN 1 ELSE 0 END) AS deepPending,
         SUM(CASE WHEN deep_status = 'none' THEN 1 ELSE 0 END) AS deepMissing,
         SUM(CASE WHEN deep_status = 'skipped_no_text' THEN 1 ELSE 0 END) AS skippedNoText,
         SUM(CASE WHEN light_status = 'failed' OR deep_status = 'failed' THEN 1 ELSE 0 END) AS failedWorks
       FROM works
       WHERE archived = 0`
    )
    .get() as NumericRow;
  const graph = db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT i.global_id)
            FROM ideas i
            JOIN idea_occurrences io ON io.global_id = i.global_id
            JOIN works w ON w.nodus_id = io.nodus_id
           WHERE w.archived = 0 AND w.deep_status = 'done') AS ideaNodes,
         (SELECT COUNT(*) FROM visible_edges WHERE type != 'contains') AS semanticEdges,
         (SELECT COUNT(*) FROM visible_edges WHERE type IN ('contradicts', 'refutes')) AS contradictions`
    )
    .get() as NumericRow;
  const embedding = summarizeEmbeddingStatuses(getWorkEmbeddingStatuses());

  return {
    totalWorks: number(works, 'totalWorks'),
    readTaggedWorks: number(works, 'readTaggedWorks'),
    manualDeepWorks: number(works, 'manualDeepWorks'),
    unreadWorks: number(works, 'unreadWorks'),
    deepTarget: number(works, 'deepTarget'),
    lightDone: number(works, 'lightDone'),
    lightPending: number(works, 'lightPending'),
    lightMissing: number(works, 'lightMissing'),
    deepDone: number(works, 'deepDone'),
    deepPending: number(works, 'deepPending'),
    deepMissing: number(works, 'deepMissing'),
    skippedNoText: number(works, 'skippedNoText'),
    failedWorks: number(works, 'failedWorks'),
    ideaNodes: number(graph, 'ideaNodes'),
    themeNodes: listGraphThemes().length,
    semanticEdges: number(graph, 'semanticEdges'),
    totalEmbeddableIdeas: embedding.totalIdeas,
    embeddedIdeas: embedding.embeddedIdeas,
    embeddingIncompleteWorks: embedding.incompleteWorks,
    gaps: aggregateGaps().length,
    contradictions: number(graph, 'contradictions'),
  };
}
