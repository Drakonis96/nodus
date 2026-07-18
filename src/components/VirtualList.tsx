import type React from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  className?: string;
  style?: React.CSSProperties;
  overscan?: number;
  empty?: React.ReactNode;
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
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

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

  const { start, end, offset, totalHeight } = useMemo(() => {
    const count = items.length;
    if (!variableLayout) {
      const fixedHeight = itemHeight as number;
      const capacity = Math.ceil(viewportHeight / fixedHeight) + overscan * 2;
      const rawFirst = Math.max(0, Math.floor(scrollTop / fixedHeight) - overscan);
      const first = Math.min(rawFirst, Math.max(0, count - capacity));
      const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / fixedHeight) + overscan);
      return { start: first, end: last, offset: first * fixedHeight, totalHeight: count * fixedHeight };
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
    };
  }, [itemHeight, items.length, overscan, scrollTop, variableLayout, viewportHeight]);

  const visibleItems = items.slice(start, end);

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
