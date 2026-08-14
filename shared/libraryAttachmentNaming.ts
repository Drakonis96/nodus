import type {
  GlobalLibrarySettings,
  LibraryAttachmentRenameTemplate,
  LibraryAttachmentRenameType,
  LibraryItemMetadata,
} from './libraryTypes';

export const DEFAULT_GLOBAL_LIBRARY_SETTINGS: GlobalLibrarySettings = {
  autoRenameAttachments: true,
  attachmentRenameTemplate: 'creator-year-title',
  autoRenameAttachmentTypes: ['pdf', 'epub'],
  renameSupplementaryAttachments: false,
  keepAttachmentNamesInSync: true,
  autoPrepareAttachments: true,
};

const RENAME_TEMPLATES = new Set<LibraryAttachmentRenameTemplate>([
  'creator-year-title', 'year-creator-title', 'title-creator-year',
]);
const RENAME_TYPES = new Set<LibraryAttachmentRenameType>(['pdf', 'epub', 'other']);
const PRINCIPAL_CREATOR_ROLES = new Set([
  'author', 'bookAuthor', 'inventor', 'director', 'artist', 'programmer',
  'composer', 'cartographer', 'podcaster', 'presenter', 'interviewer',
]);

export function normalizeGlobalLibrarySettings(value: unknown): GlobalLibrarySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_GLOBAL_LIBRARY_SETTINGS };
  const record = value as Partial<GlobalLibrarySettings>;
  const types = Array.isArray(record.autoRenameAttachmentTypes)
    ? [...new Set(record.autoRenameAttachmentTypes.filter((entry): entry is LibraryAttachmentRenameType => RENAME_TYPES.has(entry as LibraryAttachmentRenameType)))]
    : DEFAULT_GLOBAL_LIBRARY_SETTINGS.autoRenameAttachmentTypes;
  return {
    autoRenameAttachments: typeof record.autoRenameAttachments === 'boolean' ? record.autoRenameAttachments : true,
    attachmentRenameTemplate: RENAME_TEMPLATES.has(record.attachmentRenameTemplate as LibraryAttachmentRenameTemplate)
      ? record.attachmentRenameTemplate as LibraryAttachmentRenameTemplate
      : DEFAULT_GLOBAL_LIBRARY_SETTINGS.attachmentRenameTemplate,
    autoRenameAttachmentTypes: types,
    renameSupplementaryAttachments: typeof record.renameSupplementaryAttachments === 'boolean' ? record.renameSupplementaryAttachments : false,
    keepAttachmentNamesInSync: typeof record.keepAttachmentNamesInSync === 'boolean' ? record.keepAttachmentNamesInSync : true,
    autoPrepareAttachments: typeof record.autoPrepareAttachments === 'boolean' ? record.autoPrepareAttachments : true,
  };
}

export function attachmentRenameType(fileName: string): LibraryAttachmentRenameType {
  const extension = fileName.match(/\.([^.\\/]+)$/)?.[1]?.toLocaleLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'epub') return 'epub';
  return 'other';
}

export function shouldAutoRenameAttachment(
  settings: GlobalLibrarySettings,
  fileName: string,
  existingAttachmentCount: number,
): boolean {
  return settings.autoRenameAttachments
    && settings.autoRenameAttachmentTypes.includes(attachmentRenameType(fileName))
    && (existingAttachmentCount === 0 || settings.renameSupplementaryAttachments);
}

function cleanFilenamePart(value: string): string {
  return [...value.normalize('NFC')].map((character) => character.codePointAt(0)! < 32 ? ' ' : character).join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

function creatorName(creator: LibraryItemMetadata['creators'][number]): string {
  return cleanFilenamePart(creator.lastName || creator.name || creator.firstName || '');
}

/** Mirrors Zotero's compact firstCreator value: one/two names, then “et al.”. */
export function libraryFirstCreator(metadata: LibraryItemMetadata): string {
  const principal = metadata.creators.filter((creator) => PRINCIPAL_CREATOR_ROLES.has(creator.creatorType));
  const editors = metadata.creators.filter((creator) => creator.creatorType === 'editor' || creator.creatorType === 'seriesEditor');
  const names = (principal.length ? principal : editors.length ? editors : metadata.creators).map(creatorName).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

/** Build a human-readable filename while preserving the original file extension. */
export function buildAutomaticAttachmentFileName(
  metadata: LibraryItemMetadata,
  originalFileName: string,
  template: LibraryAttachmentRenameTemplate,
): string {
  const extensionMatch = originalFileName.match(/(\.[^.\\/]+)$/);
  const extension = extensionMatch?.[1]?.toLocaleLowerCase() ?? '';
  const creator = libraryFirstCreator(metadata);
  const year = metadata.year != null
    ? String(metadata.year)
    : metadata.date?.match(/(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/)?.[1] ?? '';
  const title = cleanFilenamePart([...metadata.title].slice(0, 100).join(''));
  const parts: Record<LibraryAttachmentRenameTemplate, string[]> = {
    'creator-year-title': [creator, year, title],
    'year-creator-title': [year, creator, title],
    'title-creator-year': [title, creator, year],
  };
  let stem = parts[template].filter(Boolean).join(' - ') || cleanFilenamePart(originalFileName.replace(/\.[^.\\/]+$/, '')) || 'document';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}${extension}`;
}
