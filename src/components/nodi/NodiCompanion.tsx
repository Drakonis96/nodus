import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AppSettings, ModelRef, NodiChatMessage, NodiContextKind, NodiConversation, NodiNote, NodiNotification, NodiOverlayPlacement, VaultType } from '@shared/types';
import { vaultTypeColor } from '@shared/vaultTypes';
import { type NodiRole, type NodiState } from './Nodi';
import { NodiAvatar } from './NodiAvatar';
import { Markdown } from '../Markdown';
import { ModelPicker } from '../ModelPicker';
import { Icon } from '../ui';
import { errorText, setActiveLang, t, tr, tx } from '../../i18n';
import './companion.css';

/** Nodi wears a subtle accessory that reflects the active vault's mode. */
function roleForVault(type: VaultType | null): NodiRole {
  switch (type) {
    case 'genealogy':
      return 'genealogy';
    case 'databases':
      return 'study';
    case 'primary_sources':
      return 'study';
    default:
      return 'academic';
  }
}

type Ctx = 'app' | 'overlay';

function IconHelp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.6-2 2-2 3" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v11H8l-4 3z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}
function IconOpen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l16-7-7 16-2.5-6.5L4 12z" />
    </svg>
  );
}
function IconNotes() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 16.5h4" />
    </svg>
  );
}

/** A quick note's title is its first meaningful line, stripped of Markdown markers.
 *  Derived live from the draft so the header updates as you type. */
function deriveNoteTitle(content: string): string {
  for (const raw of content.split('\n')) {
    const line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+>]\s+/, '')
      .replace(/[*_`~]/g, '')
      .trim();
    if (line) return line.slice(0, 80);
  }
  return '';
}

/** A one-line preview of everything after the title line, for the notes list. */
function noteSnippet(content: string): string {
  const rest: string[] = [];
  let started = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!started) {
      if (line) started = true;
      continue;
    }
    if (line) rest.push(line.replace(/^\s{0,3}[-*+>]\s+/, '').replace(/[*_`~#]/g, ''));
  }
  return rest.join(' ').trim().slice(0, 140);
}

function relTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('ahora');
  const m = Math.round(s / 60);
  if (m < 60) return tx('hace {n} min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tx('hace {n} h', { n: h });
  return tx('hace {n} d', { n: Math.round(h / 24) });
}

const DOT: Record<NodiNotification['kind'], string> = { info: '#5b9bd5', success: '#3bb273', warning: '#e0a53b' };
// Four overlay actions collapse over 340 ms with up to 90 ms of stagger.
// Keep the roomy native window until every button has returned to its anchor.
const RADIAL_COLLAPSE_MS = 450;
// Each control is 46px wide. Keeping the centres 58px apart leaves a deliberate
// 12px breathing space even after adding a fifth overlay action.
const RADIAL_NODE_GAP_PX = 58;
// Stay inside the original 180°–268° quadrant so every action opens away from the
// nearest screen edges, including the first and last controls.
const RADIAL_MAX_SPAN_DEG = 88;
// Normal clicks commonly move a few pixels between press and release. Keeping a
// comfortable dead zone prevents those tiny movements from swallowing the click.
const DRAG_THRESHOLD_PX = 7;

