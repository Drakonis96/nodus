import type { GraphData } from "./types";
export interface StellarPageRequest {
  /** `theme` returns every idea nested under a theme plus the relations between them. */
  kind: "search" | "neighbors" | "work" | "elements" | "theme";
  id?: string;
  search?: string;
  theme?: string;
  author?: string;
  nodeIds?: string[];
  edgeIds?: string[];
  cursor?: number;
  limit?: number;
}
/** A theme hub as shown on the first graph tab: the bubble area encodes `ideaCount`. */
export interface StellarTheme {
  id: string;
  label: string;
  /** Distinct ideas nested under the theme; drives the node size and the drill-down. */
  ideaCount: number;
  workCount: number;
  /** Curated by the user in "Temas principales" instead of extracted by a scan. */
  curated: boolean;
}

export interface StellarPage extends GraphData {
  next: number | null;
  total: number;
}
export interface StellarPosition {
  x: number;
  y: number;
}
export interface StellarSession {
  version: 1;
  layoutVersion?: number;
  seeds: string[];
  /** Local workspace visibility, including isolated ideas retained after removing a neighbor. */
  pinnedNodes?: string[];
  removedNodes?: string[];
  history: string[];
  cursor: number;
  activeSeed: string | null;
  positions: Record<string, StellarPosition>;
  camera: { x: number; y: number; zoom: number };
  limit: number;
  speed: number;
}
