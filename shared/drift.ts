/**
 * Nodus Drift: the pure half of the contract shared by the main process, the
 * renderer, the asset scripts and the tests.
 *
 * Nothing in this file touches Electron, the DOM or the filesystem, so every rule
 * below (limits, licence gate, selection policy, path safety) can be asserted
 * directly. The Spanish strings are translation keys, like everywhere else in
 * Nodus; `src/i18n.drift.ts` carries their translations.
 */

/** Version of the catalogue payload that crosses the IPC boundary. */
export const DRIFT_CATALOG_SCHEMA_VERSION = 1 as const;

/** Volumes are slider positions in [0, 1] mapped linearly to gain. Deliberately low:
 *  the mix is background, and up to six voices plus the master must sum with headroom. */
export const DEFAULT_MASTER_VOLUME = 0.35;
export const DEFAULT_SOUND_VOLUME = 0.25;
export const MAX_SELECTED_SOUNDS = 6;
/** Fade applied when a voice starts, stops, is removed or the mix pauses. */
export const FADE_MS = 150;
/** Budget for decoded PCM (length x channels x 4 bytes), processed loop copies and
 *  in-flight reservations together. */
export const MAX_DECODED_BYTES = 192 * 1024 * 1024;
/** No bundled recording may be larger than this; the main process refuses it before reading. */
export const MAX_DRIFT_AUDIO_BYTES = 12 * 1024 * 1024;
/** Simultaneous fetch + decode operations. */
export const MAX_CONCURRENT_LOADS = 2;
/** Length of the generated noise loops. */
export const NOISE_LOOP_SECONDS = 8;
/** Longest circular crossfade a catalogue entry may request. */
export const MAX_CROSSFADE_MS = 10_000;

/** Categories, in the order the interface lists them. `nameKey` is a translation key. */
export const DRIFT_CATEGORIES = [
  { id: 'rain', nameKey: 'Lluvia', icon: 'cloudRain' },
  // Not 'Naturaleza': that key already names a document facet elsewhere and German renders it as "Art".
  { id: 'nature', nameKey: 'Entorno natural', icon: 'leaf' },
  { id: 'animals', nameKey: 'Animales', icon: 'paw' },
  { id: 'places', nameKey: 'Lugares', icon: 'mapPin' },
  { id: 'things', nameKey: 'Objetos', icon: 'clock' },
  { id: 'transport', nameKey: 'Transporte', icon: 'train' },
  { id: 'urban', nameKey: 'Urbano', icon: 'building' },
  { id: 'noise', nameKey: 'Ruido', icon: 'waveform' },
  { id: 'binaural', nameKey: 'Binaural', icon: 'sine' },
] as const;

export type DriftCategoryId = (typeof DRIFT_CATEGORIES)[number]['id'];

const CATEGORY_IDS: ReadonlySet<string> = new Set(DRIFT_CATEGORIES.map((category) => category.id));

export function isDriftCategoryId(value: unknown): value is DriftCategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

export type DriftNoiseColor = 'white' | 'pink' | 'brown';

export type DriftSource =
  | {
      kind: 'file';
      /** Path relative to the bundled audio directory. Never a URL. */
      asset: string;
      sha256: string;
      bytes: number;
      durationSeconds: number;
      loop: boolean;
      /** 0 respects a loop that is already seamless; otherwise the length of the circular crossfade. */
      crossfadeMs: number;
    }
  | { kind: 'noise'; color: DriftNoiseColor }
  | { kind: 'binaural'; carrierHz: number; beatHz: number };

export type DriftSourceKind = DriftSource['kind'];

/**
 * How firmly the licence of an entry is established.
 *  - `verified`: the evidence in `evidenceRefs` identifies the licence and supports the distribution.
 *  - `declared`: the licence is the one the upstream project declares for this material. That
 *    declaration is the evidence, and nobody checked the licence of the individual file. The
 *    entry says so instead of passing for `verified`.
 *  - `unresolved`: nothing is established.
 */
export type DriftLicenseStatus = 'verified' | 'declared' | 'unresolved';

export interface DriftProvenance {
  licenseStatus: DriftLicenseStatus;
  /** Absent while nothing is established; a `LicenseRef-` for a declaration that names more than one licence. */
  licenseId?: string;
  upstreamRepository?: string;
  upstreamCommit?: string;
  upstreamPath?: string;
  /** Where the evidence (or the absence of it) is recorded, relative to the repository. */
  evidenceRefs: string[];
  distributionReview: 'approved' | 'pending';
  reviewRef?: string;
}

export interface DriftSoundDefinition {
  id: string;
  nameKey: string;
  descriptionKey: string;
  categoryId: DriftCategoryId;
  icon: string;
  source: DriftSource;
  provenance: DriftProvenance;
}

