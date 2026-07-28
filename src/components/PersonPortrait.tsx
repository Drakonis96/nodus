import { useState } from 'react';
import type { Person } from '@shared/types';
import { defaultPortraitKind } from '@shared/treePortraits';
import { AiBadge, Icon } from './ui';
import manPortrait from '../assets/man-portrait.webp';
import womanPortrait from '../assets/woman-portrait.webp';
import { personPortraitThumbnailUrl, personPortraitUrl } from '../lib/imageUrl';

const DEFAULT_SRC: Record<'man' | 'woman', string> = { man: manPortrait, woman: womanPortrait };

/**
 * Display a person's portrait framed by its non-destructive focal point. With no
 * photo, a gender silhouette stands in (man faces right, woman faces left). Real
 * portraits use the native internal image protocol, so they load with the first render
 * and Chromium can cache them without copying their BLOBs through renderer IPC.
 * `mirror` horizontally flips the DEFAULT silhouette (never a real photo) so it can
 * face inward on its side of a couple.
 */
export function PersonPortrait({
  person,
  size = 48,
  rounded = 'full',
  mirror = false,
  fill = false,
  fullResolution = false,
}: {
  person: Person;
  size?: number;
  rounded?: 'full' | 'md' | 'none';
  mirror?: boolean;
  /** Fill the parent container (100%×100%) instead of a fixed square. */
  fill?: boolean;
  /** Use the untouched source, for editors and enlarged detail views. */
  fullResolution?: boolean;
}) {
  const box = fill ? { width: '100%', height: '100%' } : { width: size, height: size };
  const radius = rounded === 'full' ? '9999px' : rounded === 'md' ? '8px' : '0';
  const focus = person.portrait;
  const candidateUrl = fullResolution ? personPortraitUrl(person) : personPortraitThumbnailUrl(person);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = candidateUrl === failedUrl ? null : candidateUrl;

  // Real user photo — framed by its focal point, never mirrored. AI-generated
  // reference likenesses carry a badge so they are never mistaken for a real photo.
  if (url && focus) {
    return (
      <div className="relative shrink-0 overflow-hidden bg-neutral-900" style={{ ...box, borderRadius: radius }}>
        <img
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailedUrl(url)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${focus.focusX * 100}% ${focus.focusY * 100}%`,
            transform: `scale(${focus.scale})`,
            // object-position only moves a cover image when its aspect ratio overflows
            // the frame. Generated portraits often match the frame exactly, so zoom
            // must originate at the focal point as well or dragging appears to do
            // nothing.
            transformOrigin: `${focus.focusX * 100}% ${focus.focusY * 100}%`,
          }}
        />
        {focus.generated && size >= 40 && <AiBadge size="sm" />}
      </div>
    );
  }

  // Gender-default silhouette (mirrored to face inward when asked).
  const kind = defaultPortraitKind(person.sex);
  if (kind) {
    return (
      <div className="shrink-0 overflow-hidden bg-neutral-800/40" style={{ ...box, borderRadius: radius }}>
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
      style={{ ...box, borderRadius: radius }}
    >
      <Icon name="user" size={Math.round(size * 0.5)} className="text-neutral-500" />
    </div>
  );
}
