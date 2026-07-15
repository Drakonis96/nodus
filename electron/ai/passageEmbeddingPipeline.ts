import crypto from 'node:crypto';
import type { PassageEmbeddingProgress, Work } from '@shared/types';
import { getDb } from '../db/database';
import { clearAllPassages, replaceWorkPassages, workPassageStatuses } from '../db/passagesRepo';
import { getSettings } from '../db/settingsRepo';
import { planRetrievalChunks, resolveWorkText } from '../extraction/textExtractor';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { embedMany } from './aiClient';
import { addNotification } from '../notifications';

type ProgressListener = (progress: PassageEmbeddingProgress) => void;

const PAUSE_POLL_MS = 300;

interface PassageWork {
  work: Work;
  title: string;
  chunks: number;
}

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  works: [] as PassageWork[],
  currentWorkIndex: 0,
  passagesEmbedded: 0,
  totalPassages: 0,
  currentPassageIndex: 0,
  currentWorkPassages: 0,
  error: null as string | null,
  listeners: new Set<ProgressListener>(),
};

function snapshot(): PassageEmbeddingProgress {
  const current = state.works[state.currentWorkIndex] ?? null;
  return {
    running: state.running,
    paused: state.paused,
    currentWorkIndex: state.currentWorkIndex,
    totalWorks: state.works.length,
    currentWorkTitle: current?.title ?? null,
    passagesEmbedded: state.passagesEmbedded,
    totalPassages: state.totalPassages,
    currentPassageIndex: state.currentPassageIndex,
    currentWorkPassages: state.currentWorkPassages,
    error: state.error,
  };
}

function emit(): void {
  const progress = snapshot();
  for (const listener of state.listeners) listener(progress);
}

export function onPassageProgress(listener: ProgressListener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function getPassageSnapshot(): PassageEmbeddingProgress {
  return snapshot();
}

export function pausePassageEmbedding(): void {
  if (!state.running) return;
  state.paused = true;
  emit();
}

export function resumePassageEmbedding(): void {
  state.paused = false;
  emit();
}

export function stopPassageEmbedding(): void {
  state.stopRequested = true;
  state.paused = false;
}

export function clearPassageProgress(): void {
  if (state.running) return;
  state.paused = false;
  state.stopRequested = false;
  state.works = [];
  state.currentWorkIndex = 0;
  state.passagesEmbedded = 0;
  state.totalPassages = 0;
  state.currentPassageIndex = 0;
  state.currentWorkPassages = 0;
  state.error = null;
  emit();
}

async function waitIfPaused(): Promise<boolean> {
  while (state.paused && !state.stopRequested) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_POLL_MS));
  }
  return state.stopRequested;
}

/**
 * Builds/rebuilds fine retrieval chunks for any non-archived work. Passage
 * indexing is deliberately independent from deep idea analysis: a work with
 * text can be useful evidence even when it has never entered the graph.
 */
export async function startPassageEmbedding(nodusIds?: string[]): Promise<void> {
  if (state.running) return;
  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.works = [];
  state.currentWorkIndex = 0;
  state.passagesEmbedded = 0;
  state.totalPassages = 0;
  state.currentPassageIndex = 0;
  state.currentWorkPassages = 0;
  state.error = null;
  emit();

  try {
    const db = getDb();
    const ids = [...new Set(nodusIds ?? [])];
    const candidates = (ids.length
      ? db.prepare(`SELECT * FROM works WHERE nodus_id IN (${ids.map(() => '?').join(',')}) AND archived = 0`).all(...ids)
      : db.prepare('SELECT * FROM works WHERE archived = 0').all()) as Work[];
    const statuses = new Map(workPassageStatuses(candidates.map((work) => work.nodus_id)).map((status) => [status.nodus_id, status]));
    state.works = candidates
      .filter((work) => statuses.get(work.nodus_id)?.status !== 'complete')
      .map((work) => ({ work, title: work.title, chunks: 0 }));

    if (state.works.length === 0) {
      if (candidates.length === 0) state.error = 'No hay obras disponibles para indexar.';
      emit();
      return;
    }
    emit();

    const settings = getSettings();
    const userId = settings.zoteroUserId || LOCAL_USER_ID;
    for (let workIndex = 0; workIndex < state.works.length; workIndex++) {
      if (state.stopRequested || (await waitIfPaused())) break;
      state.currentWorkIndex = workIndex;
      state.currentPassageIndex = 0;
      state.currentWorkPassages = 0;
      emit();

      const entry = state.works[workIndex];
      const item = await getItem(userId, entry.work.zotero_key).catch(() => null);
      const document = await resolveWorkText(
        userId,
        entry.work.zotero_key,
        settings.zoteroStoragePath,
        item?.abstract ?? null,
        entry.work.doi,
        {
          unpaywallEmail: settings.unpaywallEmail,
          preferZoteroFulltext: settings.preferZoteroFulltext,
          ocr: {
            enabled: settings.ocrEnabled,
            languages: settings.ocrLanguages,
            maxPages: settings.ocrMaxPages,
          },
        },
        entry.work.item_type
      );
      if (state.stopRequested || (await waitIfPaused())) break;

      const chunks = planRetrievalChunks(document.text);
      entry.chunks = chunks.length;
      state.currentWorkPassages = chunks.length;
      state.totalPassages += chunks.length;
      emit();
      if (chunks.length === 0) continue;

      const embeddings = await embedMany(chunks.map((chunk) => chunk.text));
      if (state.stopRequested) break;
      for (let index = 0; index < chunks.length; index++) {
        if (await waitIfPaused()) break;
        state.currentPassageIndex = index;
        state.passagesEmbedded++;
        emit();
      }
      if (state.stopRequested) break;
      const contentHash = crypto.createHash('sha1').update(document.text).digest('hex');
      replaceWorkPassages(
        entry.work.nodus_id,
        contentHash,
        chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] ?? null }))
      );
      emit();
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    console.error('[passageEmbeddingPipeline] fatal error:', state.error);
  } finally {
    state.running = false;
    emit();
    if (!state.stopRequested && state.totalPassages > 0) {
      const english = getSettings().uiLanguage === 'en';
      addNotification({
        title: state.error ? (english ? 'Text indexing needs attention' : 'La indexación de textos necesita atención') : (english ? 'Text index completed' : 'Índice de textos completado'),
        body: state.error ? state.error : (english ? `${state.passagesEmbedded} passages indexed across ${state.works.length} work(s).` : `${state.passagesEmbedded} fragmentos indexados en ${state.works.length} obra(s).`),
        kind: state.error ? 'warning' : 'success',
        dedupeKey: `passage-embeddings:${state.error ? 'error' : 'complete'}`,
      });
    }
  }
}

export { clearAllPassages, workPassageStatuses as getWorkPassageStatuses };