export type DriftAvailability = 'available' | 'missing' | 'license-unresolved';

export interface DriftCatalogResponse {
  schemaVersion: 1;
  sounds: Array<DriftSoundDefinition & { availability: DriftAvailability }>;
}

export type DriftCatalogEntry = DriftCatalogResponse['sounds'][number];

/** Why one voice could not start. Shown through the interface's own copy, never raw text. */
export type DriftVoiceErrorCode =
  | 'unavailable'
  | 'missing'
  | 'corrupt'
  | 'too-large'
  | 'decode'
  | 'capacity'
  | 'unknown';

// ── Validators ──────────────────────────────────────────────────────────────

/** Stable sound ids are lowercase kebab-case: they are file-free, URL-free keys. */
export function isDriftSoundId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function isValidVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Storage path: finite numbers in range are kept, anything else falls back. */
export function normalizeVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export const DRIFT_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'] as const;

/**
 * A relative, forward-slash path made of plain segments with an audio extension.
 * Rejects URLs, absolute and drive paths, backslashes, `.`/`..` segments, empty
 * segments and anything outside a conservative character set.
 */
export function isSafeDriftAssetPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) return false;
  if (value.includes('\\') || value.includes(':') || value.startsWith('/')) return false;
  const segments = value.split('/');
  if (segments.length > 4) return false;
  for (const segment of segments) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) return false;
    if (segment === '.' || segment === '..' || segment.includes('..')) return false;
  }
  const lower = value.toLowerCase();
  return DRIFT_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * The gate in front of every bundled recording: a licence that is either verified or declared by
 * the upstream project, AND a documented distribution review that says so. Generators are
 * first-party code and pass through the same fields (see legal/drift/REVIEW.md), so there is
 * one rule.
 */
export function isDriftDistributable(definition: Pick<DriftSoundDefinition, 'provenance'>): boolean {
  const { provenance } = definition;
  return (provenance.licenseStatus === 'verified' || provenance.licenseStatus === 'declared')
    && typeof provenance.licenseId === 'string' && provenance.licenseId.length > 0
    && provenance.evidenceRefs.length > 0
    && provenance.distributionReview === 'approved'
    && typeof provenance.reviewRef === 'string' && provenance.reviewRef.length > 0;
}

/** Availability a definition can have without looking at the disk. */
export function baseDriftAvailability(definition: DriftSoundDefinition): DriftAvailability {
  if (definition.source.kind !== 'file') return 'available';
  return isDriftDistributable(definition) ? 'available' : 'license-unresolved';
}

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

/** Structural problems of one definition; an empty list means it is well formed. */
export function validateDriftDefinition(definition: DriftSoundDefinition, iconNames?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const at = (message: string) => problems.push(`${definition?.id ?? '<no id>'}: ${message}`);
  if (!definition || typeof definition !== 'object') return ['definition is not an object'];
  if (!isDriftSoundId(definition.id)) at('id must be lowercase kebab-case');
  if (typeof definition.nameKey !== 'string' || !definition.nameKey.trim()) at('nameKey is empty');
  if (typeof definition.descriptionKey !== 'string' || !definition.descriptionKey.trim()) at('descriptionKey is empty');
  if (!isDriftCategoryId(definition.categoryId)) at(`unknown category ${String(definition.categoryId)}`);
  if (typeof definition.icon !== 'string' || !definition.icon) at('icon is empty');
  else if (iconNames && !iconNames.has(definition.icon)) at(`icon ${definition.icon} does not exist`);

  const source = definition.source;
  if (!source || typeof source !== 'object') at('source is missing');
  else if (source.kind === 'file') {
    if (!isSafeDriftAssetPath(source.asset)) at('asset is not a safe relative audio path');
    if (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) at('sha256 is not 64 lowercase hex characters');
    if (!Number.isInteger(source.bytes) || source.bytes <= 0 || source.bytes > MAX_DRIFT_AUDIO_BYTES) at('bytes is outside 1..12 MiB');
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) at('durationSeconds must be positive');
    if (typeof source.loop !== 'boolean') at('loop must be a boolean');
    if (!Number.isInteger(source.crossfadeMs) || source.crossfadeMs < 0 || source.crossfadeMs > MAX_CROSSFADE_MS) at('crossfadeMs is outside 0..10000');
    else if (source.crossfadeMs > 0 && (2 * source.crossfadeMs) / 1000 >= source.durationSeconds) at('crossfade must leave more than half of the recording');
    if (source.crossfadeMs > 0 && source.loop === false) at('a crossfade only makes sense for a loop');
  } else if (source.kind === 'noise') {
    if (!['white', 'pink', 'brown'].includes(source.color)) at('unknown noise colour');
  } else if (source.kind === 'binaural') {
    if (!Number.isFinite(source.carrierHz) || source.carrierHz <= 0) at('carrierHz must be positive');
    if (!Number.isFinite(source.beatHz) || source.beatHz <= 0) at('beatHz must be positive');
    else if (Number.isFinite(source.carrierHz) && source.beatHz / 2 >= source.carrierHz) at('beat is too large for the carrier');
  } else {
    at('unknown source kind');
  }

  const provenance = definition.provenance;
  if (!provenance || typeof provenance !== 'object') at('provenance is missing');
  else {
    if (!['verified', 'declared', 'unresolved'].includes(provenance.licenseStatus)) at('unknown licenseStatus');
    if (!Array.isArray(provenance.evidenceRefs) || provenance.evidenceRefs.some((ref) => typeof ref !== 'string' || !ref)) at('evidenceRefs must be non-empty strings');
    if (!['approved', 'pending'].includes(provenance.distributionReview)) at('unknown distributionReview');
    if (provenance.licenseStatus === 'unresolved' && provenance.licenseId !== undefined) at('an unresolved entry must not name a licence');
    if (provenance.licenseStatus === 'verified' || provenance.licenseStatus === 'declared') {
      if (!provenance.licenseId) at(`a ${provenance.licenseStatus} entry must name its licence`);
      if (!provenance.evidenceRefs?.length) at(`a ${provenance.licenseStatus} entry needs evidence`);
    }
    if (provenance.distributionReview === 'approved') {
      if (provenance.licenseStatus === 'unresolved') at('an approved review requires a verified or declared licence');
      if (!provenance.reviewRef) at('an approved review must cite its record');
    }
    if (provenance.upstreamCommit !== undefined && !GIT_COMMIT.test(provenance.upstreamCommit)) at('upstreamCommit is not a 40-hex commit');
    if (provenance.upstreamRepository !== undefined && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(provenance.upstreamRepository)) at('upstreamRepository is not a GitHub repository URL');
    if (source?.kind === 'file' && provenance.upstreamRepository) {
      if (!provenance.upstreamCommit) at('an upstream file must be pinned to a commit');
      if (!provenance.upstreamPath) at('an upstream file must record its upstream path');
    }
  }
  return problems;
}

