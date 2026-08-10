import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LibraryReaderDocument,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
  WorkView,
} from '@shared/types';
import { ASSISTANT_CONTEXTS, type PendingAssistantNavigationTarget } from '../navigation';
import { FindInPage } from '../components/FindInPage';
import { Markdown } from '../components/Markdown';
import { NodiViewContextSource } from '../components/NodiViewContextSource';
import {
  READER_ANNOTATION_COLORS,
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from '../components/ReaderSelectionActions';
import { HoverLabelButton, Icon, Spinner } from '../components/ui';
import { confirm } from '../components/feedback';
import { t, tx } from '../i18n';

function readingPositionKey(storageId: string): string {
  return `nodus.libraryReader.position.${storageId}`;
}

function findTextRange(root: HTMLElement, annotation: WritingDraftAnnotation): Range | null {
  const content = root.textContent || '';
  const candidates: number[] = [];
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(annotation.selectedText, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, annotation.selectedText.length);
  }
  if (!candidates.length) return null;
  const index = candidates.sort((a, b) => {
    const score = (at: number) => {
      let value = -Math.abs(at - annotation.startOffset) / Math.max(1, content.length);
      if (annotation.prefix && content.slice(Math.max(0, at - annotation.prefix.length), at) === annotation.prefix) value += 2;
      if (annotation.suffix && content.slice(at + annotation.selectedText.length, at + annotation.selectedText.length + annotation.suffix.length) === annotation.suffix) value += 2;
      return value;
    };
    return score(b) - score(a);
  })[0];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const next = offset + text.data.length;
    if (!started && index >= offset && index <= next) {
      range.setStart(text, Math.min(text.data.length, index - offset));
      started = true;
    }
    const end = index + annotation.selectedText.length;
    if (started && end >= offset && end <= next) {
      range.setEnd(text, Math.min(text.data.length, end - offset));
      return range;
    }
    offset = next;
    node = walker.nextNode();
  }
  return null;
}

function anchorForElement(root: HTMLElement, element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const selectedText = range.toString();
  const startOffset = before.toString().length;
  const endOffset = startOffset + selectedText.length;
  const content = root.textContent || '';
  return {
    startOffset,
    endOffset,
    selectedText,
    prefix: content.slice(Math.max(0, startOffset - 64), startOffset),
    suffix: content.slice(endOffset, endOffset + 64),
  };
}

