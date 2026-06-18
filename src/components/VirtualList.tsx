import type React from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
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

  const { start, end, offset, totalHeight } = useMemo(() => {
    const count = items.length;
    const capacity = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
    const rawFirst = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const first = Math.min(rawFirst, Math.max(0, count - capacity));
    const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
    return {
      start: first,
      end: last,
      offset: first * itemHeight,
      totalHeight: count * itemHeight,
    };
  }, [itemHeight, items.length, overscan, scrollTop, viewportHeight]);

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
                <div key={getKey(item, index)} style={{ height: itemHeight }}>
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
