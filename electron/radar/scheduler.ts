import { radarService } from './radarService';

let firstTimer: NodeJS.Timeout | null = null;
let interval: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await radarService().checkDue();
  } catch (error) {
    console.error(`[radar] scheduled check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running = false;
  }
}

export function startRadarScheduler(): void {
  if (firstTimer || interval) return;
  firstTimer = setTimeout(() => void tick(), 90_000);
  interval = setInterval(() => void tick(), 15 * 60_000);
  firstTimer.unref?.();
  interval.unref?.();
}

export function stopRadarScheduler(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (interval) clearInterval(interval);
  firstTimer = null;
  interval = null;
  running = false;
}
