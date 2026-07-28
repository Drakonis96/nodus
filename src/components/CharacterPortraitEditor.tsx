import { useEffect, useRef, useState } from 'react';
import type { Character, DecorativeImageStyle, PortraitFocus } from '@shared/types';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { CHARACTER_IMAGE_KIND_LABEL } from '@shared/characterLabels';
import { Icon } from './ui';
import { CharacterPortrait } from './CharacterPortrait';
import { ImageLightbox, type ImageLightboxItem } from './ImageLightbox';
import { useDismissableLayer } from '../hooks';
import { t } from '../i18n';
import { personPortraitUrl, worldImageUrl } from '../lib/imageUrl';
import { dragPortraitFocus } from '@shared/portraitFraming';

/**
 * A character's portrait: upload an image and frame it non-destructively, or generate
 * one with AI.
 *
 * The genealogy portrait editor buries generation behind a warning that it is "not
 * recommended" because an invented likeness of a real ancestor is a falsification. For
 * an invented character that reasoning does not apply at all, so here generation is a
 * first-class action — and it needs no description box, because it draws from the
 * sheet's appearance and visual seed. The author only picks the style.
 */
export function CharacterPortraitEditor({
  character,
  onChanged,
}: {
  character: Character;
  onChanged: () => Promise<void>;
}) {
  const [focus, setFocus] = useState<PortraitFocus>(
    character.portrait ?? { focusX: 0.5, focusY: 0.42, scale: 1 }
  );
  const focusRef = useRef(focus);
  const dragging = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [style, setStyle] = useState<DecorativeImageStyle>('contemporary_editorial');
  const [extra, setExtra] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingItems, setViewingItems] = useState<ImageLightboxItem[] | null>(null);
  useEffect(() => {
    const next = character.portrait ?? { focusX: 0.5, focusY: 0.42, scale: 1 };
    focusRef.current = next;
    setFocus(next);
  }, [character.personId, character.portrait?.focusX, character.portrait?.focusY, character.portrait?.scale]);

  const hasPortrait = Boolean(character.portrait);
  const canGenerate = Boolean(character.profile.appearance?.trim() || character.profile.visualSeed?.trim());
  const portraitId = `portrait:${character.personId}`;

  const inspectPortrait = async () => {
    const portraitUrl = personPortraitUrl(character);
    if (!portraitUrl || adjusting) return;
    const gallery = await window.nodus.listCharacterImages(character.personId);
    setViewingItems([
      {
        id: portraitId,
        src: portraitUrl,
        alt: character.displayName,
        label: t('Imagen del personaje'),
        meta: character.portrait?.generated ? 'IA' : null,
      },
      ...gallery.map((image) => ({
        id: image.imageId,
        src: worldImageUrl(image),
        alt: image.label ? `${character.displayName} · ${image.label}` : character.displayName,
        label: image.label ?? t(CHARACTER_IMAGE_KIND_LABEL[image.kind]),
        meta: image.generated ? 'IA' : null,
      })),
    ]);
  };

  const upload = async () => {
    const updated = await window.nodus.setPersonPortraitFromFile(character.personId);
    if (updated) {
      setShowGenerate(false);
      setAdjusting(true);
      await onChanged();
    }
  };

  const remove = async () => {
    await window.nodus.clearPersonPortrait(character.personId);
    setAdjusting(false);
    await onChanged();
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await window.nodus.generateCharacterPortrait(character.personId, style, extra.trim() || null);
      setShowGenerate(false);
      setExtra('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!hasPortrait || !adjusting) return;
    event.preventDefault();
    const frame =
      event.currentTarget.firstElementChild instanceof HTMLElement
        ? event.currentTarget.firstElementChild.getBoundingClientRect()
        : event.currentTarget.getBoundingClientRect();
    dragging.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: frame.width,
      height: frame.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = dragPortraitFocus(
      focusRef.current,
      event.clientX - drag.x,
      event.clientY - drag.y,
      drag.width,
      drag.height
    );
    drag.x = event.clientX;
    drag.y = event.clientY;
    focusRef.current = next;
    setFocus(next);
  };
  const finishDrag = (event: React.PointerEvent) => {
    if (!dragging.current || dragging.current.pointerId !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Never read `focus` here: pointer moves can be batched with pointerup, leaving the
    // render closure one frame behind. The ref always contains the final visible crop.
    void window.nodus.updatePortraitFocus(character.personId, focusRef.current);
  };

  const editorRef = useDismissableLayer<HTMLDivElement>({
    open: adjusting || showGenerate,
    onDismiss: () => {
      setAdjusting(false);
      setShowGenerate(false);
    },
    group: 'character-portrait-editor',
  });

  return (
    <div className="relative w-44 shrink-0" ref={editorRef}>
      <div
        data-testid="character-portrait"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        role={hasPortrait && !adjusting ? 'button' : undefined}
        tabIndex={hasPortrait && !adjusting ? 0 : undefined}
        aria-label={hasPortrait && !adjusting ? t('Ver detalles') : undefined}
        onClick={() => {
          if (hasPortrait && !adjusting) void inspectPortrait();
        }}
        onKeyDown={(event) => {
          if (hasPortrait && !adjusting && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            void inspectPortrait();
          }
        }}
        title={hasPortrait ? t(adjusting ? 'Arrastra para encuadrar' : 'Ver detalles') : undefined}
        className={hasPortrait && !adjusting ? 'group relative outline-none ring-indigo-500 focus-visible:ring-2' : 'relative'}
        style={{ cursor: hasPortrait ? (adjusting ? 'grab' : 'zoom-in') : 'default', touchAction: 'none' }}
      >
        <CharacterPortrait
          character={{ ...character, portrait: hasPortrait ? focus : null }}
          placeholderSize={110}
          className="rounded-md"
        />
        {hasPortrait && !adjusting && (
          <span className="pointer-events-none absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Icon name="fit" size={13} />
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <button
          className="btn btn-ghost h-auto min-h-9 w-full justify-center gap-1.5 border border-neutral-700 px-3 py-2 text-center text-xs leading-snug"
          onClick={() => setShowGenerate((value) => !value)}
        >
          <Icon name="wand" size={12} /> {hasPortrait ? t('Regenerar con IA') : t('Generar con IA')}
        </button>
        {hasPortrait ? (
          <>
            <button
              className={`btn h-auto min-h-9 w-full justify-center gap-1.5 border px-3 py-2 text-center text-xs leading-snug ${
                adjusting ? 'border-indigo-600 bg-indigo-900/30 text-indigo-200' : 'btn-ghost border-neutral-700'
              }`}
              onClick={() => setAdjusting((value) => !value)}
            >
              <Icon name="fit" size={12} /> {t('Ajustar encuadre')}
            </button>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost h-auto min-h-9 flex-1 justify-center border border-neutral-700 px-3 py-2 text-center text-xs leading-snug"
                onClick={() => void upload()}
              >
                {t('Cambiar')}
              </button>
              <button
                className="btn btn-ghost h-auto min-h-9 flex-1 justify-center border border-neutral-700 px-3 py-2 text-center text-xs leading-snug text-red-300"
                onClick={() => void remove()}
              >
                {t('Quitar')}
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn btn-ghost h-auto min-h-9 w-full justify-center gap-1.5 border border-neutral-700 px-3 py-2 text-center text-xs leading-snug"
            onClick={() => void upload()}
          >
            <Icon name="upload" size={12} /> {t('Subir imagen')}
          </button>
        )}
      </div>

      {hasPortrait && adjusting && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs shadow-xl">
          <label className="mb-1 block text-neutral-500">{t('Zoom')}</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={focus.scale}
            onChange={(event) => {
              const next = { ...focus, scale: Number(event.target.value) };
              focusRef.current = next;
              setFocus(next);
              void window.nodus.updatePortraitFocus(character.personId, next);
            }}
            className="w-full"
          />
          <p className="mt-1 text-[10px] leading-3 text-neutral-600">
            {t('Arrastra la imagen para encuadrarla y usa el zoom.')}
          </p>
        </div>
      )}

      {showGenerate && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 space-y-2 rounded-md border border-indigo-900/60 bg-neutral-950 p-2.5 text-xs shadow-xl">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
            {t('Retrato con IA')}
          </p>
          {canGenerate ? (
            <p className="text-[10px] leading-4 text-neutral-500">
              {t('Se usa la apariencia y la semilla visual de la ficha, así que el personaje mantiene el mismo aspecto entre imágenes.')}
            </p>
          ) : (
            <p className="text-[10px] leading-4 text-amber-300">
              {t('Escribe primero la apariencia del personaje en la sección Descripción.')}
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Estilo')}</span>
            <select
              className="input h-8 w-full text-xs"
              value={style}
              disabled={generating}
              onChange={(event) => setStyle(event.target.value as DecorativeImageStyle)}
            >
              {DECORATIVE_IMAGE_STYLES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="input min-h-14 w-full resize-y text-xs"
            placeholder={t('Solo para esta imagen: pose, gesto, ropa, luz… (opcional)')}
            value={extra}
            disabled={generating}
            onChange={(event) => setExtra(event.target.value)}
          />
          {error && <p className="text-[10px] text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              className="btn btn-primary h-7 flex-1 justify-center gap-1 px-1 text-xs disabled:opacity-50"
              onClick={() => void generate()}
              disabled={generating || !canGenerate}
            >
              <Icon name="wand" size={11} /> {generating ? t('Generando…') : t('Generar')}
            </button>
            <button
              className="btn btn-ghost h-7 justify-center border border-neutral-700 px-2"
              onClick={() => setShowGenerate(false)}
              disabled={generating}
            >
              {t('Cancelar')}
            </button>
          </div>
        </div>
      )}
      {viewingItems && (
        <ImageLightbox
          items={viewingItems}
          activeId={portraitId}
          onClose={() => setViewingItems(null)}
        />
      )}
    </div>
  );
}
