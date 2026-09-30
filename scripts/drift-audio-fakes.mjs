// A small, faithful-enough Web Audio double for the Nodus Drift tests.
//
// "Faithful" is the point: the failures worth catching are the ones the real API
// enforces. A source node throws if `start()` is called twice; a node that was
// disconnected stops being part of the graph; `decodeAudioData` rejects garbage; a
// context only advances when it is running. Everything a node does is recorded so a
// test can assert on the graph the engine actually built, not on the engine's own
// bookkeeping.

export class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); this.value = value; return this; }
  linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); this.value = value; return this; }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); return this; }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnectCount = 0;
    context.nodes.push(this);
  }
  connect(destination, output = 0, input = 0) {
    this.connections.push({ to: destination, output, input });
    return destination;
  }
  disconnect() {
    this.disconnectCount += 1;
    this.connections = [];
  }
  get connected() { return this.disconnectCount === 0; }
}

export class FakeGain extends FakeNode {
  constructor(context) { super(context, 'gain'); this.gain = new FakeParam(1); }
}

export class FakeCompressor extends FakeNode {
  constructor(context) {
    super(context, 'compressor');
    for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new FakeParam(0);
  }
}

export class FakeMerger extends FakeNode {
  constructor(context, inputs) { super(context, 'merger'); this.numberOfInputs = inputs; }
}

class FakeScheduledSource extends FakeNode {
  constructor(context, kind) {
    super(context, kind);
    this.startCalls = [];
    this.stopCalls = [];
  }
  start(when = 0, offset = 0) {
    if (this.startCalls.length > 0) throw new Error('InvalidStateError: start() called more than once on the same node');
    this.startCalls.push({ when, offset });
  }
  stop(when = 0) {
    if (this.startCalls.length === 0) throw new Error('InvalidStateError: stop() before start()');
    this.stopCalls.push(when);
  }
  get started() { return this.startCalls.length > 0; }
}

export class FakeOscillator extends FakeScheduledSource {
  constructor(context) { super(context, 'oscillator'); this.type = 'sine'; this.frequency = new FakeParam(440); }
}

export class FakeBufferSource extends FakeScheduledSource {
  constructor(context) { super(context, 'buffer-source'); this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; }
}

export class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
  copyToChannel(source, channel) { this.channels[channel].set(source); }
}

/** Bytes a test hands to the fake decoder: frames, channels and rate in a tiny header. */
export function fakeAudioBytes({ frames = 48000, channels = 2, sampleRate = 48000, ramp = true, bad = false } = {}) {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  bytes.set(bad ? [0x42, 0x41, 0x44, 0x21] : [0x46, 0x41, 0x4b, 0x45], 0);
  view.setUint32(4, frames, true);
  view.setUint8(8, channels);
  view.setUint32(9, sampleRate, true);
  view.setUint8(13, ramp ? 1 : 0);
  return bytes;
}

export class FakeContext {
  constructor({ sampleRate = 48000, state = 'suspended', log = [] } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = state;
    this.nodes = [];
    this.log = log;
    this.listeners = new Map();
    this.destination = new FakeNode(this, 'destination');
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.closeCalls = 0;
    this.decodeCalls = 0;
    this.buffersCreated = [];
    this.resumeImpl = null;
  }
  createGain() { return new FakeGain(this); }
  createOscillator() { return new FakeOscillator(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createChannelMerger(inputs) { return new FakeMerger(this, inputs); }
  createDynamicsCompressor() { return new FakeCompressor(this); }
  createBuffer(channels, length, sampleRate) {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffersCreated.push(buffer);
    return buffer;
  }
  async decodeAudioData(arrayBuffer) {
    this.decodeCalls += 1;
    this.log.push('decode');
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== 'FAKE') {
      const error = new Error('Unable to decode audio data');
      error.name = 'EncodingError';
      throw error;
    }
    const frames = view.getUint32(4, true);
    const channels = view.getUint8(8);
    const sampleRate = view.getUint32(9, true);
    const ramp = view.getUint8(13) === 1;
    const buffer = new FakeAudioBuffer(channels, frames, sampleRate);
    if (ramp) for (const data of buffer.channels) for (let i = 0; i < frames; i++) data[i] = i / frames;
    return buffer;
  }
  resume() {
    this.resumeCalls += 1;
    this.log.push('resume');
    if (this.resumeImpl) return this.resumeImpl(this);
    this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls += 1;
    this.log.push('suspend');
    this.setState('suspended');
    return Promise.resolve();
  }
  close() {
    this.closeCalls += 1;
    this.log.push('close');
    this.setState('closed');
    return Promise.resolve();
  }
  setState(state) {
    this.state = state;
    for (const listener of [...(this.listeners.get('statechange') ?? [])]) listener();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }

  /** Advance the audio clock, but only while running, like the real one. */
  advance(seconds) { if (this.state === 'running') this.currentTime += seconds; }
  of(kind) { return this.nodes.filter((node) => node.kind === kind); }
  get sources() { return this.nodes.filter((node) => node.kind === 'buffer-source'); }
  get oscillators() { return this.nodes.filter((node) => node.kind === 'oscillator'); }
}

/** Controllable timers so a fade or a debounce is stepped through, not waited for. */
export class FakeTimers {
  constructor() { this.now = 0; this.next = 1; this.queue = new Map(); }
  set = (callback, ms) => { const id = this.next++; this.queue.set(id, { at: this.now + ms, callback }); return id; };
  clear = (id) => { this.queue.delete(id); };
  get pending() { return this.queue.size; }
  /** Run everything due within `ms`, in time order, including timers scheduled while running. */
  advance(ms) {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.queue.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (due.length === 0) break;
      const [id, timer] = due[0];
      this.queue.delete(id);
      this.now = Math.max(this.now, timer.at);
      timer.callback();
    }
    this.now = until;
  }
}

/** A promise a test settles by hand. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let queued microtasks and already-resolved promises run. */
export async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * The byte transport of the engine. `files` maps a sound id to bytes, an Error, or a
 * `deferred()` a test resolves later. It records order and the highest number of reads
 * in flight at once.
 */
export function makeTransport(files, log = []) {
  const calls = [];
  const transport = {
    calls,
    active: 0,
    maxActive: 0,
    async read(id) {
      calls.push(id);
      log.push(`read:${id}`);
      transport.active += 1;
      transport.maxActive = Math.max(transport.maxActive, transport.active);
      try {
        let entry = files.get(id);
        if (entry && typeof entry.then === 'function') entry = await entry;
        if (entry && entry.promise) entry = await entry.promise;
        if (entry instanceof Error) throw entry;
        if (!entry) throw new Error('drift-audio:missing: not in the fixture');
        return entry;
      } finally {
        transport.active -= 1;
      }
    },
  };
  return transport;
}
