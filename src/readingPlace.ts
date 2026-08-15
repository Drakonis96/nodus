// Keeping the reader's place inside a document, by block.
//
// This is the prose half of what `listPlacement.ts` does for lists. A list has rows
// with ids; a report has none, so what is stored is WHICH BLOCK was under the top
// edge — the nth paragraph, heading, quote or table of the rendered document.
//
// Not a `scrollTop`, for the same reason a list does not store one: the pixel a
// sentence sits at depends on the width of the window, on the font and on whether the
// cover image had loaded yet, and none of those are the same on the next visit. The
// block is the same block.
//
// The index is only meaningful in the rendering it was counted in, so it travels with
// one: a report read in Spanish and the same report with a translation applied are two
// different documents with two different block counts, and a place taken in one says
// nothing about the other. A place whose rendering no longer matches is dropped, not
// approximated.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The reader's place in a document. See the note above on why it is not a pixel. */
export interface ReadingPlace {
  /** Which block was under the top edge, counted over `readingBlocks`. */
  blockIndex: number;
  /** The rendering it was counted in: the source text, or a translation over it. */
  rendering: string;
}

/** What counts as a block. Anything that carries prose and stacks vertically. */
export const READING_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure';

/**
 * The blocks of a document, in document order and never nested inside one another.
 *
 * Only the leaves are kept. A `blockquote` around a `p`, or a `li` around a `p`, would
 * otherwise appear as two blocks covering the same text, and — worse — their bottom
 * edges would not increase down the page, which is what the search below relies on.
 *
 * A block with any matched descendant has that descendant as the very next match in
 * document order, so one comparison per block is enough to recognise a wrapper.
 */
export function readingBlocks(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(READING_BLOCK_SELECTOR));
  return all.filter((block, index) => index + 1 >= all.length || !block.contains(all[index + 1]));
}

/**
 * The first block still crossing the top edge of the scroller, or null if the document
 * has no blocks yet. Binary search, as in `topAnchorId`: this runs on every scroll
 * frame and a long report is hundreds of blocks.
 */
export function topBlockIndex(scroller: HTMLElement, blocks: HTMLElement[]): number | null {
  if (blocks.length === 0) return null;
  const edge = scroller.getBoundingClientRect().top + 1;
  let low = 0;
  let high = blocks.length - 1;
  let found = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle].getBoundingClientRect().bottom > edge) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
}

export interface ReadingPlaceOptions<S extends HTMLElement, R extends HTMLElement> {
  /** The element that scrolls. */
  scrollerRef: RefObject<S | null>;
  /** The element the blocks are counted inside. */
  documentRef: RefObject<R | null>;
  /** Where the reader was, or null. Ignored unless it was taken in this rendering. */
  restore: ReadingPlace | null;
  /** What is on screen now: 'source', or the id of the translation applied over it. */
  rendering: string;
  /** Changes when the document's content does, so the restore can wait for it. */
  revision: unknown;
  /** The block now under the top edge, reported as the reader moves. */
  onCapture: (place: ReadingPlace | null) => void;
}

/**
 * Restores the reader's place once the document is on screen, then follows them.
 *
 * The restore does not settle when it succeeds — it settles when the reader takes
 * over. A report grows after it first paints: the cover image loads, a diagram
 * resolves, a font swaps, and each of those pushes the text down under a scroll
 * position that was already set. So the target block is put back under the top edge
 * again on every change of the document's size, and only a hand on the wheel, the
 * trackpad or the keyboard ends that.
 *
 * Capture is the mirror image: it stays silent until the reader has moved, so the
 * scrolling this hook does itself can never overwrite the place it is restoring.
 */
export function useReadingPlace<S extends HTMLElement, R extends HTMLElement>({
  scrollerRef,
  documentRef,
  restore,
  rendering,
  revision,
  onCapture,
}: ReadingPlaceOptions<S, R>): void {
  // Read once: a place that changed under the reader is this hook's own report coming
  // back around, and re-restoring on it would fight them for the scrollbar.
  const wanted = useRef(restore && restore.rendering === rendering ? restore.blockIndex : null);
  const settled = useRef(wanted.current === null);
  const frame = useRef<number | null>(null);
  const capture = useRef(onCapture);
  capture.current = onCapture;
  const renderingRef = useRef(rendering);
  renderingRef.current = rendering;

  useEffect(() => {
    const scroller = scrollerRef.current;
    const root = documentRef.current;
    if (!scroller || !root) return;

    const place = () => {
      if (settled.current) return;
      const index = wanted.current;
      if (index === null) return;
      const blocks = readingBlocks(root);
      if (blocks.length === 0) return;
      const target = blocks[index];
      if (!target) {
        // The report is not the one the place was taken in — translated away,
        // regenerated, shorter than it was. Half a placement is worse than none.
        settled.current = true;
        wanted.current = null;
        scroller.scrollTop = 0;
        capture.current(null);
        return;
      }
      scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);

    const takeOver = () => {
      settled.current = true;
      wanted.current = null;
    };
    const handleScroll = () => {
      if (!settled.current || frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        // Read fresh: React replaces the document's nodes when it re-renders, and a
        // cached list would keep measuring elements that are no longer on the page.
        const blocks = readingBlocks(root);
        const index = topBlockIndex(scroller, blocks);
        capture.current(index === null ? null : { blockIndex: index, rendering: renderingRef.current });
      });
    };

    for (const event of ['wheel', 'touchstart', 'pointerdown'] as const) {
      scroller.addEventListener(event, takeOver, { passive: true });
    }
    // Keys go to the document: scrolling with the arrows or the space bar does not
    // need the scroller focused, so the event never reaches it.
    const owner = scroller.ownerDocument;
    owner.addEventListener('keydown', takeOver, { passive: true });
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      for (const event of ['wheel', 'touchstart', 'pointerdown'] as const) {
        scroller.removeEventListener(event, takeOver);
      }
      owner.removeEventListener('keydown', takeOver);
      scroller.removeEventListener('scroll', handleScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [documentRef, rendering, revision, scrollerRef]);
}
