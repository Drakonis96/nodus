import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AppSettings, ModelRef, NodiChatMessage, NodiContextKind, NodiConversation, NodiNotification, VaultType } from '@shared/types';
import { Nodi, type NodiRole, type NodiState } from './Nodi';
import { Markdown } from '../Markdown';
import { ModelPicker } from '../ModelPicker';
import { Icon } from '../ui';
import { setActiveLang, t } from '../../i18n';
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

function relTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

const DOT: Record<NodiNotification['kind'], string> = { info: '#5b9bd5', success: '#3bb273', warning: '#e0a53b' };

export function NodiCompanion({ context, costumes }: { context: Ctx; costumes?: boolean }) {
  const isOverlay = context === 'overlay';
  const figureH = isOverlay ? 200 : 168;
  const figureW = Math.round((figureH * 270) / 300);
  const anchorR = Math.round(figureW * 0.52);
  const anchorB = Math.round(figureH * 0.533);
  const R = isOverlay ? 104 : 92;

  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'none' | 'notifications' | 'chat'>('none');
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
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const hasOpenSurface = menuOpen || helpOpen || panel !== 'none';

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [greet, setGreet] = useState(false);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
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

  // ── Overlay: make the transparent window click-through except over Nodi/panels
  const lastInteractive = useRef<boolean | null>(null);
  const setInteractive = useCallback((v: boolean) => {
    if (lastInteractive.current === v) return;
    lastInteractive.current = v;
    window.nodus.nodiSetMouseIgnore(!v);
  }, []);
  useEffect(() => {
    if (!isOverlay) return;
    if (hasOpenSurface) {
      lastInteractive.current = true;
      void window.nodus.nodiSetExpanded(true);
    } else {
      lastInteractive.current = false;
      void window.nodus.nodiSetExpanded(false);
    }
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) return;
      if (hasOpenSurface) { setInteractive(true); return; }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      setInteractive(!!el?.closest('[data-nodi-interactive]'));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [hasOpenSurface, isOverlay, setInteractive]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (panel === 'chat' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, panel]);

  const closeAll = useCallback(() => {
    setMenuOpen(false);
    setPanel('none');
    setHelpOpen(false);
  }, []);

  useEffect(() => {
    if (!isOverlay) return;
    return window.nodus.onNodiDismiss(closeAll);
  }, [closeAll, isOverlay]);

  // Click anywhere outside Nodi or its controls closes the menu/panels/bubble.
  useEffect(() => {
    if (!menuOpen && !helpOpen && panel === 'none') return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-nodi-interactive]')) return;
      setMenuOpen(false);
      setPanel('none');
      setHelpOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menuOpen, helpOpen, panel]);

  const onFigurePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    movedRef.current = false;
    draggingRef.current = false;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onFigurePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) {
      if (!movedRef.current && Math.abs(e.movementX) + Math.abs(e.movementY) < 3) return;
      movedRef.current = true;
      draggingRef.current = true;
      if (isOverlay) void window.nodus.nodiMoveWindow(e.movementX, e.movementY);
      else
        setPos((p) => {
          if (!p) return p;
          const np = clamp(p.x + e.movementX, p.y + e.movementY);
          offsetRef.current = {
            right: Math.max(0, window.innerWidth - (np.x + figureW)),
            bottom: Math.max(0, window.innerHeight - (np.y + figureH)),
          };
          return np;
        });
    }
  };
  const onFigurePointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    draggingRef.current = false;
    if (!movedRef.current) {
      // A click (not a drag): toggle the menu (closing also dismisses panels/bubble).
      if (menuOpen) closeAll();
      else {
        setMenuOpen(true);
        wave();
      }
    }
  };

  const openNotifications = () => {
    setPanel((p) => (p === 'notifications' ? 'none' : 'notifications'));
    setHelpOpen(false);
    if (panel !== 'notifications' && unread > 0) window.nodus.markNotificationsRead().then(setNtfs).catch(() => {});
  };

  const nodiState: NodiState = streaming ? 'loading' : greet ? 'waving' : celebrate ? 'discovering' : 'idle';
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  type Item = { id: string; label: string; icon: React.ReactNode; onClick: () => void; badge?: number };
  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: 'help', label: t('¿Quién soy?'), icon: <IconHelp />, onClick: () => { setHelpOpen((v) => !v); setPanel('none'); } },
      { id: 'ntf', label: t('Notificaciones'), icon: <IconBell />, onClick: openNotifications, badge: unread },
      { id: 'chat', label: t('Chat'), icon: <IconChat />, onClick: () => { setPanel((p) => (p === 'chat' ? 'none' : 'chat')); setHelpOpen(false); } },
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
      assistantText ||= `⚠️ ${err instanceof Error ? err.message : t('No se pudo responder.')}`;
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

  const rootStyle: CSSProperties = isOverlay
    ? { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }
    : pos
      ? { position: 'fixed', left: pos.x, top: pos.y, width: figureW, height: figureH, pointerEvents: 'none', zIndex: 45 }
      : { display: 'none' };

  const anchorStyle: CSSProperties = isOverlay
    ? { right: 16, bottom: 16, width: figureW, height: figureH }
    : { inset: 0 };

  const angleFor = (i: number, n: number) => {
    const start = 180;
    const end = 268;
    const deg = n <= 1 ? 224 : start + (i * (end - start)) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.round(R * Math.cos(rad)), dy: Math.round(R * Math.sin(rad)) };
  };

  return (
    <div className="nodi-companion" style={rootStyle}>
      <div className="nodi-anchor" style={anchorStyle}>
        {helpOpen && (
          <div className="nodi-bubble" data-nodi-interactive>
            <button className="nodi-bubble-x" onClick={() => setHelpOpen(false)} aria-label={t('Cerrar')}>✕</button>
            <h4>{t('¡Hola! Soy Nodi')}</h4>
            {t('Soy el asistente integrado de Nodus. Puedo orientarte por la app y trabajar con los contextos que selecciones.')}
            <ul>
              <li><b>{t('Chat')}</b>: {t('respuestas fundamentadas en las fuentes activas.')}</li>
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
                      <div className="nodi-ntf-title">{n.title}</div>
                      {n.body && <div className="nodi-ntf-body">{n.body}</div>}
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

        {items.map((it, i) => {
          const { dx, dy } = angleFor(i, items.length);
          return (
            <button
              key={it.id}
              className={`nodi-node${menuOpen ? ' open' : ''}`}
              data-nodi-interactive
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
          className={`nodi-figure${dragging ? ' dragging' : ''}`}
          data-nodi-interactive
          style={{ width: figureW, height: figureH, pointerEvents: 'auto' }}
          onPointerDown={onFigurePointerDown}
          onPointerMove={onFigurePointerMove}
          onPointerUp={onFigurePointerUp}
          onPointerCancel={onFigurePointerUp}
        >
          <Nodi state={nodiState} role={role} height={figureH} draggable raiseArm={unread > 0} className={dragging ? 'dragging' : undefined} />
          {!menuOpen && unread > 0 && <span className="nodi-figure-badge">{unread > 9 ? '9+' : unread}</span>}
        </div>
      </div>
    </div>
  );
}
