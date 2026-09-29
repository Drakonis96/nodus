/**
 * The Nodus Drift audio engine: one AudioContext, up to six voices, one bus.
 *
 *     source -> envelope (fade) -> voice gain (slider) -> master bus -> limiter -> destination
 *
 * It is a plain class with injected dependencies (context factory, byte transport,
 * catalogue lookup, timers) so every rule below is testable without a browser:
 *
 *  - Constructing the engine creates NOTHING audible and no AudioContext. The context is
 *    created and `resume()`d synchronously inside the call an explicit play action
 *    started, before any read or decode is awaited. A voice reports "playing" only after
 *    that resume succeeded and its source actually started.
 *  - A source node is single use. Playing again after a stop builds a new one; `start()`
 *    is never called twice on one node.
 *  - Recordings decode on demand (two at a time, one request per sound), are made
 *    seamless once and looped natively. Noise loops are generated once per colour.
 *  - Every async step re-checks a per-voice token and a global epoch: a load that finishes
 *    after the voice was removed, the mix paused or cleared, or the engine disposed can
 *    never start audio.
 *  - Decoded PCM (plus processed loop copies and in-flight reservations) is budgeted in
 *    bytes. Inactive buffers are evicted first; an active voice is never evicted, and a
 *    voice that does not fit is refused loudly instead of starting.
 */
import {
  DEFAULT_SOUND_VOLUME,
  FADE_MS,
  MAX_CONCURRENT_LOADS,
  MAX_DECODED_BYTES,
  MAX_SELECTED_SOUNDS,
  NOISE_LOOP_SECONDS,
  isValidVolume,
  planDriftSelection,
  type DriftNoiseColor,
  type DriftSoundDefinition,
  type DriftVoiceErrorCode,
} from '@shared/drift';
import { createBinauralVoiceGraph, type BinauralVoiceGraph } from './binaural';
import { buildLoopBuffer, pcmBytes } from './loopBuffer';
import { createNoiseBuffer, type RandomSource } from './noise';

/** Thrown for refusals the engine decides itself. `code` is what the interface shows. */
export class DriftEngineError extends Error {
  constructor(readonly code: DriftVoiceErrorCode | 'limit' | 'unknown-sound', message?: string) {
    super(message ?? `Drift engine: ${code}`);
    this.name = 'DriftEngineError';
  }
}

export type DriftVoiceStatus = 'loading' | 'playing' | 'paused' | 'error';

export interface DriftVoiceSnapshot {
  id: string;
  status: DriftVoiceStatus;
  volume: number;
  error: DriftVoiceErrorCode | null;
}

export interface DriftEngineSnapshot {
  voices: DriftVoiceSnapshot[];
  master: number;
  /** Play was requested (a sound activated, Play pressed) and Pause has not been since. */
  wantPlaying: boolean;
  /** At least one voice has actually started. Never true for a load that failed. */
  playing: boolean;
  /** At least one voice is still fetching or decoding. */
  loading: boolean;
  cachedBytes: number;
  contextState: 'none' | 'running' | 'suspended' | 'closed' | 'interrupted';
  disposed: boolean;
}

export interface DriftEngineDeps {
  createContext: () => AudioContext;
  readAudio: (soundId: string) => Promise<Uint8Array>;
  resolveSound: (soundId: string) => DriftSoundDefinition | undefined;
  /**
   * Resolves once `resolveSound` can be trusted. A restored mix can be played from the
   * header before the catalogue was ever fetched: the context is still created and resumed
   * inside the click, and only then does the voice wait for this.
   */
  ready?: () => Promise<void>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  fadeMs?: number;
  maxDecodedBytes?: number;
  maxConcurrentLoads?: number;
  maxSelected?: number;
  /** Noise random streams; production uses Math.random. */
  random?: (channel: number) => RandomSource;
}

/** Gain smoothing for slider moves: short enough to feel immediate, long enough not to click. */
const VOLUME_SMOOTH_MS = 30;
/** A little longer than the fade, so a node is only released once it is silent. */
const RELEASE_GRACE_MS = 20;

