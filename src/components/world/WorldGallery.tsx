import { useCallback, useEffect, useState } from 'react';
import type { CharacterImage, CharacterImageKind, DecorativeImageStyle, WorldImageEntityKind } from '@shared/types';
import { CHARACTER_IMAGE_KINDS, CHARACTER_IMAGE_KIND_LABEL } from '@shared/characterLabels';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { Icon } from '../ui';
import { confirm } from '../feedback';
import { PERSON_DOSSIER_ACTION_BUTTON_CLASS, PERSON_DOSSIER_SECTION_CLASS } from '../personDossierLayout';
import { t } from '../../i18n';
import { worldImageUrl } from '../../lib/imageUrl';

/**
 * The gallery of any world entity, at the top of its sheet.
 *
 * Generic over the entity kind because the need is identical everywhere: a place wants
 * several views of one city exactly as a character wants several of one face, and both
 * depend on the same thing to stay recognisable between generations — the visual seed.
 *
 * Every image keeps the prompt that produced it, which is the difference between
 * iterating on a result and guessing again from scratch.
 */
export function WorldGallery({
  entityKind,
  entityId,
  visualSeed,
  appearance,
  onAvatar,
}: {
  entityKind: WorldImageEntityKind;
  entityId: string;
  visualSeed: string | null;
  appearance: string | null;
  /** Only characters have an avatar; without this the action is not offered. */
  onAvatar?: (imageId: string) => Promise<void>;
}) {
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CharacterImageKind>(entityKind === 'place' ? 'other' : 'portrait');
  const [style, setStyle] = useState<DecorativeImageStyle>('contemporary_editorial');

  const load = useCallback(async () => {
    setImages(await window.nodus.listWorldImages(entityKind, entityId));
  }, [entityKind, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canGenerate = Boolean(appearance?.trim() || visualSeed?.trim());

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

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid={`${entityKind}-gallery`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t('Galería')} <span className="text-neutral-600">({images.length})</span>
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            className="input h-8 w-32 text-xs"
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
            onClick={() => void act(() => window.nodus.addWorldImageFromFile(entityKind, entityId, kind))}
          >
            <Icon name="upload" size={12} /> {t('Subir')}
          </button>
          <select
            className="input h-8 w-36 text-xs"
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
            title={canGenerate ? undefined : t('Escribe primero la apariencia en la sección Descripción.')}
            onClick={() => void act(() => window.nodus.generateWorldImage(entityKind, entityId, kind, style))}
          >
            <Icon name="wand" size={12} /> {busy ? t('Generando…') : t('Generar imagen')}
          </button>
        </div>
      </div>

      {!canGenerate && (
        <p className="mb-2 text-[10px] leading-4 text-amber-300">
          {t('Escribe primero la apariencia en la sección Descripción.')}
        </p>
      )}
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      {images.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Sin imágenes todavía.')}</p>
      ) : (
        <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">
          {images.map((image) => (
            <li key={image.imageId} className="overflow-hidden rounded-md border border-neutral-800">
              <WorldThumb image={image} />
              <div className="p-1.5">
                <span className="block truncate text-[10px] uppercase tracking-wide text-neutral-500">
                  {t(CHARACTER_IMAGE_KIND_LABEL[image.kind])}
                  {image.generated ? ' · IA' : ''}
                </span>
                <div className="mt-1 flex gap-0.5">
                  {onAvatar && (
                    <button
                      className="btn btn-ghost h-6 flex-1 justify-center p-0 text-neutral-400 hover:text-neutral-200"
                      title={t('Usar como avatar')}
                      disabled={busy}
                      onClick={() => void act(() => onAvatar(image.imageId))}
                    >
                      <Icon name="user" size={11} />
                    </button>
                  )}
                  <button
                    className="btn btn-ghost h-6 flex-1 justify-center p-0 text-red-300 hover:text-red-200"
                    title={t('Eliminar')}
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('Eliminar imagen'),
                        message: t('¿Eliminar esta imagen de la galería?'),
                        confirmLabel: t('Eliminar'),
                        danger: true,
                      });
                      if (ok) await act(() => window.nodus.deleteWorldImage(image.imageId));
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One thumbnail, served directly through Chromium's cached internal image protocol. */
function WorldThumb({ image }: { image: CharacterImage }) {
  const url = worldImageUrl(image);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;

  return (
    <div className="aspect-[4/3] w-full bg-neutral-800/40">
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
