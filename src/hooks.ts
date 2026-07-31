import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { incrementalSliceLength } from './incrementalList';
import { invalidateVaultQueryCache } from './vaultQueryCache';

/** Track whether the light theme is active (App stamps `.light` on <html>). */
export function useIsLightTheme(): boolean {
  const [light, setLight] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('light')
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setLight(el.classList.contains('light'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}

const DATA_CHANGED_EVENT = 'nodus:data-changed';
const DISMISSABLE_LAYER_OPEN_EVENT = 'nodus:dismissable-layer-open';

interface DismissableLayerOptions {
  open: boolean;
  onDismiss: () => void;
  group?: string;
  closeOnEscape?: boolean;
  closeOnOutsideClick?: boolean;
}

/** Notify the mounted data views after a cross-cutting operation such as a Zotero sync. */
export function notifyDataChanged(): void {
  invalidateVaultQueryCache();
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
      if (prevActive && !active) {
        invalidateVaultQueryCache();
        cb.current();
      }
      prevActive = active;
    });
  }, []);
}

/**
 * Reveal a long list one page at a time, growing as the sentinel scrolls near.
 *
 * The debates list and the argument-route picker are unbounded: a real corpus
 * produces ~1.100 debates and ~8.500 ranked routes. Painting them all in the
 * single render that opens the section blocked the renderer's main thread for
 * one to two seconds — long enough that a click on another sidebar section was
 * not processed at all until the paint finished, which is exactly what the
 * section felt like from the outside. One page keeps that first paint cheap
 * without taking the "scroll through everything" behaviour away.
 *
 * `items` must be referentially stable across renders that do not change it
 * (a `useMemo`'d filter result), because a new array means a new list and
 * collapses back to the first page.
 *
 * `weight` counts an item as more than one towards the page — a debate cluster
 * holds several cards, and paging by clusters alone let one big cluster paint
 * hundreds of them. It must be stable for the same reason `items` is.
 */
export function useIncrementalList<T, E extends HTMLElement = HTMLDivElement>(
  items: T[],
  pageSize: number,
  weight?: (item: T) => number
): { visible: T[]; hasMore: boolean; sentinelRef: RefObject<E>; showMore: () => void } {
  const [count, setCount] = useState(pageSize);
  const sentinelRef = useRef<E>(null);

  useEffect(() => {
    setCount(pageSize);
  }, [items, pageSize]);

  const shown = useMemo(() => incrementalSliceLength(items, count, weight), [items, count, weight]);

  const hasMore = shown < items.length;
  const showMore = useCallback(() => setCount((n) => n + pageSize), [pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    // Ancestor scroll containers clip the intersection rectangle, so the viewport
    // root is right even though the sentinel lives inside the section's scroller.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount((n) => n + pageSize);
      },
      { rootMargin: '600px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, pageSize]);

  const visible = useMemo(() => (shown >= items.length ? items : items.slice(0, shown)), [items, shown]);
  return { visible, hasMore, sentinelRef, showMore };
}

/**
 * Standard dismissal behavior for small button-opened popovers/dropdowns.
 * The returned ref must wrap both the trigger button and the floating panel, so
 * clicking the trigger again toggles normally while any outside click closes it.
 */
export function useDismissableLayer<T extends HTMLElement>({
  open,
  onDismiss,
  group = 'default',
  closeOnEscape = true,
  closeOnOutsideClick = true,
}: DismissableLayerOptions): RefObject<T> {
  const rootRef = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  const idRef = useRef(`layer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(
      new CustomEvent(DISMISSABLE_LAYER_OPEN_EVENT, {
        detail: { id: idRef.current, group },
      })
    );
  }, [group, open]);

  useEffect(() => {
    if (!open) return;

    const dismiss = () => dismissRef.current();
    const onMouseDown = (event: MouseEvent) => {
      if (!closeOnOutsideClick) return;
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (!root.contains(target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') dismiss();
    };
    const onLayerOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; group?: string }>).detail;
      if (detail?.group === group && detail.id !== idRef.current) dismiss();
    };

    document.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(DISMISSABLE_LAYER_OPEN_EVENT, onLayerOpen);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(DISMISSABLE_LAYER_OPEN_EVENT, onLayerOpen);
    };
  }, [closeOnEscape, closeOnOutsideClick, group, open]);

  return rootRef;
}
