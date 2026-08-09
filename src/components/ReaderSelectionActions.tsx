import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon } from './ui';
import './readerSelectionActions.css';

interface ReaderMark {
  start: number;
  end: number;
  text: string;
}

interface ActiveSelection extends ReaderMark {
  left: number;
  top: number;
}

const HIGHLIGHT_NAME = 'nodus-reader-mark';

function storageKey(contextId: string): string {
  return `nodus.readerMark.${contextId}`;
}

function loadMark(contextId: string): ReaderMark | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(contextId)) || 'null') as Partial<ReaderMark> | null;
    if (!value || !Number.isInteger(value.start) || !Number.isInteger(value.end) || typeof value.text !== 'string') return null;
    if ((value.end as number) <= (value.start as number)) return null;
    return { start: value.start as number, end: value.end as number, text: value.text };
  } catch {
    return null;
  }
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (const node of textNodes(root)) {
    const next = offset + node.data.length;
    if (!started && start >= offset && start <= next) {
      range.setStart(node, Math.min(node.data.length, start - offset));
      started = true;
    }
    if (started && end >= offset && end <= next) {
      range.setEnd(node, Math.min(node.data.length, end - offset));
      return range;
    }
    offset = next;
  }
  return null;
}

function markRange(root: HTMLElement, mark: ReaderMark): Range | null {
  const direct = rangeFromOffsets(root, mark.start, mark.end);
  if (direct?.toString() === mark.text) return direct;
  // Markdown links and translated content can slightly change the surrounding
  // node split. The selected words remain the safest recovery anchor.
  const index = (root.textContent || '').indexOf(mark.text);
  return index >= 0 ? rangeFromOffsets(root, index, index + mark.text.length) : null;
}

function selectionInside(root: HTMLElement): { range: Range; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = range.toString();
  return text.trim() ? { range, text } : null;
}

function selectionOffsets(root: HTMLElement, range: Range): Pick<ReaderMark, 'start' | 'end'> {
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
}

function wordAtPoint(event: MouseEvent, root: HTMLElement): Range | null {
  const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!caret || !root.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const node = caret.startContainer as Text;
  let start = caret.startOffset;
  let end = caret.startOffset;
  while (start > 0 && !/\s/.test(node.data[start - 1])) start -= 1;
  while (end < node.data.length && !/\s/.test(node.data[end])) end += 1;
  if (start === end) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

/** Icon-only copy, reading-bookmark and Nodi-quote actions for document text. */
export function ReaderSelectionActions({
  targetRef,
  contextId,
}: {
  targetRef: RefObject<HTMLElement | null>;
  contextId: string;
}) {
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [mark, setMark] = useState<ReaderMark | null>(() => loadMark(contextId));
  const markLabel = t(mark ? 'Mover marcador aquí' : 'Añadir marcador de lectura');

  useEffect(() => {
    setActive(null);
    setMark(loadMark(contextId));
  }, [contextId]);

  const showSelection = useCallback((event?: MouseEvent) => {
    const root = targetRef.current;
    if (!root) return false;
    let selected = selectionInside(root);
    if (!selected && event) {
      const range = wordAtPoint(event, root);
      if (range) selected = { range, text: range.toString() };
    }
    if (!selected) {
      setActive(null);
      return false;
    }
    const rect = selected.range.getBoundingClientRect();
    const { start, end } = selectionOffsets(root, selected.range);
    const width = 118;
    setActive({
      start,
      end,
      text: selected.text,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)),
      top: Math.max(8, rect.top - 48),
    });
    return true;
  }, [targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    const onPointerUp = () => window.setTimeout(() => showSelection(), 0);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.startsWith('Arrow') || event.key === 'Shift') showSelection();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (showSelection(event)) event.preventDefault();
    };
    const hide = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-reader-selection-actions]')) return;
      setActive(null);
    };
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('resize', hide);
    root.addEventListener('scroll', hide, { passive: true });
    return () => {
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('keyup', onKeyUp);
      root.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('resize', hide);
      root.removeEventListener('scroll', hide);
    };
  }, [showSelection, targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    registry?.delete(HIGHLIGHT_NAME);
    if (!root || !mark || !registry || !HighlightConstructor) return;
    const range = markRange(root, mark);
    if (range) registry.set(HIGHLIGHT_NAME, new HighlightConstructor(range));
    return () => { registry.delete(HIGHLIGHT_NAME); };
  }, [mark, targetRef]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setActive(null);
  };

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.text);
    clearSelection();
  };

  const saveMark = () => {
    if (!active) return;
    const next: ReaderMark = { start: active.start, end: active.end, text: active.text };
    localStorage.setItem(storageKey(contextId), JSON.stringify(next));
    setMark(next);
    clearSelection();
  };

  const quoteInNodi = async () => {
    if (!active) return;
    const text = active.text.replace(/\s+/g, ' ').trim();
    const settings = await window.nodus.getSettings();
    if (!settings.mascotEnabled) await window.nodus.updateSettings({ mascotEnabled: true });
    await window.nodus.quoteNodiSelection(text);
    clearSelection();
  };

  if (!active) return null;
  return createPortal(
    <div
      className="reader-selection-actions"
      data-reader-selection-actions
      role="toolbar"
      aria-label={t('Acciones de selección')}
      style={{ left: active.left, top: active.top }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => void copy()} title={t('Copiar')} aria-label={t('Copiar')}>
        <Icon name="copy" size={17} />
      </button>
      <button type="button" onClick={saveMark} title={markLabel} aria-label={markLabel}>
        <Icon name={mark ? 'bookmarkFill' : 'bookmark'} size={17} />
      </button>
      <button type="button" onClick={() => void quoteInNodi()} title={t('Citar en Nodi')} aria-label={t('Citar en Nodi')}>
        <Icon name="quote" size={17} />
      </button>
    </div>,
    document.body,
  );
}
