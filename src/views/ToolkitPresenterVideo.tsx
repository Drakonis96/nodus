// PDF Presenter — the per-slide YouTube overlay editor (F5). Shows the slide with a
// draggable/resizable box marking where the video plays (position in % of the slide),
// plus the URL. The video itself is embedded only in the audience window at present
// time; here we just place it. The model update is pure (@shared/presenterTypes
// setVideo); this component drives it and the slide render.
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { setVideo, type Presentation, type PresenterVideo } from '@shared/presenterTypes';
import { extractYouTubeId } from '../lib/presenter/youtube';

const DEFAULT_BOX = { x: 10, y: 10, w: 80, h: 60 };

export function PresenterVideoModal({
  presentation,
  pdfDoc,
  slide,
  onChange,
  onClose,
}: {
  presentation: Presentation;
  pdfDoc: PDFDocumentProxy;
  slide: number;
  onChange: (next: Presentation) => void;
  onClose: () => void;
}) {
  const existing = presentation.videos[String(slide)];
  const [url, setUrl] = useState(existing?.url ?? '');
  const [box, setBox] = useState({
    x: existing?.x ?? DEFAULT_BOX.x,
    y: existing?.y ?? DEFAULT_BOX.y,
    w: existing?.w ?? DEFAULT_BOX.w,
    h: existing?.h ?? DEFAULT_BOX.h,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; mx: number; my: number; box: typeof box } | null>(null);

  // Render the slide once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const page = await pdfDoc.getPage(slide);
      if (cancelled) {
        page.cleanup?.();
        return;
      }
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (!canvas || !stage) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min((stage.clientWidth - 4) / base.width, (stage.clientHeight - 4) / base.height, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
      canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, slide]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    const stage = canvasRef.current;
    if (!d || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = ((e.clientX - d.mx) / rect.width) * 100;
    const dy = ((e.clientY - d.my) / rect.height) * 100;
    setBox(() => {
      if (d.mode === 'move') {
        return {
          ...d.box,
          x: Math.min(Math.max(d.box.x + dx, 0), 100 - d.box.w),
          y: Math.min(Math.max(d.box.y + dy, 0), 100 - d.box.h),
        };
      }
      const aspect = d.box.w / d.box.h;
      const w = Math.min(Math.max(d.box.w + dx, 10), 100 - d.box.x);
      return { ...d.box, w, h: Math.min(w / aspect, 100 - d.box.y) };
    });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, mx: e.clientX, my: e.clientY, box };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  const save = () => {
    const video: PresenterVideo | null = url.trim() ? { url: url.trim(), ...box } : null;
    onChange(setVideo(presentation, slide, video));
    onClose();
  };
  const remove = () => {
    onChange(setVideo(presentation, slide, null));
    onClose();
  };

  const validId = extractYouTubeId(url);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t('Vídeo de la diapositiva')} {slide}
          </h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div ref={stageRef} className="relative flex h-72 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 dark:bg-black">
          <canvas ref={canvasRef} className="block" />
          {/* Video box overlay — positioned in % of the canvas */}
          <div
            onPointerDown={startDrag('move')}
            style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
            className="absolute flex cursor-move items-center justify-center rounded border-2 border-amber-400 bg-amber-400/20"
          >
            <Icon name="play" size={22} className="text-amber-200" />
            <div
              onPointerDown={startDrag('resize')}
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-amber-500"
            />
          </div>
        </div>

        <label className="text-xs text-neutral-500">
          {t('URL de YouTube')}
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40"
          />
        </label>
        {url.trim() && !validId && <p className="text-xs text-red-500">{t('No se reconoce el enlace de YouTube.')}</p>}

        <div className="flex items-center justify-between">
          {existing ? (
            <button type="button" onClick={remove} className="btn btn-ghost h-9 min-h-9 px-3 text-sm text-red-600">
              {t('Quitar vídeo')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost h-9 min-h-9 px-3 text-sm">
              {t('Cancelar')}
            </button>
            <button type="button" onClick={save} disabled={!!url.trim() && !validId} className="btn btn-accent h-9 min-h-9 px-3 text-sm disabled:opacity-50">
              {t('Guardar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
