import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character, CharacterImage, CharacterImageKind, DecorativeImageStyle } from '@shared/types';
import { CHARACTER_IMAGE_KINDS, CHARACTER_IMAGE_KIND_LABEL } from '@shared/characterLabels';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { Icon } from './ui';
import { confirm } from './feedback';
import { PERSON_DOSSIER_ACTION_BUTTON_CLASS, PERSON_DOSSIER_SECTION_CLASS } from './personDossierLayout';
import { t, tx } from '../i18n';
import { personPortraitUrl, worldImageUrl } from '../lib/imageUrl';
import { ImageLightbox, type ImageLightboxItem } from './ImageLightbox';

/**
 * Every image of a character, not just the avatar: the portrait, the full body, the
 * expressions, how they looked twenty years earlier.
 *
 * Each image keeps the prompt that produced it, which is the difference between
 * iterating on a result and guessing again from scratch — so the prompt is shown and
 * copyable rather than hidden in the database.
 */
export function CharacterGallery({ character, onChanged }: { character: Character; onChanged: () => Promise<void> }) {
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CharacterImageKind>('portrait');
  const [style, setStyle] = useState<DecorativeImageStyle>('contemporary_editorial');
  const [extra, setExtra] = useState('');
  const [inspecting, setInspecting] = useState<CharacterImage | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setImages(await window.nodus.listCharacterImages(character.personId));
  }, [character.personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canGenerate = Boolean(character.profile.appearance?.trim() || character.profile.visualSeed?.trim());
  const portraitUrl = personPortraitUrl(character);
  const lightboxItems: ImageLightboxItem[] = [
    ...(portraitUrl ? [{
      id: `portrait:${character.personId}`,
      src: portraitUrl,
      alt: character.displayName,
      label: t('Imagen del personaje'),
      meta: character.portrait?.generated ? 'IA' : null,
    }] : []),
    ...images.map((image) => ({
      id: image.imageId,
      src: worldImageUrl(image),
      alt: image.label ? `${character.displayName} · ${image.label}` : character.displayName,
      label: image.label ?? t(CHARACTER_IMAGE_KIND_LABEL[image.kind]),
      meta: image.generated ? 'IA' : null,
    })),
  ];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (image: CharacterImage) => {
    const ok = await confirm({
      title: t('Eliminar imagen'),
      message: t('¿Eliminar esta imagen de la galería? Si es el avatar del personaje, el avatar se conserva.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await act(async () => {
      await window.nodus.deleteCharacterImage(image.imageId);
    });
  };

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-dossier-gallery">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Galería')} <span className="text-neutral-600">({images.length})</span>
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            className="input h-8 w-36 text-xs"
            value={kind}
            aria-label={t('Tipo de imagen')}
            disabled={busy}
            onChange={(event) => setKind(event.target.value as CharacterImageKind)}
          >
            {CHARACTER_IMAGE_KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {t(CHARACTER_IMAGE_KIND_LABEL[entry])}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 text-xs"
            disabled={busy}
            onClick={() => void act(() => window.nodus.addCharacterImageFromFile(character.personId, kind))}
          >
            <Icon name="upload" size={12} /> {t('Subir')}
          </button>
        </div>
      </div>

      <div className="mb-3 space-y-1.5 rounded-md border border-indigo-900/40 bg-indigo-950/10 p-2">
        {canGenerate ? (
          <p className="text-[10px] leading-4 text-neutral-500">
            {tx('Se generará una imagen de tipo «{kind}» con la apariencia y la semilla visual de la ficha.', {
              kind: t(CHARACTER_IMAGE_KIND_LABEL[kind]),
            })}
          </p>
        ) : (
          <p className="text-[10px] leading-4 text-amber-300">
            {t('Escribe primero la apariencia del personaje en la sección Descripción.')}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <select
            className="input h-8 min-w-40 flex-1 text-xs"
            value={style}
            aria-label={t('Estilo')}
            disabled={busy}
            onChange={(event) => setStyle(event.target.value as DecorativeImageStyle)}
          >
            {DECORATIVE_IMAGE_STYLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(entry.label)}
              </option>
            ))}
          </select>
          <button
            className={PERSON_DOSSIER_ACTION_BUTTON_CLASS}
            disabled={busy || !canGenerate}
            onClick={() =>
              void act(async () => {
                await window.nodus.generateCharacterImage(character.personId, kind, style, extra.trim() || null);
                setExtra('');
              })
            }
          >
            <Icon name="wand" size={12} /> {busy ? t('Generando…') : t('Generar imagen')}
          </button>
        </div>
        <input
          className="input h-8 w-full text-xs"
          placeholder={t('Solo para esta imagen: pose, gesto, ropa, luz… (opcional)')}
          aria-label={t('Solo para esta imagen: pose, gesto, ropa, luz… (opcional)')}
          value={extra}
          disabled={busy}
          onChange={(event) => setExtra(event.target.value)}
        />
      </div>

      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      {images.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Sin imágenes todavía.')}</p>
      ) : (
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">
          {images.map((image) => (
            <li key={image.imageId} className="overflow-hidden rounded-md border border-neutral-800">
              <button
                className="group relative block w-full"
                title={t('Ver detalles')}
                aria-label={t('Ver detalles')}
                onClick={() => setViewingId(image.imageId)}
              >
                <GalleryThumb image={image} />
                <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Icon name="fit" size={13} />
                </span>
              </button>
              <div className="p-1.5">
                <span className="block truncate text-[10px] uppercase tracking-wide text-neutral-500">
                  {t(CHARACTER_IMAGE_KIND_LABEL[image.kind])}
                  {image.generated ? ' · IA' : ''}
                </span>
                {image.label && <span className="block truncate text-[11px] text-neutral-300">{image.label}</span>}
                <div className="mt-1 flex gap-0.5">
                  <button
                    className="btn btn-ghost h-6 flex-1 justify-center p-0 text-[10px] text-neutral-400 hover:text-neutral-200"
                    title={t('Ver detalles')}
                    aria-label={t('Ver detalles')}
                    disabled={busy}
                    onClick={() => setInspecting(image)}
                  >
                    <Icon name="edit" size={11} />
                  </button>
                  <button
                    className="btn btn-ghost h-6 flex-1 justify-center p-0 text-[10px] text-neutral-400 hover:text-neutral-200"
                    title={t('Usar como avatar')}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await window.nodus.setCharacterAvatarFromImage(image.imageId);
                        await onChanged();
                      })
                    }
                  >
                    <Icon name="user" size={11} />
                  </button>
                  <button
                    className="btn btn-ghost h-6 flex-1 justify-center p-0 text-[10px] text-red-300 hover:text-red-200"
                    title={t('Eliminar')}
                    disabled={busy}
                    onClick={() => void remove(image)}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {inspecting && (
        <GalleryDetail
          image={inspecting}
          onClose={() => setInspecting(null)}
          onSaved={async () => {
            setInspecting(null);
            await load();
          }}
        />
      )}
      {viewingId && (
        <ImageLightbox
          items={lightboxItems}
          activeId={viewingId}
          onClose={() => setViewingId(null)}
        />
      )}
    </section>
  );
}

/** One thumbnail, served directly through Chromium's cached internal image protocol. */
function GalleryThumb({ image }: { image: CharacterImage }) {
  const url = worldImageUrl(image);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;

  return (
    <div className="aspect-[3/4] w-full bg-neutral-800/40">
      {!failed ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <div className="grid h-full place-items-center">
          <Icon name="image" size={18} className="text-neutral-600" />
        </div>
      )}
    </div>
  );
}

