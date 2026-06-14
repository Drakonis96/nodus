import { useEffect, useRef } from 'react';

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
