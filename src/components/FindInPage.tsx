import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { t } from '../i18n';

// In-page find (Cmd/Ctrl+F), scoped to a scroll container. Matches are painted
// with the CSS Custom Highlight API, which draws over the layout WITHOUT touching
// the DOM — so it never fights React's reconciliation of the report/immersion
// content. Falls back to a no-highlight count if the API is unavailable.

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

const HIGHLIGHT_ALL = 'nodus-find';
const HIGHLIGHT_CURRENT = 'nodus-find-current';
const MAX_MATCHES = 2000;

function highlightApi(): { registry: HighlightRegistry; Ctor: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (css?.highlights && typeof Ctor === 'function') return { registry: css.highlights, Ctor };
  return null;
}

export function FindInPage({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const api = useRef(highlightApi());

  const clearHighlights = useCallback(() => {
    api.current?.registry.delete(HIGHLIGHT_ALL);
    api.current?.registry.delete(HIGHLIGHT_CURRENT);
    rangesRef.current = [];
  }, []);

  const scrollTo = useCallback((range: Range) => {
    const el = range.startContainer.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const setCurrent = useCallback(
    (next: number) => {
      const ranges = rangesRef.current;
      if (ranges.length === 0) {
        api.current?.registry.delete(HIGHLIGHT_CURRENT);
        setIndex(-1);
        return;
      }
      const clamped = ((next % ranges.length) + ranges.length) % ranges.length;
      setIndex(clamped);
      if (api.current) {
        const current = new api.current.Ctor(ranges[clamped]) as { priority?: number };
        current.priority = 1;
        api.current.registry.set(HIGHLIGHT_CURRENT, current);
      }
      scrollTo(ranges[clamped]);
    },
    [scrollTo]
  );

  const runSearch = useCallback(
    (raw: string) => {
      const root = targetRef.current;
      clearHighlights();
      const needle = raw.trim().toLowerCase();
      if (!root || needle.length === 0) {
        setCount(0);
        setIndex(-1);
        return;
      }
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement?.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node = walker.nextNode();
      while (node && ranges.length < MAX_MATCHES) {
        const haystack = (node.nodeValue ?? '').toLowerCase();
        let from = haystack.indexOf(needle);
        while (from !== -1 && ranges.length < MAX_MATCHES) {
          const range = document.createRange();
          range.setStart(node, from);
          range.setEnd(node, from + needle.length);
          ranges.push(range);
          from = haystack.indexOf(needle, from + needle.length);
        }
        node = walker.nextNode();
      }
      rangesRef.current = ranges;
      setCount(ranges.length);
      if (api.current && ranges.length > 0) {
        api.current.registry.set(HIGHLIGHT_ALL, new api.current.Ctor(...ranges));
      }
      setCurrent(0);
    },
    [targetRef, clearHighlights, setCurrent]
  );

  // Debounce the walk so typing stays smooth on long reports.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => runSearch(query), 90);
    return () => window.clearTimeout(handle);
  }, [query, open, runSearch]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCount(0);
    setIndex(-1);
    clearHighlights();
  }, [clearHighlights]);

  // Cmd/Ctrl+F opens (and refocuses) the bar for the host view.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => clearHighlights, [clearHighlights]);

  if (!open) return null;

  return (
    <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white/95 px-2 py-1.5 shadow-2xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
        <Icon name="search" size={14} className="ml-1 text-neutral-500" />
        <input
          ref={inputRef}
          className="w-56 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-neutral-500"
          value={query}
          placeholder={t('Buscar en la página…')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              setCurrent(index + (e.shiftKey ? -1 : 1));
            }
          }}
        />
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-neutral-500">
          {count > 0 ? `${index + 1}/${count}` : query.trim() ? t('0 resultados') : ''}
        </span>
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
          onClick={() => setCurrent(index - 1)}
          disabled={count === 0}
          aria-label={t('Anterior')}
        >
          <Icon name="chevronUp" size={14} />
        </button>
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
          onClick={() => setCurrent(index + 1)}
          disabled={count === 0}
          aria-label={t('Siguiente')}
        >
          <Icon name="chevronDown" size={14} />
        </button>
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          onClick={close}
          aria-label={t('Cerrar')}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
