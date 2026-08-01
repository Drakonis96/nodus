import { useEffect, useMemo, useRef, useState } from 'react';
import type { DecorativeImage, DecorativeImageStyle, ImageModelInfo, ImageProvider } from '@shared/types';
import { DECORATIVE_IMAGE_STYLES, DEFAULT_DECORATIVE_IMAGE_STYLE, imageStyleTemplate } from '@shared/imageStyles';
import { IMAGE_PROVIDER_LABELS } from '@shared/providers';
import { Icon } from './ui';
import { t } from '../i18n';

export type DecorativeImageQueueAction = 'generate' | 'retry' | 'regenerate';

/** A provider+model pair encoded for a <select>, whose value is a single string. */
const engineKey = (provider: ImageProvider, model: string) => `${provider} ${model}`;

function parseEngineKey(value: string): { provider: ImageProvider; model: string } | null {
  const separator = value.indexOf(' ');
  if (separator < 0) return null;
  return { provider: value.slice(0, separator) as ImageProvider, model: value.slice(separator + 1) };
}

/** The design workshop for a decorative image: preview + style + editable scene.
 *  Kept out of the main views so Inmersión and Deep Research stay uncluttered. */
export function DecorativeImageModal({
  image,
  dataUrl,
  defaultStyle = DEFAULT_DECORATIVE_IMAGE_STYLE,
  busy,
  error,
  onQueue,
  onUpload,
  onRevert,
  onDelete,
  onSuggest,
  onClose,
}: {
  image: DecorativeImage | null;
  dataUrl: string | null;
  defaultStyle?: DecorativeImageStyle;
  busy: boolean;
  error: string | null;
  onQueue: (
    action: DecorativeImageQueueAction,
    opts: { style: DecorativeImageStyle; visualContext?: string; provider?: ImageProvider; model?: string }
  ) => void;
  onUpload: (file: File) => void;
  onRevert: () => void;
  onDelete: () => void;
  /** Streams a scene description written from the owner content. Resolves to the final text. */
  onSuggest?: (onDelta: (delta: string) => void) => Promise<string>;
  onClose: () => void;
}) {
  const status = image?.status ?? 'not_requested';
  const [style, setStyle] = useState<DecorativeImageStyle>(image?.style ?? defaultStyle);
  const [description, setDescription] = useState(image?.visualContext ?? '');
  const [touched, setTouched] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The engine for THIS image. An image that exists keeps the engine that made it, so
  // regenerating stays consistent — but a FAILED one deliberately does not: the engine
  // that just refused is the least likely thing the user wants next, and switching
  // provider in Ajustes is precisely how they react to a failure. So a failed image
  // starts on the current default instead, which is what "I changed it in Ajustes and
  // it still used ChatGPT" was really asking for. `null` means "not resolved yet" — the
  // settings read is async, and guessing would generate with the wrong model.
  const keepsOwnEngine = status !== 'failed' && Boolean(image?.provider && image?.model);
  const [engine, setEngine] = useState<{ provider: ImageProvider; model: string } | null>(
    keepsOwnEngine ? { provider: image!.provider!, model: image!.model! } : null
  );
  const [catalogue, setCatalogue] = useState<ImageModelInfo[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  /**
   * Write the model's answer into the box as it arrives. The text is the user's from
   * the first character — they can edit it, wipe it, or just close the modal — so it
   * counts as touched and the stored context must never overwrite it afterwards.
   */
  const suggest = async () => {
    if (!onSuggest || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setTouched(true);
    setDescription('');
    try {
      const final = await onSuggest((delta) => setDescription((current) => current + delta));
      // The stream arrives raw; the resolved value is the same text collapsed to the
      // single line the generator would actually receive.
      setDescription(final);
    } catch (reason) {
      setSuggestError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSuggesting(false);
    }
  };

  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  };

  // Reflect an AI-generated scene as it arrives, but never clobber the user's edits.
  useEffect(() => {
    if (!touched) setDescription(image?.visualContext ?? '');
  }, [image?.visualContext, touched]);

  // An image that has never been generated has no engine of its own, so the default
  // from Ajustes fills the picker. Read once, on open, and never again: overwriting a
  // choice the user just made in the picker is exactly the bug this modal fixes.
  useEffect(() => {
    if (engine) return;
    let mounted = true;
    void window.nodus.getSettings().then((settings) => {
      if (mounted) setEngine({ provider: settings.imageProvider, model: settings.imageModel });
    }).catch(() => {
      /* The picker stays on "loading" and the button stays disabled; nothing is generated blind. */
    });
    return () => {
      mounted = false;
    };
    // Deliberately empty: `engine` is read as a guard, not as a dependency. Re-running
    // this on every change would overwrite the choice the user just made in the picker.
  }, []);

  // The full catalogue, so the engine can be changed here instead of only in Ajustes.
  // It is a live query (OpenRouter and the ChatGPT catalogue are fetched), so a failure
  // must not block the modal: the current engine stays selectable on its own.
  useEffect(() => {
    let mounted = true;
    void window.nodus.listImageModels().then((models) => {
      if (mounted) setCatalogue(models);
    }).catch((reason) => {
      if (mounted) setCatalogueError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      mounted = false;
    };
  }, []);

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

  /**
   * The picker's options, grouped by provider. The selected engine is always among
   * them even when the catalogue does not list it: a model can be withdrawn by its
   * provider, and the catalogue is a live query that can simply fail — in either case
   * the picker must still show what this image is set to rather than jump to another
   * model behind the user's back.
   */
  const engineGroups = useMemo(() => {
    const entries = (catalogue ?? []).map((model) => ({
      provider: model.provider,
      model: model.id,
      name: model.name,
      price: model.imagePriceLabel,
    }));
    if (engine && !entries.some((entry) => entry.provider === engine.provider && entry.model === engine.model)) {
      entries.push({ provider: engine.provider, model: engine.model, name: engine.model, price: null });
    }
    const byProvider = new Map<ImageProvider, typeof entries>();
    for (const entry of entries) {
      const group = byProvider.get(entry.provider);
      if (group) group.push(entry);
      else byProvider.set(entry.provider, [entry]);
    }
    return [...byProvider.entries()].sort((a, b) =>
      (IMAGE_PROVIDER_LABELS[a[0]] ?? a[0]).localeCompare(IMAGE_PROVIDER_LABELS[b[0]] ?? b[0])
    );
  }, [catalogue, engine]);

  const primary: { action: DecorativeImageQueueAction; label: string; icon: string } =
    status === 'not_requested'
      ? { action: 'generate', label: t('Generar imagen'), icon: 'palette' }
      : status === 'failed' && !edited
        ? { action: 'retry', label: t('Reintentar'), icon: 'refresh' }
        : { action: 'regenerate', label: t('Regenerar'), icon: 'refresh' };

  const run = () => onQueue(primary.action, {
    style,
    visualContext: description.trim() || undefined,
    provider: engine?.provider,
    model: engine?.model,
  });

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
              // One message, not two. The headline used to be a generic sentence that
              // also reassured about the report, with the provider's actual reason
              // printed under it — which read as two answers contradicting each other.
              // The reason IS the message; the reassurance is a footnote.
              <div className="flex aspect-[16/9] flex-col items-center justify-center gap-1 px-6 text-center text-xs text-amber-700 dark:text-amber-300">
                <Icon name="alert" size={18} />
                <div className="break-words font-medium">{t(image?.error || 'La imagen no pudo generarse.')}</div>
                <div className="mt-1 text-amber-600/70 dark:text-amber-400/70">
                  {t('El contenido está guardado y funciona con normalidad.')}
                </div>
              </div>
            ) : (
              <div className="flex aspect-[16/9] items-center justify-center px-6 text-center text-xs text-neutral-500">
                {t('La imagen aparecerá aquí una vez generada.')}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
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
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {t('Modelo de imagen')}
              </span>
              <select
                className="input mt-1 w-full !py-2 text-sm"
                value={engine ? engineKey(engine.provider, engine.model) : ''}
                disabled={status === 'pending' || !engine}
                onChange={(event) => {
                  const picked = parseEngineKey(event.target.value);
                  if (picked) setEngine(picked);
                }}
              >
                {!engine && <option value="">{t('Cargando modelos…')}</option>}
                {engineGroups.map(([provider, entries]) => (
                  <optgroup key={provider} label={IMAGE_PROVIDER_LABELS[provider] ?? provider}>
                    {entries.map((entry) => (
                      <option key={engineKey(provider, entry.model)} value={engineKey(provider, entry.model)}>
                        {entry.name}{entry.price ? ` · ${entry.price}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-neutral-500">
                {catalogueError
                  ? t('No se pudo consultar el catálogo completo: solo está disponible el modelo actual.')
                  : catalogue === null
                    ? t('Consultando catálogos oficiales…')
                    : t('Solo para esta imagen. El predeterminado se cambia en Ajustes → Proveedores.')}
              </span>
            </label>
          </div>

          <label className="block">
            <span className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción de la escena')}</span>
              {onSuggest && (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 transition hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                  onClick={() => void suggest()}
                  disabled={suggesting || status === 'pending'}
                  title={t('Escribe la escena a partir del contenido de este informe')}
                >
                  <Icon name={suggesting ? 'sync' : 'wand'} size={12} className={suggesting ? 'animate-spin' : ''} />
                  {suggesting ? t('Escribiendo…') : t('Sugerir con IA')}
                </button>
              )}
            </span>
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
            {suggestError && (
              <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-400">{suggestError}</span>
            )}
          </label>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700"
                onClick={() => fileRef.current?.click()}
                disabled={busy || status === 'pending'}
              >
                <Icon name="upload" size={14} /> {t('Subir mi imagen')}
              </button>
              {image?.hasPrevious && (
                <button
                  className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700"
                  onClick={onRevert}
                  disabled={busy || status === 'pending'}
                >
                  <Icon name="chevronLeft" size={14} /> {t('Volver a la imagen anterior')}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-500">
              {t('Tu imagen se comprime automáticamente para no sobrecargar el almacenamiento.')}
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              {t(error)}
            </div>
          )}

          <div className="text-[11px] text-neutral-500">
            {t('Al generar se solicita una imagen nueva, que puede tener un coste adicional.')}
          </div>
          <div className="text-[11px] text-neutral-500">
            {t(imageStyleTemplate(style).label)}
            {/* What the button will USE, not what last ran: the two differ the moment
                the picker above is touched, and showing the stale pair is what made a
                changed provider look like it had not been applied. */}
            {engine ? ` · ${engine.provider}/${engine.model}` : ''}
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
          <button className="btn btn-primary gap-1.5" onClick={run} disabled={busy || status === 'pending' || !engine}>
            <Icon name={busy ? 'sync' : primary.icon} className={busy ? 'animate-spin' : ''} /> {primary.label}
          </button>
        </footer>
      </section>
    </div>
  );
}
