import type {
  RadarCheckRequest,
  RadarCheckResult,
  RadarFollow,
  RadarFollowInput,
  RadarFollowPatch,
  RadarSnapshot,
} from '../radar';

/** Global research monitoring. No method carries a vault id by design. */
export interface RadarApi {
  getRadarSnapshot(): Promise<RadarSnapshot>;
  createRadarFollow(input: RadarFollowInput): Promise<RadarFollow>;
  updateRadarFollow(id: string, patch: RadarFollowPatch): Promise<RadarFollow>;
  removeRadarFollow(id: string): Promise<RadarSnapshot>;
  checkRadar(request?: RadarCheckRequest): Promise<RadarCheckResult>;
  markRadarUpdateRead(id: string, read?: boolean): Promise<RadarSnapshot>;
  markAllRadarUpdatesRead(): Promise<RadarSnapshot>;
  removeRadarUpdate(id: string): Promise<RadarSnapshot>;
  onRadarChanged(cb: (snapshot: RadarSnapshot) => void): () => void;
}