/** Problems across a whole catalogue: per definition plus uniqueness of ids and assets. */
export function validateDriftCatalog(definitions: readonly DriftSoundDefinition[], iconNames?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const assets = new Set<string>();
  for (const definition of definitions) {
    problems.push(...validateDriftDefinition(definition, iconNames));
    if (ids.has(definition.id)) problems.push(`${definition.id}: duplicated id`);
    ids.add(definition.id);
    if (definition.source?.kind === 'file') {
      const key = definition.source.asset.toLowerCase();
      if (assets.has(key)) problems.push(`${definition.id}: asset ${definition.source.asset} is shared with another entry`);
      assets.add(key);
    }
  }
  return problems;
}

// ── Selection policy ────────────────────────────────────────────────────────

export type DriftSelectionPlan =
  | { ok: true; next: string[]; replaced: string | null }
  | { ok: false; reason: 'limit' | 'unknown' };

/**
 * The single rule for adding a sound to the mix, used by the persisted state and by
 * the audio engine so they cannot disagree:
 *  - an unknown id is refused;
 *  - adding what is already selected changes nothing (a double click is one voice);
 *  - only one binaural preset can be selected: a new one takes the place of the old;
 *  - otherwise the seventh voice is refused and the mix stays as it was.
 */
export function planDriftSelection(
  current: readonly string[],
  id: string,
  kindOf: (id: string) => DriftSourceKind | undefined,
  max: number = MAX_SELECTED_SOUNDS,
): DriftSelectionPlan {
  const kind = kindOf(id);
  if (kind === undefined) return { ok: false, reason: 'unknown' };
  if (current.includes(id)) return { ok: true, next: [...current], replaced: null };
  if (kind === 'binaural') {
    const previous = current.find((other) => kindOf(other) === 'binaural');
    if (previous !== undefined) {
      return { ok: true, next: current.map((other) => (other === previous ? id : other)), replaced: previous };
    }
  }
  if (current.length >= max) return { ok: false, reason: 'limit' };
  return { ok: true, next: [...current, id], replaced: null };
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Case- and accent-insensitive form used to match the search box. */
export function normalizeDriftSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

/** Binaural presets: Delta 2 Hz to Gamma 40 Hz around a 100 Hz carrier. */
export const BINAURAL_CARRIER_HZ = 100;

/** Left and right tones of a binaural preset: the carrier +/- half the beat. */
export function binauralFrequencies(carrierHz: number, beatHz: number): { left: number; right: number } {
  return { left: carrierHz - beatHz / 2, right: carrierHz + beatHz / 2 };
}
