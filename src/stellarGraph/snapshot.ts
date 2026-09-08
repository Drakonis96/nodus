import type { StellarSession } from "@shared/stellarGraph";

export interface StellarTabSnapshot {
  session: StellarSession;
  search: string;
  /** Relations drawn per idea inside a theme; 0 means all of them. */
  childLimit?: number;
  /** Steps out of the focused idea a theme shows; 0 means the whole theme. */
  depth?: number;
}

export interface StellarGraphTabDescriptor {
  id: number;
  label: string;
  /** The themes hub lives on its own tab; every other tab is a blank canvas. */
  mode?: "themes";
  /** Theme the hub tab has drilled into, if any. */
  themeId?: string;
  themeLabel?: string;
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
