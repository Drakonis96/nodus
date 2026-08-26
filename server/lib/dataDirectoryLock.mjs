import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// PID values are recycled and every fresh container commonly starts its Node process as
// PID 1. Pair the PID with this process' approximate birth time so a clean container
// replacement cannot mistake its own PID for the server that wrote the previous lock.
const PROCESS_STARTED_AT_MS = Math.round(Date.now() - process.uptime() * 1_000);

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function lockOwnerAlive(existing) {
  const pid = Number(existing?.pid);
  if (!processAlive(pid)) return false;
  if (pid !== process.pid) return true;
  const ownerStartedAtMs = Number(existing?.processStartedAtMs);
  return Number.isFinite(ownerStartedAtMs) && Math.abs(ownerStartedAtMs - PROCESS_STARTED_AT_MS) < 2_000;
}

/**
 * Nodus Server is deliberately a single-writer process. Refuse a second process for the
 * same data directory instead of allowing independent read/modify/rename stores to lose
 * private conversations, jobs or artifacts.
 */
export function acquireDataDirectoryLock(dataDir) {
  const root = path.resolve(dataDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('NODUS_DATA_DIR must not be a symlink');
  try { fs.chmodSync(root, 0o700); } catch { /* Windows */ }
  const file = path.join(root, '.nodus-server.lock');
  const token = randomUUID();

  const create = () => {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, processStartedAtMs: PROCESS_STARTED_AT_MS, token, startedAt: new Date().toISOString() }), 'utf8');
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  };

  for (;;) {
    try { create(); break; } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* malformed stale lock */ }
      if (lockOwnerAlive(existing)) throw new Error(`NODUS_DATA_DIR is already in use by server process ${existing.pid}.`);

      // Claim the stale pathname atomically. If another starter won the race, retry and
      // inspect its new lock instead of ever unlinking a lock we did not read.
      const stale = `${file}.stale-${token}`;
      try { fs.renameSync(file, stale); }
      catch (renameError) { if (renameError?.code === 'ENOENT') continue; throw renameError; }
      try { create(); break; }
      catch (createError) { if (createError?.code !== 'EEXIST') throw createError; }
      finally { try { fs.unlinkSync(stale); } catch { /* already cleaned */ } }
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (current?.token === token) fs.unlinkSync(file);
    } catch { /* already absent or replaced */ }
  };
  process.once('exit', release);
  return { file, release };
}
