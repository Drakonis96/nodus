import { useEffect, useRef, useState } from 'react';
import type { DecorativeImage, DecorativeImageEntityKind, DecorativeImageStyle } from '@shared/types';
import { DECORATIVE_IMAGE_STYLES, imageStyleTemplate } from '@shared/imageStyles';
import { confirm } from './feedback';
import { Icon } from './ui';
import { t } from '../i18n';

export function DecorativeImageCard({
  entityKind,
  entityId,
  image,
  defaultStyle,
  thumbnail = false,
  interactive = false,
  className = '',
  onChange,
}: {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  image: DecorativeImage | null;
  defaultStyle: DecorativeImageStyle;
  thumbnail?: boolean;
  interactive?: boolean;
  className?: string;
  onChange?: (image: DecorativeImage) => void;
}) {
  const [current, setCurrent] = useState(image);
  const [style, setStyle] = useState<DecorativeImageStyle>(image?.style ?? defaultStyle);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setCurrent(image);
    setStyle(image?.style ?? defaultStyle);
  }, [image, defaultStyle]);

  useEffect(() => {
    let mounted = true;
    void window.nodus.getDecorativeImage(entityKind, entityId).then((next) => {
      if (!mounted || !next) return;
      setCurrent(next);
      setStyle(next.style);
      onChangeRef.current?.(next);
    }).catch(() => {
      /* The owner content remains usable; event updates can still arrive. */
    });
    return () => {
      mounted = false;
    };
  }, [entityKind, entityId]);

  useEffect(() => {
    return window.nodus.onDecorativeImageChanged((next) => {
      if (next.entityKind !== entityKind || next.entityId !== entityId) return;
      setCurrent(next);
      setBusy(false);
      onChangeRef.current?.(next);
    });
  }, [entityKind, entityId]);

  useEffect(() => {
    let active = true;
    if (current?.status !== 'ready') {
      setDataUrl(null);
      return;
    }
    void window.nodus.getDecorativeImageDataUrl(entityKind, entityId, thumbnail).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [current?.status, current?.updatedAt, entityKind, entityId, thumbnail]);

  const queue = async (action: 'generate' | 'retry' | 'regenerate') => {
    if (action === 'regenerate') {
      const ok = await confirm({
        title: t('Regenerar imagen'),
        message: t('Se realizará una nueva generación y puede producir un coste adicional. ¿Continuar?'),
        confirmLabel: t('Regenerar'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const pending = await window.nodus.queueDecorativeImage({ entityKind, entityId, action, style });
      setCurrent(pending);
      setStyle(pending.style);
      onChange?.(pending);
    } catch (reason) {
      setBusy(false);
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar imagen'),
      message: t('La imagen se eliminará del almacenamiento local. El contenido principal no cambiará.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      const next = await window.nodus.deleteDecorativeImage(entityKind, entityId);
      setCurrent(next);
      setDataUrl(null);
      setBusy(false);
      onChange?.(next);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (thumbnail) {
    if (current?.status !== 'ready' || !dataUrl) return null;
    return <img src={dataUrl} alt="" loading="lazy" decoding="async" className={`h-24 w-full rounded-lg object-cover ${className}`} />;
  }

  const status = current?.status ?? 'not_requested';
  return (
    <section className={`overflow-hidden rounded-xl border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40 ${className}`}>
      {dataUrl && (
        <img src={dataUrl} alt="" decoding="async" className="aspect-[16/9] max-h-[28rem] w-full object-cover" />
      )}
      {status === 'pending' && (
        <div className="flex min-h-32 items-center justify-center gap-2 p-5 text-sm text-indigo-600 dark:text-indigo-300">
          <Icon name="sync" className="animate-spin" /> {t('Generando imagen decorativa en segundo plano…')}
        </div>
      )}
      {status === 'failed' && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <Icon name="alert" size={14} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div>{t('La imagen no pudo generarse. El contenido está guardado y funciona con normalidad.')}</div>
            {current?.error && <div className="mt-1 break-words text-amber-700/70 dark:text-amber-400/70">{current.error}</div>}
          </div>
        </div>
      )}
      {actionError && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          {actionError}
        </div>
      )}
      {interactive && (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <label className="min-w-[13rem] flex-1 text-[10px] uppercase tracking-wide text-neutral-500">
            {t('Estilo')}
            <select className="input mt-1 w-full !py-1.5 text-xs" value={style} onChange={(event) => setStyle(event.target.value as DecorativeImageStyle)} disabled={status === 'pending'}>
              {DECORATIVE_IMAGE_STYLES.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.label)}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2 self-end">
            {status === 'not_requested' && (
              <button className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void queue('generate')}>
                <Icon name={busy ? 'sync' : 'palette'} className={busy ? 'animate-spin' : ''} /> {t('Generar imagen')}
              </button>
            )}
            {status === 'failed' && (
              <button className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void queue('retry')}>
                <Icon name={busy ? 'sync' : 'refresh'} className={busy ? 'animate-spin' : ''} /> {t('Reintentar')}
              </button>
            )}
            {status === 'pending' && (
              <button className="btn btn-ghost gap-1.5 border border-neutral-300 text-red-600 dark:border-neutral-700 dark:text-red-400" onClick={() => void remove()}>
                <Icon name="trash" /> {t('Eliminar imagen')}
              </button>
            )}
            {status === 'ready' && (
              <>
                <button className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700" onClick={() => void queue('regenerate')}>
                  <Icon name="refresh" /> {t('Regenerar')}
                </button>
                <button className="btn btn-ghost gap-1.5 border border-neutral-300 text-red-600 dark:border-neutral-700 dark:text-red-400" onClick={() => void remove()}>
                  <Icon name="trash" /> {t('Eliminar imagen')}
                </button>
              </>
            )}
          </div>
          <div className="w-full text-[10px] text-neutral-600">
            {t(imageStyleTemplate(style).label)}
            {current?.provider && current.model ? ` · ${current.provider}/${current.model}` : ''}
          </div>
        </div>
      )}
    </section>
  );
}
