import { useEffect, useState } from 'react';
import type { DecorativeImage, DecorativeImageStyle } from '@shared/types';
import { DECORATIVE_IMAGE_STYLES, DEFAULT_DECORATIVE_IMAGE_STYLE, imageStyleTemplate } from '@shared/imageStyles';
import { Icon } from './ui';
import { t } from '../i18n';

export type DecorativeImageQueueAction = 'generate' | 'retry' | 'regenerate';

/** The design workshop for a decorative image: preview + style + editable scene.
 *  Kept out of the main views so Inmersión and Deep Research stay uncluttered. */
export function DecorativeImageModal({
  image,
  dataUrl,
  defaultStyle = DEFAULT_DECORATIVE_IMAGE_STYLE,
  busy,
  error,
  onQueue,
  onDelete,
  onClose,
}: {
  image: DecorativeImage | null;
  dataUrl: string | null;
  defaultStyle?: DecorativeImageStyle;
  busy: boolean;
  error: string | null;
  onQueue: (action: DecorativeImageQueueAction, opts: { style: DecorativeImageStyle; visualContext?: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const status = image?.status ?? 'not_requested';
  const [style, setStyle] = useState<DecorativeImageStyle>(image?.style ?? defaultStyle);
  const [description, setDescription] = useState(image?.visualContext ?? '');
  const [touched, setTouched] = useState(false);

  // Reflect an AI-generated scene as it arrives, but never clobber the user's edits.
  useEffect(() => {
    if (!touched) setDescription(image?.visualContext ?? '');
  }, [image?.visualContext, touched]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const styleChanged = style !== (image?.style ?? defaultStyle);
  const descChanged = description.trim() !== (image?.visualContext ?? '').trim();
  const edited = styleChanged || descChanged;

  const primary: { action: DecorativeImageQueueAction; label: string; icon: string } =
    status === 'not_requested'
      ? { action: 'generate', label: t('Generar imagen'), icon: 'palette' }
      : status === 'failed' && !edited
        ? { action: 'retry', label: t('Reintentar'), icon: 'refresh' }
        : { action: 'regenerate', label: t('Regenerar'), icon: 'refresh' };

  const run = () => onQueue(primary.action, { style, visualContext: description.trim() || undefined });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Diseño de la imagen')}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="palette" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Diseño de la imagen')}</h2>
            <p className="text-xs text-neutral-500">{t('Ajusta el estilo y la escena. Se genera una imagen nueva.')}</p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/60">
            {status === 'ready' && dataUrl ? (
              <img src={dataUrl} alt="" decoding="async" className="aspect-[16/9] w-full object-cover" />
            ) : status === 'pending' ? (
              <div className="flex aspect-[16/9] items-center justify-center gap-2 text-sm text-indigo-600 dark:text-indigo-300">
                <Icon name="sync" className="animate-spin" /> {t('Generando imagen decorativa en segundo plano…')}
              </div>
            ) : status === 'failed' ? (
              <div className="flex aspect-[16/9] flex-col items-center justify-center gap-1 px-6 text-center text-xs text-amber-700 dark:text-amber-300">
                <Icon name="alert" size={18} />
                <div>{t('La imagen no pudo generarse. El contenido está guardado y funciona con normalidad.')}</div>
                {image?.error && <div className="mt-1 break-words text-amber-600/70 dark:text-amber-400/70">{image.error}</div>}
              </div>
            ) : (
              <div className="flex aspect-[16/9] items-center justify-center px-6 text-center text-xs text-neutral-500">
                {t('La imagen aparecerá aquí una vez generada.')}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Estilo')}</span>
            <select
              className="input mt-1 w-full !py-2 text-sm"
              value={style}
              disabled={status === 'pending'}
              onChange={(event) => setStyle(event.target.value as DecorativeImageStyle)}
            >
              {DECORATIVE_IMAGE_STYLES.map((entry) => (
                <option key={entry.id} value={entry.id}>{t(entry.label)}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción de la escena')}</span>
            <textarea
              className="input mt-1 min-h-24 w-full resize-y text-sm"
              value={description}
              disabled={status === 'pending'}
              onChange={(event) => {
                setTouched(true);
                setDescription(event.target.value);
              }}
              placeholder={t('Describe la escena que quieres ver. Si lo dejas vacío, se deduce del contenido.')}
            />
            <span className="mt-1 block text-[11px] text-neutral-500">
              {t('El estilo y las protecciones de «sin texto» se aplican automáticamente al generar.')}
            </span>
          </label>

          {error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              {error}
            </div>
          )}

          <div className="text-[11px] text-neutral-500">
            {t('Al generar se solicita una imagen nueva, que puede tener un coste adicional.')}
          </div>
          <div className="text-[11px] text-neutral-500">
            {t(imageStyleTemplate(style).label)}
            {image?.provider && image.model ? ` · ${image.provider}/${image.model}` : ''}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {status !== 'not_requested' && (
            <button
              className="btn btn-ghost gap-1.5 border border-neutral-300 text-red-600 dark:border-neutral-700 dark:text-red-400"
              onClick={onDelete}
            >
              <Icon name="trash" /> {t('Eliminar imagen')}
            </button>
          )}
          <div className="flex-1" />
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose}>
            {t('Cerrar')}
          </button>
          <button className="btn btn-primary gap-1.5" onClick={run} disabled={busy || status === 'pending'}>
            <Icon name={busy ? 'sync' : primary.icon} className={busy ? 'animate-spin' : ''} /> {primary.label}
          </button>
        </footer>
      </section>
    </div>
  );
}
