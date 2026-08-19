export interface HybridLogicalClock {
  wallTime: number;
  counter: number;
  deviceId: string;
}

export interface SyncOperation {
  id: string;
  sequence?: number;
  actorId: string;
  deviceId: string;
  hlc: string;
  table: string;
  key: unknown[];
  kind: 'upsert' | 'delete';
  row?: Record<string, unknown> | null;
  schemaVersion: number;
  createdAt: string;
}

export interface ConflictRecord {
  id: string;
  table: string;
  key: unknown[];
  winningOperationId: string;
  losingOperationId: string;
  winnerHlc: string;
  loserHlc: string;
  outcome: 'kept_local' | 'applied_remote';
  losingRow: Record<string, unknown> | null;
  createdAt: string;
}

const HLC_PATTERN = /^(\d{13})-(\d{6})-([A-Za-z0-9._:~-]{1,128})$/;

export function parseHlc(value: string): HybridLogicalClock | null {
  const match = HLC_PATTERN.exec(value);
  if (!match) return null;
  const wallTime = Number(match[1]); const counter = Number(match[2]);
  return Number.isSafeInteger(wallTime) && Number.isSafeInteger(counter)
    ? { wallTime, counter, deviceId: match[3] } : null;
}

export function formatHlc(value: HybridLogicalClock): string {
  if (!Number.isSafeInteger(value.wallTime) || value.wallTime < 0 || value.wallTime > 9_999_999_999_999) throw new Error('Invalid HLC wall time.');
  if (!Number.isSafeInteger(value.counter) || value.counter < 0 || value.counter > 999_999) throw new Error('Invalid HLC counter.');
  if (!/^[A-Za-z0-9._:~-]{1,128}$/.test(value.deviceId)) throw new Error('Invalid HLC device.');
  return `${String(value.wallTime).padStart(13, '0')}-${String(value.counter).padStart(6, '0')}-${value.deviceId}`;
}

export function compareHlc(left: string, right: string): number {
  const a = parseHlc(left); const b = parseHlc(right);
  if (!a || !b) throw new Error('Invalid HLC value.');
  return a.wallTime - b.wallTime || a.counter - b.counter || a.deviceId.localeCompare(b.deviceId);
}

export function tickHlc(previous: string | null, deviceId: string, wallTime = Date.now()): string {
  const parsed = previous ? parseHlc(previous) : null;
  const nextWall = Math.max(Math.floor(wallTime), parsed?.wallTime ?? 0);
  const counter = parsed && nextWall === parsed.wallTime ? parsed.counter + 1 : 0;
  return formatHlc({ wallTime: nextWall, counter, deviceId });
}

export function mergeHlc(local: string | null, remote: string, deviceId: string, wallTime = Date.now()): string {
  const left = local ? parseHlc(local) : null; const right = parseHlc(remote);
  if (!right) throw new Error('Invalid remote HLC.');
  const now = Math.floor(wallTime); const maxWall = Math.max(now, left?.wallTime ?? 0, right.wallTime);
  let counter = 0;
  if (left?.wallTime === maxWall && right.wallTime === maxWall) counter = Math.max(left.counter, right.counter) + 1;
  else if (left?.wallTime === maxWall) counter = left.counter + 1;
  else if (right.wallTime === maxWall) counter = right.counter + 1;
  return formatHlc({ wallTime: maxWall, counter, deviceId });
}