export function NodiCompanion({ context, costumes }: { context: Ctx; costumes?: boolean }) {
  const isOverlay = context === 'overlay';
  const figureH = isOverlay ? 200 : 168;
  const figureW = Math.round((figureH * 270) / 300);
  const anchorR = Math.round(figureW * 0.52);
  const anchorB = Math.round(figureH * 0.533);
  const R = isOverlay ? 104 : 92;

  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'none' | 'notifications' | 'chat' | 'notes'>('none');
  const [helpOpen, setHelpOpen] = useState(false);
  const [ntfs, setNtfs] = useState<NodiNotification[]>([]);
  const unread = ntfs.reduce((n, x) => n + (x.read ? 0 : 1), 0);

  const [messages, setMessages] = useState<NodiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [contexts, setContexts] = useState<NodiContextKind[]>(['documentation', 'current_view']);
  const [conversations, setConversations] = useState<NodiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatTool, setChatTool] = useState<'none' | 'history' | 'contexts' | 'settings'>('none');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [nodiModel, setNodiModel] = useState<ModelRef | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ kind: 'conversation'; conversation: NodiConversation } | { kind: 'all' } | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const hasOpenSurface = menuOpen || helpOpen || panel !== 'none' || contextMenuOpen || closing;

  // ── Quick notes ────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<NodiNote[]>([]);
  const [noteView, setNoteView] = useState<'list' | 'editor'>('list');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [notePreview, setNotePreview] = useState(false);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<NodiNote | null>(null);
  const noteEditorRef = useRef<HTMLTextAreaElement | null>(null);
  // Mirror the in-flight note so the leave-editor flush reads live values without a
  // stale closure (a lesson from the study-vault useMemo bug: closures over editor
  // state go stale between renders).
  const noteRef = useRef({ id: activeNoteId, draft: noteDraft, dirty: noteDirty });
  noteRef.current = { id: activeNoteId, draft: noteDraft, dirty: noteDirty };

  // Resolve the app theme locally so the independent always-on-top renderer receives
  // the same surface treatment as in-window Nodi.
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const lightUi = settings ? settings.theme === 'light' || (settings.theme === 'system' && !systemDark) : false;

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [overlayPlacement, setOverlayPlacement] = useState<NodiOverlayPlacement>(() => (
    isOverlay
      ? window.nodus.nodiGetOverlayPlacement()
      : { x: 16, y: 16, horizontal: 'left', vertical: 'up' }
  ));
  const [dragging, setDragging] = useState(false);
  const [greet, setGreet] = useState(false);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const dragOriginRef = useRef<{ screenX: number; screenY: number; x: number; y: number } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const greetTimer = useRef<number | null>(null);
  const wave = () => {
    setGreet(true);
    if (greetTimer.current) window.clearTimeout(greetTimer.current);
    greetTimer.current = window.setTimeout(() => setGreet(false), 1300);
  };

  const [vaultType, setVaultType] = useState<VaultType | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const latestNotificationId = useRef<string | null>(null);
  const notificationsReady = useRef(false);
  // Costumes come from the parent (app) when provided, otherwise fetched (overlay).
  const [fetchedCostumes, setFetchedCostumes] = useState(true);
  const costumesEnabled = costumes ?? fetchedCostumes;
  const role = costumesEnabled ? roleForVault(vaultType) : 'none';

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const apply = (next: AppSettings) => {
      setSettings(next);
      setNodiModel(next.nodiModel ?? next.synthesisModel ?? null);
      setActiveLang(next.uiLanguage);
      if (costumes === undefined) setFetchedCostumes(next.mascotVaultCostumes);
    };
    window.nodus.getSettings().then(apply).catch(() => {});
    return window.nodus.onSettingsChanged(apply);
  }, [costumes]);

  const refreshConversations = useCallback(() => {
    void window.nodus.listNodiConversations().then(setConversations).catch(() => {});
  }, []);
  useEffect(() => { refreshConversations(); }, [refreshConversations]);

  // ── Notes: load when the panel opens, persist on save / on leaving the editor ─
  const refreshNotes = useCallback(() => {
    void window.nodus.listNodiNotes().then(setNotes).catch(() => {});
  }, []);
  useEffect(() => { if (panel === 'notes') refreshNotes(); }, [panel, refreshNotes]);

  const persistNote = useCallback(async (id: string | null, draft: string) => {
    try {
      const saved = await window.nodus.saveNodiNote({ id, content: draft });
      setNotes((cur) => [saved, ...cur.filter((n) => n.id !== saved.id)]);
      // A save may finish after the user has opened another note or continued
      // typing. Only mark the editor clean when it still shows this exact snapshot.
      const current = noteRef.current;
      if (current.id === id && current.draft === draft) {
        noteRef.current = { id: saved.id, draft, dirty: false };
        setActiveNoteId(saved.id);
        setNoteDirty(false);
      }
      return saved;
    } catch {
      const current = noteRef.current;
      if (current.id === id && current.draft === draft) {
        noteRef.current = { ...current, dirty: true };
        setNoteDirty(true);
      }
      return null;
    }
  }, []);

  // Fire-and-forget save used when the editor is left by any route (panel closed,
  // switched, vault change, overlay dismissed). Mark the snapshot clean before the
  // IPC call so opening another note cannot enqueue the same save twice.
  const flushNote = useCallback(() => {
    const { id, draft, dirty } = noteRef.current;
    if (!dirty || !draft.trim()) return;
    noteRef.current = { id, draft, dirty: false };
    setNoteDirty(false);
    void persistNote(id, draft);
  }, [persistNote]);
  const leftEditor = panel !== 'notes' || noteView !== 'editor';
  useEffect(() => { if (leftEditor) flushNote(); }, [leftEditor, flushNote]);

  const saveNote = useCallback(async () => {
    const { id, draft, dirty } = noteRef.current;
    if (!dirty || !draft.trim()) return;
    noteRef.current = { id, draft, dirty: false };
    setNoteDirty(false);
    await persistNote(id, draft);
  }, [persistNote]);

  const openNoteEditor = (note: NodiNote | null) => {
    flushNote();
    setActiveNoteId(note?.id ?? null);
    setNoteDraft(note?.content ?? '');
    setNoteDirty(false);
    setNotePreview(false);
    setNoteView('editor');
  };
  const backToNotes = () => { setNoteView('list'); setNotePreview(false); };
  const openNotes = () => {
    setPanel((p) => (p === 'notes' ? 'none' : 'notes'));
    setHelpOpen(false);
    setNoteView('list');
    setNoteSearch('');
    setNotePreview(false);
  };

  const confirmDeleteNote = async () => {
    if (!deleteNoteTarget) return;
    const id = deleteNoteTarget.id;
    const deleted = await window.nodus.deleteNodiNote(id).then(() => true).catch(() => false);
    if (!deleted) return;
    setNotes((cur) => cur.filter((n) => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
      setNoteDraft('');
      setNoteDirty(false);
      setNoteView('list');
    }
    setDeleteNoteTarget(null);
  };

  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }, [notes, noteSearch]);

  // Markdown formatting acting on the textarea's current selection.
  const wrapSelection = (marker: string) => {
    const ta = noteEditorRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const next = value.slice(0, s) + marker + value.slice(s, e) + marker + value.slice(e);
    setNoteDraft(next);
    setNoteDirty(true);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + marker.length, e + marker.length);
    });
  };
  const prefixLines = (prefix: string) => {
    const ta = noteEditorRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const head = value.slice(0, lineStart);
    const block = value.slice(lineStart, e);
    const prefixed = block.split('\n').map((ln) => (ln.startsWith(prefix) ? ln : prefix + ln)).join('\n');
    const next = head + prefixed + value.slice(e);
    setNoteDraft(next);
    setNoteDirty(true);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(lineStart, head.length + prefixed.length);
    });
  };
  const insertLink = () => {
    const ta = noteEditorRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    const snippet = `[${sel}](url)`;
    setNoteDraft(value.slice(0, s) + snippet + value.slice(e));
    setNoteDirty(true);
    requestAnimationFrame(() => {
      ta.focus();
      const urlStart = s + sel.length + 3; // past "[sel]("
      ta.setSelectionRange(urlStart, urlStart + 3);
    });
  };
  const noteFormats: Array<{ id: string; icon: string; label: string; run: () => void }> = [
    { id: 'bold', icon: 'bold', label: t('Negrita'), run: () => wrapSelection('**') },
    { id: 'italic', icon: 'italic', label: t('Cursiva'), run: () => wrapSelection('*') },
    { id: 'strike', icon: 'strikethrough', label: t('Tachado'), run: () => wrapSelection('~~') },
    { id: 'head', icon: 'heading', label: t('Encabezado'), run: () => prefixLines('## ') },
    { id: 'list', icon: 'list', label: t('Lista'), run: () => prefixLines('- ') },
    { id: 'quote', icon: 'quote', label: t('Cita'), run: () => prefixLines('> ') },
    { id: 'code', icon: 'code', label: t('Código'), run: () => wrapSelection('`') },
    { id: 'link', icon: 'link', label: t('Enlace'), run: insertLink },
  ];

  // ── Notifications: load + live updates ────────────────────────────────────
  useEffect(() => {
    window.nodus.listNotifications().then((next) => {
      latestNotificationId.current = next[0]?.id ?? null;
      notificationsReady.current = true;
      setNtfs(next);
    }).catch(() => {});
    return window.nodus.onNotificationsChanged((next) => {
      const latest = next[0];
      if (latest && !latest.read && notificationsReady.current && latest.id !== latestNotificationId.current) {
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), 1500);
      }
      latestNotificationId.current = latest?.id ?? null;
      setNtfs(next);
    });
  }, []);

  // ── Active vault: drives Nodi's per-vault accessory + a little "poof" when it
  //    changes ────────────────────────────────────────────────────────────────
  const lastVault = useRef<VaultType | null | undefined>(undefined);
  useEffect(() => {
    const apply = (type: VaultType | null, animate: boolean) => {
      if (animate && lastVault.current !== undefined && lastVault.current !== type) {
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), 1500);
      }
      lastVault.current = type;
      setVaultType(type);
    };
    window.nodus.getActiveVault().then((v) => apply(v?.type ?? null, false)).catch(() => {});
    return window.nodus.onVaultChanged((v) => apply(v?.type ?? null, true));
  }, []);

  // ── App position: anchor bottom-right, keep inside the viewport ────────────
  const clamp = useCallback(
    (x: number, y: number) => {
      const maxX = Math.max(8, window.innerWidth - figureW - 8);
      const maxY = Math.max(8, window.innerHeight - figureH - 8);
      return { x: Math.min(maxX, Math.max(8, x)), y: Math.min(maxY, Math.max(8, y)) };
    },
    [figureW, figureH]
  );
  // Nodi is anchored by its distance from the bottom-right corner, so resizing or
  // maximizing the window moves it to the new corner (and a manual drag just changes
  // that offset, keeping Nodi where it was dropped relative to the corner).
  const offsetRef = useRef({ right: 20, bottom: 20 });
  useEffect(() => {
    if (isOverlay) return;
    const place = () =>
      setPos(
        clamp(
          window.innerWidth - figureW - offsetRef.current.right,
          window.innerHeight - figureH - offsetRef.current.bottom
        )
      );
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOverlay, clamp, figureW, figureH]);

  // ── Overlay: switch full-host interactivity around open surfaces ────────────
  useEffect(() => {
    if (!isOverlay) return;
    let releasePassthrough: number | undefined;
    if (hasOpenSurface) {
      // The host already has its full, stable bounds; make all controls interactive.
      void window.nodus.nodiSetExpanded(true).then(setOverlayPlacement).catch(() => {});
    } else {
      // Keep the host interactive while the radial buttons fly home, then restore
      // transparent-area passthrough. Reopening clears this pending hand-off.
      releasePassthrough = window.setTimeout(() => {
        void window.nodus.nodiSetExpanded(false).then(setOverlayPlacement).catch(() => {});
      }, RADIAL_COLLAPSE_MS);
    }
    return () => {
      window.clearTimeout(releasePassthrough);
    };
  }, [hasOpenSurface, isOverlay]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (panel === 'chat' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, panel]);

  const closeAll = useCallback(() => {
    setMenuOpen(false);
    setPanel('none');
    setHelpOpen(false);
    setContextMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!isOverlay) return;
    return window.nodus.onNodiDismiss(closeAll);
  }, [closeAll, isOverlay]);

  // The native overlay keeps its full bounds so macOS never stretches a compact
  // backing surface while the radial menu opens. When no surface is open, make the
  // transparent area click-through and reactivate only the figure itself. The
  // preload uses synchronous IPC for this one mouse hit-test transition, preventing
  // a fast first click from racing ahead of BrowserWindow.setIgnoreMouseEvents().
  useEffect(() => {
    if (!isOverlay) return;
    let lastIgnore: boolean | null = null;
    const setIgnore = (ignore: boolean) => {
      if (lastIgnore === ignore) return;
      lastIgnore = ignore;
      void window.nodus.nodiSetMouseIgnore(ignore).catch(() => {});
    };
    const onMove = (event: MouseEvent) => {
      if (hasOpenSurface || dragging) {
        setIgnore(false);
        return;
      }
      const figure = document.querySelector<HTMLElement>('.nodi-figure');
      if (!figure) return;
      const rect = figure.getBoundingClientRect();
      const overFigure = event.clientX >= rect.left
        && event.clientX < rect.right
        && event.clientY >= rect.top
        && event.clientY < rect.bottom;
      setIgnore(!overFigure);
    };
    if (hasOpenSurface || dragging) setIgnore(false);
    document.addEventListener('mousemove', onMove, true);
    return () => document.removeEventListener('mousemove', onMove, true);
  }, [dragging, hasOpenSurface, isOverlay]);

  // Click anywhere outside Nodi or its controls closes the menu/panels/bubble.
  useEffect(() => {
    if (!menuOpen && !helpOpen && panel === 'none' && !contextMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-nodi-interactive]')) return;
      setMenuOpen(false);
      setPanel('none');
      setHelpOpen(false);
      setContextMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menuOpen, helpOpen, panel, contextMenuOpen]);

  const onFigurePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || closing) return;
    movedRef.current = false;
    draggingRef.current = false;
    dragOriginRef.current = { screenX: e.screenX, screenY: e.screenY, x: pos?.x ?? 0, y: pos?.y ?? 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (isOverlay) {
      void window.nodus.nodiBeginWindowDrag(e.screenX, e.screenY).then(setOverlayPlacement).catch(() => {});
    }
  };
  const onFigurePointerMove = (e: React.PointerEvent) => {
    const origin = dragOriginRef.current;
    // The ref is set synchronously on pointer-down; React state may not have
    // committed yet when a fast pointer emits its first movement events.
    if (!origin || closing) return;
    const dx = e.screenX - origin.screenX;
    const dy = e.screenY - origin.screenY;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      movedRef.current = true;
      draggingRef.current = true;
      // A press is still a click until it clears the drag threshold. Applying the
      // dragging visuals on pointer-down interrupts both mascots' idle animation
      // for a single click, which reads as a flash and a small vertical jump.
      setDragging(true);
      if (isOverlay) {
        void window.nodus.nodiDragWindow(e.screenX, e.screenY).then(setOverlayPlacement).catch(() => {});
      }
      else
        setPos(() => {
          const np = clamp(origin.x + dx, origin.y + dy);
          offsetRef.current = {
            right: Math.max(0, window.innerWidth - (np.x + figureW)),
            bottom: Math.max(0, window.innerHeight - (np.y + figureH)),
          };
          return np;
        });
    }
  };
  const finishFigurePointer = (e: React.PointerEvent, cancelled = false) => {
    // Only a primary press starts a gesture, so only its release can be a click.
    // A right-click release must not reach the toggle below: it fires after
    // `contextmenu` and would swap the context menu for the radial one.
    if (!dragOriginRef.current) return;
    const figure = e.currentTarget as HTMLElement;
    if (figure.hasPointerCapture(e.pointerId)) figure.releasePointerCapture(e.pointerId);
    setDragging(false);
    draggingRef.current = false;
    dragOriginRef.current = null;
    if (isOverlay) void window.nodus.nodiEndWindowDrag().catch(() => {});
    if (!cancelled && !movedRef.current && !closing) {
      // A click (not a drag): toggle the menu (closing also dismisses panels/bubble).
      if (menuOpen) closeAll();
      else {
        setContextMenuOpen(false);
        setMenuOpen(true);
        // The classic character has an actual arm gesture. The orb's "wave" replaces
        // its continuous float with a side-to-side rocking animation; ending it snaps
        // the whole sphere back to 0°, which looks like a flash on menu close and like
        // a rebound when the orb is resting against a screen edge.
        if (settings?.mascotStyle !== 'orb') wave();
      }
    }
  };

  const onFigurePointerCaptureLost = () => {
    if (!dragOriginRef.current) return;
    setDragging(false);
    draggingRef.current = false;
    dragOriginRef.current = null;
    movedRef.current = false;
    if (isOverlay) void window.nodus.nodiEndWindowDrag().catch(() => {});
  };

  const onFigureContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (closing) return;
    setMenuOpen(false);
    setPanel('none');
    setHelpOpen(false);
    setContextMenuOpen(true);
  };

  const closeMascot = () => {
    if (closing) return;
    if (streaming) void window.nodus.cancelNodiChat().catch(() => {});
    closeAll();
    setClosing(true);
    setDragging(false);
    dragOriginRef.current = null;
    if (isOverlay) void window.nodus.nodiEndWindowDrag().catch(() => {});
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      void window.nodus.updateSettings({ mascotEnabled: false }).catch(() => setClosing(false));
    }, settings?.reduceMotion ? 350 : 2200);
  };

  const openNotifications = () => {
    setPanel((p) => (p === 'notifications' ? 'none' : 'notifications'));
    setHelpOpen(false);
    if (panel !== 'notifications' && unread > 0) window.nodus.markNotificationsRead().then(setNtfs).catch(() => {});
  };

  const nodiState: NodiState = closing ? 'closing' : streaming ? 'thinking' : greet ? 'waving' : celebrate ? 'discovering' : 'idle';
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  type Item = { id: string; label: string; icon: React.ReactNode; onClick: () => void; badge?: number };
  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: 'help', label: t('¿Quién soy?'), icon: <IconHelp />, onClick: () => { setHelpOpen((v) => !v); setPanel('none'); } },
      { id: 'ntf', label: t('Notificaciones'), icon: <IconBell />, onClick: openNotifications, badge: unread },
      { id: 'chat', label: t('Chat'), icon: <IconChat />, onClick: () => { setPanel((p) => (p === 'chat' ? 'none' : 'chat')); setHelpOpen(false); } },
      { id: 'notes', label: t('Notas rápidas'), icon: <IconNotes />, onClick: openNotes },
    ];
    if (isOverlay) base.push({ id: 'open', label: t('Abrir Nodus'), icon: <IconOpen />, onClick: () => window.nodus.nodiOpenMainWindow() });
    return base;
  }, [isOverlay, unread, panel, settings?.uiLanguage]);

  const newChat = () => {
    if (streaming) return;
    setActiveConversationId(null);
    setMessages([]);
    setInput('');
    setChatTool('none');
  };

  const openConversation = (conversation: NodiConversation) => {
    if (streaming) return;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setContexts(conversation.contexts);
    setNodiModel(conversation.model ?? settings?.nodiModel ?? settings?.synthesisModel ?? null);
    setChatTool('none');
  };

  const confirmDeleteConversations = async () => {
    if (!deleteConfirmation || streaming) return;
    if (deleteConfirmation.kind === 'all') {
      await window.nodus.clearNodiConversations();
      setConversations([]); setActiveConversationId(null); setMessages([]); setInput('');
    } else {
      const id = deleteConfirmation.conversation.id;
      await window.nodus.deleteNodiConversation(id);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      if (activeConversationId === id) { setActiveConversationId(null); setMessages([]); setInput(''); }
    }
    setDeleteConfirmation(null);
  };

  const toggleContext = (kind: NodiContextKind) => {
    setContexts((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  };

  const changeNodiModel = (model: ModelRef | null) => {
    setNodiModel(model);
    void window.nodus.updateSettings({ nodiModel: model });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: NodiChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    let conversationId = activeConversationId;
    let assistantText = '';
    try {
      const saved = await window.nodus.saveNodiConversation({
        id: conversationId,
        title: next.find((message) => message.role === 'user')?.content.slice(0, 72),
        messages: next,
        contexts,
        model: nodiModel,
      });
      conversationId = saved.id;
      setActiveConversationId(saved.id);
      const currentView = contexts.includes('current_view') ? await window.nodus.getNodiViewContext() : null;
      const answer = await window.nodus.nodiChatStream(
        { messages: next, contexts, model: nodiModel, currentView },
        {
          onDelta: (delta) => {
            assistantText += delta;
            setMessages([...next, { role: 'assistant', content: assistantText }]);
          },
        }
      );
      assistantText = answer || assistantText;
    } catch (err) {
      assistantText ||= `⚠️ ${err instanceof Error ? errorText(err) : t('No se pudo responder.')}`;
    } finally {
      const finalMessages: NodiChatMessage[] = [...next, { role: 'assistant', content: assistantText }];
      setMessages(finalMessages);
      if (conversationId) {
        await window.nodus.saveNodiConversation({ id: conversationId, messages: finalMessages, contexts, model: nodiModel }).catch(() => undefined);
      }
      refreshConversations();
      setStreaming(false);
    }
  };

  const rootPositionStyle: CSSProperties = isOverlay
    ? { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }
    : pos
      ? { position: 'fixed', left: pos.x, top: pos.y, width: figureW, height: figureH, pointerEvents: 'none', zIndex: 45 }
      : { display: 'none' };
  const rootStyle = {
    ...rootPositionStyle,
    // The vault registry is the same colour source used by the app shell, switcher,
    // dock icon and orb. Keeping it on the root lets every Nodi surface inherit it.
    ['--nodi-vault-accent' as string]: vaultTypeColor(vaultType),
  } as CSSProperties;

  const anchorStyle: CSSProperties = isOverlay
    ? {
        // Preserve Nodi's screen-edge relationship while the stable native host is
        // dragged between quadrants. The host itself never resizes when controls open.
        ...(overlayPlacement.horizontal === 'left'
          ? { right: Math.max(0, window.innerWidth - overlayPlacement.x - figureW) }
          : { left: overlayPlacement.x }),
        ...(overlayPlacement.vertical === 'up'
          ? { bottom: Math.max(0, window.innerHeight - overlayPlacement.y - figureH) }
          : { top: overlayPlacement.y }),
        width: figureW,
        height: figureH,
      }
    : { inset: 0 };

  const horizontal = isOverlay
    ? overlayPlacement.horizontal
    : pos && pos.x + figureW / 2 < window.innerWidth / 2 ? 'right' : 'left';
  const vertical = isOverlay
    ? overlayPlacement.vertical
    : pos && pos.y + figureH / 2 < window.innerHeight / 2 ? 'down' : 'up';

  const angleFor = (i: number, n: number) => {
    // Grow the radius only as much as needed to keep every pair of 46px controls
    // exactly RADIAL_NODE_GAP_PX apart. The extra downward radius compensates for
    // Nodi's longer lower silhouette, preserving the same visible mascot-to-button
    // breathing room in every corner rather than merely mirroring centre points.
    const halfSpan = (RADIAL_MAX_SPAN_DEG * Math.PI) / 360;
    const crowdedRadius = n <= 1 ? R : RADIAL_NODE_GAP_PX / (2 * Math.sin(halfSpan / (n - 1)));
    const spacingAdjustment = Math.max(0, crowdedRadius - R);
    const silhouetteRadius = R + (vertical === 'down' ? Math.round(figureH * 0.12) : 0);
    const radialRadius = silhouetteRadius + spacingAdjustment;
    const step = n <= 1
      ? 0
      : (2 * Math.asin(Math.min(1, RADIAL_NODE_GAP_PX / (2 * radialRadius))) * 180) / Math.PI;
    const deg = 224 + (i - (n - 1) / 2) * step;
    const rad = (deg * Math.PI) / 180;
    const dx = Math.round(radialRadius * Math.cos(rad));
    const dy = Math.round(radialRadius * Math.sin(rad));
    return { dx: horizontal === 'left' ? dx : -dx, dy: vertical === 'up' ? dy : -dy };
  };

  return (
    <div className={`nodi-companion nodi-theme-${lightUi ? 'light' : 'dark'}`} data-nodi-theme={lightUi ? 'light' : 'dark'} style={rootStyle}>
      <div className={`nodi-anchor open-${horizontal} open-${vertical}`} style={anchorStyle}>
        {helpOpen && (
          <div className="nodi-bubble" data-nodi-interactive>
            <button className="nodi-bubble-x" onClick={() => setHelpOpen(false)} aria-label={t('Cerrar')}>✕</button>
            <h4>{t('¡Hola! Soy Nodi')}</h4>
            {t('Soy el asistente integrado de Nodus. Puedo orientarte por la app y trabajar con los contextos que selecciones.')}
            <ul>
              <li><b>{t('Chat')}</b>: {t('respuestas fundamentadas en las fuentes activas.')}</li>
              <li><b>{t('Notas')}</b>: {t('apuntes rápidos en Markdown, siempre a mano.')}</li>
              <li><b>{t('Contextos')}</b>: {t('documentación, vista actual y recuperación acotada del vault.')}</li>
              <li><b>{t('Notificaciones')}</b>: {t('avisos locales de la aplicación.')}</li>
            </ul>
          </div>
        )}

        {panel === 'notifications' && (
          <div className="nodi-panel" data-nodi-interactive style={{ height: 320 }}>
            <div className="nodi-panel-head">
              <span>{t('Notificaciones')}</span>
              <span className="grow" />
              <button onClick={() => window.nodus.clearNotifications().then(setNtfs)}>{t('Limpiar')}</button>
              <button onClick={() => setPanel('none')} aria-label={t('Cerrar')}>✕</button>
            </div>
            <div className="nodi-panel-body">
              {ntfs.length === 0 ? (
                <div className="nodi-empty">{t('No hay notificaciones.')}</div>
              ) : (
                ntfs.map((n) => (
                  <div key={n.id} className={`nodi-ntf${n.read ? '' : ' unread'}`}>
                    <span className="nodi-ntf-dot" style={{ background: DOT[n.kind] }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="nodi-ntf-title">{tr(n.title)}</div>
                      {n.body && <div className="nodi-ntf-body">{tr(n.body)}</div>}
                      <div className="nodi-ntf-time">{relTime(n.createdAt)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {panel === 'chat' && (
          <div className="nodi-panel nodi-chat-panel" data-nodi-interactive style={{ height: 460 }}>
            <div className="nodi-panel-head">
              <span className="nodi-chat-title" title={activeConversation?.title ?? t('Chat con Nodi')}>{activeConversation?.title ?? t('Chat con Nodi')}</span>
              <span className="grow" />
              <button className="nodi-head-icon" disabled={streaming} onClick={newChat} title={t('Nuevo chat')} aria-label={t('Nuevo chat')}><Icon name="plus" size={15} /></button>
              <button className={`nodi-head-icon${chatTool === 'history' ? ' active' : ''}`} disabled={streaming} onClick={() => setChatTool((tool) => tool === 'history' ? 'none' : 'history')} title={t('Historial de chats')} aria-label={t('Historial de chats')}><Icon name="clock" size={15} /></button>
              <button className={`nodi-head-icon nodi-context-button${chatTool === 'contexts' ? ' active' : ''}`} onClick={() => setChatTool((tool) => tool === 'contexts' ? 'none' : 'contexts')} title={t('Contextos')} aria-label={t('Contextos')}><Icon name="layers" size={15} /><span>{contexts.length}</span></button>
              <button className={`nodi-head-icon${chatTool === 'settings' ? ' active' : ''}`} onClick={() => setChatTool((tool) => tool === 'settings' ? 'none' : 'settings')} title={t('Ajustes de Nodi')} aria-label={t('Ajustes de Nodi')}><Icon name="settings" size={15} /></button>
              <button className="nodi-head-icon" onClick={() => setPanel('none')} title={t('Cerrar')} aria-label={t('Cerrar')}><Icon name="x" size={15} /></button>
            </div>
            {chatTool === 'history' && (
              <div className="nodi-chat-tool nodi-history">
                <div className="nodi-history-head"><div className="nodi-tool-title">{t('Historial de chats')}</div>{conversations.length > 0 && <button className="nodi-clear-history" onClick={() => setDeleteConfirmation({ kind: 'all' })}><Icon name="trash" size={11} />{t('Borrar todo')}</button>}</div>
                {conversations.length === 0 ? <div className="nodi-tool-empty">{t('Todavía no hay conversaciones guardadas.')}</div> : conversations.map((conversation) => (
                  <div key={conversation.id} className={`nodi-history-row${conversation.id === activeConversationId ? ' active' : ''}`}>
                    <button className="nodi-history-open" onClick={() => openConversation(conversation)}><span className="nodi-history-copy"><b>{conversation.title}</b><small>{conversation.vaultName ?? t('Sin bóveda')} · {new Date(conversation.updatedAt).toLocaleDateString()}</small></span><span>{conversation.messages.length}</span></button>
                    <button className="nodi-history-delete" title={t('Borrar conversación')} aria-label={`${t('Borrar conversación')}: ${conversation.title}`} onClick={() => setDeleteConfirmation({ kind: 'conversation', conversation })}><Icon name="trash" size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            {chatTool === 'contexts' && (
              <div className="nodi-chat-tool">
                <div className="nodi-tool-title">{t('Contextos para la próxima respuesta')}</div>
                <div className="nodi-context-grid">
                  {([
                    ['documentation', t('Documentación de Nodus'), t('Funciones y rutas verificadas de la aplicación.')],
                    ['current_view', t('Vista actual'), t('Texto visible de la sección abierta, acotado.')],
                    ['vault', t('Bóveda actual'), t('Recuperación semántica relevante, no el vault completo.')],
                    ['all_vaults', t('Todos los vaults'), t('Inventario transversal con conteos y elementos relevantes de cada vault.')],
                  ] as Array<[NodiContextKind, string, string]>).map(([kind, label, description]) => (
                    <label key={kind}>
                      <input type="checkbox" checked={contexts.includes(kind)} onChange={() => toggleContext(kind)} />
                      <span><b>{label}</b><small>{description}</small></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {chatTool === 'settings' && settings && (
              <div className="nodi-chat-tool nodi-settings-tool">
                <div className="nodi-tool-title">{t('Ajustes de Nodi')}</div>
                <label><span>{t('Modelo')}</span><ModelPicker settings={settings} value={nodiModel} onChange={changeNodiModel} compact menu emptyLabel="Usar modelo de síntesis" /></label>
                <div className="nodi-visibility-row"><span>{t('Visible en la interfaz')}</span><b>{settings.mascotEnabled ? t('Sí') : t('No')}</b></div>
                <button className="nodi-open-settings" onClick={() => void window.nodus.nodiOpenSettings()}><Icon name="external" size={13} /> {t('Abrir ajustes de visibilidad')}</button>
              </div>
            )}
            <div className="nodi-chat-msgs" ref={msgsRef} style={{ flex: 1 }}>
              {messages.length === 0 && <div className="nodi-empty">{t('Pregúntame sobre Nodus o sobre los contextos que selecciones.')}</div>}
              {messages.map((m, i) => (
                <div key={i} className={`nodi-msg ${m.role}`}>
                  {m.content
                    ? m.role === 'assistant' ? <Markdown content={m.content} verify={false} /> : m.content
                    : streaming && i === messages.length - 1 ? <span className="nodi-typing">{t('escribiendo…')}</span> : ''}
                </div>
              ))}
            </div>
            <div className="nodi-chat-foot">
              <div className="nodi-chat-row">
                <textarea
                  className="nodi-chat-input"
                  value={input}
                  placeholder={t('Escribe a Nodi…')}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {streaming ? (
                  <button className="nodi-chat-send" onClick={() => window.nodus.cancelNodiChat()} title={t('Detener')}>■</button>
                ) : (
                  <button className="nodi-chat-send" onClick={() => void send()} disabled={!input.trim()} title={t('Enviar')}>
                    <IconSend />
                  </button>
                )}
              </div>
              <div className="nodi-chat-status"><Icon name="layers" size={11} /> {t('{count} contextos activos').replace('{count}', String(contexts.length))}</div>
            </div>
            {deleteConfirmation && <div className="nodi-confirm-overlay"><div className="nodi-confirm-dialog" role="dialog" aria-modal="true" aria-label={t(deleteConfirmation.kind === 'all' ? 'Borrar todo el historial' : 'Borrar conversación')}>
              <Icon name="trash" size={18} /><h3>{t(deleteConfirmation.kind === 'all' ? 'Borrar todo el historial' : 'Borrar conversación')}</h3><p>{deleteConfirmation.kind === 'all' ? t('Se eliminarán todas las conversaciones de Nodi. Esta acción no se puede deshacer.') : t('Se eliminará «{title}». Esta acción no se puede deshacer.').replace('{title}', deleteConfirmation.conversation.title)}</p>
              <div><button onClick={() => setDeleteConfirmation(null)}>{t('Cancelar')}</button><button className="danger" onClick={() => void confirmDeleteConversations()}>{t('Borrar')}</button></div>
            </div></div>}
          </div>
        )}

        {panel === 'notes' && (
          <div className="nodi-panel nodi-notes-panel" data-nodi-interactive style={{ height: 460 }}>
            <div className="nodi-panel-head">
              {noteView === 'editor' && (
                <button className="nodi-head-icon" onClick={backToNotes} title={t('Volver')} aria-label={t('Volver')}><Icon name="arrowLeft" size={15} /></button>
              )}
              <span className="nodi-chat-title" title={noteView === 'editor' ? (deriveNoteTitle(noteDraft) || t('Nueva nota')) : t('Notas rápidas')}>
                {noteView === 'editor' ? (deriveNoteTitle(noteDraft) || t('Nueva nota')) : t('Notas rápidas')}
              </span>
              <span className="grow" />
              {noteView === 'list' && (
                <button className="nodi-head-icon" onClick={() => openNoteEditor(null)} title={t('Nueva nota')} aria-label={t('Nueva nota')}><Icon name="plus" size={16} /></button>
              )}
              {noteView === 'editor' && (
                <button className={`nodi-head-icon${notePreview ? ' active' : ''}`} disabled={!noteDraft.trim()} onClick={() => setNotePreview((v) => !v)} title={notePreview ? t('Editar') : t('Vista previa')} aria-label={notePreview ? t('Editar') : t('Vista previa')}><Icon name={notePreview ? 'edit' : 'eye'} size={15} /></button>
              )}
              <button className="nodi-head-icon" onClick={() => setPanel('none')} title={t('Cerrar')} aria-label={t('Cerrar')}><Icon name="x" size={15} /></button>
            </div>

            {noteView === 'list' ? (
              <>
                <div className="nodi-notes-search">
                  <Icon name="search" size={13} />
                  <input value={noteSearch} placeholder={t('Buscar en tus notas…')} onChange={(e) => setNoteSearch(e.target.value)} />
                  {noteSearch && <button onClick={() => setNoteSearch('')} title={t('Limpiar')} aria-label={t('Limpiar')}><Icon name="x" size={12} /></button>}
                </div>
                <div className="nodi-notes-list">
                  {filteredNotes.length === 0 ? (
                    <div className="nodi-empty">{noteSearch.trim() ? t('Sin resultados.') : t('Aún no tienes notas. Crea la primera con el botón +.')}</div>
                  ) : (
                    filteredNotes.map((note) => {
                      const snippet = noteSnippet(note.content);
                      return (
                        <div key={note.id} className="nodi-note-row">
                          <button className="nodi-note-open" onClick={() => openNoteEditor(note)}>
                            <span className="nodi-note-title">{note.title || t('Nota sin título')}</span>
                            {snippet && <span className="nodi-note-snippet">{snippet}</span>}
                            <span className="nodi-note-time">{relTime(note.updatedAt)}</span>
                          </button>
                          <button className="nodi-note-delete" onClick={() => setDeleteNoteTarget(note)} title={t('Borrar nota')} aria-label={`${t('Borrar nota')}: ${note.title || t('Nota sin título')}`}><Icon name="trash" size={13} /></button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <>
                {!notePreview && (
                  <div className="nodi-note-toolbar">
                    {noteFormats.map((f) => (
                      <button key={f.id} type="button" className="nodi-note-tool" data-format={f.id} onMouseDown={(e) => e.preventDefault()} onClick={f.run} title={f.label} aria-label={f.label}><Icon name={f.icon} size={15} /></button>
                    ))}
                  </div>
                )}
                <div className="nodi-note-body">
                  {notePreview ? (
                    noteDraft.trim()
                      ? <div className="nodi-note-preview"><Markdown content={noteDraft} verify={false} /></div>
                      : <div className="nodi-empty">{t('Nada que previsualizar.')}</div>
                  ) : (
                    <textarea
                      ref={noteEditorRef}
                      className="nodi-note-textarea"
                      value={noteDraft}
                      placeholder={t('Escribe tu nota en Markdown…')}
                      autoFocus
                      onChange={(e) => { setNoteDraft(e.target.value); setNoteDirty(true); }}
                      onKeyDown={(e) => {
                        const mod = e.metaKey || e.ctrlKey;
                        if (!mod) return;
                        const key = e.key.toLowerCase();
                        if (key === 'b') { e.preventDefault(); wrapSelection('**'); }
                        else if (key === 'i') { e.preventDefault(); wrapSelection('*'); }
                        else if (key === 's') { e.preventDefault(); void saveNote(); }
                      }}
                    />
                  )}
                </div>
                <div className="nodi-note-foot">
                  {activeNoteId && (
                    <button className="nodi-note-remove" onClick={() => { const note = notes.find((n) => n.id === activeNoteId); if (note) setDeleteNoteTarget(note); }} title={t('Borrar nota')} aria-label={t('Borrar nota')}><Icon name="trash" size={13} /></button>
                  )}
                  <span className="nodi-note-state">{noteDirty ? t('Sin guardar') : activeNoteId ? t('Guardado') : ''}</span>
                  <span className="grow" />
                  <button className="nodi-note-save" onClick={() => void saveNote()} disabled={!noteDraft.trim() || !noteDirty}><Icon name="save" size={14} /> {t('Guardar')}</button>
                </div>
              </>
            )}

            {deleteNoteTarget && (
              <div className="nodi-confirm-overlay">
                <div className="nodi-confirm-dialog" role="dialog" aria-modal="true" aria-label={t('Borrar nota')}>
                  <Icon name="trash" size={18} />
                  <h3>{t('Borrar nota')}</h3>
                  <p>{t('Se eliminará «{title}». Esta acción no se puede deshacer.').replace('{title}', deleteNoteTarget.title || t('Nota sin título'))}</p>
                  <div>
                    <button onClick={() => setDeleteNoteTarget(null)}>{t('Cancelar')}</button>
                    <button className="danger" onClick={() => void confirmDeleteNote()}>{t('Borrar')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {contextMenuOpen && !closing && (
          <div className="nodi-context-menu" data-nodi-interactive role="menu" aria-label={t('Opciones de la mascota')}>
            <button type="button" role="menuitem" onClick={closeMascot}>
              <span className="nodi-context-icon"><Icon name="x" size={14} /></span>
              <span><b>{t('Cerrar mascota')}</b><small>{t('Puedes volver a activarla desde Ajustes.')}</small></span>
            </button>
          </div>
        )}

        {items.map((it, i) => {
          const { dx, dy } = angleFor(i, items.length);
          return (
            <button
              key={it.id}
              className={`nodi-node${menuOpen ? ' open' : ''}`}
              data-nodi-interactive
              data-nodi-action={it.id}
              style={{
                ['--dx' as string]: `${dx}px`,
                ['--dy' as string]: `${dy}px`,
                ['--anchor-r' as string]: `${anchorR}px`,
                ['--anchor-b' as string]: `${anchorB}px`,
                transitionDelay: `${(menuOpen ? i : items.length - 1 - i) * 0.03}s`,
              } as CSSProperties}
              onClick={(e) => {
                e.stopPropagation();
                it.onClick();
              }}
              title={it.label}
            >
              {it.icon}
              {!!it.badge && it.badge > 0 && <span className="nodi-node-badge">{it.badge}</span>}
              <span className="nodi-node-label">{it.label}</span>
            </button>
          );
        })}

        <div
          className={`nodi-figure${dragging ? ' dragging' : ''}${closing ? ' closing' : ''}`}
          data-nodi-interactive
          style={{ width: figureW, height: figureH, pointerEvents: 'auto' }}
          onPointerDown={onFigurePointerDown}
          onPointerMove={onFigurePointerMove}
          onPointerUp={(event) => finishFigurePointer(event)}
          onPointerCancel={(event) => finishFigurePointer(event, true)}
          onLostPointerCapture={onFigurePointerCaptureLost}
          onContextMenu={onFigureContextMenu}
        >
          <NodiAvatar settings={settings} state={nodiState} role={role} height={figureH} draggable={!closing} raiseArm={!closing && unread > 0} className={dragging ? 'dragging' : undefined} />
          {!closing && !menuOpen && unread > 0 && <span className="nodi-figure-badge">{unread > 9 ? '9+' : unread}</span>}
        </div>
      </div>
    </div>
  );
}