/** The full image, its metadata, and the prompt that made it — copyable, to iterate on. */
function GalleryDetail({
  image,
  onClose,
  onSaved,
}: {
  image: CharacterImage;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(image.label ?? '');
  const [kind, setKind] = useState<CharacterImageKind>(image.kind);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await window.nodus.updateCharacterImage(image.imageId, { kind, label: label.trim() || null });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="card-modal max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-detail-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="gallery-detail-title" className="text-base font-semibold text-neutral-100">
              {t('Imagen del personaje')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {image.generated ? t('Generada con IA') : t('Subida por ti')}
              {' · '}
              {new Date(image.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
          <GalleryThumb image={image} />
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {t('Tipo de imagen')}
              </span>
              <select
                className="input h-9 w-full text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value as CharacterImageKind)}
              >
                {CHARACTER_IMAGE_KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(CHARACTER_IMAGE_KIND_LABEL[entry])}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {t('Etiqueta')}
              </span>
              <input
                className="input h-9 w-full text-sm"
                value={label}
                placeholder={t('p. ej. «De pie en la sala del trono»')}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            {image.prompt && (
              <div>
                <span className="mb-1 flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    {t('Prompt que la generó')}
                  </span>
                  <button
                    className="ml-auto text-[10px] text-indigo-400 hover:text-indigo-300"
                    onClick={() => {
                      void navigator.clipboard.writeText(image.prompt ?? '');
                      setCopied(true);
                    }}
                  >
                    {copied ? t('Copiado') : t('Copiar')}
                  </button>
                </span>
                <p className="max-h-32 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] leading-4 text-neutral-400">
                  {image.prompt}
                </p>
                <p className="mt-1 text-[10px] text-neutral-600">
                  {[image.provider, image.model].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
              <button
                className="btn btn-ghost border border-neutral-700 px-3 text-xs"
                onClick={onClose}
                disabled={saving}
              >
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary min-w-32" disabled={saving} onClick={() => void save()}>
                {saving ? t('Guardando…') : t('Guardar cambios')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
