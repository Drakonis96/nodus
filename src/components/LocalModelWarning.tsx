import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isLocalModelProvider } from '@shared/providers';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * The red caution mark that accompanies every selection that ends up running on this
 * machine: the models Nodus bundles (`nodus`) and the ones a local server (Ollama,
 * LM Studio) serves.
 *
 * It exists because that choice is not free. A local model competes for the same CPU,
 * GPU and RAM as the rest of the app, and the corpus pipelines hand it whole documents
 * in batches — a run a cloud model finishes in seconds can take minutes here, or stall
 * a modest machine outright. The bundled models are still being tuned, so a local
 * choice is an informed opt-in rather than a safe default, which is why the pickers
 * never preselect one and why this mark is deliberately red instead of the amber the
 * app uses for advice.
 *
 * Hover shows the notice; a click pins it (the text is long enough to want to read and
 * re-read). It renders through a portal because pickers live inside scroll containers
 * and dialogs whose overflow would otherwise clip it.
 */
export function LocalModelWarning({
  provider,
  className = '',
  size = 16,
  testId = 'local-model-warning',
}: {
  /** The provider of the current selection; the mark only appears for local ones. */
  provider: string | null | undefined;
  className?: string;
  size?: number;
  testId?: string;
}) {
  if (!isLocalModelProvider(provider)) return null;
  return <LocalModelWarningButton className={className} size={size} testId={testId} />;
}

function LocalModelWarningButton({ className, size, testId }: { className: string; size: number; testId: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const tooltipId = `${testId}-tooltip`;

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      const height = tooltipRef.current?.offsetHeight ?? 200;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 8);
      setPosition({ left, top, width });
    };
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // A pinned notice closes on Escape or on a click that lands outside it, so it can be
  // left open to finish reading without trapping the pointer.
  useEffect(() => {
    if (!pinned) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return;
      setPinned(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [pinned]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        // `grid` + `place-items-center` centres the glyph exactly: as a grid item the svg
        // is blockified, so the line box of the trigger cannot push it off-centre the way
        // an inline baseline does.
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border border-red-500/70 bg-red-500/10 text-red-600 transition-colors hover:bg-red-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-500 dark:border-red-500/70 dark:text-red-400 ${className}`}
        aria-label={t('Aviso sobre los modelos locales')}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => { if (!pinned) setHovered(false); }}
        onClick={(event) => {
          // Beside a picker, a click must never fall through to whatever the mark sits on.
          event.preventDefault();
          event.stopPropagation();
          setPinned((current) => !current);
        }}
      >
        <Icon name="warning" size={size} />
      </button>
      {open && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          data-testid={`${testId}-tooltip`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="fixed z-[130] rounded-xl border border-red-400/70 bg-white p-3 text-left shadow-2xl dark:border-red-900 dark:bg-neutral-950 dark:shadow-black/60"
          style={position ? { left: position.left, top: position.top, width: position.width } : { left: -9999, top: -9999, width: 360 }}
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
            <Icon name="warning" size={14} />
            {t('Aviso sobre los modelos locales')}
          </span>
          <p className="mt-2 text-[11px] leading-5 text-neutral-700 dark:text-neutral-300">
            {t('Los modelos locales pueden tardar bastante en procesar, sobre todo en equipos poco potentes. Nodus analiza los documentos por fragmentos en vez de enviarlos todos de golpe, y eso exige recursos incluso a los modelos pequeños.')}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-neutral-700 dark:text-neutral-300">
            {t('Todavía estamos optimizando los modelos locales incluidos. Gemma es ahora mismo la opción recomendada, aunque pueden quedar problemas menores. Ollama y LM Studio también son compatibles; los proveedores en la nube están mucho más probados y siguen siendo la opción más fiable para Nodus.')}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-neutral-700 dark:text-neutral-300">
            {t('Si encuentras cualquier problema, avísanos: los comentarios y las contribuciones que ayuden a mejorar el soporte de modelos locales son siempre bienvenidos.')}
          </p>
        </div>,
        document.body
      )}
    </>
  );
}