interface Instance {
  envelope: GainNode;
  source: AudioBufferSourceNode | null;
  binaural: BinauralVoiceGraph | null;
  startedAt: number;
  startOffset: number;
  duration: number;
  /** Cache key of the buffer this instance plays from (noise and binaural included). */
  key: string;
}

interface Voice {
  id: string;
  volume: number;
  status: DriftVoiceStatus;
  error: DriftVoiceErrorCode | null;
  /** Bumped by every new start attempt and by removal; an attempt holding an old one aborts. */
  token: number;
  gain: GainNode | null;
  instance: Instance | null;
  /** Seconds into the loop where a paused recording resumes. */
  offset: number;
  /** The in-flight start, so concurrent requests for one voice share it. */
  starting: Promise<void> | null;
  removed: boolean;
}

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
  lastUsed: number;
}

type Listener = (snapshot: DriftEngineSnapshot) => void;

export class DriftAudioEngine {
  private readonly deps: DriftEngineDeps;
  private readonly fadeMs: number;
  private readonly maxBytes: number;
  private readonly maxSelected: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterVolume = 0.35;
  private readonly order: string[] = [];
  private readonly voices = new Map<string, Voice>();
  /** Instances fading out: they still reference their buffer until their timer fires. */
  private readonly retiring = new Map<Instance, string>();
  /** Gains of removed voices, kept connected for one fade so the release is not cut off. */
  private readonly releasingGains = new Set<GainNode>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly reserved = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<AudioBuffer>>();
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Set<unknown>();
  private suspendTimer: unknown = null;
  private suspendWaiters: Array<() => void> = [];
  /** The latest request to start the context; voices wait for it before reporting playback. */
  private running: Promise<void> = Promise.resolve();
  private wantPlaying = false;
  private epoch = 0;
  private useClock = 0;
  private activeLoads = 0;
  private readonly loadQueue: Array<() => void> = [];
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private stateListener: (() => void) | null = null;

