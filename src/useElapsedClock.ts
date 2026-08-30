import { useEffect, useState } from 'react';

/**
 * A single one-second repaint while a progress surface is live. The interval is
 * removed as soon as work reaches a terminal state, so a completed bar does not
 * leave a renderer timer behind.
 */
export function useElapsedClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}
