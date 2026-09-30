/**
 * Nodus Drift: the configuration that survives a restart, its reducer and its
 * storage.
 *
 * This is the persisted half only. Whether anything is audible, which voice is
 * still loading and which one failed are runtime facts owned by the audio engine
 * and never written down: a restored mix is always paused, it holds no buffer, no
 * node and no path. Everything here is a plain serialisable value so the reducer
 * and the parser can be exercised without a DOM.
 *
 * Storage is one per-installation `localStorage` key, deliberately outside every
 * vault, and it is read defensively: a corrupt or foreign value falls back to the
 * defaults instead of throwing.
 */
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_SOUND_VOLUME,
  MAX_SELECTED_SOUNDS,
  isDriftCategoryId,
  isDriftSoundId,
  normalizeVolume,
  planDriftSelection,
  type DriftCatalogEntry,
  type DriftCategoryId,
  type DriftSourceKind,
} from '@shared/drift';

export const DRIFT_STORAGE_KEY = 'nodus:drift:v1';
export const DRIFT_STORAGE_VERSION = 1 as const;
export const DRIFT_PERSIST_DEBOUNCE_MS = 300;

/** Upper bounds that keep a hand-edited or corrupt value from growing without limit. */
const MAX_FAVORITES = 256;
const MAX_VOLUME_ENTRIES = 256;
const MAX_TEXT = 120;
export const MAX_DRIFT_PRESETS = 48;
export const DRIFT_PRESET_ICONS = ['drift', 'bookOpen', 'moon', 'cloudRain', 'wind', 'flame', 'coffee', 'waves', 'star'] as const;
export type DriftPresetIcon = (typeof DRIFT_PRESET_ICONS)[number];

export type DriftFilter = 'all' | 'favorites' | 'active' | 'presets' | DriftCategoryId;

/**
 * What the header needs to name a voice before the authoritative catalogue has been
 * fetched. The catalogue always wins once it arrives; this is only a fallback, and its
 * icon and text are validated again when they are used.
 */
export interface DriftSoundSnapshot {
  nameKey: string;
  icon: string;
  categoryId: DriftCategoryId;
  kind: DriftSourceKind;
}

export interface DriftState {
  version: typeof DRIFT_STORAGE_VERSION;
  /** Ordered, unique, at most MAX_SELECTED_SOUNDS, at most one binaural preset. */
  selection: string[];
  /** Volume per sound, sparse: a missing id means DEFAULT_SOUND_VOLUME. */
  volumes: Record<string, number>;
  master: number;
  favorites: string[];
  filter: DriftFilter;
  snapshot: Record<string, DriftSoundSnapshot>;
  presets: DriftPreset[];
}

export interface DriftPreset {
  id: string;
  name: string;
  icon: DriftPresetIcon;
  selection: string[];
  volumes: Record<string, number>;
  master: number;
  snapshot: Record<string, DriftSoundSnapshot>;
}

export const DEFAULT_DRIFT_STATE: DriftState = Object.freeze({
  version: DRIFT_STORAGE_VERSION,
  selection: [],
  volumes: {},
  master: DEFAULT_MASTER_VOLUME,
  favorites: [],
  filter: 'all',
  snapshot: {},
  presets: [],
}) as DriftState;

const SOURCE_KINDS: readonly DriftSourceKind[] = ['file', 'noise', 'binaural'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (isDriftSoundId(entry) && !seen.has(entry)) seen.add(entry);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function parseSnapshotEntry(value: unknown): DriftSoundSnapshot | null {
  if (!isRecord(value)) return null;
  const { nameKey, icon, categoryId, kind } = value;
  if (typeof nameKey !== 'string' || !nameKey.trim() || nameKey.length > MAX_TEXT) return null;
  if (typeof icon !== 'string' || !icon || icon.length > 40) return null;
  if (!isDriftCategoryId(categoryId)) return null;
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind as DriftSourceKind)) return null;
  return { nameKey, icon, categoryId, kind: kind as DriftSourceKind };
}

/** Apply the shared policy to an ordered list of ids so a stored mix can never break it. */
function enforceSelectionPolicy(ids: readonly string[], kindOf: (id: string) => DriftSourceKind | undefined): string[] {
  let selection: string[] = [];
  for (const id of ids) {
    const plan = planDriftSelection(selection, id, (other) => kindOf(other) ?? 'file');
    if (plan.ok) selection = plan.next;
  }
  return selection;
}

