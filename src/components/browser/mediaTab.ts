/** The two sources the header's media popover can show. */
export type MediaSourceTab = 'browser' | 'drift';

/**
 * The tab a freshly opened popover starts on: Browser if that is all there is, Drift if that
 * is all there is, and the last one chosen when both exist (Browser the very first time).
 * Choosing a tab never changes what is playing; this only decides which controls are shown.
 */
export function defaultMediaTab(hasBrowser: boolean, hasDrift: boolean, last: MediaSourceTab | null): MediaSourceTab {
  if (hasBrowser && hasDrift) return last ?? 'browser';
  return hasDrift ? 'drift' : 'browser';
}
