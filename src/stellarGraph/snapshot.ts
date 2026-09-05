import type { StellarSession } from "@shared/stellarGraph";

export interface StellarTabSnapshot {
  session: StellarSession;
  search: string;
}

export interface StellarGraphTabDescriptor {
  id: number;
  label: string;
  initialSeed?: string;
  initialEdge?: string;
  initialSearch?: string;
  author?: string;
}

/** Only identifiers and navigation state. Never persisted to disk or shared between vaults. */
export interface StellarWorkspaceSnapshot {
  scope: string;
  targetKey: string;
  active: number;
  nextId: number;
  tabs: StellarGraphTabDescriptor[];
  states: Record<number, StellarTabSnapshot>;
}
