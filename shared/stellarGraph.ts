import type { GraphData } from "./types";
export interface StellarPageRequest {
  kind: "search" | "neighbors" | "work" | "elements";
  id?: string;
  search?: string;
  theme?: string;
  author?: string;
  nodeIds?: string[];
  edgeIds?: string[];
  cursor?: number;
  limit?: number;
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
  history: string[];
  cursor: number;
  activeSeed: string | null;
  positions: Record<string, StellarPosition>;
  camera: { x: number; y: number; zoom: number };
  limit: number;
  speed: number;
}