/** Bring anything read from storage (or a future version's payload) to a valid state. */
export function normalizeDriftState(raw: unknown): DriftState {
  if (!isRecord(raw) || raw.version !== DRIFT_STORAGE_VERSION) return { ...DEFAULT_DRIFT_STATE, selection: [], volumes: {}, favorites: [], snapshot: {}, presets: [] };

  const snapshotSource = isRecord(raw.snapshot) ? raw.snapshot : {};
  const snapshot: Record<string, DriftSoundSnapshot> = {};
  for (const id of Object.keys(snapshotSource)) {
    if (!isDriftSoundId(id)) continue;
    const entry = parseSnapshotEntry(snapshotSource[id]);
    if (entry) snapshot[id] = entry;
  }

  const kindOf = (id: string) => snapshot[id]?.kind;
  const selection = enforceSelectionPolicy(uniqueIds(raw.selection, MAX_SELECTED_SOUNDS * 4), kindOf).slice(0, MAX_SELECTED_SOUNDS);
  const favorites = uniqueIds(raw.favorites, MAX_FAVORITES);

  const volumes: Record<string, number> = {};
  if (isRecord(raw.volumes)) {
    for (const id of Object.keys(raw.volumes)) {
      if (!isDriftSoundId(id) || Object.keys(volumes).length >= MAX_VOLUME_ENTRIES) continue;
      const value = raw.volumes[id];
      if (typeof value === 'number') volumes[id] = normalizeVolume(value, DEFAULT_SOUND_VOLUME);
    }
  }

  const keep = new Set([...selection, ...favorites]);
  const prunedSnapshot: Record<string, DriftSoundSnapshot> = {};
  for (const id of keep) if (snapshot[id]) prunedSnapshot[id] = snapshot[id];

  const filter: DriftFilter = raw.filter === 'all' || raw.filter === 'favorites' || raw.filter === 'active' || raw.filter === 'presets' || isDriftCategoryId(raw.filter) ? raw.filter : 'all';
  const presets: DriftPreset[] = [];
  if (Array.isArray(raw.presets)) for (const candidate of raw.presets.slice(0, MAX_DRIFT_PRESETS * 4)) {
    const preset = normalizeDriftPreset(candidate);
    if (preset && !presets.some((other) => other.id === preset.id)) presets.push(preset);
    if (presets.length === MAX_DRIFT_PRESETS) break;
  }

  return {
    version: DRIFT_STORAGE_VERSION,
    selection,
    volumes,
    master: normalizeVolume(raw.master, DEFAULT_MASTER_VOLUME),
    favorites,
    filter,
    snapshot: prunedSnapshot,
    presets,
  };
}

/** Presets use exactly the mix policy. Nested preset lists are deliberately never read. */
export function normalizeDriftPreset(raw: unknown): DriftPreset | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(raw.id) || typeof raw.name !== 'string') return null;
  const name = raw.name.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return null;
  const mix = normalizeDriftState({ version: DRIFT_STORAGE_VERSION, selection: raw.selection, volumes: raw.volumes, master: raw.master, snapshot: raw.snapshot });
  if (!mix.selection.length) return null;
  const icon = DRIFT_PRESET_ICONS.includes(raw.icon as DriftPresetIcon) ? raw.icon as DriftPresetIcon : 'drift';
  return { id: raw.id, name, icon, selection: mix.selection, volumes: Object.fromEntries(mix.selection.map((id) => [id, driftVolumeOf(mix, id)])), master: mix.master, snapshot: mix.snapshot };
}

/** Parse the stored text. Never throws: anything unreadable is the default state. */
export function parseStoredDriftState(text: string | null | undefined): DriftState {
  if (!text) return normalizeDriftState(null);
  try {
    return normalizeDriftState(JSON.parse(text));
  } catch {
    return normalizeDriftState(null);
  }
}

/**
 * The text written to storage. Only configuration: never a play state, a loading
 * flag, an absolute path, bytes or an engine handle.
 */
