import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactStructured, redactText } from './ai/redact.mjs';
import { SERVER_PROFILE_PREFERENCES_VERSION, sanitizeServerProfilePreferences } from '../../shared/serverProfilePreferences.mjs';

const PRIVATE_DATA_VERSION = 1;
const DEFAULT_JOB_RETENTION_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MAX_JOBS = 1_000;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const JOB_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);
const JOB_TRANSITIONS = Object.freeze({
  queued: new Set(['queued', 'running', 'failed', 'cancelled']),
  running: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(['completed']),
  failed: new Set(['failed', 'queued']),
  cancelled: new Set(['cancelled', 'queued']),
});

function safeId(value, label = 'id') {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function empty(userId) {
  return {
    version: PRIVATE_DATA_VERSION,
    ownerUserId: userId,
    preferences: { ai: {}, profile: null },
    conversations: [],
    jobs: [],
    sync: { cursor: 0 },
  };
}

function privateDirectory(directory, label) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows */ }
}

function readPrivateJson(file) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Private-data file must not be a symlink');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { return JSON.parse(fs.readFileSync(descriptor, 'utf8')); } finally { fs.closeSync(descriptor); }
}

function normalizeStoredProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Private profile schema mismatch');
  const revision = Number(value.revision);
  const updatedAt = value.updatedAt == null ? null : String(value.updatedAt);
  const sourceKind = value.source?.kind;
  if (value.schemaVersion !== SERVER_PROFILE_PREFERENCES_VERSION || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Private profile schema mismatch');
  }
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !['desktop', 'server-web', 'api'].includes(sourceKind)) {
    throw new Error('Private profile provenance mismatch');
  }
  const rawDigests = value.sourceDigests && typeof value.sourceDigests === 'object' && !Array.isArray(value.sourceDigests)
    ? value.sourceDigests
    : {};
  const sourceDigests = Object.fromEntries(Object.entries(rawDigests).filter(([sourceId, digest]) => (
    /^[A-Za-z0-9_.:-]{1,160}$/.test(sourceId) && /^[a-f0-9]{64}$/.test(String(digest))
  )).slice(-100));
  return {
    schemaVersion: SERVER_PROFILE_PREFERENCES_VERSION,
    revision,
    updatedAt,
    source: { kind: sourceKind },
    values: sanitizeServerProfilePreferences(value.values),
    sourceDigests,
  };
}

function publicProfile(value) {
  if (!value) return {
    schemaVersion: SERVER_PROFILE_PREFERENCES_VERSION,
    revision: 0,
    updatedAt: null,
    source: null,
    values: null,
  };
  return {
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    updatedAt: value.updatedAt,
    source: value.source ? { kind: value.source.kind } : null,
    values: value.values,
  };
}

