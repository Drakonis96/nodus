import { useEffect, useRef, useState } from 'react';
import type { Person } from '@shared/types';
import { Icon } from './ui';

/**
 * Display a person's portrait framed by its non-destructive focal point, or a
 * neutral placeholder. Only fetches the blob when a portrait exists, so the cost
 * scales with portraits, not with the number of nodes on a tree.
 */
export function PersonPortrait({ person, size = 48, rounded = 'full' }: { person: Person; size?: number; rounded?: 'full' | 'md' }) {
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
    // updatedAt changes when the portrait is replaced.
  }, [person.personId, person.portrait?.focusX, person.portrait?.focusY, person.portrait?.scale, person.updatedAt]);

  const radius = rounded === 'full' ? '9999px' : '8px';
  const focus = person.portrait;

  if (!url || !focus) {
    return (
      <div
        className="flex shrink-0 items-center justify-center bg-neutral-800"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Icon name="user" size={Math.round(size * 0.5)} className="text-neutral-500" />
      </div>
    );
  }

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
