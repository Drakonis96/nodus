import type { ReactionIndexStatus } from '../reactionIndex';

/** On-demand download and integrity status for the published ORD reaction index. */
export interface ReactionIndexApi {
  getReactionIndexStatus(): Promise<ReactionIndexStatus>;
  /** Start (or resume) the download. Resolves when the index is verified or the transfer fails. */
  downloadReactionIndex(): Promise<ReactionIndexStatus>;
  onReactionIndexProgress(cb: (status: ReactionIndexStatus) => void): () => void;
}
