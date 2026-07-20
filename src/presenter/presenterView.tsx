// PDF Presenter — the presenter window: current slide + next-slide preview +
// speaker notes + timer + system clock + thumbnail carousel. Navigation, black
// screen and slide zoom run through the shared reducer and relay to the audience;
// the timer is owned here and broadcast outward (canonical state + the future
// mobile remote). No app shell, no DB — just the exposed nodus bridge + pdfjs.
import { createRoot } from 'react-dom/client';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { beginPresentation, presenterReducer, type PresenterAction, type PresenterRuntimeState, type ToolName } from '@shared/presenterState';
import { FittedSlideRenderer } from '../lib/presenter/renderSlide';
import { createThumbSession, type ThumbSession } from '../lib/presenter/thumbSession';
import { loadDeck, noteParagraphs, readDeckParams } from './deck';
import { useTools } from './useTools';
import { PresenterToolbar } from './PresenterToolbar';
import '../index.css';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function formatTimer(sec: number): string {
  return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
}
function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function PresenterViewApp() {
  const params = useRef(readDeckParams()).current;
  const [ui, setUi] = useState<PresenterRuntimeState>(() => beginPresentation(params.pdfId, params.startSlide));
  const [name, setName] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, unknown>>({});
  const [notesFont, setNotesFont] = useState(16);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [clock, setClock] = useState(() => '');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrInfo, setQrInfo] = useState<{ url: string; pin: string; qr: string } | null>(null);
  const [volume, setVolume] = useState(50);
  const [volumeOpen, setVolumeOpen] = useState(false);

  const stateRef = useRef(ui);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const currentRenderer = useRef<FittedSlideRenderer | null>(null);
  const nextRenderer = useRef<FittedSlideRenderer | null>(null);
  const currentWrapRef = useRef<HTMLDivElement | null>(null);
  const currentContainerRef = useRef<HTMLDivElement | null>(null);
  const currentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextContainerRef = useRef<HTMLDivElement | null>(null);
  const nextCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ThumbSession | null>(null);
  const timerTick = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartedAt = useRef<number | null>(null);
  const timerSecondsRef = useRef(0);
  const toolsApplyRef = useRef<(action: PresenterAction) => void>(() => {});
  const toolsSlideChangedRef = useRef<() => void>(() => {});

  const renderPair = useCallback((slide: number) => {
    const doc = docRef.current;
    if (!doc) return;
    void currentRenderer.current?.render(doc, slide);
    if (slide < doc.numPages) void nextRenderer.current?.render(doc, slide + 1);
  }, []);

  const dispatch = useCallback(
    (action: PresenterAction, local: boolean) => {
      toolsApplyRef.current(action); // paint tool overlays (local + relayed)
      const prev = stateRef.current;
      const next = presenterReducer(prev, action);
      stateRef.current = next;
      setUi(next);
      if (local) window.nodus.sendPresenterControl(action);
      if (next.currentSlide !== prev.currentSlide) {
        void currentRenderer.current?.render(docRef.current!, next.currentSlide).then(() => toolsSlideChangedRef.current());
        if (docRef.current && next.currentSlide < docRef.current.numPages) {
          void nextRenderer.current?.render(docRef.current, next.currentSlide + 1);
        }
        carouselRef.current
          ?.querySelector<HTMLElement>(`[data-carousel="${next.currentSlide}"]`)
          ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      }
    },
    [],
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const tools = useTools({
    stageRef: currentWrapRef,
    getSlideCanvas: () => currentCanvasRef.current,
    getState: () => stateRef.current,
    emit: (a) => dispatchRef.current(a, true),
  });
  toolsApplyRef.current = tools.apply;
  toolsSlideChangedRef.current = tools.onSlideChanged;

  // ── Timer (owned here; broadcast so canonical state + mobile stay in sync) ────
  const pushTimer = useCallback((sec: number, running: boolean) => {
    window.nodus.sendPresenterControl({ type: 'timerSync', timerSeconds: sec, timerRunning: running });
  }, []);
  const startTimer = useCallback(() => {
    setTimerRunning(true);
    timerStartedAt.current = Date.now() - timerSecondsRef.current * 1000;
    if (timerTick.current) clearInterval(timerTick.current);
    timerTick.current = setInterval(() => {
      const sec = Math.floor((Date.now() - (timerStartedAt.current ?? Date.now())) / 1000);
      timerSecondsRef.current = sec;
      setTimerSeconds(sec);
      pushTimer(sec, true);
    }, 1000);
  }, [pushTimer]);
  const pauseTimer = useCallback(() => {
    setTimerRunning(false);
    if (timerTick.current) clearInterval(timerTick.current);
    timerTick.current = null;
    pushTimer(timerSecondsRef.current, false);
  }, [pushTimer]);
  const resetTimer = useCallback(() => {
    timerSecondsRef.current = 0;
    setTimerSeconds(0);
    if (timerStartedAt.current !== null) timerStartedAt.current = Date.now();
    pushTimer(0, timerTick.current !== null);
  }, [pushTimer]);
  const toggleTimer = useCallback(() => {
    if (timerTick.current) pauseTimer();
    else startTimer();
  }, [pauseTimer, startTimer]);

  // Load deck + wire renderers, then render the starting slide and auto-start timer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const deck = await loadDeck(params.pdfId);
      if (cancelled || !deck) return;
      docRef.current = deck.doc;
      setName(deck.presentation?.name ?? '');
      setNotes(deck.presentation?.notes ?? {});
      setVideos(deck.presentation?.videos ?? {});
      if (currentCanvasRef.current && currentContainerRef.current) {
        currentRenderer.current = new FittedSlideRenderer(currentCanvasRef.current, currentContainerRef.current);
      }
      if (nextCanvasRef.current && nextContainerRef.current) {
        nextRenderer.current = new FittedSlideRenderer(nextCanvasRef.current, nextContainerRef.current);
      }
      dispatchRef.current({ type: 'setTotal', total: deck.doc.numPages }, true);
      renderPair(stateRef.current.currentSlide);
      if (carouselRef.current) {
        sessionRef.current = createThumbSession({
          container: carouselRef.current,
          scrollRoot: carouselRef.current,
          doc: deck.doc,
          pageCount: deck.doc.numPages,
          scale: 0.25,
          rootMargin: '0px 800px',
          buildItem: (pageNum) => buildCarouselItem(pageNum, () => dispatchRef.current({ type: 'navigate', slide: pageNum }, true)),
        });
        carouselRef.current
          .querySelector<HTMLElement>(`[data-carousel="${stateRef.current.currentSlide}"]`)
          ?.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
      startTimer();
    })();
    return () => {
      cancelled = true;
      sessionRef.current?.destroy();
      if (timerTick.current) clearInterval(timerTick.current);
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [params.pdfId, renderPair, startTimer]);

  // Highlight the active carousel thumbnail.
  useEffect(() => {
    carouselRef.current?.querySelectorAll<HTMLElement>('[data-carousel]').forEach((el) => {
      el.dataset.active = el.dataset.carousel === String(ui.currentSlide) ? 'true' : 'false';
    });
  }, [ui.currentSlide]);

  // Relayed control (from the audience window or a phone). Timer toggles/resets
  // must drive the real local timer here (it is the timer's owner), not just the
  // reducer, so a phone can pause/reset it.
  const toggleTimerRef = useRef(toggleTimer);
  const resetTimerRef = useRef(resetTimer);
  toggleTimerRef.current = toggleTimer;
  resetTimerRef.current = resetTimer;
  useEffect(
    () =>
      window.nodus.onPresenterControl((action) => {
        if (action.type === 'timerToggle') toggleTimerRef.current();
        else if (action.type === 'timerReset') resetTimerRef.current();
        else dispatchRef.current(action, false);
      }),
    [],
  );

  // System clock.
  useEffect(() => {
    const upd = () => setClock(formatClock(new Date()));
    upd();
    const id = setInterval(upd, 10000);
    return () => clearInterval(id);
  }, []);

  // Re-render on resize.
  useEffect(() => {
    const onResize = () => renderPair(stateRef.current.currentSlide);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderPair]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          dispatchRef.current({ type: 'next' }, true);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          dispatchRef.current({ type: 'prev' }, true);
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          dispatchRef.current({ type: 'blackScreen' }, true);
          break;
        case 'Escape':
          e.preventDefault();
          if (stateRef.current.slideZoom.scale > 1) {
            dispatchRef.current({ type: 'slideZoom', data: { scale: 1, originX: 50, originY: 50 } }, true);
          } else {
            void window.nodus.stopPresenter();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl/⌘ + wheel zoom on the current slide.
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const wrap = currentWrapRef.current;
    const cur = stateRef.current.slideZoom;
    let { originX, originY } = cur;
    if (cur.scale <= 1 && wrap) {
      const r = wrap.getBoundingClientRect();
      originX = ((e.clientX - r.left) / r.width) * 100;
      originY = ((e.clientY - r.top) / r.height) * 100;
    }
    const scale = Math.min(Math.max(cur.scale + (e.deltaY > 0 ? -0.15 : 0.15), 1), 5);
    dispatchRef.current({ type: 'slideZoom', data: { scale, originX, originY } }, true);
  };

  const paras = noteParagraphs(notes[String(ui.currentSlide)]);
  const zoom = ui.slideZoom;
  const atEnd = ui.totalSlides > 0 && ui.currentSlide >= ui.totalSlides;

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-neutral-100">
      {/* Topbar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <div className="flex items-center gap-1.5">
          <TopBtn title={t('Anterior')} onClick={() => dispatch({ type: 'prev' }, true)}>
            <Icon name="chevronLeft" size={18} />
          </TopBtn>
          <span className="min-w-16 text-center text-sm tabular-nums">
            {ui.currentSlide} / {ui.totalSlides || '…'}
          </span>
          <TopBtn title={t('Siguiente')} onClick={() => dispatch({ type: 'next' }, true)}>
            <Icon name="chevronRight" size={18} />
          </TopBtn>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <span className={`text-sm tabular-nums ${timerRunning ? 'text-emerald-400' : 'text-neutral-400'}`}>
            {formatTimer(timerSeconds)}
          </span>
          <TopBtn title={timerRunning ? t('Pausar') : t('Iniciar')} onClick={toggleTimer}>
            <Icon name={timerRunning ? 'pause' : 'play'} size={15} />
          </TopBtn>
          <TopBtn title={t('Reiniciar temporizador')} onClick={resetTimer}>
            <Icon name="rotateCcw" size={15} />
          </TopBtn>
          <TopBtn title={t('Pantalla en negro (B)')} active={ui.blackScreen} onClick={() => dispatch({ type: 'blackScreen' }, true)}>
            <Icon name="eyeOff" size={16} />
          </TopBtn>
          {Boolean(videos[String(ui.currentSlide)]) && (
            <TopBtn title={t('Reproducir/Pausar vídeo')} active={ui.videoPlaying} onClick={() => dispatch({ type: 'videoToggle' }, true)}>
              <Icon name={ui.videoPlaying ? 'pause' : 'play'} size={15} />
            </TopBtn>
          )}
          <TopBtn
            title={t('Mando móvil (QR)')}
            onClick={() => {
              setQrOpen(true);
              void window.nodus.getPresenterServerInfo().then((info) => setQrInfo(info));
            }}
          >
            <Icon name="grid" size={16} />
          </TopBtn>
          <div className="relative">
            <TopBtn
              title={t('Volumen')}
              active={volumeOpen}
              onClick={() => {
                setVolumeOpen((v) => !v);
                void window.nodus.getPresenterVolume().then(setVolume);
              }}
            >
              <Icon name="volume" size={16} />
            </TopBtn>
            {volumeOpen && (
              <div className="absolute right-0 top-10 z-50 rounded-lg border border-white/10 bg-neutral-900 p-3 shadow-xl">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setVolume(v);
                    void window.nodus.setPresenterVolume(v);
                  }}
                  className="w-32 accent-amber-400"
                />
                <div className="mt-1 text-center text-xs text-neutral-400">{volume}</div>
              </div>
            )}
          </div>
          <TopBtn title={t('AirPlay / Duplicar pantalla')} onClick={() => void window.nodus.openPresenterCast()}>
            <Icon name="cast" size={16} />
          </TopBtn>
          <span className="ml-1 text-xs text-neutral-500 tabular-nums">{clock}</span>
          <button
            type="button"
            onClick={() => window.nodus.stopPresenter()}
            className="ml-1 flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-2.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <Icon name="stop" size={14} />
            {t('Finalizar')}
          </button>
        </div>
      </div>

      {/* Main: current slide | next + notes */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={currentContainerRef}
            onWheel={onWheel}
            onMouseDown={tools.onMouseDown}
            onMouseMove={tools.onMouseMove}
            onMouseUp={tools.onMouseUp}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-3"
          >
            <div
              ref={currentWrapRef}
              style={zoom.scale > 1 ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.originX}% ${zoom.originY}%` } : undefined}
            >
              <canvas ref={currentCanvasRef} className="block" />
            </div>
          </div>
          <div className="flex justify-center border-t border-white/10 bg-neutral-950 p-2">
            <PresenterToolbar
              activeTool={ui.toolMode}
              color={ui.toolColor}
              size={ui.toolMode ? ui.toolSizes[ui.toolMode as ToolName] : ui.toolSizes.pointer}
              zoomFactor={ui.zoomFactor}
              onSetTool={(tool) => dispatch({ type: 'setTool', tool }, true)}
              onSetColor={(color) => dispatch({ type: 'setToolColor', color }, true)}
              onSetSize={(size) => ui.toolMode && dispatch({ type: 'setToolSize', tool: ui.toolMode, size }, true)}
              onSetZoomFactor={(factor) => dispatch({ type: 'setZoomFactor', factor }, true)}
              onClear={() => dispatch({ type: 'clearDraw' }, true)}
            />
          </div>
        </div>
        <div className="flex w-[34%] min-w-72 flex-col border-l border-white/10">
          <div className="flex h-2/5 flex-col border-b border-white/10 p-2">
            <span className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{t('Siguiente diapositiva')}</span>
            <div ref={nextContainerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded bg-black">
              {atEnd ? (
                <span className="text-sm text-neutral-500">{t('Fin de la presentación')}</span>
              ) : (
                <canvas ref={nextCanvasRef} className="block" />
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-neutral-500">{t('Notas del presentador')}</span>
              <div className="flex items-center gap-1">
                <TopBtn title={t('Reducir')} onClick={() => setNotesFont((f) => Math.max(10, f - 1))}>
                  <Icon name="minus" size={13} />
                </TopBtn>
                <span className="w-8 text-center text-xs text-neutral-500">{notesFont}px</span>
                <TopBtn title={t('Aumentar')} onClick={() => setNotesFont((f) => Math.min(32, f + 1))}>
                  <Icon name="plus" size={13} />
                </TopBtn>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ fontSize: `${notesFont}px` }}>
              {paras.length ? (
                paras.map((p, i) => (
                  <p key={i} className="mb-2 whitespace-pre-wrap leading-relaxed text-neutral-200">
                    {p}
                  </p>
                ))
              ) : (
                <p className="text-sm italic text-neutral-600">{t('Sin notas para esta diapositiva')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Carousel */}
      <div ref={carouselRef} className="flex h-24 shrink-0 gap-2 overflow-x-auto border-t border-white/10 p-2" />

      {/* QR / mobile-remote panel */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQrOpen(false);
          }}
        >
          <div className="w-full max-w-xs rounded-2xl bg-neutral-900 p-6 text-center">
            <h3 className="text-base font-semibold">{t('Escanea para controlar desde el móvil')}</h3>
            {qrInfo ? (
              <>
                <img src={qrInfo.qr} alt="QR" width={240} height={240} className="mx-auto my-3 rounded-lg bg-white p-2" />
                <p className="break-all text-xs text-neutral-400">{qrInfo.url}</p>
                <p className="mt-1 text-sm">
                  {t('PIN')}: <span className="font-mono tracking-widest">{qrInfo.pin}</span>
                </p>
              </>
            ) : (
              <p className="my-6 text-sm text-neutral-500">{t('Cargando…')}</p>
            )}
            <button type="button" onClick={() => setQrOpen(false)} className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
              {t('Cerrar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-300 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function buildCarouselItem(pageNum: number, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset.carousel = String(pageNum);
  element.className =
    'group relative h-full shrink-0 overflow-hidden rounded border border-white/10 bg-neutral-900 data-[active=true]:border-amber-400 data-[active=true]:ring-1 data-[active=true]:ring-amber-400';
  element.addEventListener('click', onClick);

  const canvas = document.createElement('canvas');
  canvas.className = 'block h-full w-auto';

  const label = document.createElement('span');
  label.className = 'absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 text-[9px] text-white';
  label.textContent = String(pageNum);

  element.appendChild(canvas);
  element.appendChild(label);
  return { element, canvas };
}

const el = document.getElementById('presenter-root');
if (el) createRoot(el).render(<PresenterViewApp />);