export function LibraryDocumentReader({
  work,
  onBack,
  onOpenAssistant,
}: {
  work: WorkView;
  onBack: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const [reader, setReader] = useState<LibraryReaderDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [progress, setProgress] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReader(await window.nodus.getLibraryReaderDocument(work.nodus_id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setReader(null);
    } finally {
      setLoading(false);
    }
  }, [work.nodus_id]);

  const refreshAnnotations = useCallback(async () => {
    try {
      setAnnotations(await window.nodus.listLibraryReaderAnnotations(work.nodus_id));
      setAnnotationError(null);
    } catch (nextError) {
      setAnnotationError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [work.nodus_id]);

  useEffect(() => { void loadReader(); }, [loadReader]);
  useEffect(() => {
    if (!reader) return;
    void refreshAnnotations();
    return window.nodus.onLibraryReaderAnnotationsChanged((nodusId) => {
      if (nodusId === null || nodusId === work.nodus_id) void refreshAnnotations();
    });
  }, [reader, refreshAnnotations, work.nodus_id]);

  const createAnnotation = async (input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => {
    const created = await window.nodus.createLibraryReaderAnnotation(work.nodus_id, {
      ...input,
      draftId: work.nodus_id,
      scope: 'source',
    });
    setAnnotations((current) => [...current.filter((item) => item.id !== created.id), created]);
    setAnnotationError(null);
  };

  const updateComment = async (id: string, comment: string) => {
    const updated = await window.nodus.updateLibraryReaderComment(work.nodus_id, id, comment);
    if (!updated) return void refreshAnnotations();
    setAnnotations((current) => current.map((item) => item.id === updated.id ? updated : item));
    setAnnotationError(null);
  };

  const deleteAnnotation = async (id: string) => {
    await window.nodus.deleteLibraryReaderAnnotation(work.nodus_id, id);
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setAnnotationError(null);
  };

  useEffect(() => {
    const root = documentRef.current;
    if (!reader || !root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    headings.forEach((heading, index) => {
      const section = reader.sections[index];
      if (section) heading.id = section.id;
    });
    const scroller = scrollRef.current;
    if (!scroller) return;
    const saved = Number(localStorage.getItem(readingPositionKey(reader.storageId)) || 0);
    requestAnimationFrame(() => { scroller.scrollTop = Number.isFinite(saved) ? Math.max(0, saved) : 0; });
  }, [reader]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!reader || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      setProgress(Math.min(100, Math.max(0, (scroller.scrollTop / max) * 100)));
      localStorage.setItem(readingPositionKey(reader.storageId), String(Math.round(scroller.scrollTop)));
      const top = scroller.getBoundingClientRect().top + 120;
      const headings = Array.from(documentRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []);
      let next = 0;
      for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].getBoundingClientRect().top <= top) next = index;
        else break;
      }
      setActiveSection(next);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [reader]);

  const scrollToSection = (index: number) => {
    const id = reader?.sections[index]?.id;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToAnnotation = (annotation: WritingDraftAnnotation) => {
    const root = documentRef.current;
    if (!root) return;
    const range = findTextRange(root, annotation);
    range?.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const markCurrentSection = async () => {
    const root = documentRef.current;
    const section = reader?.sections[activeSection];
    if (!root || !section) return;
    const heading = document.getElementById(section.id);
    if (!(heading instanceof HTMLElement)) return;
    const anchor = anchorForElement(root, heading);
    if (!anchor.selectedText.trim()) return;
    await createAnnotation({ ...anchor, kind: 'bookmark', color: null });
  };

  const openCurrentPage = async (page: number | null) => {
    if (page && reader?.zoteroKey) {
      await window.nodus.openEvidenceAtPage(work.nodus_id, `p. ${page}`);
      return;
    }
    await window.nodus.openLibraryReaderOriginal(work.nodus_id);
  };

  const askDocument = () => {
    onOpenAssistant({
      title: `${t('Lectura:')} ${reader?.title ?? work.title}`,
      selection: ASSISTANT_CONTEXTS.reading,
      prompt:
        `${t('Quiero conversar sobre este documento. Prioriza su texto, sus anotaciones y su relación con el resto del corpus.')}`
        + `\n\n${reader?.title ?? work.title}\n${(reader?.authors ?? work.authors).join(', ')}`
        + `${reader?.zoteroKey ? `\nZotero: ${reader.zoteroKey}` : ''}`,
    });
  };

  if (loading) {
    return <div className="grid h-full place-items-center"><Spinner label={t('Preparando lector…')} /></div>;
  }

  if (!reader) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-neutral-800 px-4 py-2.5">
          <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Volver a la biblioteca')}</button>
        </header>
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          <div className="max-w-lg rounded-2xl border border-dashed border-neutral-700 bg-neutral-950/30 p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-950 text-indigo-300"><Icon name="book" size={21} /></span>
            <h2 className="mt-4 text-base font-semibold text-neutral-100">{t('Todavía no hay una versión limpia de esta obra')}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{error ?? tx('El lector buscará el documento en nodus-library/{id}, conservando su identificador estable.', { id: work.zotero_key || work.nodus_id })}</p>
            <div className="mt-5 flex justify-center gap-2">
              {work.zotero_key && <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.openInZotero(work.zotero_key)}><Icon name="external" /> {t('Abrir en Zotero')}</button>}
              <button className="btn btn-primary" onClick={() => void loadReader()}><Icon name="refresh" /> {t('Volver a comprobar')}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = reader.sections[activeSection]?.page ?? null;
  const visibleAnnotations = annotations.filter((annotation) => annotation.scope === 'source');
  const sidebarAnnotations = visibleAnnotations.filter((annotation) => annotation.kind !== 'bookmark');
  const contextMarkdown = reader.markdown.replace(/data:image\/[^;]+;base64,[^)\s]+/g, '[imagen extraída]');

  return (
    <div className="library-document-reader flex h-full min-h-0 flex-col">
      <NodiViewContextSource title={reader.title} text={contextMarkdown} />
      <header className="relative flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5 backdrop-blur">
        <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Biblioteca')}</button>
        <button className={`btn btn-ghost h-9 w-9 p-0 lg:hidden ${outlineOpen ? 'text-indigo-300' : ''}`} onClick={() => setOutlineOpen((value) => !value)} aria-label={t('Índice')}><Icon name="list" /></button>
        <div className="min-w-[12rem] flex-1">
          <h1 className="truncate text-sm font-semibold text-neutral-100" title={reader.title}>{reader.title}</h1>
          <p className="truncate text-[11px] text-neutral-500">
            {reader.authors.join(', ')}{reader.year ? ` · ${reader.year}` : ''} · {reader.wordCount.toLocaleString()} {t('palabras')}
          </p>
        </div>
        <span className="hidden rounded-full border border-emerald-900/70 bg-emerald-950/30 px-2 py-1 text-[10px] font-medium text-emerald-300 md:inline-flex">{t('Markdown limpio')}</span>
        <ReaderHighlighterControl value={highlighterColor} onChange={setHighlighterColor} />
        <HoverLabelButton icon="bookmark" label={t('Marcar esta sección')} onClick={() => void markCurrentSection()} className="btn-ghost h-9 min-h-9 border border-neutral-700" />
        <HoverLabelButton icon={hasReaderMark ? 'bookmarkFill' : 'bookmark'} label={t('Ir al marcador de lectura')} onClick={() => markActionsRef.current?.goToMark()} disabled={!hasReaderMark} className={`btn-ghost h-9 min-h-9 border ${hasReaderMark ? 'border-amber-700/60 text-amber-300' : 'border-neutral-700 text-neutral-600'}`} />
        <HoverLabelButton icon="file" label={currentPage ? tx('Ver página {n}', { n: currentPage }) : t('Ver página original')} onClick={() => void openCurrentPage(currentPage)} disabled={!reader.originalAvailable} showLabel={!!currentPage} className="btn-ghost h-9 min-h-9 border border-neutral-700" />
        <HoverLabelButton icon="external" label={t('Abrir PDF completo')} onClick={() => void window.nodus.openLibraryReaderOriginal(work.nodus_id)} disabled={!reader.originalAvailable} className="btn-ghost h-9 min-h-9 border border-neutral-700" />
        <HoverLabelButton icon="chat" label={t('Preguntar al chat')} onClick={askDocument} showLabel className="btn-primary h-9 min-h-9" />
        <button className={`btn btn-ghost h-9 w-9 p-0 xl:hidden ${notesOpen ? 'text-indigo-300' : ''}`} onClick={() => setNotesOpen((value) => !value)} aria-label={t('Anotaciones')}><Icon name="notebook" /></button>
        <div className="absolute inset-x-0 bottom-0 h-px bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </header>

      {(error || annotationError) && <div className="border-b border-red-900 bg-red-950/30 px-4 py-2 text-xs text-red-200">{error ?? annotationError}</div>}

      <div className="relative flex min-h-0 flex-1">
        {outlineOpen && (
          <aside className="library-reader-outline w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950/25 px-3 py-4 max-lg:absolute max-lg:inset-y-[3.75rem] max-lg:left-0 max-lg:z-30 max-lg:shadow-2xl">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{t('En este documento')}</span>
              <span className="text-[10px] tabular-nums text-neutral-600">{Math.round(progress)}%</span>
            </div>
            <nav className="space-y-0.5">
              {reader.sections.map((section, index) => (
                <div key={section.id} className={`group flex items-center rounded-lg ${index === activeSection ? 'bg-indigo-950/45 text-indigo-200' : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'}`}>
                  <button className="min-w-0 flex-1 px-2 py-2 text-left text-xs leading-4" style={{ paddingLeft: `${8 + Math.max(0, section.level - 1) * 10}px` }} onClick={() => scrollToSection(index)}>
                    <span className="line-clamp-2">{section.title}</span>
                  </button>
                  {section.page && <button className="mr-1 shrink-0 rounded px-1.5 py-1 text-[9px] tabular-nums text-neutral-600 opacity-0 hover:bg-neutral-800 hover:text-indigo-300 group-hover:opacity-100" title={tx('Abrir página {n} del original', { n: section.page })} onClick={() => void openCurrentPage(section.page)}>p. {section.page}</button>}
                </div>
              ))}
            </nav>
            <div className="mt-5 border-t border-neutral-800 px-2 pt-4 text-[10px] leading-5 text-neutral-600">
              <div>{t('Identificador')}: <span className="select-all font-mono text-neutral-500">{reader.storageId}</span></div>
              {reader.pageCount && <div>{reader.pageCount} {t('páginas en el original')}</div>}
            </div>
          </aside>
        )}

        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto bg-neutral-950/10 px-5 py-8 max-md:px-3">
          <article className="library-reader-paper mx-auto max-w-[52rem] rounded-2xl border border-neutral-800/80 bg-neutral-950/35 px-12 py-12 shadow-[0_24px_70px_-40px_rgba(0,0,0,.75)] max-md:rounded-none max-md:border-x-0 max-md:px-5">
            <div ref={documentRef} className="library-reader-document relative" data-testid="library-reader-document">
              <Markdown content={reader.markdown} verify={false} allowDataImages className="text-[16px] leading-[1.85] text-neutral-300" />
            </div>
          </article>
          <div className="mx-auto mt-6 flex max-w-[52rem] items-center justify-between px-2 pb-10 text-[11px] text-neutral-600">
            <span>{reader.citationKey ? `[${reader.citationKey}]` : reader.storageId}</span>
            <span>{t('El original permanece separado y sin modificaciones.')}</span>
          </div>
        </main>

        <ReaderSelectionActions
          ref={markActionsRef}
          targetRef={documentRef}
          scrollRef={scrollRef}
          contextId={`library-reader:${reader.storageId}`}
          annotations={visibleAnnotations}
          highlighterColor={highlighterColor}
          onCreateAnnotation={createAnnotation}
          onUpdateComment={updateComment}
          onDeleteAnnotation={deleteAnnotation}
          onAnnotationError={setAnnotationError}
          onMarkChange={setHasReaderMark}
        />

        {notesOpen && (
          <aside className="library-reader-notes w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/25 p-4 max-xl:absolute max-xl:inset-y-[3.75rem] max-xl:right-0 max-xl:z-30 max-xl:shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-neutral-200">{t('Subrayados y anotaciones')}</h2>
                <p className="mt-0.5 text-[10px] text-neutral-600">{tx('{n} fragmentos guardados', { n: sidebarAnnotations.length })}</p>
              </div>
              <button className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-900 hover:text-neutral-300 xl:hidden" onClick={() => setNotesOpen(false)} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {sidebarAnnotations.map((annotation) => {
                const color = READER_ANNOTATION_COLORS.find((item) => item.id === annotation.color)?.hex;
                return (
                  <article key={annotation.id} className="group rounded-xl border border-neutral-800 bg-neutral-950/35 p-3 hover:border-neutral-700">
                    <button className="block w-full text-left" onClick={() => goToAnnotation(annotation)}>
                      <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                        {color ? <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Icon name="chat" size={11} />}
                        {annotation.kind === 'comment' ? t('Anotación') : t('Subrayado')}
                      </span>
                      <span className="mt-2 line-clamp-3 block border-l-2 border-neutral-700 pl-2 text-[11px] italic leading-5 text-neutral-400">“{annotation.selectedText.replace(/\s+/g, ' ').trim()}”</span>
                      {annotation.comment && <span className="mt-2 line-clamp-4 block text-xs leading-5 text-neutral-300">{annotation.comment}</span>}
                    </button>
                    <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100">
                      <button className="rounded p-1 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Eliminar')} onClick={async () => {
                        const accepted = await confirm({ title: t('Eliminar'), message: t('¿Eliminar esta anotación? No se puede deshacer.'), confirmLabel: t('Eliminar'), danger: true });
                        if (accepted) await deleteAnnotation(annotation.id);
                      }}><Icon name="trash" size={12} /></button>
                    </div>
                  </article>
                );
              })}
              {!sidebarAnnotations.length && <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-xs leading-5 text-neutral-600">{t('Selecciona texto para subrayarlo, anotarlo o preguntarle a Nodi.')}</div>}
            </div>
          </aside>
        )}
      </div>
      <FindInPage targetRef={scrollRef} />
    </div>
  );
}
