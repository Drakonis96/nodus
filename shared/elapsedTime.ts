/**
 * Turn a wall-clock interval into the compact, stable form used by every
 * long-running progress surface. Seconds are always present; hours and minutes
 * appear when needed, and the lower units are padded so the label does not jump
 * in width while a job is running.
 */
export function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(milliseconds) ? milliseconds / 1_000 : 0));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min ${String(seconds).padStart(2, '0')} s`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

/** Invalid or absent timestamps deliberately produce null instead of a fake 0 s. */
export function elapsedTimeMs(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const finish = finishedAt ? Date.parse(finishedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  return Math.max(0, finish - start);
}

export function elapsedTimeLabel(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
  now = Date.now(),
): string | null {
  const elapsed = elapsedTimeMs(startedAt, finishedAt, now);
  return elapsed == null ? null : formatElapsedTime(elapsed);
}
