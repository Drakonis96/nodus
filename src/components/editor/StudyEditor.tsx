import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Crepe } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx } from '@milkdown/core';
import { toggleInlineCodeCommand, turnIntoTextCommand, wrapInHeadingCommand } from '@milkdown/preset-commonmark';
import { insert, replaceAll } from '@milkdown/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import TurndownService from 'turndown';
import { diffWordsWithSpace } from 'diff';
import type {
  StudyAnnotation,
  StudyDocEditorData,
  StudyDocStyle,
  StudyDocVersion,
  StudyEditorCommand,
  StudyOutlineItem,
} from '@shared/studyEditor';
import { DEFAULT_STUDY_DOC_STYLE, studyCommandMarkdown, studyDocumentStats } from '@shared/studyEditor';
import { deleteLastStudySentence } from '@shared/sttModels';
import type { StudyDocument, StudyDocumentKind, StudyTag } from '@shared/studyOrg';
import { STUDY_DOCUMENT_KINDS } from '@shared/studyOrg';
import type { StudyImproveScope, StudyStyle } from '@shared/studyImprove';
import { Markdown } from '../Markdown';
import { Icon, ICON_NAMES, Spinner } from '../ui';
import { TextInputModal } from '../TextInputModal';
import { t } from '../../i18n';
import { DocOutline } from './DocOutline';
import { StudyDictation } from './StudyDictation';
import { StudyImproveDialog } from './StudyImproveDialog';
import { AudioPanel } from '../AudioPanel';
import { ConfirmModal } from '../ConfirmModal';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface ImproveTarget {
  from: number;
  to: number;
  text: string;
  scope: StudyImproveScope;
  initialStyleId?: string;
  visual?: boolean;
}

function ImproveStyleMark({ style, size = 16 }: { style: Pick<StudyStyle, 'icon'>; size?: number }) {
  return (ICON_NAMES as readonly string[]).includes(style.icon)
    ? <Icon name={style.icon} size={size} />
    : <span className="leading-none" style={{ fontSize: size }}>{style.icon || '✦'}</span>;
}

const STUDY_KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

interface MilkdownCanvasHandle {
  insertText: (text: string, replaceSelection: boolean) => void;
  insertMarkdown: (markdown: string) => void;
  selectedText: () => string;
  runInlineCommand: (command: 'code' | 'formula') => void;
  setHeading: (level: number) => void;
  setTextColor: (color: string) => void;
  replaceAllMarkdown: (markdown: string) => void;
}

const MilkdownCanvas = forwardRef<MilkdownCanvasHandle, {
  documentId: string;
  value: string;
  spellcheck: boolean;
  language: string;
  onChange: (markdown: string) => void;
  onOpenRecording: (recordingId: string, timestamp?: number | null) => void;
  onToolbarElement: (element: HTMLElement | null) => void;
}>(({ documentId, value, spellcheck, language, onChange, onOpenRecording, onToolbarElement }, ref) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const initialValueRef = useRef(value);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const crepe = new Crepe({
      root,
      defaultValue: initialValueRef.current,
      features: { [Crepe.Feature.AI]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: t('Empieza a escribir o usa / para insertar un bloque…') },
      },
    });
    crepeRef.current = crepe;
    crepe.on((listener) => listener.markdownUpdated((_ctx, markdown) => changeRef.current(markdown)));
    let disposed = false;
    let toolbarObserver: MutationObserver | null = null;
    void crepe.create().then(() => {
      if (disposed) return;
      const editable = root.querySelector('[contenteditable="true"]');
      editable?.setAttribute('spellcheck', spellcheck ? 'true' : 'false');
      editable?.setAttribute('lang', language);
      editable?.setAttribute('aria-label', t('Editor del apunte'));
      const findToolbar = () => {
        const toolbar = root.querySelector<HTMLElement>('.milkdown-toolbar') ?? root.parentElement?.querySelector<HTMLElement>('.milkdown-toolbar') ?? null;
        if (!toolbar) return null;
        let host = toolbar.querySelector<HTMLElement>('.study-selection-tools-host');
        if (!host) {
          host = document.createElement('span');
          host.className = 'study-selection-tools-host';
          toolbar.append(host);
        }
        onToolbarElement(host);
        return host;
      };
      findToolbar();
      toolbarObserver = new MutationObserver(() => { findToolbar(); });
      toolbarObserver.observe(root.parentElement ?? root, { childList: true, subtree: true });
    });
    return () => { disposed = true; toolbarObserver?.disconnect(); onToolbarElement(null); crepeRef.current = null; void crepe.destroy(); };
  }, [documentId, spellcheck, language]);

  useImperativeHandle(ref, () => ({
    insertText(text, replaceSelection) {
      crepeRef.current?.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        view.dispatch(view.state.tr.insertText(text, from, replaceSelection ? to : from).scrollIntoView());
        view.focus();
      });
    },
    insertMarkdown(markdown) {
      crepeRef.current?.editor.action((ctx) => {
        insert(markdown)(ctx);
        ctx.get(editorViewCtx).focus();
      });
    },
    selectedText() {
      let text = '';
      crepeRef.current?.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        text = view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '\n');
      });
      return text;
    },
    runInlineCommand(command) {
      crepeRef.current?.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        if (command === 'code') commands.call(toggleInlineCodeCommand.key);
        else commands.call('ToggleLatex');
        ctx.get(editorViewCtx).focus();
      });
    },
    setHeading(level) {
      crepeRef.current?.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        if (level === 0) commands.call(turnIntoTextCommand.key);
        else commands.call(wrapInHeadingCommand.key, level);
        ctx.get(editorViewCtx).focus();
      });
    },
    setTextColor(color) {
      crepeRef.current?.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        const selected = view.state.doc.textBetween(from, to, ' ');
        if (!selected) return;
        const safe = selected.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        insert(`<span style="color: ${color}">${safe}</span>`)(ctx);
        ctx.get(editorViewCtx).focus();
      });
    },
    replaceAllMarkdown(markdown) {
      crepeRef.current?.editor.action((ctx) => {
        replaceAll(markdown)(ctx);
        ctx.get(editorViewCtx).focus();
      });
    },
  }), []);

  return <div ref={rootRef} className="study-milkdown min-h-full" onClick={(event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="nodus://study/recording/"]');
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    const match = anchor.getAttribute('href')?.match(/^nodus:\/\/study\/recording\/([^?]+)(?:\?(.*))?$/);
    if (!match) return;
    const timestamp = new URLSearchParams(match[2] ?? '').get('t');
    onOpenRecording(decodeURIComponent(match[1]), timestamp == null ? null : Number(timestamp));
  }} />;
});
MilkdownCanvas.displayName = 'MilkdownCanvas';