export function serializeDriftState(state: DriftState): string {
  const keep = new Set([...state.selection, ...state.favorites]);
  const snapshot: Record<string, DriftSoundSnapshot> = {};
  for (const id of keep) if (state.snapshot[id]) snapshot[id] = state.snapshot[id];
  const stored: DriftState = {
    version: DRIFT_STORAGE_VERSION,
    selection: state.selection,
    volumes: state.volumes,
    master: state.master,
    favorites: state.favorites,
    filter: state.filter,
    snapshot,
    presets: state.presets,
  };
  return JSON.stringify(stored);
}

export function driftVolumeOf(state: Pick<DriftState, 'volumes'>, id: string): number {
  return state.volumes[id] ?? DEFAULT_SOUND_VOLUME;
}

/** Kind of a sound from what the state itself knows, for the shared selection policy. */
export function driftKindFromState(state: Pick<DriftState, 'snapshot'>, id: string): DriftSourceKind | undefined {
  return state.snapshot[id]?.kind;
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export type DriftAction =
  | { type: 'select'; id: string; meta: DriftSoundSnapshot }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'setVolume'; id: string; value: number }
  | { type: 'setMaster'; value: number }
  | { type: 'toggleFavorite'; id: string; meta?: DriftSoundSnapshot }
  | { type: 'setFilter'; filter: DriftFilter }
  | { type: 'savePreset'; id: string; name: string; icon: DriftPresetIcon }
  | { type: 'editPreset'; id: string; name: string; icon: DriftPresetIcon }
  | { type: 'deletePreset'; id: string }
  | { type: 'applyPreset'; id: string }
  | { type: 'reconcile'; sounds: readonly DriftCatalogEntry[]; isKnownIcon?: (icon: string) => boolean };

function snapshotOf(entry: DriftCatalogEntry, isKnownIcon?: (icon: string) => boolean): DriftSoundSnapshot {
  return {
    nameKey: entry.nameKey,
    icon: !isKnownIcon || isKnownIcon(entry.icon) ? entry.icon : 'drift',
    categoryId: entry.categoryId,
    kind: entry.source.kind,
  };
}

