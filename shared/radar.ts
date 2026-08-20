export type RadarFollowType = 'topic' | 'search' | 'author' | 'journal' | 'paper' | 'rss' | 'website';
export type RadarCadence = 'daily' | 'weekly';
export type RadarSourceName = 'OpenAlex' | 'Crossref' | 'ORCID' | 'Semantic Scholar' | 'RSS' | 'Web monitor';

export interface RadarFollow {
  id: string;
  type: RadarFollowType;
  value: string;
  title: string;
  detail: string;
  sources: RadarSourceName[];
  cadence: RadarCadence;
  paused: boolean;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  updateCount: number;
  checkpoint?: Record<string, string | number | boolean | null>;
}
export interface RadarUpdate {
  id: string;
  followId: string;
  followTitle: string;
  followType: RadarFollowType;
  source: RadarSourceName;
  externalId: string;
  title: string;
  authors: string;
  summary: string;
  url: string;
  doi?: string;
  publishedAt?: string;
  detectedAt: number;
  read: boolean;
  signal?: string;
}

export interface RadarSourceStatus {
  name: RadarSourceName;
  description: string;
  state: 'active' | 'ready' | 'limited' | 'error';
  followCount: number;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  error?: string;
}

export interface RadarSnapshot {
  follows: RadarFollow[];
  updates: RadarUpdate[];
  sources: RadarSourceStatus[];
  unreadCount: number;
  checking: boolean;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  detectedThisWeek: number;
}

export interface RadarFollowInput {
  type: RadarFollowType;
  value: string;
  title?: string;
  cadence?: RadarCadence;
}

export interface RadarFollowPatch {
  value?: string;
  title?: string;
  cadence?: RadarCadence;
  paused?: boolean;
}

export interface RadarCheckRequest {
  followIds?: string[];
  reason?: 'manual' | 'scheduled' | 'created';
}

export interface RadarCheckResult {
  checked: number;
  newItems: number;
  errors: number;
  startedAt: number;
  completedAt: number;
  snapshot: RadarSnapshot;
}