  constructor(deps: DriftEngineDeps) {
    this.deps = deps;
    this.fadeMs = deps.fadeMs ?? FADE_MS;
    this.maxBytes = deps.maxDecodedBytes ?? MAX_DECODED_BYTES;
    this.maxSelected = deps.maxSelected ?? MAX_SELECTED_SOUNDS;
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  // ── Observation ───────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): DriftEngineSnapshot {
    const voices = this.order.map((id) => {
      const voice = this.voices.get(id)!;
      return { id, status: voice.status, volume: voice.volume, error: voice.error };
    });
    return {
      voices,
      master: this.masterVolume,
      wantPlaying: this.wantPlaying,
      playing: voices.some((voice) => voice.status === 'playing'),
      loading: voices.some((voice) => voice.status === 'loading'),
      cachedBytes: this.usedBytes(),
      contextState: this.context ? (this.context.state as DriftEngineSnapshot['contextState']) : 'none',
      disposed: this.disposed,
    };
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try { listener(snapshot); } catch { /* an observer must never break playback */ }
    }
  }

  // ── Restoring a saved mix (paused, silent, no context) ────────────────────

  /**
   * Seed the mix from saved settings. The voices come back PAUSED: no AudioContext is
   * created, nothing is fetched and nothing is audible until an explicit play.
   */
  restore(config: { ids: readonly string[]; volumes: Readonly<Record<string, number>>; master: number }): void {
    if (this.disposed || this.context || this.order.length > 0) return;
    if (isValidVolume(config.master)) this.masterVolume = config.master;
    for (const id of config.ids.slice(0, this.maxSelected)) {
      if (this.voices.has(id)) continue;
      const stored = config.volumes[id];
      this.addVoice(id, isValidVolume(stored) ? stored : DEFAULT_SOUND_VOLUME);
    }
    this.emit();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /**
   * Add a sound to the mix and play the mix: an explicit play order. Adding what is
   * already selected never creates a second voice. Resolves once this voice has started
   * or failed; a failure is recorded on the voice, it does not reject. A refusal (unknown
   * sound, seventh voice) rejects and leaves the mix exactly as it was.
   */
  async selectSound(id: string, initialVolume?: number): Promise<void> {
    if (this.disposed) return;
    if (!this.deps.resolveSound(id)) throw new DriftEngineError('unknown-sound', `Unknown Drift sound "${id}".`);
    const plan = planDriftSelection(this.order, id, (other) => this.deps.resolveSound(other)?.source.kind, this.maxSelected);
    if (!plan.ok) {
      throw new DriftEngineError(plan.reason === 'limit' ? 'limit' : 'unknown-sound', plan.reason === 'limit' ? 'The mix already has the maximum number of voices.' : undefined);
    }

    // Synchronously, while the user's gesture is live: create the context and resume it.
    this.beginPlaying();

    let voice = this.voices.get(id);
    if (!voice) {
      // A replaced binaural preset gives up its slot to the new one.
      const slot = plan.replaced ? this.detachVoice(plan.replaced) : -1;
      voice = this.addVoice(id, isValidVolume(initialVolume) ? initialVolume : DEFAULT_SOUND_VOLUME, slot >= 0 ? slot : undefined);
    }
    this.emit();
    await this.resumeVoices(voice);
  }

  /** Remove one voice with a fade. The others keep playing. */
  removeSound(id: string): void {
    if (this.disposed || !this.voices.has(id)) return;
    this.detachVoice(id);
    this.settleIfSilent();
    this.emit();
  }

  /** Try again a voice that failed. */
  async retrySound(id: string): Promise<void> {
    const voice = this.voices.get(id);
    if (this.disposed || !voice || voice.status !== 'error') return;
    this.beginPlaying();
    voice.error = null;
    voice.status = 'paused';
    this.emit();
    await this.startVoice(voice);
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  /** Start or resume every voice of the mix. */
  async playAll(): Promise<void> {
    if (this.disposed || this.order.length === 0) return;
    this.beginPlaying();
    this.emit();
    await this.resumeVoices(null);
  }

  /** Fade out and stop every source, keep the selection, volumes and loop positions. */
  async pauseAll(): Promise<void> {
    if (this.disposed) return;
    this.wantPlaying = false;
    this.epoch += 1;
    for (const voice of this.voices.values()) {
      if (voice.instance) this.retireInstance(voice);
      if (voice.status === 'playing' || voice.status === 'loading') voice.status = 'paused';
      voice.starting = null;
    }
    this.emit();
    await this.settlePaused();
  }

  /** Fade out, stop and drop every voice and every cached buffer. */
  async clearAll(): Promise<void> {
    if (this.disposed) return;
    this.wantPlaying = false;
    this.epoch += 1;
    for (const id of [...this.order]) this.detachVoice(id);
    // Nothing is selected any more, so nothing needs the decoded audio. What is still
    // fading out keeps its buffer until its timer fires.
    this.dropInactiveCache();
    this.emit();
    await this.settlePaused();
  }

  // ── Volume ────────────────────────────────────────────────────────────────

  setSoundVolume(id: string, value: number): void {
    if (!isValidVolume(value)) throw new RangeError('A Drift volume must be a finite number between 0 and 1.');
    const voice = this.voices.get(id);
    if (this.disposed || !voice) return;
    voice.volume = value;
    if (voice.gain && this.context) this.ramp(voice.gain.gain, value, VOLUME_SMOOTH_MS);
    this.emit();
  }

  setMasterVolume(value: number): void {
    if (!isValidVolume(value)) throw new RangeError('A Drift volume must be a finite number between 0 and 1.');
    if (this.disposed) return;
    this.masterVolume = value;
    if (this.master && this.context) this.ramp(this.master.gain, value, VOLUME_SMOOTH_MS);
    this.emit();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Release everything. Safe to call twice and while loads are in flight. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.wantPlaying = false;
    this.epoch += 1;
    this.disposePromise = (async () => {
      for (const handle of this.timers) this.clearTimer(handle);
      this.timers.clear();
      this.suspendTimer = null;
      this.releaseSuspendWaiters();
      for (const voice of this.voices.values()) {
        voice.removed = true;
        voice.token += 1;
        voice.starting = null;
        if (voice.instance) this.destroyInstance(voice.instance);
        voice.instance = null;
        voice.gain?.disconnect();
        voice.gain = null;
      }
      for (const instance of this.retiring.keys()) this.destroyInstance(instance);
      this.retiring.clear();
      for (const gain of [...this.releasingGains]) this.releaseGain(gain);
      this.voices.clear();
      this.order.length = 0;
      this.cache.clear();
      this.reserved.clear();
      this.inflight.clear();
      this.loadQueue.length = 0;
      const context = this.context;
      if (context) {
        if (this.stateListener) context.removeEventListener('statechange', this.stateListener);
        this.stateListener = null;
        this.master?.disconnect();
        this.limiter?.disconnect();
        this.master = null;
        this.limiter = null;
        this.context = null;
        try { if (context.state !== 'closed') await context.close(); } catch { /* already closing */ }
      }
      this.listeners.clear();
    })();
    return this.disposePromise;
  }

  // ── Internals: context ────────────────────────────────────────────────────

  /**
   * An explicit play request: the mix is now meant to be playing. Creates the context on
   * first use and asks it to run, all synchronously, so the resume request is made inside
   * the user's gesture and before anything is read or decoded.
   */
  private beginPlaying(): void {
    this.wantPlaying = true;
    this.cancelPendingSuspend();
    if (!this.context) this.buildContext();
    const context = this.context!;
    if (context.state === 'running') {
      this.running = Promise.resolve();
      return;
    }
    try {
      this.running = Promise.resolve(context.resume()).then(() => undefined);
    } catch (error) {
      this.running = Promise.reject(error);
    }
    // Voices await this and record the failure themselves; this only keeps it from being unhandled.
    this.running.catch(() => undefined);
  }

  private buildContext(): void {
    const context = this.deps.createContext();
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.masterVolume;
    // Safety net against saturation only: with the default levels it never engages.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(context.destination);
    this.master = master;
    this.limiter = limiter;
    this.stateListener = () => { this.emit(); };
    context.addEventListener('statechange', this.stateListener);
    for (const voice of this.voices.values()) this.ensureVoiceGain(voice);
  }

  private ensureVoiceGain(voice: Voice): GainNode {
    if (voice.gain) return voice.gain;
    const gain = this.context!.createGain();
    gain.gain.value = voice.volume;
    gain.connect(this.master!);
    voice.gain = gain;
    return gain;
  }

  private ramp(param: AudioParam, target: number, ms: number): void {
    const now = this.context!.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + ms / 1000);
  }

  private later(ms: number, callback: () => void): unknown {
    const handle = this.setTimer(() => {
      this.timers.delete(handle);
      callback();
    }, ms);
    this.timers.add(handle);
    return handle;
  }

  private releaseSuspendWaiters(): void {
    const waiters = this.suspendWaiters;
    this.suspendWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** A new play overtakes a pending suspend; whoever awaited the pause is released. */
  private cancelPendingSuspend(): void {
    if (this.suspendTimer !== null) {
      this.clearTimer(this.suspendTimer);
      this.timers.delete(this.suspendTimer);
      this.suspendTimer = null;
    }
    this.releaseSuspendWaiters();
  }

  /**
   * After the fades, suspend the context if nothing is meant to be playing. Resolves when
   * that has happened, or when a new play overtook it.
   */
  private settlePaused(): Promise<void> {
    if (!this.context) return Promise.resolve();
    this.cancelPendingSuspend();
    return new Promise<void>((resolve) => {
      this.suspendWaiters.push(resolve);
      const epoch = this.epoch;
      this.suspendTimer = this.later(this.fadeMs + RELEASE_GRACE_MS, () => {
        this.suspendTimer = null;
        // What was fading is silent by now: release it so no node dangles.
        for (const instance of [...this.retiring.keys()]) this.finishRetiring(instance);
        const finish = () => this.releaseSuspendWaiters();
        // A resume that is still pending must land before it can be undone.
        this.running.catch(() => undefined).then(() => {
          const context = this.context;
          if (!context || this.disposed || this.wantPlaying || this.epoch !== epoch || context.state !== 'running') return undefined;
          return Promise.resolve(context.suspend()).catch(() => undefined);
        }).then(finish, finish);
      });
    });
  }

  /** With nothing playing or loading, the mix has gone quiet: stop asking for output. */
  private settleIfSilent(): void {
    const active = [...this.voices.values()].some((voice) => voice.status === 'playing' || voice.status === 'loading');
    if (active) return;
    this.wantPlaying = false;
    void this.settlePaused();
  }

  // ── Internals: voices ─────────────────────────────────────────────────────

  private addVoice(id: string, volume: number, slot?: number): Voice {
    const voice: Voice = {
      id, volume, status: 'paused', error: null, token: 0,
      gain: null, instance: null, offset: 0, starting: null, removed: false,
    };
    this.voices.set(id, voice);
    if (slot !== undefined) this.order.splice(slot, 0, id);
    else this.order.push(id);
    if (this.context) this.ensureVoiceGain(voice);
    return voice;
  }

  /** Take a voice out of the mix, fading it out. Returns the slot it occupied. */
  private detachVoice(id: string): number {
    const voice = this.voices.get(id);
    if (!voice) return -1;
    voice.removed = true;
    voice.token += 1;
    voice.starting = null;
    const gain = voice.gain;
    if (voice.instance) this.retireInstance(voice);
    voice.gain = null;
    this.voices.delete(id);
    const slot = this.order.indexOf(id);
    if (slot >= 0) this.order.splice(slot, 1);
    // The voice gain outlives the voice by one fade so the release is not cut off.
    if (gain) {
      this.releasingGains.add(gain);
      this.later(this.fadeMs + RELEASE_GRACE_MS, () => this.releaseGain(gain));
    }
    return slot;
  }

  /** Start every voice that is not playing, a specific one first. */
  private resumeVoices(first: Voice | null): Promise<void> {
    const pending: Promise<void>[] = [];
    if (first) pending.push(this.startVoice(first));
    for (const voice of this.voices.values()) {
      if (voice === first) continue;
      // A failed voice waits for its own retry; the rest of the mix carries on.
      if (voice.status === 'paused') pending.push(this.startVoice(voice));
      else if (voice.starting) pending.push(voice.starting);
    }
    return Promise.all(pending).then(() => undefined);
  }

  private startVoice(voice: Voice): Promise<void> {
    if (voice.status === 'playing') return Promise.resolve();
    if (voice.starting) return voice.starting;
    const token = ++voice.token;
    const epoch = this.epoch;
    voice.status = 'loading';
    voice.error = null;
    this.emit();
    const attempt = (async () => {
      try {
        // Decode while the context starts, but never report playback before both are done.
        const [prepared] = await Promise.all([this.prepare(voice), this.running]);
        if (!this.stillWanted(voice, token, epoch)) return;
        this.beginInstance(voice, prepared);
        voice.status = 'playing';
        voice.error = null;
      } catch (error) {
        if (!this.stillWanted(voice, token, epoch)) return;
        voice.status = 'error';
        voice.error = classifyError(error);
      } finally {
        if (voice.token === token) voice.starting = null;
        this.emit();
      }
    })();
    voice.starting = attempt;
    return attempt;
  }

  private stillWanted(voice: Voice, token: number, epoch: number): boolean {
    return !this.disposed && !voice.removed && voice.token === token && this.epoch === epoch && this.wantPlaying && this.context !== null;
  }

  private async prepare(voice: Voice): Promise<{ buffer: AudioBuffer | null; definition: DriftSoundDefinition; key: string }> {
    if (this.deps.ready) await this.deps.ready();
    const definition = this.deps.resolveSound(voice.id);
    if (!definition) throw new DriftEngineError('unavailable');
    const source = definition.source;
    if (source.kind === 'binaural') return { buffer: null, definition, key: `binaural:${voice.id}` };
    if (source.kind === 'noise') {
      const key = `noise:${source.color}`;
      return { buffer: this.noiseBuffer(source.color, key), definition, key };
    }
    return { buffer: await this.fileBuffer(definition), definition, key: voice.id };
  }

  private beginInstance(voice: Voice, prepared: { buffer: AudioBuffer | null; definition: DriftSoundDefinition; key: string }): void {
    const context = this.context!;
    const gain = this.ensureVoiceGain(voice);
    const now = context.currentTime;
    const fade = this.fadeMs / 1000;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + fade);
    envelope.connect(gain);

    const instance: Instance = { envelope, source: null, binaural: null, startedAt: now, startOffset: 0, duration: 0, key: prepared.key };

    const source = prepared.definition.source;
    if (source.kind === 'binaural') {
      const graph = createBinauralVoiceGraph(context, source.carrierHz, source.beatHz);
      graph.output.connect(envelope);
      graph.start(now);
      instance.binaural = graph;
    } else {
      const buffer = prepared.buffer!;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(envelope);
      const duration = buffer.duration;
      const offset = duration > 0 ? voice.offset % duration : 0;
      node.start(now, offset);
      instance.source = node;
      instance.duration = duration;
      instance.startOffset = offset;
      const entry = this.cache.get(prepared.key);
      if (entry) entry.lastUsed = ++this.useClock;
    }
    voice.instance = instance;
  }

  /**
   * Stop the voice's instance: fade its envelope out, schedule the source to stop at the
   * end of the fade, remember where a recording was, and let a timer release the nodes.
   */
  private retireInstance(voice: Voice): void {
    const instance = voice.instance;
    voice.instance = null;
    if (!instance || !this.context) return;
    const now = this.context.currentTime;
    const seconds = this.fadeMs / 1000;
    if (instance.source && instance.duration > 0) {
      voice.offset = (instance.startOffset + Math.max(0, now - instance.startedAt)) % instance.duration;
    }
    instance.envelope.gain.cancelScheduledValues(now);
    instance.envelope.gain.setValueAtTime(instance.envelope.gain.value, now);
    instance.envelope.gain.linearRampToValueAtTime(0, now + seconds);
    try {
      instance.source?.stop(now + seconds);
      instance.binaural?.stop(now + seconds);
    } catch { /* the node had not started, or had already stopped */ }
    this.retiring.set(instance, instance.key);
    this.later(this.fadeMs + RELEASE_GRACE_MS, () => this.finishRetiring(instance));
  }

  private releaseGain(gain: GainNode): void {
    if (!this.releasingGains.delete(gain)) return;
    try { gain.disconnect(); } catch { /* already gone */ }
  }

  private finishRetiring(instance: Instance): void {
    if (!this.retiring.has(instance)) return;
    this.retiring.delete(instance);
    this.destroyInstance(instance);
    // A mix that has been emptied keeps no decoded audio once its last release is done.
    if (this.voices.size === 0) this.dropInactiveCache();
  }

  private destroyInstance(instance: Instance): void {
    try { instance.source?.disconnect(); } catch { /* already disconnected */ }
    try { instance.binaural?.disconnect(); } catch { /* already disconnected */ }
    try { instance.envelope.disconnect(); } catch { /* already disconnected */ }
  }

  // ── Internals: buffers and the cache ──────────────────────────────────────

  private usedBytes(): number {
    let total = 0;
    for (const entry of this.cache.values()) total += entry.bytes;
    for (const bytes of this.reserved.values()) total += bytes;
    return total;
  }

  /** A cached buffer is active while a live or fading instance still plays from it. */
  private isActiveKey(key: string): boolean {
    for (const voice of this.voices.values()) if (voice.instance?.key === key) return true;
    for (const retiringKey of this.retiring.values()) if (retiringKey === key) return true;
    return false;
  }

  private dropInactiveCache(): void {
    for (const key of [...this.cache.keys()]) if (!this.isActiveKey(key)) this.cache.delete(key);
  }

  /** Free at least `bytes` from inactive buffers, oldest use first. False if that is not enough. */
  private evictInactive(bytes: number): boolean {
    if (bytes <= 0) return true;
    let freed = 0;
    const candidates = [...this.cache.entries()]
      .filter(([key]) => !this.isActiveKey(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of candidates) {
      this.cache.delete(key);
      freed += entry.bytes;
      if (freed >= bytes) return true;
    }
    return false;
  }

  /** Make room for `needBytes`, or refuse. Never touches a buffer an active voice plays from. */
  private ensureCapacity(needBytes: number): void {
    const over = this.usedBytes() + needBytes - this.maxBytes;
    if (over <= 0) return;
    if (!this.evictInactive(over)) throw new DriftEngineError('capacity', 'There is not enough memory for another voice.');
  }

  private noiseBuffer(color: DriftNoiseColor, key: string): AudioBuffer {
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = ++this.useClock;
      return cached.buffer;
    }
    const context = this.context!;
    // Exact: two channels of the loop length at the context's rate.
    this.ensureCapacity(Math.round(context.sampleRate * NOISE_LOOP_SECONDS) * 2 * 4);
    const buffer = createNoiseBuffer(context, color, this.deps.random);
    this.cache.set(key, { buffer, bytes: pcmBytes(buffer), lastUsed: ++this.useClock });
    return buffer;
  }

  private fileBuffer(definition: DriftSoundDefinition): Promise<AudioBuffer> {
    const id = definition.id;
    const cached = this.cache.get(id);
    if (cached) {
      cached.lastUsed = ++this.useClock;
      return Promise.resolve(cached.buffer);
    }
    const existing = this.inflight.get(id);
    if (existing) return existing;
    if (definition.source.kind !== 'file') return Promise.reject(new DriftEngineError('unavailable'));
    const source = definition.source;

    const load = async (): Promise<AudioBuffer> => {
      const context = this.context;
      if (!context) throw new DriftEngineError('unavailable');
      // Reserve the worst case (stereo at the context rate, doubled while a processed copy
      // exists beside the decoded one) before the first byte is read.
      const estimate = Math.ceil(source.durationSeconds * context.sampleRate) * 2 * 4 * (source.crossfadeMs > 0 ? 2 : 1);
      this.ensureCapacity(estimate);
      this.reserved.set(id, estimate);
      try {
        const bytes = await this.deps.readAudio(id);
        if (this.disposed) throw new DriftEngineError('unavailable');
        const decoded = await context.decodeAudioData(toArrayBuffer(bytes));
        if (this.disposed) throw new DriftEngineError('unavailable');
        const processed = buildLoopBuffer(context, decoded, source.crossfadeMs);
        // The real transient peak is the decoded buffer plus its processed copy.
        const peak = pcmBytes(decoded) + (processed !== decoded ? pcmBytes(processed) : 0);
        this.reserved.set(id, peak);
        const over = this.usedBytes() - this.maxBytes;
        if (over > 0 && !this.evictInactive(over)) throw new DriftEngineError('capacity', 'There is not enough memory for another voice.');
        this.cache.set(id, { buffer: processed, bytes: pcmBytes(processed), lastUsed: ++this.useClock });
        return processed;
      } finally {
        this.reserved.delete(id);
      }
    };

    const tracked: Promise<AudioBuffer> = this.enqueueLoad(load).finally(() => {
      if (this.inflight.get(id) === tracked) this.inflight.delete(id);
    });
    this.inflight.set(id, tracked);
    return tracked;
  }

  /** At most `maxConcurrentLoads` fetch-and-decode operations at a time. */
  private enqueueLoad<T>(work: () => Promise<T>): Promise<T> {
    const limit = this.deps.maxConcurrentLoads ?? MAX_CONCURRENT_LOADS;
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeLoads += 1;
        work().then(resolve, reject).finally(() => {
          this.activeLoads -= 1;
          const next = this.loadQueue.shift();
          if (next) next();
        });
      };
      if (this.activeLoads < limit) run();
      else this.loadQueue.push(run);
    });
  }
}

/** A standalone ArrayBuffer for decodeAudioData, which detaches what it is given. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Map whatever went wrong onto the small set of reasons the interface has copy for. */
export function classifyError(error: unknown): DriftVoiceErrorCode {
  if (error instanceof DriftEngineError) {
    return error.code === 'limit' || error.code === 'unknown-sound' ? 'unavailable' : error.code;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const tagged = /drift-audio:([a-z-]+)/.exec(message);
  if (tagged) {
    const code = tagged[1];
    if (code === 'unavailable' || code === 'missing' || code === 'corrupt' || code === 'too-large') return code;
  }
  if (error instanceof Error && (error.name === 'EncodingError' || /decode|unable to decode/i.test(message))) return 'decode';
  return 'unknown';
}
