import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { t } from '../i18n';
import { confirm } from './feedback';
import { Icon } from './ui';
import './readerSelectionActions.css';

interface ReaderMark {
  start: number;
  end: number;
  text: string;
}

interface ReaderAnchor {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
}

interface ActiveSelection extends ReaderAnchor {
  left: number;
  top: number;
}

interface FloatingAction<T = undefined> {
  value: T;
  left: number;
  top: number;
}

interface MarginPosition {
  id: string;
  kind: 'bookmark' | 'comment';
  left: number;
  top: number;
}

type CommentEditor = {
  annotation: WritingDraftAnnotation | null;
  anchor: ReaderAnchor;
  body: string;
  left: number;
  top: number;
};

export interface ReaderSelectionActionsHandle {
  goToMark: () => boolean;
}

type AnnotationCreate = Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>;

export const READER_ANNOTATION_COLORS: ReadonlyArray<{
  id: WritingDraftAnnotationColor;
  hex: string;
}> = [
  { id: 'yellow', hex: '#fde68a' },
  { id: 'rose', hex: '#fecdd3' },
  { id: 'blue', hex: '#bfdbfe' },
  { id: 'mint', hex: '#bbf7d0' },
  { id: 'lavender', hex: '#ddd6fe' },
  { id: 'peach', hex: '#fed7aa' },
];

const HIGHLIGHT_NAMES: Record<WritingDraftAnnotationColor, string> = {
  yellow: 'nodus-reader-yellow',
  rose: 'nodus-reader-rose',
  blue: 'nodus-reader-blue',
  mint: 'nodus-reader-mint',
  lavender: 'nodus-reader-lavender',
  peach: 'nodus-reader-peach',
};
const COMMENT_HIGHLIGHT_NAME = 'nodus-reader-comment';
const ALL_HIGHLIGHT_NAMES = [...Object.values(HIGHLIGHT_NAMES), COMMENT_HIGHLIGHT_NAME];

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

function findAnchoredText(root: HTMLElement, anchor: ReaderAnchor): Range | null {
  const content = root.textContent || '';
  let bestIndex = -1;
  let bestScore = -1;
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(anchor.selectedText, from);
    if (index < 0) break;
    let score = 0;
    if (anchor.prefix && content.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix) score += 2;
    const after = index + anchor.selectedText.length;
    if (anchor.suffix && content.slice(after, after + anchor.suffix.length) === anchor.suffix) score += 2;
    score -= Math.min(1, Math.abs(index - anchor.startOffset) / Math.max(1, content.length));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
    from = index + Math.max(1, anchor.selectedText.length);
  }
  return bestIndex >= 0 ? rangeFromOffsets(root, bestIndex, bestIndex + anchor.selectedText.length) : null;
}

function annotationRange(root: HTMLElement, annotation: WritingDraftAnnotation): Range | null {
  const direct = rangeFromOffsets(root, annotation.startOffset, annotation.endOffset);
  if (direct?.toString() === annotation.selectedText) return direct;
  return findAnchoredText(root, annotation);
}