/** Durable private data split physically by user, with explicit ownership in every file. */
export class UserPrivateDataStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root, 'users');
    const configuredRetention = Number(options.jobRetentionMs ?? options.retentionMs ?? DEFAULT_JOB_RETENTION_MS);
    const configuredMaxJobs = Number(options.maxJobs ?? options.maxJobCount ?? DEFAULT_MAX_JOBS);
    this.jobRetentionMs = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : DEFAULT_JOB_RETENTION_MS;
    this.maxJobs = Number.isSafeInteger(configuredMaxJobs) && configuredMaxJobs > 0 ? configuredMaxJobs : DEFAULT_MAX_JOBS;
    privateDirectory(this.root, 'Private-data root');
  }

  userFile(userIdValue) {
    const userId = safeId(userIdValue, 'user id');
    const dir = path.join(this.root, userId);
    privateDirectory(dir, 'Private-data user directory');
    const file = path.join(dir, 'private.json');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Private-data file must not be a symlink');
    return file;
  }

  read(userIdValue) {
    const userId = safeId(userIdValue, 'user id');
    const file = this.userFile(userId);
    if (!fs.existsSync(file)) return empty(userId);
    const value = readPrivateJson(file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
    if (value?.version !== PRIVATE_DATA_VERSION || value?.ownerUserId !== userId) {
      throw new Error('Private-data ownership or schema mismatch');
    }
    const state = { ...empty(userId), ...value };
    const storedPreferences = state.preferences && typeof state.preferences === 'object' && !Array.isArray(state.preferences)
      ? state.preferences
      : {};
    const storedAi = storedPreferences.ai && typeof storedPreferences.ai === 'object' && !Array.isArray(storedPreferences.ai)
      ? storedPreferences.ai
      : {};
    const storedProfile = storedPreferences.profile;
    state.preferences = {
      ai: { ...storedAi },
      profile: storedProfile == null ? null : normalizeStoredProfile(storedProfile),
    };
    state.conversations = (Array.isArray(state.conversations) ? state.conversations : []).map((entry) => {
      if (entry?.ownerUserId != null && entry.ownerUserId !== userId) throw new Error('Private conversation ownership mismatch');
      return {
      ...entry, ownerUserId: userId,
      title: redactText(String(entry.title || '')).slice(0, 240),
      messages: (Array.isArray(entry.messages) ? entry.messages : []).map((message) => ({
        ...message,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: redactText(String(message.content || '')).slice(0, 1_000_000),
      })),
    }; });
    // Keep old private files readable while ensuring every newly returned job has the
    // server-owned context fields used by the queue and by audit tooling.
    state.jobs = (Array.isArray(state.jobs) ? state.jobs : []).map((entry) => {
      if ((entry?.ownerUserId != null && entry.ownerUserId !== userId) || (entry?.userId != null && entry.userId !== userId)) throw new Error('Private job ownership mismatch');
      return {
      ...entry, ownerUserId: userId, userId,
      model: entry.model == null ? null : String(entry.model).slice(0, 200),
      request: entry.request && typeof entry.request === 'object' ? redactStructured(entry.request) : null,
      result: entry.result == null ? null : redactStructured(entry.result),
      error: entry.error == null ? null : {
        code: String(entry.error.code || 'job_error').slice(0, 100),
        message: redactText(String(entry.error.message || 'Job failed.')).slice(0, 500),
      },
    }; });
    return state;
  }

  write(userIdValue, value) {
    const userId = safeId(userIdValue, 'user id');
    if (value?.ownerUserId !== userId) throw new Error('Private-data ownership mismatch');
    const file = this.userFile(userId);
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  }

  aiPreferences(userId) {
    return { ...(this.read(userId).preferences?.ai ?? {}) };
  }

  setAIPreferences(userId, patch) {
    const state = this.read(userId);
    state.preferences = { ...state.preferences, ai: { ...(state.preferences?.ai ?? {}), ...patch } };
    this.write(userId, state);
    return { ...state.preferences.ai };
  }

  profilePreferences(userId) {
    return publicProfile(this.read(userId).preferences?.profile ?? null);
  }

  /**
   * Replace the portable profile atomically with the AI defaults derived from it.
   * `sourceId` is resolved from the authenticated principal by the route. A digest
   * already submitted by that principal is an intentional no-op, which prevents an
   * unchanged Desktop restart from overwriting a newer choice made on Server or on
   * another Desktop installation.
   */
  setProfilePreferences(userId, values, { sourceKind, sourceId, digest, aiPatch = {} }) {
    const safeValues = sanitizeServerProfilePreferences(values);
    const safeSourceKind = ['desktop', 'server-web', 'api'].includes(sourceKind) ? sourceKind : 'api';
    const safeSourceId = safeId(sourceId, 'preference source');
    const safeDigest = String(digest ?? '');
    if (!/^[a-f0-9]{64}$/.test(safeDigest)) throw new Error('Invalid preference digest');

    const state = this.read(userId);
    const current = state.preferences?.profile ?? null;
    if (current?.sourceDigests?.[safeSourceId] === safeDigest) {
      return { profile: publicProfile(current), unchanged: true };
    }

    const sourceDigests = { ...(current?.sourceDigests ?? {}), [safeSourceId]: safeDigest };
    const boundedDigests = Object.fromEntries(Object.entries(sourceDigests).slice(-100));
    const sameValues = current?.values && JSON.stringify(current.values) === JSON.stringify(safeValues);
    const now = new Date().toISOString();
    const next = {
      schemaVersion: SERVER_PROFILE_PREFERENCES_VERSION,
      revision: sameValues ? current.revision : Math.max(0, Number(current?.revision) || 0) + 1,
      updatedAt: sameValues ? current.updatedAt : now,
      source: sameValues ? current.source : { kind: safeSourceKind },
      values: safeValues,
      sourceDigests: boundedDigests,
    };
    state.preferences = {
      ...state.preferences,
      ai: sameValues ? { ...(state.preferences?.ai ?? {}) } : { ...(state.preferences?.ai ?? {}), ...aiPatch },
      profile: next,
    };
    this.write(userId, state);
    return { profile: publicProfile(next), unchanged: Boolean(sameValues) };
  }

  conversations(userId) {
    return this.read(userId).conversations.map((entry) => ({ ...entry }));
  }

  conversation(userId, id) {
    return this.read(userId).conversations.find((entry) => entry.id === safeId(id, 'conversation id')) ?? null;
  }

  createConversation(userId, input = {}) {
    const state = this.read(userId);
    const now = new Date().toISOString();
    const conversation = {
      id: `conv_${randomUUID()}`, ownerUserId: String(userId),
      vaultId: input.vaultId == null ? null : safeId(input.vaultId, 'vault id'),
      title: redactText(String(input.title || '')).slice(0, 240), messages: [],
      createdAt: now, updatedAt: now, revision: 1,
    };
    state.conversations.push(conversation); this.write(userId, state);
    return { ...conversation };
  }

  appendMessage(userId, conversationId, message) {
    const state = this.read(userId);
    const conversation = state.conversations.find((entry) => entry.id === safeId(conversationId, 'conversation id'));
    if (!conversation || conversation.ownerUserId !== String(userId)) return null;
    const now = new Date().toISOString();
    conversation.messages.push({
      id: `msg_${randomUUID()}`, role: message.role === 'assistant' ? 'assistant' : 'user',
      content: redactText(String(message.content || '')).slice(0, 1_000_000), createdAt: now,
    });
    conversation.updatedAt = now; conversation.revision += 1;
    this.write(userId, state); return { ...conversation };
  }

  removeConversation(userId, conversationId) {
    const state = this.read(userId);
    const id = safeId(conversationId, 'conversation id');
    const before = state.conversations.length;
    state.conversations = state.conversations.filter((entry) => entry.id !== id || entry.ownerUserId !== String(userId));
    if (state.conversations.length === before) return false;
    this.write(userId, state); return true;
  }

  createJob(userId, input) {
    const state = this.read(userId);
    this.#pruneState(state);
    const now = new Date().toISOString();
    const ownerUserId = String(userId);
    const request = input.request && typeof input.request === 'object' ? redactStructured(input.request) : null;
    const job = {
      id: `job_${randomUUID()}`, ownerUserId, userId: ownerUserId,
      vaultId: safeId(input.vaultId, 'vault id'), capability: safeId(input.capability, 'capability'),
      provider: safeId(input.provider, 'provider'),
      model: (() => {
        const model = String(input.model ?? '').trim();
        if (!model || model.length > 200 || /[\u0000\r\n]/.test(model)) throw new Error('Invalid model');
        return model;
      })(),
      // The request is durable for retry, but never returned by the API. It is bounded and
      // redacted before it reaches the per-user file.
      request,
      status: 'queued', attempt: 1, result: null, error: null, createdAt: now, updatedAt: now,
    };
    state.jobs.push(job); this.write(userId, state); return { ...job };
  }

  updateJob(userId, jobId, patch) {
    const state = this.read(userId);
    const job = state.jobs.find((entry) => entry.id === safeId(jobId, 'job id') && entry.ownerUserId === String(userId));
    if (!job) return null;
    const next = patch && typeof patch === 'object' ? patch : {};
    // Context is immutable after creation. This also prevents a future route from accepting
    // userId/provider/model fields supplied by a client through a generic update path.
    const allowed = ['status', 'result', 'error', 'attempt'];
    for (const key of allowed) if (Object.hasOwn(next, key)) {
      if (key === 'status') {
        const status = String(next[key]);
        if (!JOB_STATUSES.has(status) || !JOB_TRANSITIONS[job.status]?.has(status)) throw new Error('Invalid job status transition');
      }
      if (key === 'result') job[key] = next[key] == null ? null : redactStructured(next[key]);
      else if (key === 'error') job[key] = next[key] == null ? null : {
        code: String(next[key].code || 'job_error').slice(0, 100),
        message: redactText(String(next[key].message || 'Job failed.')).slice(0, 500),
      };
      else if (key === 'attempt') job[key] = Math.max(1, Math.min(100, Number(next[key]) || 1));
      else job[key] = next[key];
    }
    job.updatedAt = new Date().toISOString();
    this.#pruneState(state);
    this.write(userId, state); return { ...job };
  }

  jobs(userId) {
    const state = this.read(userId);
    const before = state.jobs.length;
    this.#pruneState(state);
    if (state.jobs.length !== before) this.write(userId, state);
    return state.jobs.map(({ request: _request, ...entry }) => ({ ...entry }));
  }

  job(userId, jobId) {
    const state = this.read(userId);
    const before = state.jobs.length;
    this.#pruneState(state);
    if (state.jobs.length !== before) this.write(userId, state);
    const found = state.jobs.find((entry) => entry.id === safeId(jobId, 'job id') && entry.ownerUserId === String(userId));
    if (!found) return null;
    return { ...found };
  }

  /** Delete an owned job. The id is intentionally indistinguishable from an unknown id. */
  deleteJob(userId, jobId) {
    const state = this.read(userId);
    const id = safeId(jobId, 'job id');
    const before = state.jobs.length;
    state.jobs = state.jobs.filter((entry) => entry.id !== id || entry.ownerUserId !== String(userId));
    if (state.jobs.length === before) return false;
    this.write(userId, state); return true;
  }

  /**
   * Fail non-terminal work left by a previous process. Failing deterministically is safer than
   * pretending that a provider request can be resumed after its in-memory promise disappeared.
   */
  recoverJobs({ now = Date.now(), code = 'server_restart', message = 'Job interrupted by server restart.' } = {}) {
    let recovered = 0;
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const userId = entry.name;
      let state;
      try { state = this.read(userId); } catch { continue; }
      let changed = false;
      for (const job of state.jobs) {
        if (!['queued', 'running'].includes(job.status)) continue;
        job.status = 'failed'; job.result = null;
        job.error = { code, message };
        job.updatedAt = new Date(now).toISOString();
        changed = true; recovered += 1;
      }
      const pruned = this.#pruneState(state, now);
      if (changed || pruned) this.write(userId, state);
    }
    return recovered;
  }

  pruneJobs(userId, now = Date.now()) {
    const state = this.read(userId);
    const removed = this.#pruneState(state, now);
    if (removed) this.write(userId, state);
    return removed;
  }

  #pruneState(state, now = Date.now()) {
    const cutoff = Number(now) - this.jobRetentionMs;
    const before = state.jobs.length;
    state.jobs = state.jobs.filter((job) => {
      if (!TERMINAL_JOB_STATUSES.has(job.status)) return true;
      const timestamp = Date.parse(job.updatedAt || job.createdAt || '');
      // An unparseable terminal timestamp cannot be proven fresh, so evict it instead of
      // allowing malformed records to bypass the retention bound forever.
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    // A bad provider or a long-lived account must not grow its private file indefinitely. Only
    // terminal jobs are evicted by the count cap; active work always remains observable.
    if (state.jobs.length > this.maxJobs) {
      const removable = state.jobs.filter((job) => TERMINAL_JOB_STATUSES.has(job.status))
        .sort((a, b) => Date.parse(a.updatedAt || a.createdAt || '') - Date.parse(b.updatedAt || b.createdAt || ''));
      const excess = state.jobs.length - this.maxJobs;
      const evict = new Set(removable.slice(0, excess).map((job) => job.id));
      if (evict.size) state.jobs = state.jobs.filter((job) => !evict.has(job.id));
    }
    return before - state.jobs.length;
  }
}
