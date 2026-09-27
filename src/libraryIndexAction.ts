import type { DocumentPreparationState } from '@shared/researchCorpus';

export interface LibraryIndexAction {
  /** green: indexed. orange: not indexed yet, outdated or on its way. red: indexing failed. */
  tone: 'green' | 'orange' | 'red';
  /** Spanish source key for what pressing the button does now. */
  label: 'Reindexar documento' | 'Indexar documento' | 'Indexando…' | 'Reintentar indexado';
  busy: boolean;
}

/** The vault Library's index button: its colour is the document's index state and its
 * label is what pressing it will do. */
export function libraryIndexAction(state: DocumentPreparationState | undefined): LibraryIndexAction {
  if (!state) return { tone: 'orange', label: 'Indexar documento', busy: false };
  if (state.status === 'failed' || state.status === 'blocked' || state.embeddings === 'failed') return { tone: 'red', label: 'Reintentar indexado', busy: false };
  if (state.status === 'queued' || state.status === 'running' || state.embeddings === 'queued' || state.embeddings === 'running') return { tone: 'orange', label: 'Indexando…', busy: true };
  if (state.lexical === 'ready' && state.embeddings === 'ready') return { tone: 'green', label: 'Reindexar documento', busy: false };
  return { tone: 'orange', label: 'Indexar documento', busy: false };
}
