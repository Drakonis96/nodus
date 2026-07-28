import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { t } from '../i18n';

export interface ImageLightboxItem {
  id: string;
  src: string;
  alt: string;
  label?: string | null;
  meta?: string | null;
}

/**
 * One full-screen viewer for every worldbuilding image surface.
 *
 * It deliberately receives URLs rather than blobs: the internal image protocol keeps
 * Chromium's cache useful while the full gallery remains navigable without another IPC
 * round-trip. The full image is always contained, never cropped like its card thumbnail.
 */
export function ImageLightbox({
  items,
  activeId,
  onClose,
}: {
  items: ImageLightboxItem[];
  activeId: string;
  onClose: () => void;
}) {
  const available = useMemo(() => items.filter((item) => Boolean(item.src)), [items]);
  const [currentId, setCurrentId] = useState(activeId);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const currentIndex = Math.max(0, available.findIndex((item) => item.id === currentId));
  const current = available[currentIndex] ?? null;

  useEffect(() => {
    setCurrentId(activeId);
  }, [activeId]);

  useEffect(() => {
    setDownloadError(null);
  }, [currentId]);

  useEffect(() => {
    if (available.length === 0) {
      onClose();
      return;
    }
    if (!available.some((item) => item.id === currentId)) {
      setCurrentId(available[0].id);
    }
  }, [available, currentId, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const move = (delta: number) => {
    if (available.length < 2) return;
    const next = (currentIndex + delta + available.length) % available.length;
    setCurrentId(available[next].id);
  };

  const downloadOriginal = async () => {
    if (!current || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await window.nodus.downloadOriginalImage(current.src, current.label || current.alt);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'Home' && available[0]) setCurrentId(available[0].id);
      if (event.key === 'End' && available.at(-1)) setCurrentId(available.at(-1)!.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex flex-col bg-black/95 text-white"
      data-testid="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('Galería')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <Icon name="image" size={16} className="text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{current.label || t('Galería')}</span>
        <span className="text-xs tabular-nums text-neutral-400">
          {currentIndex + 1} / {available.length}
        </span>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
          aria-label={t('Descargar')}
          title={t('Descargar')}
          disabled={downloading}
          onClick={() => void downloadOriginal()}
          data-testid="image-lightbox-download"
        >
          <Icon name={downloading ? 'sync' : 'download'} size={17} className={downloading ? 'animate-spin' : ''} />
        </button>
        <button
          autoFocus
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white"
          aria-label={t('Cerrar')}
          onClick={onClose}
        >
          <Icon name="x" size={18} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <img
          key={current.id}
          src={current.src}
          alt={current.alt}
          draggable={false}
          className="h-full w-full select-none object-contain p-4 sm:p-8"
        />
        {available.length > 1 && (
          <>
            <button
              type="button"
              className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 hover:bg-black/80 sm:left-5"
              aria-label={t('Anterior')}
              onClick={() => move(-1)}
            >
              <Icon name="chevronLeft" size={22} />
            </button>
            <button
              type="button"
              className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 hover:bg-black/80 sm:right-5"
              aria-label={t('Siguiente')}
              onClick={() => move(1)}
            >
              <Icon name="chevronRight" size={22} />
            </button>
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-white/10 bg-black/80 px-4 py-3">
        {downloadError && (
          <p className="mx-auto mb-2 max-w-4xl text-center text-xs text-red-300" role="alert">
            {downloadError}
          </p>
        )}
        {(current.label || current.meta) && (
          <div className="mx-auto mb-2 max-w-4xl text-center">
            {current.label && <p className="truncate text-sm text-neutral-100">{current.label}</p>}
            {current.meta && <p className="truncate text-xs text-neutral-400">{current.meta}</p>}
          </div>
        )}
        {available.length > 1 && (
          <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto pb-1" data-testid="image-lightbox-thumbnails">
            {available.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-neutral-900 ${
                  item.id === current.id ? 'border-indigo-400' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                aria-label={`${index + 1} / ${available.length}${item.label ? ` · ${item.label}` : ''}`}
                aria-current={item.id === current.id ? 'true' : undefined}
                onClick={() => setCurrentId(item.id)}
              >
                <img src={item.src} alt="" draggable={false} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>,
    document.body
  );
}
