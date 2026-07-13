import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { NodiChatMessage, NodiNotification, VaultType } from '@shared/types';
import { Nodi, type NodiRole, type NodiState } from './Nodi';
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
  const [allVaults, setAllVaults] = useState(false);
  const msgsRef = useRef<HTMLDivElement | null>(null);

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
  // Costumes come from the parent (app) when provided, otherwise fetched (overlay).
  const [fetchedCostumes, setFetchedCostumes] = useState(true);
  const costumesEnabled = costumes ?? fetchedCostumes;
  const role = costumesEnabled ? roleForVault(vaultType) : 'none';

  useEffect(() => {
    if (costumes !== undefined) return;
    window.nodus.getSettings().then((s) => setFetchedCostumes(s.mascotVaultCostumes)).catch(() => {});
    return window.nodus.onSettingsChanged((s) => setFetchedCostumes(s.mascotVaultCostumes));
  }, [costumes]);

  // ── Notifications: load + live updates ────────────────────────────────────
  useEffect(() => {
    window.nodus.listNotifications().then(setNtfs).catch(() => {});
    return window.nodus.onNotificationsChanged(setNtfs);
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
    window.nodus.nodiSetMouseIgnore(true);
    lastInteractive.current = false;
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      setInteractive(!!el?.closest('[data-nodi-interactive]'));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [isOverlay, setInteractive]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (panel === 'chat' && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, panel]);

  const closeAll = () => {
    setMenuOpen(false);
    setPanel('none');
    setHelpOpen(false);
  };

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

  type Item = { id: string; label: string; icon: React.ReactNode; onClick: () => void; badge?: number };
  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: 'help', label: '¿Quién soy?', icon: <IconHelp />, onClick: () => { setHelpOpen((v) => !v); setPanel('none'); } },
      { id: 'ntf', label: 'Notificaciones', icon: <IconBell />, onClick: openNotifications, badge: unread },
      { id: 'chat', label: 'Chat', icon: <IconChat />, onClick: () => { setPanel((p) => (p === 'chat' ? 'none' : 'chat')); setHelpOpen(false); } },
    ];
    if (isOverlay) base.push({ id: 'open', label: 'Abrir Nodus', icon: <IconOpen />, onClick: () => window.nodus.nodiOpenMainWindow() });
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverlay, unread, panel]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: NodiChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    try {
      await window.nodus.nodiChatStream(
        { messages: next, allVaults },
        {
          onDelta: (d) =>
            setMessages((cur) => {
              const copy = cur.slice();
              const last = copy[copy.length - 1];
              if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + d };
              return copy;
            }),
        }
      );
    } catch (err) {
      setMessages((cur) => {
        const copy = cur.slice();
        const last = copy[copy.length - 1];
        const msg = err instanceof Error ? err.message : 'No se pudo responder.';
        if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content || `⚠️ ${msg}` };
        return copy;
      });
    } finally {
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
            <button className="nodi-bubble-x" onClick={() => setHelpOpen(false)} aria-label="Cerrar">✕</button>
            <h4>¡Hola! Soy Nodi</h4>
            Soy el nodo que acompaña Nodus. Puedo ayudarte a orientarte por la app.
            <ul>
              <li><b>Chat</b>: pregúntame sobre Nodus y su configuración.</li>
              <li><b>Notificaciones</b>: te aviso de novedades.</li>
              <li>Y más funciones en camino…</li>
            </ul>
          </div>
        )}

        {panel === 'notifications' && (
          <div className="nodi-panel" data-nodi-interactive style={{ height: 320 }}>
            <div className="nodi-panel-head">
              <span>Notificaciones</span>
              <span className="grow" />
              <button onClick={() => window.nodus.clearNotifications().then(setNtfs)}>Limpiar</button>
              <button onClick={() => setPanel('none')} aria-label="Cerrar">✕</button>
            </div>
            <div className="nodi-panel-body">
              {ntfs.length === 0 ? (
                <div className="nodi-empty">No hay notificaciones.</div>
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
          <div className="nodi-panel" data-nodi-interactive style={{ height: 380 }}>
            <div className="nodi-panel-head">
              <span>Chat con Nodi</span>
              <span className="grow" />
              {messages.length > 0 && <button onClick={() => setMessages([])}>Limpiar</button>}
              <button onClick={() => setPanel('none')} aria-label="Cerrar">✕</button>
            </div>
            <div className="nodi-chat-msgs" ref={msgsRef} style={{ flex: 1 }}>
              {messages.length === 0 && <div className="nodi-empty">Pregúntame lo que quieras sobre Nodus.</div>}
              {messages.map((m, i) => (
                <div key={i} className={`nodi-msg ${m.role}`}>
                  {m.content || (streaming && i === messages.length - 1 ? <span className="nodi-typing">escribiendo…</span> : '')}
                </div>
              ))}
            </div>
            <div className="nodi-chat-foot">
              <div className="nodi-chat-row">
                <textarea
                  className="nodi-chat-input"
                  value={input}
                  placeholder="Escribe a Nodi…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {streaming ? (
                  <button className="nodi-chat-send" onClick={() => window.nodus.cancelNodiChat()} title="Detener">■</button>
                ) : (
                  <button className="nodi-chat-send" onClick={() => void send()} disabled={!input.trim()} title="Enviar">
                    <IconSend />
                  </button>
                )}
              </div>
              <div className="nodi-chat-opts">
                <label>
                  <input type="checkbox" checked={allVaults} onChange={(e) => setAllVaults(e.target.checked)} />
                  Todas las bóvedas
                </label>
              </div>
            </div>
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