export function driftReducer(state: DriftState, action: DriftAction): DriftState {
  switch (action.type) {
    case 'savePreset': {
      if (state.presets.length >= MAX_DRIFT_PRESETS || state.presets.some((preset) => preset.id === action.id)) return state;
      const preset = normalizeDriftPreset({ ...state, id: action.id, name: action.name, icon: action.icon });
      return preset ? { ...state, presets: [...state.presets, preset] } : state;
    }
    case 'editPreset': {
      const previous = state.presets.find((preset) => preset.id === action.id);
      const updated = previous && normalizeDriftPreset({ ...previous, name: action.name, icon: action.icon });
      return updated ? { ...state, presets: state.presets.map((preset) => preset.id === action.id ? updated : preset) } : state;
    }
    case 'deletePreset':
      return state.presets.some((preset) => preset.id === action.id) ? { ...state, presets: state.presets.filter((preset) => preset.id !== action.id) } : state;
    case 'applyPreset': {
      const preset = state.presets.find((preset) => preset.id === action.id);
      return preset ? { ...state, selection: [...preset.selection], volumes: { ...state.volumes, ...preset.volumes }, master: preset.master, snapshot: { ...state.snapshot, ...preset.snapshot }, filter: 'active' } : state;
    }
    case 'select': {
      // Selecting what is already in the mix is a no-op: a double click is one voice.
      if (!isDriftSoundId(action.id) || state.selection.includes(action.id)) return state;
      const snapshot = { ...state.snapshot, [action.id]: action.meta };
      const plan = planDriftSelection(state.selection, action.id, (id) => snapshot[id]?.kind);
      if (!plan.ok) return state;
      // A replaced binaural preset keeps its volume: it is a preference of that sound.
      return { ...state, selection: plan.next, snapshot };
    }
    case 'remove': {
      if (!state.selection.includes(action.id)) return state;
      return { ...state, selection: state.selection.filter((id) => id !== action.id) };
    }
    case 'clear':
      return state.selection.length === 0 ? state : { ...state, selection: [] };
    case 'setVolume': {
      if (!isDriftSoundId(action.id) || typeof action.value !== 'number' || !Number.isFinite(action.value)) return state;
      const value = normalizeVolume(action.value, DEFAULT_SOUND_VOLUME);
      if (state.volumes[action.id] === value) return state;
      return { ...state, volumes: { ...state.volumes, [action.id]: value } };
    }
    case 'setMaster': {
      if (typeof action.value !== 'number' || !Number.isFinite(action.value)) return state;
      const value = normalizeVolume(action.value, DEFAULT_MASTER_VOLUME);
      return value === state.master ? state : { ...state, master: value };
    }
    case 'toggleFavorite': {
      if (!isDriftSoundId(action.id)) return state;
      if (state.favorites.includes(action.id)) {
        return { ...state, favorites: state.favorites.filter((id) => id !== action.id) };
      }
      if (state.favorites.length >= MAX_FAVORITES) return state;
      const snapshot = action.meta ? { ...state.snapshot, [action.id]: action.meta } : state.snapshot;
      return { ...state, favorites: [...state.favorites, action.id], snapshot };
    }
    case 'setFilter':
      return state.filter === action.filter ? state : { ...state, filter: action.filter };
    case 'reconcile': {
      const byId = new Map(action.sounds.map((entry) => [entry.id, entry]));
      const known = (id: string) => byId.has(id);
      const snapshot: Record<string, DriftSoundSnapshot> = {};
      for (const [id, entry] of byId) {
        if (state.selection.includes(id) || state.favorites.includes(id)) snapshot[id] = snapshotOf(entry, action.isKnownIcon);
      }
      const kindOf = (id: string) => byId.get(id)?.source.kind;
      const selection = enforceSelectionPolicy(state.selection.filter(known), kindOf).slice(0, MAX_SELECTED_SOUNDS);
      const volumes: Record<string, number> = {};
      for (const id of Object.keys(state.volumes)) if (known(id)) volumes[id] = state.volumes[id];
      return {
        ...state,
        selection,
        volumes,
        favorites: state.favorites.filter(known),
        snapshot,
        // Refresh known metadata without deleting a saved mix when a sound disappears.
        presets: state.presets.map((preset) => normalizeDriftPreset({ ...preset, snapshot: {
          ...preset.snapshot, ...Object.fromEntries(preset.selection.filter(known).map((id) => [id, snapshotOf(byId.get(id)!, action.isKnownIcon)])),
        } })!).filter(Boolean),
      };
    }
    default:
      return state;
  }
}

/** Metadata for the shared selection policy while the catalogue has not loaded. */
export function driftMetaFromEntry(entry: DriftCatalogEntry, isKnownIcon?: (icon: string) => boolean): DriftSoundSnapshot {
  return snapshotOf(entry, isKnownIcon);
}

// ── Storage ─────────────────────────────────────────────────────────────────

export interface DriftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage can be absent, full or blocked (private windows, previews): every use is guarded. */
export function readStoredDriftState(storage: DriftStorageLike | null | undefined): DriftState {
  try {
    return parseStoredDriftState(storage?.getItem(DRIFT_STORAGE_KEY));
  } catch {
    return normalizeDriftState(null);
  }
}

export interface DriftTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: DriftTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Trailing-edge writer. A burst of changes (dragging a volume slider) produces one
 * write, `flush()` writes what is pending right now (page hide, unmount), and a
 * storage failure is swallowed: persistence must never interrupt playback.
 */
export function createDriftPersistence(
  storage: DriftStorageLike | null | undefined,
  delayMs: number = DRIFT_PERSIST_DEBOUNCE_MS,
  timers: DriftTimers = REAL_TIMERS,
) {
  let pending: DriftState | null = null;
  let handle: unknown = null;

  const write = () => {
    handle = null;
    const state = pending;
    pending = null;
    if (!state) return;
    try {
      storage?.setItem(DRIFT_STORAGE_KEY, serializeDriftState(state));
    } catch {
      // Quota exceeded or storage blocked: keep playing, forget to remember.
    }
  };

  return {
    schedule(state: DriftState) {
      pending = state;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(write, delayMs);
    },
    flush() {
      if (handle !== null) timers.clear(handle);
      write();
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      pending = null;
    },
    get pending() {
      return pending !== null;
    },
  };
}
