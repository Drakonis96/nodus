import { useEffect, useRef, useState } from 'react';
import type { Person } from '@shared/types';
import { defaultPortraitKind } from '@shared/treePortraits';
import { Icon } from './ui';
import manPortrait from '../assets/man-portrait.webp';
import womanPortrait from '../assets/woman-portrait.webp';

const DEFAULT_SRC: Record<'man' | 'woman', string> = { man: manPortrait, woman: womanPortrait };

/**
 * Display a person's portrait framed by its non-destructive focal point. With no
 * photo, a gender silhouette stands in (man faces right, woman faces left). Only the
 * blob is fetched when a real portrait exists, so cost scales with photos, not nodes.
 * `mirror` horizontally flips the DEFAULT silhouette (never a real photo) so it can
 * face inward on its side of a couple.
 */
export function PersonPortrait({
  person,
  size = 48,
  rounded = 'full',
  mirror = false,
}: {
  person: Person;
  size?: number;
  rounded?: 'full' | 'md' | 'none';
  mirror?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!person.portrait) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void window.nodus.getPersonPortrait(person.personId).then((p) => {
      if (cancelled || !p) return;
      const blob = new Blob([new Uint8Array(p.blob)], { type: p.mime });
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [person.personId, person.portrait?.focusX, person.portrait?.focusY, person.portrait?.scale, person.updatedAt]);

  const radius = rounded === 'full' ? '9999px' : rounded === 'md' ? '8px' : '0';
  const focus = person.portrait;

  // Real user photo — framed by its focal point, never mirrored.
  if (url && focus) {
    return (
      <div className="shrink-0 overflow-hidden bg-neutral-900" style={{ width: size, height: size, borderRadius: radius }}>
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${focus.focusX * 100}% ${focus.focusY * 100}%`,
            transform: `scale(${focus.scale})`,
          }}
        />
      </div>
    );
  }

  // Gender-default silhouette (mirrored to face inward when asked).
  const kind = defaultPortraitKind(person.sex);
  if (kind) {
    return (
      <div className="shrink-0 overflow-hidden bg-neutral-800/40" style={{ width: size, height: size, borderRadius: radius }}>
        <img
          src={DEFAULT_SRC[kind]}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: '50% 20%',
            transform: mirror ? 'scaleX(-1)' : undefined,
          }}
        />
      </div>
    );
  }

  // Unknown sex — neutral placeholder.
  return (
    <div
      className="flex shrink-0 items-center justify-center bg-neutral-800"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Icon name="user" size={Math.round(size * 0.5)} className="text-neutral-500" />
    </div>
  );
}
