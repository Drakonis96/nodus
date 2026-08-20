export interface QaDatabaseScaleFixtureInput {
  rowCount: 1_000 | 10_000 | 250_000 | 500_000;
  name?: string;
  batchSize?: number;
}

export type QaDatabaseScaleFixtureState = 'queued' | 'running' | 'completed' | 'failed';

export interface QaDatabaseScaleFixtureStatus {
  jobId: string;
  databaseId: string;
  state: QaDatabaseScaleFixtureState;
  done: number;
  total: number;
  populatedCells: number;
  elapsedMs: number;
  message: string | null;
  columnIds: Record<string, string>;
}