function markRange(root: HTMLElement, mark: ReaderMark): Range | null {
  const direct = rangeFromOffsets(root, mark.start, mark.end);
  if (direct?.toString() === mark.text) return direct;
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

function selectionOffsets(root: HTMLElement, range: Range): { start: number; end: number } {
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
}

function anchorFromRange(root: HTMLElement, range: Range, selectedText: string): ReaderAnchor {
  const { start, end } = selectionOffsets(root, range);
  const content = root.textContent || '';
  return {
    startOffset: start,
    endOffset: end,
    selectedText,
    prefix: content.slice(Math.max(0, start - 64), start),
    suffix: content.slice(end, end + 64),
  };
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

function rectAtPoint(range: Range, x: number, y: number): DOMRect | null {
  for (const rect of Array.from(range.getClientRects())) {
    if (x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top - 3 && y <= rect.bottom + 3) return rect;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fixed highlighter in the Deep Research top bar. A chosen colour stays active. */
export function ReaderHighlighterControl({
  value,
  onChange,
}: {
  value: WritingDraftAnnotationColor | null;
  onChange: (value: WritingDraftAnnotationColor | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = READER_ANNOTATION_COLORS.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  return (
    <div ref={ref} className="reader-highlighter-control">
      <button
        type="button"
        className={`btn btn-ghost h-9 min-h-9 gap-1.5 border ${value ? 'border-indigo-600/70 text-indigo-200' : 'border-neutral-700'}`}
        aria-label={t('Subrayar')}
        aria-pressed={!!value}
        data-testid="deep-research-fixed-highlighter"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="highlighter" size={16} />
        {active && <span className="reader-active-color" style={{ backgroundColor: active.hex }} />}
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="reader-highlighter-palette" role="menu" aria-label={t('Color')}>
          {READER_ANNOTATION_COLORS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={value === item.id ? 'is-active' : ''}
              aria-label={`${t('Subrayar')} ${index + 1}`}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <span style={{ backgroundColor: item.hex }} />
            </button>
          ))}
          <button
            type="button"
            className="reader-highlighter-off"
            aria-label={t('Seleccionar o desplazar')}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <Icon name="cursor" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Selection actions, persistent annotations and marginal reader markers. */
export const ReaderSelectionActions = forwardRef<ReaderSelectionActionsHandle, {
  targetRef: RefObject<HTMLElement | null>;
  scrollRef?: RefObject<HTMLElement | null>;
  contextId: string;
  annotations?: WritingDraftAnnotation[];
  highlighterColor?: WritingDraftAnnotationColor | null;
  onCreateAnnotation?: (input: AnnotationCreate) => Promise<void>;
  onUpdateComment?: (id: string, comment: string) => Promise<void>;
  onDeleteAnnotation?: (id: string) => Promise<void>;
  onAnnotationError?: (message: string) => void;
  onMarkChange?: (hasMark: boolean) => void;
}>(function ReaderSelectionActions({
  targetRef,
  scrollRef,
  contextId,
  annotations = [],
  highlighterColor = null,
  onCreateAnnotation,
  onUpdateComment,
  onDeleteAnnotation,
  onAnnotationError,
  onMarkChange,
}, ref) {
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [activeMarkActions, setActiveMarkActions] = useState<FloatingAction | null>(null);
  const [activeHighlightActions, setActiveHighlightActions] = useState<FloatingAction<WritingDraftAnnotation> | null>(null);
  const [commentEditor, setCommentEditor] = useState<CommentEditor | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [mark, setMark] = useState<ReaderMark | null>(() => loadMark(contextId));
  const [marginPositions, setMarginPositions] = useState<MarginPosition[]>([]);
  const markLabel = t(mark ? 'Mover marcador aquí' : 'Añadir marcador de lectura');

  useEffect(() => {
    const next = loadMark(contextId);
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    setCommentEditor(null);
    setMark(next);
    onMarkChange?.(!!next);
  }, [contextId, onMarkChange]);

  useEffect(() => {
    if (activeHighlightActions && !annotations.some((item) => item.id === activeHighlightActions.value.id)) {
      setActiveHighlightActions(null);
    }
    if (commentEditor?.annotation && !annotations.some((item) => item.id === commentEditor.annotation?.id)) {
      setCommentEditor(null);
    }
  }, [activeHighlightActions, annotations, commentEditor]);

  const captureSelection = useCallback((event?: MouseEvent): ActiveSelection | null => {
    const root = targetRef.current;
    if (!root) return null;
    let selected = selectionInside(root);
    if (!selected && event) {
      const range = wordAtPoint(event, root);
      if (range) selected = { range, text: range.toString() };
    }
    if (!selected) return null;
    const rect = selected.range.getBoundingClientRect();
    const anchor = anchorFromRange(root, selected.range, selected.text);
    const width = 350;
    return {
      ...anchor,
      left: Math.max(8, Math.min(window.innerWidth - Math.min(width, window.innerWidth - 16) - 8, rect.left + rect.width / 2 - width / 2)),
      top: Math.max(8, rect.top - 48),
    };
  }, [targetRef]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setActive(null);
  }, []);

  const createHighlight = useCallback((selection: ReaderAnchor, color: WritingDraftAnnotationColor) => {
    if (!onCreateAnnotation) return;
    const duplicate = annotations.some((item) =>
      item.kind === 'highlight'
      && item.color === color
      && item.startOffset === selection.startOffset
      && item.endOffset === selection.endOffset
      && item.selectedText === selection.selectedText
    );
    clearSelection();
    if (duplicate) return;
    void onCreateAnnotation({ ...selection, kind: 'highlight', color }).catch((error) => {
      onAnnotationError?.(errorMessage(error));
    });
  }, [annotations, clearSelection, onAnnotationError, onCreateAnnotation]);

  const showSelection = useCallback((event?: MouseEvent) => {
    const selection = captureSelection(event);
    if (!selection) {
      setActive(null);
      return false;
    }
    if (highlighterColor) {
      createHighlight(selection, highlighterColor);
      return true;
    }
    setActive(selection);
    return true;
  }, [captureSelection, createHighlight, highlighterColor]);

  const updateMarginPositions = useCallback(() => {
    const root = targetRef.current;
    if (!root) {
      setMarginPositions([]);
      return;
    }
    const viewport = (scrollRef?.current ?? root).getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 36, rootRect.right + 10);
    const next: MarginPosition[] = [];
    if (mark) {
      const range = markRange(root, mark);
      const rect = range ? Array.from(range.getClientRects())[0] : null;
      if (rect && rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
        next.push({ id: 'bookmark', kind: 'bookmark', left, top: rect.top });
      }
    }
    for (const annotation of annotations) {
      if (annotation.kind !== 'comment') continue;
      const range = annotationRange(root, annotation);
      const rect = range ? Array.from(range.getClientRects())[0] : null;
      if (rect && rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
        next.push({ id: annotation.id, kind: 'comment', left, top: rect.top });
      }
    }
    next.sort((a, b) => a.top - b.top || a.kind.localeCompare(b.kind));
    for (let index = 1; index < next.length; index += 1) {
      if (next[index].top < next[index - 1].top + 27) next[index].top = next[index - 1].top + 27;
    }
    setMarginPositions(next);
  }, [annotations, mark, scrollRef, targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    const scroller = scrollRef?.current ?? root;
    if (!root || !scroller) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMarginPositions);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(scroller);
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [scrollRef, targetRef, updateMarginPositions]);

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
    const onClick = (event: MouseEvent) => {
      // A drag ending over an existing highlight is still a new selection. Its
      // contextual palette must win over the one-click delete action.
      if (selectionInside(root)) return;
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea')) return;
      const matches = annotations
        .filter((item) => item.kind === 'highlight')
        .map((annotation) => ({ annotation, range: annotationRange(root, annotation) }))
        .map((item) => ({ ...item, rect: item.range ? rectAtPoint(item.range, event.clientX, event.clientY) : null }))
        .filter((item): item is typeof item & { rect: DOMRect } => !!item.rect)
        .sort((a, b) => (a.annotation.endOffset - a.annotation.startOffset) - (b.annotation.endOffset - b.annotation.startOffset));
      const match = matches[0];
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      setActiveMarkActions(null);
      setActiveHighlightActions({
        value: match.annotation,
        left: Math.max(8, Math.min(window.innerWidth - 51, match.rect.left + match.rect.width / 2 - 22)),
        top: Math.max(8, match.rect.top - 48),
      });
    };
    const hide = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-reader-selection-actions]')) return;
      setActive(null);
      setActiveMarkActions(null);
      setActiveHighlightActions(null);
    };
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('click', onClick);
    document.addEventListener('pointerdown', hide, true);
    return () => {
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('keyup', onKeyUp);
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', hide, true);
    };
  }, [annotations, clearSelection, showSelection, targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    for (const name of ALL_HIGHLIGHT_NAMES) registry?.delete(name);
    if (!root || !registry || !HighlightConstructor) return;
    for (const item of READER_ANNOTATION_COLORS) {
      const ranges = annotations
        .filter((annotation) => annotation.kind === 'highlight' && annotation.color === item.id)
        .map((annotation) => annotationRange(root, annotation))
        .filter((range): range is Range => range !== null);
      if (ranges.length > 0) registry.set(HIGHLIGHT_NAMES[item.id], new HighlightConstructor(...ranges));
    }
    const commentRanges = annotations
      .filter((annotation) => annotation.kind === 'comment')
      .map((annotation) => annotationRange(root, annotation))
      .filter((range): range is Range => range !== null);
    if (commentRanges.length > 0) registry.set(COMMENT_HIGHLIGHT_NAME, new HighlightConstructor(...commentRanges));
    return () => {
      for (const name of ALL_HIGHLIGHT_NAMES) registry.delete(name);
    };
  }, [annotations, targetRef]);

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.selectedText);
    clearSelection();
  };

  const saveMark = () => {
    if (!active) return;
    const next: ReaderMark = { start: active.startOffset, end: active.endOffset, text: active.selectedText };
    localStorage.setItem(storageKey(contextId), JSON.stringify(next));
    setMark(next);
    onMarkChange?.(true);
    clearSelection();
  };

  const deleteMark = () => {
    localStorage.removeItem(storageKey(contextId));
    setMark(null);
    setActiveMarkActions(null);
    onMarkChange?.(false);
  };

  const goToMark = useCallback(() => {
    const root = targetRef.current;
    const scroller = scrollRef?.current ?? root;
    if (!root || !scroller || !mark) return false;
    const range = markRange(root, mark);
    if (!range) return false;
    const rect = range.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const top = scroller.scrollTop + rect.top - scrollRect.top - scroller.clientHeight / 2 + rect.height / 2;
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return true;
  }, [mark, scrollRef, targetRef]);

  useImperativeHandle(ref, () => ({ goToMark }), [goToMark]);

  const quoteInNodi = async () => {
    if (!active) return;
    const text = active.selectedText.replace(/\s+/g, ' ').trim();
    const settings = await window.nodus.getSettings();
    if (!settings.mascotEnabled) await window.nodus.updateSettings({ mascotEnabled: true });
    await window.nodus.quoteNodiSelection(text);
    clearSelection();
  };

  const openNewComment = () => {
    if (!active) return;
    setCommentError(null);
    setCommentEditor({
      annotation: null,
      anchor: active,
      body: '',
      left: active.left,
      top: Math.max(8, Math.min(window.innerHeight - 270, active.top)),
    });
    clearSelection();
  };

  const openComment = (annotation: WritingDraftAnnotation, position: MarginPosition) => {
    setCommentError(null);
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    const width = 330;
    setCommentEditor({
      annotation,
      anchor: annotation,
      body: annotation.comment ?? '',
      left: Math.max(8, Math.min(window.innerWidth - width - 8, position.left - width - 8)),
      top: Math.max(8, Math.min(window.innerHeight - 250, position.top - 8)),
    });
  };

  const saveComment = async () => {
    if (!commentEditor || !commentEditor.body.trim()) return;
    setSavingComment(true);
    setCommentError(null);
    try {
      if (commentEditor.annotation) {
        await onUpdateComment?.(commentEditor.annotation.id, commentEditor.body);
      } else {
        await onCreateAnnotation?.({ ...commentEditor.anchor, kind: 'comment', color: null, comment: commentEditor.body });
      }
      setCommentEditor(null);
    } catch (error) {
      const message = errorMessage(error);
      setCommentError(message);
      onAnnotationError?.(message);
    } finally {
      setSavingComment(false);
    }
  };

  const deleteComment = async () => {
    const annotation = commentEditor?.annotation;
    if (!annotation || !onDeleteAnnotation) return;
    const accepted = await confirm({
      title: t('Eliminar'),
      message: t('¿Eliminar esta anotación? No se puede deshacer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
      zIndex: 2147483000,
    });
    if (!accepted) return;
    try {
      await onDeleteAnnotation(annotation.id);
      setCommentEditor(null);
    } catch (error) {
      const message = errorMessage(error);
      setCommentError(message);
      onAnnotationError?.(message);
    }
  };

  const action = active ?? activeMarkActions ?? activeHighlightActions;

  return (
    <>
      {marginPositions.length > 0 && createPortal(
        <div data-reader-selection-actions>
          {marginPositions.map((position) => (
            <button
              key={`${position.kind}:${position.id}`}
              type="button"
              className={`reader-margin-marker reader-margin-marker-${position.kind}`}
              style={{ left: position.left, top: position.top }}
              aria-label={position.kind === 'bookmark' ? t('Eliminar marcador de lectura') : t('Comentario lateral')}
              onClick={() => {
                if (position.kind === 'bookmark') {
                  setActiveHighlightActions(null);
                  setActiveMarkActions({ value: undefined, left: position.left - 4, top: Math.max(8, position.top - 45) });
                  return;
                }
                const annotation = annotations.find((item) => item.id === position.id);
                if (annotation) openComment(annotation, position);
              }}
            >
              <Icon name={position.kind === 'bookmark' ? 'bookmarkFill' : 'chat'} size={15} />
            </button>
          ))}
        </div>,
        document.body,
      )}

      {action && createPortal(
        <div
          className="reader-selection-actions"
          data-reader-selection-actions
          role="toolbar"
          aria-label={active ? t('Acciones de selección') : t('Editar o eliminar')}
          style={{ left: action.left, top: action.top }}
          onPointerDown={(event) => event.preventDefault()}
        >
          {active ? (
            <>
              <div className="reader-selection-colors" aria-label={t('Color')}>
                {READER_ANNOTATION_COLORS.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="reader-selection-color"
                    onClick={() => createHighlight(active, item.id)}
                    title={`${t('Subrayar')} ${index + 1}`}
                    aria-label={`${t('Subrayar')} ${index + 1}`}
                  >
                    <span style={{ backgroundColor: item.hex }} />
                  </button>
                ))}
              </div>
              <span className="reader-selection-divider" />
              <button type="button" onClick={openNewComment} title={t('Añadir comentario')} aria-label={t('Añadir comentario')}>
                <Icon name="chat" size={17} />
              </button>
              <span className="reader-selection-divider" />
              <button type="button" onClick={() => void copy()} title={t('Copiar')} aria-label={t('Copiar')}>
                <Icon name="copy" size={17} />
              </button>
              <button type="button" onClick={saveMark} title={markLabel} aria-label={markLabel}>
                <Icon name={mark ? 'bookmarkFill' : 'bookmark'} size={17} />
              </button>
              <button type="button" onClick={() => void quoteInNodi()} title={t('Citar en Nodi')} aria-label={t('Citar en Nodi')}>
                <Icon name="quote" size={17} />
              </button>
            </>
          ) : (
            <button
              type="button"
              data-tone="danger"
              onClick={() => {
                if (activeHighlightActions) {
                  const id = activeHighlightActions.value.id;
                  setActiveHighlightActions(null);
                  void onDeleteAnnotation?.(id).catch((error) => onAnnotationError?.(errorMessage(error)));
                } else {
                  deleteMark();
                }
              }}
              title={activeHighlightActions ? t('Eliminar') : t('Eliminar marcador de lectura')}
              aria-label={activeHighlightActions ? t('Eliminar') : t('Eliminar marcador de lectura')}
            >
              <Icon name="trash" size={17} />
            </button>
          )}
        </div>,
        document.body,
      )}

      {commentEditor && createPortal(
        <section
          className="reader-comment-editor"
          data-reader-selection-actions
          role="dialog"
          aria-label={t('Comentario lateral')}
          style={{ left: commentEditor.left, top: commentEditor.top }}
        >
          <header>
            <Icon name="chat" size={15} />
            <strong>{commentEditor.annotation ? t('Comentario') : t('Nuevo comentario lateral')}</strong>
            <button type="button" onClick={() => setCommentEditor(null)} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
          </header>
          <p className="reader-comment-quote">“{commentEditor.anchor.selectedText.replace(/\s+/g, ' ').trim()}”</p>
          <textarea
            autoFocus
            className="input"
            value={commentEditor.body}
            placeholder={t('Escribe el comentario')}
            onChange={(event) => setCommentEditor((current) => current ? { ...current, body: event.target.value } : current)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void saveComment();
              if (event.key === 'Escape') setCommentEditor(null);
            }}
          />
          {commentError && <p className="reader-comment-error">{commentError}</p>}
          <footer>
            {commentEditor.annotation && (
              <button type="button" className="btn btn-ghost text-red-500" onClick={() => void deleteComment()}>
                <Icon name="trash" size={14} /> {t('Eliminar')}
              </button>
            )}
            <span />
            <button type="button" className="btn btn-ghost" onClick={() => setCommentEditor(null)}>{t('Cancelar')}</button>
            <button type="button" className="btn btn-primary" disabled={savingComment || !commentEditor.body.trim()} onClick={() => void saveComment()}>
              {savingComment ? t('Guardando…') : t('Guardar')}
            </button>
          </footer>
        </section>,
        document.body,
      )}
    </>
  );
});
