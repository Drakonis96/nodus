// Keeping the reader's place inside a long list, by id.
//
// Every section that pages a list needs the same two halves of one behaviour, and
// getting either half subtly wrong is what makes restored scrolling feel broken:
//
//   Capture — which row is at the top of the viewport right now. Read as an id, so
//   it still means the same row after a re-sort, a resize or a re-measure.
//
//   Restore — put that row back under the top edge, ONCE, after the page it lives on
//   has arrived. If it is not there, the list must go back to the first page and the
//   top rather than sit on page 3 with nothing to show for it.
//
// Rows opt in by carrying `data-anchor-id`. Virtualised lists cannot use this — the
// row to scroll to is usually not in the DOM yet — so VirtualList implements the same
// contract against its own geometry instead.
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The attribute a row carries so it can be found again. */
export const ANCHOR_ATTRIBUTE = 'data-anchor-id';

/**
 * The first row still crossing the top edge of the scroller.
 *
 * Binary search rather than a walk: the argument-route list grows into the thousands
 * as the reader scrolls, and this runs on every scroll frame. Rows are stacked in
 * document order, so their edges are monotonic and a search is valid.
 */
export function topAnchorId(scroller: HTMLElement): string | null {
  const rows = scroller.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTRIBUTE}]`);
  if (rows.length === 0) return null;
  const edge = scroller.getBoundingClientRect().top + 1;
  let low = 0;
  let high = rows.length - 1;
  let found = rows.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].getBoundingClientRect().bottom > edge) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return rows[found].getAttribute(ANCHOR_ATTRIBUTE);
}

export interface ListPlacementOptions {
  /** The row to scroll back to, or null. Honoured once, then the reader is in control. */
  restoreAnchorId: string | null;
  /**
   * Changes whenever a page of rows lands in the DOM. The restore waits for it,
   * because on the first render the list is still empty.
   */
  revision: unknown;
  /**
   * The anchor was not among the rows that arrived: the row is gone, or the corpus
   * changed under it. The list must fall back to the first page and the top — a page
   * without its anchor is the half-restored state this whole mechanism exists to
   * avoid.
   */
  onRestoreMissed: () => void;
  /** The row now at the top, reported as the reader scrolls. */
  onCapture: (anchorId: string | null) => void;
}

/**
 * Returns the ref to put on the scrolling element. Capture stays silent until the
 * restore has settled: the list renders at scroll zero first, and reporting that
 * would overwrite the very placement being restored.
 */
export function useListPlacement<E extends HTMLElement>({
  restoreAnchorId,
  revision,
  onRestoreMissed,
  onCapture,
}: ListPlacementOptions): RefObject<E> {
  const scrollerRef = useRef<E>(null);
  const settled = useRef(restoreAnchorId === null);
  const frame = useRef<number | null>(null);
  const missed = useRef(onRestoreMissed);
  const capture = useRef(onCapture);
  missed.current = onRestoreMissed;
  capture.current = onCapture;

  useEffect(() => {
    if (settled.current) return;
    const scroller = scrollerRef.current;
    if (!scroller || restoreAnchorId === null) return;
    const target = scroller.querySelector<HTMLElement>(
      `[${ANCHOR_ATTRIBUTE}="${CSS.escape(restoreAnchorId)}"]`,
    );
    if (target) {
      scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      settled.current = true;
      return;
    }
    // Rows arrived and the anchor is not among them.
    if (scroller.querySelector(`[${ANCHOR_ATTRIBUTE}]`)) {
      settled.current = true;
      scroller.scrollTop = 0;
      missed.current();
    }
  }, [restoreAnchorId, revision]);

  const handleScroll = useCallback(() => {
    if (!settled.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const scroller = scrollerRef.current;
      if (scroller) capture.current(topAnchorId(scroller));
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [handleScroll]);

  return scrollerRef;
}