function VersionDiff({ version, current }: { version: StudyDocVersion; current: string }) {
  const pieces = useMemo(() => diffWordsWithSpace(version.contentMarkdown, current), [version.id, current]);
  return (
    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs leading-5">
      {pieces.map((piece, index) => (
        <span key={index} className={piece.added ? 'bg-emerald-500/20 text-emerald-200' : piece.removed ? 'bg-red-500/20 text-red-200 line-through' : 'text-neutral-500'}>
          {piece.value}
        </span>
      ))}
    </div>
  );
}

export function StudyEditor({
  documents,
  tags,
  activeTagIds,
  subjectId,
  activeId,
  onActivate,
  onClose,
  onSaved,
  onUpdateMetadata,
  onSetTags,
  onCreateTag,
  onDuplicate,
  onTrash,
  onOpenLinkedDocument,
  onOpenRecording,
}: {
  documents: StudyDocument[];
  tags: StudyTag[];
  activeTagIds: string[];
  subjectId?: string | null;
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSaved: (document: StudyDocument) => void;
  onUpdateMetadata: (patch: Partial<Pick<StudyDocument, 'kind' | 'color' | 'favorite'>>) => Promise<void>;
  onSetTags: (tagIds: string[]) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onTrash: () => Promise<void>;
  onOpenLinkedDocument: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
}) {
  const active = documents.find((document) => document.id === activeId) ?? documents[0];
  const [data, setData] = useState<StudyDocEditorData | null>(null);
  const [title, setTitle] = useState(active?.title ?? '');
  const [draft, setDraft] = useState(active?.contentMarkdown ?? '');
  const [style, setStyle] = useState<StudyDocStyle>(DEFAULT_STUDY_DOC_STYLE);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [raw, setRaw] = useState(false);
  const [split, setSplit] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [audioSelection, setAudioSelection] = useState('');
  const [audioCursor, setAudioCursor] = useState(0);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [dictionaryWord, setDictionaryWord] = useState('');
  const [textDialog, setTextDialog] = useState<{ kind: 'comment' | 'tag'; selectedText?: string } | null>(null);
  const [showImprovePrompts, setShowImprovePrompts] = useState(false);
  const [quickImproveStyles, setQuickImproveStyles] = useState<StudyStyle[]>([]);
  const [selectionImprove, setSelectionImprove] = useState<{ x: number; y: number; target: ImproveTarget } | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<HTMLElement | null>(null);
  const [improveStreamingStyleId, setImproveStreamingStyleId] = useState<string | null>(null);
  const [improveStreamError, setImproveStreamError] = useState('');
  const [improveUndo, setImproveUndo] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<StudyDocVersion | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const baselineRef = useRef('');
  const milkdownRef = useRef<MilkdownCanvasHandle>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const turndown = useMemo(() => new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' }), []);

  const loadData = useCallback(async (documentId: string) => {
    const next = await window.nodus.getStudyDocEditorData(documentId);
    setData(next);
    setStyle(next.style);
    return next;
  }, []);

  const loadQuickImproveStyles = useCallback(async () => {
    const [settings, styles] = await Promise.all([window.nodus.getSettings(), window.nodus.listStudyStyles()]);
    const byId = new Map(styles.filter((item) => item.active && !item.archivedAt).map((item) => [item.id, item]));
    setQuickImproveStyles(settings.studyImproveToolbarStyleIds.slice(0, 4).map((id) => byId.get(id)).filter((item): item is StudyStyle => Boolean(item)));
  }, []);

  useEffect(() => { void loadQuickImproveStyles(); }, [active?.id, loadQuickImproveStyles]);

  useEffect(() => {
    if (!active) return;
    setTitle(active.title);
    setDraft(active.contentMarkdown);
    baselineRef.current = JSON.stringify({ title: active.title, content: active.contentMarkdown, style: DEFAULT_STUDY_DOC_STYLE, language: 'es-ES', dictionary: [] });
    setSaveState('saved');
    setEditingTitle(false);
    setSelectedVersion(null);
    setEditorRevision((value) => value + 1);
    void loadData(active.id).then((next) => {
      baselineRef.current = JSON.stringify({ title: active.title, content: active.contentMarkdown, style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
    });
  }, [active?.id, loadData]);

  const resolveImproveSelection = (allowFallback: boolean): ImproveTarget | null => {
    const textarea = rawTextareaRef.current;
    if (raw && textarea) {
      let from = textarea.selectionStart;
      let to = textarea.selectionEnd;
      if (from !== to) return { from, to, text: draft.slice(from, to), scope: 'selection' };
      if (!allowFallback) return null;
      from = draft.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
      const nextLine = draft.indexOf('\n', to);
      to = nextLine === -1 ? draft.length : nextLine;
      if (draft.slice(from, to).trim()) return { from, to, text: draft.slice(from, to), scope: 'paragraph' };
    }
    const selection = milkdownRef.current?.selectedText() || window.getSelection()?.toString() || '';
    if (selection.trim()) {
      const from = draft.indexOf(selection);
      if (from >= 0) return { from, to: from + selection.length, text: selection, scope: 'selection', visual: !raw };
    }
    if (!allowFallback) return null;
    if (!window.confirm(t('No hay texto seleccionado. ¿Quieres mejorar el documento completo?'))) return null;
    return { from: 0, to: draft.length, text: draft, scope: 'document' };
  };

  const showSelectionImproveShortcuts = (event?: { clientX?: number; clientY?: number }) => {
    window.setTimeout(() => {
      if (improveStreamingStyleId) return;
      const target = resolveImproveSelection(false);
      if (!target) { setSelectionImprove(null); return; }
      const selection = window.getSelection();
      const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const fallback = rawTextareaRef.current?.getBoundingClientRect();
      const x = rect?.width ? rect.left + rect.width / 2 : event?.clientX ?? (fallback ? fallback.right - 120 : window.innerWidth / 2);
      const y = rect?.height ? rect.top - 12 : event?.clientY ?? (fallback ? fallback.top + 16 : 80);
      setSelectionImprove({ x: Math.max(110, Math.min(window.innerWidth - 110, x)), y: Math.max(54, y), target });
      setImproveStreamError('');
    });
  };

  const replaceImprovedSelection = (base: string, target: ImproveTarget, text: string) => {
    const next = `${base.slice(0, target.from)}${text}${base.slice(target.to)}`;
    setDraft(next);
    if (!raw) milkdownRef.current?.replaceAllMarkdown(next);
    setSaveState('dirty');
  };

  const runQuickImprovement = async (style: StudyStyle, target = selectionImprove?.target ?? resolveImproveSelection(false)) => {
    if (!target || improveStreamingStyleId || !active || !data) return;
    const base = draft;
    let streamed = '';
    let frame = 0;
    const flush = () => { frame = 0; replaceImprovedSelection(base, target, streamed); };
    setImproveUndo(base); setImproveStreamingStyleId(style.id); setImproveStreamError(''); setSelectionImprove(null);
    try {
      const result = await window.nodus.improveStudyText({
        documentId: active.id, subjectId, text: target.text, styleId: style.id, scope: target.scope,
        level: style.level, length: style.length, mode: 'preserve',
        variables: { language: style.language, documentType: active.kind, selectedText: target.text },
        protectedTerms: [active.title, ...data.customDictionary], model: null,
      }, { onDelta: (delta) => {
        streamed += delta;
        if (!frame) frame = window.requestAnimationFrame(flush);
      } });
      if (frame) window.cancelAnimationFrame(frame);
      replaceImprovedSelection(base, target, result.text);
      await window.nodus.updateStudyImprovementAction(result.logId, 'replace');
    } catch (cause) {
      if (frame) window.cancelAnimationFrame(frame);
      setDraft(base); if (!raw) milkdownRef.current?.replaceAllMarkdown(base);
      setImproveUndo(null);
      setImproveStreamError(cause instanceof Error ? cause.message : String(cause));
    } finally { setImproveStreamingStyleId(null); }
  };

  const undoImprovement = () => {
    if (improveUndo == null) return;
    const current = draft;
    setDraft(improveUndo); if (!raw) milkdownRef.current?.replaceAllMarkdown(improveUndo);
    setImproveUndo(current); setSaveState('dirty'); setImproveStreamError('');
  };

  const currentSignature = JSON.stringify({ title, content: draft, style, language: data?.spellcheckLanguage, dictionary: data?.customDictionary });
  useEffect(() => {
    if (!active || !data || improveStreamingStyleId || currentSignature === baselineRef.current) return;
    setSaveState('dirty');
    const timer = window.setTimeout(() => void save('autosave'), 1400);
    return () => window.clearTimeout(timer);
  }, [currentSignature, active?.id, data != null, improveStreamingStyleId]);

  const save = async (reason: 'autosave' | 'manual' | 'command') => {
    if (!active || currentSignature === baselineRef.current) return;
    setSaveState('saving');
    try {
      const updated = await window.nodus.updateStudyDoc(active.id, {
        title,
        contentMarkdown: draft,
        style,
        spellcheckLanguage: data?.spellcheckLanguage,
        customDictionary: data?.customDictionary,
        reason,
      });
      baselineRef.current = JSON.stringify({ title, content: draft, style, language: data?.spellcheckLanguage, dictionary: data?.customDictionary });
      setSaveState('saved');
      onSaved(updated);
      await loadData(active.id);
    } catch {
      setSaveState('error');
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save('manual'); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setShowSearch(true); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') { event.preventDefault(); setShowImprovePrompts(true); }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && improveUndo != null && !showImprovePrompts) { event.preventDefault(); undoImprovement(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  if (!active || !data) return <div className="flex h-full items-center justify-center"><Spinner label={t('Cargando editor…')} /></div>;

  const stats = studyDocumentStats(draft);
  const styleVars = {
    '--study-editor-font': style.fontFamily === 'serif' ? 'Georgia, Cambria, serif' : style.fontFamily === 'mono' ? 'ui-monospace, monospace' : 'Inter, system-ui, sans-serif',
    '--study-editor-size': `${style.fontSize}px`,
    '--study-editor-line': String(style.lineHeight),
    '--study-editor-width': `${style.pageWidth}px`,
    '--study-editor-margin': `${style.marginX}px`,
    '--study-editor-spacing': `${style.paragraphSpacing}em`,
    '--study-editor-indent': `${style.firstLineIndent}px`,
    '--study-editor-align': style.alignment,
  } as CSSProperties;

  const insertMarkdown = (markdown: string) => {
    const snippet = `${markdown.replace(/^\n+|\n+$/g, '')}\n`;
    if (!raw) {
      milkdownRef.current?.insertMarkdown(snippet);
      return;
    }
    const textarea = rawTextareaRef.current;
    const from = textarea?.selectionStart ?? draft.length;
    const to = textarea?.selectionEnd ?? from;
    const prefix = from > 0 && !draft.slice(0, from).endsWith('\n') ? '\n\n' : '';
    const next = `${draft.slice(0, from)}${prefix}${snippet}${draft.slice(to)}`;
    setDraft(next);
    setSaveState('dirty');
    window.setTimeout(() => {
      const cursor = from + prefix.length + snippet.length;
      rawTextareaRef.current?.setSelectionRange(cursor, cursor);
      rawTextareaRef.current?.focus();
    });
  };
  const insertCommand = (command: StudyEditorCommand) => insertMarkdown(studyCommandMarkdown(command));
  const insertHeading = (level: number) => insertMarkdown(`${'#'.repeat(level)} ${t('Título')}`);
  const insertTable = () => {
    const rows = Number.isFinite(tableRows) ? Math.min(20, Math.max(1, Math.trunc(tableRows))) : 3;
    const columns = Number.isFinite(tableColumns) ? Math.min(12, Math.max(1, Math.trunc(tableColumns))) : 3;
    const header = `| ${Array.from({ length: columns }, (_, index) => `${t('Columna')} ${index + 1}`).join(' | ')} |`;
    const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rows }, () => `| ${Array.from({ length: columns }, () => t('Contenido')).join(' | ')} |`);
    insertMarkdown([header, separator, ...body].join('\n'));
    setTableDialogOpen(false);
  };
  const requestClose = (documentId: string) => setPendingCloseId(documentId);
  const confirmClose = async () => {
    const documentId = pendingCloseId;
    if (!documentId) return;
    if (documentId === active.id && saveState !== 'saved') await save('manual');
    setPendingCloseId(null);
    onClose(documentId);
  };
  const jumpToHeading = (_item: StudyOutlineItem, index: number) => {
    const heading = document.querySelectorAll('.study-milkdown .ProseMirror h1, .study-milkdown .ProseMirror h2, .study-milkdown .ProseMirror h3, .study-milkdown .ProseMirror h4, .study-milkdown .ProseMirror h5, .study-milkdown .ProseMirror h6')[index];
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const openCommentDialog = () => {
    const selectedText = window.getSelection()?.toString().trim() ?? '';
    setTextDialog({ kind: 'comment', selectedText });
  };
  const submitTextDialog = async (value: string) => {
    if (textDialog?.kind === 'tag') {
      await onCreateTag(value);
      setTextDialog(null);
      return;
    }
    const selectedText = textDialog?.selectedText ?? '';
    const from = selectedText ? Math.max(0, draft.indexOf(selectedText)) : 0;
    await window.nodus.createStudyAnnotation(active.id, { from, to: from + selectedText.length, selectedText, comment: value });
    await loadData(active.id);
    setTextDialog(null);
  };
  const restoreVersion = async (version: StudyDocVersion) => {
    if (!window.confirm(t('¿Restaurar esta versión? El estado actual seguirá disponible en el historial.'))) return;
    const restored = await window.nodus.restoreStudyDocVersion(active.id, version.id);
    setTitle(restored.title); setDraft(restored.contentMarkdown); onSaved(restored);
    setEditorRevision((value) => value + 1);
    const next = await loadData(active.id);
    baselineRef.current = JSON.stringify({ title: restored.title, content: restored.contentMarkdown, style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
    setSaveState('saved');
  };
  const updateAnnotation = async (annotation: StudyAnnotation, patch: Parameters<typeof window.nodus.updateStudyAnnotation>[1]) => {
    await window.nodus.updateStudyAnnotation(annotation.id, patch); await loadData(active.id);
  };
  const searchCount = search ? draft.toLocaleLowerCase().split(search.toLocaleLowerCase()).length - 1 : 0;
  const handleEditorDrop = async (event: DragEvent<HTMLDivElement>) => {
    const documentId = event.dataTransfer.getData('application/x-nodus-study-doc');
    const uri = event.dataTransfer.getData('text/uri-list');
    if (!documentId && !uri) return;
    event.preventDefault();
    let snippet = '';
    if (documentId) {
      const workspace = await window.nodus.getStudyWorkspace();
      const target = workspace.documents.find((document) => document.id === documentId);
      if (target && target.id !== active.id) snippet = `[${target.title}](nodus://study/doc/${target.id})`;
    } else if (uri) {
      snippet = /\.(png|jpe?g|gif|webp|svg)(?:\?.*)?$/i.test(uri) ? `![${t('Imagen')}](${uri})` : `[${uri}](${uri})`;
    }
    if (snippet) {
      if (raw) setDraft((current) => `${current}${current.endsWith('\n') || !current ? '' : '\n\n'}${snippet}\n`);
      else milkdownRef.current?.insertMarkdown(snippet);
    }
  };

  return (
    <div style={styleVars} className={`study-editor-shell flex h-full min-h-0 flex-col bg-stone-100 text-stone-900 dark:bg-neutral-950 dark:text-neutral-100 ${fullscreen ? 'fixed inset-0 z-[100]' : ''} study-theme-${style.theme}`}>
      <div className="study-editor-tabs flex min-h-10 items-end gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50 px-2 pt-1 dark:border-neutral-800 dark:bg-neutral-950">
        {documents.map((document) => (
          <div key={document.id} role="tab" tabIndex={0} aria-selected={document.id === active.id} onClick={() => onActivate(document.id)}
            onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) onActivate(document.id); }}
            className={`group flex max-w-64 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-2 text-xs ${document.id === active.id ? 'border-stone-300 bg-white text-stone-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200' : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-neutral-600 dark:hover:text-neutral-300'}`}>
            <Icon name="notebook" size={12} />
            {document.id === active.id && editingTitle ? (
              <input autoFocus aria-label={t('Título del apunte')} className="min-w-24 max-w-44 bg-transparent font-semibold outline-none ring-0" value={title}
                onClick={(event) => event.stopPropagation()} onChange={(event) => setTitle(event.target.value)}
                onBlur={() => setEditingTitle(false)} onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); setEditingTitle(false); void save('manual'); }
                  if (event.key === 'Escape') { event.preventDefault(); setTitle(active.title); setEditingTitle(false); }
                }} />
            ) : <span className="min-w-0 flex-1 truncate">{document.id === active.id ? title : document.title}</span>}
            {document.id === active.id && !editingTitle && <button type="button" title={t('Renombrar apunte')} aria-label={t('Renombrar apunte')}
              onClick={(event) => { event.stopPropagation(); setEditingTitle(true); }} className="rounded p-0.5 text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"><Icon name="edit" size={11} /></button>}
            <button type="button" title={t('Cerrar apunte')} aria-label={t('Cerrar apunte')}
              onClick={(event) => { event.stopPropagation(); requestClose(document.id); }} className="rounded p-0.5 text-neutral-700 group-hover:text-neutral-400 hover:bg-neutral-800 hover:!text-red-300"><Icon name="x" size={11} /></button>
          </div>
        ))}
      </div>

      <div className="study-editor-toolbar flex flex-wrap items-center gap-1 border-b border-stone-200 bg-white/80 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/50">
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Cerrar editor')} aria-label={t('Cerrar editor')} onClick={() => requestClose(active.id)}><Icon name="arrowLeft" size={14} /></button>
        <span className={`mr-2 text-[10px] ${saveState === 'error' ? 'text-red-400' : saveState === 'saved' ? 'text-emerald-500' : 'text-amber-400'}`}>
          {t(saveState === 'saved' ? 'Guardado' : saveState === 'saving' ? 'Guardando…' : saveState === 'dirty' ? 'Cambios sin guardar' : 'Error al guardar')}
        </span>
        <button data-testid="study-doc-favorite" className="btn btn-ghost h-8 w-8 p-0" title={t('Favorito')} aria-label={t('Favorito')} onClick={() => void onUpdateMetadata({ favorite: !active.favorite })}>
          <Icon name="star" size={13} className={active.favorite ? 'text-amber-400' : ''} />
        </button>
        <button className="btn btn-primary h-8 w-8 p-0" title={t('Guardar')} aria-label={t('Guardar')} onClick={() => void save('manual')}><Icon name="save" size={13} /></button>
        <button className={`btn btn-ghost h-8 w-8 p-0 ${raw ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} title={t('Markdown crudo')} aria-label={t('Markdown crudo')} onClick={() => {
          if (raw) setEditorRevision((value) => value + 1); setRaw(!raw);
        }}><Icon name="code" size={13} /></button>
        <button className={`btn btn-ghost h-8 w-8 p-0 ${split ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} title={t('Dividir vista')} aria-label={t('Dividir vista')} onClick={() => setSplit(!split)}><Icon name="columns" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Buscar y reemplazar')} aria-label={t('Buscar y reemplazar')} onClick={() => setShowSearch(!showSearch)}><Icon name="search" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" onClick={openCommentDialog} title={t('Añadir comentario')} aria-label={t('Añadir comentario')}><Icon name="chat" size={13} /></button>
        <button data-testid="study-dictation-toggle" className={`btn btn-ghost h-8 w-8 p-0 ${showDictation ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} onClick={() => setShowDictation(!showDictation)} title={t('Dictado por voz')} aria-label={t('Dictado por voz')}><Icon name="microphone" size={13} /></button>
        <button data-testid="study-audio-toggle" className={`btn btn-ghost h-8 w-8 p-0 ${showAudio ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' : ''}`} onClick={() => {
          const target = resolveImproveSelection(false);
          setAudioSelection(target?.text ?? '');
          setAudioCursor(rawTextareaRef.current?.selectionStart ?? target?.from ?? 0);
          setShowAudio((value) => !value);
        }} title={t('Lectura por voz')} aria-label={t('Lectura por voz')}><Icon name="play" size={13} /></button>
        <button data-testid="study-improve-toggle" className={`btn btn-ghost h-8 w-8 p-0 ${showImprovePrompts ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' : ''}`} onClick={() => setShowImprovePrompts(true)} title={`${t('Prompts de mejora')} (⌘⇧I)`} aria-label={t('Prompts de mejora')}><Icon name="wand" size={13} /></button>
        {quickImproveStyles.map((prompt) => <button type="button" key={prompt.id} data-testid={`study-toolbar-quick-improve-${prompt.id.replace(':', '-')}`} className="btn btn-ghost h-8 w-8 p-0 text-teal-700 dark:text-teal-300" title={`${prompt.name} · ${prompt.description}`} aria-label={prompt.name} disabled={Boolean(improveStreamingStyleId)} onClick={() => void runQuickImprovement(prompt)}><ImproveStyleMark style={prompt} size={15} /></button>)}
        {improveUndo != null && <button data-testid="study-improve-undo" className="btn btn-ghost h-8 w-8 p-0 text-amber-700 dark:text-amber-300" onClick={undoImprovement} title={`${t('Deshacer la última mejora')} (Ctrl/⌘+Z)`} aria-label={t('Deshacer la última mejora')}><Icon name="undo" size={13} /></button>}
        <button data-testid="study-doc-style" className={`btn btn-ghost h-8 w-8 p-0 ${showStyle ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} title={t('Apariencia y metadatos')} aria-label={t('Apariencia y metadatos')} onClick={() => setShowStyle(!showStyle)}><Icon name="palette" size={13} /></button>
        <button className={`btn btn-ghost h-8 w-8 p-0 ${showHistory ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} title={t('Historial de versiones')} aria-label={t('Historial de versiones')} onClick={() => setShowHistory(!showHistory)}><Icon name="clock" size={13} /></button>
        <button className={`btn btn-ghost h-8 w-8 p-0 ${focusMode ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : ''}`} onClick={() => setFocusMode(!focusMode)} title={t('Modo concentración')} aria-label={t('Modo concentración')}><Icon name="eye" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setFullscreen(!fullscreen)} title={t('Pantalla completa')} aria-label={t('Pantalla completa')}><Icon name="fit" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => window.print()} title={t('Vista previa de impresión')} aria-label={t('Vista previa de impresión')}><Icon name="external" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => void onDuplicate()} title={t('Duplicar')} aria-label={t('Duplicar')}><Icon name="copy" size={13} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0 text-red-400" onClick={() => {
          if (window.confirm(t('¿Mover este material a la papelera?'))) void onTrash();
        }} title={t('Mover a la papelera')} aria-label={t('Mover a la papelera')}><Icon name="trash" size={13} /></button>
        <span className="ml-auto py-1 text-[10px] text-neutral-600">{stats.words} {t('palabras')} · {stats.readingMinutes} min</span>
      </div>

      <div className="study-insert-toolbar flex flex-wrap items-center gap-1 border-b border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-transparent" data-testid="study-insert-toolbar">
        <label className="sr-only" htmlFor="study-heading-level">{t('Nivel de título')}</label>
        <select id="study-heading-level" data-testid="study-heading-level" className="input h-8 w-[4.5rem] px-2 text-xs" defaultValue="" title={t('Insertar título')}
          onChange={(event) => { if (event.target.value) insertHeading(Number(event.target.value)); event.target.value = ''; }}>
          <option value="" disabled>H</option>
          {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>H{level}</option>)}
        </select>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Insertar tabla')} aria-label={t('Insertar tabla')} onClick={() => setTableDialogOpen(true)}><Icon name="table" size={14} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Insertar cita')} aria-label={t('Insertar cita')} onClick={() => insertCommand('cita')}><Icon name="quote" size={14} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Insertar imagen')} aria-label={t('Insertar imagen')} onClick={() => insertCommand('imagen')}><Icon name="image" size={14} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Insertar bloque de audio')} aria-label={t('Insertar bloque de audio')} onClick={() => insertCommand('audio')}><Icon name="play" size={14} /></button>
        <button className="btn btn-ghost h-8 w-8 p-0" title={t('Insertar pregunta de test')} aria-label={t('Insertar pregunta de test')} onClick={() => insertCommand('test')}><Icon name="help" size={14} /></button>
        <button data-testid="study-inline-code" className="btn btn-ghost h-8 w-8 p-0" disabled={raw} title={t('Código en línea')} aria-label={t('Código en línea')} onClick={() => milkdownRef.current?.runInlineCommand('code')}><Icon name="code" size={14} /></button>
        <button data-testid="study-inline-formula" className="btn btn-ghost h-8 w-8 p-0 font-serif text-base" disabled={raw} title={t('Fórmula en línea')} aria-label={t('Fórmula en línea')} onClick={() => milkdownRef.current?.runInlineCommand('formula')}>ƒx</button>
      </div>

      {improveStreamError && <div data-testid="study-improve-stream-error" className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><Icon name="alert" size={13} /><span className="min-w-0 flex-1">{improveStreamError}</span><span>{t('El original permanece intacto.')}</span><button onClick={() => setImproveStreamError('')} aria-label={t('Cerrar')}><Icon name="x" size={12} /></button></div>}
      {improveStreamingStyleId && <div data-testid="study-improve-streaming" className="flex items-center gap-2 border-b border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200"><Spinner label={t('Mejorando texto…')} /><span>{quickImproveStyles.find((style) => style.id === improveStreamingStyleId)?.name}</span></div>}

      {showSearch && (
        <div className="study-search-toolbar flex items-center gap-2 border-b border-stone-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/50">
          <input autoFocus className="input h-8 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar en el documento')} />
          <span className="w-20 text-center text-xs text-neutral-600">{searchCount} {t('coincidencias')}</span>
          <input className="input h-8 flex-1" value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={t('Reemplazar por')} />
          <button disabled={!search} className="btn btn-ghost h-8" onClick={() => { setDraft(draft.split(search).join(replacement)); if (!raw) setEditorRevision((value) => value + 1); }}>{t('Reemplazar todo')}</button>
        </div>
      )}
      {showDictation && <StudyDictation
        documentId={active.id}
        language={data.spellcheckLanguage}
        vocabulary={[active.title, ...documents.map((document) => document.title), ...draft.match(/\b[A-ZÁÉÍÓÚÑ][\p{L}-]{3,}\b/gu) ?? []]}
        customDictionary={data.customDictionary}
        onInsert={(text, scope) => {
          if (!raw) {
            milkdownRef.current?.insertText(text, scope === 'selection');
            return;
          }
          const textarea = rawTextareaRef.current;
          const cursor = textarea?.selectionStart ?? draft.length;
          let from = cursor;
          let to = cursor;
          if (scope === 'selection') {
            from = textarea?.selectionStart ?? cursor;
            to = textarea?.selectionEnd ?? cursor;
            if (from === to) {
              from = draft.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
              const nextLine = draft.indexOf('\n', cursor);
              to = nextLine === -1 ? draft.length : nextLine;
            }
          }
          const prefix = from > 0 && !/\s/.test(draft[from - 1]) && !/^[,.;:!?]/.test(text) ? ' ' : '';
          const suffix = to < draft.length && !/\s/.test(draft[to]) && !/[\s\n]$/.test(text) ? ' ' : '';
          setDraft(`${draft.slice(0, from)}${prefix}${text}${suffix}${draft.slice(to)}`);
          window.setTimeout(() => {
            const nextCursor = from + prefix.length + text.length + suffix.length;
            rawTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
            rawTextareaRef.current?.focus();
          });
          return { from: from + prefix.length, to: from + prefix.length + text.length };
        }}
        onAction={(action) => {
          if (action === 'undo') document.execCommand('undo');
          if (action === 'delete_last_sentence') { setDraft(deleteLastStudySentence(draft)); setRaw(true); }
          if (action === 'finish') setShowDictation(false);
        }}
      />}
      {showAudio && <div className="border-b border-neutral-800 bg-neutral-900/30 p-3" data-testid="study-audio-panel"><AudioPanel
        entityKind="study_document"
        entityId={active.id}
        sourceMarkdown={draft}
        selectionText={audioSelection}
        cursorOffset={audioCursor}
        title={title}
        subjectId={subjectId}
        localOnly
        compact
      /></div>}
      {showStyle && (
        <div className="grid grid-cols-2 gap-2 border-b border-neutral-800 bg-neutral-900/40 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8">
          <label className="text-[10px] text-neutral-500">{t('Tipo de material')}<select data-testid="study-doc-kind" className="input mt-1 w-full" value={active.kind} onChange={(event) => void onUpdateMetadata({ kind: event.target.value as StudyDocumentKind })}>{STUDY_DOCUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{t(STUDY_KIND_LABEL[kind])}</option>)}</select></label>
          <label className="text-[10px] text-neutral-500">{t('Color')}<input data-testid="study-doc-color" type="color" className="input mt-1 h-9 w-full p-1" value={active.color || '#0f766e'} onChange={(event) => void onUpdateMetadata({ color: event.target.value })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Tipografía')}<select className="input mt-1 w-full" value={style.fontFamily} onChange={(event) => setStyle({ ...style, fontFamily: event.target.value as StudyDocStyle['fontFamily'] })}><option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Tamaño')}<input type="number" min="12" max="32" className="input mt-1 w-full" value={style.fontSize} onChange={(event) => setStyle({ ...style, fontSize: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Interlineado')}<input type="number" step="0.1" min="1.1" max="2.5" className="input mt-1 w-full" value={style.lineHeight} onChange={(event) => setStyle({ ...style, lineHeight: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Ancho de página')}<input type="number" min="520" max="1400" className="input mt-1 w-full" value={style.pageWidth} onChange={(event) => setStyle({ ...style, pageWidth: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Márgenes')}<input type="number" min="16" max="160" className="input mt-1 w-full" value={style.marginX} onChange={(event) => setStyle({ ...style, marginX: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Sangría')}<input type="number" min="0" max="80" className="input mt-1 w-full" value={style.firstLineIndent} onChange={(event) => setStyle({ ...style, firstLineIndent: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Alineación')}<select className="input mt-1 w-full" value={style.alignment} onChange={(event) => setStyle({ ...style, alignment: event.target.value as StudyDocStyle['alignment'] })}><option value="justify">{t('Justificada')}</option><option value="left">{t('Izquierda')}</option><option value="center">{t('Centro')}</option><option value="right">{t('Derecha')}</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Tema visual')}<select className="input mt-1 w-full" value={style.theme} onChange={(event) => setStyle({ ...style, theme: event.target.value as StudyDocStyle['theme'] })}><option value="paper">{t('Papel')}</option><option value="soft">{t('Suave')}</option><option value="contrast">{t('Contraste')}</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Corrector')}<select className="input mt-1 w-full" value={data.spellcheckLanguage} onChange={(event) => setData({ ...data, spellcheckLanguage: event.target.value })}><option value="es-ES">Español</option><option value="en-US">English</option><option value="fr-FR">Français</option><option value="pt-PT">Português</option></select></label>
          <label className="col-span-2 text-[10px] text-neutral-500">{t('Diccionario personal')}
            <span className="mt-1 flex gap-1"><input className="input min-w-0 flex-1" value={dictionaryWord} onChange={(event) => setDictionaryWord(event.target.value)} placeholder={data.customDictionary.join(', ') || t('Añadir término')} />
              <button className="btn btn-ghost px-2" onClick={() => {
                const word = dictionaryWord.trim();
                if (!word || data.customDictionary.some((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase())) return;
                setData({ ...data, customDictionary: [...data.customDictionary, word] }); setDictionaryWord('');
              }}><Icon name="plus" size={12} /></button></span>
          </label>
          <div className="col-span-2 text-[10px] text-neutral-500 sm:col-span-4 lg:col-span-6">
            <span>{t('Etiquetas')}</span>
            <div className="mt-1 flex min-h-9 flex-wrap items-center gap-1.5">
              {tags.map((tag) => {
                const selected = activeTagIds.includes(tag.id);
                return <button key={tag.id} type="button" className={`rounded-full border px-2 py-1 text-[10px] ${selected ? 'border-indigo-700 bg-indigo-900/40 text-indigo-300' : 'border-neutral-800 text-neutral-600 hover:text-neutral-300'}`}
                  onClick={() => void onSetTags(selected ? activeTagIds.filter((id) => id !== tag.id) : [...activeTagIds, tag.id])}>{tag.name}</button>;
              })}
              <button type="button" className="rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 hover:border-indigo-700 hover:text-indigo-300" onClick={() => setTextDialog({ kind: 'tag' })}>+ {t('Etiqueta')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1" onMouseUp={(event) => showSelectionImproveShortcuts(event)} onKeyUp={() => showSelectionImproveShortcuts()} onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-nodus-study-doc') || event.dataTransfer.types.includes('text/uri-list')) event.preventDefault();
      }} onDrop={(event) => void handleEditorDrop(event)}>
        {!focusMode && <DocOutline markdown={draft} onJump={jumpToHeading} />}
        <div className={`min-w-0 flex-1 overflow-y-auto ${split ? 'grid grid-cols-2 divide-x divide-neutral-800' : ''}`}>
          <div className="min-h-full overflow-y-auto">
            {raw ? (
              <textarea ref={rawTextareaRef} className="h-full min-h-[560px] w-full resize-none bg-white p-6 font-mono text-sm leading-6 text-stone-800 outline-none dark:bg-neutral-950 dark:text-neutral-300"
                spellCheck lang={data.spellcheckLanguage} value={draft} onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const html = event.clipboardData.getData('text/html');
                  if (!html) return;
                  event.preventDefault();
                  const markdown = turndown.turndown(html);
                  const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd;
                  setDraft(`${draft.slice(0, start)}${markdown}${draft.slice(end)}`);
                }} />
            ) : (
              <MilkdownCanvas ref={milkdownRef} key={`${active.id}-${editorRevision}`} documentId={`${active.id}-${editorRevision}`} value={draft}
                spellcheck language={data.spellcheckLanguage} onChange={setDraft} onOpenRecording={onOpenRecording} onToolbarElement={setSelectionToolbar} />
            )}
          </div>
          {split && <div className="min-h-full overflow-y-auto bg-stone-50 p-8 text-stone-900 dark:bg-neutral-900/20 dark:text-neutral-100"><Markdown content={draft} verify={false} onStudyDocument={onOpenLinkedDocument} onStudyRecording={onOpenRecording} /></div>}
        </div>

        {!focusMode && (showHistory || data.annotations.length > 0 || data.backlinks.length > 0) && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/50 p-3">
            {data.annotations.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Comentarios y fragmentos')}</h3>
                <div className="space-y-2">{data.annotations.map((annotation) => (
                  <div key={annotation.id} className={`rounded-lg border p-2.5 ${annotation.resolvedAt ? 'border-neutral-900 opacity-50' : 'border-neutral-800'}`}>
                    {annotation.selectedText && <p className="mb-1 line-clamp-2 border-l-2 border-indigo-600 pl-2 text-[10px] italic text-neutral-500">{annotation.selectedText}</p>}
                    <p className="text-xs leading-5 text-neutral-300">{annotation.comment}</p>
                    <div className="mt-2 flex gap-1">
                      <button className="text-[10px] text-neutral-600 hover:text-indigo-300" onClick={() => void updateAnnotation(annotation, { pinned: !annotation.pinned })}>{annotation.pinned ? t('Desfijar') : t('Fijar')}</button>
                      <button className="text-[10px] text-neutral-600 hover:text-indigo-300" onClick={() => void updateAnnotation(annotation, { locked: !annotation.locked })}>{annotation.locked ? t('Desbloquear') : t('Bloquear')}</button>
                      <button className="ml-auto text-[10px] text-neutral-600 hover:text-emerald-300" onClick={() => void updateAnnotation(annotation, { resolved: !annotation.resolvedAt })}>{annotation.resolvedAt ? t('Reabrir') : t('Resolver')}</button>
                    </div>
                  </div>
                ))}</div>
              </section>
            )}
            {data.backlinks.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Backlinks')}</h3>
                {data.backlinks.map((link) => {
                  const source = documents.find((document) => document.id === link.sourceDocumentId);
                  return <button key={link.id} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-900 hover:text-indigo-300" onClick={() => onOpenLinkedDocument(link.sourceDocumentId)}><Icon name="link" size={11} /><span className="truncate">{source?.title ?? link.sourceDocumentId}</span></button>;
                })}
              </section>
            )}
            {showHistory && (
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Historial de versiones')}</h3>
                {data.versions.length === 0 ? <p className="text-xs text-neutral-600">{t('El historial aparecerá después del primer cambio guardado.')}</p> : data.versions.map((version) => (
                  <div key={version.id} className="mb-2 rounded-lg border border-neutral-800 p-2">
                    <button className="w-full text-left" onClick={() => setSelectedVersion(selectedVersion?.id === version.id ? null : version)}>
                      <span className="block text-xs text-neutral-300">v{version.versionNo} · {t(version.reason)}</span>
                      <span className="text-[10px] text-neutral-600">{new Date(version.createdAt).toLocaleString()}</span>
                    </button>
                    {selectedVersion?.id === version.id && <><div className="mt-2"><VersionDiff version={version} current={draft} /></div><button className="btn btn-ghost mt-2 w-full text-xs" onClick={() => void restoreVersion(version)}>{t('Restaurar esta versión')}</button></>}
                  </div>
                ))}
              </section>
            )}
          </aside>
        )}
        {selectionImprove && selectionToolbar && createPortal(<><div className="divider" data-testid="study-selection-tools-divider" />{quickImproveStyles.map((prompt) => <button type="button" key={prompt.id} data-testid={`study-quick-improve-${prompt.id.replace(':', '-')}`} className="toolbar-item study-selection-tool" title={`${prompt.name} · ${prompt.description}`} aria-label={prompt.name} disabled={Boolean(improveStreamingStyleId)} onPointerDown={(event) => { event.preventDefault(); void runQuickImprovement(prompt, selectionImprove.target); }}><ImproveStyleMark style={prompt} /></button>)}<label className="toolbar-item study-selection-color" title={t('Color del texto')} aria-label={t('Color del texto')}><Icon name="palette" size={16} /><input data-testid="study-selection-text-color" type="color" defaultValue="#0f766e" onInput={(event) => milkdownRef.current?.setTextColor((event.target as HTMLInputElement).value)} /></label><select data-testid="study-selection-heading" className="study-selection-heading" defaultValue="" title={t('Nivel de título')} aria-label={t('Nivel de título')} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => { milkdownRef.current?.setHeading(Number(event.target.value)); event.target.value = ''; }}><option value="" disabled>H</option><option value="0">{t('Párrafo')}</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></>, selectionToolbar)}
      </div>
      {pendingCloseId && <ConfirmModal
        title={t('Cerrar apunte')}
        message={pendingCloseId === active.id && saveState !== 'saved'
          ? t('Se guardarán los cambios pendientes antes de cerrar la pestaña. El apunte seguirá disponible en su ubicación.')
          : t('La pestaña se cerrará, pero el apunte seguirá guardado y disponible en su ubicación.')}
        confirmLabel={t('Cerrar pestaña')}
        onCancel={() => setPendingCloseId(null)}
        onConfirm={() => void confirmClose()}
      />}
      {tableDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6" onClick={() => setTableDialogOpen(false)}>
          <div className="card w-full max-w-sm p-5" role="dialog" aria-modal="true" aria-labelledby="study-table-dialog-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="study-table-dialog-title" className="mb-1 font-semibold">{t('Insertar tabla')}</h2>
            <p className="mb-5 text-sm text-neutral-500">{t('Elige el tamaño inicial. Después podrás editar cada celda.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-neutral-500">{t('Filas')}
                <input autoFocus className="input mt-1 w-full" type="number" min="1" max="20" value={tableRows} onChange={(event) => setTableRows(Number(event.target.value))} />
              </label>
              <label className="text-xs text-neutral-500">{t('Columnas')}
                <input className="input mt-1 w-full" type="number" min="1" max="12" value={tableColumns} onChange={(event) => setTableColumns(Number(event.target.value))} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setTableDialogOpen(false)}>{t('Cancelar')}</button>
              <button className="btn btn-primary" onClick={insertTable}><Icon name="table" size={13} /> {t('Insertar')}</button>
            </div>
          </div>
        </div>
      )}
      {textDialog && (
        <TextInputModal
          testId={`study-${textDialog.kind}-dialog`}
          title={textDialog.kind === 'tag'
            ? t('Nueva etiqueta')
            : textDialog.selectedText ? t('Comentario sobre la selección') : t('Comentario del documento')}
          label={textDialog.kind === 'tag' ? t('Nombre de la etiqueta') : t('Comentario')}
          multiline={textDialog.kind === 'comment'}
          onSubmit={submitTextDialog}
          onCancel={() => setTextDialog(null)}
        />
      )}
      {showImprovePrompts && <StudyImproveDialog onClose={() => setShowImprovePrompts(false)} onToolbarChanged={setQuickImproveStyles} />}
    </div>
  );
}
