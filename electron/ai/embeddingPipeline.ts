import type { EmbeddingPipelineProgress } from '@shared/types';
import { getDb } from '../db/database';
import { clearAllEmbeddings, embeddingTextForIdea, ideaNeedsEmbedding, updateIdeaEmbedding } from '../db/ideasRepo';
import { allWorkSummaryRows, clearAllWorkSummaryEmbeddings, summaryNeedsEmbedding, updateWorkSummaryEmbedding } from '../db/workSummariesRepo';
import { embed } from './aiClient';
import { clearAllPassages } from '../db/passagesRepo';

type ProgressListener = (p: EmbeddingPipelineProgress) => void;

const PAUSE_POLL_MS = 300;

interface WorkIdeas {
  nodusId: string;
  title: string;
  ideas: { globalId: string; type: string; label: string; statement: string; themes: string[] }[];
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

/**
 * Dismiss the finished embedding queue without touching the embeddings already
 * written to the database. A live pipeline must be stopped first.
 */
export function clearEmbeddingProgress(): void {
  if (state.running) return;
  state.paused = false;
  state.stopRequested = false;
  state.works = [];
  state.currentWorkIndex = 0;
  state.ideasEmbedded = 0;
  state.totalIdeas = 0;
  state.currentIdeaIndex = 0;
  state.error = null;
  emit();
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
          `SELECT DISTINCT
             i.global_id,
             i.type,
             i.label,
             i.statement,
             i.embedding,
             i.embedding_provider,
             i.embedding_model,
             i.embedding_dim,
             i.embedding_text_hash,
             COALESCE((
               SELECT GROUP_CONCAT(DISTINCT t.label)
               FROM idea_theme_links it
               JOIN themes t ON t.theme_id = it.theme_id
               WHERE it.global_id = i.global_id
             ), '') AS theme_labels
           FROM ideas i
           JOIN idea_occurrences io ON io.global_id = i.global_id
           WHERE io.nodus_id = ?`
        )
        .all(wi.nodusId) as {
        global_id: string;
        type: string;
        label: string;
        statement: string;
        embedding: Buffer | null;
        embedding_provider: string | null;
        embedding_model: string | null;
        embedding_dim: number | null;
        embedding_text_hash: string | null;
        theme_labels: string;
      }[];

      wi.ideas = rows
        .map((r) => ({
          globalId: r.global_id,
          type: r.type,
          label: r.label,
          statement: r.statement,
          themes: r.theme_labels ? r.theme_labels.split(',').filter(Boolean) : [],
          embedding: r.embedding,
          embedding_provider: r.embedding_provider,
          embedding_model: r.embedding_model,
          embedding_dim: r.embedding_dim,
          embedding_text_hash: r.embedding_text_hash,
        }))
        .filter((idea) => {
          const text = embeddingTextForIdea(idea);
          return ideaNeedsEmbedding(idea, text);
        })
        .map(({
          embedding: _embedding,
          embedding_provider: _embeddingProvider,
          embedding_model: _embeddingModel,
          embedding_dim: _embeddingDim,
          embedding_text_hash: _embeddingTextHash,
          ...idea
        }) => idea);

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

      for (let ii = 0; ii < work.ideas.length; ii++) {
        if (await waitIfPaused()) break;

        state.currentIdeaIndex = ii;
        emit();

        const idea = work.ideas[ii];
        try {
          const text = embeddingTextForIdea(idea);
          const embedding = await embed(text);

          if (embedding) {
            updateIdeaEmbedding(idea.globalId, text, embedding);
          }

          state.ideasEmbedded++;

        } catch (e) {
          console.error(
            `[embeddingPipeline] error embedding idea ${idea.globalId}:`,
            e instanceof Error ? e.message : String(e)
          );
          state.ideasEmbedded++;
        }

        emit();
      }
    }
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    console.error('[embeddingPipeline] fatal error:', state.error);
  } finally {
    state.running = false;
    emit();
  }
}

/**
 * Clear all existing embeddings and re-embed every idea from scratch.
 * Useful after changing the embedding model.
 */
export async function reindexAll(): Promise<void> {
  clearAllEmbeddings();
  clearAllWorkSummaryEmbeddings();
  clearAllPassages();
  await startEmbedding();
  await reembedAllSummaries();
}

/** Rebuild orientation-summary vectors without coupling them to the idea-progress UI. */
async function reembedAllSummaries(): Promise<void> {
  for (const row of allWorkSummaryRows()) {
    if (!summaryNeedsEmbedding(row, row.summary)) continue;
    try {
      const embedding = await embed(row.summary);
      if (embedding) updateWorkSummaryEmbedding(row.nodus_id, row.summary, embedding);
    } catch (error) {
      console.error(
        `[embeddingPipeline] error embedding work summary ${row.nodus_id}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

/** Get per-work embedding status for the library table. */
export function getWorkEmbeddingStatuses(
  nodusIds?: string[]
): { nodus_id: string; totalIdeas: number; embeddedIdeas: number; complete: boolean }[] {
  const db = getDb();

  let rows: {
    nodus_id: string;
    global_id: string;
    type: string;
    label: string;
    statement: string;
    embedding: Buffer | null;
    embedding_provider: string | null;
    embedding_model: string | null;
    embedding_dim: number | null;
    embedding_text_hash: string | null;
    theme_labels: string;
  }[];
  if (nodusIds && nodusIds.length > 0) {
    const placeholders = nodusIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT DISTINCT
                io.nodus_id,
                i.global_id,
                i.type,
                i.label,
                i.statement,
                i.embedding,
                i.embedding_provider,
                i.embedding_model,
                i.embedding_dim,
                i.embedding_text_hash,
                COALESCE((
                  SELECT GROUP_CONCAT(DISTINCT t.label)
                  FROM idea_theme_links it
                  JOIN themes t ON t.theme_id = it.theme_id
                  WHERE it.global_id = i.global_id
                ), '') AS theme_labels
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
         WHERE io.nodus_id IN (${placeholders})`
      )
      .all(...nodusIds) as typeof rows;
  } else {
    rows = db
      .prepare(
        `SELECT DISTINCT
                io.nodus_id,
                i.global_id,
                i.type,
                i.label,
                i.statement,
                i.embedding,
                i.embedding_provider,
                i.embedding_model,
                i.embedding_dim,
                i.embedding_text_hash,
                COALESCE((
                  SELECT GROUP_CONCAT(DISTINCT t.label)
                  FROM idea_theme_links it
                  JOIN themes t ON t.theme_id = it.theme_id
                  WHERE it.global_id = i.global_id
                ), '') AS theme_labels
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id`
      )
      .all() as typeof rows;
  }

  const byWork = new Map<string, { total: Set<string>; embedded: Set<string> }>();
  for (const row of rows) {
    const entry = byWork.get(row.nodus_id) ?? { total: new Set<string>(), embedded: new Set<string>() };
    byWork.set(row.nodus_id, entry);
    entry.total.add(row.global_id);
    const themes = row.theme_labels ? row.theme_labels.split(',').filter(Boolean) : [];
    const text = embeddingTextForIdea({ type: row.type, label: row.label, statement: row.statement, themes });
    if (!ideaNeedsEmbedding(row, text)) entry.embedded.add(row.global_id);
  }

  return [...byWork.entries()].map(([nodus_id, value]) => ({
    nodus_id,
    totalIdeas: value.total.size,
    embeddedIdeas: value.embedded.size,
    complete: value.total.size > 0 && value.embedded.size === value.total.size,
  }));
}
