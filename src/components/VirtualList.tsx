import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  className?: string;
  style?: React.CSSProperties;
  overscan?: number;
  empty?: React.ReactNode;
  /** Lets paged callers fetch just before the rendered window reaches either edge. */
  onRangeChange?: (range: { start: number; end: number; total: number }) => void;
  /** Positive items were prepended; negative items were discarded from the start. */
  anchorAdjustment?: { token: number; items: number } | null;
  /**
   * A row to bring back under the top edge, once, when it appears among `items`.
   * The DOM-based anchoring the plain lists use cannot work here: the row to scroll
   * to is usually not rendered yet, and only this component knows where it would be.
   */
  anchorKey?: React.Key | null;
  /** The row now at the top of the viewport, reported as the reader scrolls. */
  onAnchorChange?: (key: React.Key | null) => void;
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  getKey,
  className = '',
  style,
  overscan = 8,
  empty,
  onRangeChange,
  anchorAdjustment,
  anchorKey = null,
  onAnchorChange,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedAnchorToken = useRef<number | null>(null);
  const previousVariableHeights = useRef<number[] | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Reporting the top row while the restore is still pending would overwrite the
  // very placement being restored: the list renders at scroll zero first.
  const anchorSettled = useRef(anchorKey === null);
  const previousAnchorKey = useRef<React.Key | null>(anchorKey);
  const previousAnchorIndex = useRef<number>(-1);
  const reportAnchor = useRef(onAnchorChange);
  reportAnchor.current = onAnchorChange;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const variableLayout = useMemo(() => {
    if (typeof itemHeight === 'number') return null;
    const count = items.length;
    const heights = items.map((item, index) => Math.max(1, itemHeight(item, index)));
    const offsets = new Array<number>(count + 1);
    offsets[0] = 0;
    for (let index = 0; index < count; index += 1) offsets[index + 1] = offsets[index] + heights[index];
    return { heights, offsets };
  }, [itemHeight, items]);

  const { start, end, offset, totalHeight, topIndex } = useMemo(() => {
    const count = items.length;
    if (!variableLayout) {
      const fixedHeight = itemHeight as number;
      const capacity = Math.ceil(viewportHeight / fixedHeight) + overscan * 2;
      const rawFirst = Math.max(0, Math.floor(scrollTop / fixedHeight) - overscan);
      const first = Math.min(rawFirst, Math.max(0, count - capacity));
      const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / fixedHeight) + overscan);
      const top = count === 0 ? 0 : Math.min(count - 1, Math.floor(scrollTop / fixedHeight));
      return { start: first, end: last, offset: first * fixedHeight, totalHeight: count * fixedHeight, topIndex: top };
    }
    const { offsets } = variableLayout;

    // First item whose bottom is below the requested scroll position. This keeps
    // virtualisation intact even when fitted database rows have different heights.
    const indexAt = (position: number) => {
      let low = 0;
      let high = count;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (offsets[middle + 1] <= position) low = middle + 1;
        else high = middle;
      }
      return Math.min(low, Math.max(0, count - 1));
    };
    const first = count === 0 ? 0 : Math.max(0, indexAt(scrollTop) - overscan);
    const lastVisible = count === 0 ? 0 : indexAt(scrollTop + viewportHeight);
    const last = Math.min(count, lastVisible + overscan + 1);
    return {
      start: first,
      end: last,
      offset: offsets[first],
      totalHeight: offsets[count],
      topIndex: count === 0 ? 0 : indexAt(scrollTop),
    };
  }, [itemHeight, items.length, overscan, scrollTop, variableLayout, viewportHeight]);

  const visibleItems = items.slice(start, end);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const adjustment = anchorAdjustment;
    if (element && adjustment && adjustment.items !== 0 && appliedAnchorToken.current !== adjustment.token) {
      const count = Math.abs(adjustment.items);
      let pixels: number;
      if (typeof itemHeight === 'number') pixels = count * itemHeight;
      else if (adjustment.items > 0) pixels = (variableLayout?.heights ?? []).slice(0, count).reduce((sum, height) => sum + height, 0);
      else pixels = (previousVariableHeights.current ?? []).slice(0, count).reduce((sum, height) => sum + height, 0);
      element.scrollTop += adjustment.items > 0 ? pixels : -pixels;
      setScrollTop(element.scrollTop);
      appliedAnchorToken.current = adjustment.token;
    }
    previousVariableHeights.current = variableLayout?.heights ?? null;
  }, [anchorAdjustment, itemHeight, variableLayout]);

  useEffect(() => {
    onRangeChange?.({ start, end, total: items.length });
  }, [end, items.length, onRangeChange, start]);

  // Restore a changed anchor and keep it fixed when progressive ranking moves its
  // row. Tracking the last index avoids snapping during unrelated renders.
  useLayoutEffect(() => {
    if (anchorKey === null || items.length === 0) {
      anchorSettled.current = true;
      previousAnchorKey.current = anchorKey;
      previousAnchorIndex.current = -1;
      return;
    }
    const index = items.findIndex((item, position) => getKey(item, position) === anchorKey);
    anchorSettled.current = true;
    if (index < 0) return;
    const changed = previousAnchorKey.current !== anchorKey || previousAnchorIndex.current !== index;
    previousAnchorKey.current = anchorKey;
    previousAnchorIndex.current = index;
    if (!changed) return;
    const element = scrollRef.current;
    if (!element) return;
    const target = variableLayout ? variableLayout.offsets[index] : index * (itemHeight as number);
    element.scrollTop = target;
    setScrollTop(target);
  }, [anchorKey, getKey, itemHeight, items, variableLayout]);

  const topKey = items.length > 0 && topIndex < items.length ? getKey(items[topIndex], topIndex) : null;
  useEffect(() => {
    if (anchorSettled.current) reportAnchor.current?.(topKey);
  }, [topKey]);

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto ${className}`}
      style={style}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <div className="relative w-full" style={{ height: totalHeight }}>
          <div className="absolute left-0 right-0 top-0" style={{ transform: `translateY(${offset}px)` }}>
            {visibleItems.map((item, localIndex) => {
              const index = start + localIndex;
              return (
                <div key={getKey(item, index)} style={{ height: variableLayout?.heights[index] ?? (itemHeight as number) }}>
                  {renderItem(item, index)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
