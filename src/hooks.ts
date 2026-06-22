import { useEffect, useRef } from 'react';

const DATA_CHANGED_EVENT = 'nodus:data-changed';

/** Notify the mounted data views after a cross-cutting operation such as a Zotero sync. */
export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

/** Refresh a mounted view without remounting it or losing its local filters and selection. */
export function useDataRefresh(onRefresh: () => void | Promise<void>): void {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  useEffect(() => {
    const refresh = () => void cb.current();
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refresh);
  }, []);
}

/**
 * Calls `onComplete` whenever the scan queue transitions from active to idle.
 * Derived views (graph, gaps, reading path) are built from scan results, so they
 * must refresh once a batch of scans finishes — otherwise a completed analysis
 * (queue shows 100%) never appears in the view until the user navigates away and back.
 */
export function useScanComplete(onComplete: () => void): void {
  const cb = useRef(onComplete);
  cb.current = onComplete;
  useEffect(() => {
    let prevActive = false;
    return window.nodus.onQueueProgress((p) => {
      const active = p.total > 0 && p.done + p.failed < p.total;
      if (prevActive && !active) cb.current();
      prevActive = active;
    });
  }, []);
}
