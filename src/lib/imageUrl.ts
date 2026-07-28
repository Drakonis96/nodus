import type { CharacterChatImage, CharacterImage, Person, WorldMap } from '@shared/types';

type NodusImageRoute =
  | 'portrait'
  | 'world'
  | 'map'
  | 'map-thumbnail'
  | 'character-chat'
  | 'character-chat-thumbnail';

function nodusImageUrl(route: NodusImageRoute, id: string, revision?: string | null): string {
  const version = revision ? `?v=${encodeURIComponent(revision)}` : '';
  return `nodus-image://${route}/${encodeURIComponent(id)}${version}`;
}

/** A portrait URL changes whenever either its bytes or framing record changes. */
export function personPortraitUrl(person: Pick<Person, 'personId' | 'portrait' | 'updatedAt'>): string | null {
  if (!person.portrait) return null;
  return nodusImageUrl('portrait', person.personId, person.portrait.updatedAt ?? person.updatedAt);
}

export function worldImageUrl(image: Pick<CharacterImage, 'imageId' | 'updatedAt'>): string {
  return nodusImageUrl('world', image.imageId, image.updatedAt);
}

export function mapImageUrl(imageId: string): string {
  return nodusImageUrl('map', imageId, imageId);
}

export function mapThumbnailUrl(map: Pick<WorldMap, 'mapId' | 'imageId'>): string | null {
  if (!map.imageId) return null;
  return nodusImageUrl('map-thumbnail', map.mapId, map.imageId);
}

export function characterChatImageUrl(image: Pick<CharacterChatImage, 'imageId' | 'createdAt'>): string {
  return nodusImageUrl('character-chat', image.imageId, image.createdAt);
}

export function characterChatThumbnailUrl(image: Pick<CharacterChatImage, 'imageId' | 'createdAt'>): string {
  return nodusImageUrl('character-chat-thumbnail', image.imageId, image.createdAt);
}
