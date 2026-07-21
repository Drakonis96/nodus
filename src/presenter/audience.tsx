// PDF Presenter — the audience window. A full-screen, black-backed slide canvas
// with black-screen and slide-zoom, driven by the same reducer as the presenter
// window (@shared/presenterState). Local input is applied AND relayed to main;
// actions relayed back from the presenter are applied without re-broadcasting.
import { createRoot } from 'react-dom/client';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { beginPresentation, presenterReducer, type PresenterAction, type PresenterRuntimeState, type ToolName } from '@shared/presenterState';
import { FittedSlideRenderer } from '../lib/presenter/renderSlide';
import { YouTubeOverlayController } from '../lib/presenter/youtube';
import { loadDeck, readDeckParams } from './deck';
import { useTools } from './useTools';
import { PresenterToolbar } from './PresenterToolbar';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PresenterVideo } from '@shared/presenterTypes';
import '../index.css';

function AudienceApp() {
  const params = useRef(readDeckParams()).current;
  const [ui, setUi] = useState<PresenterRuntimeState>(() => beginPresentation(params.pdfId, params.startSlide));
  const [ready, setReady] = useState(false);
  const stateRef = useRef(ui);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const rendererRef = useRef<FittedSlideRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pinchRef = useRef({ dist: 0, scale: 1 });
  const toolsApplyRef = useRef<(action: PresenterAction) => void>(() => {});
  const toolsSlideChangedRef = useRef<() => void>(() => {});
  const videosRef = useRef<Record<string, PresenterVideo>>({});
  const ytCtlRef = useRef<YouTubeOverlayController | null>(null);
  const [barVisible, setBarVisible] = useState(false);
  const barHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showVideoForSlide = (slide: number) => {
    const yt = ytCtlRef.current;
    if (!yt) return;
    const v = videosRef.current[String(slide)];
    if (v) yt.show(v);
    else yt.hide();
  };

  // Single entry point for every state change — local input sets `local`, relayed
  // events don't (so they never echo back into an infinite loop).
  const dispatch = (action: PresenterAction, local: boolean) => {
    toolsApplyRef.current(action); // paint tool overlays (local + relayed)
    const prev = stateRef.current;
    const next = presenterReducer(prev, action);
    stateRef.current = next;
    setUi(next);
    if (local) window.nodus.sendPresenterControl(action);
    if (next.currentSlide !== prev.currentSlide && docRef.current) {
      void rendererRef.current?.render(docRef.current, next.currentSlide).then(() => toolsSlideChangedRef.current());
      showVideoForSlide(next.currentSlide);
    }
    // Audience owns the YouTube iframe: reflect play/pause + seek here.
    if (action.type === 'videoToggle') {
      if (next.videoPlaying) ytCtlRef.current?.play();
      else ytCtlRef.current?.pause();
    } else if (action.type === 'videoSeek') {
      ytCtlRef.current?.seek(action.time);
    }
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const tools = useTools({
    stageRef: wrapperRef,
    getSlideCanvas: () => canvasRef.current,
    getState: () => stateRef.current,
    emit: (a) => dispatchRef.current(a, true),
  });
  toolsApplyRef.current = tools.apply;
  toolsSlideChangedRef.current = tools.onSlideChanged;

  const revealBar = () => {
    setBarVisible(true);
    if (barHideTimer.current) clearTimeout(barHideTimer.current);
    barHideTimer.current = setTimeout(() => setBarVisible(false), 2500);
  };

  // Load the deck and render the starting slide.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const deck = await loadDeck(params.pdfId);
      if (cancelled || !deck) return;
      docRef.current = deck.doc;
      videosRef.current = deck.presentation?.videos ?? {};
      if (canvasRef.current && containerRef.current) {
        rendererRef.current = new FittedSlideRenderer(canvasRef.current, containerRef.current);
      }
      if (wrapperRef.current && !ytCtlRef.current) {
        ytCtlRef.current = new YouTubeOverlayController(wrapperRef.current, false);
      }
      dispatchRef.current({ type: 'setTotal', total: deck.doc.numPages }, true);
      setReady(true);
      await rendererRef.current?.render(deck.doc, stateRef.current.currentSlide);
      showVideoForSlide(stateRef.current.currentSlide);
    })();
    return () => {
      cancelled = true;
      ytCtlRef.current?.destroy();
      ytCtlRef.current = null;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [params.pdfId]);

  // Relayed control from the presenter window.
  useEffect(() => window.nodus.onPresenterControl((action) => dispatchRef.current(action, false)), []);

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

  // Re-render fit on resize.
  useEffect(() => {
    const onResize = () => {
      if (docRef.current) void rendererRef.current?.render(docRef.current, stateRef.current.currentSlide);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Ctrl/⌘ + wheel and two-finger pinch → slide zoom.
  const zoomAt = (clientX: number, clientY: number, delta: number) => {
    const wrap = wrapperRef.current;
    const cur = stateRef.current.slideZoom;
    let { originX, originY } = cur;
    if (cur.scale <= 1 && wrap) {
      const r = wrap.getBoundingClientRect();
      originX = ((clientX - r.left) / r.width) * 100;
      originY = ((clientY - r.top) / r.height) * 100;
    }
    const scale = Math.min(Math.max(cur.scale + delta, 1), 5);
    dispatchRef.current({ type: 'slideZoom', data: { scale, originX, originY } }, true);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (stateRef.current.toolMode) {
      e.preventDefault();
      tools.onWheelSize(e.deltaY);
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? -0.15 : 0.15);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), scale: stateRef.current.slideZoom.scale };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current.dist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      const wrap = wrapperRef.current;
      const cur = stateRef.current.slideZoom;
      let { originX, originY } = cur;
      if (cur.scale <= 1 && wrap) {
        const r = wrap.getBoundingClientRect();
        originX = ((mid.x - r.left) / r.width) * 100;
        originY = ((mid.y - r.top) / r.height) * 100;
      }
      const scale = Math.min(Math.max(pinchRef.current.scale * (dist / pinchRef.current.dist), 1), 5);
      dispatchRef.current({ type: 'slideZoom', data: { scale, originX, originY } }, true);
    }
  };

  const zoom = ui.slideZoom;
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black"
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onMouseDown={tools.onMouseDown}
      onMouseMove={(e) => {
        revealBar();
        tools.onMouseMove(e);
      }}
      onMouseUp={tools.onMouseUp}
    >
      <div
        ref={wrapperRef}
        style={
          zoom.scale > 1
            ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.originX}% ${zoom.originY}%` }
            : undefined
        }
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      {ui.blackScreen && <div className="fixed inset-0 z-10 bg-black" />}
      {!ready && <div className="fixed inset-0 z-20 bg-black" />}

      {/* Auto-hiding toolbar */}
      <div
        className={`fixed bottom-4 left-1/2 z-30 -translate-x-1/2 transition-opacity ${
          barVisible || ui.toolMode ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onMouseEnter={revealBar}
      >
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
          showShortcuts
        />
      </div>
    </div>
  );
}

const el = document.getElementById('presenter-root');
if (el) createRoot(el).render(<AudienceApp />);
