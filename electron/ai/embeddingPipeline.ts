import type { EmbeddingPipelineProgress } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { encodeEmbedding } from '../db/ideasRepo';
import { embed } from './aiClient';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';

type ProgressListener = (p: EmbeddingPipelineProgress) => void;

const CHECKPOINT_KIND = 'embedding_batch';
const EMBED_BATCH_SIZE = 20;
const PAUSE_POLL_MS = 300;

interface EmbeddingCheckpointData {
  lastProcessedIndex: number;
}

interface WorkIdeas {
  nodusId: string;
  title: string;
  ideas: { globalId: string; label: string; statement: string }[];
}

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  works: [] as WorkIdeas[],
  currentWorkIndex: 0,
  ideasEmbedded: 0,
  totalIdeas: 0,
  currentIdeaIndex: 0,
  error: null as string | null,
  listeners: new Set<ProgressListener>(),
};

function emit(): void {
  const p = snapshot();
  for (const l of state.listeners) l(p);
}

function snapshot(): EmbeddingPipelineProgress {
  const currentWork = state.works[state.currentWorkIndex] ?? null;
  return {
    running: state.running,
    paused: state.paused,
    currentWorkIndex: state.currentWorkIndex,
    totalWorks: state.works.length,
    currentWorkTitle: currentWork?.title ?? null,
    ideasEmbedded: state.ideasEmbedded,
    totalIdeas: state.totalIdeas,
    currentIdeaIndex: state.currentIdeaIndex,
    currentWorkIdeas: currentWork?.ideas.length ?? 0,
    error: state.error,
  };
}

export function onEmbeddingProgress(cb: ProgressListener): () => void {
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}

export function getEmbeddingSnapshot(): EmbeddingPipelineProgress {
  return snapshot();
}

export function pauseEmbedding(): void {
  if (state.running) {
    state.paused = true;
    emit();
  }
}

export function resumeEmbedding(): void {
  state.paused = false;
  emit();
}

export function stopEmbedding(): void {
  state.stopRequested = true;
  state.paused = false;
}

function contentHash(): string {
  const s = getSettings();
  return `embedding:${s.embeddingProvider}:${s.embeddingModel}`;
}

function loadCheckpoint(nodusId: string): number {
  const checkpoints = loadCheckpoints(nodusId, contentHash(), CHECKPOINT_KIND);
  const entry = checkpoints.get(0) as EmbeddingCheckpointData | undefined;
  return entry?.lastProcessedIndex ?? -1;
}

function savePipelineCheckpoint(nodusId: string, lastProcessedIndex: number): void {
  saveCheckpoint(nodusId, contentHash(), CHECKPOINT_KIND, 0, { lastProcessedIndex } as EmbeddingCheckpointData);
}

function clearPipelineCheckpoints(nodusIds: string[]): void {
  for (const id of nodusIds) {
    clearCheckpoints(id, contentHash(), CHECKPOINT_KIND);
  }
}

async function waitIfPaused(): Promise<boolean> {
  while (state.paused && !state.stopRequested) {
    await new Promise((r) => setTimeout(r, PAUSE_POLL_MS));
  }
  return state.stopRequested;
}

/**
 * Start the embedding pipeline for the given works.
 * If nodusIds is empty, processes all deep-scanned works.
 */
