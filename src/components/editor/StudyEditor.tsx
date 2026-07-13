import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
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
import { Markdown } from '../Markdown';
import { Icon, Spinner } from '../ui';
import { t } from '../../i18n';
import { DocOutline } from './DocOutline';
import { StudyDictation } from './StudyDictation';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const STUDY_KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

interface MilkdownCanvasHandle {
  insertText: (text: string, replaceSelection: boolean) => void;
}

const MilkdownCanvas = forwardRef<MilkdownCanvasHandle, {
  documentId: string;
  value: string;
  spellcheck: boolean;
  language: string;
  onChange: (markdown: string) => void;
}>(({ documentId, value, spellcheck, language, onChange }, ref) => {
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
    void crepe.create().then(() => {
      if (disposed) return;
      const editable = root.querySelector('[contenteditable="true"]');
      editable?.setAttribute('spellcheck', spellcheck ? 'true' : 'false');
      editable?.setAttribute('lang', language);
      editable?.setAttribute('aria-label', t('Editor del apunte'));
    });
    return () => { disposed = true; crepeRef.current = null; void crepe.destroy(); };
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
  }), []);

  return <div ref={rootRef} className="study-milkdown min-h-full" />;
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
}: {
  documents: StudyDocument[];
  tags: StudyTag[];
  activeTagIds: string[];
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
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [dictionaryWord, setDictionaryWord] = useState('');
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

  useEffect(() => {
    if (!active) return;
    setTitle(active.title);
    setDraft(active.contentMarkdown);
    baselineRef.current = JSON.stringify({ title: active.title, content: active.contentMarkdown, style: DEFAULT_STUDY_DOC_STYLE, language: 'es-ES', dictionary: [] });
    setSaveState('saved');
    setSelectedVersion(null);
    setEditorRevision((value) => value + 1);
    void loadData(active.id).then((next) => {
      baselineRef.current = JSON.stringify({ title: active.title, content: active.contentMarkdown, style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
    });
  }, [active?.id, loadData]);

  const currentSignature = JSON.stringify({ title, content: draft, style, language: data?.spellcheckLanguage, dictionary: data?.customDictionary });
  useEffect(() => {
    if (!active || !data || currentSignature === baselineRef.current) return;
    setSaveState('dirty');
    const timer = window.setTimeout(() => void save('autosave'), 1400);
    return () => window.clearTimeout(timer);
  }, [currentSignature, active?.id, data != null]);

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

  const insertCommand = (command: StudyEditorCommand) => {
    const separator = draft && !draft.endsWith('\n') ? '\n\n' : '';
    setDraft(`${draft}${separator}${studyCommandMarkdown(command)}`);
    setRaw(true);
    setSaveState('dirty');
  };
  const jumpToHeading = (_item: StudyOutlineItem, index: number) => {
    const heading = document.querySelectorAll('.study-milkdown .ProseMirror h1, .study-milkdown .ProseMirror h2, .study-milkdown .ProseMirror h3, .study-milkdown .ProseMirror h4, .study-milkdown .ProseMirror h5, .study-milkdown .ProseMirror h6')[index];
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const addComment = async () => {
    const selectedText = window.getSelection()?.toString().trim() ?? '';
    const comment = window.prompt(selectedText ? t('Comentario sobre la selección') : t('Comentario del documento'));
    if (!comment) return;
    const from = selectedText ? Math.max(0, draft.indexOf(selectedText)) : 0;
    await window.nodus.createStudyAnnotation(active.id, { from, to: from + selectedText.length, selectedText, comment });
    await loadData(active.id);
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
    if (snippet) setDraft((current) => `${current}${current.endsWith('\n') || !current ? '' : '\n\n'}${snippet}\n`);
  };

  return (
    <div style={styleVars} className={`study-editor-shell flex h-full min-h-0 flex-col bg-neutral-950 ${fullscreen ? 'fixed inset-0 z-[100]' : ''} study-theme-${style.theme}`}>
      <div className="flex min-h-10 items-end gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-950 px-2 pt-1">
        {documents.map((document) => (
          <button key={document.id} onClick={() => onActivate(document.id)}
            className={`group flex max-w-52 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs ${document.id === active.id ? 'border-neutral-700 bg-neutral-900 text-neutral-200' : 'border-transparent text-neutral-600 hover:text-neutral-300'}`}>
            <Icon name="notebook" size={12} /><span className="truncate">{document.title}</span>
            <span onClick={(event) => { event.stopPropagation(); onClose(document.id); }} className="text-neutral-700 group-hover:text-neutral-400"><Icon name="x" size={11} /></span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <button className="btn btn-ghost px-2" title={t('Cerrar editor')} onClick={() => onClose(active.id)}><Icon name="arrowLeft" /></button>
        <input className="input min-w-44 flex-1 border-0 bg-transparent text-base font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} />
        <span className={`mr-2 text-[10px] ${saveState === 'error' ? 'text-red-400' : saveState === 'saved' ? 'text-emerald-500' : 'text-amber-400'}`}>
          {t(saveState === 'saved' ? 'Guardado' : saveState === 'saving' ? 'Guardando…' : saveState === 'dirty' ? 'Cambios sin guardar' : 'Error al guardar')}
        </span>
        <button data-testid="study-doc-favorite" className="btn btn-ghost h-8 px-2" title={t('Favorito')} onClick={() => void onUpdateMetadata({ favorite: !active.favorite })}>
          <Icon name="star" size={13} className={active.favorite ? 'text-amber-400' : ''} />
        </button>
        <button className="btn btn-primary h-8 px-2" onClick={() => void save('manual')}><Icon name="save" size={13} /> {t('Guardar')}</button>
        <button className={`btn btn-ghost h-8 px-2 ${raw ? 'bg-indigo-900/50 text-indigo-300' : ''}`} onClick={() => {
          if (raw) setEditorRevision((value) => value + 1); setRaw(!raw);
        }}><Icon name="code" size={13} /> {t('Markdown crudo')}</button>
        <button className={`btn btn-ghost h-8 px-2 ${split ? 'bg-indigo-900/50 text-indigo-300' : ''}`} onClick={() => setSplit(!split)}><Icon name="columns" size={13} /> {t('Dividir')}</button>
        <button className="btn btn-ghost h-8 px-2" onClick={() => setShowSearch(!showSearch)}><Icon name="search" size={13} /></button>
        <button className="btn btn-ghost h-8 px-2" onClick={() => void addComment()} title={t('Añadir comentario')}><Icon name="chat" size={13} /></button>
        <button data-testid="study-dictation-toggle" className={`btn btn-ghost h-8 px-2 ${showDictation ? 'bg-indigo-900/50 text-indigo-300' : ''}`} onClick={() => setShowDictation(!showDictation)} title={t('Dictado por voz')}><Icon name="microphone" size={13} /></button>
        <button data-testid="study-doc-style" className={`btn btn-ghost h-8 px-2 ${showStyle ? 'bg-indigo-900/50' : ''}`} title={t('Apariencia y metadatos')} onClick={() => setShowStyle(!showStyle)}><Icon name="palette" size={13} /></button>
        <button className={`btn btn-ghost h-8 px-2 ${showHistory ? 'bg-indigo-900/50' : ''}`} onClick={() => setShowHistory(!showHistory)}><Icon name="clock" size={13} /></button>
        <button className={`btn btn-ghost h-8 px-2 ${focusMode ? 'bg-indigo-900/50' : ''}`} onClick={() => setFocusMode(!focusMode)} title={t('Modo concentración')}><Icon name="eye" size={13} /></button>
        <button className="btn btn-ghost h-8 px-2" onClick={() => setFullscreen(!fullscreen)} title={t('Pantalla completa')}><Icon name="fit" size={13} /></button>
        <button className="btn btn-ghost h-8 px-2" onClick={() => window.print()} title={t('Vista previa de impresión')}><Icon name="external" size={13} /></button>
        <button className="btn btn-ghost h-8 px-2" onClick={() => void onDuplicate()} title={t('Duplicar')}><Icon name="copy" size={13} /></button>
        <button className="btn btn-ghost h-8 px-2 text-red-400" onClick={() => {
          if (window.confirm(t('¿Mover este material a la papelera?'))) void onTrash();
        }} title={t('Mover a la papelera')}><Icon name="trash" size={13} /></button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-800 px-3 py-1.5">
        {(['titulo', 'subtitulo', 'tabla', 'cita', 'imagen', 'audio', 'test', 'academico'] as StudyEditorCommand[]).map((command) => (
          <button key={command} className="rounded px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" onClick={() => insertCommand(command)}>/{command}</button>
        ))}
        <span className="ml-auto py-1 text-[10px] text-neutral-600">{stats.words} {t('palabras')} · {stats.characters} {t('caracteres')} · {stats.paragraphs} {t('párrafos')} · {stats.readingMinutes} min</span>
      </div>

      {showSearch && (
        <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/50 px-3 py-2">
          <input autoFocus className="input h-8 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar en el documento')} />
          <span className="w-20 text-center text-xs text-neutral-600">{searchCount} {t('coincidencias')}</span>
          <input className="input h-8 flex-1" value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={t('Reemplazar por')} />
          <button disabled={!search} className="btn btn-ghost h-8" onClick={() => setDraft(draft.split(search).join(replacement))}>{t('Reemplazar todo')}</button>
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
              <button type="button" className="rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 hover:border-indigo-700 hover:text-indigo-300" onClick={() => {
                const name = window.prompt(t('Nueva etiqueta'));
                if (name?.trim()) void onCreateTag(name.trim());
              }}>+ {t('Etiqueta')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1" onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-nodus-study-doc') || event.dataTransfer.types.includes('text/uri-list')) event.preventDefault();
      }} onDrop={(event) => void handleEditorDrop(event)}>
        {!focusMode && <DocOutline markdown={draft} onJump={jumpToHeading} />}
        <div className={`min-w-0 flex-1 overflow-y-auto ${split ? 'grid grid-cols-2 divide-x divide-neutral-800' : ''}`}>
          <div className="min-h-full overflow-y-auto">
            {raw ? (
              <textarea ref={rawTextareaRef} className="h-full min-h-[560px] w-full resize-none bg-neutral-950 p-6 font-mono text-sm leading-6 text-neutral-300 outline-none"
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
                spellcheck language={data.spellcheckLanguage} onChange={setDraft} />
            )}
          </div>
          {split && <div className="min-h-full overflow-y-auto bg-neutral-900/20 p-8"><Markdown content={draft} verify={false} onStudyDocument={onOpenLinkedDocument} /></div>}
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
      </div>
    </div>
  );
}