export async function startEmbedding(nodusIds?: string[]): Promise<void> {
  if (state.running) return;

  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.error = null;
  state.works = [];
  state.currentWorkIndex = 0;
  state.ideasEmbedded = 0;
  state.totalIdeas = 0;
  state.currentIdeaIndex = 0;
  emit();

  try {
    const db = getDb();

    let workRows: { nodus_id: string; title: string }[];
    if (nodusIds && nodusIds.length > 0) {
      const placeholders = nodusIds.map(() => '?').join(',');
      workRows = db
        .prepare(`SELECT nodus_id, title FROM works WHERE nodus_id IN (${placeholders}) AND archived = 0`)
        .all(...nodusIds) as { nodus_id: string; title: string }[];
    } else {
      workRows = db
        .prepare("SELECT nodus_id, title FROM works WHERE deep_status = 'done' AND archived = 0")
        .all() as { nodus_id: string; title: string }[];
    }

    if (workRows.length === 0) {
      state.error = 'No hay obras con análisis profundo para indexar.';
      emit();
      return;
    }

    state.works = workRows.map((w) => ({
      nodusId: w.nodus_id,
      title: w.title,
      ideas: [],
    }));

    for (const wi of state.works) {
      const rows = db
        .prepare(
          `SELECT DISTINCT i.global_id, i.label, i.statement
           FROM ideas i
           JOIN idea_occurrences io ON io.global_id = i.global_id
           WHERE io.nodus_id = ? AND i.embedding IS NULL`
        )
        .all(wi.nodusId) as { global_id: string; label: string; statement: string }[];

      wi.ideas = rows.map((r) => ({
        globalId: r.global_id,
        label: r.label,
        statement: r.statement,
      }));

      state.totalIdeas += wi.ideas.length;
    }

    state.works = state.works.filter((w) => w.ideas.length > 0);
    state.totalIdeas = state.works.reduce((sum, w) => sum + w.ideas.length, 0);

    if (state.totalIdeas === 0) {
      state.error = null;
      emit();
      return;
    }

    emit();

    for (let wi = 0; wi < state.works.length; wi++) {
      if (state.stopRequested) break;

      state.currentWorkIndex = wi;
      const work = state.works[wi];
      const checkpointIdx = loadCheckpoint(work.nodusId);
      const startIdea = checkpointIdx + 1;

      if (startIdea >= work.ideas.length) {
        state.ideasEmbedded += work.ideas.length;
        emit();
        continue;
      }

      for (let ii = startIdea; ii < work.ideas.length; ii++) {
        if (await waitIfPaused()) break;

        state.currentIdeaIndex = ii;
        emit();

        const idea = work.ideas[ii];
        try {
          const text = `${idea.label}. ${idea.statement}`;
          const embedding = await embed(text);

          if (embedding) {
            const buf = encodeEmbedding(embedding);
            getDb().prepare('UPDATE ideas SET embedding = ? WHERE global_id = ?').run(buf, idea.globalId);
          }

          state.ideasEmbedded++;

          if ((ii + 1) % EMBED_BATCH_SIZE === 0 || ii === work.ideas.length - 1) {
            savePipelineCheckpoint(work.nodusId, ii);
          }
        } catch (e) {
          console.error(
            `[embeddingPipeline] error embedding idea ${idea.globalId}:`,
            e instanceof Error ? e.message : String(e)
          );
          state.ideasEmbedded++;
        }

        emit();
      }

      if (!state.stopRequested) {
        savePipelineCheckpoint(work.nodusId, work.ideas.length - 1);
      }
    }

    clearPipelineCheckpoints(state.works.map((w) => w.nodusId));
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    console.error('[embeddingPipeline] fatal error:', state.error);
  } finally {
    state.running = false;
    emit();
  }
}

/** Get per-work embedding status for the library table. */
export function getWorkEmbeddingStatuses(
  nodusIds?: string[]
): { nodus_id: string; totalIdeas: number; embeddedIdeas: number; complete: boolean }[] {
  const db = getDb();

  let rows: { nodus_id: string; total: number; embedded: number }[];
  if (nodusIds && nodusIds.length > 0) {
    const placeholders = nodusIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT io.nodus_id,
                COUNT(DISTINCT i.global_id) AS total,
                COUNT(DISTINCT CASE WHEN i.embedding IS NOT NULL THEN i.global_id END) AS embedded
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
         WHERE io.nodus_id IN (${placeholders})
         GROUP BY io.nodus_id`
      )
      .all(...nodusIds) as { nodus_id: string; total: number; embedded: number }[];
  } else {
    rows = db
      .prepare(
        `SELECT io.nodus_id,
                COUNT(DISTINCT i.global_id) AS total,
                COUNT(DISTINCT CASE WHEN i.embedding IS NOT NULL THEN i.global_id END) AS embedded
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
         GROUP BY io.nodus_id`
      )
      .all() as { nodus_id: string; total: number; embedded: number }[];
  }

  return rows.map((r) => ({
    nodus_id: r.nodus_id,
    totalIdeas: r.total,
    embeddedIdeas: r.embedded,
    complete: r.total > 0 && r.embedded === r.total,
  }));
}
